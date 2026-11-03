# PostgreSQL MemoryContext 标准实现解读

来源: http://mysql.taobao.org/monthly/2024/08/02/
标签: recent

---

## 背景

PostgreSQL 是多进程架构，它的内存架构可以划分为两大类：共享内存（shared memory area）和本地内存（local memory area）。除了动态申请的共享内存外，绝大多数共享内存是在 Postmaster 启动时分配，具有固定大小，因此内存管理相对简单，不易发生内存泄漏。而每个后端进程还必须管理自己的本地内存来完成请求的处理，这部分的内存管理比较棘手。这是因为 PostgreSQL 内核主要采用 C 语言编写，程序必须显式释放所有动态分配的内存，并且 PostgreSQL 中需要处理大量的以指针传值的逻辑，很容易产生难以排查的内存泄漏问题。内存泄漏对于多进程架构的影响是致命的，所以更好地管理本地内存是 PostgreSQL 实现中的一个重要环节。

从 7.1 版本开始，PostgreSQL 引入了内存上下文（MemoryContext）机制来管理本地内存。这个机制很好地解决了内存泄漏问题；同时也提高了内存分配效率，避免了内存碎片化的产生；也让内存管理有了生命周期。

## MemoryContext 简介

MemoryContext 本质上是对内存进行分层和分类。一个 MemoryContext 实际上是一个内存池，代表一类内存。不同的 MemoryContext 组成了一个树状结构，代表了不同种类内存之间的联系。在运行过程中，开发者可以根据自己的需要创建和删除 MemoryContext。删除 MemoryContext，会让 MemoryContext（包括子 MemoryContext）中申请的内存都被释放，而不必去关心每一块内存的释放。

PostgreSQL 中有几个被熟知的 MemoryContext，它们之间的关系如下图所示：

 <img src="/monthly/pic/202408/imgs/postgresql_aset_memorycontext_1.png" width = 80%/> 

它们的作用为：

  
- **TopMemoryContext**
    
      
- 这是 MemoryContext 的根节点，其他 MemoryContext 都是它的直接或者间接子节点。这个 context 在进程运行期间永远不会被重置或释放，所以在它里面分配的内存基本上等于使用 malloc() 分配的内存。
    
  
  
- **CacheMemoryContext**
    
      
- 这是用于存储 relcache/catcache/plancache 以及相关模块的内容，这个 context 也永远不会被重置或释放。
    
  
  
- **MessageContext**
    
      
- 用于保存当前来自前端的命令消息以及需要与当前消息一起存在的任何衍生结构（例如，在 simple-Query 模式下，parser_tree 和 plan_tree 存放在这里）。PostgresMain 的每一次外部循环开始时，这个 context 将被重置。
    
  
  
- **TopTransactionContext**
    
      
- 用于保存顶层事务所需的一切结构，这个 context 会在每个顶层事务周期结束时被重置，其所有子 context 将被删除。需要注意的是，此 context 在出错时不会立即清除，其内容会一直保留到事务 Rollback。
    
  
  
- **ErrorContext**
    
      
- 用于错误恢复处理的 context，在每次错误处理完成后重置，同样永远不会被删除。这个 context 始终有 8 KB 的内存可用，用于保证即使出现内存耗尽的情况，也能够进行错误恢复，而不是产生一个 FATAL 错误。
    
  

MemoryContext 的基本操作包括：创建 context、删除 context（释放所有获得的内存块）、重置 context（仅保留创建时申请的内存块）、在 context 中申请/释放内存片（palloc()/pfree()）以及查询 context 中内存分配的情况等。

为了降低管理负担，PostgreSQL 中提供了 CurrentMemoryContext 全局变量表示当前的 MemoryContext。palloc() 会隐式地从这个 context 中分配空间。MemoryContextSwitchTo() 操作可以选择一个新的当前 context，并返回之前的 context，以便调用者最后恢复之前的 context。需要注意，pfree() 和 repalloc() 在处理内存块时，不依赖 CurrentMemoryContext，会直接调用内存块所属的 context 进行操作。
PostgreSQL 9.5 之后，MemoryContext 中引入了 reset 回调函数机制。注册的函数能够在 context 被删除或者重置时调用，调用的顺序和注册的顺序相反。回调函数用于释放与这个 context 相关的资源，比如关闭某些操作打开的文件或者释长生命对象被 context 的引用计数等。
MemoryContext 实际上是一个抽象类型，它的底层可以有多种实现方式，但是能让用户只使用同一套接口来管理不同的内存分配机制，只是内存申请释放由原来的 malloc/free 变为了 palloc/pfree 。为了实现这个目的：

  
- 一个 MemoryContext 用一个 MemoryContextData 结构表示 ，这个结构体标识了 context 的具体类型，并包含了不同类型的 MemoryContext 之间的共同信息，如父 context、子 context 和 context 的名称；
  
