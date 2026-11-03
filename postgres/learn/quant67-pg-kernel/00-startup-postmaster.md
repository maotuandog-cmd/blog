# PostgreSQL 18.6 启动全过程（从 main 到 PM_RUN / 关机）

> 来源：对照 `/opt/postgresql-18.6` 源码，以及本机 gdb 跟 `main()` / `PostmasterMain` 的过程。
> 环境：二进制 `/opt/pg-18/bin/postgres`（`-O0 -g3 --enable-debug --enable-cassert`），数据目录 `/tmp/pg18-data`，源码工作区 `/opt/postgresql-18.6`（编译路径 `/opt/pg-src/postgresql-18.6`，gdb 需 `substitute-path`）。
> 前置课：本章是 [[01-process-shmem]] 的「启动时序」补篇——01 讲进程模型和共享内存结构，这里讲它们是怎么被拉起来的。

==============================================================================

## 一句话

同一个 `postgres` 二进制：`main()` 把进程外壳搭好 → `PostmasterMain` 当调度器（读配置、锁目录、建 shmem、听端口）→ fork startup 做 `StartupXLOG` → 进入 `ServerLoop`（`PM_RUN`）对外服务。关机再按状态机写 checkpoint、拆 socket 和 pid 文件。

Postmaster **创建**共享内存，但自己几乎不碰、也不进 `PGPROC`。恢复、刷盘、执行 SQL 都在子进程里。

==============================================================================

## 总览

```
pg_ctl start / postgres -D $PGDATA
        │
        ▼
   main()                         所有进程入口  src/backend/main/main.c
        │
        ▼
   PostmasterMain()               多进程调度器  src/backend/postmaster/postmaster.c
        │
        ├── 读配置、锁数据目录、建共享内存、听端口
        ├── fork io_worker / checkpointer / bgwriter
        └── fork startup ──► StartupXLOG()     WAL 恢复
                                    │
                                    ▼  exit 0
                              PM_RUN + ServerLoop()
                                    │
                              accept → fork backend → PostgresMain
```

==============================================================================

## 阶段 0：`main()` — 任何 postgres 进程都走这里

`src/backend/main/main.c`。这时还没有数据目录、没有共享内存，只能做**进程级**准备。

```c
int main(int argc, char *argv[])
{
	reached_main = true;
	progname = get_progname(argv[0]);
	startup_hacks(progname);
	argv = save_ps_display_args(argc, argv);   /* 尽早：可能搬 environ */
	MyProcPid = getpid();
	MemoryContextInit();                       /* 此后才能 palloc / ereport */
	set_stack_base();
	/* locale、--help/--version、禁止 root */
	/* 按 argv 分发 */
	PostmasterMain(argc, argv);                /* 日常启动 */
}
```

### 0.1 `save_ps_display_args`（`src/backend/utils/misc/ps_status.c`）

**不只是算 buffer 大小。** Linux 上 (`PS_USE_CLOBBER_ARGV`) 要给以后改 `ps` 标题腾地方：

1. 记下原始 `argc` / `argv`。
2. 量 `argv` 各字符串是否首尾相接，后面的 `environ` 是否紧跟着 → `ps_buffer = argv[0]`，`ps_buffer_size = end_of_area - argv[0]`。这是**原 argv/环境区有多少字节可以覆盖**，不是新 malloc 一块标题缓冲区。
3. 整表 `strdup` 搬走 `environ`，避免原字符串被覆盖后 `getenv()` 悬空。
4. 再拷一份 `argv` 返回；后面 `getopt` 用拷贝。原始 `argv` 留给 `init_ps_display()` / `set_ps_display()` 去写成 `postgres: writer` 这类标题。

`main()` 里强调尽早调用：后面不要还握着旧的 `getenv()` 指针。

gdb：这里有遍历 `environ` 的循环。循环体内不要留断点再 `until`——`until` 碰到任何断点都会停。跳出用 `until <循环后行号>` 或 `finish`。

### 0.2 `MemoryContextInit`（`src/backend/utils/mmgr/mcxt.c`）

**目的：** 把进程自己的分配器立起来，让后面所有 `palloc` / `ereport` 都有地方落。不是「先囤 8MB」。

建两个 AllocSet：

| context | 这次真正 malloc | `maxBlockSize` 字段 | 作用 |
|---|---|---|---|
| TopMemoryContext | 约 8KB（init） | 8MB（以后新 block 上限） | 所有其它 context 的**唯一根** |
| ErrorContext | 8KB（min=init=max 都是 8K） | 8KB | Top 的第一个孩子；报错路径专用；临界区也能分配 |

`CurrentMemoryContext` 先指向 Top（占位，后面会切）。`elog.c` 把 `ErrorContext != NULL` 当成「内存管理已经能用了」。

gdb：

```
p ((AllocSet)TopMemoryContext)->maxBlockSize   /* 8388608 */
p ((AllocSet)TopMemoryContext)->freelist[0]    /* 0x0，空链表头 */
```

#### 建这棵 Top 树是为了什么

按「活多久」成片回收，而不是每块 `malloc` 配对一次 `free`。一条消息、一个事务、一次查询寿命天然成组；ERROR / abort 时不可能记清每个指针。做法是：`palloc` 只认当前 context，不要了就 `Reset`/`Delete` 那一层（含子节点）。

`palloc.h` 原话：整个 context 的内容可以通过 reset/delete **既快又不容易泄漏**地释放；组织成树是为了在细粒度寿命和「该放的一定能放到」之间取得确定。

```
本进程（fork 后各自一份，不是全集群共用）
TopMemoryContext                 进程还在就在；几乎不 Reset
 ├── ErrorContext                报错随时能分配
 ├── PostmasterContext           只属于 postmaster；子进程删掉
 ├── GUCMemoryContext            配置
 ├── CacheMemoryContext          会话级 catalog
 ├── MessageContext              一条协议消息；每条 SQL 后 Reset
 └ TopTransactionContext
      └ CurTransactionContext    事务 / 子事务
```

