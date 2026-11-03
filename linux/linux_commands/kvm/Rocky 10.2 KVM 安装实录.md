# Rocky 10.2 KVM 虚拟机安装实录

**日期**:2026-10-26
**主机**:Ubuntu 26.04.1 LTS (kernel 7.0.0-38-generic)
**工具链**:libvirt 12.0.0 / QEMU 10.2.1 / virt-install 5.1.0
**成果**:VM `rocky10` — Rocky Linux 10.2,NAT 网络,100G 硬盘,16G 内存,4 vCPU,已装好可 SSH 登录

---

## 一、需求与最终规格

| 项目 | 要求 | 落地结果 |
|------|------|---------|
| 镜像 | `/home/maotuan/Downloads/Rocky-10.2-x86_64-minimal.iso` (2.0G) | 同左 |
| 网络 | NAT | libvirt `default` 网络 → `virbr0`,`192.168.122.0/24`,DHCP |
| 硬盘 | 100G | `rocky10.qcow2` 虚拟 100G,实际占用 1.4G |
| 内存 | 16G | 16777216 KiB |
| CPU | 4C | 4 vCPU,`host-passthrough` |
| 交付 | 可用 | root 密钥登录已实测通过 |

分区(BIOS 引导 + GPT):

```
vda1   1M    biosboot
vda2   1G    ext4   /boot
vda3   8G    swap
vda4   91G   xfs    /
```

---

## 二、整体思路

难点不在"装 ISO",而在**如何无人值守地装完**。整体分成 4 步:

```
① 准备      挂载 ISO → 取出 vmlinuz / initrd.img(直接内核引导用)
② 准备      写 kickstart → 打成 LABEL=OEMDRV 的 ISO 挂给 VM
③ 安装      手写 domain XML → virsh define/start → 安装器自动跑 ks
④ 收尾      改域 XML 为"从硬盘启动" → 重启 → 验证
```

两个关键决策:

**决策 1:直接内核引导(direct kernel boot),而不是 `virt-install --cdrom` 引导 ISO。**
`virt-install --location kernel=...,initrd=...` 会报
`location kernel/initrd may only be specified with a location URL/path`。
解决办法是手写 domain XML,直接指定 `<kernel>` / `<initrd>` / `<cmdline>`,
并在 cmdline 里用 `inst.stage2=hd:LABEL=...` 指向 ISO 里的 stage2 镜像。
好处:引导参数完全可控(串口重定向 `console=ttyS0,115200n8`),安装过程能实时看日志。

**决策 2:kickstart 用 `LABEL=OEMDRV` 的 ISO 交付,不用 HTTP。**
本来想让宿主机起个 HTTP 服务给安装器下载 ks,但那样会把目录暴露到网络上(哪怕只在
NAT 网段),不安全。改用 anaconda 原生支持的 `OEMDRV` 卷标机制:
把 `ks.cfg` 单独打成一个 ISO9660 镜像,卷标设为 `OEMDRV`,挂成第二块光驱,
dracut 会自动扫描并使用它。整个过程零网络暴露。

---

## 三、完整实施步骤

### 1. 环境检查

```bash
virsh --version                 # libvirt 12.0.0
virsh pool-list --all           # default(/var/lib/libvirt/images)、Downloads
virsh net-list --all            # default(virbr0, NAT)
qemu-img create -f qcow2 /var/lib/libvirt/images/rocky10.qcow2 100G
```

### 2. 从 ISO 取出内核和 initrd

直接内核引导需要 `vmlinuz` 和 `initrd.img` 两个文件。

**注意:Rocky 10 的 ISO 里这两个文件不在 `/boot` 下** —— 顶层 `/boot` 只有 `grub2/` 目录,
真正的引导文件在 **`images/pxeboot/`** 里。按 `/boot` 去 cp 会报
`No such file or directory`,这是第一次写自动化脚本时踩的坑。

```bash
mkdir -p /tmp/rockyiso && mount -o loop /home/maotuan/Downloads/Rocky-10.2-x86_64-minimal.iso /tmp/rockyiso
ls /tmp/rockyiso/boot            # 只有 grub2/
ls /tmp/rockyiso/images/pxeboot  # vmlinuz + initrd.img 在这
cp /tmp/rockyiso/images/pxeboot/vmlinuz    /var/lib/libvirt/boot/rocky10-vmlinuz
cp /tmp/rockyiso/images/pxeboot/initrd.img /var/lib/libvirt/boot/rocky10-initrd.img
umount /tmp/rockyiso
```

> `images/install.img` 里也有一个 `boot/vmlinuz-*`,但**没有 initrd**,不能拿来直接引导。

确认 ISO 卷标(后面 `inst.stage2` 要用):

```bash
blkid /home/maotuan/Downloads/Rocky-10.2-x86_64-minimal.iso
# LABEL="Rocky-10-2-x86_64-dvd"
```

### 3. 写 kickstart

见下方「五、RHEL10 kickstart 语法坑」,最终版 `/root/rocky-ks/rocky10.ks`:

```
text
reboot
lang en_US.UTF-8
keyboard us
timezone Asia/Shanghai
timesource --ntp-server time.cloudflare.com
selinux --enforcing
authselect --enforce
rootpw --lock
network --bootproto=dhcp --device=link --activate --onboot=on

zerombr
clearpart --all --initlabel
part biosboot --size=1 --fstype=biosboot
part /boot --fstype=ext4 --size=1024
part swap --fstype=swap --size=8192
part / --fstype=xfs --size=82000 --grow

bootloader --location=mbr --append="console=tty0 console=ttyS0,115200n8 net.ifnames=0 biosdevname=0"

%packages
@core
openssh-server
openssh-clients
sudo
vim-minimal
tmux
chrony
tar
less
man-pages
net-tools
lsof
NetworkManager
%end

%post --interpreter=/bin/bash
# ... 见下文 %post 小节
%end
```

