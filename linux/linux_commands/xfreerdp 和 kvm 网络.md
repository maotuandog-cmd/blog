# xfreerdp 远程桌面 + KVM 跨主机 VM 网络

## 背景

宿主机 `maotuan`（无线 `wlp3s0`，SSID=JUPON）上有一台 KVM Windows 11 VM（hostname=dog）。

需求：
- 让其他机器（同 JUPON 网段，或加路由的远端）能 ping 和 RDP（3389）到这个 VM
- VM 本身能访问外部网络（出网）
- 不用粘贴就能在 VM 控制台跑命令（spice-vdagent）

---

## 问题根因

### 1. libvirt `default` 网络是 NAT 模式

```bash
virsh net-dumpxml default
# <forward mode='nat'/>      ← NAT，不是 route
# <ip address='192.168.122.1' netmask='255.255.255.0'>
```

- 每台 KVM 宿主机都有自己独立的 `192.168.122.0/24`，互不相通
- A 主机上 `192.168.122.173` 和 B 主机上 `192.168.122.173` **是两个不同的 VM**
- 跨主机访问 192.168.122.x 必须换网络方案

### 2. 宿主机无线网卡不能桥接

- `iw phy0 info` 里 `valid interface combinations` **没有 4addr** ——无线 Managed 模式不允许桥接
- `enp2s0`（以太网）NO-CARRIER（没插线）
- 所以走不了 `br0` 接物理网卡这种传统方案

### 3. `route` 模式 VM 不出网

`forward mode='route'` 没有 MASQUERADE：VM 出去的包源 IP 是 `192.168.100.162`，互联网路由器不认识私网地址，**回程包迷路**。

---

## 解决方案

### 步骤 1：新建 `route` 模式网络

`/etc/libvirt/qemu/networks/vm-routed.xml`：

```xml
<network>
  <name>vm-routed</name>
  <forward mode='route'/>
  <bridge name='virbr1' stp='on' delay='0'/>
  <mac address='52:54:00:00:00:01'/>
  <ip address='192.168.100.1' netmask='255.255.255.0'>
    <dhcp>
      <range start='192.168.100.100' end='192.168.100.254'/>
    </dhcp>
  </ip>
</network>
```

启用：

```bash
sudo virsh net-define /etc/libvirt/qemu/networks/vm-routed.xml
sudo virsh net-autostart vm-routed
sudo virsh net-start vm-routed
```

### 步骤 2：开启 proxy_arp（无线桥接的替代）

`/etc/sysctl.d/99-kvm-vm-routed.conf`：

```
net.ipv4.conf.all.proxy_arp = 1
net.ipv4.conf.default.proxy_arp = 1
net.ipv4.conf.wlp3s0.proxy_arp = 1
net.ipv4.conf.virbr1.proxy_arp = 1
```

应用：

```bash
sudo sysctl -p /etc/sysctl.d/99-kvm-vm-routed.conf
```

`proxy_arp` 让宿主代答 ARP——同 L2 的其他机器发 `ARP who-has 192.168.100.162`，宿主回应"在我这"，包就转到了 `virbr1`。libvirt **不会**自动开这个，必须手动。

### 步骤 3：把 VM 切到 vm-routed

```bash
# 关机后改 XML（不能用 hot-plug：Q35 主板 PCI 槽全占）
sudo virsh shutdown win11
sudo virsh wait win11

# 改网络源
virsh dumpxml win11 > /tmp/win11-new.xml
sed -i "s|<source network='default'/>|<source network='vm-routed'/>|" /tmp/win11-new.xml
sudo virsh define /tmp/win11-new.xml
sudo virsh start win11
```

### 步骤 4：选择性 MASQUERADE（出网 + 保留 JUPON 直连）

`vm-routed` 是 `route` 模式，没 NAT，VM 上不了公网。手工补：

