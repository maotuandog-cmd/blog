# ipcs — System V IPC 设施查看命令速查

定位: 速查手册. 一个命令一篇笔记, 与同级 `ps.md` / `ss.md` / `tcpdump.md` 同款风格.

来源: util-linux 2.41.3 (`man ipcs`, 2025-12-15), 本机实测样例 (2026-09-08).

================================================================
1. 它是什么
================================================================

`ipcs` (Inter-Process Communication Status) 用来**查看** System V 体系下的三类 IPC 资源:

  - 共享内存段   (shared memory segments, `shm`)
  - 消息队列     (message queues, `msg`)
  - 信号量数组   (semaphore arrays, `sem`)

它**只查看**, 不创建也不删除. 创建用 `ipcmk`, 删除用 `ipcrm`, 见文末 SEE ALSO.

底层数据来源:

  Linux 现代实现读 `/proc/sysvipc/` 下的三个文件: `shm` / `msg` / `sem`.
  util-linux < 2.23 时改用 `shmctl(2)` / `msgctl(2)` / `semctl(2)` 的 `IPC_STAT`, 因此
  只能看到当前用户**有读权限**的资源. 现代内核 /proc 一直在, 不再有这个限制.

================================================================
2. 用法骨架
================================================================

  ipcs [resource-option...] [output-option]
  ipcs -m|-q|-s -i <id>

两类选项:

  resource-option  选要看哪种资源 (默认 -a, 全看)
  output-option    选要输出哪些字段 (只最后指定的一个生效)

================================================================
3. 资源选项 (-m / -q / -s / -a)
================================================================

  -m, --shmems     只看共享内存段
  -q, --queues     只看消息队列
  -s, --semaphores 只看信号量数组
  -a, --all        三种全看 (默认)

本机默认输出样例 (三类分段, 每段一个表头):

    ------ Message Queues --------
    key        msqid      owner      perms      used-bytes   messages

    ------ Shared Memory Segments --------
    key        shmid      owner      perms      bytes      nattch     status
    0x00000000 163862     maotuan    600        4194304    2          dest

    ------ Semaphore Arrays --------
    key        semid      owner      perms      nsems

================================================================
4. 输出字段选项 (互相覆盖, 只最后一个生效)
================================================================

  -t, --time     显示时间戳:
                   shm: 最后 attach / detach / 权限变更时间
                   msg: 最后 msgsnd / msgrcv 时间
                   sem: 最后 semop 时间

  -p, --pid      显示创建者 PID 和最近操作者 PID
                   shm 列名: cpid / lpid
                   msg 列名: lspid (最后 msgsnd 的 PID) / lrpid (最后 msgrcv 的 PID)
                   sem 列名: lpid / lpid (注: man 把信号量最近操作 PID 也叫 lpid)

  -c, --creator  显示创建者/拥有者的 uid/gid/cuid/cgid (cuid/cgid = 创建时 UID/GID)

  -l, --limits   显示**内核参数上限**, 而非当前已用资源
  -u, --summary  显示**当前用量摘要** (allocated / used / resident 等)

  -b, --bytes    强制以字节输出大小 (默认已字节, 但 -l 默认按 KiB/MiB 截断显示)
      --human    可读格式 (-l 用)

本机 `ipcs -l` 实测:

    ------ Messages Limits --------
    max queues system wide = 32000
    max size of message (bytes) = 8192
    default max size of queue (bytes) = 16384

    ------ Shared Memory Limits --------
    max number of segments = 4096
    max seg size (kbytes) = 18014398509465599
    max total shared memory (kbytes) = 18446744073709551612
    min seg size (bytes) = 1

    ------ Semaphore Limits --------
    max number of arrays = 32000
    max semaphores per array = 32000
    max semaphores system wide = 1024000000
    max ops per semop call = 500
    semaphore max value = 32767

对应内核参数在 `/proc/sys/kernel/`:

  msgmax / msgmni / msgmnb / shmmni / shmmax / shmall / sem (四元组)

本机实测:

    sem   = 32000  1024000000  500  32000     # SEMMSL SEMMNS SEMOPM SEMMNI
    shmmax = 18446744073692774399             # 即 2^64 - 1, 实际上限
    shmmni = 4096
    msgmax = 8192
    msgmni = 32000
    msgmnb = 16384
    shmall = 18446744073692774399             # 同 shmmax, 页数

要**临时调整**内核上限, 写 `/proc/sys/kernel/<name>`; 永久调整写 `/etc/sysctl.d/*.conf` 然后 `sysctl -p`.