`%post` 做的事(注意:**%post 的 chroot 就是目标系统根目录**,写文件用绝对路径即可):

```bash
# 0) 装 SSH 公钥
mkdir -p /root/.ssh && chmod 700 /root/.ssh
cat > /root/.ssh/authorized_keys <<'PUBKEY_EOF'
ssh-ed25519 AAAA...root@rocky10-vm
PUBKEY_EOF
chmod 600 /root/.ssh/authorized_keys

# 1) 允许 root 密码 + 公钥登录
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config

# 2) 首次开机的 oneshot 服务(firewalld / sshd 开机自启、restorecon)
#    —— %post 里 systemctl enable 不可用(chroot 无 dbus),所以留到首次开机做
cat > /etc/systemd/system/rocky10-firstboot.service <<'SVC_EOF'
[Unit]
Description=rocky10 first boot setup
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/rocky10-firstboot.sh
[Install]
WantedBy=multi-user.target
SVC_EOF
```

`rocky10-firstboot.sh` 内容:

```bash
#!/bin/bash
/usr/sbin/firewall-offline-cmd --add-service=ssh 2>/dev/null
/usr/sbin/firewall-offline-cmd --add-service=ping 2>/dev/null
[ -x /usr/sbin/restorecon ] && /usr/sbin/restorecon -RF /root/.ssh   # authorized_keys 需 ssh_home_t
systemctl enable sshd
systemctl enable chronyd
systemctl enable NetworkManager
systemctl enable firewalld 2>/dev/null
```

> `systemctl enable` 在 %post 的 chroot 里不工作(没有 dbus/systemd),
> 所以用 `ln -sf ... multi-user.target.wants/` 兜底。

### 4. 打成 OEMDRV ISO

```bash
mkdir -p /tmp/ksiso && cp /root/rocky-ks/rocky10.ks /tmp/ksiso/ks.cfg
xorriso -as mkisofs -volid OEMDRV -joliet -rock \
  -output /var/lib/libvirt/images/rocky10-ks.iso /tmp/ksiso/ks.cfg
```

### 5. 写 domain XML(安装态)

完整文件 `/root/rocky-ks/rocky10.xml`,关键片段:

```xml
<domain type='kvm'>
  <name>rocky10</name>
  <memory unit='MiB'>16384</memory>
  <currentMemory unit='MiB'>16384</currentMemory>
  <vcpu placement='static'>4</vcpu>
  <os>
    <type arch='x86_64' machine='q35'>hvm</type>
    <kernel>/var/lib/libvirt/boot/rocky10-vmlinuz</kernel>
    <initrd>/var/lib/libvirt/boot/rocky10-initrd.img</initrd>
    <cmdline>inst.stage2=hd:LABEL=Rocky-10-2-x86_64-dvd inst.text console=ttyS0,115200n8 no_timer_check</cmdline>
    <boot dev='hd'/>
  </os>
  <cpu mode='host-passthrough' check='none'>
    <topology sockets='1' dies='1' clusters='1' cores='4' threads='1'/>
  </cpu>
  <devices>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2' cache='writeback'/>
      <source file='/var/lib/libvirt/images/rocky10.qcow2'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <source file='/home/maotuan/Downloads/Rocky-10.2-x86_64-minimal.iso'/>
      <target dev='sda' bus='sata'/>
      <readonly/>
    </disk>
    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <source file='/var/lib/libvirt/images/rocky10-ks.iso'/>
      <target dev='sdb' bus='sata'/>
      <readonly/>
    </disk>
    <controller type='usb' model='qemu-xhci' ports='15'/>
    <controller type='pci' model='pcie-root'/>
    <controller type='pci' model='pcie-root-port'/>   <!-- 这类 pcie-root-port 要 15 个 -->
    <controller type='sata' index='0'/>
    <controller type='virtio-serial' index='0'/>
    <interface type='network'>
      <source network='default'/>
      <model type='virtio'/>
    </interface>
    <serial type='file'>
      <source path='/var/log/libvirt/rocky10-install.log'/>
      <target type='isa-serial' port='0'><model name='isa-serial'/></target>
    </serial>
    <graphics type='vnc' port='-1' autoport='yes' listen='127.0.0.1'/>
    <video><model type='qxl' ram='65536' vram='16384' vgamem='16384' heads='1' primary='yes'/></video>
    <memballoon model='virtio'/>
  </devices>
</domain>
```

> **q35 的坑**:直接手写 `machine='q35'` 会报
> `Machine type 'pc-q35' supports PCI but no PCI controller added.`
> 补 `<controller type='pci' model='pcie-root'/>` + 15 个 `pcie-root-port` 才行。
> 最省事的办法是让 libvirt 自己生成一份模板再改:
> `virt-install --print-xml --dry-run ... > baseline.xml`,照抄它的结构。

### 6. 安装

```bash
virsh define /root/rocky-ks/rocky10.xml
virsh start rocky10
tail -f /var/log/libvirt/rocky10-install.log      # 实时看安装过程
```

安装器在文本模式跑完,日志尾部出现:

```
Complete! Installation complete
```

### 7. 改从硬盘启动(最容易忘的一步)

