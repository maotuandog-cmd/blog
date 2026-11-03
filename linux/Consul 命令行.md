在 Consul 中，可以通过自带的命令行工具（CLI）非常方便地查询节点（Node）、服务（Service）以及键值对（Key/Value）。

  

以下是常用查询命令的整理：

  

### 1. 查询 Node（节点）

- **查看集群中的所有节点状态（基于 Gossip 协议）：**
    
      
    
    Bash
    
    ```
    consul members
    ```
    
    _这会列出所有加入集群的节点及其状态（alive, failed, left 等）。_
    
      
    
- **查询注册到服务目录（Catalog）中的所有节点：**
    
      
    
    Bash
    
    ```
    consul catalog nodes
    ```
    
- **查询某个特定节点上运行的所有服务：**
    
      
    
    Bash
    
    ```
    consul catalog nodes -node=节点名称
    ```
    

### 2. 查询 Service（服务）

- **列出当前数据中心注册的所有服务：**
    
      
    
    Bash
    
    ```
    consul catalog services
    ```
    
- **查询运行某个特定服务的所有节点实例：**
    
      
    
    Bash
    
    ```
    consul catalog nodes -service=你的服务名称
    ```
    
    _例如：`consul catalog nodes -service=nginx` 会列出所有注册了 nginx 服务的节点 IP 和端口信息。_
    
      
    

### 3. 查询 Key/Value（键值对）

- **获取单个 Key 的值：**
    
      
    
    Bash
    
    ```
    consul kv get 你的/key/路径
    ```
    
    _例如：`consul kv get monitoring/snmp_exporter/config`_
    
      
    
- **获取某个前缀下所有的 Key 和 Value（递归查询）：**
    
      
    
    Bash
    
    ```
    consul kv get -recurse 你的/前缀路径/
    ```
    
    _如果想查看所有的 KV 数据，可以直接执行 `consul kv get -recurse`。_
    
      
    
- **只列出 Key 的名称（不看 Value）：**
    
      
    
    Bash
    
    ```
    consul kv get -keys 你的/前缀路径/
    ```
    
- **查看 Key 的详细元数据（修改索引、Flags 等）：**
    
      
    
    Bash
    
    ```
    consul kv get -detailed 你的/key/路径
    ```
    

### 补充说明

如果你的 Consul 开启了 ACL（访问控制列表），在执行上述命令时可能会提示权限不足（Permission denied）。此时你需要在命令中加上 token 参数，或者设置环境变量：

Bash

```
# 方式一：命令行附加 token
consul kv get -token="你的ACL_TOKEN" 你的/key/路径

# 方式二：设置环境变量（推荐，省去每次输入的麻烦）
export CONSUL_HTTP_TOKEN="你的ACL_TOKEN"
```