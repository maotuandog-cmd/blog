# 【存储工程】向量存储与 ANN 索引

来源: https://quant67.com/post/storage/39-vector-storage/vector-storage.html
日期: 2026-08-03 |

---

给定一条 768
            维的文本嵌入向量（Embedding），要从一亿条同维度向量中找出最相似的
            10 条。暴力计算需要对每条向量做 768
            次乘法和一次求和——一亿条就是 768 亿次浮点运算，单核 CPU
            跑完需要几十秒。如果这个操作发生在每一次用户搜索请求中，系统根本无法响应。
            
            

**阅读路径（入门 → 算法 → 引擎 → 同进程
            SQL）**
            
            
            
            
            
            
            
            
            层级
            文章
            本文分工
            
            
            
            
            **本文**
            存储工程入门
            L2/余弦/内积**几何意义**、暴力基线、LSH/HNSW/量化**直觉**与
            FAISS 选型口吻
            
            
            算法深度
            db-frontier/08
            向量索引、09
            混合过滤
            HNSW/DiskANN/ACORN
            假设与争论；**不在本文重推导**
            
            
            生产引擎
            向量检索引擎系列
            Milvus Segment/WAL/Segcore/Knowhere；Qdrant/Lance
            对照
            
            
            同进程 SQL
            pgvector
            内核对照
            Index AM、8KB 页装箱、与专用引擎生命周期差
            
            
            RAG 应用
            llm-infra/17–18
            召回与选型，不写引擎页模型
            
            
            
            

建议：先读本文建立词汇 → 算法争议读 frontier → 生产路径读
            vector-engine → 已有 Postgres 再读 pgvector
            对照。下文示例口径为 FAISS 1.7.x /
            历史叙述；**现行引擎机制以 vector-engine
            系列版本锚定为准**。
            

**证据边界（S
            档收束，2026-07-25）**：本文是存储工程**入门**。文中出现的毫秒级延迟、QPS
            表、RAG 端到端耗时，凡未写明「本机实验台账」或「带
            figure/table
            的外部引用」的，一律视为**教学示意或历史口径，不是本站可复现结论**。算法深度与生产内核分别见
            frontier / vector-engine；不要用本文数字做选型 SLA。
            
            

这就是近似最近邻搜索（Approximate Nearest Neighbor,
            ANN）要解决的核心问题：在精度可接受的范围内，把检索时间从线性降到亚线性甚至对数级别。过去十年，随着深度学习把文本、图像、音频统一编码成高维向量，ANN
            从学术研究走进了工程主战场。搜索引擎的语义召回、推荐系统的候选检索、RAG（Retrieval-Augmented
            Generation）管线的文档检索——底层都依赖高效的向量存储与索引。
            

本文从向量检索的度量几何出发（L2 / 余弦 /
            内积的等高线与归一化等价），给出暴力搜索、KD-Tree、LSH、HNSW、量化的工程直觉与
            FAISS 选型口吻，并落到 RAG 场景的注意点。HNSW/DiskANN
            的论文级对比见 db-frontier/08；Milvus
            / Qdrant / Lance / pgvector 的生产路径见 向量检索引擎。代码示例基于
            FAISS 1.7.4 口径与 Python
            3.10；不把未在本机复跑的历史吞吐写成当前结论。度量图示由同目录
            `gen_metric_figures.py` 生成。
            
            

## 一、向量检索问题

            

### 1.1 从离散符号到连续向量

            

传统信息检索基于关键词匹配。用户输入”如何优化数据库性能”，系统在倒排索引（Inverted
            Index）中查找包含”优化”“数据库”“性能”这些词条的文档。这种方法有一个根本缺陷：它无法理解语义。“提升
            MySQL
            查询速度”和”优化数据库性能”在语义上高度相似，但关键词交集为零。
            

嵌入模型（Embedding
            Model）解决了这个问题。它把文本、图像、音频等非结构化数据映射到一个高维连续向量空间（Vector
            Space），使得语义相似的对象在向量空间中距离相近。以文本为例：
            
```
# text-embedding 模型将文本映射为 768 维向量
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("BAAI/bge-base-zh-v1.5")
v1 = model.encode("如何优化数据库性能")  # shape: (768,)
v2 = model.encode("提升 MySQL 查询速度")  # shape: (768,)
v3 = model.encode("今天天气不错")          # shape: (768,)

# 余弦相似度：同模型、同语料上语义近的一对通常明显高于无关对；
# 具体分数依赖模型版本与是否归一化，下表数字勿当本站实测。
```

            

每个向量是一个浮点数数组，维度（Dimension）从 128 到 4096
            不等。常见维度：
            
            
            
            模型
            维度
            用途
            
            
            
            
            OpenAI text-embedding-3-small
            1536
            通用文本嵌入
            
            
            BAAI/bge-base-zh-v1.5
            768
            中文文本嵌入
            
            
            CLIP ViT-B/32
            512
            图文跨模态嵌入
            
            
            Cohere embed-v3
            1024
            多语言文本嵌入
            
            
            
            

### 1.2 相似度度量与几何意义

            

向量检索的核心操作是：给定查询 \(q\)，按某个打分函数对库中向量排序，取
            Top-\(K\)。工程里最常见的三种度量——欧氏距离（L2）、余弦相似度（Cosine）、内积（Inner
            Product /
            IP）——代数形式不同，**等高线形状不同，排序也不一定相同**。更深的点积几何直觉见
            Transformer
            系列：向量与点积；本节只钉住检索排序需要的几何图景。
            

#### 欧氏距离（L2）

            

\[d_2(x, y) = \|x - y\|_2 =
            \sqrt{\sum_{i=1}^{D} (x_i - y_i)^2}\]
            

值域 \([0,
            +\infty)\)，越小越近。工程上常直接用平方距离 \(\|x-y\|_2^2\)（FAISS
            `IndexFlatL2`
            的比较量），因为开方是单调的，不影响排序。
            

几何上，L2 的等距面是以查询点 \(q\)
            为球心的超球面；二维里就是一圈圈同心圆。**距离从 \(q\)
            量起，不是从原点量起。**
            
            ![L2 等距圆：以查询点为圆心按半径排序](./metric-l2-geometry.svg)
            L2
            等距圆：以查询点为圆心按半径排序
            
            

适合「绝对位置」有意义的特征（例如某些图像描述子、坐标类特征）。文本
            embedding 若未经归一化、且幅度编码了模型无关的尺度噪声，L2
            会把「离查询点近但方向不同」的点排到「方向相同但范数差大」的点前面——这是后面排序分歧图要说明的现象。
            

#### 余弦相似度

            

一句话：**余弦只问「两支箭夹角多大」，不问「谁更长」。**
            

把每个向量看成从原点出发的箭。两支箭之间有一个夹角 \(\theta\)。余弦相似度就是这个夹角的余弦：
            

\[\operatorname{cos}(x, y) =
            \frac{\langle x, y \rangle}{\|x\|_2 \|y\|_2} = \cos\theta =
            \hat{x}\cdot\hat{y}\]
            

值域 \([-1,
            1]\)。刻度可以直接对照钟表指针：
            
            
            
            夹角 \(\theta\)
            \(\operatorname{cos}\theta\)
            几何含义
            检索语义
            
            
            
            
            \(0°\)
            \(1\)
            完全同向
            最相似
            
            
            \(45°\)
            \(\approx 0.71\)
            明显同侧
            较相似
            
            
            \(90°\)
            \(0\)
            垂直
            无关
            
            
            \(180°\)
            \(-1\)
            完全反向
            最不相似
            
            
            
            
            ![余弦分数与夹角刻度：同向 / 45° / 垂直 / 反向](./metric-cosine-angle-scale.svg)
            余弦分数与夹角刻度：同向 /
            45° / 垂直 / 反向
            
            

所以排序时「余弦大」=「夹角小」=「方向更齐」。它不比较两点之间的欧氏距离，只比较方向。
            

**长度无关是它的核心工程性质。**
            同一射线上任意拉长或缩短，夹角不变，余弦恒为 \(1\)。左图三个点都在查询射线上，余弦全是
            \(1.00\)；右图同一组点用
            L2，短点和长点反而离查询更远。
            
            ![长度不变性：射线上长短余弦相同，L2 不同](./metric-cosine-length-invariant.svg)
            长度不变性：射线上长短余弦相同，L2
            不同
            
            

文本检索特别吃这一套。同一话题写 50 字摘要和 5000
            字长文，词频 / embedding 的范数往往差很多；若用
            L2，长文容易「跑远」。余弦先剥掉长度，只留「主题方向」，短摘要和长文可以排在一起。
            

另一个几何画面：**余弦的「邻域」是从原点张开的无限圆锥，不是绕查询点的球。**
            只要夹角够小，离原点多远都算近邻；L2 则要求落在以 \(q\) 为球心的球内。
            
            ![余弦等值邻域是从原点张开的圆锥](./metric-cosine-cones.svg)
            余弦等值邻域是从原点张开的圆锥
            
            
            ![同射线短向量与查询余弦为 1（原始示意）](./metric-cosine-geometry.svg)
            同射线短向量与查询余弦为
            1（原始示意）
            
            