安装器结束后会 **reboot**,但此时域仍是"直接内核引导"配置,
reboot 会**重新进入安装器**,而不是进已装好的系统。

必须:停机 → 去掉 `<kernel>/<initrd>/<cmdline>` → 摘掉两个光驱 → `<boot dev='hd'/>` → 重新 define。

最终态 `/root/rocky-ks/rocky10-final.xml` 与安装态的差异:

```diff
  <os>
    <type arch='x86_64' machine='q35'>hvm</type>
-   <kernel>...</kernel>
-   <initrd>...</initrd>
-   <cmdline>inst.stage2=...</cmdline>
    <boot dev='hd'/>
  </os>
- <disk type='file' device='cdrom'> ... Rocky-10.2-x86_64-minimal.iso ... </disk>
- <disk type='file' device='cdrom'> ... rocky10-ks.iso ... </disk>
```

顺带把串口从"写日志文件"改成 **pty**,这样 `virsh console rocky10` 才是可交互的
(写文件的 console 只能看日志,没法登录):

```diff
- <serial type='file'><source path='/var/log/libvirt/rocky10-install.log'/>...
+ <serial type='pty'><target type='isa-serial' port='0'><model name='isa-serial'/></target></serial>
- <console type='file'><source path='/var/log/libvirt/rocky10-install.log'/>...
+ <console type='pty'><target type='serial' port='0'/></console>
```

### 8. 验证

```bash
virsh net-dhcp-leases default          # 看到 192.168.122.155
virsh domifaddr rocky10
ssh -i /root/rocky-ks/id_ed25519 root@192.168.122.155 'hostname; nproc; free -g; lsblk'
```

---

## 四、踩坑记录(共 4 次失败安装)

| # | 现象 | 根因 | 修法 |
|---|------|------|------|
| 1 | 解析 ks 报 4 处语法错,安装器直接终止 | RHEL10 删改了 pykickstart 指令 | 见下方第五节 |
| 2 | `Your BIOS-based system needs a special partition to boot from a GPT disk label` | BIOS 引导 + GPT 缺 biosboot | 加 `part biosboot --size=1 --fstype=biosboot` |
| 3 | `Process reported exit code 1: mke2fs: invalid option -- 'f'` | e2fsprogs 1.47.1 的 `mke2fs` 没有小写 `-f` | 去掉 `--mkfsoptions="-f"`(全新分区本来也不需要) |
| 4 | 安装成功但 **SSH 密钥登录失败** | `%pre` 写的公钥文件没进目标系统 | 见下方第六节 |

### 快速迭代:本地校验 kickstart

每次 boot 要 5 分钟,语法错要等一轮才发现,太慢。做法是把安装器里的 pykickstart
抠出来本地跑:

```python
from pykickstart.parser import KickstartParser
from pykickstart.version import makeVersion
p = KickstartParser(makeVersion("RHEL10"))
p.readKickstart("/root/rocky-ks/rocky10.ks")
print("OK")
```

改完立刻能知道有没有语法错。

---

## 五、RHEL10 kickstart 语法坑

RHEL 10 的 pykickstart 比老版本严格很多,以下写法会直接让安装器终止:

| 老写法 | RHEL10 正确写法 | 原因 |
|--------|-----------------|------|
| `selinux enforcing` | `selinux --enforcing` | 裸参数被移除 |
| `timezone Asia/Shanghai --ntpservers=...` | `timezone Asia/Shanghai` + `timesource --ntp-server ...` | `RHEL10_Timezone` 删掉了 `--ntpservers/--nontp/--isUtc` |
| `%packages --nobase` | 直接 `%packages` | `op.remove_argument("--nobase", version=F22)` |
| `network ... --no-activate=off` | 去掉该参数 | `--no-activate` 不带值 |

另外两个包相关的注意点:

* `bind-utils` **不在 Minimal 仓库里**,装了会报缺包 → 去掉,改用 `net-tools`。
* Minimal ISO 自带 670 个包,`base`(28 个必装)+ `core`(46 个必装)都能从 ISO 内
  的 Minimal 仓库解析出来,**不需要配网络源**。用 `dnf` 校验过 74 个必装包 0 缺失。

---

## 六、最大的坑:`%pre` 写的公钥没落地

现象:安装 100% 成功,`/root/.ssh/` 目录**存在**且权限是 700(证明 `mkdir` 生效了),
但目录**是空的**,`authorized_keys` 根本没有;`find` 全盘也没有。

排查过程:

```bash
# 1) 看安装器到底执行了 %pre 没有
grep -a "ks-script\|%pre" /var/log/anaconda/anaconda.log
#   INF kickstart.script: Running kickstart %%pre script(s)
#   INF kickstart.script: All kickstart %%pre script(s) have been run   ← 报告"成功"
grep -a "Executing script" /var/log/anaconda/program.log
#   INF program: Running... /bin/bash /tmp/ks-script-n8o47_zf

# 2) 脚本日志是 0 字节 —— 连一行错误输出都没有
ls -l /var/log/anaconda/ks-script-*.log    # 0

# 3) 安装器收到的 ks 内容是对的
grep -A20 "%pre" /root/anaconda-ks.cfg      # 原文完整
```

即:**anaconda 认为 %pre 成功执行了,但文件没进目标系统**。
结论:在 RHEL10 上 `%pre` 里通过 `/sysroot/...` 写目标文件不可靠(大概率写进了
安装器自己的 chroot 环境,重启即丢),anaconda 也不报错。

**修法一(曾经以为的正解)**:把公钥写入从 `%pre` 挪到 `%post` —— `%post` 的 chroot 就是目标
系统根目录,写 `/root/.ssh/authorized_keys` 即可。

