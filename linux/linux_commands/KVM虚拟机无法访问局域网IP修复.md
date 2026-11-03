# KVM 虚拟机无法访问局域网 IP 修复

**日期**:2026-09-02
**影响**:`win11` VM 之前可以 ping 通 `192.168.23.254` 等网关,但 ping 不通 `192.168.22.227` 和 `192.168.23.226`(同 JUPON 局域网段内)。

---

## 背景与原有设计

详细设计见姊妹文档 `xfreerdp 和 kvm 网络.md`。

简单回顾:
- `vm-routed` 用 **route 模式**(`<forward mode='route'/>`)
- `virbr1` 网桥,VM 在 `192.168.100.0/24`
- 宿主 `wlp3s0` 接 JUPON 无线网,IP `192.168.21.36/22`
- 开了 `proxy_arp`,让同 JUPON 网段的机器把 `192.168.100.162` 的 ARP 请求转到宿主机
- 手工加了 `MASQUERADE` 让 VM 出公网,`RETURN 192.168.20.0/22` 让 JUPON 内访问不 NAT

设计意图:**让 VM 在 JUPON 局域网内用真实 IP `192.168.100.162` 被直连访问**。

---

## 问题现象

从 VM 内(192.168.100.162)测试:

| 目标 | 期望 | 实际 |
|------|------|------|
| 192.168.23.254(网关) | 通 | ✅ 通 |
| 192.168.22.227 | 通 | ❌ 不通 |
| 192.168.23.226 | 通 | ❌ 不通 |

从宿主机测试,以上三个 IP **全部通**——说明目标机器本身正常,问题在 VM 这边的出网路径。

---

## 排查过程

### 1. 确认宿主机和 VM 网络配置

```bash
ip addr show
# wlp3s0: 192.168.21.36/22,网关 192.168.23.254
# enp2s0: DOWN(没插线)
# virbr1: 192.168.100.1/24,接 vnet0/vnet1/vnet2
```

```bash
virsh net-dumpxml vm-routed
# <forward mode='route'/> ← 路由模式,不是 NAT
```

### 2. 关键发现:`iptables` 的 RETURN 规则

```bash
iptables -t nat -L LIBVIRT_PRT -n -v
```

**输出里有这么一条**:
```
RETURN all -- * * 192.168.100.0/24 192.168.20.0/22
```

这是用户在姊妹文档里手工加的:JUPON 网段内直连,不 NAT。但**也正是问题所在**。

### 3. 根本原因

VM 发包到 `192.168.22.227` 的路径:

```
win11 (192.168.100.162)
   │ 发 ICMP,src=192.168.100.162, dst=192.168.22.227
   ↓
virbr1 (宿主机)
   │ 转发(无 NAT,因为 RETURN 规则)
   │ src 仍然是 192.168.100.162
   ↓
wlp3s0 → 路由器 192.168.23.254
   │ 路由器认识 192.168.20.0/22,转发包
   ↓
192.168.22.227
   │ 收到包,看到 src=192.168.100.162
   │ 回复包 src=192.168.22.227, dst=192.168.100.162
   ↓
路由器 192.168.23.254
   │ ❌ 路由器没有 192.168.100.0/24 的路由!
   │ 直接丢弃回复包
   ↓
win11 永远收不到回复 ✗
```

**`route` 模式要求上游路由器知道回程路由**,但家用路由器(192.168.23.254)不会有这个路由,所以**单通**——请求能到,回复回不来。

`proxy_arp` 只解决了**入站 ARP** 问题(让其他机器能解析 192.168.100.162),但**没有解决路由器层面的回程路由**。

### 4. 附加陷阱:WiFi AP 客户端隔离

- 宿主机走 `wlp3s0`(WiFi)上行
- 大多数 WiFi AP 默认开启**客户端隔离**,即使在路由器加了回程路由,AP 也可能直接丢弃不同客户端的互访包
- 这是为什么姊妹文档里的方案即使在路由器加路由,也可能不完全可靠

---

## 修复过程(route → NAT)

### 步骤 1:备份并改配置

```bash
sudo cp /etc/libvirt/qemu/networks/vm-routed.xml \
        /etc/libvirt/qemu/networks/vm-routed.xml.bak.$(date +%Y%m%d_%H%M%S)
```

把 `<forward mode='route'/>` 改成 `<forward mode='nat'/>`。

### 步骤 2:重新定义网络 ⚠️ 坑 1