- 每个 MemoryContext 的内存操作方法由 MemoryContextMethods 中虚函数指针指向的方法决定，不同类型的 context 会使用派生的结构体，这些结构体必须把 MemoryContextData 作为它们的第一个字段。

接下来看下 MemoryContext 具体的数据结构（代码主要来自 PostgreSQL 14.11 src/include/nodes/memnodes.h）:

```
typedef struct MemoryContextData *MemoryContext;

typedef struct MemoryContextMethods
{
	void	   *(*alloc) (MemoryContext context, Size size);
	/* call this free_p in case someone #define's free() */
	void		(*free_p) (MemoryContext context, void *pointer);
	void	   *(*realloc) (MemoryContext context, void *pointer, Size size);
	void		(*reset) (MemoryContext context);
	void		(*delete_context) (MemoryContext context);
	Size		(*get_chunk_space) (MemoryContext context, void *pointer);
	bool		(*is_empty) (MemoryContext context);
	void		(*stats) (MemoryContext context,
						  MemoryStatsPrintFunc printfunc, void *passthru,
						  MemoryContextCounters *totals,
						  bool print_to_stderr);
#ifdef MEMORY_CONTEXT_CHECKING
	void		(*check) (MemoryContext context);
#endif
} MemoryContextMethods;

typedef struct MemoryContextData
{
	NodeTag		type;			/* identifies exact kind of context */
	/* these two fields are placed here to minimize alignment wastage: */
	bool		isReset;		/* T = no space alloced since last reset */
	bool		allowInCritSection; /* allow palloc in critical section */
	Size		mem_allocated;	/* track memory allocated for this context */
	const MemoryContextMethods *methods;	/* virtual function table */
	MemoryContext parent;		/* NULL if no parent (toplevel context) */
	MemoryContext firstchild;	/* head of linked list of children */
	MemoryContext prevchild;	/* previous child of same parent */
	MemoryContext nextchild;	/* next child of same parent */
	const char *name;			/* context name (just for debugging) */
	const char *ident;			/* context ID if any (just for debugging) */
	MemoryContextCallback *reset_cbs;	/* list of reset/delete callbacks */
} MemoryContextData;

```

可以看到 MemoryContext 实际上是指向 MemoryContextData 的指针。MemeoryContext 之间的联系是一个树状结构：

 <img src="/monthly/pic/202408/imgs/postgresql_aset_memorycontext_2.png" width = 100%/> 

parent 指向父 context，firstchild 指向第一个子 context，而 prevchild 和 nextchild 则是指向同层级的 context。

## AllocSet 实现详解

MemoryContext 底层有多种实现方式（aset.c/slab.c/generation.c），其中 slab.c/generation.c 会将释放的内存直接还给操作系统，而 aset.c 则会保留一部分已释放内存在一个 freelist 中，只有在 context 被删除或者重置时归还给操作系统。aset.c（AllocSet）是 MemoryContext 的标准实现(参考 src/backend/utils/mmgr/aset.c) ，接下来介绍它的详细实现。

### 数据结构

首先看下 AllocSet 的数据结构组织关系，如下图所示：

 <img src="/monthly/pic/202408/imgs/postgresql_aset_memorycontext_3.png" width = 80%/> 

#### AllocSetContext

```
typedef struct AllocSetContext
{
	MemoryContextData header;	/* Standard memory-context fields */
	/* Info about storage allocated in this context: */
	AllocBlock	blocks;			/* head of list of blocks in this set */
	AllocChunk	freelist[ALLOCSET_NUM_FREELISTS];	/* free chunk lists */
	/* Allocation parameters for this context: */
	Size		initBlockSize;	/* initial block size */
	Size		maxBlockSize;	/* maximum block size */
	Size		nextBlockSize;	/* next block size to allocate */
	Size		allocChunkLimit;	/* effective chunk size limit */
	AllocBlock	keeper;			/* keep this block over resets */
	/* freelist this context could be put in, or -1 if not a candidate: */
	int			freeListIndex;	/* index in context_freelists[], or -1 */
} AllocSetContext;

```