> ⚠️ **2026-10-28 更正:`%post` 同样不保证落地,全新安装后必须补一次离线修复。**
>
> 用 `kvm.sh` 做了两次全新安装(app01、rocky10-2),kickstart 内容完全正确、
> 分区完全按 ks 建好、包也装齐了,但 `%post` 的产物**一件都没进目标系统**:
> `/root/.ssh/` 是空的、`/etc/hostname` 没有、`rocky10-firstboot.service` 没有、
> `/var/log/anaconda/` 没有、`/etc/ssh/ssh_host_*` 主机密钥也没有。
> 两次的表现还不一样:app01 的安装器跑完了整个任务队列(串口能看到
> "Running post-installation scripts" 和 "Complete!"),产物照样没落地;
> rocky10-2 更早,在 "Configuring installed system" 之后串口就没输出了。
>
> 对照组:同一个 minimal ISO、同一份 ks、10-26 那次**手工**安装(rocky10 模板)是成功的
> —— 模板的 `/root/.ssh/authorized_keys` 是 11:52 补的(安装结束于 11:46),
> 也就是说模板的公钥同样是后补的,`%post` 从来没靠得住过。
>
> 结论:**不要假设 `%post` 生效**。全新安装后一律补一次离线修复(第六之三节),
> 这步现在是 `kvm.sh` 的 `customize_guest()` 自动做的。

**修法二(补救已装好的机器)**:离线挂盘直接补文件 + 补 SELinux 标签。

```bash
virsh shutdown rocky10
modprobe nbd max_part=16
qemu-nbd --connect=/dev/nbd0 /var/lib/libvirt/images/rocky10.qcow2
mkdir -p /mnt/rockyroot && mount /dev/nbd0p4 /mnt/rockyroot

install -d -m 700 /mnt/rockyroot/root/.ssh
cat /root/rocky-ks/id_ed25519.pub > /mnt/rockyroot/root/.ssh/authorized_keys
chmod 600 /mnt/rockyroot/root/.ssh/authorized_keys

# SELinux 标签必须是 ssh_home_t,否则 sshd 读不了
chroot /mnt/rockyroot /usr/sbin/restorecon -RF /root/.ssh
# 若 restorecon 在 chroot 里不生效,直接写 xattr:
python3 -c "import os;os.setxattr('/mnt/rockyroot/root/.ssh/authorized_keys','security.selinux',b'system_u:object_r:ssh_home_t:s0\0')"

umount /mnt/rockyroot && qemu-nbd --disconnect /dev/nbd0
virsh start rocky10
```

> **SELinux 标签是必须的**。补完文件后 `ls -Z` 显示 `unlabeled_t` 时 SSH 会认证失败,
> 在**运行中的系统内**再跑一次 `restorecon -RF /root/.ssh` 才变回 `ssh_home_t`。

---

## 六之二、克隆模式的三个坑(离线改盘)

把装好的机器复制一份 qcow2 出来做"黄金模板",之后按需克隆,比每次重装快一个数量级。
但**克隆不是简单 cp**,离线改盘时有三个坑,每一个都表现为"虚拟机起来了但连不上"。

### 坑 1:不能删 `/etc/machine-id`,只能换一个新的

常见的做法是 `rm -f /etc/machine-id` 让 systemd 开机重新生成。**在 Rocky 10 上这样做的后果是:
虚拟机能启动,但 NetworkManager 根本不会启动,DHCP 请求一次都不发**,
表现就是 `virsh net-dhcp-leases default` 里永远看不到这台机器的 MAC。

systemd 拿不到 machine-id 就没法给 DHCP 客户端生成 DUID,网络栈直接卡死。
正确做法是离线生成一个新的合法 machine-id(32 位十六进制):

```bash
NEWID=$(cat /proc/sys/kernel/random/uuid | tr -d '-')   # 正好 32 位小写 hex
printf '%s' "$NEWID" > /mnt/etc/machine-id
chmod 0444 /mnt/etc/machine-id
ln -sf /etc/machine-id /mnt/var/lib/dbus/machine-id
```

### 坑 2:离线新建的文件没有 SELinux 标签,sshd 会直接启动失败

宿主机是 Ubuntu,没启用 SELinux,chroot 里跑 `restorecon` 必然失败(没有 `/sys/fs/selinux` 策略)。
于是离线 `ssh-keygen -A` 生成的新宿主密钥是**完全无标签**的,sshd 以 `sshd_t` 运行读不到它,
`sshd.service` 直接启动失败 —— 现象是 22 端口拒绝连接、DHCP 却正常。

排查办法是直接读 xattr 对比:

```bash
python3 -c "import os;print(os.getxattr('/mnt/etc/ssh/ssh_host_ed25519_key','security.selinux'))"
# 无标签 → Errno 61 No data available
```

解决:离线直接写 `security.selinux` 扩展属性。类型名可以从**模板机(原始系统)**上抄:

| 文件 | SELinux 类型 |
|------|-------------|
| `/etc/ssh/ssh_host_*_key(.pub)` | `sshd_key_t` |
| `/root/.ssh/` 与 `authorized_keys` | `ssh_home_t` |
| `/etc/machine-id` | `machineid_t` |
| `/etc/hostname` | `hostname_etc_t` |
| `/etc/hosts` | `net_conf_t` |
| `/etc/NetworkManager/system-connections/*` | `NetworkManager_etc_rw_t` |

