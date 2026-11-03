# 第 01 章 对照笔记 — 进程模型与共享内存 (PG18.6)

> 课程原文: `/home/obsidian/postgres/learn/quant67-pg-kernel/01-process-shmem.txt`
> PG18 源码: `/opt/pg-src/postgresql-18.6/`
> 证据: `evidence/ch01-process-evidence.txt` + `evidence/batch1-gdb-trace.txt`

==============================================================================

## 一、课程要点（节选）

> 每个客户端连接都是一个独立 OS 进程。Postmaster 是进程树根：监听、fork Backend、处理子进程 crash。共享内存在 fork 之前由 `CreateSharedMemoryAndSemaphores()` 一次性分配，子进程继承指针。`PGPROC` 是每个 Backend 在共享内存里的名片；`GetSnapshotData()` 扫描活跃事务列表。Background Worker 让扩展注册自定义后台进程。进程模型的代价是每连接约 5–10MB 私有内存，`max_connections` 真正的风险是 `work_mem × 连接 × 操作`。

==============================================================================

## 二、PG18 源码定位（本机 grep）

| 概念                              | 文件:行                                          | 说明                                             |
| ------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| PostmasterMain                  | `src/backend/postmaster/postmaster.c:494`     | 启动入口                                           |
| ServerLoop                      | `postmaster.c:1653`                           | `static`；accept 后 `BackendStartup`             |
| BackendStartup                  | `postmaster.c:3518`                           | `static`；调 `postmaster_child_launch`           |
| postmaster_child_launch         | `src/backend/postmaster/launch_backend.c:229` | `fork_process()` + 子进程 `InitPostmasterChild`   |
| fork_process                    | `src/backend/postmaster/fork_process.c:33`    | 对 `fork()` 的包装                                 |
| CreateSharedMemoryAndSemaphores | `src/backend/storage/ipc/ipci.c:200`          | **不在** `shmem.c`                               |
| CreateOrAttachShmemStructs      | `ipci.c:268`                                  | LWLock / XLOG / Buffer / Lock / Proc           |
| InitProcGlobal                  | `src/backend/storage/lmgr/proc.c:192`         | PGPROC 数组                                      |
| InitProcess                     | `proc.c:390`                                  | 绑定 `MyProc`                                    |
| PostgresMain                    | `src/backend/tcop/postgres.c:4188`            | 查询主循环                                          |
| PostgresSingleUserMain          | `postgres.c:4166`                             | `--single` 路径：`InitProcess` → `PostgresMain`   |
| PGPROC                          | `src/include/storage/proc.h:176`              | `xid`/`xmin` 镜像到 `ProcGlobal->xids[pgxactoff]` |
| MainLWLockArray                 | `src/include/storage/lwlock.h:74`             | ProcArrayLock = `&MainLWLockArray[4].lock`     |

==============================================================================

## 三、PG18 源码摘录

### 3.1 ServerLoop：latch / 信号 / accept

```c
/* src/backend/postmaster/postmaster.c:1653 */
static int
ServerLoop(void)
{
	for (;;)
	{
		nevents = WaitEventSetWait(pm_wait_set, DetermineSleepTime(),
								   events, lengthof(events), 0);
		for (int i = 0; i < nevents; i++)
		{
			if (pending_pm_shutdown_request)
				process_pm_shutdown_request();
			if (pending_pm_child_exit)
				process_pm_child_exit();
			if (events[i].events & WL_SOCKET_ACCEPT)
			{
				if (AcceptConnection(events[i].fd, &s) == STATUS_OK)
					BackendStartup(&s);
			}
		}
		LaunchMissingBackgroundProcesses();
	}
}
```

### 3.2 共享内存：ipci.c 而不是 shmem.c

```c
/* src/backend/storage/ipc/ipci.c:200 */
void
CreateSharedMemoryAndSemaphores(void)
{
	size = CalculateShmemSize(&numSemas);
	seghdr = PGSharedMemoryCreate(size, &shim);
	InitShmemAccess(seghdr);
	PGReserveSemaphores(numSemas);
	InitShmemAllocation();
	CreateOrAttachShmemStructs();	/* Buffer / XLOG / CLOG / Lock / Proc */
	dsm_postmaster_startup(shim);
}
```

### 3.3 PGPROC：xid 仍在结构体上，PGXACT 已消失

```c
/* src/include/storage/proc.h:176 */
struct PGPROC
{
	TransactionId xid;		/* mirrored in ProcGlobal->xids[pgxactoff] */
	TransactionId xmin;
	int			pid;
	int			pgxactoff;
	ProcWaitStatus waitStatus;
	LOCK	   *waitLock;
	uint32		wait_event_info;
	/* ... */
};
```

==============================================================================

## 四、PG18 vs 课程（PG17）差异

1. **`CreateSharedMemoryAndSemaphores` 在 `ipci.c:200`**，旧骨架写 `shmem.c` 是错的。
2. **没有 `struct PGXACT`**。xid/xmin 在 `PGPROC` 上，并镜像到 `ProcGlobal` 数组；课程 Ch.03 仍按 PGXACT 讲，到那章再对。
3. **fork 路径**：`BackendStartup` → `postmaster_child_launch`（`launch_backend.c`）→ `fork_process()`。不是 `fork_process.c:BackendStartup`。
4. **PG18 AIO**：进程树多了 `postgres: io worker 0/1/2`，`pg_stat_activity.backend_type = io worker`。课程进程表没有这一行。
5. **`--single` 入口**是 `PostgresSingleUserMain`，不是 Postmaster 的 `ServerLoop`。GDB 在 `--single` 里看不到 fork。

==============================================================================

## 五、实操

多进程实例：`/tmp/pg18-data`，`shared_buffers=128MB`。

- 进程树：postmaster 19794 → io worker ×3 + checkpointer + bgwriter + walwriter + autovacuum launcher + logical replication launcher。
- `pg_shmem_allocations`：`Buffer Blocks` = 134221824（128MB）；合计约 150MB。
- 后已 `setcap cap_sys_ptrace+ep /usr/bin/gdb`（scope 仍为 1，但 gdb 可跨进程 attach）。
- `gdb -p` 活 backend **成功**：空闲栈在 `WaitEventSetWait` → `ReadCommand`；`MyProc->pid` 与 `pg_backend_pid()` 一致，空闲时 `xid=0`。证据：`evidence/ch01-gdb-attach.txt`。
- `postgres --single` 仍可用于启动路径：命中 `InitProcess`（`proc.c:398` ← `PostgresSingleUserMain:4166` ← `main:223`），随后 `PostgresMain:4189`。

完整输出：`evidence/ch01-process-evidence.txt`。

==============================================================================

## 六、交接

下一章看 8KB 页和 `HeapTupleHeaderData`。本机已确认 `pageinspect` 可用；GDB 黄金断点是 `heap_insert`（`heapam.c:2081`）。