```bash
# JUPON 网段内直连，不 NAT
sudo iptables -t nat -A LIBVIRT_PRT -s 192.168.100.0/24 -d 192.168.20.0/22 -j RETURN
# 多播 / 广播免 NAT
sudo iptables -t nat -A LIBVIRT_PRT -s 192.168.100.0/24 -d 224.0.0.0/24 -j RETURN
sudo iptables -t nat -A LIBVIRT_PRT -s 192.168.100.0/24 -d 255.255.255.255/32 -j RETURN
# 其余走 MASQUERADE
sudo iptables -t nat -A LIBVIRT_PRT -s 192.168.100.0/24 ! -d 192.168.100.0/24 -j MASQUERADE
```

规则要重启不丢就装 `iptables-persistent`：

```bash
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
sudo netfilter-persistent save
```

### 步骤 5：VM 内部启用 RDP + 放防火墙（用 qemu-guest-agent）

热插 qemu-guest-agent 通道（VM XML 默认没装）：

```bash
cat > /tmp/qga-channel.xml <<'EOF'
<channel type='unix'>
  <target type='virtio' name='org.qemu.guest_agent.0'/>
</channel>
EOF
sudo virsh attach-device win11 /tmp/qga-channel.xml --live --config
```

VM 里装过 `virtio-win-guest-tools.exe` 之后（30MB，独立包，无需整张 ISO），服务就在。直接在 host 推命令：

```bash
# ICMP 入站放行
sudo virsh qemu-agent-command win11 '{"execute":"guest-exec","arguments":{"path":"C:\\Windows\\System32\\netsh.exe","arg":["advfirewall","firewall","add","rule","name=ICMPv4-In","protocol=icmpv4:8,any","dir=in","action=allow"],"capture-output":true}}'

# RDP 服务设为自动 + 启动
sudo virsh qemu-agent-command win11 '{"execute":"guest-exec","arguments":{"path":"C:\\Windows\\System32\\sc.exe","arg":["config","TermService","start=","auto"],"capture-output":true}}'
sudo virsh qemu-agent-command win11 '{"execute":"guest-exec","arguments":{"path":"C:\\Windows\\System32\\reg.exe","arg":["add","HKLM\\System\\CurrentControlSet\\Control\\Terminal Server","/v","fDenyTSConnections","/t","REG_DWORD","/d","0","/f"],"capture-output":true}}'
sudo virsh qemu-agent-command win11 '{"execute":"guest-exec","arguments":{"path":"C:\\Windows\\System32\\sc.exe","arg":["start","TermService"],"capture-output":true}}'

# Public profile 防火墙关掉（libvirt 默认被 Windows 认成 Public 严网络）
sudo virsh qemu-agent-command win11 '{"execute":"guest-exec","arguments":{"path":"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe","arg":["-NoProfile","-Command","Set-NetFirewallProfile -Profile Public -Enabled False"],"capture-output":true}}'

# 直接放行 3389（绕过 PowerShell DisplayGroup 解析问题）
sudo virsh qemu-agent-command win11 '{"execute":"guest-exec","arguments":{"path":"C:\\Windows\\System32\\netsh.exe","arg":["advfirewall","firewall","add","rule","name=RDP-3389-In","dir=in","action=allow","protocol=TCP","localport=3389"],"capture-output":true}}'
```

验证：

```bash
nc -zv -w 3 192.168.100.162 3389   # 应得 ms-wbt-server
ping 192.168.100.162                 # 应通
```

---

## 让 VM 能粘贴：spice-vdagent

`/etc/libvirt/qemu/networks/...` 的 VM XML 里有 SPICE vdagent 通道（`com.redhat.spice.0`），但 Windows 里**没装服务**，剪贴板同步形同虚设。

装 `virtio-win-guest-tools.exe`（30MB，比 800MB ISO 精简）：

```bash
curl -fL -o /var/lib/libvirt/images/virtio-win-guest-tools.exe \
  https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/latest-virtio/virtio-win-guest-tools.exe
```

如果没法热插 CD-ROM（Q35 主板 PCI 槽满），起个 host 上的 HTTP 服务让 VM 下载：

```bash
# 临时放行 8000/tcp 到 virbr1
sudo iptables -I LIBVIRT_INP -i virbr1 -p tcp --dport 8000 -j ACCEPT

cd /var/lib/libvirt/images && \
  nohup python3 -m http.server 8000 --bind 192.168.100.1 > /tmp/httpd.log 2>&1 &

# 完事收尾
pkill -f "http.server"
sudo iptables -D LIBVIRT_INP -i virbr1 -p tcp --dport 8000 -j ACCEPT
```