AllocSetContext 是 AllocSet 的核心管理模块， 所以单独介绍下其中每个成员的作用：

  
- header
    
      
- header 就是上面提到的 MemoryContextData，这样对外是一个 MemoryContext，但实际处理时可以转化为一个 AllocSetContext，代码中最常见的写法是：
        
```
/* typedef AllocSetContext *AllocSet; */
aset = (AllocSet) mcxt;

```
        
      
    
  
  
- blocks
    
      
- blocks 是指向 context 向 malloc() 申请 block 链表的头，需要注意 palloc() 只会从 blocks 指向的 block 申请内存。
    
  
  
- freelist[ALLOCSET_NUM_FREELISTS]
    
      
- 用于管理用户 pfree chunk size 不超过 allocChunkLimit 的 Chunk，每个元组指向相同大小的 Chunk list。
    
  
  
- initBlockSize
    
      
- 创建 context 时申请的第一个 blocksize。
    
  
  
- maxBlockSize
    
      
- context 向 malloc() 申请的最大的 blocksize，这个约束只会对用户申请不超过 allocChunkLimit 的 chunk 才会生效，申请更大的 chunk 时不受限制。
    
  
  
- allocChunkLimit
    
      
- context 尝试从 freelist 取 chunk，还是直接通过 malloc() 申请 block 作为一个 chunk 的限定值。
    
  
  
- keeper
    
      
- 对 context 进行 reset 后，指向 AllocSetContext 所在的 block，一般为创建时申请的第一个 block。
    
  
  
- freeListIndex
    
      
- 在 context_freelists[] 数组的位置，如果不在就为 -1。
    
  

#### AllocBlockData

```
typedef struct AllocBlockData
{
	AllocSet	aset;			/* aset that owns this block */
	AllocBlock	prev;			/* prev block in aset's blocks list, if any */
	AllocBlock	next;			/* next block in aset's blocks list, if any */
	char	   *freeptr;		/* start of free space in this block */
	char	   *endptr;			/* end of space in this block */
}			AllocBlockData;

```

AllocSet 从 malloc() 中获取一块连续内存的单位是 AllocBlock。而用户调用 palloc() 获取一块连续内存的单位是 AllocChunk。一个 AllocBlock 包含 1 个或者多个 AllocChunk。用户 pfree() 释放 AllocChunk 后，可能不会直接返还操作系统，如果匹配了 freelist 中的大小，将会由对应的 freelist 管理。
AllocBlockData 是一个 AllocBlock 的 header 数据，可分配的空间是从下一个内存对齐边界开始。

#### AllocChunkData

```
typedef struct AllocChunkData
{
	/* size is always the size of the usable space in the chunk */
	Size		size;
#ifdef MEMORY_CONTEXT_CHECKING
	/* when debugging memory usage, also store actual requested size */
	/* this is zero in a free chunk */
	Size		requested_size;

#define ALLOCCHUNK_RAWSIZE  (SIZEOF_SIZE_T * 2 + SIZEOF_VOID_P)
#else
#define ALLOCCHUNK_RAWSIZE  (SIZEOF_SIZE_T + SIZEOF_VOID_P)
#endif							/* MEMORY_CONTEXT_CHECKING */

	/* ensure proper alignment by adding padding if needed */
#if (ALLOCCHUNK_RAWSIZE % MAXIMUM_ALIGNOF) != 0
	char		padding[MAXIMUM_ALIGNOF - ALLOCCHUNK_RAWSIZE % MAXIMUM_ALIGNOF];
#endif

	/* aset is the owning aset if allocated, or the freelist link if free */
	void	   *aset;
	/* there must not be any padding to reach a MAXALIGN boundary here! */
}			AllocChunkData;

```

AllocChunkData 是一个 AllocChunk 的 header 数据，可使用空间也是从下一个内存对齐边界开始。这里的 size 是表示可以使用的空间大小（不包括 metadata 的空间）。

#### AllocSetFreeList

```
typedef struct AllocSetFreeList
{
	int			num_free;		/* current list length */
	AllocSetContext *first_free;	/* list header */
} AllocSetFreeList;

/* context_freelists[0] is for default params, [1] for small params */
static AllocSetFreeList context_freelists[2] =
{
	{
		0, NULL
	},
	{
		0, NULL
	}
};

```