代数上，余弦就是两边先单位化再做内积。工程里几乎总是入库与查询都先
            L2
            归一化，然后直接算内积——数值与余弦相同，少一次除法。Milvus /
            Qdrant 的 `COSINE`、多数 embedding API
            的默认评测口径，都落在这一族。更深的点积几何见 向量与点积。
            

#### 内积（IP）

            

\[\operatorname{IP}(x, y) =
            \langle x, y \rangle = \|x\|_2 \|y\|_2
            \cos\theta\]
            

未归一化时，内积同时吃进**方向对齐**与**双方范数**。几何读法：把
            \(x\) 投影到 \(q\) 的方向上，投影长度再乘
            \(\|q\|\)。固定 \(q\) 时，等值线是垂直于 \(q\)
            的超平面（二维里是一组平行直线）；离原点沿 \(q\) 方向越远的点，IP 越大。
            
            ![内积：投影乘上查询范数；等值线垂直于查询方向](./metric-ip-geometry.svg)
            内积：投影乘上查询范数；等值线垂直于查询方向
            
            

推荐系统里「热门物品向量范数更大」时，用 IP
            会主动抬高热门——这是设计选择，不是
            bug。若业务其实要纯方向相似，却对未归一化向量建
            `IndexFlatIP`，排序会被范数绑架。
            

#### 未归一化时三种度量可以给出三种排序

            

同一组二维点、同一个 \(q\)，三种度量的最近邻顺序可以完全不同（图中数值由脚本对固定坐标直接计算，可复现）：
            
            
            
            点
            相对 \(q\) 的角色
            
            
            
            
            \(a\)
            欧氏意义下离 \(q\)
            最近
            
            
            \(b\)
            范数大、方向尚可 → 内积最大
            
            
            \(c\)
            短、几乎与 \(q\) 同向 →
            余弦最大
            
            
            
            
            ![同一组点上 L2 / 余弦 / 内积给出三种不同排序](./metric-ranking-disagreement.svg)
            同一组点上 L2 / 余弦 /
            内积给出三种不同排序
            
            

这就是生产里「召回看起来怪」的常见根因之一：建索引声明的
            `metric_type` 与入库前是否 L2
            归一化、与评测脚本用的打分，三者不一致。契约侧的排障口径见
            vector-engine
            接口篇。
            

#### 归一化后三者排序一致

            

对任意 \(x,
            y\)，有恒等式
            

\[\|x - y\|_2^2 = \|x\|_2^2 +
            \|y\|_2^2 - 2\langle x, y \rangle.\]
            

若强制 \(\|x\|_2 = \|y\|_2 =
            1\)（单位超球面 / 二维单位圆），则
            

\[\|x - y\|_2^2 = 2\bigl(1 -
            \langle x, y \rangle\bigr) = 2\bigl(1 -
            \operatorname{cos}(x, y)\bigr).\]
            

因此在单位球上：**最大化内积 ≡ 最大化余弦 ≡ 最小化
            L2**（排序完全相同；数值只差一个单调变换）。这也是「先
            `normalize`，再开
            `IndexFlatIP`」能代替显式余弦的代数原因——内积更省一次除法，SIMD
            路径更干净。
            
            ![单位圆上三种度量诱导同一排序](./metric-normalize-equivalence.svg)
            单位圆上三种度量诱导同一排序
            
            

选型口吻（机制层，不是 SLA）：
            
            
            
            
            
            
            
            
            场景
            常用度量
            预处理
            
            
            
            
            文本 / 多模态 embedding 语义召回
            余弦，或 IP
            入库与查询都 L2 归一化
            
            
            需要保留幅度（热度、能量）
            IP
            不要盲目归一化
            
            
            绝对坐标 / 部分视觉特征
            L2
            按特征尺度决定是否标准化
            
            
            
            

索引构建与查询必须使用同一度量；FAISS 的
            `IndexFlatL2` 与 `IndexFlatIP`
            不可互换理解。图示由同目录
            `gen_metric_figures.py`
            生成，改坐标后重跑即可核对排序。
            

### 1.3 维度灾难

            

高维空间有一个反直觉的性质：随着维度增加，所有数据点之间的距离趋于相等。这就是维度灾难（Curse
            of Dimensionality）。
            

具体来说，在 D 维空间中随机采样 N 个点，当 D
            足够大时：
            

\[\frac{d_{\max} -
            d_{\min}}{d_{\min}} \to 0\]
            

最近邻和最远邻的距离差异趋于零，“最近邻”的概念失去区分度。这意味着：
            
            
- 基于空间划分的索引结构（如
            KD-Tree）在高维下退化为暴力搜索。
            
- 精确最近邻搜索（Exact Nearest
            Neighbor）在高维高数据量下不可行。
            
- 我们必须接受近似——用 [Recall@K](mailto:Recall@K)（召回率）衡量搜索质量，换取可接受的延迟。
            
            
```
# 维度灾难的直观演示
import numpy as np

for dim in [2, 10, 100, 768]:
    points = np.random.randn(10000, dim).astype(np.float32)
    # 计算所有点到原点的距离
    dists = np.linalg.norm(points, axis=1)
    ratio = (dists.max() - dists.min()) / dists.min()
    print(f"dim={dim:4d}  max/min ratio={ratio:.4f}")

# 输出示例：
# dim=   2  max/min ratio=48.2371
# dim=  10  max/min ratio= 3.1825
# dim= 100  max/min ratio= 0.8694
# dim= 768  max/min ratio= 0.3012
```

            

维度从 2 增长到 768 时，最远点和最近点的距离比从 48
            倍缩小到 1.3 倍。这解释了为什么在 768 维空间中，KD-Tree
            的剪枝几乎不起作用。
            

### 1.4 检索质量度量

            

评估 ANN 算法的质量，核心指标是 [Recall@K](mailto:Recall@K)（召回率）：
            

\[\text{Recall@K} =
            \frac{|\text{ANN 返回的 K 个结果} \cap \text{真实的 K
            个最近邻}|}{K}\]
            

例如，真实最近邻 Top-10 是 {A, B, C, D, E, F, G, H, I,
            J}，ANN 算法返回的 Top-10 是 {A, B, C, D, E, F, G, H, X,
            Y}，则 [Recall@10](mailto:Recall@10) = 8/10 = 0.8。
            

工程中通常要求 [Recall@10](mailto:Recall@10) >= 0.95，即 10 个结果中至少
            9.5 个是真实最近邻。在 RAG
            场景中，由于后续还有重排序（Reranking）环节，初始召回阶段可以适当放宽到
            [Recall@100](mailto:Recall@100)
            >= 0.90。
            
            

## 二、暴力搜索与 KD-Tree

            

### 2.1 暴力搜索

            

暴力搜索（Brute-Force Search / Flat
            Search）是最简单的基线：遍历所有向量，逐一计算距离，保留最小的
            K 个。
            
```
# FAISS 暴力搜索
import faiss
import numpy as np

dim = 768
n = 1_000_000  # 一百万条向量
nq = 1         # 单条查询

# 生成数据
xb = np.random.randn(n, dim).astype(np.float32)
xq = np.random.randn(nq, dim).astype(np.float32)

# 构建暴力搜索索引（无需训练）
index = faiss.IndexFlatL2(dim)
index.add(xb)

# 搜索 Top-10
D, I = index.search(xq, 10)
# D: 距离矩阵，shape (1, 10)
# I: 索引矩阵，shape (1, 10)
```

            

暴力搜索的时间复杂度是 \(O(ND)\)，空间复杂度是 \(O(ND)\)。对于 \(10^6\) 条 768 维 float32
            向量：
            
            
- 存储空间：\(10^6 \times 768
            \times 4\) 字节 \(=
            2.87\) GB（算术结果，与硬件无关）
            
- 单次查询浮点乘加量级：\(10^6
            \times 768 = 7.68\times 10^8\)
            
            

**延迟取决于实现（BLAS/SIMD）、是否归一化、内存带宽与是否冷缓存**——本站未在本文固定硬件上复跑
            Flat 计时。工程直觉：百万级稠密暴力搜常已接近或超过在线
            SLA；亿级必须近似索引。数据量很小时（例如 \(<10^5\) 量级），Flat
            常因零建索开销而足够，但这是选型口吻而非本机 benchmark。
            

暴力搜索的优点是 Recall@\(K =
            1.0\)（精确结果）和零训练开销。
            

### 2.2 KD-Tree

            

KD-Tree（K-Dimensional
            Tree）是最经典的空间划分索引。它沿着各维度交替切分空间，将数据组织成一棵二叉树。
            

构建过程：
            
            
- 选择方差最大的维度作为切分维度。
            
- 找到该维度的中位数，作为切分点。
            
- 左子树存放该维度值小于中位数的点，右子树存放大于等于中位数的点。
            