`PortalContext` 一般**不是**长期挂在 Top 下的固定节点，而是指向「当前 portal」的指针。没有名叫 Session 的标准 context，会话级更接近 Cache。

| 没有这棵树 | 有这棵树 |
|---|---|
| 每条 SQL 自己 `free`，ERROR 极易泄漏 | 切回合适 context，`Reset` 一层就干净 |
| 事务 abort 不知道哪些指针还有效 | abort = 丢掉事务子树 |
| fork 后分不清父进程临时货和子进程还要用的 | 临时货在 Postmaster；长期货在 Top |
| OOM 时连拼错误消息的内存都没有 | ErrorContext 单独留着 |

越靠上寿命越长。一个对象放进哪个 context，本质是在决定**它什么时候被自动释放**。

#### `TopMemoryContext` 存什么 / 不存什么

全局变量是指针，不是结构体本身：

```c
MemoryContext TopMemoryContext = NULL;   /* mcxt.c */
```

`MemoryContext` = `MemoryContextData *`。真正的对象是 `AllocSetContext`：前面是公共头，后面是 `blocks` / `freelist` / `maxBlockSize`。

公共头（`src/include/nodes/memnodes.h`）：

| 字段 | 作用 |
|---|---|
| `type` | AllocSet / Slab / … |
| `methods` | alloc / reset / delete 函数表 |
| `parent` | Top 的 parent 是 `NULL`（唯一根，不是「根之一」） |
| `firstchild` / `nextchild` | 孩子链表：Error、Postmaster、Cache… |
| `name` | `"TopMemoryContext"` |
| `mem_allocated` | 本 context 已向 OS 要的总量 |

**当根 ≠ 所有内存都从 Top 那块切。** 孩子 `AllocSetContextCreate(Top, …)` 会再 `malloc` 自己的 block，只是把头挂在 Top 下。Top 当根的意义是进程退出或删根时整棵子树一起回收。

真正 `palloc` 进 Top 的，是必须活到进程结束、fork 之后子进程还要用的少量长期对象。postmaster 注释：日常分配走 `PostmasterContext`（backend 可回收）；**子进程还要用的才放 Top**。

| 会进 Top（或必须挂在 Top 下） | 不进 Top |
|---|---|
| 其它 MemoryContext 节点（树的挂载） | 表数据、`shared_buffers`（那是 **shmem**） |
| GUC 的 context | 当前 SQL 的解析树 / 执行状态（Message） |
| 连接 `Port`、远端 host/port | 一次事务里的临时结果（Transaction） |
| search_path 等会话级列表 | catalog cache（CacheMemoryContext） |

8KB 是**当时 malloc 的初始块**，8MB 是**单块上限**，不是 Top 总容量，更不是全集群配额。不够就再要下一块；超大请求单独 `malloc`。Error 的 8KB 只给**本进程**报错，不是给所有进程当仓库。每个 fork 出来的进程各有一份私有 Top。

#### `palloc`：怎么分到这块树上

backend 里几乎不用直接 `malloc` 管业务内存。接口在 `src/include/utils/palloc.h`，实现 `src/backend/utils/mmgr/mcxt.c`。

```c
void *palloc(Size size)
{
	MemoryContext context = CurrentMemoryContext;
	context->isReset = false;
	return context->methods->alloc(context, size, 0);  /* AllocSet 则进 AllocSetAlloc */
}
```

`palloc0` 先分配再清零。指定 context 用 `MemoryContextAlloc(ctx, size)`，等价于临时不靠 `CurrentMemoryContext`。

和 `malloc` 的差别：

```
malloc / free          每块自己配对
palloc + Reset(ctx)    这一层寿命的分配整片丢掉
```

**AllocSet 上一次 `palloc` 的路径**（`aset.c` `AllocSetAlloc`）：

1. 请求大于 `allocChunkLimit`（典型约 8KB）→ 单独 `malloc` 一整块，不进 freelist。
2. 否则算档位 `fidx`（8B、16B、…、8KB 共 11 档）。
3. `set->freelist[fidx]` 非空 → 从链表头摘一块复用（**不找 OS**）。
4. 链表空 → 从当前 block 的 `freeptr`～`endptr` 切；不够再 `malloc` 新 block（`nextBlockSize` 翻倍，封顶 `maxBlockSize`）。

`pfree`：小块推进对应 `freelist[fidx]`；过大的整块 `free()` 还给系统。

`MemoryContextSwitchTo(ctx)` 只改 `CurrentMemoryContext`。之后的 `palloc` 都属于这一层寿命。

#### 空的 `freelist` 存的是什么

**什么有效数据都不存。** 它是 AllocSet 头里的 11 个链表头：

```c
MemoryChunk *freelist[ALLOCSET_NUM_FREELISTS];  /* 11 */
MemSetAligned(set->freelist, 0, sizeof(set->freelist));
```

空 = 全 `NULL` = 这一档还没有 `pfree` 回来的 chunk。数组本身那点空间在 context 头里，不是空闲内存池。

未切过的空间在 **block 的 `freeptr`～`endptr`**，不在 freelist 上。第一次 `palloc` 从这里切；切剩的零头或之后的 `pfree` 才会挂到某档 freelist。另有 `context_freelists[]` 回收整颗已删除的 AllocSet，启动时也是空的。

#### 第一次 `palloc` 和一条 SQL 结束

```
main()
  MemoryContextInit()
    Top = AllocSetContextCreate(NULL, …)     /* parent == NULL，唯一根 */
    CurrentMemoryContext = Top
    Error = AllocSetContextCreate(Top, …)
  …
  PostmasterMain()
    PostmasterContext = AllocSetContextCreate(Top, "Postmaster", …)
    MemoryContextSwitchTo(PostmasterContext) /* 之后默认 palloc 进这里 */
```

