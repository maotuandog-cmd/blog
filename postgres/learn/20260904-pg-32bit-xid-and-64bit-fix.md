# digoal/blog 20260904 — PG 32 位 XID 困境与 64 位改造笔记

> 来源: digblog/202609/20260904_01.md (金仓 V9 64 位 XID) + 20260904_05.md (Heikki 2013 page epoch 方案)
> 日期: 2026-09-04
> 关联笔记: quant67-pg-kernel-notes.md 第 03 章 MVCC、第 08 章 vacuum/freezing
> 主题: PG XID 半圆问题、社区方案、国产实现

================================================================
一、PG 32 位 XID 的三层困境
================================================================

来源: 20260904_01.md §一、§四.1; 20260904_05.md §二

1.1 硬上限: 2^32 ≈ 43 亿事务
- TransactionId 本质是 uint32 (src/include/c.h)
- 典型电商库 1 天 5-10 亿事务 → 4 天撑爆
- 高写入业务撑不了几天

1.2 环形半圆语义
- uint32 模 2^32 绕回起点 → 必须环形比较
- 43 亿空间切成两半: 顺时针 = 过去, 逆时针 = 未来
- 判断算法 (TransactionIdPrecedes):
    int32 diff = (int32)(xid1 - xid2);
    return diff < 0;
- 强转 int32 是关键: 利用补码让"半圆前/后"自然二值化

1.3 必须 freeze 的根因
- XID 走过 2^31 边界时, 老 XID 从"过去"翻成"未来"
- 所有 t_xmin 跨半圆的 tuple 会从 MVCC 视野里消失
- 防御: autovacuum 周期扫表, 把 t_xmin < frozen_xid 的行标记为 HEAP_XMIN_FROZEN (一个 t_infomask bit 位)
- FrozenTransactionId = 2 (特殊常量), 被冻结的行永久可见

1.4 freeze 的 3 个真实代价
- IO 暴增: 全表扫 + 写 infomask
- 长事务阻塞: autovacuum 跳过正在被事务占用的 page
- 极端情况: pg_xact slot 剩余 < 100 万时, PG 强制进入单用户模式, 拒绝所有新事务
  (必须在全库 freeze 跑完前停库)

================================================================
二、freeze 标志位在 tuple header 里的位置
================================================================

来源: 20260904_01.md §四.2; 关联 quant67 ch02

HeapTupleHeaderData 关键字段:
  t_choice    t_choice;       // 哪种 t_xmin (HeapTupleHeaderData.t_choice 是 union, 用于压缩)
  TransactionId t_xmin;       // 32 位, 插入事务
  TransactionId t_xmax;       // 32 位, 删除/锁事务
  CommandId   t_cid;          // 命令号, 同事务内多 SQL 区分
  TransactionId t_xvac;       // 32 位, vacuum 锁存 (PG 17 已移除)
  TransactionId t_multi;       // 32 位, multixact id
  ItemPointerData t_ctid;      // 行物理位置

freeze 机制:
- PG 在 t_infomask 预留 2 个 bit: HEAP_XMIN_FROZEN + HEAP_XMIN_INVALID
- freeze 把 t_xmin 替换成 FrozenTransactionId (=2)
- 该 tuple 永远可见, t_xmin 字段被释放可循环复用

================================================================
三、PG 社区 64 位 XID 三种方案对比
================================================================

来源: 20260904_01.md 附录"3 种实现方式"; 20260904_05.md §三-§八

3.1 方案 A: tuple header 真改 64 位 (8 字节额外)
代价:
  - 每个 tuple 多 12-16 字节 (xmin/xmax/multi 全 64 位化)
  - 1 亿行表多 12-16 GB
  - 旧 page 格式不兼容, 升级需全表 rewrite
  - WAL 协议变化
收益:
  - 真 64 位 XID
  - wraparound 风险彻底消失

3.2 方案 B: tuple header 仍 32 位 + page header 加 32 位 epoch (Heikki 2013)
本质: 64 位 XID = (page.epoch << 32) | tuple.xmin
代价:
  - 每个 page 多 4 字节 (显式存 epoch)
  - tuple header 不变, 旧 page 兼容
