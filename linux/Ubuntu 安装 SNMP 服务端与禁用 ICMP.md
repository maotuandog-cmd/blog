# Ubuntu 安装 SNMP 服务端与禁用 ICMP

适用版本:Ubuntu 20.04 / 22.04 / 24.04 (基于 systemd 与 netfilter)
文档日期:2026-09-04

================================================================
一、SNMP 服务端安装与配置
================================================================

1.1 安装 snmpd 守护进程
----------------------------------------
sudo apt update
sudo apt install -y snmpd snmp

说明:
  snmpd   - SNMP 代理/服务端进程
  snmp    - 客户端命令行工具(snmpwalk / snmpget),用于本地测试

1.2 备份默认配置
----------------------------------------
sudo cp /etc/snmp/snmpd.conf /etc/snmp/snmpd.conf.bak
sudo cp /etc/default/snmpd /etc/default/snmpd.bak

1.3 配置 SNMPv3 用户认证(推荐,生产环境不用 v2c community)
----------------------------------------
停止服务:
  sudo systemctl stop snmpd

使用 net-snmp-create-v3-user 工具创建用户(交互式):
  sudo net-snmp-create-v3-user -ro -A "AuthPass123" -X "PrivPass123" -a SHA -x AES snmpuser

参数说明:
  -ro          只读用户
  -A           认证密码(至少 8 位)
  -X           隐私(加密)密码(至少 8 位)
  -a SHA       认证算法:SHA / SHA-224 / SHA-256 / SHA-384 / SHA-512
  -x AES       加密算法:AES / AES-192 / AES-256(CFB128-AES-192/256)
  snmpuser     用户名(自定义)

该命令会自动把以下行写入 /etc/snmp/snmpd.conf:
  createUser snmpuser SHA "AuthPass123" AES "PrivPass123"
  rouser snmpuser

1.4 如使用 SNMPv2c(简单,内网监控常用)
----------------------------------------
编辑 /etc/snmp/snmpd.conf,新增或修改:
  rocommunity public 192.168.1.0/24

说明:
  rocommunity  只读 community
  public       community 字符串(建议改复杂)
  192.168.1.0/24  允许访问的网段,默认监听所有接口不安全

1.5 关键运行参数(/etc/default/snmpd)
----------------------------------------
默认 systemd 监听 127.0.0.1,需改为监听所有网卡(或指定 IP):
  sudo vi /etc/default/snmpd

修改/新增:
  SNMPDOPTS='-Lsd -Lf /dev/null -u snmp -g snmp -I -smux,mteTrigger,mteTriggerConf -p /run/snmpd.pid'

说明:
  -Lsd     日志输出到 systemd journal
  -Lf      日志输出到文件(/dev/null 表示关闭文件日志)
  -u/-g    运行用户/组
  -p       PID 文件路径

若要只监听特定 IP,可在 snmpd.conf 里加:
  agentaddress udp:161
  agentaddress udp:192.168.1.10:161

默认只允许 localhost 抓取本机指标,需放开:
  rocommunity public 192.168.1.0/24

1.6 启动并设置开机自启
----------------------------------------
sudo systemctl daemon-reload
sudo systemctl enable snmpd
sudo systemctl restart snmpd
sudo systemctl status snmpd

1.7 防火墙放行 UDP 161 端口
----------------------------------------
UFW:
  sudo ufw allow from 192.168.1.0/24 to any port 161 proto udp
  sudo ufw reload
  sudo ufw status

iptables:
  sudo iptables -A INPUT -p udp -s 192.168.1.0/24 --dport 161 -j ACCEPT
  sudo iptables-save | sudo tee /etc/iptables/rules.v4

1.8 验证
----------------------------------------
本机测试(SNMPv3):
  snmpwalk -v3 -u snmpuser -l authPriv -a SHA -A "AuthPass123" -x AES -X "PrivPass123" 127.0.0.1 .1.3.6.1.2.1.1.1

本机测试(SNMPv2c):
  snmpwalk -v2c -c public 127.0.0.1 .1.3.6.1.2.1.1.1