`MemoryContextInit` 刚返回时，`CurrentMemoryContext == Top`，最早那几次分配在 Top 的 keeper 块里。一进 `PostmasterMain` 就切走。子进程删 PostmasterContext，再建 Cache / Message / Transaction，仍挂在**这份进程私有的 Top** 下。

一条 SQL 结束时 **Top 不会被释放**。Backend 主循环（`PostgresMain`）大致：

```
收到一条消息
  MemoryContextReset(MessageContext)      /* 上一条的解析/计划临时货 */
  切到 MessageContext，解析执行
  事务提交/中止 → Reset TopTransactionContext
回到循环
```

丢掉的是 Message / Transaction。Top 和 Cache 还在。连接不断就不拆根；进程退出整棵树随进程一起没。

### 0.3 分发

| 参数 | 去向 |
|---|---|
| 无特殊前缀（日常 `pg_ctl start`） | `PostmasterMain` |
| `--single` | 单用户，同进程做恢复，无 postmaster |
| `--boot` | initdb 用的 bootstrap |
| `--forkchild` | EXEC_BACKEND 下子进程再进一次 `main` |

==============================================================================

## 阶段 1：`PostmasterMain` — 把集群外壳搭好（`PM_INIT`）

`src/backend/postmaster/postmaster.c`，`PostmasterMain()` 约 494 行。

### 1.0 怎么理解「外壳」和 `PM_INIT`

**`PM_INIT` 首先是一个状态标签，但「把集群外壳搭好」指的是还停在这个标签期间真正去建的那些东西。不是改一个枚举就完事。**

大方向可以记成：*`PM_INIT` 是 postmaster 自己的准备阶段，做完才改成 `PM_STARTUP`。* 但有几处必须掰开，否则会和源码对不上。

#### 分层：`main()` 的进程外壳 vs `PostmasterMain` 的集群外壳

Top / Error / freelist **不在** `PostmasterMain` 里，那是更早的 `main()` → `MemoryContextInit()`。没有它们，后面连 `ereport` 都不能用。

进了 `PostmasterMain` 之后，再建一个 **`PostmasterContext`**（挂在 Top 下面），专门给 postmaster 自己的 `palloc` 用；backend fork 出去后可以扔掉这块。

| 阶段 | 做什么 |
|---|---|
| `main()` | **进程级**外壳：`save_ps_display_args`（argv/environ）、`MemoryContextInit`（Top / Error，freelist 为空）、locale、拒绝 root |
| `PostmasterMain` 且仍为 `PM_INIT` | **集群级**外壳：信号、GUC/配置、数据目录、`postmaster.pid`、共享内存、listen socket、HBA…… |

准备阶段**不止**「参数 + pid + HBA」。这三样都有，但漏了 shmem / 端口 / 信号，外壳就不完整：

| 常被提到 | 同样关键、容易漏 |
|---|---|
| 命令行 / GUC / `postgresql.conf` | 信号处理器（关机、reload、SIGCHLD） |
| `postmaster.pid` | `checkDataDir`、进数据目录 |
| `pg_hba.conf` / ident | **共享内存和信号量**（锁、缓冲池、ProcArray） |
| | **listen socket**（TCP / Unix） |
| | 可选 syslogger |

没有 shmem 和 listen，后面 fork 出来的 startup / backend 没地方协作，也没人能连进来。

#### 名与实：先干活，再换标签

`pmState` 一开始就是 `PM_INIT`（注释：`postmaster starting`）。`PostmasterMain` 前大半段都还停在这个值上，直到初始化做完才：

```
AddToDataDirLockFile(..., PM_STATUS_STARTING);
UpdatePMState(PM_STARTUP);    /* 先干活，再换标签 */
```

源码注释也是这个顺序：*After doing all the postmaster initialization work, we enter PM_STARTUP*。

| | 含义 |
|---|---|
| **名：`PM_INIT`** | Postmaster 自己还在开工，startup 子进程还没 fork |
| **实：外壳** | pid、shmem、端口、HBA 这些服务进程赖以存在的外部设施 |
| **切到 `PM_STARTUP`** | 外壳已经齐了，**开始拉 startup 去做 WAL 恢复** |

「外壳」是相对「数据库已经能用」来说的。这段建的**不是**用户表，也**不是** WAL redo，而是集群作为多进程服务能站住的那一层。全部还在 **一个进程里、顺序执行**，不接受真正的客户端 backend。

状态变量的用处是给**后面的主循环当门禁**，不是初始化的目的：

- `PM_INIT` / `PM_STARTUP`：来了连接只 fork dead-end，回「还在启动」
- `PM_RUN` / `PM_HOT_STANDBY`：才允许正常 backend

#### `PM_STARTUP` ≠ master 已经对外服务

postmaster **进程**从 `main()` 开始就在跑。`UpdatePMState(PM_STARTUP)` 只表示：自己的初始化做完了，接下来 fork checkpointer / bgwriter / **startup 子进程**，等 WAL 恢复。

集群真正能接读写连接是更后面的 **`PM_RUN`**（startup `exit 0` 之后）。`PM_STARTUP` 时来连接只会收到「还在启动」。

收成一句：

> **`PM_INIT`：postmaster 在搭集群外壳（配置、pid、shmem、端口、HBA……）；切到 `PM_STARTUP`：外壳齐了，开始拉 startup 去做恢复。Top/Error 属于更早的 `main()`，不是这一段才建的。**

gdb 里会先在 `PostmasterMain` 里走很久，`pmState` 一直是 `PM_INIT`，直到 `UpdatePMState(PM_STARTUP)` 那一行才变。可看：

```
p pmstate_name(pmState)     /* 此时仍是 PM_INIT */
p pmstate_name(newState)    /* 第一次 UpdatePMState 时是 PM_STARTUP */
```