- 递归执行，直到叶节点中的点数小于阈值。
            
            

查询过程：
            
            
- 从根节点开始，根据查询点在切分维度上的值决定先搜索左子树还是右子树。
            
- 搜索到叶节点后，将叶节点中的点加入候选集。
            
- 回溯时，检查另一侧子树的超平面距离。如果超平面距离小于当前第
            K 近邻的距离，则进入另一侧子树搜索。
            
- 回溯完成后，候选集中保留距离最小的 K 个点。
            
            
```
# scikit-learn 的 KD-Tree 实现
from sklearn.neighbors import KDTree
import numpy as np

dim = 20  # KD-Tree 适合低维
n = 100_000

data = np.random.randn(n, dim).astype(np.float64)
tree = KDTree(data, leaf_size=40)

query = np.random.randn(1, dim).astype(np.float64)
dist, ind = tree.query(query, k=10)
```

            

KD-Tree 在低维（\(D <
            20\)）时剪枝有效，查询可接近对数步；随着维度增加，需要访问的节点比例上升，最终退化为接近线性扫描，并额外付出树遍历的指针与缓存代价。这是「维度灾难」在空间划分索引上的工程表现，不是某一实现的偶然慢。
            
            
            
            现象（机制层）
            低维
            高维（如 \(D\ge
            100\)）
            
            
            
            
            超平面剪枝
            常可丢掉大半子树
            多数分支都可能与查询球相交
            
            
            相对 Flat
            常更快
            常不更快，甚至更慢
            
            
            
            

**上表不附毫秒数**：本站未在本文复跑 sklearn
            `KDTree` vs Flat；需要数字时用本机同一
            `n,d,k`
            自测，或引用带硬件说明的外部报告。结论不变：KD-Tree
            不适合常见文本嵌入维度的主路径。
            

### 2.3 Ball Tree 与 VP-Tree

            

Ball Tree 和 VP-Tree（Vantage Point Tree）是 KD-Tree
            的改进。Ball Tree
            用超球体（Hypersphere）而非超平面划分空间，VP-Tree
            选择一个支点（Vantage
            Point）并按到支点的距离划分。它们在中等维度（20-50）下比
            KD-Tree 略好，但在 D > 100
            时同样退化。这两种结构在向量数据库中基本不使用，但它们的思想影响了后来的层级聚类索引。
            
            

## 三、LSH 局部敏感哈希

            

### 3.1 核心思想

            

局部敏感哈希（Locality-Sensitive Hashing,
            LSH）是第一个在理论上解决高维近似最近邻问题的方法。它的核心思想是：设计一族哈希函数（Hash
            Function
            Family），使得相似的向量以高概率被映射到同一个桶（Bucket），不相似的向量以高概率被映射到不同的桶。
            

形式化定义：对于距离阈值 \(r\)、近似比 \(c > 1\)、概率 \(p_1 > p_2\)，一个 \((r, cr, p_1,
            p_2)\)-敏感的哈希函数族 \(\mathcal{H}\) 满足：
            
            
- 如果 \(d(x, y) \leq
            r\)，则 \(\Pr[h(x) = h(y)]
            \geq p_1\)
            
- 如果 \(d(x, y) \geq
            cr\)，则 \(\Pr[h(x) = h(y)]
            \leq p_2\)
            
            

### 3.2 基于随机超平面的 LSH

            

对于余弦相似度，最常用的哈希函数是随机超平面投影（Random
            Hyperplane Projection）：
            
            
- 随机生成一个 D 维向量 \(r\)（各分量从标准正态分布采样）。
            
- 定义哈希函数 \(h(x) =
            \text{sign}(r \cdot x)\)。如果内积大于 0，哈希值为
            1；否则为 0。
            
- 用 \(L\)
            个这样的哈希函数，把每个向量映射为一个 \(L\)
            位的二进制签名（Signature）。
            
            

两个向量的签名的汉明距离（Hamming
            Distance）与它们的余弦相似度之间存在数学关系：
            

\[\Pr[h(x) = h(y)] = 1 -
            \frac{\theta}{\pi}\]
            

其中 \(\theta =
            \arccos(\text{sim}(x, y))\)。
            
```
# LSH 随机超平面投影
import numpy as np

class RandomProjectionLSH:
    def __init__(self, dim, num_hashes, num_tables):
        self.num_tables = num_tables
        self.num_hashes = num_hashes
        # 每个哈希表使用不同的随机投影矩阵
        self.projections = [
            np.random.randn(num_hashes, dim).astype(np.float32)
            for _ in range(num_tables)
        ]
        self.tables = [dict() for _ in range(num_tables)]

    def _hash(self, vec, table_idx):
        proj = self.projections[table_idx] @ vec
        return tuple((proj > 0).astype(int))

    def insert(self, idx, vec):
        for t in range(self.num_tables):
            key = self._hash(vec, t)
            if key not in self.tables[t]:
                self.tables[t][key] = []
            self.tables[t][key].append(idx)

    def query(self, vec, k=10):
        candidates = set()
        for t in range(self.num_tables):
            key = self._hash(vec, t)
            if key in self.tables[t]:
                candidates.update(self.tables[t][key])
        return candidates  # 还需要对候选集做精确排序
```

            

### 3.3 多探测 LSH

            

基本 LSH
            的问题是空间开销大：为了达到高召回率，需要大量哈希表。多探测
            LSH（Multi-Probe
            LSH）通过在查询时探测多个相邻桶来缓解这个问题——不仅查询命中的桶，还查询汉明距离为
            1、2 的相邻桶。这样可以用更少的哈希表达到相同的召回率。
            

### 3.4 LSH 的工程局限

            

LSH
            在理论上有优雅的近似保证，但在工程实践中存在几个显著问题：
            
            
- **内存开销大**。每个哈希表需要存储所有向量的哈希值和指针。为了达到
            [Recall@10](mailto:Recall@10) >=
            0.95，通常需要 50-200 个哈希表，内存膨胀数倍。
            
- **召回率-速度权衡不如
            HNSW**。在相同的召回率下，LSH 的查询延迟通常比 HNSW
            高一个数量级。
            
- **参数选择困难**。哈希位数、哈希表数量、探测数量三个参数相互关联，很难在不跑实验的情况下选出最优组合。
            
- **不支持增量更新**。哈希表的桶大小不均匀，删除和更新操作效率低。
            
            

在实际系统中，LSH 已经被 HNSW 和 IVF 系列算法全面替代。但
            LSH
            的核心思想——通过哈希把高维空间映射到低维空间进行粗筛——仍然影响着后续算法的设计。例如
            E2LSH 库在学术界有广泛使用，但在生产向量数据库中几乎看不到
            LSH 索引。
            
            

## 四、HNSW 图索引

            
            

**分工**：本节只保留 NSW→HNSW 的工程直觉与
            FAISS 参数口吻。层级结构、复杂度假设、与 DiskANN
            的磁盘/内存分叉，以 db-frontier/08
            为准；生产引擎里索引如何挂进 Segment/Knowhere，见 vector-engine/08。
            
            

### 4.1 从 NSW 到 HNSW

            

可导航小世界图（Navigable Small World,
            NSW）是一种基于图的 ANN
            索引。它把每个向量视为图中的一个节点，节点之间通过边连接。查询时从一个入口节点出发，贪心地沿着边移动到距离查询向量更近的节点，直到无法再接近为止。
            

NSW 的关键性质来自小世界网络（Small World
            Network）理论：如果图同时具有局部连通性和远程跳跃连接（Long-Range
            Link），那么从任意节点到目标节点的贪心搜索路径长度是 O(log
            N)。
            
```
NSW 图的结构示意：

  节点间距离越近，连接概率越高
  少量远程连接提供"跳跃"能力

  [A] ---近邻--- [B] ---近邻--- [C]
   |               |               |
   |  远程连接      |               |
   +---------------+--- [F] ------+
                   |
  [D] ---近邻--- [E]
```

            

分层可导航小世界图（Hierarchical Navigable Small World,
            HNSW）是 Malkov 和 Yashunin 在 2016
            年提出的改进。核心思想是把 NSW 图分成多层，类似跳表（Skip
            List）：
            
            
- **第 0
            层**（最底层）包含所有节点，每个节点与最多 \(2M\) 个邻居相连。
            
- **第 1 层**包含约 \(N / m_L\) 个节点（\(m_L\) 通常为 \(e^{1/\ln(M)}\)）。
            
- **第 \(l\)
            层**包含约 \(N /
            m_L^l\) 个节点。
            
- 最顶层只有少数几个节点。
            
            

查询时从最顶层的入口节点开始贪心搜索，到达该层的局部最近邻后下降到下一层，继续搜索。这样高层提供粗粒度的远程导航，底层提供精细的局部搜索。
            

### 4.2 构建算法

            

HNSW 索引的构建是逐点插入的：
            
