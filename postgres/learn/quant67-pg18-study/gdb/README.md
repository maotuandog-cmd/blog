# PG18 GDB 调试操作手册

> 适用: PostgreSQL 18.6 (源码 /opt/pg-src/postgresql-18.6/, 安装 /opt/pg-18/)
> GDB: GNU gdb 17.1 (Ubuntu)
> PG 编译选项: `-O0 -g3 -ggdb -fno-omit-frame-pointer` (源码树已配 enable_debug=yes)
> 工具位置: /home/obsidian/postgres/learn/quant67-pg18-study/gdb/
> helper: ~/.gdbinit + ~/.hermes/cache/pg18gdb.py

---

## 1. 环境前提 (一次性)

### 1.1 GDB 安装 (已确认)
```
which gdb       # /usr/bin/gdb
gdb --version   # GNU gdb 17.1
```

### 1.2 PG18 带 debug 符号 (已确认)
```
file /opt/pg-18/bin/postgres
# ELF 64-bit LSB pie executable, ... with debug_info, not stripped
```

### 1.3 ptrace 权限 (2026-09-07 已用 setcap 打通)

`ptrace_scope` 仍为 1，但 `/usr/bin/gdb` 已 `cap_sys_ptrace=ep`，普通用户可以对同 uid 的 postgres backend 做 `gdb -p`。

若换机器仍 attach 失败，再选下面之一：
```bash
# 选项 A: 临时改 (重启失效), 需 root
sudo sysctl -w kernel.yama.ptrace_scope=0

# 选项 B: 永久改
echo 'kernel.yama.ptrace_scope = 0' | sudo tee /etc/sysctl.d/10-ptrace.conf
sudo sysctl -p /etc/sysctl.d/10-ptrace.conf

# 选项 C: sudo 直接跑 GDB (需要 NOPASSWD 或临时授权)
sudo -v           # 缓存 5 分钟
sudo gdb -p <pid>

# 选项 D: setcap 让 GDB 自己有 ptrace 能力 (永久, 不用 root)
sudo setcap cap_sys_ptrace+ep /usr/bin/gdb
# 然后普通用户就能 attach
```

### 1.4 helper 已装位置
```
~/.gdbinit                                 # 主入口
~/.hermes/cache/pg18gdb.py                 # PG18 pretty printer + 自定义命令
/home/obsidian/postgres/learn/quant67-pg18-study/gdb/pg18gdb.py  # 备份
```
启动 GDB 会自动 source, 看到 `[pg18gdb] loaded from ...` 即就绪。

---

## 2. 三种 attach 方式

### 2.1 附加到运行中的 backend (推荐: 调试慢查询/锁等待)
```bash
# 步骤 1: 启动 PG
pg_ctl -D /tmp/pg18-data start

# 步骤 2: 找到目标 backend pid
psql -c "SELECT pid, application_name, state, query FROM pg_stat_activity WHERE backend_type='client backend';"

# 步骤 3: 启动 GDB 并 attach
gdb -p <pid>
(gdb) pgsetup          # 必须! 设置 GDB 不拦截 PG 信号
(gdb) bt               # 看当前栈 (psql 空闲时停在 read() syscall)
(gdb) pgproc           # 打印 PGPROC: pid/xid/xmin/waitStatus
(gdb) pglocks          # 打印 ProcArrayLock / WALInsertLock 状态
```

### 2.2 从启动起 debug (PostgresMain → Parser → Planner → Executor 全程跟)
```bash
# 方式 A: 用 postgres 直接启动 single-user 模式
gdb --args /opt/pg-18/bin/postgres --single -D /tmp/pg18-data dbname
(gdb) break PostgresMain
(gdb) run

# 方式 B: 让 PG 等在 PostmasterMain 入口, 然后你用 psql 连进来再设断点
gdb --args /opt/pg-18/bin/postgres -D /tmp/pg18-data -h /tmp -p 5432 -w
(gdb) break PostmasterMain
(gdb) run
# 等打印 "database system is ready", 然后另一终端:
psql -h /tmp -U postgres -c "SELECT 1"
# 在 GDB 窗口设断点:
(gdb) break ExecutorRun
(gdb) continue
```

