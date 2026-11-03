# PostgreSQL 子事务探秘

来源: http://mysql.taobao.org/monthly/2024/07/03/
标签: recent

---

在 PostgreSQL 中，子事务（也称为 “savepoints”）是事务管理中的一个高级特性，它允许用户在一个大的事务内部定义一个或多个savepoints点。这些savepoints允许在发生错误时回滚到某个savepoint，而不是整个事务。子事务是非常有用的，尤其是在事务内处理一系列复杂的操作时，需要在发生错误后从中间的某个操作开始恢复，而不是完全从头开始。

## 子事务的作用

典型的子事务的用法包括

  
- 错误恢复：如果一个事务中的语句失败，可以回滚到最近的 savepoint，而不是回滚整个事务。
    
```
BEGIN; -- 开始一个新的事务
INSERT INTO orders (product_id, quantity, cost) VALUES (1, 10, 99.99);
SAVEPOINT before_next_operation;
-- 尝试另一个操作，可能会失败，例如违反约束
INSERT INTO orders (product_id, quantity, cost) VALUES (2, 20, 199.99);
-- 假设上面的插入失败了，可以回滚到savepoint
ROLLBACK TO SAVEPOINT before_next_operation;
COMMIT;-- 完成事务，插入成功一行

```
    
  
  
- 存储过程中EXCEPTION块，也会隐式的开启子事务，以便于在异常出现时回滚
    
```
DO $$
-- 尝试执行一个可能会失败的操作
BEGIN
INSERT INTO orders (product_id, quantity, cost) VALUES (1, 10, '99.99');
EXCEPTION
WHEN OTHERS THEN
    RAISE NOTICE '出现了一个错误，但我们继续执行。';
    -- 执行一些异常后的操作
END $$ LANGUAGE plpgsql;

```
    
  

## 子事务的设计和实现

PostgreSQL的存储引擎只有redo日志，没有undo日志，因此实现子事务PostgreSQL的做法是为子事务单独分配1个事务id，进行DML的时候子事务使用子事务id来标记tuple的xmin和xmax，这样当子事务回滚的时候就和事务回滚的处理比较相似，不用额外处理已经修改的数据，后续进行MVCC判断的时候就会认为这些修改不可见。

子事务提交时只是修改了父事务的内存状态，只有父事务提交的时候才需要一起把事务内的所有提交的子事务一起提交，使得其他人可以看见这些子事务的修改。

需要注意一点，如果子事务Abort了，无论最终父事务Commit还是Abort，子事务都是Abort，因此子事务Abort的时候就会在日志中记录，和提交的处理有点区别。

## 不正确的子事务用法导致的问题

### 不清理 savepoint

在事务中开启了savepoints，但是在savepoint不需要的时候没有及时release，这会导致该事务的性能下滑，1个典型的错误用法是JDBC驱动中配置了autosave但是没有配置cleanupSavepoints

原因分析：

  
- 事务/子事务状态内存结构

考虑到子事务里面可以继续开子事务，因此子事务的引入其实相当于把事务的状态变成了树状结构，每次开启savepoint相当于为当前事务状态创建了子节点，而子事务提交/release的时候会重新回到parent的事务状态。

```
typedef struct TransactionStateData
{
	...
	TransactionId *childXids;	/* subcommitted child XIDs, in XID order */
	int			nChildXids;		/* # of subcommitted child XIDs */
	int			maxChildXids;	/* allocated size of childXids[] */
	...
    struct TransactionStateData *parent;	/* back link to parent */
} TransactionStateData;

```

  
- MVCC对判断当前事务/子事务状态的需要

事务模块很多时候需要知道事务id是不是当前事务，例如对于插入的数据 && xmin是in progress的，如果xmin是当前事务id，则可见，如果是别的事务插入的，则不可见。需要注意的是，子事务引入之后，“当前事务”的概念不仅包括最上层的父事务，也需要考虑这个父事务中所有的子事务。

  
- 判断事务id是否是当前事务id的逻辑（TransactionIdIsCurrentTransactionId）

因此可以想象，一旦事务内使用的子事务很多，判断1个事务id是不是当前事务id就会引入比较大的性能问题。PG对于这部分的优化点有几处：

第一是每一层的事务状态只保留committed的子事务id，对于aborted的子事务id就认为不是当前事务id。

