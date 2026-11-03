# nmcli 使用说明

`nmcli`（NetworkManager Command Line Interface）是 Linux 下 NetworkManager 服务提供的命令行网络管理工具，适用于 RHEL / CentOS / openEuler / Fedora / Ubuntu（带 NetworkManager）等主流发行版。

> 提示：如果你更倾向交互式图形工具，请参考同目录下的 `nmtui.md`。

---

## 1. 语法与基本概念

基本语法：

```
nmcli [OPTIONS] OBJECT { COMMAND | help }
```

常用对象（OBJECT）：

| 对象     | 简写 | 含义                       |
| -------- | ---- | -------------------------- |
| device   | dev  | 物理网卡设备（网卡本身）   |
| connection | con  | 网卡上的连接配置（逻辑配置） |
| general  | gen  | NetworkManager 全局状态    |
| networking | net  | 网络开关                 |
| radio    | rad  | 无线开关                   |

**理解 device 与 connection 的区别**：

- `device` 是物理存在的网卡，例如 `ens33`、`wlan0`。
- `connection` 是这套网卡上「保存的配置」（IP、网关、DNS 等），一个 device 可以有多个 connection，但同一时间只能激活一个。

查看帮助：

```
nmcli help
nmcli device help
nmcli connection help
```

---

## 2. 查看状态

### 2.1 查看 NetworkManager 总体状态

```
nmcli general status
```

输出示例：

```
STATE      CONNECTIVITY  WIFI-HW  WIFI      WWAN-HW  WWAN
connected  full          enabled  enabled   enabled  enabled
```

### 2.2 查看所有网卡设备

```
nmcli device status
```

```
nmcli device
```

示例输出：

```
DEVICE  TYPE      STATE         CONNECTION
ens33   ethernet  connected     ens33
wlan0   wifi      disconnected  --
lo      loopback  unmanaged     --
```

### 2.3 查看所有连接配置

```
nmcli connection show
```

```
nmcli connection show --active    # 只显示当前激活的连接
```

### 2.4 查看某个连接的详细信息

```
nmcli connection show ens33
```

### 2.5 查看网卡当前 IP 等信息

```
nmcli device show ens33
```

---

## 3. 启用 / 关闭 网络

### 3.1 整体开关 NetworkManager

```
nmcli networking on
nmcli networking off
```

### 3.2 启动 / 关闭某个连接（最常用）

```
nmcli connection up ens33
nmcli connection down ens33
```

### 3.3 让某个网卡断开/连接

```
nmcli device disconnect ens33
nmcli device connect ens33
```

### 3.4 重新加载所有连接配置（修改配置后建议执行）

```
nmcli connection reload
```

---

## 4. 配置静态 IP / 网关 / DNS

下面以网卡 `ens33` 为例，请将 `ens33`、IP、网关、DNS 替换为你实际的值。

### 4.1 配置静态 IP（手动）

```
# 设置 IP 和子网掩码（/24 即 255.255.255.0）
nmcli connection modify ens33 ipv4.addresses 192.168.1.100/24

# 设置网关
nmcli connection modify ens33 ipv4.gateway 192.168.1.1

# 设置 DNS（多个用空格分隔）
nmcli connection modify ens33 ipv4.dns "114.114.114.114 8.8.8.8"

# 关闭自动获取（改为手动）
nmcli connection modify ens33 ipv4.method manual

# 立即生效
nmcli connection up ens33
```

### 4.2 多个 IP（同一网卡绑定多个 IP）

```
nmcli connection modify ens33 ipv4.addresses "192.168.1.100/24,192.168.1.101/24"
nmcli connection up ens33
```

### 4.3 配置为 DHCP 自动获取

```
nmcli connection modify ens33 ipv4.method auto
nmcli connection modify ens33 ipv4.addresses ""
nmcli connection modify ens33 ipv4.gateway ""
nmcli connection modify ens33 ipv4.dns ""
nmcli connection up ens33
```

### 4.4 只改某一项，其他不变

`modify` 默认会覆盖原值，如只想修改某一项，可直接指定单字段，例如只换 DNS：

```
nmcli connection modify ens33 ipv4.dns "223.5.5.5"
nmcli connection up ens33
```

---

## 5. 开机自动连接

```
# 启用自动连接
nmcli connection modify ens33 connection.autoconnect yes

# 关闭自动连接
nmcli connection modify ens33 connection.autoconnect no
```

查看是否已开启：

```
nmcli connection show ens33 | grep autoconnect
```

---

## 6. 创建 / 删除 / 重命名 连接

### 6.1 新建一个连接

DHCP 方式（最简单）：

```
nmcli connection add type ethernet ifname ens33 con-name my-ens33 autoconnect yes
nmcli connection up my-ens33
```

静态 IP 方式：

```
nmcli connection add \
  type ethernet \
  ifname ens33 \
  con-name my-ens33 \
  ipv4.method manual \
  ipv4.addresses 192.168.1.100/24 \
  ipv4.gateway 192.168.1.1 \
  ipv4.dns "114.114.114.114" \
  autoconnect yes

nmcli connection up my-ens33
```

### 6.2 删除连接