### 2.3 core dump 事后分析
```bash
# 让 PG 在 crash 时产生 core
ulimit -c unlimited
echo '/tmp/core.%e.%p' | sudo tee /proc/sys/kernel/core_pattern

# 启动 PG, 触发 crash (例如发 SIGSEGV)
psql -c "SELECT pg_backend_pid()" -tA | xargs -I {} sudo kill -SEGV {}

# 用 GDB 打开 core
gdb /opt/pg-18/bin/postgres /tmp/core.postgres.<pid>
(gdb) bt full
(gdb) pgproc
```

---

## 3. helper 自定义命令清单

加载后 (gdb 启动打印 "pg18gdb ready") 可用:

| 命令 | 作用 | 例 |
|---|---|---|
| `pgsetup` | 关 scheduler-locking / SIGUSR1,2 不拦截 | `pgsetup` |
| `pgproc` | 打印 MyProc (PGPROC: xid/xmin/waitStatus) | `pgproc` |
| `pglocks` | 打印 ProcArrayLock/WALInsertLock 状态 | `pglocks` |
| `pgshare` | 打印共享内存全局变量 (NBuffers/MaxBackends) | `pgshare` |
| `pgheap <addr>` | 打印 HeapTupleHeaderData (含 t_infomask 解码) | `pgheap MyTuple->t_data` |
| `pgpage <addr>` | 打印 PageHeaderData (lower/upper/flags) | `pgpage PageGetHeader(page)` |
| `pgbtpage <addr>` | 打印 BTPageOpaqueData (high key/rightlink/level) | `pgbtpage opaque` |
| `pglwlock <addr>` | 打印 LWLock 状态 (FREE/SHARED(n)/WAITERS) | `pglwlock ProcArrayLock` |
| `pgxlog <addr>` | 打印 XLogRecord 头 (rmid/tot_len/info) | `pgxlog record` |

---

## 4. PG18 内核黄金观测点 (按章节)

| 章节 | 函数 | 触发操作 | 看什么 |
|---|---|---|---|
| Ch.01 进程模型 | PostmasterMain, ServerLoop | 启动 PG | bt 看 fork 流程 |
| Ch.02 页面布局 | heap_form_tuple, heap_deform_tuple | INSERT / SELECT | pgheap 看 t_infomask |
| Ch.03 MVCC | HeapTupleSatisfiesMVCC | SELECT (读行) | pgheap 看 xmin/xmax hint bit |
| Ch.04 WAL | XLogInsert, XLogFlush | 任意写入 | pgxlog 看 rmgr (Btree/Heap/...) |
| Ch.05 Buffer | ReadBuffer, PinBuffer | 首次读表 | pgshare 看 NBuffers, bt 看 bufmgr.c |
| Ch.06 锁 | LWLockAcquire, DeadLockCheck | 并发 UPDATE | pglocks 看 waiters, pgproc 看 waitStatus |
| Ch.07 事务 | StartTransaction, CommitTransaction | BEGIN/COMMIT | pgproc 看 xid 变化 |
| Ch.08 VACUUM | lazy_scan_heap | VACUUM ANALYZE | pgpage 看 dead tuple, pgproc 看 xmin 不动 |
| Ch.09 解析 | raw_parser, parse_analyze | 任意 SQL | bt 看 parser.c → analyze.c |
| Ch.11 Join | hash_join, ExecHashJoin | 大表 hash join | bt 看 hash join 路径 |
| Ch.12 执行器 | ExecProcNode, ExecQual | 复杂 WHERE | bt 看 Volcano 调度 |
| Ch.14 B-Tree | _bt_insert, _bt_split | INSERT 触发分裂 | pgbtpage 看分裂前后页 |
| Ch.15 GiST | gistinsert, gistSplit | GiST 插入 | bt 看 gist.c |
| Ch.16 GIN | ginEntryInsert, processPending | GIN 插入 | bt 看 ginfast.c |

---

## 5. 实战脚本示例

### 5.1 观察一次 SELECT 走完整 Volcano 调度
```
gdb --args /opt/pg-18/bin/postgres --single -D /tmp/pg18-data postgres
(gdb) break PostgresMain
(gdb) run
# 输入: SELECT * FROM t_btree WHERE id BETWEEN 100 AND 200;
# 停在 PostgresMain, 然后:
(gdb) bt
# 看完后 continue, 让它跑完
```

