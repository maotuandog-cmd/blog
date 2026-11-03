# Linux 常用问题排查命令

先看整体，再落到 CPU / 内存 / IO / 网络 / 内核。  
一分钟先跑这组，多数问题能定位到大类：

```bash
uptime
free -h
df -hT
iostat -xz 1 3
ss -tulnp
dmesg -T | tail -50
```

| 现象 | 优先看 |
|------|--------|
| load 高、卡顿 | CPU、IO wait、进程 D 状态 |
| 内存吃满、被杀进程 | `free`、OOM、`dmesg` |
| 磁盘慢、写入卡住 | `iostat`、`dmesg` 磁盘错误 |
| ping 不通、服务连不上 | IP/路由/防火墙/`ss` |
| 突然重启、硬件异常 | `dmesg`、`journalctl -k` |
| Too many open files | 句柄 / `ulimit` / cgroup |
| load 高但 CPU 空 | D 状态、NFS、磁盘 IO |
| 登录慢、证书失败 | DNS、NTP、时间 |

目录：[[#1. 系统总览|总览]] · [[#2. CPU|CPU]] · [[#3. 内存|内存]] · [[#4. 磁盘与 IO|IO]] · [[#5. 网络|网络]] · [[#6. dmesg 与内核日志|dmesg]] · [[#7. 进程、文件、服务|进程]] · [[#8. 按场景速查|场景]] · [[#9. 打开文件数、句柄、ulimit|句柄]] · [[#10. systemd 与启动|systemd]] · [[#11. 时间、NTP、证书过期|时间]] · [[#12. 硬件、PCI、温度、GPU|硬件]] · [[#13. RAID、LVM、多路径|LVM]] · [[#14. NFS / CIFS 卡住|NFS]] · [[#15. SSH 登不上、登录慢|SSH]] · [[#16. 权限、ACL、SELinux、AppArmor|权限]] · [[#17. 容器与 KVM|KVM]] · [[#18. 崩溃、core dump、上次开机|崩溃]] · [[#19. 历史性能（sar）|sar]] · [[#20. 常见 sysctl（只读排查，先看再改）|sysctl]]

---

## 1. 系统总览

```bash
uname -a
hostnamectl
lscpu
nproc
uptime                    # load average：1/5/15 分钟
cat /proc/loadavg
w                         # 谁在登录、平均负载
who -a
last -n 20                # 最近登录 / 重启
last reboot
timedatectl
```

**load 怎么读**

- load ≈ 可运行 + 不可中断睡眠（D 状态，常见于等磁盘）的进程数
- 对比 CPU 核数：`nproc`
- load 高但 `%us/%sy` 不高，多半是 **IO wait** 或 **D 状态**，不要先当成纯 CPU 打满

```bash
top                       # 看 wa、st、us、sy，以及 STATE=D 的进程
vmstat 1                  # r/b、si/so、wa 一起看
```

`vmstat` 关键列：

| 列 | 含义 |
|----|------|
| r | 运行队列，持续 > 核数 = CPU 忙 |
| b | 阻塞（等 IO），持续 > 0 = 磁盘/NFS 可能卡住 |
| si/so | 换入/换出，持续非 0 = 内存不够在刷 swap |
| wa | IO wait |
| st | 虚拟机被宿主机抢占（steal） |

---

## 2. CPU

```bash
# 实时进程
top
htop                      # 若已安装，更直观
ps aux --sort=-%cpu | head
pidstat -u 1              # 按进程看 CPU，含 user/system

# 按核
mpstat -P ALL 1
sar -u 1 5                # sysstat

# 哪些进程在跑、在等
ps -eo pid,ppid,stat,psr,pcpu,pmem,comm,args --sort=-pcpu | head -30
ps -eo pid,stat,wchan:20,comm | awk '$2 ~ /D/'    # 不可中断睡眠
```

**CPU 打满时继续拆**

```bash
# 用户态 vs 内核态
pidstat -u 1
perf top                  # 热点函数（需权限，可能要 debug 符号）
perf record -a -g -- sleep 10
perf report

# 软中断 / 硬中断（网卡、存储常在这里）
cat /proc/interrupts
cat /proc/softirqs
mpstat -I SUM 1
sar -I SUM 1 5

# 上下文切换、运行队列
vmstat 1
pidstat -w 1
sar -w 1 5
```

**虚拟机额外看 steal**

```bash
mpstat 1
# %steal 高：CPU 被宿主机抢走，不是业务代码本身算得慢
```

**电源/频率（笔记本、节能策略）**

```bash
lscpu | grep -E 'MHz|Model'
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
```

---

## 3. 内存

```bash
free -h
cat /proc/meminfo
vmstat -s
swapon --show
```

`free` 怎么读（不要只看 used）：

- **available**：应用大概还能用多少，比 `free` 列更有参考价值
- **buff/cache**：内核缓存，压力大时会回收，一般不算“泄漏”
- **swap 已用且 si/so 持续涨**：物理内存不够

```bash
# 谁占内存
ps aux --sort=-%mem | head
ps -eo pid,user,rss,vsz,comm,args --sort=-rss | head -30
pmap -x <pid>
smem -tk 2>/dev/null || true

# 按用户汇总
ps -eo user,rss --no-headers | awk '{a[$1]+=$2} END {for (i in a) printf "%s\t%.1f MB\n", i, a[i]/1024}' | sort -k2 -n

# 内核 slab（目录项/inode 缓存过大时）
slabtop -o | head
cat /proc/slabinfo | sort -k3 -n | tail
```

**OOM Killer**

```bash
dmesg -T | grep -iE 'oom|killed process|out of memory'
journalctl -k -g -i oom
grep -iE 'oom|killed process' /var/log/kern.log /var/log/messages 2>/dev/null

# 进程 oom 分数（越高越容易被杀）
cat /proc/<pid>/oom_score
cat /proc/<pid>/oom_score_adj
```

**泄漏/增长观察**

```bash
watch -n 2 'free -h; echo; ps -eo pid,rss,comm --sort=-rss | head'
pidstat -r 1
sar -r 1 5
```

---

## 4. 磁盘与 IO

```bash
# 空间 vs inode（空间还够但 inode 满也会 ENOSPC）
df -hT
df -i
du -xh --max-depth=1 /  2>/dev/null | sort -h
ncdu /                    # 若已安装

# 设备拓扑
lsblk -f
lsblk -d -o NAME,ROTA,TYPE,SIZE,MODEL,TRAN
findmnt
mount | column -t
```

**IO 性能（最常用）**

```bash
iostat -xz 1              # %util、await、svctm、aqu-sz
iotop -oPa                # 哪个进程在读写（需 root）
pidstat -d 1
vmstat 1                  # b、wa、bi/bo
sar -d 1 5
```

`iostat -xz` 关键列：

| 列 | 含义 |
|----|------|
| r/s w/s | 每秒读写请求数 |
| rkB/s wkB/s | 吞吐 |
| await | 平均等待（含队列），机械盘经常几十 ms，SSD 应更低 |
| aqu-sz | 队列深度，持续很高说明盘跟不上 |
| %util | 设备忙时间；接近 100% 且 await 高 = 瓶颈 |

**卡住、只读、坏块**

```bash
dmesg -T | grep -iE 'i/o error|reset|readonly|ext4|xfs|nvme|sd[a-z]|blk_update'
journalctl -k -g -i 'i/o error|nvme|ata|xfs|ext4'

# 谁占用文件 / 删了还占空间
lsof +D /path
lsof | grep deleted
lsof -p <pid>
fuser -vm /mount/point

# 块设备健康（按实际盘名改）
smartctl -a /dev/sda
nvme list
nvme smart-log /dev/nvme0n1
```

**文件系统只读** 常见于磁盘错误后内核保护，先 `dmesg` 再决定 fsck / 换盘，不要先reboot碰运气。

---

## 5. 网络

**接口、地址、路由**

```bash
ip -br addr
ip addr
ip -br link
ip route
ip -s link                 # 错误/丢包计数
nmcli device status 2>/dev/null
ethtool <eth0>
ethtool -S <eth0> | grep -iE 'err|drop|crc|miss'
```

**端口与连接**

```bash
ss -tulnp                  # 监听端口
ss -antp                   # 已建立连接
ss -s                      # 汇总
ss -tan state syn-sent
ss -tan state time-wait | wc -l

# 旧命令（部分系统仍有）
netstat -tulnp
```

**连通性**

```bash
ping -c 4 8.8.8.8
ping -c 4 <网关>
ip route get 1.1.1.1
traceroute -n 8.8.8.8
mtr -rwz 8.8.8.8
dig example.com
getent hosts example.com
curl -Iv --max-time 5 https://example.com
```

**抓包 / 吞吐 / 丢包**

```bash
tcpdump -i any -nn port 80
tcpdump -i eth0 -nn host 1.2.3.4
nstat -az                  # SNMP 风格计数
sar -n DEV 1 5
sar -n EDEV 1 5            # 网卡错误
iftop -i eth0 2>/dev/null
nethogs 2>/dev/null
iperf3 -s                  # 一端
iperf3 -c <server>         # 另一端
```

**防火墙、NAT、转发**

```bash
sysctl net.ipv4.ip_forward
iptables -L -n -v
iptables -t nat -L -n -v
nft list ruleset
firewall-cmd --list-all 2>/dev/null
ufw status verbose 2>/dev/null

# conntrack 表满会导致新连接失败
sysctl net.netfilter.nf_conntrack_count net.netfilter.nf_conntrack_max
```

**DNS / 解析慢**

```bash
cat /etc/resolv.conf
resolvectl status 2>/dev/null
getent ahosts example.com
dig +tcp example.com
```

---

## 6. dmesg 与内核日志

`dmesg` 是内核环形缓冲区，硬件、OOM、文件系统、网卡、USB 异常优先看这里。

```bash
dmesg -T                   # 人类可读时间
dmesg -T --level=err,warn
dmesg -w                   # 跟踪新日志
dmesg -T | tail -100

# 常见关键字
dmesg -T | grep -iE 'error|fail|warn|oom|kill|blocked|hung|reset|timeout|i/o error|nvme|ext4|xfs|oom-killer|segfault|out of memory|link down|nic'

journalctl -k              # 等价于内核日志，可跨重启（若持久化）
journalctl -k -b           # 本次启动
journalctl -k -b -1        # 上次启动（查突然重启）
journalctl -p err -b
journalctl -xe
```

**和 dmesg 配套的系统日志**

```bash
journalctl -u ssh --since '1 hour ago'
journalctl --since today --priority=err
ls -lh /var/log/
tail -n 100 /var/log/syslog
tail -n 100 /var/log/messages
tail -n 100 /var/log/kern.log
```

**内核卡住、软锁、硬件错误**

```bash
dmesg -T | grep -iE 'blocked for more than|hung_task|soft lockup|hard lockup|mce|hardware error|nmi'
sysctl kernel.hung_task_timeout_secs
```

环形缓冲区太小会丢早期日志：

```bash
dmesg | wc -l
sysctl kernel.dmesg_restrict
# 持久化：journald Storage=persistent，或 rsyslog 收 kern.*
```

---

## 7. 进程、文件、服务

```bash
# 进程树、僵尸
pstree -ap | head
ps -eo pid,ppid,stat,comm | awk '$3 ~ /Z/'

# 打开的文件、socket
lsof -p <pid>
ls -l /proc/<pid>/fd | head
ls -l /proc/<pid>/cwd /proc/<pid>/exe
tr '\0' ' ' < /proc/<pid>/cmdline; echo
cat /proc/<pid>/stack      # D 状态卡在哪（内核栈）

# systemd
systemctl --failed
systemctl status <svc>
journalctl -u <svc> -e
systemctl list-timers --all
```

**系统调用追踪（已定位到进程时）**

```bash
strace -f -p <pid>
strace -f -e trace=network,file -p <pid>
ltrace -p <pid>
```

---

## 8. 按场景速查

**机器很卡**

```bash
uptime
top                       # wa / us / sy / st
vmstat 1
iostat -xz 1
ps -eo pid,stat,wchan:20,pcpu,pmem,comm | head -40
dmesg -T | tail -50
```

**服务起不来 / 端口没监听**

```bash
systemctl status <svc>
journalctl -u <svc> -e --no-pager
ss -tulnp | grep <port>
dmesg -T | tail
```

**突然重启**

```bash
last reboot
journalctl -b -1 -p err
journalctl -k -b -1
dmesg -T | grep -iE 'oom|mce|reset|panic|watchdog'
```

**磁盘写满**

```bash
df -hT
df -i
du -xh --max-depth=1 /var /home /tmp 2>/dev/null
lsof | grep deleted
```

**外网不通、内网通**

```bash
ip -br addr
ip route
ping -c 3 <网关>
ping -c 3 8.8.8.8
ping -c 3 example.com     # 通 IP 不通域名 = DNS
iptables -L -n -v
```

---

## 9. 打开文件数、句柄、ulimit

报错 `Too many open files`、进程 fd 涨不停时看这里。

```bash
ulimit -a
ulimit -n                         # 当前 shell 的 nofile
cat /proc/sys/fs/file-nr          # 已分配 / 空闲 / 上限
cat /proc/sys/fs/file-max
sysctl fs.nr_open

# 某进程打开了多少 fd
ls /proc/<pid>/fd | wc -l
ls -l /proc/<pid>/fd | head
cat /proc/<pid>/limits            # 该进程真实限制（比 ulimit 准）

# 谁打开文件最多
for p in /proc/[0-9]*; do
  echo "$(ls "$p/fd" 2>/dev/null | wc -l) ${p#/proc/} $(tr '\0' ' ' < "$p/comm" 2>/dev/null)"
done | sort -nr | head
```

**systemd 服务被 cgroup/LimitNOFILE 卡住**

```bash
systemctl show <svc> -p LimitNOFILE -p LimitNPROC -p MemoryMax -p CPUQuota
systemctl cat <svc>
cat /sys/fs/cgroup/$(systemctl show -p ControlGroup --value <svc>)/memory.current 2>/dev/null
```

**inode / dentry 压力（大量小文件）**

```bash
df -i
sysctl fs.inotify.max_user_watches fs.inotify.max_user_instances
# IDE、容器、文件同步工具常把 inotify watches 打满
```

---

## 10. systemd 与启动

```bash
systemctl --failed
systemctl list-units --state=failed
systemctl is-system-running
systemd-analyze
systemd-analyze blame | head
systemd-analyze critical-chain
systemctl list-jobs
systemctl list-timers --all
systemctl list-sockets --all
```

**某个 unit 起不来**

```bash
systemctl status <svc> -l --no-pager
journalctl -u <svc> -e --no-pager
journalctl -u <svc> --since '1 hour ago'
systemctl reset-failed <svc>
systemctl cat <svc>
systemd-analyze verify /etc/systemd/system/<svc>.service
```

**journal 占满磁盘**

```bash
journalctl --disk-usage
journalctl --vacuum-time=7d
journalctl --vacuum-size=500M
```

---

## 11. 时间、NTP、证书过期

时间不准会导致 Kerberos、TLS、日志对不上、k8s 证书失败。

```bash
timedatectl
timedatectl show
chronyc tracking 2>/dev/null
chronyc sources -v 2>/dev/null
systemctl status chrony chronyd systemd-timesyncd ntp ntpd --no-pager 2>/dev/null
date -u; date

# TLS 证书还剩多久
echo | openssl s_client -servername example.com -connect example.com:443 2>/dev/null | openssl x509 -noout -dates -subject
```

---

## 12. 硬件、PCI、温度、GPU

```bash
lscpu
lsmem
lshw -short 2>/dev/null
lspci -nnk
lsusb
dmidecode -t system,memory,processor 2>/dev/null | head -80

# 温度 / 风扇（需 lm-sensors）
sensors
```

**GPU（NVIDIA）**

```bash
nvidia-smi
nvidia-smi -q | grep -iE 'temp|power|ecc|xid|throttle'
dmesg -T | grep -iE 'nvrm|xid|nvidia'
```

**PCIe / 网卡 / 磁盘掉线**

```bash
lspci | grep -iE 'ethernet|nvme|vga|raid'
dmesg -T | grep -iE 'aer|pcie|link down|offline|removed'
```

---

## 13. RAID、LVM、多路径

```bash
cat /proc/mdstat
mdadm --detail /dev/md0 2>/dev/null
pvs; vgs; lvs
lvs -o+lv_health_status,devices
dmsetup ls --tree
multipath -ll 2>/dev/null
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,UUID
blkid
```

**LVM 快照/空间耗尽会导致文件系统变只读或写入失败：**

```bash
lvs -a
vgs                         # VFree 接近 0 要小心
```

---

## 14. NFS / CIFS 卡住

load 高、进程大量 D 状态、`wchan` 含 `rpc`/`nfs` 时优先怀疑远端存储。

```bash
findmnt -t nfs,nfs4,cifs
mount | grep -E 'nfs|cifs'
nfsstat -c
rpcinfo -p
dmesg -T | grep -iE 'nfs|rpc|cifs|smb'

# 哪个进程卡在 NFS
ps -eo pid,stat,wchan:25,comm | awk '$2 ~ /D/'
ls -l /proc/<pid>/stack
```

不要在卡住的 NFS 挂载上 `ls` / `df` 硬等，可能再挂一个 shell。可另开终端看 `dmesg -w`。

---

## 15. SSH 登不上、登录慢

```bash
systemctl status ssh sshd --no-pager
ss -tulnp | grep -E ':22|:2222'
journalctl -u ssh -u sshd -e --no-pager
tail -50 /var/log/auth.log /var/log/secure 2>/dev/null

# 客户端拉高日志看卡在哪（DNS、GSSAPI、密钥）
ssh -vvv user@host

# 登录慢常见：UseDNS、GSSAPIAuthentication、磁盘满导致记日志失败
grep -E 'UseDNS|GSSAPI|PasswordAuth|PermitRoot' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/* 2>/dev/null
df -h /
```

本机还能进、SSH 进不去：查防火墙、sshd 是否监听 `0.0.0.0`、fail2ban：

```bash
fail2ban-client status 2>/dev/null
iptables -L -n | grep -i ssh
ss -tlnp | grep sshd
```

---

## 16. 权限、ACL、SELinux、AppArmor

```bash
ls -ld /path
ls -l /path
namei -l /path/to/file        # 沿路径看哪一层权限不对
getfacl /path
id
sudo -l

# SELinux（RHEL 系常见）
getenforce
ausearch -m avc -ts recent 2>/dev/null
journalctl | grep -i denied

# AppArmor（Ubuntu 常见）
aa-status 2>/dev/null
dmesg -T | grep -i apparmor
```

---

## 17. 容器与 KVM

**Docker / containerd**

```bash
docker ps -a
docker inspect <id> --format '{{.State.Status}} {{.State.Error}} {{.HostConfig.NetworkMode}}'
docker logs --tail 100 <id>
ss -tlnp | grep docker
df -h /var/lib/docker
dmesg -T | grep -iE 'overlay|docker|oom'
```

**KVM / libvirt**

```bash
virsh list --all
virsh dominfo <vm>
virsh dumpxml <vm> | grep -E 'interface|source|model'
virsh net-list --all
ip -br link show virbr0
dmesg -T | grep -iE 'kvm|qemu|vfio'
journalctl -u libvirtd -e --no-pager
```

---

## 18. 崩溃、core dump、上次开机

```bash
coredumpctl list
coredumpctl info <pid>
ulimit -c
sysctl kernel.core_pattern
ls /var/crash /var/lib/systemd/coredump 2>/dev/null

# 用户态崩溃痕迹
dmesg -T | grep -iE 'segfault|general protection|killed process'
journalctl -b -1            # 上一启动周期全部日志
journalctl -b -1 -p err
last -x | head
```

**内核 panic / 看门狗**（需 kdump 才有完整 vmcore）：

```bash
kdumpctl status 2>/dev/null
ls /var/crash
dmesg -T | grep -iE 'panic|oops|watchdog|hard lockup|BUG:'
```

---

## 19. 历史性能（sar）

安装 sysstat 后，可看**过去某段时间**，不只看当前：

```bash
sar                     # 默认 CPU
sar -u -s 10:00 -e 11:00
sar -r                  # 内存
sar -W                  # swap
sar -d                  # 磁盘
sar -n DEV              # 网卡
sar -n SOCK             # socket
sar -q                  # 运行队列 / load
ls /var/log/sysstat /var/log/sa 2>/dev/null
sar -f /var/log/sysstat/sa$(date +%d)
```

---

## 20. 常见 sysctl（只读排查，先看再改）

```bash
sysctl net.ipv4.ip_forward
sysctl net.ipv4.tcp_tw_reuse
sysctl net.core.somaxconn
sysctl net.ipv4.tcp_max_syn_backlog
sysctl net.core.netdev_max_backlog
sysctl net.netfilter.nf_conntrack_max net.netfilter.nf_conntrack_count
sysctl vm.swappiness
sysctl vm.min_free_kbytes
sysctl vm.max_map_count          # Elastic/部分 JVM 不够会起不来
sysctl fs.file-max
sysctl kernel.pid_max
sysctl kernel.panic kernel.panic_on_oops
```

连接打满 / SYN 队列：

```bash
ss -s
ss -lnt | head
nstat -az | grep -iE 'listenoverflows|listendrops|tcpattemptfails|tcpretrans'
dmesg -T | grep -i 'nf_conntrack: table full'
```

---

## 21. 按场景速查（续）

**Too many open files**

```bash
cat /proc/<pid>/limits | grep 'open files'
ls /proc/<pid>/fd | wc -l
cat /proc/sys/fs/file-nr
```

**登录慢 / sudo 慢**

```bash
# DNS、NSS、LDAP、磁盘满写 audit
ping -c 1 "$(hostname)"
grep hosts /etc/nsswitch.conf
df -h /
journalctl -e | tail
```

**NTP 时间跳变后服务全挂**

```bash
timedatectl
journalctl -u chrony -u systemd-timesyncd --since today
```

**NFS 导致整机 load 爆炸**

```bash
ps -eo pid,stat,wchan:25,comm | awk '$2 ~ /D/'
findmnt -t nfs,nfs4
dmesg -T | grep -i nfs
```

**虚拟机网卡有、但上不了网**

```bash
ip -br addr
ip route
virsh net-info default
iptables -t nat -L -n -v
sysctl net.ipv4.ip_forward
ethtool <iface> | grep -i 'Link detected'
```

**GPU 进程占卡 / 驱动掉了**

```bash
nvidia-smi
dmesg -T | grep -iE 'nvrm|xid|nvidia'
systemctl status nvidia-persistenced --no-pager 2>/dev/null
```

---

## 22. 常用软件包

部分命令不在最小系统里，按发行版安装：

```bash
# Debian / Ubuntu
sudo apt install sysstat htop iotop iperf3 mtr-tiny smartmontools nvme-cli lsof strace linux-tools-generic lm-sensors chrony

# RHEL / Rocky
sudo dnf install sysstat htop iotop iperf3 mtr smartmontools nvme-cli lsof strace perf lm_sensors chrony
```

`sar` / `iostat` / `mpstat` / `pidstat` 来自 **sysstat**。
