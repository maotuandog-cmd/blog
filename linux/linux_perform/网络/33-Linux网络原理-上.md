# 33 | 关于 Linux 网络，你必须知道这些（上）

原文：[time.geekbang.org/column/article/80898](https://time.geekbang.org/column/article/80898)

网络本质是跨机 IPC。Linux 按 **TCP/IP 四层**实现，口头仍爱用 OSI 七层（「七层/四层负载」= OSI 应用层/传输层 = TCP/IP 的四层/三层）。

## 模型

| TCP/IP | 干什么 | 例子 |
|--------|--------|------|
| 应用层 | 给用户程序 | HTTP、DNS、FTP |
| 传输层 | 端到端 | TCP、UDP |
| 网络层 | 封装、寻址、路由 | IP、ICMP |
| 网络接口层 | 上物理网 | MAC、网卡发帧 |

封装只在负载前后加头尾，不改原始数据：应用数据 → TCP 头 → IP 头 → 帧头/帧尾。

**MTU** 限制最大 IP 包。以太网默认 1500（Linux 默认也是）。超了在网络层分片。MTU 越大分包越少、吞吐越好；IB 上 MTU 过大反而可能因分片/重组变慢。

## 收包

1. 网卡 DMA 写入 **ring buffer**（在内核内存，不在网卡芯片里），硬中断通知
2. 硬中断：分配 `sk_buff`，拷过去，再抬软中断（协议栈大部分逻辑在软中断）
3. 链路层验帧、剥头尾，交给 IP
4. 网络层看要本机还是转发；本机剥 IP 头交给 TCP/UDP
5. 传输层用四元组找到 Socket，拷进 **Socket 接收缓冲**
6. 应用 `read`/`recv`

常见坑：中断不均、连接跟踪打满。

## 发包（反向）

`sendmsg` → Socket 发送缓冲 → 协议栈加 TCP/IP 头、路由、按 MTU 分片 → 接口层找下一跳 MAC、加帧 → 发送队列 → 软中断叫醒驱动 → DMA 出网卡。

`sk_buff` 是内核包描述结构；skb 常指套接字缓冲。图里两个大圈是 ring buffer。
