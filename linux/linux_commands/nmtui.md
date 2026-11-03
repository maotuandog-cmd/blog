你提到的 `opeourla 24` 应该是 **openEuler 24**。新安装的 openEuler 默认通常不会自动激活网卡，导致你使用 `ip a` 时看不到 IP 地址。

  

openEuler 使用 `NetworkManager` 来管理网络。你可以通过图形化菜单（`nmtui`）或纯命令行（`nmcli`）来配置。

  

首先，你需要确认你的网卡名称。

  

## 1. 查看网卡名称

在终端输入以下命令查看网卡状态：

  

Bash

```
nmcli device status
```

你会看到类似这样的输出：

`ens33 ethernet disconnected`

这里的 **`ens33`**（或者 `eth0`、`enp0s3`）就是你的网卡名称，记下它，后面的配置都会用到。

  

## 2. 配置 IP（选择以下任意一种方式）

### 方式 A：使用 nmtui 图形界面（新手推荐）

这是一个运行在终端里的图形菜单，操作最直观。

  

1. 在终端输入 `nmtui` 回车。
    
      
    
2. 使用键盘上下键选择 **Edit a connection** (编辑连接)，按回车。
    
      
    
3. 选中你的网卡（如 ens33），按回车进入编辑界面。
    
      
    
4. 将 **IPv4 CONFIGURATION** 从 `<Automatic>` (自动/DHCP) 改为 `<Manual>` (手动)。
    
      
    
5. 选中 `<Show>` 按回车展开详细设置：
    
      
    - **Addresses:** 输入你想设置的 IP 和掩码，例如 `192.168.1.100/24`
        
          
        
    - **Gateway:** 输入网关，例如 `192.168.1.1`
        
          
        
    - **DNS servers:** 输入 DNS，例如 `114.114.114.114`
        
          
        
6. 勾选底部的 **[X] Automatically connect** (开机自动连接)。
    
      
    
7. 选右下角的 `<OK>` 保存，然后一直按 `<Back>` 退出 `nmtui`。
    
      
    
8. 运行命令重启网卡使其生效：
    
      
    
    Bash
    
    ```
    nmcli connection up ens33
    ```
    

### 方式 B：使用 nmcli 纯命令行（速度快）

如果你熟悉命令行，或者需要写脚本，直接依次执行以下命令（请把 `ens33` 替换为你的实际网卡名，IP 和网关替换为你实际的网段）：

  

Bash

```
# 1. 设置 IP 地址和子网掩码（/24 代表 255.255.255.0）
nmcli connection modify ens33 ipv4.addresses 192.168.1.100/24

# 2. 设置网关
nmcli connection modify ens33 ipv4.gateway 192.168.1.1

# 3. 设置 DNS 服务器
nmcli connection modify ens33 ipv4.dns "114.114.114.114 8.8.8.8"

# 4. 将获取 IP 的方式设置为手动 (static)
nmcli connection modify ens33 ipv4.method manual

# 5. 设置为开机自动连接
nmcli connection modify ens33 connection.autoconnect yes

# 6. 重新加载并启动网卡
nmcli connection up ens33
```

> **提示：如果你的环境有路由器分配 IP（DHCP）**
> 
> 你不需要手动配置 IP，只需要设置网卡开机自启并激活即可：
> 
>   
> 
> Bash
> 
> ```
> nmcli connection modify ens33 connection.autoconnect yes
> nmcli connection up ens33
> ```

## 3. 验证网络

配置完成后，输入以下命令检查是否成功获取到了 IP：

  

Bash

```
ip addr
```

再尝试 ping 一下外网，看看网络是否通畅：

Bash

```
ping baidu.com
```