================================================================
5. 其它选项
================================================================

  -i, --id <id>     只看 ID 为 <id> 的**单一资源**, 详细信息.
                     必须配 -m / -q / -s, 告诉它查哪类.
                     例: `ipcs -m -i 163862` (查 shmid=163862 这一个段)

  -h, --help        帮助
  -V, --version     版本

================================================================
6. 输出列含义速查
================================================================

共享内存 (-m) 默认列:

  key       资源的 32 位 key, 0x00000000 表示匿名段 (IPC_PRIVATE 创建)
  shmid     内核分配的 ID, 后续 shmat / shmdt / shmctl 都用它
  owner     当前拥有者 (创建者 UID 对应的用户名)
  perms     八进制权限位, 类似文件权限, 0666 / 0600 这种
  bytes     段大小
  nattch    当前 attach 到这个段的进程数
  status    段状态, 见下

shm status 取值:

  dest   标记为 "待销毁": 附着的进程数为 0 但还没真正释放, 留作标记
  (无标记) 仍在使用

消息队列 (-q) 默认列:

  key          同上
  msqid        队列 ID
  owner        拥有者
  perms        权限
  used-bytes   当前队列占用字节数
  messages     当前队列中消息条数

信号量 (-s) 默认列:

  key     同上
  semid   信号量数组 ID
  owner   拥有者
  perms   权限
  nsems   这个数组里含几个信号量

================================================================
7. 常用实战组合
================================================================

看现在系统里到底有多少 IPC 资源, 一眼总览:

    ipcs -u

查某个 shm 段到底是谁在用、什么时候 attach 上的:

    ipcs -m -p -t                # 列出所有 shm 段 + PID + 时间
    ipcs -m -i 163862            # 看 ID=163862 这一个的完整信息

按 PID 反查"这个进程附着在哪些 shm 段上":

    lsof -p <pid> | grep -i '/SYSV\|shm'     # 真正的 lsof 法
    # 或者: cat /proc/<pid>/maps | grep -i shm

按用户清理 (例: 用户退出后残留了 IPC 资源):

    ipcs -m -c | grep <user>     # 查该用户的段
    ipcs -m -i <shmid>           # 确认归属
    ipcrm -m <shmid>             # 删除 (要 root 或同 uid)

POSIX 兼容警告:

  man 明确说 Linux 的 ipcs **不是** POSIX 完全兼容, 不支持 POSIX 的 -a / -b / -o,
  但额外支持 POSIX 没定义的 -l / -u. 想写跨平台脚本就别用 -l / -u / -a / -b / -o.

================================================================
8. 典型排查场景
================================================================

(1) PostgreSQL 启动报 "could not create shared memory segment: Invalid argument"

  90% 是 shmmax / shmall 不够, 不是这里的问题而是 sysctl. 但先用 `ipcs -l` 看看
  内核上限是多少, 对照 PG 报的数值, 调 `/proc/sys/kernel/shmmax`.

(2) Oracle / DB2 装好之后 `ipcs` 看到一堆遗留资源, 用户已删但段还在

  status=dest 就是这个状态: 标记删除但附着数已为 0, 等最后一个 shmdt 才真释放.
  现象: shmid 列还在, nattch=0, status=dest. 通常无须手动删, 进程全退就消了.
  若已死透的进程仍残留, 多半是父进程 fork 后退出忘了 shmdt, 检查 `ipcs -m -p` 里的
  cpid / lpid, 用 `ps -p <pid>` 确认归属.

(3) 容器 / namespace 内看不到宿主的 IPC

  进程默认不共享 IPC namespace. 容器内 `ipcs` 只看自己那一份. docker 用 `--ipc=host`
  共享宿主 namespace; 用 `--ipc=container:<id>` 跟指定容器共享.

================================================================
9. 配套命令
================================================================

  ipcmk        创建 IPC 资源 (共享内存 / 消息队列 / 信号量)
  ipcrm        删除 IPC 资源 (按 key 或 id, 见 `man ipcrm`)
  ipcmk -m 1024          # 建一个 1024 字节的共享内存段
  ipcrm -m 163862        # 按 shmid 删
  ipcrm -M 0x12345678    # 按 key 删

相关系统调用 / 手册:

  shmget(2) shmat(2) shmdt(2) shmctl(2)        # 共享内存
  msgget(2) msgsnd(2) msgrcv(2) msgctl(2)      # 消息队列
  semget(2) semop(2) semctl(2)                 # 信号量
  sysvipc(7)                                  # 概述

================================================================
更新日志
================================================================

  2026-09-08  新建. 数据来自 man ipcs (util-linux 2.41.3) + 本机 /proc/sysvipc 实测.