收益:
  - 真 64 位 XID
  - 旧 page 兼容, 平滑升级

3.3 方案 B+: Alexander Korotkov 2017 改进
- 不存 epoch, 而是在 page header 显式存 FullTransactionId pd_base_xid (8 字节)
- 真实 XID = page.pd_base_xid + tuple.t_xmin (64 位加法)
- 优点: 不依赖 LSN, 逻辑清晰, MVCC 判断时不需要查 half-epoch 表
- 缺点: page header 多 8 字节, 比 LSN 方案多 4 字节
- Tom Lane 担心: index page 加 8 字节是浪费 (MVCC 不解读 index XID)
- Heikki 回应: base 放 heap page 的 special space, index page 不放

3.4 方案 C: tuple header 仍 32 位, 只扩分配层 (freeze 改逻辑)
- 问题: tuple 层面仍会 wraparound, 即使分配层 64 位
- 金仓 V009R002C016 最可能采用类似方案 (保守)

================================================================
四、Heikki page epoch 方案的精妙 — 不显式存 epoch
================================================================

来源: 20260904_05.md §三 — 最核心内容

4.1 原文 (wiki.postgresql.org/wiki/Freezing_XIDs_without_extra_write_I/O):
> "The trick is to add a field to the page header indicating the 'epoch' of
> the XID, while keeping the XIDs in tuple header 32-bit wide"
> "Instead of storing the epoch explicitly, we infer how old an XID is from PageLSN"

4.2 half-epoch 边界表 (pg_control 内)
    typedef struct HalfEpochBoundary {
        XLogRecPtr      begin_lsn;       // half-epoch 开始时的 WAL LSN
        TransactionId   begin_xid;       // 真实 64 位 XID
        TransactionId   begin_xid_mod;    // begin_xid mod 2^32 (快速比较)
    } HalfEpochBoundary;

    // pg_control 只需存 2 个: prev + current
    HalfEpochBoundary half_epoch_boundaries[2];

4.3 MVCC 解读 tuple XID 的算法
  1. 读 tuple.t_xmin 和 tuple.page.PageLSN
  2. 查 half_epoch_boundaries 表, 确定 PageLSN 落在哪个 epoch
  3. real_xid = half_epoch_boundaries[idx].begin_xid + tuple.t_xmin (64 位加法)

4.4 关键数学 (Why 只需 2 个边界)
- 一个 tuple 在被 UPDATE/DELETE 前, XID 最多"老" 2^31
- 一个 page 上 tuple XID 最多跨 2 个 half-epoch
- 因此 half-epoch 边界表只需 2 个 entry

================================================================
五、Heikki 方案 3 大优势
================================================================

来源: 20260904_05.md §四

5.1 Freeze 不需要写 IO
- 传统: autovacuum 扫整张表 + 对每个未冻结 tuple 写 infomask
- 新方案: freeze 只在 UPDATE/DELETE 时自然发生 (page 已被更新)
- 兜底: 用 autovacuum_freeze_max_age=2*10^9 仍要扫, 但只扫有未冻结 tuple 的 page

5.2 Page 格式完全兼容
- 选项 A (显式存 epoch): page header 24 → 28 字节, 不兼容旧 PG
- 选项 B (Heikki 偏好, PageLSN 推断): page header 24 字节不变, 兼容旧 PG
  (旧 PG 仍能读, 只是不能解读 epoch)

5.3 磁盘兼容性 + 平滑升级
- 旧 PG: half_epoch_boundaries 为空, fallback 到 32 位算法
- 升级新 PG: 自动初始化, 新 page 走 epoch 路径, 老 page 走 fallback
- 不需要停机 + 不需要全表 rewrite

================================================================
六、PG 社区没合并 Heikki 方案的 4 个原因
================================================================

来源: 20260904_05.md §七

6.1 XID wraparound 还没真发生
- 过去 20 年, 绝大多数 PG 实例靠 autovacuum 没出过事故
- 没火烧眉毛的痛点 → 没动力