第二是每一层的事务状态保存的子事务id是按照XID的大小排序好的，因此在检索事务id是不是当前子事务id的时候可以利用二分搜索加速查询。

这2点优化的核心逻辑如下，依次遍历从下至上的树节点，对每一层的childXids数组进行二分搜索。

```
/*
 * We will return true for the Xid of the current subtransaction, any of
 * its subcommitted children, any of its parents, or any of their
 * previously subcommitted children.  However, a transaction being aborted
 * is no longer "current", even though it may still have an entry on the
 * state stack.
 */
for (s = CurrentTransactionState; s != NULL; s = s->parent)
{
	int			low,
				high;

	if (s->state == TRANS_ABORT)
		continue;
	if (!FullTransactionIdIsValid(s->fullTransactionId))
		continue;			/* it can't have any child XIDs either */
	if (TransactionIdEquals(xid, XidFromFullTransactionId(s->fullTransactionId)))
		return true;
	/* As the childXids array is ordered, we can use binary search */
	low = 0;
	high = s->nChildXids - 1;
	while (low childXids[middle];
		if (TransactionIdEquals(probe, xid))
			return true;
		else if (TransactionIdPrecedes(probe, xid))
			low = middle + 1;
		else
			high = middle - 1;
	}
}

```

  
- 如果不清理savepoint会带来什么问题

如果事务内一直反复开启savepoint但是没有清理，因为需要保存事务状态使得可以回滚到任何1个savepoint，就会一直向下递归，事务状态结构就变成了叶子都只有1个的树，实际退化成了链表。这样上述进行TransactionIdIsCurrentTransactionId的逻辑判断时需要从下往上依次遍历所有子事务状态，不能利用二分搜索加速，性能就会下滑。

### 大量子事务的使用伴随着长事务

业务使用了大量子事务 + 长事务会导致性能下降，显著下降的性能加剧了长事务的出现，从而导致系统雪崩。1个典型的现象是系统出现大量的LWLock:SubtransControlLock以及LWLock:subtrans等待事件。

原因分析：

  
- 子事务MVCC判断的需要

对于PostgreSQL而言，子事务的commited/aborted/in progress的事务状态和父事务是绑定的，因此在读取到子事务修改的tuple做MVCC判断的时候，首先要获取子事务对应的父事务，然后再根据父事务的事务状态判断可见与否。而查找子事务到父事务的映射可想而知是1个比较重的操作，针对这种场景PG做了一些优化。

  
- 子事务suboverflowed的概念和影响

当系统中的子事务比较少的时候（所有连接子事务小于64时），PG会在snapshot的结构中保存1个subxip的数组，里面保存了获取snapshot时所有running的子事务的事务id，这样判断MVCC的时候（XidInMVCCSnapshot），可以直接使用这个缓存的数组判断。

但是当系统中的子事务比较多的时候，为了避免snapshot的内存爆炸，PG获取snapshot的时候只会标记suboverflowed，不再保存活跃子事务数组。判断MVCC的时候就需要先获取到子事务对应的父事务，这时候就会用到pg_subtrans结构。
核心代码如下，分配事务ID的时候，如果当前事务的子事务大于64个，就认为当前proc overflowed

```
/*
 * ...
 * If there's no room to fit a subtransaction XID into PGPROC, set the
 * cache-overflowed flag instead.  This forces readers to look in
 * pg_subtrans to map subtransaction XIDs up to top-level XIDs.
 * ...
 */
if (!isSubXact)
{
	...
}
else
{
	XidCacheStatus *substat = &ProcGlobal->subxidStates[MyProc->pgxactoff];
	int			nxids = MyProc->subxidStatus.count;
	Assert(substat->count == MyProc->subxidStatus.count);
	Assert(substat->overflowed == MyProc->subxidStatus.overflowed);
	if (nxids subxids.xids[nxids] = xid;
		pg_write_barrier();
		MyProc->subxidStatus.count = substat->count = nxids + 1;
	}
	else
		MyProc->subxidStatus.overflowed = substat->overflowed = true;
}

```

获取snapshot的时候，如果有1个proc overflowed，则标记当前snapshot为suboverflowed