```
HNSW-INSERT(hnsw, q, M, efConstruction):
  1. 为 q 随机选择一个层级 l = floor(-ln(random()) * mL)
  2. ep = 入口点
  3. 从最顶层 L 到 l+1 层：
     在当前层做贪心搜索，找到最近的 1 个节点
     将 ep 更新为该节点
  4. 从第 l 层到第 0 层：
     在当前层做 beam search，维护 efConstruction 大小的候选集
     从候选集中选择最多 M 个邻居连接到 q
     对每个新邻居 e，如果 e 的邻居数超过 M（或 Mmax），
       执行邻居裁剪（neighbor pruning）
  5. 如果 l > L，更新入口点为 q
```

            

几个关键设计：
            
            
- **层级选择**用指数衰减概率，保证每层的节点数量呈指数递减。
            
- **邻居裁剪**不是简单保留最近的 M
            个，而是使用启发式方法（Heuristic
            Pruning）：优先保留方向多样性好的邻居，避免邻居都聚集在同一方向。这对搜索质量影响极大。
            
            
```
# FAISS 构建 HNSW 索引
import faiss
import numpy as np

dim = 768
n = 1_000_000
M = 32              # 每个节点的邻居数
efConstruction = 200 # 构建时的搜索宽度

# 生成数据
xb = np.random.randn(n, dim).astype(np.float32)

# 构建 HNSW 索引
index = faiss.IndexHNSWFlat(dim, M)
index.hnsw.efConstruction = efConstruction
index.add(xb)  # 逐点插入，耗时较长

# 查询
index.hnsw.efSearch = 64  # 查询时的搜索宽度
xq = np.random.randn(1, dim).astype(np.float32)
D, I = index.search(xq, 10)
```

            

### 4.3 搜索算法

            

HNSW 的查询算法是分层贪心搜索：
            
```
HNSW-SEARCH(hnsw, q, K, efSearch):
  1. ep = 入口点
  2. 从最顶层 L 到第 1 层：
     在当前层做贪心搜索（beam width = 1），找到最近邻
     ep = 该最近邻
  3. 在第 0 层做 beam search（beam width = efSearch）：
     维护两个优先队列：
       candidates（小顶堆，按距离升序）
       results（大顶堆，按距离降序，容量 efSearch）
     初始化：将 ep 加入 candidates 和 results
     循环：
       从 candidates 取出最近的候选节点 c
       如果 d(c, q) > results 中最远的距离，终止
       对 c 的每个邻居 e（未访问过）：
         如果 d(e, q) 
            
- 查询复杂度与 `efSearch`、邻接度相关，常远低于
            Flat 的 \(O(ND)\)；具体毫秒须本机测。
            
- 召回可调：增大 `efSearch`
            无需重建索引即可抬高精度（代价是延迟）。
            
- 无需单独 train 阶段即可插入查询（相对 IVF 的 centroid
            训练）。
            
- 支持增量插入（长期插入后图质量是否下降另议，见
            frontier/08）。
            
            

**缺点**：
            
            
- 内存占用大。每个向量除原始数据外还要存邻接。粗算：\(M=32\)
            时每节点邻接指针量级为数十个整数；百万级 768-d float32
            的原始矩阵约 2.87
            GB，图结构再叠加一截——**精确额外开销随实现变化，须对本索引统计**。
            
- 构建偏慢：每点插入含一层搜索，大规模构建耗时随 \(N\) 与
            `efConstruction` 上升——勿写死「分钟级」。
            
- 原生删除困难；生产实现多用标记删除 + 重建/修复。
            
- 图遍历难像 dense GEMM 那样吃满 GPU；GPU ANN 另见 CAGRA
            等（frontier / 开放问题）。
            
            

综合权衡与 DiskANN 磁盘假设对比见 db-frontier/08；本文不给未复跑的「百万级亚毫秒」结论。
            
            

## 五、量化

            

### 5.1 标量量化

            

量化（Quantization）的目标是用更少的字节表示每个向量，从而降低存储开销和距离计算开销。最简单的量化方式是标量量化（Scalar
            Quantization, SQ）：把每个维度的 float32 值压缩为 int8 或
            int4。
            
```
# 标量量化示意
import numpy as np

def scalar_quantize_int8(vectors):
    """将 float32 向量压缩为 int8"""
    vmin = vectors.min(axis=0)
    vmax = vectors.max(axis=0)
    scale = (vmax - vmin) / 255.0
    quantized = ((vectors - vmin) / scale).clip(0, 255).astype(np.uint8)
    return quantized, vmin, scale

def scalar_dequantize(quantized, vmin, scale):
    """从 int8 恢复 float32"""
    return quantized.astype(np.float32) * scale + vmin
```

            

float32 到 int8 的量化把存储空间压缩到
            1/4，同时距离计算可以用整数运算加速。召回率损失通常在 1%-3%
            以内。
            

### 5.2 乘积量化

            

乘积量化（Product Quantization, PQ）是 Jegou 等人在 2011
            年提出的经典方法，也是 FAISS
            的核心算法之一。核心思想是把高维向量切分成多个低维子向量，对每个子空间独立做聚类量化。
            

具体步骤：
            
            
- 将 D 维向量切分成 \(m\)
            个子向量，每个子向量 \(D/m\) 维。
            
- 对每个子空间独立执行 K-Means 聚类，得到 \(k\)
            个聚类中心（Centroid）。通常 \(k =
            256\)，这样每个子向量用 1 字节（8 位）编码。
            
- 每个原始向量被编码为 \(m\) 个字节的编码——从 \(D \times 4\) 字节压缩到 \(m\) 字节。
            
            
```
# FAISS 乘积量化
import faiss
import numpy as np

dim = 768
n = 1_000_000
m = 48      # 子空间数量，每个子空间 768/48 = 16 维
nbits = 8   # 每个子空间用 8 位编码，即 256 个聚类中心

# 生成数据
xb = np.random.randn(n, dim).astype(np.float32)
xt = xb[:100_000]  # 训练集（用于学习聚类中心）

# 构建 PQ 索引
index = faiss.IndexPQ(dim, m, nbits)
index.train(xt)   # 学习聚类中心
index.add(xb)     # 编码并添加向量

# 查询
xq = np.random.randn(1, dim).astype(np.float32)
D, I = index.search(xq, 10)
```

            

PQ 的压缩比非常可观：768 维 float32 向量原始大小 3072
            字节，PQ-48 编码后只有 48 字节，压缩比 64
            倍。代价是召回率下降——PQ-48 在百万数据集上的 Recall@10 通常在
            0.50-0.70 之间。
            

距离计算使用查找表（Lookup
            Table）加速。查询时先为每个子空间预计算查询子向量到 256
            个聚类中心的距离，存入 \(m \times
            256\) 的查找表。然后对每个数据库向量，只需做 \(m\) 次查表和加法操作，而不是
            \(D\) 次乘法。
            

### 5.3 IVF：倒排文件索引

            

倒排文件索引（Inverted File Index,
            IVF）是一种粗量化（Coarse Quantization）方法。它先用 K-Means
            把向量空间划分成 \(nlist\)
            个 Voronoi
            单元格（Cell），每个单元格对应一个倒排列表（Inverted
            List），存放属于该单元格的所有向量。
            

查询时，先找到距离查询向量最近的 \(nprobe\)
            个单元格，然后只在这些单元格对应的倒排列表中搜索。
            
```
# FAISS IVF 索引
import faiss
import numpy as np

dim = 768
n = 1_000_000
nlist = 4096     # 聚类中心数量
nprobe = 64      # 查询时探测的单元格数量

xb = np.random.randn(n, dim).astype(np.float32)
xt = xb[:100_000]

# 构建 IVF + Flat 索引（倒排列表中存储原始向量）
quantizer = faiss.IndexFlatL2(dim)
index = faiss.IndexIVFFlat(quantizer, dim, nlist)
index.train(xt)
index.add(xb)

# 查询
index.nprobe = nprobe
xq = np.random.randn(1, dim).astype(np.float32)
D, I = index.search(xq, 10)
```

            

IVF 的搜索范围从全量 N 缩小到 \(N \times nprobe / nlist\)。当
            \(nlist = 4096\)、\(nprobe = 64\) 时，只需搜索约
            1.5% 的数据。
            

### 5.4 IVF-PQ：组合索引

            

IVF 和 PQ 可以组合使用：IVF 负责粗筛，PQ
            负责倒排列表中的精细搜索和压缩存储。这是 FAISS
            中最实用的索引组合。
            
```
# FAISS IVF-PQ 组合索引
import faiss
import numpy as np

dim = 768
n = 10_000_000  # 一千万条向量
nlist = 16384
m = 48          # PQ 子空间数

xb = np.random.randn(n, dim).astype(np.float32)
xt = xb[:500_000]

quantizer = faiss.IndexFlatL2(dim)
index = faiss.IndexIVFPQ(quantizer, dim, nlist, m, 8)
index.train(xt)
index.add(xb)