### 1.1 外壳具体建了什么

进 `ServerLoop` 前顺序做完。没有这些，后面的 startup / backend 都站不住：

| 建了什么 | 没有它会怎样 |
|---|---|
| GUC + 数据目录 | 不知道集群在哪、参数是什么 |
| `postmaster.pid` | 两个实例抢同一目录 |
| 共享内存 / 信号量 | 子进程无法协作（锁、缓冲池、ProcArray） |
| listen socket | 以后没地方 accept |
| `pg_hba.conf` | 即使起来了也不能认证 |
| 信号处理器 | 无法关机、无法收孩子退出 |

#### `PostmasterMain` 按源码顺序（约 494–1409 行）

函数前大半段都在**一个进程里**搭外壳，`pmState` 一直是 `PM_INIT`。正常情况最后的 `ServerLoop()` **不再返回**。

**1. 进程身份和内存（502–537）**

- `InitProcessGlobals()`，记下 `PostmasterPid`，`IsPostmasterEnvironment = true`
- `umask` 先收紧，等 `checkDataDir` 再按数据目录权限改
- 建 **`PostmasterContext`**（挂在 Top 下），`MemoryContextSwitchTo` 过去  
  之后日常 `palloc` 进这里；子进程 fork 后还要用的才放 Top
- `getInstallationPaths`：根据可执行文件位置找到 `lib/` 等安装路径

**2. 信号和等待原语（548–585）**

| 信号 | 作用 |
|---|---|
| SIGHUP | reload |
| SIGTERM / SIGINT / SIGQUIT | smart / fast / immediate 关机 |
| SIGUSR1 | 子进程 pmsignal |
| SIGCHLD | 孩子退出 |
| SIGPIPE / SIGALRM 等 | 忽略 |

然后 `InitializeWaitEventSupport`、`InitProcessLocalLatch`，再解阻塞信号。

**3. 参数和配置（590–837）**

- `InitializeGUCOptions()`
- `getopt` 解析 `-D/-p/-c/-d` 等，写进 GUC
- `SelectConfigFiles`：定位数据目录，**第一次读 `postgresql.conf`**
- `-C guc`：多数 GUC 这里打印就退出（给 `pg_ctl` 用，此时还没锁目录）
- `checkDataDir` / `checkControlFile` / `ChangeToDataDir`：确认是真集群并 `chdir` 进去
- 交叉检查：`max_connections`、`wal_level` 与归档/复制是否冲突

**4. 锁目录、读控制文件、扩展（911–975）**

- **`CreateDataDirLockFile(true)`** → 写 `postmaster.pid`（先于绑端口，互斥更可靠）
- `LocalProcessControlFile`：读 `pg_control`（含子进程要继承的 CRC 实现）
- `ApplyLauncherRegister`：逻辑复制 apply launcher 先占 bgworker 槽
- `process_shared_preload_libraries`；可选初始化 SSL
- `InitializeMaxBackends`、`InitPostmasterChildSlots`、`InitializeFastPathLocks`
- `process_shmem_requests` → `InitializeShmemGUCs`（模块要完额外 shmem 后再算依赖共享内存大小的 GUC）
- 运行时 GUC 的 `-C` 若还没打，这里打完退出

**5. 共享内存和子进程通信（1004–1016）**

- **`CreateSharedMemoryAndSemaphores()`**：缓冲池、锁表、ProcArray、WAL 缓冲等一次性建好，fork 后孩子继承指针。postmaster 建完就尽量不再碰
- `set_max_safe_fds`
- `InitPostmasterDeathWatchHandle`：管道，孩子用来发现 postmaster 死了

##### shared_buffers 怎么初始化

**不是单独 mmap 一块「缓冲池」就完事。** 它是上面整段共享内存里，按名字切出来的几块结构。初始化时**不预读任何表页**；第一次 `ReadBuffer` 才从磁盘填槽。

调用链（仍在 `PM_INIT`、`CreateSharedMemoryAndSemaphores` 内）：

```
CreateSharedMemoryAndSemaphores()          /* ipci.c:200 */
  CalculateShmemSize()                     /* 含 BufferManagerShmemSize() */
  PGSharedMemoryCreate(size)               /* 向 OS 要一整段 mmap/SysV */
  InitShmemAllocation()
  CreateOrAttachShmemStructs()
    CreateLWLocks()
    InitShmemIndex()
    …
    BufferManagerShmemInit()               /* buf_init.c：切槽 + 填描述符 */
      StrategyInitialize()                 /* freelist.c：哈希 + 时钟扫描 */
```

GUC `shared_buffers` 对应全局 `NBuffers`（单位 **BLCKSZ 页**，默认 8KB）。默认 **16384** = 128MB，最少 16 页，`PGC_POSTMASTER`（改了必须重启）。

**① 先算大小，再向 OS 要一整段**

`BufferManagerShmemSize()` 加进总 shmem 的部分：

| 一块 | 大小 |
|---|---|
| Buffer Descriptors | `NBuffers * sizeof(BufferDescPadded)`（64B 对齐，防 false sharing） |
| Buffer Blocks | `NBuffers * BLCKSZ` + `PG_IO_ALIGN_SIZE`（4KB）对齐填充 |
| Buffer IO CV | 每页一个 condition variable |
| Checkpoint BufferIds | checkpointer 排序用 |
| 查找哈希 + StrategyControl | `StrategyShmemSize()` |

`PGSharedMemoryCreate` **一次**向内核要整段。缓冲池不是第二次 mmap，而是后面 `ShmemInitStruct("名字", size, &found)` 从这段里切：第一次 `found=false` 并 `ShmemAlloc`；EXEC_BACKEND 再跑时 `found=true`，只接指针。

**② `BufferManagerShmemInit`：切四块，填描述符**