```
nmcli connection delete my-ens33
```

### 6.3 重命名连接

```
nmcli connection rename old-name new-name
```

### 6.4 克隆连接

```
nmcli connection clone old-name new-name
```

---

## 7. WiFi 管理

### 7.1 扫描 WiFi

```
nmcli device wifi rescan
nmcli device wifi list
```

### 7.2 连接指定 WiFi

```
nmcli device wifi connect "SSID名称" password "你的密码"
```

### 7.3 连接隐藏 SSID

```
nmcli device wifi connect "SSID名称" password "你的密码" hidden yes
```

### 7.4 查看已保存的 WiFi 连接

```
nmcli connection show | grep wifi
```

### 7.5 断开当前 WiFi

```
nmcli device disconnect wlan0
```

### 7.6 启用 / 关闭 WiFi

```
nmcli radio wifi on
nmcli radio wifi off
```

---

## 8. 修改连接的高级属性

常用可修改字段一览（`nmcli connection modify <name> <字段> <值>`）：

| 字段                          | 含义                                |
| ----------------------------- | ----------------------------------- |
| `ipv4.method`                 | `auto`（DHCP）或 `manual`（静态）   |
| `ipv4.addresses`              | IP/掩码，可多个用逗号               |
| `ipv4.gateway`                | 网关                                |
| `ipv4.dns`                    | DNS，多个用空格                     |
| `ipv4.dns-search`             | 搜索域                              |
| `ipv4.ignore-auto-dns`        | `yes` 表示忽略 DHCP 提供的 DNS      |
| `connection.autoconnect`      | 是否开机自动连接                    |
| `connection.autoconnect-priority` | 自动连接优先级，数字越大越优先   |
| `802-3-ethernet.mtu`          | MTU 值                              |
| `802-11-wireless.ssid`        | WiFi SSID                           |

查看完整字段：

```
nmcli connection show ens33
```

---

## 9. 常用组合示例

### 9.1 新装系统一键配置静态 IP

```
nmcli connection modify ens33 \
  ipv4.method manual \
  ipv4.addresses 192.168.1.100/24 \
  ipv4.gateway 192.168.1.1 \
  ipv4.dns "114.114.114.114 8.8.8.8" \
  connection.autoconnect yes

nmcli connection down ens33 && nmcli connection up ens33
```

### 9.2 切换为 DHCP

```
nmcli connection modify ens33 ipv4.method auto
nmcli connection modify ens33 ipv4.addresses ""
nmcli connection modify ens33 ipv4.gateway ""
nmcli connection modify ens33 ipv4.dns ""
nmcli connection up ens33
```

### 9.3 修改 MTU（例如 9000 巨型帧）

```
nmcli connection modify ens33 802-3-ethernet.mtu 9000
nmcli connection up ens33
```

### 9.4 让某条连接不自动连接，避免开机启动卡住

```
nmcli connection modify ens33 connection.autoconnect no
```

---

## 10. 常见问题排查

### 10.1 `nmcli` 命令找不到

说明系统没装 NetworkManager 或没装命令行包：

```
# RHEL / CentOS / openEuler
yum install -y NetworkManager

# Ubuntu / Debian
apt install -y network-manager
systemctl enable --now NetworkManager
```

### 10.2 提示 `Could not connect to D-Bus`

NetworkManager 服务没起来：

```
systemctl enable --now NetworkManager
systemctl status NetworkManager
```

### 10.3 修改后没生效

记住三步：

```
nmcli connection reload        # 1. 重新加载配置
nmcli connection down ens33     # 2. 关闭
nmcli connection up ens33       # 3. 启动
```

或一步到位：

```
nmcli connection up ens33
```

### 10.4 查看日志

```
journalctl -u NetworkManager -f
```

### 10.5 查看真实生效的 IP（绕过配置，直读内核）

```
ip addr show ens33
ip route
cat /etc/resolv.conf
```

---

## 11. 小结速查表

| 需求                     | 命令                                              |
| ------------------------ | ------------------------------------------------- |
| 看网卡状态               | `nmcli device status`                             |
| 看所有连接               | `nmcli connection show`                           |
| 看某连接详情             | `nmcli connection show ens33`                     |
| 启用连接                 | `nmcli connection up ens33`                       |
| 关闭连接                 | `nmcli connection down ens33`                     |
| 重新加载                 | `nmcli connection reload`                         |
| 设置静态 IP              | `nmcli connection modify ens33 ipv4.method manual ipv4.addresses 192.168.1.100/24 ipv4.gateway 192.168.1.1 ipv4.dns 114.114.114.114` |
| 设置 DHCP                | `nmcli connection modify ens33 ipv4.method auto`  |
| 开机自连                 | `nmcli connection modify ens33 connection.autoconnect yes` |
| 扫 WiFi                  | `nmcli device wifi rescan && nmcli device wifi list` |
| 连 WiFi                  | `nmcli device wifi connect "SSID" password "PWD"` |
| 关 WiFi                  | `nmcli radio wifi off`                            |

> 提示：`nmcli modify` 之后的修改，需要 `nmcli connection up ens33` 或 `nmcli connection reload` 后才会生效。