为了避免频繁地创建和删除 AllocSet，PG 中同样使用了 AllocSetFreeList 来管理部分被释放的 AllocSet，便于减少再次申请 AllocSet 的工作量。每一类 AllocSetFreeList 的候选集中的 AllocSet 必须要有 相同 的 minContextSize 和 initBlockSize，而 maxBlockSize 则不相关，因为不影响最开始分配块（initial AllocBlock）的大小。放入 AllocSetFreeList 之前，AllocSet 都会被进行 Reset 操作，只会让 keeper 指向 initial AllocBlock，然后删除其余的 block。

PG 提供了两类 AllocSetFreeList，一类是 ALLOCSET_DEFAULT_SIZES，另一类 ALLOCSET_SMALL_SIZES（ALLOCSET_START_SMALL_SIZES 也可以使用这里的候选集，因为只有 maxBlockSize 与 ALLOCSET_SMALL_SIZES 不同）。

AllocSetFreeList 中 AllocSet 的取用方式是 LIFO，但是每个 AllocSetFreeList 的个数有一个上限（MAX_FREE_CONTEXTS），超过这个上限，PG 会倾向删除最近创建的 AllocSet（即末尾的节点），为了保持进程的 MMAP 紧凑。

PG 在实现时，采用的方案是 一旦发现 AllocSetFreeList 个数溢出，就直接删除 AllocSetFreeList 所有 节点，来近似达到上面的想法。而这个方案是基于 一个会分配很多 MemoryContext 的查询，或多或少的可能会以申请相反的顺序释放 MemoryContext。实际实现时简化为，一旦发现某个 AllocSetFreeList 中数量超过 100，则会将这些 AllocSet 全部释放。在 AllocSetFreeList 中，每个 AllocSet 的 nextchild 指向下一个 AllocSet。

### 函数方法

#### AllocSetContextCreateInternal

```
MemoryContext
AllocSetContextCreateInternal(MemoryContext parent,
							  const char *name,
							  Size minContextSize,
							  Size initBlockSize,
							  Size maxBlockSize)

```

这个函数创建一个 AllocSet，会分配一个 initial AllocBlock，而 minContextSize / initBlockSize / maxBlockSize 会影响 initial AllocBlock 的大小，以及再次分配 block 的大小。主要的流程：

 <img src="/monthly/pic/202408/imgs/postgresql_aset_memorycontext_4.png" width = 50%/> 

确定 firstBlockSize 时，需要至少包含头部的开销，然后再去和 minContextSize/initBlockSize 比较：

```
    /* Determine size of initial block */
	firstBlockSize = MAXALIGN(sizeof(AllocSetContext)) +
		ALLOC_BLOCKHDRSZ + ALLOC_CHUNKHDRSZ;
	if (minContextSize != 0)
		firstBlockSize = Max(firstBlockSize, minContextSize);
	else
		firstBlockSize = Max(firstBlockSize, initBlockSize);

```

确定 allocChunkLimit 时，会有一个默认值 ALLOC_CHUNK_LIMIT（8 KB），但是不能超过 maxBlockSize 的 1/4，否则 allocChunkLimit 就要循环缩减一倍，直到满足要求：

```
    set->allocChunkLimit = ALLOC_CHUNK_LIMIT;
	while ((Size) (set->allocChunkLimit + ALLOC_CHUNKHDRSZ) >
		   (Size) ((maxBlockSize - ALLOC_BLOCKHDRSZ) / ALLOC_CHUNK_FRACTION))
		set->allocChunkLimit >>= 1;

```

从上面的分析可以看到，minContextSize/initBlockSize/maxBlockSize 会直接影响 AllocSet 的内存申请规则，而了解具体的规则是比较有挑战的。为方便调用，PG 定义了三个分配 size 的宏，同时也定义了一个调用函数的宏：

```
#ifdef HAVE__BUILTIN_CONSTANT_P
#define AllocSetContextCreate(parent, name, ...) \
	(StaticAssertExpr(__builtin_constant_p(name), \
					  "memory context names must be constant strings"), \
	 AllocSetContextCreateInternal(parent, name, __VA_ARGS__))
#else
#define AllocSetContextCreate \
	AllocSetContextCreateInternal
#endif

#define ALLOCSET_DEFAULT_SIZES \
	ALLOCSET_DEFAULT_MINSIZE, ALLOCSET_DEFAULT_INITSIZE, ALLOCSET_DEFAULT_MAXSIZE

#define ALLOCSET_SMALL_SIZES \
	ALLOCSET_SMALL_MINSIZE, ALLOCSET_SMALL_INITSIZE, ALLOCSET_SMALL_MAXSIZE

#define ALLOCSET_START_SMALL_SIZES \
	ALLOCSET_SMALL_MINSIZE, ALLOCSET_SMALL_INITSIZE, ALLOCSET_DEFAULT_MAXSIZE

```