```bash
python3 - <<'EOF'
import os
os.setxattr("/mnt/etc/ssh/ssh_host_ed25519_key",
            "security.selinux", b"system_u:object_r:sshd_key_t:s0\0")
EOF
```

### 坑 3:扩分区不能重建分区表

虚拟磁盘从 100G 扩到 150G 时,必须保住分区表的**分区 unique GUID**:

```bash
# 先把 GPT 备份头移到磁盘末尾,否则 parted 认为空间没用完会拒绝 resizepart
sgdisk -e /dev/nbd0
# 用 resizepart 原地扩 —— 绝不能用 sgdisk -d/-n 重建,那会换掉 unique GUID
parted -s /dev/nbd0 resizepart 4 100%
partprobe /dev/nbd0
```

**为什么这么在意**:BIOS 引导的 GRUB 是按分区 GUID 找根分区的,
GUID 一变就开不了机(表现为 GRUB 菜单还在,一选就进 rescue)。

另外**顺序**也有讲究:必须**先改分区表再挂载**。先挂载再改分区表会触发内核的
partition rescan,把已经挂载的文件系统打成 I/O error。

---

## 六之三、全新安装后必做的离线修复(2026-10-28 补)

`%post` 不可靠(见上一节),所以全新安装完**一定要**补一次离线修复,
否则虚拟机起来了但 SSH 连不上。`kvm.sh` 里这一步就是 `customize_guest()`。

### 症状对照

| 现象 | 真正的原因 |
|------|-----------|
| ping 得通,SSH 报 `Connection refused` | **没有 `/etc/ssh/ssh_host_*` 主机密钥**,sshd 起不来(不是防火墙丢包,是被拒) |
| 主机名显示 `localhost` | `/etc/hostname` 没写进去 |
| `sshd` 一直 `activating` / 起不来 | 主机密钥缺失,或缺 `sshd_key_t` 标签 |
| 公钥登录被拒 | `authorized_keys` 不存在,或缺 `ssh_home_t` 标签 |
| 能登进去但**任何写入**都报 `Read-only file system` | `/etc/fstab` 标签是 `root_t` → `systemd-remount-fs` 读不到 → 根一直是 ro(见本节末尾) |

### 修复步骤(等价于 `kvm.sh` 的 `customize_guest()`)

```bash
# 1. 停机并挂盘
virsh destroy rocky10-2
modprobe nbd max_part=16
qemu-nbd --connect=/dev/nbd0 /var/lib/libvirt/images/rocky10-2.qcow2
mkdir -p /mnt/g && mount /dev/nbd0p4 /mnt/g      # root 是 xfs

# 2. 主机密钥:用 guest 自带的 ssh-keygen 生成(chroot 里跑,需要 /dev/urandom)
mount --bind /dev /mnt/g/dev
mount -t proc proc /mnt/g/proc
chroot /mnt/g /usr/bin/ssh-keygen -A            # ← 没有这一步,sshd 根本起不来
umount /mnt/g/proc; umount /mnt/g/dev

# 3. root 公钥 + 主机名 + sshd_config
install -d -m 700 /mnt/g/root/.ssh
cat /root/rocky-ks/keys/rocky10-2_id_ed25519.pub > /mnt/g/root/.ssh/authorized_keys
chmod 600 /mnt/g/root/.ssh/authorized_keys
echo rocky10-2 > /mnt/g/etc/hostname
sed -i 's/^[#[:space:]]*PermitRootLogin.*/PermitRootLogin yes/' /mnt/g/etc/ssh/sshd_config
grep -q '^PermitRootLogin yes' /mnt/g/etc/ssh/sshd_config || echo 'PermitRootLogin yes' >> /mnt/g/etc/ssh/sshd_config

# 4. SELinux 标签(宿主机没启用 SELinux,chroot 里 restorecon 一定失败,只能手写 xattr)
python3 - <<'PY'
import os
L={'/etc/ssh/ssh_host_rsa_key':'sshd_key_t','/etc/ssh/ssh_host_rsa_key.pub':'sshd_key_t',
   '/etc/ssh/ssh_host_ecdsa_key':'sshd_key_t','/etc/ssh/ssh_host_ecdsa_key.pub':'sshd_key_t',
   '/etc/ssh/ssh_host_ed25519_key':'sshd_key_t','/etc/ssh/ssh_host_ed25519_key.pub':'sshd_key_t',
   '/root/.ssh':'ssh_home_t','/root/.ssh/authorized_keys':'ssh_home_t',
   '/etc/hostname':'hostname_etc_t','/etc/machine-id':'machineid_t'}
for p,t in L.items():
    fp='/mnt/g'+p
    if os.path.lexists(fp):
        os.setxattr(fp,'security.selinux',('system_u:object_r:%s:s0\0'%t).encode())
PY

# 5. 首次开机服务(放行 ssh + 开机用系统自带 restorecon 兜底)
#    /etc/systemd/system/rocky10-firstboot.service  +  /usr/local/sbin/rocky10-firstboot.sh
#    并做软链: /etc/systemd/system/multi-user.target.wants/rocky10-firstboot.service

umount /mnt/g && qemu-nbd --disconnect /dev/nbd0
virsh start rocky10-2
```

> **注意 `machine-id`**:只能**换一个新的**,不能删。删了 `/etc/machine-id`
> 会让 NetworkManager 起不来(没有 DUID),表现为能开机但拿不到 DHCP 地址。

### 另一个坑:安装态切磁盘态时会把安装器再跑一遍

