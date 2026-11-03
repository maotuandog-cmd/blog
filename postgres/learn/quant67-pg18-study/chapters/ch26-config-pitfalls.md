# 第 26 章 对照笔记 — 配置陷阱 (11 个 GUC) (PG18.6)

> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/26-config-pitfalls.txt
> PG18 源码: /opt/pg-src/postgresql-18.6/
> 实操验证: 见末尾 evidence/ch26-config-pitfalls-evidence.txt

==============================================================================

## 一、课程要点 (节选)

```
【PG 内核】配置陷阱与生产最佳实践：11 个最危险的 GUC 和它们的正确设置 | 土法炼钢 · 系统与基础设施 土法炼钢兴趣小组的算法知识备份 【PG 内核】配置陷阱与生产最佳实践：11 个最危险的 GUC 和它们的正确设置 2026-06-16 · database · kernel · ops · #postgresql #pg-kernel #guc #configuration #shared-buffers #work-mem #effective-cache-size #random-page-cost #fsync #synchronous-commit #huge-pages #maintenance-work-mem #idle-in-transaction #log-lock-waits #deadlock-timeout #log-min-duration-statement #auto-explain #postgresql-tuning 文章导航 分类入口 database kernel ops 标签入口 #postgresql #pg-kernel #guc #configuration #shared-buffers #work-mem #effective-cache-size #random-page-cost #fsync #synchronous-commit #huge-pages #maintenance-work-mem #idle-in-transaction #log-lock-waits #deadlock-timeout #log-min-duration-statement #auto-explain #postgresql-tuning 目录 配置陷阱与生产最佳实践：11 个最危险的 GUC 和它们的正确设置 一、shared_buffers：不是越大越好 这个参数在内核里控制什么 为什么默认值在你的场景下可能是错的 配错后的症状 查验方法 二、work_mem：最危险的 GUC 这个参数在内核里控制什么 为什么默认值在你的场景下可能是错的 配错后的症状 查验方法 六、synchronous_commit=off：最多丢 wal_writer_delay 的已提交事务 这个参数在内核里控制什么 为什么默认值在特定场景下是错的 配错后的症状 查验方法 七、huge_pages：Docker/K8s 中的静默退化 这个参数在内核里控制什么 为什么默认值在你的场景下可能是错的 配错后的症状 查验方法 八、maintenance_work_mem：慢 VACUUM 和慢 CREATE INDEX 的隐形瓶颈 这个参数在内核里控制什么 为什么默认值在你的场景下可能是错的 配错后的症状 查验方法 十二、总结：配置审计的思维框架 参考资料 官方文档 源码（PG 17） 相关章节 配置陷阱与生产最佳实践：11 个最危险的 GUC 和它们的正确设置 PG 的配置系统（GUC，Grand Unified Configuration）是内核行为的外在控制面。 postgresql.conf 里的每一个参数，背后都对应着源码中的特定分支、数据结构和算法路径。GUC 的核心理念是 “内置合理默认值，允许懂的人改” ——但问题在于，“懂”的门槛远比多数人想象的高。 这套配置系统的坑不在于参数太多（PG 17 有 350+ 个 GUC），而在于 参数之间相互联动、默认值的物理假设经常过时、以及错误配置的症状往往远离根因 。你把 work_mem 调到了 256MB 想让查询跑快点，三天后 OOM killer 随机杀连接——这两件事之间的因果关系埋在进程模型、Hash Join 的内存分配路径和 Linux overcommit 三层机制之下。 本文不是 GUC 参数列表。本文从 11 个生产环境中最容易被误解和配错的参数出发，每条走这条路： 这个参数在内核里控制什么 → 默认值在什么场景下是错的 → 配错后症状的内核机制解释 → 通过什么 SQL 和 shell 命令查验当前设置是否有问题 。目标不是告诉你”设成 X 就好”，而是让你知道 为什么、怎么验证 。 本文涉及的很多内核机制在前置章节中有详细拆
```

## 二、PG18 源码定位


| GUC | 课程陷阱 | PG18 默认 |
|---|---|---|
| shared_buffers | 越大越好? | 128MB |
| work_mem | 每操作内存上限? | 4MB (per operation!) |
| fsync | 关闭 fsync 提升性能 | on (生产必 on) |
| huge_pages | Docker 静默退化 | try |
| random_page_cost | NVMe 上 4.0 离谱 | 4.0 |
| wal_buffers | -1 auto 还是手动? | -1 (auto) |
| wal_compression | zstd/pglz/lz4 | off |
| max_connections | 1000 = 10GB? | 100 |
| checkpoint_timeout | 太短 IO 风暴 | 5min |
| autovacuum_vacuum_scale_factor | 0.05 太勤? | 0.2 |
| synchronous_commit | on/off 区别 | on |


## 三、PG18 源码摘录


### 26.1 11 个 GUC 当前默认值 (从 PG18 guc_tables.c 提取)
```
shared_buffers: default=N/A
work_mem: default=N/A
fsync: default=N/A
huge_pages: default=N/A
random_page_cost: default=N/A
wal_buffers: default=N/A
wal_compression: default=N/A
max_connections: default=N/A
checkpoint_timeout: default=N/A
autovacuum_vacuum_scale_factor: default=N/A
synchronous_commit: default=N/A
```


## 四、PG18 vs 课程(以 PG17 为主线) 差异点


1. **PG18 default 调整**: huge_pages 默认 'try' (Docker 内核不支持时静默退化成 off)
2. **work_mem**: 仍是 per operation
3. **synchronous_commit**: PG18 默认 on
4. **wal_compression**: PG15+ 加 zstd 和 lz4


## 五、实操验证


**真实运行输出已保存到**: `evidence/ch26-config-pitfalls-evidence.txt`


### 关键输出
```
              name              | setting | unit 
--------------------------------+---------+------
 autovacuum_vacuum_scale_factor | 0.2     | 
 checkpoint_timeout             | 300     | s
 fsync                          | on      | 
 huge_pages                     | try     | 
 max_connections                | 100     | 
 random_page_cost               | 4       | 
 shared_buffers                 | 16384   | 8kB
 synchronous_commit             | on      | 
 wal_buffers                    | 512     | 8kB
 wal_compression                | off     | 
 work_mem                       | 4096    | kB
(11 rows)

 huge_pages 
------------
 try
(1 row)

 num_timed | num_requested | write_time | sync_time 
-----------+---------------+------------+-----------
        25 |             3 |      13938 |         5
(1 row)


```


## 七、小结 — 与下章衔接

学完 26 章完整 quant67 PG 内核路线图. 后续可补充: 各章 GDB 实验脚本库 / 故障复现 docker-compose 场景.