返回 sysDescr 字符串即正常。

远端测试:
  snmpwalk -v3 -u snmpuser -l authPriv -a SHA -A "AuthPass123" -x AES -X "PrivPass123" <server_ip> .1.3.6.1.2.1.1.1

抓包验证端口:
  sudo ss -ulnp | grep 161
  sudo tcpdump -i any -n udp port 161 -c 5


================================================================
二、禁用 ICMP(禁 ping)
================================================================

ICMP 禁用有 4 个层级,按需选择。

2.1 内核参数即时生效(sysctl,临时)
----------------------------------------
sudo sysctl -w net.ipv4.icmp_echo_ignore_all=1

验证:
  ping 127.0.0.1   # 应当 100% packet loss

恢复:
  sudo sysctl -w net.ipv4.icmp_echo_ignore_all=0

2.2 永久生效(写入 sysctl.conf)
----------------------------------------
echo "net.ipv4.icmp_echo_ignore_all=1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

说明:
  net.ipv4.icmp_echo_ignore_all=1  忽略所有 ICMP Echo Request
  =0  恢复响应
  写入 /etc/sysctl.d/99-icmp.conf 也可,优先级更高

2.3 iptables 方式(更精细控制,可放行特定来源)
----------------------------------------
完全禁止:
  sudo iptables -A INPUT -p icmp --icmp-type echo-request -j DROP

仅禁止外网、允许内网:
  sudo iptables -A INPUT -p icmp --icmp-type echo-request -s 192.168.1.0/24 -j ACCEPT
  sudo iptables -A INPUT -p icmp --icmp-type echo-request -j DROP

持久化(iptables-persistent):
  sudo apt install -y iptables-persistent
  sudo netfilter-persistent save
  # 规则保存到 /etc/iptables/rules.v4

UFW 方式:
  编辑 /etc/ufw/before.rules,在 *filter 之前加:
    -A ufw-before-input -p icmp --icmp-type echo-request -j DROP
  sudo ufw reload

2.4 nftables 方式(Ubuntu 22.04+ 默认)
----------------------------------------
sudo nft add rule inet filter input icmp type echo-request drop

持久化:
  sudo nft list ruleset | sudo tee /etc/nftables.conf


================================================================
三、常见问题
================================================================

Q1: snmpwalk 报 "Authentication failed"
  - 用户名/密码大小写或空格不一致,密码至少 8 位
  - /var/snmpd.conf 或 /var/lib/snmp/snmpd.conf 里有重复 createUser,删除

Q2: snmpd 启动报 "Error opening specified endpoint"
  - 端口 161 被占用: sudo ss -ulnp | grep 161
  - agentaddress 配置冲突,检查 /etc/snmp/snmpd.conf

Q3: 远端能 ping 但 snmpwalk 超时
  - 防火墙 UDP 161 未放行
  - /etc/default/snmpd 中 SNMPDOPTS 默认带 127.0.0.1 限制

Q4: 禁用 ICMP 后 SSH 也断了
  - ICMP 与 SSH(TCP 22)无关,SSH 不受影响
  - 但部分 fail2ban 规则会拒绝无 ping 的主机,需检查 /etc/fail2ban/jail.local

Q5: 如何只禁 ping 但保留 ICMP Destination Unreachable
  - 不要设 icmp_echo_ignore_all=1
  - 改用 iptables:
      sudo iptables -A INPUT -p icmp --icmp-type echo-request -j DROP
      # 其他 ICMP 类型如 3/11 仍正常处理


================================================================
四、回滚操作
================================================================

SNMP 回滚:
  sudo systemctl stop snmpd
  sudo apt remove --purge snmpd snmp
  sudo rm -rf /etc/snmp/snmpd.conf*

ICMP 回滚:
  sudo sysctl -w net.ipv4.icmp_echo_ignore_all=0
  # 或删除 /etc/sysctl.conf 中对应行
  # 或删除 iptables/nftables 中对应规则