```c
BufferDescriptors = ShmemInitStruct("Buffer Descriptors", NBuffers * sizeof(BufferDescPadded), …);
BufferBlocks = TYPEALIGN(PG_IO_ALIGN_SIZE,
    ShmemInitStruct("Buffer Blocks", NBuffers * BLCKSZ + PG_IO_ALIGN_SIZE, …));
BufferIOCVArray = ShmemInitStruct("Buffer IO Condition Variables", …);
CkptBufferIds   = ShmemInitStruct("Checkpoint BufferIds", …);
```

每个 `BufferDesc` 启动时：

| 字段 | 初值 | 含义 |
|---|---|---|
| `tag` | 清空 | 还没绑定任何关系/块号 |
| `state` | 0 | 无 pin、无 dirty、无 valid |
| `buf_id` | `i` | 下标 0..NBuffers-1 |
| `freeNext` | `i+1`（最后一个是链表结束） | 全部串成一条空闲链 |
| `content_lock` | `LWTRANCHE_BUFFER_CONTENT` | 保护页内容 |
| IO CV | `ConditionVariableInit` | 等 IO 完成 |

`BufferBlocks[i * BLCKSZ]` 此时**没有有效页面**，只是预留的 8KB 槽。对应关系：`BufferDescriptors[i]` ↔ `BufferBlocks + i * BLCKSZ`。

**③ `StrategyInitialize`：查找表 + 时钟扫描**

- `InitBufTable(NBuffers + NUM_BUFFER_PARTITIONS)`：key 是 `(rel, fork, block)` → `buf_id`。多留 partition 个槽，因为替换时「先插新再删旧」可能短暂超过 `NBuffers`
- `StrategyControl`：`firstFreeBuffer=0`，`lastFreeBuffer=NBuffers-1`（接上 `freeNext` 链）；`nextVictimBuffer=0`（clock sweep 从 0 开始）

之后要缓冲：先查哈希；没有则从空闲链取；链空了才 clock sweep 淘汰。

**④ 初始化之后谁能用**

postmaster 建完不再碰这些页。子进程 fork 继承指针，看到同一块物理内存。backend 第一次访问某页：

```
ReadBuffer → 哈希查找 tag
  未命中：从 freelist / clock 拿 buf_id
  设 tag、BM_IO_IN_PROGRESS
  从文件读 8KB 进 BufferBlocks[buf_id]
  BM_VALID，唤醒等 IO 的进程
```

**初始化 = 分配空槽 + 串空闲链表 + 建空哈希；预热是运行时的事。**

和 TopMemoryContext 对照：shared_buffers 在**共享内存**、全集群一份；Top 是每进程**私有堆**。默认 128MB 的缓冲池远大于 Top 初始 8KB。

**6. 清残留、可选 syslogger、开始打日志（1061–1104）**

- 删 promote / logrotate 残留信号文件（避免误 promote）
- `Logging_collector` 则 **fork syslogger**（此时仍是 `PM_INIT`）
- `whereToSendOutput = DestNone`，打 `starting PostgreSQL …`

**7. 听端口（1112–1274）**

- 注册退出回调 `CloseServerPorts`
- 先 TCP（`listen_addresses`），再 Unix socket；至少一个，否则 FATAL
- 把监听地址写进 `postmaster.pid`

**8. 收尾型初始化（1288–1372）**

- `CreateOptsFile`：记下启动参数
- 可选外部 PID 文件
- `RemovePgTempFiles`
- `autovac_init()`：**只初始化，还不 fork launcher**
- **`load_hba()`** 失败则 FATAL；`load_ident()` 失败仍可启动
- 记下 `PgStartTime`

**9. 换标签，拉恢复相关子进程（1378–1401）**

```
pid 文件状态 → starting
UpdatePMState(PM_STARTUP)          /* PM_INIT → PM_STARTUP */
maybe_adjust_io_workers()          /* io_worker × N */
StartChildProcess(B_CHECKPOINTER)
StartChildProcess(B_BG_WRITER)
StartChildProcess(B_STARTUP)       /* 去跑 StartupXLOG */
maybe_start_bgworkers()
ServerLoop()                       /* 此后常驻；正常不返回 */
```

gdb 父进程里看到的顺序：`UpdatePMState(PM_STARTUP)` → 多个 `io_worker` → `checkpointer` → `bgwriter` → `startup`。  
`[Detaching after fork from child process …]` 正常：默认不跟进子进程。

| `PostmasterMain` 里做的 | 不在这里做的 |
|---|---|
| 配置、pid、shmem、端口、HBA、信号 | `MemoryContextInit`（更早的 `main()`） |
| fork syslogger / io_worker / checkpointer / bgwriter / startup | `StartupXLOG`（startup 子进程） |
| 进入 `ServerLoop` | 执行 SQL（backend 子进程） |
| | 切 `PM_RUN`（startup 退出之后，在 `ServerLoop` 里） |

一句话：**`PostmasterMain` = 把集群当服务跑起来所需的外壳按顺序建完，再 fork startup，自己进事件循环。** 不是「数据库已经能用」——那是后面的 `PM_RUN`。

### 1.2 下一个函数：`ServerLoop`（约 1653–1803 行）

`PostmasterMain` 最后一句有效代码是 `status = ServerLoop()`。注释写的是 *Main idle loop of postmaster*。正常路径这个函数是 **`for (;;)` 死循环，不会返回**；只有异常才会回到 `ExitPostmaster`。

进入时 `pmState` 已是 `PM_STARTUP`，startup 子进程已经 fork 出去。`ServerLoop` 并不「做完恢复」，它只是 **等事件、派活**：startup 退出、客户端连接、reload、关机，都在这里处理。

#### 进循环前

```c
ConfigurePostmasterWaitSet(true);   /* latch + 所有 listen socket */
last_lockfile_recheck_time = last_touch_time = time(NULL);
for (;;) { ... }
```