```bash
virsh destroy rocky10-2      # ← destroy 之后域还在 "shutting off"
virsh undefine rocky10-2     # ← 这里会失败(域还在 running)
virsh define disk.xml        # ← 这里报 "already exists with uuid"
virsh start rocky10-2       # ← 于是把**安装态**域又拉起来了 → 安装器重跑
```

后果:安装日志里出现**第二次 `inst.stage2=...` 启动**,磁盘被第二次安装搅乱。
修法:destroy 之后**等域彻底变成 `shut off`** 再 undefine/define,
并且 define 之后校验磁盘态 XML 里已经没有 `<cmdline>`。
`kvm.sh` 里的 `domain_stop()` 就是干这个的。

### 第三个坑:根文件系统是只读的 —— "Read-only file system"(2026-10-28)

**症状**:SSH 能登进去,`ls`、`cat` 都正常,但**任何写操作**都失败:

```console
# vi /etc/ssh/sshd_config
-bash: /etc/ssh/sshd_config: Read-only file system
```

**诊断**:

```bash
findmnt -no SOURCE,FSTYPE,OPTIONS /        # → /dev/vda4 xfs ro,...  ← 根是只读的
systemctl status systemd-remount-fs.service # → failed
journalctl -b -u systemd-remount-fs.service
#   rocky10-2 systemd-remount-fs[672]: Failed to open /etc/fstab: Permission denied
ls -Z /etc/fstab                            # → system_u:object_r:root_t:s0  ← 标签错了
```

**根因**(两层):

1. anaconda 的 **"Set file contexts"(SELinux 重打标签)步骤没落地** ——
   和 `%post` 一样,安装器跑完了但产物没进目标系统。
   于是安装期新建的文件留着**安装环境的默认标签 `root_t`**
   (实测就 12 个:`/etc/fstab`、`/etc/crypttab`、`/etc/resolv.conf`、
   `/etc/nvme/host{nqn,id}`、`/var/lib/dnf/history.sqlite*`,以及 `/tmp`)。
   注意:`root_t` 本身不是"未打标签",它是**打错了标签**,比 unlabeled 更隐蔽。
2. 根分区是用 `ro` 挂载的,**由 `systemd-remount-fs.service` 负责翻成 rw**。
   这个服务跑在受限域里,被 SELinux 挡住读 `root_t` 的 `/etc/fstab`
   → `Permission denied` → 服务失败 → **根永远只读**。

> 所以这个坑的迷惑性在于:**SSH 是通的**(sshd 的配置文件标签是对的),
> firewalld 也正常,唯独写不了文件。很多人会怀疑磁盘满了或者 SELinux 全局关了。

**修法**:先把 `/` 翻回可写,再用**虚机自带的** `restorecon` 全盘修正标签
(宿主机没有 SELinux,chroot 里的 `restorecon` 一定失败,只能借虚机的策略):

```bash
# 在虚机里(root 用户)
mount -o remount,rw /                    # XFS 日志干净,直接就能翻
restorecon -RF -x /                      # 修正根文件系统上的标签
restorecon -RF -x /boot                  # /boot 是独立挂载点
systemctl restart systemd-remount-fs.service
```

或者**离线**在宿主机上改(必须先 `virsh destroy`,再用 qemu-nbd 挂载):

```bash
virsh destroy rocky10-2
qemu-nbd --connect=/dev/nbd0 /var/lib/libvirt/images/rocky10-2.qcow2
mount /dev/nbd0p4 /mnt/g
python3 - <<'PY'
import os
for p,t in {'/etc/fstab':'etc_t','/etc/crypttab':'etc_t','/etc/resolv.conf':'net_conf_t'}.items():
    fp='/mnt/g'+p
    if os.path.lexists(fp):
        os.setxattr(fp,'security.selinux',('system_u:object_r:%s:s0\0'%t).encode())
PY
umount /mnt/g && qemu-nbd --disconnect /dev/nbd0
virsh start rocky10-2
```

**`kvm.sh` 里的自动化**:

- `customize_guest()` 离线就把 `/etc/fstab`、`/etc/crypttab` 打成 `etc_t`、
  `/etc/resolv.conf` 打成 `net_conf_t` —— 开机时 `systemd-remount-fs` 就能读到 fstab,
  根直接就是 rw;
- 同时 `rocky10-firstboot.service` 里加了兜底:
  发现 `/` 是 ro 就 `mount -o remount,rw /`,再 `restorecon -RF -x /` 全盘修标签,
  最后 `systemctl restart systemd-remount-fs.service` 让状态归位。

> **教训**:anaconda 的任务队列里,**"Set file contexts" 这一步和 `%post` 一样不可靠**。
> 凡是"标签不对 → 服务被 SELinux 拒 → 连锁失败"的症状,
> 第一反应应该是"安装期新建的文件标签没落地",而不是去关 SELinux。

### 第四个坑:重建之后 virt-manager 里"看不到"这台机器(2026-10-28)

**症状**:`virsh list --all` 里明明有,SSH 也通,但 **virt-manager(VMM)的列表里没有这台机器**。

**诊断**(看 VMM 的日志,`~/.cache/virt-manager/virt-manager.log`):

```bash
grep -i "rocky10-2" ~/.cache/virt-manager/virt-manager.log | tail
# Error refreshing <vmmDomain name=rocky10-2> from events:
#   Domain not found: no domain with matching uuid '96a02716-...' (rocky10-2)
```

对照一下三个 UUID 就明白了:

| 时刻 | 域的 UUID | VMM 记着的 |
|---|---|---|
| 旧机器被删 | `bbde38ba…` | `bbde38ba…` ✓ |
| 重建,define 安装态 | `96a02716…` | `96a02716…` |
| 装完 undefine+define 磁盘态 | **`4bcdbcec…`** | 仍是 `96a02716…` ✗ |

**根因**:安装完之后要把域从"安装态"换成"磁盘态",做法是
`virsh undefine` 旧的 + `virsh define` 新的。
**如果 domain XML 里不写 `<uuid>`,libvirt 每次 define 都随机生成一个**,
于是同一台机器前后两个域的 UUID 就不一样了。
virt-manager 这类工具是**按 UUID 认域**的,撞上"同名换 UUID"的切换就会留下悬空对象,
界面上这台机器就"消失"了 —— 而 `virsh list` 一切正常,SSH 也照连。

**修法**:

1. **临时**:VMM 里右键连接 → "断开连接" → 再双击连上,重新枚举即可
   (新开一个 VMM 进程也一样)。或者直接重启 virt-manager。
2. **根治**:让 XML 里带一个**稳定的 `<uuid>`**,安装态和磁盘态用同一个,
   重建时也沿用同一个 —— 这样域对 VMM 来说从头到尾是"同一个域",永远不会失联。
   `kvm.sh` 的做法是:

```bash
# 由域名推导一个稳定 UUID,并记在 vms/.uuid-<name> 里(recycle 不删这个文件),
# 重建时沿用 —— 于是同一台机器的 UUID 永不变。
stable_uuid() {
    local name=$1 h
    h=$(printf '%s' "$name" | md5sum | cut -c1-32)
    printf '%s-%s-%s-%s-%s' "${h:0:8}" "${h:8:4}" "${h:12:4}" "${h:16:4}" "${h:20:12}"
}
pick_uuid() {
    # 注意:local 的多个赋值是"先全部展开再依次赋值",不能写成
    # local name=$1 f="...$name..." —— 那样 $name 还是外层的空值。必须拆开。
    local name=$1
    local f="$REG_DIR/.uuid-$name"
    mkdir -p "$REG_DIR"
    if [[ -s $f ]]; then cat "$f"; else
        local u; u=$(stable_uuid "$name"); echo "$u" > "$f"; echo "$u"
    fi
}
```

> 顺便一提:libvirt **不允许**修改已存在域的 UUID
> (`virsh define` 会报 `domain 'x' already exists with uuid ...`),
> 所以只能在建域的时候就把 UUID 定好。

---

## 七、连接方式

### rocky10-2(2026-10-28 用本文流程全新安装出来的那台)

```bash
ssh -o UserKnownHostsFile=/root/rocky-ks/known_hosts \
    -o StrictHostKeyChecking=yes \
    -i /root/rocky-ks/keys/rocky10-2_id_ed25519 \
    root@192.168.122.56
```

> `known_hosts` 里是 `ssh-keyscan -H 192.168.122.56` 抓下来的指纹
> (首次装机时主机密钥是离线生成的,之后不会再变)。
> 不要用 `StrictHostKeyChecking=no` —— 在受管环境下会被安全策略直接拒掉。
> 脚本封装:`/root/rocky-ks/kvm.sh connect rocky10-2`
> (内部用 `StrictHostKeyChecking=accept-new` + 同一个 known_hosts)。
>
> **IP 会变**:重建一次机器,DHCP 分配的地址就可能不一样,
> 用 `virsh domifaddr rocky10-2` 或 `kvm.sh list` 现查。
> 换了 IP 之后旧指纹还在 known_hosts 里,先 `ssh-keygen -R <旧IP>` 清掉再连。

### 早期那台 rocky10(模板克隆出来的)

```bash
# SSH(推荐)
ssh -i /root/rocky-ks/id_ed25519 root@192.168.122.155

# 封装脚本 /root/rocky-ks/connect.sh
/root/rocky-ks/connect.sh              # SSH
/root/rocky-ks/connect.sh --console    # 串口控制台

# 控制台(Ctrl+] 退出)
virsh console rocky10
```

**root 密码是锁定的**(`rootpw --lock`),当前只能密钥登录。设密码:

```bash
ssh -i /root/rocky-ks/id_ed25519 root@192.168.122.155
passwd root
```

**从局域网其他机器访问**:NAT 网段只在宿主机内部可见,跨机需要端口转发,例如宿主机上:

```bash
socat TCP-LISTEN:2222,fork,reuseaddr TCP:192.168.122.155:22
# 其他机器: ssh -i id_ed25519 -p 2222 root@<宿主机IP>
```

---

## 八、常用运维命令

```bash
virsh list --all                # 状态
virsh start rocky10             # 开机
virsh shutdown rocky10          # 优雅关机(走 ACPI)
virsh destroy rocky10           # 强制断电
virsh console rocky10           # 控制台
virsh dumpxml rocky10           # 当前域配置
virsh net-dhcp-leases default   # DHCP 租约
virsh domifaddr rocky10         # VM 的 IP
```

虚拟磁盘扩容 / 快照:

```bash
qemu-img resize /var/lib/libvirt/images/rocky10.qcow2 +20G
virsh resize2fs rocky10 vda4          # 文件系统需在线扩,或用 growpart + xfs_growfs
```

---

## 九、工作流脚本 `kvm.sh`(创建 / 克隆 / 回收)

上面所有手工步骤都固化成了 **`/root/rocky-ks/kvm.sh`**,
一条命令就能"开一台新机器"或"把一台机器彻底回收"。

### 用法速查