VM 里浏览器访问 `http://192.168.100.1:8000/`，下载安装，重启一次。**之后 virt-viewer 里 Ctrl+Shift+C / Ctrl+Shift+V 双向粘贴都能用**。

---

## xfreerdp 用法

### 推荐：不进全屏 + 动态分辨率

```bash
xfreerdp /v:192.168.100.162 /u:administrator /p:maotuan /cert:ignore \
         /dynamic-resolution
```

- 窗口可拖角拉伸，VM 桌面跟着实时变（不糊、不黑边）
- **键盘不被 grab**，Alt+Tab / Super 键直接切回 host
- 想"全屏体验"——窗口里按 F11

### 三种模式对比

| 用法 | 键盘 grab | 切回 host | 分辨率 |
|---|---|---|---|
| `/f` | 抓，**Ctrl+Alt+Enter** 释放 | 退全屏 = 切 | 固定屏分辨率 |
| `/f /dynamic-resolution` | 抓（Ctrl+Alt+Enter 退） | 同上 | 全屏，可动态改 |
| `/dynamic-resolution`（无 /f） | **不抓** | **Alt+Tab 直接切** | 拖窗口拉伸 |

### 进全屏后常用的退出 / 切换快捷键

- **Ctrl+Alt+Enter** —— 切全屏 / 窗口
- **Ctrl+Alt+Del** —— 从 xfreerdp 顶栏 "Send Ctrl+Alt+Del" 按钮发
- **Right Ctrl** —— 部分场景要先按一下"叫醒"键盘，再按 Ctrl+Alt+Enter

### alias 一键连

`/etc/profile` 里加：

```bash
alias win11='xfreerdp /v:192.168.100.162 /u:administrator /p:maotuan /cert:ignore /dynamic-resolution'
```

> ⚠️ `/etc/profile` 是 `-rw-r--r--`，密码明文全系统可见。如果机器有别的用户能登录，建议放 `~/.bashrc`。

---

## 跨主机访问速查

| 接入位置 | 怎么连 |
|---|---|
| 本机（maotuan） | `xfreerdp /v:192.168.100.162 ...`（如上） |
| 同 JUPON 网段（192.168.20.0/22） | 直接 `xfreerdp /v:192.168.100.162`（proxy_arp 已开） |
| 远端主机（不同子网） | 先 `sudo ip route add 192.168.100.0/24 via 192.168.21.36`，再 RDP |

---

## 排错检查清单

```bash
# VM 当前在哪个网络？
virsh dumpxml win11 | grep "source network"
# 期望：<source network='vm-routed' .../>

# VM IP
sudo virsh net-dhcp-leases vm-routed

# proxy_arp 是否生效
sysctl net.ipv4.conf.wlp3s0.proxy_arp
sysctl net.ipv4.conf.virbr1.proxy_arp
# 两者都应为 1

# MASQUERADE 规则
sudo iptables -t nat -L LIBVIRT_PRT -n -v
# 应有 192.168.100.0/24 那几条

# VM 里端口监听
sudo virsh qemu-agent-command win11 \
  '{"execute":"guest-exec","arguments":{"path":"C:\\Windows\\System32\\netstat.exe","arg":["-an","-p","TCP"],"capture-output":true}}'

# 抓包看 VM 是否真在往外发
sudo tcpdump -i virbr1 -nn -c 30 host 192.168.100.162
```

---

## 留下的状态文件

| 路径 | 用途 |
|---|---|
| `/etc/libvirt/qemu/networks/vm-routed.xml` | route 模式网络定义 |
| `/etc/sysctl.d/99-kvm-vm-routed.conf` | proxy_arp 持久化 |
| `/etc/iptables/rules.v4` | 含 MASQUERADE 规则，重启不丢 |
| `/etc/profile` | 含 `win11` alias（密码明文，权限 644） |
| `/var/lib/libvirt/images/virtio-win-guest-tools.exe` | VM 里装的 guest tools 安装包 |