# 查询
index.nprobe = 128
xq = np.random.randn(1, dim).astype(np.float32)
D, I = index.search(xq, 10)
```

            

IVF-PQ
            的工程权衡（机制层，**非本机实测表**）：
            
            
            
            
            
            
            
            
            
            配置思路
            内存
            延迟倾向
            召回倾向
            
            
            
            
            Flat
            全精度全量
            最高
            精确
            
            
            IVF + Flat 列表
            全精度，但只探 \(nprobe\) 个列表
            低于 Flat
            高（依赖 \(nprobe\)）
            
            
            IVF + PQ
            列表内向量压缩
            更低
            常掉点
            
            
            IVF-PQ 粗排 + 原向量 Refine
            压缩索引 + 精排所需原向量/缓存
            介于中间
            常可拉回
            
            
            
            

Refine（先近似取较大候选，再原向量精排）是常见两阶段套路。具体
            GB/ms/Recall 必须在声明的 \(N,d\)、CPU 与 FAISS
            版本上自测；旧版未标注硬件的数字表已撤下。
            

### 5.5 OPQ 与残差量化

            

正交乘积量化（Optimized Product Quantization,
            OPQ）通过一个正交变换矩阵对向量做预处理，使得各子空间的量化误差更均匀，从而提高
            PQ 的精度。在 FAISS 中用 `OPQMatrix` 实现：
            
```
# OPQ 预处理 + IVF-PQ
import faiss

dim = 768
m = 48
nlist = 4096

# OPQ 变换矩阵
opq = faiss.OPQMatrix(dim, m)

# 组合索引
index = faiss.index_factory(dim, "OPQ48_768,IVF4096,PQ48")
```

            

残差量化（Residual Quantization, RQ）是 PQ 的推广。PQ
            只做一层量化，RQ
            做多层级联：第一层量化原始向量，第二层量化第一层的残差，第三层量化第二层的残差。每一层都进一步减小量化误差。FAISS
            2.0 引入了
            `ResidualQuantizer`，在相同压缩比下召回率比 PQ 高
            5-10 个百分点。
            

### 5.6 ScaNN

            

ScaNN（Scalable Nearest Neighbors）是 Google 在 2020
            年提出的量化方法。它的核心创新是各向异性向量量化（Anisotropic
            Vector
            Quantization）：在量化时不是最小化重建误差，而是最小化内积估计误差。具体来说，ScaNN
            允许量化向量在”平行于查询方向”的分量上放大，从而在内积度量下获得更好的排序精度。
            

在 ann-benchmarks 的公开评测中，ScaNN 在 Recall-QPS
            权衡曲线上长期处于前列，尤其在高召回率（>0.95）区间优势明显。
            
            

## 六、向量数据库架构

            

### 6.1 为什么需要向量数据库

            

FAISS
            是一个索引库（Library），不是数据库。它缺少以下能力：
            
            
- **持久化**。FAISS
            索引默认在内存中，进程重启后丢失。虽然可以用
            `faiss.write_index`
            写入磁盘，但不支持事务和崩溃恢复。
            
- **分布式**。单机内存有限，一亿条 768 维
            float32 向量需要 287 GB，单机放不下。
            
- **元数据过滤**。实际检索往往需要同时满足向量相似度和标量条件，例如”找出与查询最相似的、且
            category=‘技术’ 且 date > 2024-01-01 的文档”。
            
- **CRUD**。生产系统需要支持增量插入、删除、更新，以及实时可见性。
            
- **多租户**。SaaS 场景需要数据隔离。
            
            

向量数据库（Vector
            Database）在索引库之上提供了完整的数据库能力。
            

### 6.2 Milvus 架构

            

Milvus 是目前社区最活跃的开源向量数据库之一，由 Zilliz
            公司开发。它采用存算分离（Disaggregated Storage and
            Compute）架构：
            
```
Milvus 2.x 架构：

  SDK / gRPC
      |
  [Access Layer]
      |   负载均衡、请求路由
      |
  [Coordinator Service]
      |   Root Coord: 元数据管理、DDL
      |   Query Coord: 查询节点调度
      |   Data Coord: 数据节点调度
      |   Index Coord: 索引构建调度
      |
  [Worker Nodes]
      |   Query Node: 加载索引到内存，执行搜索
      |   Data Node: 接收写入，生成 segment
      |   Index Node: 异步构建索引
      |
  [Storage Layer]
      |   日志存储: Pulsar / Kafka（WAL）
      |   对象存储: MinIO / S3（segment 文件）
      |   元数据存储: etcd
```

            

核心设计决策：
            
            
- **日志即数据（Log as
            Data）**。所有写入先写入消息队列（Pulsar 或
            Kafka），再由 Data Node
            消费并写入对象存储。这保证了写入的持久性和一致性。
            
- **Segment 化存储**。数据按 segment
            组织，每个 segment 是一个独立的数据块（类似 LSM-Tree 的
            SSTable）。Growing segment 接收写入，sealed segment
            触发索引构建。
            
- **索引与数据分离**。Index Node
            异步构建索引，构建完成后通知 Query Node
            加载。写入不阻塞查询。
            
- **读写分离**。Data Node 处理写入，Query
            Node 处理查询，各自独立扩缩容。
            
            
```
# Milvus Python SDK 基本操作
from pymilvus import (
    connections, Collection, FieldSchema,
    CollectionSchema, DataType, utility
)

# 连接
connections.connect("default", host="localhost", port="19530")

# 定义 Schema
fields = [
    FieldSchema(name="id", dtype=DataType.INT64,
                is_primary=True, auto_id=True),
    FieldSchema(name="title", dtype=DataType.VARCHAR,
                max_length=512),
    FieldSchema(name="category", dtype=DataType.VARCHAR,
                max_length=64),
    FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR,
                dim=768),
]
schema = CollectionSchema(fields, description="document embeddings")
collection = Collection("documents", schema)

# 创建索引
index_params = {
    "index_type": "IVF_FLAT",
    "metric_type": "IP",
    "params": {"nlist": 4096},
}
collection.create_index("embedding", index_params)

# 插入数据
import numpy as np
data = [
    ["文章标题1", "文章标题2"],           # title
    ["技术", "产品"],                     # category
    np.random.randn(2, 768).tolist(),     # embedding
]
collection.insert(data)

# 带过滤的向量搜索
collection.load()
results = collection.search(
    data=[np.random.randn(768).tolist()],
    anns_field="embedding",
    param={"metric_type": "IP", "params": {"nprobe": 128}},
    limit=10,
    expr='category == "技术"',  # 标量过滤
    output_fields=["title", "category"],
)
```

            

### 6.3 Qdrant 架构

            

Qdrant 是用 Rust
            编写的向量数据库，设计目标是单机高性能和易部署。
            

核心特点：
            
            
- **HNSW + 量化**。默认索引类型是
            HNSW，支持标量量化和乘积量化以降低内存占用。
            
- **Payload
            过滤**。支持丰富的标量过滤条件，过滤和向量搜索在同一个查询中执行。Qdrant
            的过滤策略是先根据过滤条件估算满足条件的向量数量，再决定是”先过滤后搜索”还是”搜索时过滤”。
            
- **WAL + Segment**。写入先写 WAL，再写入
            segment。Segment 分为可写的 mutable segment 和只读的
            immutable segment，后者触发索引构建。
            
- **分布式方案**。通过 Raft
            共识协议实现分片（Shard）间的数据复制，支持水平扩展。
            
            
```
# Qdrant REST API 创建集合
curl -X PUT 'http://localhost:6333/collections/documents' \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    },
    "optimizers_config": {
      "indexing_threshold": 20000
    },
    "quantization_config": {
      "scalar": {
        "type": "int8",
        "always_ram": true
      }
    }
  }'
```

            

### 6.4 Weaviate 架构

            

Weaviate 使用 Go 编写，特色是内置向量化（Vectorizer
            Module）——可以直接传入原始文本，Weaviate
            内部调用嵌入模型生成向量。索引层面同样使用
            HNSW，存储层使用自研的 LSM-based 存储引擎。
            

Weaviate
            的模块化设计支持多种向量化后端（OpenAI、Cohere、Hugging
            Face），适合快速搭建原型。但在生产场景中，向量化和检索解耦是更好的实践——把向量化放在应用层，避免向量数据库成为瓶颈。
            

### 6.5 Pinecone 架构

            

Pinecone 是托管式（Fully
            Managed）向量数据库，不开源。用户无需关心索引类型选择、参数调优、集群运维，只需通过
            API 写入和查询。
            

Pinecone 的核心卖点是低运维成本和开箱即用的性能。2023
            年推出的 Serverless
            架构进一步降低了使用门槛——按查询次数计费，不按集群资源计费。
            

但 Pinecone
            的局限也很明显：无法自定义索引参数，无法控制数据存储位置，成本在大规模场景下显著高于自建方案。
            

### 6.6 向量数据库选型

            
            
            
            维度
            Milvus
            Qdrant
            Weaviate
            Pinecone
            
            
            
            
            语言
            Go + C++
            Rust
            Go
            未知（闭源）
            
            
            开源
            是（Apache 2.0）
            是（Apache 2.0）
            是（BSD-3）
            否
            
            
            默认索引
            IVF/HNSW/DiskANN
            HNSW
            HNSW
            未知
            
            
            分布式
            原生支持
            Raft
            Raft
            托管
            
            
            最大数据量
            亿级
            千万级（单机）
            千万级
            未公开
            
            
            标量过滤
            支持
            支持
            支持（GraphQL）
            支持
            
            
            GPU 索引
            支持（CAGRA）
            不支持
            不支持
            未知
            
            
            适用场景
            大规模生产
            中小规模、易部署
            快速原型
            免运维
            
            
            
            

我认为在生产环境中，如果数据量超过 5000
            万条且需要水平扩展，Milvus
            是当前最成熟的选择。如果数据量在千万以下且团队规模小，Qdrant
            的单机性能和部署简便性更有吸引力。Pinecone
            适合团队没有基础设施运维能力、且预算充足的场景。Weaviate
            适合需要快速验证想法的原型阶段。
            
            

## 七、FAISS 索引类型选择

            

### 7.1 FAISS 索引体系

            

FAISS（Facebook AI Similarity Search）是 Meta
            开源的向量相似度搜索库。它提供了丰富的索引类型，可以通过
            `index_factory` 字符串灵活组合。
            
```
# index_factory 字符串语法
import faiss