6.2 改 page format 影响生态
- pgBackRest / pg_stat / pglogical 等都依赖 page 格式
- 改 page header 加 epoch, 全部工具要改, 社区不愿承受

6.3 真痛点是长事务
- "freeze 风暴" 真实根因 = 长事务 + autovacuum 跳过 page
- 改进 autovacuum 长事务跳过算法 (2018+ 已多次优化) 比改 XID 架构更直接
- PG 工程哲学: 先治标 (autovacuum 优化), 再治本 (64 位 XID)

6.4 没 committer 接手
- Heikki 是 PG core team, 提交过 64 位 XID 提案但被搁置
- 邮件列表反复讨论, 无合并

================================================================
七、金仓 V009R002C016 (2026-08-28 发布) 64 位 XID 分析
================================================================

来源: 20260904_01.md §三

7.1 公开承认范围 (L903):
> "支持 64 位事务 ID (XID), 避免因 32 位事务 ID 回收不及时或长事务阻塞
> 导致的业务中断问题"

7.2 4 个 VACUUM 参数 int64 化 (L1012-1075):
| 参数                          | 变更前          | 变更后                          |
| ----------------------------- | --------------- | ------------------------------- |
| vacuum_freeze_min_age         | int32 最大 1e9  | int64 最大 2^64-1 ≈ 1.15e19    |
| vacuum_freeze_table_age       | int32 最大 2e9  | int64 最大 2^64-1               |
| vacuum_multixact_freeze_min_age  | int32 最大 1e9  | int64 最大 2^64-1             |
| vacuum_multixact_freeze_table_age| int32 最大 2e9  | int64 最大 2^64-1             |

注意: 默认值没变 (200000000 / 400000000 / 1e10 / 2e10), 仅扩大上限

7.3 工程信号解读
- 默认值保留 = 保留 32 位 XID 语义仿真层, 老 PG 脚本不需改
- → 金仓没把 tuple header t_xmin 改成 64 位
- 最可能: 扩展分配号空间 + 让 XID 不再循环, tuple header 仍 32 位
- 跟 PG 社区 xid8 思路一致: xid8 用于系统表/事务快照/wal,
  tuple header 保留 32 位 (用 frozen bit 标识)

7.4 配套改造
- max_dynamic_memory: 实例级动态内存管控, 防 64 位 XID 引入 OOM
- FastPath 锁 + CLOG/CSNLOG 轻量锁分区数可配
  - CSNLOG = Commit Sequence Number Log, 记录事务提交顺序
  - 64 位 XID 改造必然伴随 CSN 调整 (CSN 之前 32 位跟随 XID 循环)

7.5 三种推测实现方式 (digoal 推测, 非事实)
| 方案 | tuple 头 | page 兼容 | 代价            | 可能性 |
| ---- | -------- | --------- | --------------- | ------ |
| A    | 64 位    | 否        | tuple 多 12-16B | 低     |
| B    | 32 位 + 32 位 epoch | 否        | page 多 4B      | 中     |
| C    | 32 位 + 分配层 64 位 | 是        | 仅 freeze 改逻辑 | 高     |

金仓最可能采用 C: 分配层 64 位 + tuple header 仍 32 位 + freeze 频率降低
(因为没说 page 兼容性, 信创不需要 100% 兼容 PG 生态, 可接受 page 变化)

================================================================
八、PG 16/17/18 的 64 位 XID 进展
================================================================

来源: 20260904_01.md §五.3; 20260904_05.md §九

- PG 16 引入 xid8 数据类型: 只解决用户能用 64 位 XID 字段, 没解决内部分配
  (src/backend/utils/adt/regproc.c + src/include/catalog/pg_type.dat)
- PG 17 改 multixact (transaction_id 改进), 不修主 XID
- PG 18 邮件列表讨论过全 64 位 XID, 因牵动太大, 目前无 RFC
- PG 18.6 (当前主线) 内部 TransactionId 仍是 uint32

================================================================
九、对 PG 社区的启示 (分阶段合并 Heikki 方案)
================================================================

来源: 20260904_05.md §九