`pm_wait_set` 上挂两件事：自己的 latch（信号处理器 `SetLatch` 会叫醒）、以及 `ListenSockets[]` 上的 `WL_SOCKET_ACCEPT`。

`DetermineSleepTime()`：平常最多睡 60 秒（好做周期性杂务）；有 bgworker 要启动则睡 0；immediate shutdown / crash 后在等 SIGKILL 超时则按剩余秒数睡。

#### 每一圈按源码顺序

**① `WaitEventSetWait`**  
阻塞到：有连接、有 latch（信号）、或超时。

**② 遍历本次事件**（约 1677–1712）

| 事件 / 标志 | 调用 | 干什么 |
|---|---|---|
| `WL_LATCH_SET` | `ResetLatch` | 清掉叫醒标记 |
| `pending_pm_shutdown_request` | `process_pm_shutdown_request` | smart / fast / immediate |
| `pending_pm_reload_request` | `process_pm_reload_request` | SIGHUP，重读配置并通知孩子 |
| `pending_pm_child_exit` | `process_pm_child_exit` | `waitpid`；**startup exit 0 → `PM_RUN`** |
| `pending_pm_pmsignal` | `process_pm_pmsignal` | 恢复开始 / hot standby / 要 walreceiver 等 |
| `WL_SOCKET_ACCEPT` | `AcceptConnection` → `BackendStartup` | **立刻 fork**；父进程关掉刚 accept 的 fd |

后四个 `pending_*` **每圈无条件检查**（不依赖一定看到 latch），避免关机请求被排在 events 后面而晚一拍。

信号处理器本身几乎只设标志 + `SetLatch`，真正干活都在 `ServerLoop` 里——postmaster 不能在信号处理里 `fork`/`waitpid` 卡死。

**③ `LaunchMissingBackgroundProcesses()`**  
按当前 `pmState` 补缺的辅助进程。startup 刚变成 `PM_RUN` 的那一圈，这里会拉 walwriter / autovacuum / archiver / bgworker。

**④ 若 `avlauncher_needs_signal`**  
给已有的 autovacuum launcher 发 SIGUSR2。

**⑤ 不每圈都做的杂务**

| 条件 | 动作 |
|---|---|
| immediate shutdown / FatalError 且超过 5 秒 | 对顽抗孩子 `SIGKILL`（或 SIGABRT） |
| 每 1 分钟 | `RecheckDataDirLockFile()`，pid 文件没了就给自己 SIGQUIT |
| 每 58 分钟 | `TouchSocketFiles`，避免 /tmp 清理把 Unix socket 删掉 |

#### 设计要点

- **不执行 SQL、不回放 WAL。** 只调度。
- **不在客户端 socket 上阻塞。** accept 完立刻 fork，父进程关掉该 fd。
- **连接是否真正可用** 由 `canAcceptConnections()` 决定：只有 `PM_RUN` / `PM_HOT_STANDBY` 才 `CAC_OK`；`PM_STARTUP` 时 fork 的是 dead-end，回「还在启动」。
- gdb 断在 `ServerLoop` 入口只停一次（函数入口）。之后要看状态变化，断 `UpdatePMState` / `process_pm_child_exit` / `BackendStartup`。

和 `PostmasterMain` 的分工：前面把外壳建好并拉起 startup；**从这一行起 postmaster 的余生都在 `ServerLoop`。**

==============================================================================

## 阶段 2：startup 子进程 — 真正「启动数据库」

Postmaster 不回放 WAL。子进程：`src/backend/postmaster/startup.c`

```c
void StartupProcessMain(...)
{
	MyBackendType = B_STARTUP;
	AuxiliaryProcessMainCommon();  /* 挂 PGPROC、BaseInit；不连业务库 */
	StartupXLOG();                 /* src/backend/access/transam/xlog.c */
	proc_exit(0);                  /* 0 = 恢复成功；本进程到此结束 */
}
```

`StartupXLOG()` 读 `pg_control`：

| `ControlFile->state` | 含义 | 行为 |
|---|---|---|
| `DB_SHUTDOWNED` | 上次干净关机 | 几乎不用 redo |
| `DB_SHUTDOWNING` / `DB_IN_PRODUCTION` | 关机被打断或崩溃 | crash recovery，并 `SyncDataDirectory()` |
| `DB_IN_ARCHIVE_RECOVERY` 等 | 上次恢复没走完 | 继续 archive / crash recovery |

长时间 redo 时用 pmsignal 通知父进程：

- `PMSIGNAL_RECOVERY_STARTED` → **`PM_RECOVERY`**
- 一致点 + `hot_standby=on` → **`PM_HOT_STANDBY`**（只读连接）
- startup **exit 0** → **`PM_RUN`**

干净主库常见：**`PM_STARTUP` 直接到 `PM_RUN`**，startup 活得很短。

父进程 gdb **看不到** `StartupXLOG` 内部。要跟恢复：

```
gdb -q --args /opt/pg-18/bin/postgres --single -D /tmp/pg18-data postgres
break StartupXLOG
run
```

`--single` 同进程走 `PostgresSingleUserMain` → `PostgresMain` → `InitPostgres` → `StartupXLOG`，没有 fork。

### 2.1 `StartupXLOG` / `proc_exit(0)` 之后发生什么

startup **没有查询主循环**。`StartupXLOG()` 成功后就是 `proc_exit(0)`：这个进程退出，后续全是还活着的 **postmaster** 在已经进入的 `ServerLoop` 里收尸、切状态、补进程、再对外服务。

```
startup: StartupXLOG() → proc_exit(0)     本进程结束
    │
    ▼ SIGCHLD
postmaster ServerLoop
    process_pm_child_exit()
        waitpid 看到 startup、退出码 0
        UpdatePMState(PM_RUN)
        pid 文件写成 ready
        打日志 database system is ready to accept connections
    LaunchMissingBackgroundProcesses()
        拉 walwriter / autovacuum / archiver / bgworker
    回到 WaitEventSetWait
        等连接 / reload / 关机 / 其它孩子退出
```