```bash
cd /root/rocky-ks

# ① 从黄金模板克隆一台(最快,约 5 分钟)
./kvm.sh create --name web01 --mode clone --size 150G --memory 16G --cpus 4

# ② 从 ISO 全新安装一台(约 8 分钟)
./kvm.sh create --name app01 --mode install --size 100G --memory 16G --cpus 4

# ③ 指定静态 IP
./kvm.sh create --name db01 --mode clone --ip 192.168.122.201

# ④ 回收(删域定义 + 磁盘 + 专属产物 + 释放 DHCP 租约)
./kvm.sh recycle web01
./kvm.sh recycle web01 --yes      # 不交互
./kvm.sh recycle web01 --purge    # 先 shred 再删

# ⑤ 查看 / 连接
./kvm.sh list
./kvm.sh connect web01
./kvm.sh connect web01 --console
./kvm.sh template rocky10         # 把某台机器做成黄金模板
```

### 脚本内部做了什么

**clone 模式**(以 `rocky10-template.qcow2` 为源):

1. `qemu-img create -f qcow2` 建目标盘,再 `qemu-img convert` 从模板复制
2. `qemu-img resize` 扩到目标容量
3. `qemu-nbd --connect` 挂载磁盘,离线定制:
   `sgdisk -e` → `parted resizepart` → `xfs_growfs`(保住分区 unique GUID)
4. 换主机名、换 machine-id、重新生成 SSH 宿主密钥、写入本机专属公钥
5. 离线补 SELinux 标签(`sshd_key_t` / `ssh_home_t` / `machineid_t` …)
6. `virsh define` + `virsh start`,然后等 DHCP、再等 SSH 真的能登录

**install 模式**:

1. 从 ISO `images/pxeboot/` 提取 `vmlinuz` + `initrd.img`(按 ISO 指纹缓存复用)
2. 生成 kickstart → 打成 `LABEL=OEMDRV` 的 ISO
3. 安装态 XML(直接内核引导 + 串口日志落 `/var/log/libvirt/<name>-install.log`)
4. 等安装器跑完 → **undefine 再 define** 磁盘态 XML → 从硬盘重启

> 坑:安装态和磁盘态是两份 XML、UUID 不同,直接 `virsh define` 会报
> `domain 'xxx' already exists with uuid ...`,必须先 `virsh undefine`。

### 目录约定

| 路径 | 说明 |
|------|------|
| `/root/rocky-ks/kvm.sh` | 工作流脚本本体 |
| `/root/rocky-ks/vms/<name>.env` | 每台虚拟机的注册表(磁盘/密钥/MAC/IP…) |
| `/root/rocky-ks/keys/<name>_id_ed25519` | 每台虚拟机**专属**的 SSH 私钥 |
| `/root/rocky-ks/xml/<name>.xml` | 生成的 domain XML |
| `/var/lib/libvirt/images/<name>.qcow2` | 系统盘 |
| `/var/lib/libvirt/images/rocky10-template.qcow2` | 黄金模板(**回收时不会删**) |

**每台机器一把独立密钥**:克隆体不共用主机密钥,也不会互相撞 SSH 指纹;
`recycle` 时连同私钥一起删。

---

## 十、产物清单

| 路径 | 说明 |
|------|------|
| `/root/rocky-ks/kvm.sh` | **工作流脚本**(创建/克隆/回收) |
| `/root/rocky-ks/rocky10.ks` | kickstart(已修正版) |
| `/root/rocky-ks/rocky10.xml` | 安装态 domain XML |
| `/root/rocky-ks/rocky10-final.xml` | **当前生效**的 domain XML(从硬盘启动 + pty 控制台) |
| `/root/rocky-ks/id_ed25519` | SSH 私钥(root 用) |
| `/root/rocky-ks/connect.sh` | 连接封装脚本 |
| `/root/rocky-ks/vms/`, `/root/rocky-ks/keys/` | 虚拟机注册表 / 每机专属密钥 |
| `/var/lib/libvirt/images/rocky10.qcow2` | 100G 系统盘 |
| `/var/lib/libvirt/images/rocky10-template.qcow2` | 黄金模板(克隆源,回收时保留) |
| `/var/lib/libvirt/images/rocky10-ks.iso` | LABEL=OEMDRV 的 kickstart ISO |
| `/var/lib/libvirt/boot/rocky10-vmlinuz`<br>`/var/lib/libvirt/boot/rocky10-initrd.img` | 从 Rocky ISO 提取的引导文件 |

---

## 十一、一句话经验

> **无人值守装 ISO 的三个决定性因素**:
> ① 引导方式(直接内核引导,能精确控制 cmdline 并看串口日志);
> ② ks 交付方式(`LABEL=OEMDRV` 的 ISO,零网络暴露);
> ③ **装完一定要核对产物是否真的落地**。
>
> ③ 这一条是 2026-10-28 补上的,代价很大:
> `%pre` 写 `/sysroot` 会静默丢失(早就知道),
> **但 `%post` 一样不保证落地** —— 实测两次全新安装,`%post` 的产物一件都没进目标系统,
> 最要命的是 `/etc/ssh/ssh_host_*` 主机密钥缺失,于是 sshd 起不来,
> 表现为"ping 得通但 SSH connection refused"(很容易误判成防火墙问题)。
>
> 所以:**全新安装 = 安装 + 一次离线修复**,离线修复已经是 `kvm.sh` 的
> `customize_guest()` 自动做的一步,不要指望 kickstart 一步到位。
>
> 另外:**本地用 pykickstart 校验 ks** + **装完立刻核对产物是否存在**,
> 能把 5 分钟一轮的试错变成秒级反馈。