阶段 1 (短期, 半年):
- 引入 half-epoch 边界表 (pg_control)
- 引入 epoch 推断函数
- 不改 page format
- 向后兼容: 新功能只对新 page 生效

阶段 2 (中期, 1-2 年):
- 引入 freeze 优化: autovacuum 不再扫 all-visible page
- 引入 vacuum_max_freeze_age 兜底
- autovacuum IO 降 50%+

阶段 3 (长期, 3-5 年):
- 引入 64 位分配号 (分配层 + tuple header 同时改)
- 完全消灭 wraparound 风险

评价: 这个 3 阶段路径比金仓"一步到位"更稳健
- 金仓如果没有阶段 1 铺垫, 直接做阶段 3, 代码改动量极大, 易出 bug

================================================================
十、对应用开发者的建议 (无论 PG 还是金仓 V9)
================================================================

来源: 20260904_01.md §七

1. 不要在应用层做"事务号"运算
   - PG 系事务号不连续 (committed 事务跳号), xid+1 没意义
   - 金仓 64 位后仍然成立

2. 长事务仍是性能杀手
   - 64 位 XID 不解决长事务回滚慢
   - 应用层要避免 >1h 的批量更新

3. freeze 不再是"紧急任务"
   - 监控告警阈值可放宽: 从"剩余 1000 万事务" → "剩余 100 万事务"
   - 给 DBA 留更多运维空间

4. 跨版本迁移测试更复杂
   - 主从 XID 兼容性需要测试

================================================================
十一、关键术语对照
================================================================

| 术语                  | 含义                                                    |
| --------------------- | ------------------------------------------------------- |
| XID                   | TransactionId, PG 内部 32 位 uint32                     |
| GXID                  | GlobalTransactionId, OpenTenBase/Postgres-XL 64 位全局 |
| FrozenTransactionId   | = 2, 特殊 XID 常量, 表示永久可见                        |
| HEAP_XMIN_FROZEN      | t_infomask bit 位, 标识该 tuple 已被 freeze             |
| HEAP_XMIN_INVALID     | t_infomask 另一 bit 位, 标识 t_xmin 无效                |
| frozen xid (PG 圆上点)| 顺时针方向 = 过去, 逆时针方向 = 未来的分界点            |
| half-epoch            | 2^31 事务为界的"半圆", Heikki epoch 推进单位            |
| PageLSN               | page header 里的 pd_lsn, 物理单调递增时间戳             |
| CSN / CSNLOG          | Commit Sequence Number / Log, 事务提交顺序              |
| CLOG                  | Commit Log, SLRU 结构存事务提交状态 (8KB 页, 512 个 XID)|
| xid8                  | PG 16 引入的 64 位 XID 数据类型, 仅用户字段             |
| XID 仿真层            | tuple header 仍 32 位, 分配层 64 位的兼容设计           |

================================================================
十二、引用源
================================================================

- digoal 202108/20210824_01.md 《DB 吐槽大会第 2 期 - PG 32 位 xid》(本仓库历史)
- digoal 20260904_01.md 《PG 30 年顽疾 32 位 XID 被治好了? 金仓 V9 的 64 位事务号实测》
- digoal 20260904_05.md 《PG 32 位 XID 的解药 — Heikki 2013 page epoch 方案完全解剖》
- Heikki wiki: https://wiki.postgresql.org/wiki/Freezing_XIDs_without_extra_write_I/O
- Heikki 邮件: https://postgresql.org/message-id/CA+U5nMJJB8QxYuM87UMmhjV1Bfu8LUAOaaqzhYn2DuK_bfM9mA@mail.gmail.com
- Alexander Korotkov 改进: https://postgresql.org/message-id/CAA4eK1+097Bu6jHrUrebmdcokeO_z36-wP34-w8fpER1j_gbhQ@mail.gmail.com
- Heikki CSN 快照: https://postgresql.org/message-id/5370D323.1070606@vmware.com
- 金仓 V009R002C016 版本说明书: /root/new/tmp/金仓数据库管理系统KingbaseES_V9版本说明书.pdf (L838/L903/L1012-1075)