```bash
# ❌ 错:只 destroy + start,libvirt 会从持久化状态恢复旧 mode
virsh net-destroy vm-routed
virsh net-start vm-routed
# 结果:XML 还是 route 模式,libvirt 把修改覆盖回去了
```

正确做法:**undefine + define**

```bash
virsh net-destroy vm-routed
virsh net-undefine vm-routed    # ⚠️ 这一步会顺带删除 XML 文件!
virsh net-define /etc/libvirt/qemu/networks/vm-routed.xml
virsh net-autostart vm-routed
virsh net-start vm-routed
```

**坑 1**:`net-undefine` 会删除 `/etc/libvirt/qemu/networks/vm-routed.xml`,所以**必须**先把 XML 改成想要的内容再 undefine,否则就要从备份恢复。

### 步骤 3:启动被强制关机的 VM ⚠️ 坑 2

`virsh net-destroy` 会强制断开连在该网络上的 VM 接口,win11 因此被关机:

```bash
virsh domstate win11
# shut off  ← 被关了
virsh start win11
```

### 步骤 4:清理残留 RETURN 规则 ⚠️ 坑 3

切到 NAT 模式后,iptables 还残留着 route 模式的 `RETURN 192.168.100.0/24 192.168.20.0/22` 规则:

```bash
iptables -t nat -L LIBVIRT_PRT -n
# 看到 RETURN all 192.168.100.0/24 192.168.20.0/22  ← 残留,会破坏 NAT
```

需要:

```bash
sudo systemctl restart libvirtd   # 让 libvirt 清空重建 LIBVIRT_* 链
virsh net-destroy vm-routed
virsh net-start vm-routed        # 触发钩子重建 NAT 规则
```

### 步骤 5:VM 网卡 disable ⚠️ 坑 4

dmesg 显示:

```
virbr1: port 1(vnet1) entered forwarding state
... 54 秒后 ...
virbr1: port 1(vnet1) entered disabled state
vnet1: left promiscuous mode
```

之前 `domif-setlink vnet0 down/up` 让网卡启停,Windows 内部网络栈把它当成"网卡断开",触发了 disable。

修复 — detach + attach:

```bash
virsh detach-interface win11 network --mac 52:54:00:77:60:09 --live
virsh attach-interface win11 network vm-routed \
    --model e1000e --mac 52:54:00:77:60:09 --live
```

5 秒后 win11 重新拿到 `192.168.100.162`,RDP 3389 端口恢复可达。

### 步骤 6:验证 NAT 规则干净

```bash
iptables -t nat -L LIBVIRT_PRT -n
```

**期望**(干净的 NAT 模式):

```
RETURN  all -- 192.168.100.0/24 224.0.0.0/24           ← 多播免 NAT
RETURN  all -- 192.168.100.0/24 255.255.255.255       ← 广播免 NAT
MASQUERADE tcp -- 192.168.100.0/24 !192.168.100.0/24  ← TCP 出网 NAT
MASQUERADE udp -- 192.168.100.0/24 !192.168.100.0/24  ← UDP 出网 NAT
MASQUERADE all -- 192.168.100.0/24 !192.168.100.0/24  ← 其他全 NAT
```

**不应该有** `RETURN 192.168.100.0/24 192.168.20.0/22` 这一条。

---

## 修复结果

✅ VM 能 ping 通 `192.168.22.227` 和 `192.168.23.226`
✅ xfreerdp 用 `192.168.100.162` 连接正常

---

## ⚠️ 重要:此修复破坏了姊妹文档的设计目标

姊妹文档 `xfreerdp 和 kvm 网络.md` 设计的初衷是:

> 让 VM 在 JUPON 局域网内用真实 IP `192.168.100.162` 被直连访问
> (同 JUPON 网段的机器 `xfreerdp /v:192.168.100.162` 直接连,无需经过宿主机 NAT)

**改成 NAT 模式后,这个能力丢失了**:
- VM 出网变成宿主机 IP(192.168.21.36)的 NAT
- 同 JUPON 网段的机器**不能**直接用 `192.168.100.162` 连到 VM 了 —— 路由器不认识这个网段,会丢回复包
- 只有**宿主机自己**还能连(走 virbr1 网桥本地通信)

### 是否需要回滚?

**看需求**:

| 场景 | 保持 NAT(当前) | 回滚到 route + 路由器加路由 |
|------|--------------|--------------------------|
| VM 上网 | ✅ 通 | ✅ 通(需 RETURN JUPON + MASQUERADE 其它) |
| 宿主机 RDP 连 VM | ✅ 通 | ✅ 通 |
| 同 JUPON 其它机器 RDP 连 VM | ❌ 不通 | ✅ 通 |
| 路由器管理权限 | 不需要 | 需要 |

如果其他机器也经常 RDP 连这台 VM,**应该回滚**。

### 回滚方案

```bash
# 1. 改回 route
sudo virsh net-destroy vm-routed
sudo virsh net-undefine vm-routed
sudo sed -i "s|forward mode='nat'|forward mode='route'|" \
    /etc/libvirt/qemu/networks/vm-routed.xml
sudo virsh net-define /etc/libvirt/qemu/networks/vm-routed.xml
sudo virsh net-autostart vm-routed
sudo virsh net-start vm-routed

# 2. 加回原有的 RETURN 规则(姊妹文档的设计)
sudo iptables -t nat -A LIBVIRT_PRT \
    -s 192.168.100.0/24 -d 192.168.20.0/22 -j RETURN
sudo iptables -t nat -A LIBVIRT_PRT \
    -s 192.168.100.0/24 -d 224.0.0.0/24 -j RETURN
sudo iptables -t nat -A LIBVIRT_PRT \
    -s 192.168.100.0/24 -d 255.255.255.255/32 -j RETURN
sudo iptables -t nat -A LIBVIRT_PRT \
    -s 192.168.100.0/24 ! -d 192.168.100.0/24 -j MASQUERADE
sudo netfilter-persistent save

# 3. 在路由器(192.168.23.254)上加静态路由
#    目的: 192.168.100.0/24
#    下一跳: 192.168.21.36
#    (这一步必须有路由器管理权限,普通家用路由器在管理后台找"静态路由")
```

**还有 WiFi 客户端隔离的风险**,可能需要 AP 管理后台关掉"AP Isolation / 客户端隔离"。

---

## 经验教训

1. **`route` 模式 + 家用路由器 = 单通**,因为家用路由器没有回程路由
2. **`proxy_arp` 只解决 ARP**,不解决路由
3. **WiFi AP 客户端隔离**会让"路由器加路由"也不够,需 AP 配合
4. **libvirt 修改网络**:必须 `undefine + define`,`destroy + start` 不会重新读 XML
5. **`net-undefine` 会删 XML**,改之前先备份或准备好新文件
6. **VM 在网桥 disable 状态下**通过 `detach + attach` 可恢复,不必重启 VM

---

## 一键切换脚本(用于日后配置参考)

把以下两个脚本保存到 `/usr/local/bin/`,随时按需切换。

### 切换到 NAT 模式(VM 能上 192.168.22.x,但其他机器无法 RDP 到 VM)

`/usr/local/bin/kvm-net-to-nat.sh`:

```bash
#!/bin/bash
set -e

NET=vm-routed
XML=/etc/libvirt/qemu/networks/${NET}.xml

# 1. 改 XML
sudo sed -i "s|forward mode='route'|forward mode='nat'|" "$XML"

# 2. 重定义网络
sudo virsh net-destroy "$NET"
sudo virsh net-undefine "$NET"
sudo virsh net-define "$XML"
sudo virsh net-autostart "$NET"
sudo virsh net-start "$NET"

# 3. 清理手工 NAT 规则(route 模式时加的那些)
sudo iptables -t nat -D LIBVIRT_PRT \
    -s 192.168.100.0/24 -d 192.168.20.0/22 -j RETURN 2>/dev/null || true

# 4. 清空残留的 LIBVIRT 链,触发 libvirt 重建 NAT 规则
sudo systemctl restart libvirtd
sleep 2
sudo virsh net-destroy "$NET"
sudo virsh net-start "$NET"

# 5. 验证
echo "=== NAT 规则 ==="
sudo iptables -t nat -L LIBVIRT_PRT -n | grep -E "MASQUERADE|RETURN.*192.168.20"

# 6. 如果 VM 网络断了(网卡被 disable),重连
sleep 10
if ! timeout 2 bash -c "echo > /dev/tcp/192.168.100.162/3389" 2>/dev/null; then
    echo "重连 VM 网卡..."
    sudo virsh detach-interface win11 network --mac 52:54:00:77:60:09 --live
    sleep 2
    sudo virsh attach-interface win11 network "$NET" \
        --model e1000e --mac 52:54:00:77:60:09 --live
    sleep 10
fi

echo "✅ 切换到 NAT 完成"
```