```
for (int pgxactoff = 0; pgxactoff  0)
          {
              int			pgprocno = pgprocnos[pgxactoff];
              PGPROC	   *proc = &allProcs[pgprocno];

              pg_read_barrier();	/* pairs with GetNewTransactionId */

              memcpy(snapshot->subxip + subcount,
                     proc->subxids.xids,
                     nsubxids * sizeof(TransactionId));
              subcount += nsubxids;
          }
      }
  }
}
...
snapshot->suboverflowed = suboverflowed;

```

  
- 子事务SLRU缓冲区的设计

获取子事务对应的父事务的时候也要一层层往上遍历，直到找到了父事务。这个过程会利用pg_subtrans结构，该结构维护了子事务对应的父事务映射，PG会为这个结构维护1个SLRU缓冲区，把最近频繁访问的子事务所在的page缓存在内存中，如果没有命中SLRU缓冲区，则需要对SLRU缓冲区上写锁，把需要的page换入进来。上锁和读文件会长时间阻塞其他需要访问pg_subtrans的会话，因此导致整体系统性能雪崩

核心逻辑代码如下

```
/*
 * If the snapshot contains full subxact data, the fastest way to
 * check things is just to compare the given XID against both subxact
 * XIDs and top-level XIDs.  If the snapshot overflowed, we have to
 * use pg_subtrans to convert a subxact XID to its parent XID, but
 * then we need only look at top-level XIDs not subxacts.
 */
if (!snapshot->suboverflowed)
{
	/* we have full data, so search subxip */
	if (pg_lfind32(xid, snapshot->subxip, snapshot->subxcnt))
		return true;
	/* not there, fall through to search xip[] */
}
else
{
	/*
	 * Snapshot overflowed, so convert xid to top-level.  This is safe
	 * because we eliminated too-old XIDs above.
	 */
	xid = SubTransGetTopmostTransaction(xid);
	/*
	 * If xid was indeed a subxact, we might now have an xid xmin))
		return false;
}
if (pg_lfind32(xid, snapshot->xip, snapshot->xcnt))
	return true;

```

  
- 长事务对该问题的影响

读到这里大家一定有疑问，看起来子事务使用过多就会导致这个问题，长事务对这个问题又有什么影响呢？影响有2点。

第一如果没有长事务，事务id正常推进的话，XidInMVCCSnapshot做MVCC的时候如果发现子事务id小于xmin，则知道这个事务一定结束了，不用再走上述b or c的逻辑

第二pg_subtrans只会缓存[oldest_xmin, latest_complete_xid)区间内的子事务，每次checkpoint的时候会进行清理，长事务导致需要缓存的子事务数大大增加了，从而很容易打爆SLRU缓冲区的内存大小，从而导致频繁的换入换出，而文件IO以及写锁会导致性能雪崩

因此在没有长事务的系统中这个问题也不容易出现。需要注意这里长事务所谓的长是相对的，不一定指时间长短，和当前oldestxmin和当前最新事务id的差距更相关，事务id分配过快情况下时间短也会出现“长事务”（不幸的是使用子事务就会导致事务id分配过快）

## 一些治理措施

知道了原理再来梳理治理措施就比较容易了

1.创建savepoint后不需要的时候及时清理

2.限制长事务的产生，例如配置idle_in_transaction_session_timeout、transaction_timeout等

3.尽量不要在事务内使用大量的子事务，需要留意1个隐式开子事务的场景——存储过程的EXCEPTION块，一个循环里面每次都捕获异常就会开启大量的子事务

4.调大pg_subtrans缓冲区的大小，社区已经在PG17支持了，由参数subtransaction_buffers控制

## 总结

首先申明，以下纯属个人见解。

受限于PG存储引擎没有引入UNDO的设计，要实现事务内部分逻辑回滚功能PG引入了子事务的概念。也就不得不为子事务分配独立的事务id。

事务是和连接数绑定的，也就是db的活跃事务一定不会超过最大连接数（先不考虑2pc），因此事务系统不容易出现瓶颈。

但是子事务不同，一个活跃事务可以绑定非常多活跃子事务，大量的活跃事务+活跃子事务给内核带来了极大的管理难度。无论是childXids二分搜索的设计还是suboverflowed的设计都是针对大量子事务场景下的一些优化，然而一旦遇到极端场景就会出现性能问题，因此针对PG的子事务要小心使用。

留个小彩蛋，这个问题有没有彻底的解决办法呢，除了Undo存储引擎让子事务功能重新设计外，可能CSN（Commit Sequence Number）也是一个方向，关于CSN的原理以及可能如何解决这个问题，有机会我们下次再分享。