因此，常见的调用方式就是：

```
source_context = AllocSetContextCreate(CurrentMemoryContext,
										   "CachedPlanSource",
										   ALLOCSET_START_SMALL_SIZES);

```

#### AllocSetMethods

文章开头介绍 Memorycontext 时提到了作为抽象类的两个条件，我们已经看到 MemoryContextData 确实是 AllocSetContext 第一个成员，而 MemoryContextMethods 指向具体的 method 实现是在 AllocSetContextCreateInternal 函数中完成的：

```
MemoryContextCreate((MemoryContext) set,
								T_AllocSetContext,
								&AllocSetMethods,
								parent,
								name);

```

AllocSetMethods 包含的具体方法为：

```
static const MemoryContextMethods AllocSetMethods = {
	AllocSetAlloc,
	AllocSetFree,
	AllocSetRealloc,
	AllocSetReset,
	AllocSetDelete,
	AllocSetGetChunkSpace,
	AllocSetIsEmpty,
	AllocSetStats
#ifdef MEMORY_CONTEXT_CHECKING
	,AllocSetCheck
#endif
};

```

#### AllocSetAlloc

```
static void *
AllocSetAlloc(MemoryContext context, Size size)

```

这个函数是 palloc() 的底层调用，具体的逻辑流程为：

 <img src="/monthly/pic/202408/imgs/postgresql_aset_memorycontext_5.png" width = 50%/> 

当请求的 size 超过了 allocChunkLimit，就会直接向 malloc() 申请一个 AllocBclok，并且整个 block 作为一个 AllocChunk 返回给用户。而在 freelist 请求固定大小的 chunk 时，对应 freelist 没有可用 chunk，并且 block 剩余空间也不足，会先将剩余的空间分配到 合适大小的 freelist 中，然后再向 malloc() 申请一个 nextBlockSize 的 block 用于 chunk 分配。

#### AllocSetFree

```
static void
AllocSetFree(MemoryContext context, void *pointer)

```

这个函数是 pfree() 的底层调用，具体的逻辑流程为：

 <img src="/monthly/pic/202408/imgs/postgresql_aset_memorycontext_6.png" width = 50%/> 

执行的逻辑和 AllocSetAlloc 相关，超过 allocChunkLimit 的内存直接归还给操作系统，不超过的内存，交给合适的 freelist 管理。

#### AllocSetRealloc

```
static void *
AllocSetRealloc(MemoryContext context, void *pointer, Size size)

```

这个函数是 repalloc() 的底层调用，具体的逻辑流程为：

 <img src="/monthly/pic/202408/imgs/postgresql_aset_memorycontext_7.png" width = 50%/> 

当原来分配的内存超过 allocChunkLimit，会调整新需求的 size 至少超过 allocChunkLimit，然后调用 realloc()。原来分配 chunksize 能满足新需求 size，则只调整 chunk 的可用空间即可。否则就会调用 AllocSetAlloc 分配新的需求，AllocSetFree 释放老的空间。

#### AllocSetReset

只保留 AllocSet->keeper 的中 block（initial block），其余的 block 都调用 free() 释放掉。

#### AllocSetDelete

删除一个 AllocSet，将所有资源都 free()，如果是可以放入 AllocSetFreeList 中，则会进行 MemoryContextResetOnly 后再放入。

#### AllocSetGetChunkSpace

对分配的一个 chunk，返回包括 AllockChunk header 在内的占用空间。

#### AllocSetIsEmpty

简单判断 context->isReset 是否被置位。

#### AllocSetStats

MemoryContextStatsInternal 的底层调用，统计 AllocSet 的 totalspace，freespace 和 block/freechunks 个数。

#### AllocSetCheck

debug 调试使用，主要是根据分配时规则，做一些检查。

## 参考文档

[https://blog.csdn.net/jackgo73/article/details/89432427](https://blog.csdn.net/jackgo73/article/details/89432427)