### 5.2 抓一次 _bt_split (B-Tree 分裂的源码级 trace)
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break _bt_split
(gdb) commands
  silent
  printf "_bt_split at rel=%s page=%u level=%u\n", relation_get_descr(rel), page, opaque->btpo_level
  bt 3
  continue
end
(gdb) continue
# 另一窗口: INSERT 大批量数据
INSERT INTO t_btree SELECT i, 'x' FROM generate_series(1000, 10000) i;
# GDB 会停在每次 _bt_split, 打印分裂的表/页号/层级
```

### 5.3 看 Buffer 被钉住时谁在等
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) pgproc           # 看 waitStatus, waitLock, waitLockTag
(gdb) p MyProc->waitLock
(gdb) pglwlock ProcArrayLock   # 看 ProcArrayLock 是否 WAITERS
```

### 5.4 看 hint bit 写入时机
```
gdb -p <backend_pid>
(gdb) pgsetup
(gdb) break HeapTupleSatisfiesMVCC
(gdb) commands
  silent
  printf "HeapTupleSatisfiesMVCC: snapshot.xmin=%u xmax=%u\n", snapshot->xmin, snapshot->xmax
  continue
end
(gdb) continue
# 另一窗口: SELECT 一行新插入的数据 (第一次读会写 hint bit)
```

---

## 6. 常见坑

### 6.1 attach 失败: "ptrace: Operation not permitted"
原因: ptrace_scope=1 (restricted), 同用户不同进程不能 attach
解决: 见 1.3 选项 A/B/C/D

### 6.2 attach 后 backend 卡死
原因: GDB 默认会拦截 SIGUSR1 (PG 用它发信号)
解决: 立即 `pgsetup` 或在 attach 后立即:
```
handle SIGUSR1 nostop noprint pass
handle SIGUSR2 nostop noprint pass
handle SIGPIPE nostop noprint pass
set scheduler-locking off
```

### 6.3 `p MyProc` 报 "optimized out"
原因: PG 编译时开了优化, 变量被寄存器化
本机已 `-O0`, 但如果用了其他构建, 加 `-O0` 重编:
```
cd /opt/pg-src/postgresql-18.6
CFLAGS='-O0 -g3' ./configure --enable-debug --prefix=/opt/pg-18-debug
make -j$(nproc) install
```

### 6.4 `p MyTuple->t_data` 显示 None
原因: tuple 可能在 buffer 里, 不是 heap 变量
解决: 先 `p MyTuple` 找到 t_self/t_data 地址, 再 `pgheap <addr>`

### 6.5 断点命中后 query 一直不返回
原因: 默认 scheduler-locking=on, GDB 暂停所有线程, PG 死锁
解决: `pgsetup` 或 `set scheduler-locking off`

### 6.6 函数名找不到 (像 nbtree 的内联函数)
```
(gdb) info functions _bt_insert
(gdb) info functions _bt_doinsert
(gdb) info functions _bt_insertonpg
# 找到准确的非 inline 函数名
```

### 6.7 SIGUSR1 是什么
PG 用 SIGUSR1 在某些场景唤醒 backend, 比如 cancellation signal. 默认 stop 会让 backend 真正卡住.

---

## 7. 快速参考表

```bash
# PG18 启动
pg_ctl -D /tmp/pg18-data -l /tmp/pg18.log start
pg_ctl -D /tmp/pg18-data stop -m fast

# 看 backend pid
psql -c "SELECT pid, state, query FROM pg_stat_activity;"

# GDB 启动
gdb -p <pid>                            # attach
gdb --args postgres --single -D data    # single user
gdb postgres /tmp/core.postgres.<pid>   # core dump

# GDB 必跑三条
(gdb) pgsetup
(gdb) bt
(gdb) pgproc
```

---

## 8. 验证 (手动执行)

```bash
# 用户手动测试 (需 sudo)
sudo setcap cap_sys_ptrace+ep /usr/bin/gdb   # 永久, 一次
gdb -p <backend_pid>
> pgsetup
> pgproc           # 应打印 MyProc 字段
> pglocks          # 应打印 LWLock 状态
> bt 5             # 应有栈
> detach
> quit
```

---

作者: maotuan (PG18 内核学习)
版本: v1.0 (PG 18.6 + GDB 17.1)
最后更新: 2026-09-03