#### ① 父进程收到 SIGCHLD

gdb 里对 SIGCHLD 设了 `nostop`，所以不会停。postmaster 在 `process_pm_child_exit()`（`postmaster.c`）里 `waitpid` 对上 `StartupPMChild`，退出码 0 走「恢复成功」分支（约 2313–2340 行）：

```c
StartupStatus = STARTUP_NOT_RUNNING;
FatalError = false;
ReachedNormalRunning = true;
UpdatePMState(PM_RUN);
connsAllowed = true;
StartWorkerNeeded = true;
ereport(LOG, (errmsg("database system is ready to accept connections")));
AddToDataDirLockFile(..., PM_STATUS_READY);
```

gdb 若还断在 `UpdatePMState`，这时是 **`PM_STARTUP` → `PM_RUN`**（若中间走过归档恢复，则可能是 `PM_RECOVERY` / `PM_HOT_STANDBY` → `PM_RUN`）。

`pg_ctl start` 看到 pid 文件 `ready` 才认为启动成功。systemd 会收到 `READY=1`。

非 0 退出：startup 崩了会 `StartupStatus = STARTUP_CRASHED`，postmaster 往往跟着退出，而不是再无限重启。

#### ② 同一圈 `ServerLoop` 补齐后台进程

`LaunchMissingBackgroundProcesses()` 按当前 `pmState` 看缺谁补谁。`PM_RUN` 下新出现的是之前不能开的：

| 进程 | 为何现在才拉 |
|---|---|
| **walwriter** | 只有正常运行才能写新 WAL |
| **autovacuum launcher** | 只在 `PM_RUN`（binary upgrade 时还不开） |
| **archiver** | 主库归档在 `PM_RUN`；`archive_mode=always` 时恢复期也能开 |
| **bgworker** | `StartWorkerNeeded = true`，按注册时机启动 |

checkpointer / bgwriter / io_worker 在 `PM_STARTUP` 就已经在，继续留着。startup 自己已经退出，不会再补一个 startup。

#### ③ 之后 postmaster 只空转等待

`ServerLoop`（约 1653 行）`WaitEventSetWait` 等 latch 和 listen socket，**绝不在客户端 I/O 上阻塞**。每一圈：

1. 关机 / reload / 子进程退出 / pmsignal
2. 有连接：`AcceptConnection` → `BackendStartup` **立刻 fork**
3. `LaunchMissingBackgroundProcesses()` 再扫一遍缺的辅助进程

**postmaster 自己不执行 SQL。** 查询都在 fork 出来的 backend 里。

| 谁 | 「执行完」之后 |
|---|---|
| **startup 子进程** | 退出，不再存在 |
| **postmaster** | `PM_RUN`，补 walwriter/autovacuum，然后一直 `ServerLoop` |
| **backend**（有人连进来之后） | 一条 SQL 结束只 `Reset(MessageContext)`，回到 `PostgresMain` 等下一条 |

未就绪（还在 `PM_STARTUP` 等）时来的连接 fork 的是 dead-end：只回错误后退出。`PM_RUN` / `PM_HOT_STANDBY` 且 `connsAllowed` 才允许正常 backend。

==============================================================================

## 阶段 3：`PM_RUN` — 接连接与一条 SQL 的收尾

### 3.1 客户端进来

`BackendMain`（`src/backend/tcop/backend_startup.c`）：读启动包、认证 → `PostgresMain` → `InitPostgres`（连库、加载 catalog）→ 查询循环。

认证前 attach 用开发者 GUC：`pre_auth_delay=30`。本机已有 `~/.gdbinit` 的 `pgattach` / `pgsetup`。

`PM_RUN` 之后典型进程：

| 进程 | 最早状态 | 职责 |
|---|---|---|
| syslogger | 初始化后 | 收集日志 |
| io worker | PM_STARTUP | 异步 IO |
| checkpointer / bgwriter | PM_STARTUP | 刷脏页；关机写 shutdown checkpoint |
| startup | PM_STARTUP | `StartupXLOG`，**结束后退出** |
| walwriter | 仅 PM_RUN | 后台刷 WAL |
| autovacuum launcher | 仅 PM_RUN | 调度 vacuum |
| archiver / walsender | 按配置 | 归档、流复制 |
| backend | PM_RUN 或 PM_HOT_STANDBY | 客户端会话 |

### 3.2 一条 SQL 执行完（不是再走一遍启动）

Backend 主循环（`PostgresMain`）大致：

```
收到一条协议消息
  MemoryContextReset(MessageContext)
  切到 MessageContext，解析 / 计划 / 执行
  事务提交或中止 → Reset TopTransactionContext
回到循环，等下一条
```

丢掉的是 Message / Transaction 那一层。Top 和 Cache 还在。不断开连接，backend 就不会退出，也**不会**再 fork startup。

==============================================================================

## 阶段 4：关机

| 模式 | 信号 | `pg_ctl` | 行为 |
|---|---|---|---|
| Smart | SIGTERM | 默认 | 禁新连接，等会话结束 |
| Fast | SIGINT | `-m fast` | 立刻 SIGTERM 子进程，仍写 checkpoint |
| Immediate | SIGQUIT | `-m immediate` | 5 秒后 SIGKILL，不写 checkpoint |

正常 smart/fast：

```
PM_RUN / PM_HOT_STANDBY
  → PM_STOP_BACKENDS → PM_WAIT_BACKENDS
  → PM_WAIT_XLOG_SHUTDOWN      checkpointer 写 shutdown checkpoint
  → PM_WAIT_XLOG_ARCHIVAL      archiver / walsender 收尾
  → PM_WAIT_IO_WORKERS
  → PM_WAIT_CHECKPOINTER
  → PM_WAIT_DEAD_END → PM_NO_CHILDREN
  → ExitPostmaster(0) → 关 listen FD → 删 socket / postmaster.pid
```