dim = 768

# 暴力搜索
index = faiss.index_factory(dim, "Flat")

# IVF + Flat
index = faiss.index_factory(dim, "IVF4096,Flat")

# IVF + PQ
index = faiss.index_factory(dim, "IVF4096,PQ48")

# OPQ 预处理 + IVF + PQ
index = faiss.index_factory(dim, "OPQ48_768,IVF4096,PQ48")

# HNSW
index = faiss.index_factory(dim, "HNSW32")

# IVF + HNSW 粗量化器 + PQ
index = faiss.index_factory(dim, "IVF4096_HNSW32,PQ48")

# 标量量化
index = faiss.index_factory(dim, "IVF4096,SQ8")
```

            

`index_factory`
            字符串由三部分组成：预处理（可选）+ 倒排索引（可选）+
            编码方式。
            

### 7.2 各索引类型对比

            
            
            
            索引类型
            训练
            内存
            构建速度
            查询速度
            Recall
            增量插入
            
            
            
            
            Flat
            否
            高
            快
            慢（线性）
            1.0
            支持
            
            
            IVF,Flat
            是
            高
            中
            中
            高
            支持
            
            
            IVF,PQ
            是
            低
            中
            快
            中
            支持
            
            
            IVF,SQ8
            是
            中
            中
            中快
            高
            支持
            
            
            HNSW
            否
            高
            慢
            快
            高
            支持
            
            
            IVF_HNSW,PQ
            是
            低
            慢
            快
            中高
            支持
            
            
            
            

### 7.3 选型决策树

            

根据数据量和约束条件选择索引类型：
            
```
数据量  用 Flat（暴力搜索足够快）
  |-- 否 -->
      |
      内存是否充足（能放下全量原始向量）？
        |-- 是 -->
        |    |
        |    需要增量插入？
        |      |-- 是 --> HNSW32（M=32，无需训练）
        |      |-- 否 --> IVF4096,Flat（训练后批量导入）
        |
        |-- 否 -->
             |
             Recall@10 要求 >= 0.9？
               |-- 是 --> IVF4096,SQ8（4 倍压缩，召回损失小）
               |-- 否 --> IVF4096,PQ48（64 倍压缩，召回损失大）
               |
             需要进一步提升精度？
               --> OPQ 预处理 或 Refine 两阶段检索
```

            

### 7.4 GPU 索引

            

FAISS 支持将部分索引类型放到 GPU 上执行，利用 GPU
            的并行计算能力加速暴力搜索和 IVF 搜索。
            
```
# GPU 索引
import faiss

dim = 768
n = 10_000_000

# CPU 索引
cpu_index = faiss.index_factory(dim, "IVF4096,PQ48")

# 迁移到 GPU
gpu_res = faiss.StandardGpuResources()
gpu_index = faiss.index_cpu_to_gpu(gpu_res, 0, cpu_index)

# 多 GPU
gpu_index = faiss.index_cpu_to_all_gpus(cpu_index)
```

            

GPU 索引在批量查询（Batch Query）场景下优势明显——单卡
            A100 上，IVF4096,PQ48 对 10000 条查询的吞吐量可达 CPU 的
            10-50 倍。但 GPU 内存有限（80
            GB），大规模数据仍需要分片。
            

NVIDIA 在 2023 年推出的 CAGRA（CUDA Accelerated
            Graph-based Approximate nearest neighbor）索引是专为 GPU
            设计的图索引，在 GPU 上的性能显著优于 HNSW 的 GPU
            移植版本。Milvus 2.3 已经集成了 CAGRA。
            

### 7.5 磁盘索引

            

当数据量太大无法全部放入内存时，需要磁盘索引（On-Disk
            Index）。FAISS 提供了 `OnDiskInvertedLists`，把
            IVF
            索引的倒排列表存储在磁盘上，只在内存中保留粗量化器和查找表。
            
```
# 磁盘索引
import faiss

dim = 768
nlist = 65536

# 构建并训练索引
quantizer = faiss.IndexFlatL2(dim)
index = faiss.IndexIVFPQ(quantizer, dim, nlist, 48, 8)
# ...训练和添加数据...

# 将倒排列表写入磁盘
faiss.write_index(index, "index_ivfpq.faiss")

# 使用内存映射加载
index = faiss.read_index("index_ivfpq.faiss",
                         faiss.IO_FLAG_MMAP)
```

            

DiskANN（Subramanya et al., NeurIPS 2019）把类 HNSW
            的图与量化向量放在 SSD 上，用有限随机 I/O
            换内存。论文与后续系统报告中的延迟/召回依赖数据集、SSD
            与参数；**本文不转写未标注硬件的固定毫秒口号**。原理见
            db-frontier/08；Milvus
            侧插件位置见 vector-engine/08。
            
            

## 八、HNSW 参数调优

            

### 8.1 三个核心参数

            

HNSW 有三个核心参数，它们的含义和影响如下：
            

**M（每层最大邻居数）**
            
            
- 第 0 层每个节点最多 \(2M\) 条边，其他层最多 \(M\) 条边。
            
- M
            越大，图的连通性越好，召回率越高，但内存占用和构建时间也越大。
            
- 典型取值：16-64。
            
            

**efConstruction（构建时搜索宽度）**
            
            
- 插入新节点时，搜索候选邻居的 beam width。
            
- efConstruction
            越大，找到的邻居质量越高，索引质量越好，但构建时间越长。
            
- 必须 >= M。
            
- 典型取值：100-400。
            
            

**efSearch（查询时搜索宽度）**
            
            
- 查询时的 beam width，控制搜索精度与速度的权衡。
            
- efSearch 越大，召回率越高，延迟越大。
            
- 可以在查询时动态调整，无需重建索引。
            
- 典型取值：32-256。
            
            

### 8.2
            参数如何影响权衡（无固定数字表）

            

增大 \(M\) /
            `efConstruction` 通常抬高建图质量与内存；增大
            `efSearch`
            在**查询期**用更多距离计算换召回。三者没有跨硬件的普适「黄金毫秒表」。
            

机制层观察（与具体 ms/GB 无关）：
            
            
- **efSearch
            是运行时第一抓手**：无需重建即可调；先固定 \(M\) 与
            `efConstruction`，再扫 efSearch 做
            Recall–延迟曲线。
            
- **\(M\)
            的边际收益递减**：过大则内存与构建代价涨得更快。
            
- **`efConstruction`
            定索引质量上限**：构建过糙时，事后把 efSearch
            开很大也难补。
            
            

旧版「百万 768-d 参数组合」的 ms/min/GB
            表已撤下（无本机台账）。需要数字时用 ann-benchmarks 或 vector-engine
            reproduce 自建。
            

### 8.3 调优策略

            
```
第一步：确定本业务的内存与延迟约束（不抄他人表）
第二步：选择 M（内存紧 → 偏小；充足 → 试 32 量级）
第三步：efConstruction >= max(2*M, 实现文档建议下限)
第四步：用真实数据构建索引
第五步：遍历 efSearch，画 Recall-Latency 曲线并记录硬件/线程
第六步：仍无法同时满足 → 增大 M/efConstruction 重建，或 HNSW+量化
```

            

其余与 DiskANN/IVF 对照见 db-frontier/08。
            

### 8.4 HNSW 与量化结合

            

在内存受限的场景下，HNSW
            可以与标量量化或乘积量化结合使用：
            
```
# HNSW + SQ8（标量量化到 int8）
import faiss

dim = 768
M = 32

# SQ8 将 float32 压缩为 int8，内存减少 75%
index = faiss.IndexHNSWSQ(dim, faiss.ScalarQuantizer.QT_8bit, M)
index.hnsw.efConstruction = 200