### 切换到 route 模式(需要路由器加路由 + 关 AP 隔离)

`/usr/local/bin/kvm-net-to-route.sh`:

```bash
#!/bin/bash
set -e

NET=vm-routed
XML=/etc/libvirt/qemu/networks/${NET}.xml

# 1. 改 XML
sudo sed -i "s|forward mode='nat'|forward mode='route'|" "$XML"

# 2. 重定义网络
sudo virsh net-destroy "$NET"
sudo virsh net-undefine "$NET"
sudo virsh net-define "$XML"
sudo virsh net-autostart "$NET"
sudo virsh net-start "$NET"

# 3. 清理 libvirt 自动生成的 MASQUERADE(route 模式不需要 NAT 出网,但这里要手工加)
sudo systemctl restart libvirtd
sleep 2
sudo virsh net-destroy "$NET"
sudo virsh net-start "$NET"

# 4. 加手工规则:JUPON 内直连 / 其它走 NAT
sudo iptables -t nat -A LIBVIRT_PRT \
    -s 192.168.100.0/24 -d 192.168.20.0/22 -j RETURN
sudo iptables -t nat -A LIBVIRT_PRT \
    -s 192.168.100.0/24 -d 224.0.0.0/24 -j RETURN
sudo iptables -t nat -A LIBVIRT_PRT \
    -s 192.168.100.0/24 -d 255.255.255.255/32 -j RETURN
sudo iptables -t nat -A LIBVIRT_PRT \
    -s 192.168.100.0/24 ! -d 192.168.100.0/24 -j MASQUERADE
sudo netfilter-persistent save

# 5. 验证 proxy_arp 仍然开启
sysctl net.ipv4.conf.wlp3s0.proxy_arp
sysctl net.ipv4.conf.virbr1.proxy_arp

# 6. 重连 VM 网卡(必要时)
sleep 10
if ! timeout 2 bash -c "echo > /dev/tcp/192.168.100.162/3389" 2>/dev/null; then
    sudo virsh detach-interface win11 network --mac 52:54:00:77:60:09 --live
    sleep 2
    sudo virsh attach-interface win11 network "$NET" \
        --model e1000e --mac 52:54:00:77:60:09 --live
    sleep 10
fi

echo "✅ 切换到 route 完成"
echo "⚠️  别忘了:"
echo "   1. 在路由器 192.168.23.254 加静态路由: 192.168.100.0/24 → 192.168.21.36"
echo "   2. 关掉 WiFi AP 的客户端隔离(AP Isolation)"
echo "   3. 在另一台 JUPON 机器测试: xfreerdp /v:192.168.100.162 ..."
```

### 路由器加静态路由(192.168.23.254)

家用路由器管理后台 → 高级设置 / 路由表 / 静态路由 → 添加:

| 字段 | 值 |
|------|---|
| 目的 IP / 目标网络 | `192.168.100.0` |
| 子网掩码 | `255.255.255.0` |
| 下一跳 / 网关 | `192.168.21.36`(宿主机 IP) |
| 接口 | LAN(根据路由器实际接口名) |

不同品牌叫法不同,常见入口:
- TP-LINK: 路由功能 → 静态路由
- 华硕(ASUS): 高级设置 → 内部网络 → 路由表
- OpenWrt: 网络 → 路由 → 静态路由
- 小米: 高级设置 → 路由转发

### WiFi AP 客户端隔离(可选)

如果路由器加路由后,另一台 JUPON 机器仍然 ping 不通 `192.168.100.162`,就是 AP 在拦截。处理:

| AP 类型 | 关闭路径 |
|---------|---------|
| 家用路由器当 AP | 无线设置 → 高级 → AP Isolation / 客户端隔离 → 关 |
| OpenWrt | 网络 → 无线 → 高级设置 → AP Isolation → 0(关) |
| 企业 AP(UniFi 等) | WiFi 设置 → 高级 → Client Isolation → 关闭 |

---

## 决策参考表

| 需求 | 用哪个 |
|------|-------|
| 只想让 VM 上网,本机 RDP | **NAT** (简单,不需要路由器配合) |
| 同 JUPON 其它机器也要 RDP VM | **route + 路由器加路由 + 关 AP 隔离** |
| 频繁切换 | 把两个脚本放到 `/usr/local/bin/`,切换 < 30 秒 |