崩溃：`FatalError`，孩子走光后重建 shmem，再 `PM_STARTUP` fork startup（除非 startup 自己崩或 `restart_after_crash=off`）。

状态切换统一走 `UpdatePMState()`，`DEBUG1` 会打 `updating PMState from … to …`（`postgres -d 1` 能在日志里看到）。

==============================================================================

## gdb：只跟 postmaster 父进程（不 follow-fork）

不要 `set follow-fork-mode child`（checkpointer 比 startup 先 fork，会跟错）。  
不要一次粘多条 `handle`/`break`——gdb 会当成一条命令。

### 启动（python 整块可贴一次）

先停实例：`/opt/pg-18/bin/pg_ctl -D /tmp/pg18-data stop`

```
gdb -q /opt/pg-18/bin/postgres
```

```
python
gdb.execute("set substitute-path /opt/pg-src/postgresql-18.6 /opt/postgresql-18.6")
gdb.execute("directory /opt/postgresql-18.6")
for s in ["SIGCHLD", "SIGUSR1", "SIGUSR2", "SIGPIPE", "SIGHUP", "SIGTERM", "SIGQUIT"]:
    gdb.execute(f"handle {s} nostop noprint pass")
gdb.execute("delete breakpoints")
for fn in ["PostmasterMain", "UpdatePMState", "StartChildProcess", "ServerLoop"]:
    gdb.execute(f"break {fn}")
gdb.execute("run -D /tmp/pg18-data")
end
```

`run` 停在断点后，末尾 `end` 可能被当成 Python 报 `name 'end' is not defined`，**可忽略**，已经停在 `PostmasterMain`。

只要 `main.c`：改用 `gdb -q -tui /opt/pg-18/bin/postgres`，只 `break main`，用 `next` 走，`PostmasterMain(...)` 那一行再 `step`。

### 每次停住（一行一条）

| 停在 | 看什么 | 然后 |
|---|---|---|
| PostmasterMain | `bt` | `continue` |
| UpdatePMState | `p pmstate_name(pmState)` 再 `p pmstate_name(newState)` | `continue` |
| StartChildProcess | `p PostmasterChildName(type)` | `continue`（不要 `step` 进 fork） |
| ServerLoop | `bt` | `continue` |

跳过反复的 io_worker：`condition 3 type != B_IO_WORKER`（3 换成 `StartChildProcess` 的断点号）。

### 常用单步

| 命令 | 作用 |
|---|---|
| `next` | 执行完当前行，不进入调用 |
| `step` | 进入当前行调用的函数 |
| `finish` | 跑完当前函数并返回调用者 |
| `until 行号` | 跑到该行；用来跳出循环 |
| `p 变量` / `info locals` / `info args` | 打印 |

`until` 碰到**任何断点**都会停。循环体内有断点时先 `info breakpoints` 再 `delete N`，空的 `break` 会在当前行再下一个断点，循环里不要这样敲。`end` 不是跳出循环的命令。

关机：另开终端 `pg_ctl -D /tmp/pg18-data stop`，不要在 gdb 里 Ctrl-C。

==============================================================================

## 源码索引（PG 18.6）

| 概念 | 文件 |
|---|---|
| `main` / 分发 | `src/backend/main/main.c` |
| `save_ps_display_args` | `src/backend/utils/misc/ps_status.c` |
| `MemoryContextInit` / `palloc` | `src/backend/utils/mmgr/mcxt.c` |
| `palloc` 接口说明 | `src/include/utils/palloc.h` |
| `MemoryContextData` 头 | `src/include/nodes/memnodes.h` |
| AllocSet / `AllocSetAlloc` / freelist / maxBlockSize | `src/backend/utils/mmgr/aset.c` |
| `PostmasterMain` / `ServerLoop` / `UpdatePMState` / `StartChildProcess` / `PostmasterStateMachine` / `process_pm_child_exit` / `LaunchMissingBackgroundProcesses` | `src/backend/postmaster/postmaster.c` |
| 子进程表 / `postmaster_child_launch` | `src/backend/postmaster/launch_backend.c` |
| `StartupProcessMain` | `src/backend/postmaster/startup.c` |
| `StartupXLOG` | `src/backend/access/transam/xlog.c` |
| `BackendMain` | `src/backend/tcop/backend_startup.c` |
| `PostgresMain` / `PostgresSingleUserMain` | `src/backend/tcop/postgres.c` |
| `InitPostgres` | `src/backend/utils/init/postinit.c` |
| `CreateSharedMemoryAndSemaphores` / `CalculateShmemSize` | `src/backend/storage/ipc/ipci.c` |
| `ShmemInitStruct` | `src/backend/storage/ipc/shmem.c` |
| `BufferManagerShmemInit` / `BufferManagerShmemSize` | `src/backend/storage/buffer/buf_init.c` |
| `StrategyInitialize` / buffer freelist | `src/backend/storage/buffer/freelist.c` |
| `BufferDesc` | `src/include/storage/buf_internals.h` |

==============================================================================

## 和前后章的关系

- 本章：启动**时序**（谁先谁后、PMState、gdb 怎么跟）。
- [[01-process-shmem]]：起来之后的**结构**（PGPROC、shmem、为什么是进程不是线程）。
- [[02-page-tuple]]：缓冲槽里那 8KB 如何格式化、如何塞行（`PageInit` / ItemId / `PageAddItem`）。启动时**不会** `PageInit` 任何表页。
- [[05-buffer-manager]]：运行时 ReadBuffer / 时钟扫描 / 刷脏（本章只写启动时如何把空槽建出来）。
- 对照笔记：`/home/obsidian/postgres/learn/quant67-pg18-study/chapters/ch01-process-shmem.md`