# 添加数据（自动量化）
xb = np.random.randn(1_000_000, dim).astype(np.float32)
index.train(xb)
index.add(xb)

# 查询
index.hnsw.efSearch = 64
D, I = index.search(xq, 10)
```

            

HNSW + SQ8 把每个向量从 3072 字节压缩到 768
            字节，同时图结构保持不变。Recall 损失通常在 1-2
            个百分点以内，是工程中很好的内存-精度折中方案。
            
            

## 九、向量数据库基准测试

            

### 9.1 基准测试的陷阱

            

向量数据库的基准测试充满了误导性的数字。常见的陷阱包括：
            
            
- **只看 QPS 不看 Recall**。高 QPS
            可以通过降低 efSearch 或 nprobe 轻松实现，但代价是 Recall
            大幅下降。正确的做法是在固定 Recall 下比较 QPS。
            
- **只测离线批量查询**。把 10000
            条查询批量提交给 GPU 索引，QPS
            看起来很高。但在线服务是单条查询、要求低延迟，这两种场景的性能差异可达
            10 倍以上。
            
- **不测过滤场景**。纯向量搜索的性能数据对生产系统参考价值有限。加上
            `category = '技术' AND date > '2024-01-01'`
            这样的标量过滤后，性能可能下降 50% 以上。
            
- **训练数据和查询数据分布相同**。用训练集的子集做查询，Recall
            会虚高。应该用分布外（Out-of-Distribution）的查询向量测试。
            
- **不考虑索引构建时间和资源消耗**。有些索引在查询端表现优秀，但构建需要几小时的
            GPU 计算，这在需要频繁更新数据的场景中是不可接受的。
            
            

### 9.2 ann-benchmarks

            

ann-benchmarks 是最广泛使用的 ANN
            算法基准测试框架。它使用标准数据集，在固定的 Recall
            水平下比较各算法的 QPS。
            

标准数据集：
            
            
            
            数据集
            维度
            数据量
            度量
            来源
            
            
            
            
            SIFT-1M
            128
            100万
            L2
            SIFT 特征描述符
            
            
            GloVe-200
            200
            119万
            角距离
            GloVe 词向量
            
            
            MNIST
            784
            6万
            L2
            手写数字图像
            
            
            NYTimes-256
            256
            29万
            角距离
            新闻文章嵌入
            
            
            Deep-1B
            96
            10亿
            L2
            深度学习特征
            
            
            
            

在固定 Recall 下比较算法库 QPS，应使用 ANN-Benchmarks
            一类工具在**声明的数据集与硬件**上自跑或引用其公开曲线。下表**删除**了旧版未标注硬件的「典型
            QPS」数字——那些数字不能支撑本站结论。
            

需要对照时：打开 ann-benchmarks
            对应数据集的公开结果页，记录 Recall@\(k\)、单线程/多线程、CPU
            型号后再写进你自己的实验台账；或在本机用 vector-engine
            reproduce 的 hnswlib
            微基准做**相对**比较（口径见该目录脚本注释）。
            

### 9.3 VectorDBBench

            

VectorDBBench（由 Zilliz
            开发）是面向向量数据库系统（而非单纯算法库）的基准测试框架。它测试完整的数据库操作链路：建表、写入、构建索引、查询，并支持带过滤的查询场景。
            
```
# 运行 VectorDBBench
pip install vectordb-bench
python -m vectordb_bench \
  --db milvus \
  --dataset cohere-1m \
  --case search_performance
```

            

VectorDBBench 的测试结果与 ann-benchmarks
            有显著差异，因为它包含了网络延迟、序列化开销、过滤执行等数据库层面的开销。
            

### 9.4 构建自己的基准测试

            

生产环境中，通用基准测试的参考价值有限。建议构建贴合实际场景的基准测试：
            
```
# 自定义基准测试框架示例
import time
import numpy as np
from dataclasses import dataclass

@dataclass
class BenchResult:
    recall_at_10: float
    p50_latency_ms: float
    p99_latency_ms: float
    qps: float
    index_build_time_s: float
    memory_usage_mb: float

def benchmark_index(index, xb, xq, gt, k=10):
    """
    index: FAISS index
    xb: 数据库向量
    xq: 查询向量
    gt: ground truth（暴力搜索结果）
    """
    # 构建索引
    t0 = time.time()
    if hasattr(index, 'train'):
        index.train(xb)
    index.add(xb)
    build_time = time.time() - t0

    # 查询延迟
    latencies = []
    all_results = []
    for i in range(len(xq)):
        t0 = time.time()
        D, I = index.search(xq[i:i+1], k)
        latencies.append((time.time() - t0) * 1000)
        all_results.append(I[0])

    # 计算 Recall@K
    recalls = []
    for i in range(len(xq)):
        hit = len(set(all_results[i]) & set(gt[i][:k]))
        recalls.append(hit / k)

    latencies.sort()
    return BenchResult(
        recall_at_10=np.mean(recalls),
        p50_latency_ms=latencies[len(latencies)//2],
        p99_latency_ms=latencies[int(len(latencies)*0.99)],
        qps=len(xq) / sum(l/1000 for l in latencies),
        index_build_time_s=build_time,
        memory_usage_mb=index.sa_code_size() * len(xb) / 1e6
            if hasattr(index, 'sa_code_size') else -1,
    )
```

            

关键是：
            
            
- 使用真实的查询分布，而非从训练集随机采样。
            
- 测量 p99 延迟而非平均延迟——在线服务看的是长尾。
            
- 包含带过滤的查询场景。
            
- 考虑并发查询下的性能表现。
            
            
            

## 十、向量存储在 RAG
            中的应用

            

### 10.1 RAG 管线中的向量检索

            

检索增强生成（Retrieval-Augmented Generation,
            RAG）是当前大语言模型（Large Language Model,
            LLM）应用中最重要的架构模式。向量存储在 RAG
            管线中承担”检索”环节的核心角色。
            
```
RAG 管线：

  用户提问
      |
  [嵌入模型] --> 查询向量（768 维）
      |
  [向量检索] --> Top-K 相关文档片段
      |
  [重排序（可选）] --> 重新排序候选文档
      |
  [上下文拼接] --> system prompt + 检索结果 + 用户问题
      |
  [LLM 生成] --> 最终回答
```

            

向量检索的质量直接决定了 RAG
            系统的最终效果。如果检索阶段漏掉了关键文档，后续的 LLM
            再强也无法生成正确答案——这是”垃圾进，垃圾出”（Garbage In,
            Garbage Out）原则在 RAG 中的体现。
            

### 10.2 文档分块策略

            

在向量检索之前，需要把原始文档切分成适合嵌入的块（Chunk）。分块策略对检索质量影响很大：
            

**固定长度分块**：按 token 数量切分，通常
            256-512 token 一个块，相邻块之间有 50-100 token
            的重叠（Overlap）。
            
```
# 固定长度分块
def fixed_length_chunking(text, chunk_size=512, overlap=100):
    tokens = tokenizer.encode(text)
    chunks = []
    start = 0
    while start 
            

**语义分块**：在句子边界或段落边界切分，保持语义完整性。可以使用滑动窗口
            + 相邻句子嵌入相似度来检测语义断点。
            

**递归分块**：先按段落分，如果段落太长再按句子分，如果句子还是太长再按固定长度分。LangChain
            的 `RecursiveCharacterTextSplitter`
            实现了这种策略。
            

分块大小的选择是一个权衡：
            
            
- 块太大（>1000
            token）：嵌入向量的语义被稀释，检索精度下降，且占用更多 LLM
            上下文窗口。
            
- 块太小（<100
            token）：缺乏上下文信息，嵌入向量的语义表达不完整。
            
- 经验值：256-512 token 是多数场景下的合理起点。
            
            

### 10.3 混合检索

            

纯向量检索有一个明显的弱点：对精确关键词匹配（特别是专有名词、型号、编号）不够敏感。例如，搜索”CVE-2024-1234”，向量检索可能返回语义相关但不包含这个
            CVE 编号的文档。
            

混合检索（Hybrid Search）结合向量检索和关键词检索（通常是
            BM25）来弥补这个缺陷：
            
```
# 混合检索伪代码
def hybrid_search(query, vector_store, bm25_index, k=10, alpha=0.7):
    """
    alpha: 向量分数的权重，1-alpha 是 BM25 分数的权重
    """
    # 向量检索
    query_embedding = embed_model.encode(query)
    vector_results = vector_store.search(query_embedding, k=k*2)

    # BM25 关键词检索
    bm25_results = bm25_index.search(query, k=k*2)

    # 分数归一化（Min-Max）
    v_scores = normalize(vector_results.scores)
    b_scores = normalize(bm25_results.scores)

    # 融合分数
    all_docs = {}
    for doc_id, score in zip(vector_results.ids, v_scores):
        all_docs[doc_id] = alpha * score
    for doc_id, score in zip(bm25_results.ids, b_scores):
        all_docs[doc_id] = all_docs.get(doc_id, 0) + (1 - alpha) * score

    # 按融合分数排序，返回 Top-K
    sorted_docs = sorted(all_docs.items(), key=lambda x: -x[1])
    return sorted_docs[:k]
```

            

Milvus、Qdrant 和 Weaviate
            都原生支持混合检索。在实际评测中，混合检索的 Recall
            通常比纯向量检索高 5-15
            个百分点，尤其在包含专有名词的查询上优势明显。
            

### 10.4 重排序

            

初始检索（向量检索或混合检索）通常返回 Top-50 到 Top-100
            的候选文档，然后用交叉编码器（Cross-Encoder）重排序到 Top-5
            或 Top-10。
            
```
# 使用 Cross-Encoder 重排序
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("BAAI/bge-reranker-v2-m3")

def rerank(query, candidates, top_k=5):
    """
    candidates: [(doc_id, doc_text), ...]
    """
    pairs = [(query, doc_text) for _, doc_text in candidates]
    scores = reranker.predict(pairs)

    ranked = sorted(
        zip(candidates, scores),
        key=lambda x: -x[1]
    )
    return [(doc_id, text, score)
            for (doc_id, text), score in ranked[:top_k]]
```

            

交叉编码器和双塔嵌入模型的区别：双塔独立编码后做内积/余弦，适合大规模召回；交叉编码器拼接查询与文档再过
            Transformer，交互更细但成本随候选数近似线性增长——故只宜对小候选集重排。具体毫秒数依赖模型与硬件，本文不写死。
            

### 10.5 向量检索的工程实践

            

在生产 RAG 系统中，向量检索环节的工程实践：
            

**1. 嵌入模型的选择**
            

选择嵌入模型时，MTEB（Massive Text Embedding
            Benchmark）排行榜是重要参考。但排行榜上的分数是在通用数据集上测的，和具体业务场景的相关性有限。建议在自己的数据集上做
            A/B 测试。
            

**2. 索引类型的选择**
            
```
文档数量  Flat（暴力搜索）
文档数量 10 万 - 500 万  --> HNSW（M=32，efSearch=64）
文档数量 500 万 - 5000 万 --> IVF4096,SQ8 或 HNSW + SQ8
文档数量 > 5000 万       --> 分布式向量数据库 + IVF-PQ/DiskANN
```

            

**3. 向量维度的取舍**
            

更高的维度不一定带来更好的检索效果。在 768 维和 1536
            维之间，Recall 的差异通常在 1-2
            个百分点，但存储和计算成本翻倍。如果模型支持 Matryoshka
            表示学习（如 OpenAI
            text-embedding-3），可以在部署时将向量截断到更低维度，以换取速度和存储的优势。
            

**4. 数据更新策略**
            

RAG 系统通常需要持续接入新文档。对于 HNSW
            索引，增量插入无需重建，但长期插入后图的质量会退化。建议定期（如每周）对索引做全量重建。对于
            IVF
            系列索引，新数据可以追加到现有倒排列表中，但如果数据分布发生显著变化，需要重新训练聚类中心。
            

**5. 多向量检索**
            

对于长文档，可以为每个文档生成多个向量（按分块），查询时返回匹配的分块，再通过
            doc_id 回溯到原始文档。这种方案需要向量数据库支持按 doc_id
            去重——Milvus 的 `group_by`
            功能可以实现这一点。
            

### 10.6 端到端性能优化

            

一个 RAG 查询的端到端延迟通常由「嵌入 + 检索
            +（可选）重排 +
            生成」相加；**各段毫秒数随模型、批大小、GPU/CPU、候选集规模变化**。本站不在此给出固定「典型延迟」表。可核对的分工：
            
            
- 向量引擎侧延迟与召回：见 vector-engine
            与本机 reproduce 脚本口径
            
- 重排与生成：见 llm-infra
            RAG
            
            

优化直觉（机制层，非 benchmark）：
            
            
- **先保证检索
            Recall，再缩重排候选集**——重排成本随候选数近似线性。
            
- **重复查询可缓存查询向量**，省嵌入。
            
- **索引预热**避免冷 page cache / 冷
            GPU。
            
- 端到端瓶颈常在生成侧，不在「再抠 1 ms 检索」——须用本业务
            trace 验证。
            
            

### 10.7 向量存储的未来方向

            

几个值得关注的技术趋势：
            
            
- 

**稀疏-稠密混合表示**。SPLADE
            等模型同时输出稠密向量和稀疏向量，在单一模型中融合了语义检索和关键词检索的优势。向量数据库需要支持多向量类型的联合索引。
            
- 

**向量压缩与量化的持续演进**。从 PQ 到
            RQ 到
            ScaNN，量化方法在不断提升压缩比和精度的权衡。RaBitQ（2024）等新方法将二值量化的内存效率和高精度结合起来，有望进一步降低向量存储的成本。
            
- 

**GPU 原生索引**。CAGRA、GGNN 等专为 GPU
            设计的图索引，利用 GPU
            的高带宽和并行能力，在批量查询场景下性能远超 CPU 索引。随着
            GPU 内存容量增长，GPU
            原生向量数据库可能成为高性能场景的主流选择。
            
- 

**与关系数据库的融合**。pgvector、SQLite-vec
            等把向量索引嵌进传统库。甜区与页模型代价见 pgvector
            内核对照；选型决策树见 vector-engine/18。
            
- 

**流式向量索引**。批量建索之外的持续可搜，见
            Milvus Growing/Sealed（vector-engine/03、05），不在本文展开。
            
            
            

## 参考资料

            

### 规范 / 源码 / 工具

            
            
- FAISS Wiki（metric types、`IndexFlatL2` /
            `IndexFlatIP`）。https://github.com/facebookresearch/faiss/wiki
            
- 本文度量图示脚本：`post/storage/39-vector-storage/gen_metric_figures.py`（matplotlib
            导出 SVG，坐标与排序可复现）。
            
            

### 论文 / 书

            
            
- Jegou, H., Douze, M., & Schmid, C. (2011). “Product
            Quantization for Nearest Neighbor Search.” *IEEE
            Transactions on Pattern Analysis and Machine
            Intelligence*, 33(1), 117–128.
            
- Malkov, Y. A. & Yashunin, D. A. (2020). “Efficient
            and Robust Approximate Nearest Neighbor Search Using
            Hierarchical Navigable Small World Graphs.” *IEEE
            Transactions on Pattern Analysis and Machine
            Intelligence*, 42(4), 824–836.
            
- Guo, R., Sun, P., Lindgren, E., Geng, Q., Simcha, D.,
            Chern, F., & Kumar, S. (2020). “Accelerating Large-Scale
            Inference with Anisotropic Vector Quantization.”
            *Proceedings of ICML*.
            
- Subramanya, S. J., Devvrit, Kadekodi, R., Krishaswamy,
            R., & Simhadri, H. V. (2019). “DiskANN: Fast Accurate
            Billion-point Nearest Neighbor Search on a Single Node.”
            *Proceedings of NeurIPS*.
            
- Johnson, J., Douze, M., & Jegou, H. (2021).
            “Billion-Scale Similarity Search with GPUs.” *IEEE
            Transactions on Big Data*, 7(3), 535–547.
            
- Wang, J., Yi, X., Guo, R., Jin, H., Xu, P., Li, S., …
            & Xu, T. (2021). “Milvus: A Purpose-Built Vector Data
            Management System.” *Proceedings of ACM SIGMOD*.
            
- Aumuller, M., Bernhardsson, E., & Faithfull, A.
            (2020). “ANN-Benchmarks: A Benchmarking Tool for Approximate
            Nearest Neighbor Algorithms.” *Information Systems*,
            87, 101374.
            
            

### 站内

            
            
- 向量与点积的几何直觉
            · 向量检索引擎系列
            · db-frontier/08
            · pgvector
            内核对照
            
            
            

**上一篇**: 时序存储引擎
            **下一篇**: 数据湖表格式
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-09-25 · storage
                    

### 【存储工程】S3 API 深度解析

                    

全面剖析 S3 API 的工程细节——Multipart Upload、S3 Select、生命周期策略、跨区域复制、性能优化与 boto3 高级用法
                

                
                    

2025-09-26 · storage
                    

### 【存储工程】MinIO 原理和架构

                    

MinIO 原理和架构：Erasure Set、Server Pool、元数据与数据共置、修复与 IAM，以及 S3 兼容集群的部署运维要点。
                

                
                    

2025-09-27 · storage
                    

### 【存储工程】纠删码原理与存储效率

                    

深入剖析纠删码的数学原理与工程实践——Reed-Solomon 编码、编码矩阵与恢复过程、参数选择、降级读性能、局部修复码，以及在 MinIO/Ceph 中的配置实战
                

                
                    

2026-06-11 · storage
                    

### 【存储工程】小文件问题：为什么文件数量比文件大小更致命

                    

系统分析小文件在块分配、元数据管理、磁盘寻道和网络协议四个层面的放大效应，用数据量化 slack space、inode 开销和 syscall 成本，给出应用层聚合与对象存储归档两种工程方案。