# 【存储工程】块存储加密：LUKS 与 dm-crypt

来源: https://quant67.com/post/storage/22-block-encryption/block-encryption.html
日期: 2025-08-31 |

---

在存储系统的安全防线中，加密是最后一道也是最重要的一道屏障。当物理安全措施失效——磁盘被盗、服务器被非法访问、退役硬盘未彻底销毁——只有加密能确保数据不被未授权方读取。块级加密（Block-Level
            Encryption）在存储栈的最低层工作，对上层文件系统和应用程序完全透明，不需要修改任何一行应用代码就能保护磁盘上的每一个字节。
            

Linux 生态中，dm-crypt 与 LUKS
            的组合已经成为块级加密的事实标准。dm-crypt
            提供内核态的透明加密引擎，LUKS
            在其上定义了标准化的磁盘格式和密钥管理接口。这套方案在过去十五年间经历了大量生产环境的考验，从笔记本全盘加密到数据中心合规需求，覆盖了绝大多数使用场景。
            

本文将从块级加密的威胁模型出发，深入剖析 dm-crypt
            的内核架构、LUKS
            头部格式、密钥派生函数、加密算法选择，然后落地到 cryptsetup
            操作实战、性能影响分析、自加密盘方案、密钥管理进阶以及与
            LVM/RAID
            的集成方案。目标是让读者既能理解底层原理，又能在生产环境中做出正确的加密方案决策。
            
            

## 一、块级加密的必要性

            

### 1.1
            静态数据加密的威胁模型

            

静态数据加密（Data at Rest
            Encryption）针对的是数据在存储介质上”静止”时面临的威胁。与传输加密（Data
            in Transit Encryption）和使用中加密（Data in Use
            Encryption）不同，静态数据加密保护的是磁盘上的物理比特。
            

威胁模型（Threat Model）可以归纳为以下几类：
            

**物理盗窃**：服务器或磁盘被物理移走。攻击者拿到硬盘后，可以将其挂载到另一台机器上直接读取数据。这是最常见也最容易理解的威胁。
            

**退役处置不当**：硬盘退役后未进行安全擦除。即使执行了”格式化”，传统的快速格式化只是清除了文件系统元数据，数据扇区仍然完整保留在盘面上。即便使用了全盘覆写，对于
            SSD 来说，由于闪存转换层（Flash Translation
            Layer，FTL）的存在，某些物理页面可能保留了旧数据。
            

**内部人员威胁**：数据中心的运维人员或外包服务商可能有物理接触磁盘的机会。没有加密的情况下，任何能接触物理介质的人都能读取数据。
            

**多租户环境**：在云环境或共享存储场景中，存储介质在不同租户之间复用。如果上一个租户的数据没有被彻底清除，下一个租户可能读到残留数据。
            

**司法扣押**：在某些法律管辖区，执法机构可能扣押服务器。加密确保即使硬件被扣押，数据仍然受到保护。
            

需要明确的是，块级加密**不能**防御的威胁：
            
```
已防御：                           未防御：
├── 物理盗窃                       ├── 运行时内存攻击（cold boot）
├── 退役磁盘数据残留               ├── 已认证用户的越权访问
├── 离线暴力破解                   ├── 操作系统内核漏洞利用
├── 跨租户数据泄露                 ├── 应用层 SQL 注入等攻击
└── 未授权物理访问                 └── 加密密钥泄露
```

            

### 1.2 合规要求

            

在企业和政府环境中，静态数据加密不仅是安全最佳实践，更是硬性合规要求：
            

**PCI DSS（支付卡行业数据安全标准）**：要求
            3.4
            明确规定持卡人数据在存储时必须不可读。全盘加密是满足该要求的常用方法之一。
            

**HIPAA（健康保险可携性和责任法案）**：在美国医疗行业，HIPAA
            安全规则要求对电子受保护健康信息（ePHI）实施访问控制。加密被视为一种”可寻址的”实施规范——虽然不是强制性的，但如果不实施加密，必须提供等效的替代措施并文档化理由。
            

**GDPR（通用数据保护条例）**：欧盟 GDPR 第
            32
            条提到加密是保护个人数据的适当技术措施之一。在发生数据泄露事件时，如果数据已加密且密钥未泄露，可以免除向数据主体通知的义务。
            

**中国等级保护
            2.0**：三级及以上系统要求对重要数据实施加密保护。
            

### 1.3 加密层次的选择

            

数据加密可以在存储栈的多个层次实施：
            
```
┌─────────────────────────────────┐
│         应用层加密               │  ← 应用自行加密字段/文件
├─────────────────────────────────┤
│       文件系统层加密             │  ← fscrypt（ext4/F2FS）、eCryptfs
├─────────────────────────────────┤
│        块设备层加密              │  ← dm-crypt/LUKS ← 本文焦点
├─────────────────────────────────┤
│       硬件层加密                 │  ← SED/OPAL、NVMe 加密
└─────────────────────────────────┘
```

            

**应用层加密**：粒度最细，可以针对单个字段加密。但需要修改应用代码，且无法保护日志、临时文件、交换分区等系统数据。
            

**文件系统层加密**：如
            fscrypt，可以按目录或按文件加密。优势是不同目录可以使用不同密钥，支持文件名加密。劣势是文件系统元数据（如目录结构、文件大小、时间戳）通常不加密。
            

**块设备层加密**：对整个块设备加密，包括文件系统元数据、交换分区、日志等一切内容。对上层完全透明——文件系统和应用程序不需要任何修改。这是本文的重点。
            

**硬件层加密**：由磁盘控制器或 SSD
            固件实现加密。零 CPU
            开销，但信任边界完全在硬件，多个安全研究已经揭示了某些 SSD
            自加密实现的严重缺陷。
            

块设备层加密是安全性、性能和透明性之间的最佳平衡点。它加密了块设备上的所有内容，不需要修改上层软件栈，且在现代
            CPU 的硬件加速支持下性能开销极低。
            

### 1.4
            冷启动攻击与加密的局限性

            

冷启动攻击（Cold Boot
            Attack）是一种针对内存中加密密钥的物理攻击。当系统运行时，dm-crypt
            的主密钥（Master
            Key）必须驻留在内核内存中。如果攻击者能在系统断电后短时间内读取内存内容（DRAM
            中的数据在断电后数秒到数分钟内仍可读取，尤其在低温环境下），就可能提取到密钥。
            

对此的缓解措施包括：
            
            
- 使用 DDR4/DDR5 内存（比 DDR3 衰减更快）
            
- 在内核中启用内存加密（AMD SME/SEV、Intel TME/TDX）
            
- 物理安全措施：机箱入侵检测、拆机即擦除
            
- Linux 内核 5.x 以后对 dm-crypt
            密钥使用内核密钥环（Kernel
            Keyring），支持密钥的内存保护
            
            
            

## 二、dm-crypt 架构

            

### 2.1 Device Mapper 框架

            

dm-crypt 是 Linux 内核中 Device
            Mapper（设备映射器）框架的一个目标（Target）。Device Mapper
            提供了一种通用的块设备虚拟化机制，允许在物理块设备和上层文件系统之间插入一个逻辑转换层。
            
```
用户空间        ┌──────────────┐
                │  文件系统     │
                │ (ext4/XFS)   │
                └──────┬───────┘
                       │ BIO 请求
内核空间        ┌──────┴───────┐
                │ Device Mapper │
                │   框架        │
                ├──────────────┤
                │  dm-crypt    │  ← 加密/解密 Target
                │  Target      │
                └──────┬───────┘
                       │ 加密后的 BIO
                ┌──────┴───────┐
                │  物理块设备   │
                │ (/dev/sda)   │
                └──────────────┘
```

            

Device Mapper 的核心抽象是”映射表（Mapping
            Table）“，它定义了虚拟设备上的逻辑扇区如何映射到底层物理设备的物理扇区。对于
            dm-crypt，这个映射不仅包含位置转换，还包含加密转换——每个写入的扇区在到达物理设备之前都会被加密，每个读出的扇区在到达文件系统之前都会被解密。
            

### 2.2 内核加密 API

            

dm-crypt 使用 Linux 内核加密 API（Kernel Crypto
            API）执行实际的加密和解密操作。Kernel Crypto API
            是内核中的密码学子系统，提供了对称加密、哈希、消息认证码、随机数生成等服务。
            
```
dm-crypt
   │
   ├── skcipher（对称密码）接口
   │      │
   │      ├── 软件实现（aes-generic）
   │      │
   │      └── 硬件加速实现
   │             ├── aesni-intel（AES-NI 指令集）
   │             ├── aes-ce（ARM Crypto Extensions）
   │             └── aes-s390（IBM z/Architecture）
   │
   └── 工作队列（Workqueue）
          ├── 加密工作者线程（kcryptd）
          └── IO 工作者线程（kcryptd_io）
```

            

Kernel Crypto API
            的关键设计是算法的可替换性。同一个算法（如
            AES-XTS）可以有多个实现——纯软件实现和硬件加速实现。API
            会根据优先级自动选择最佳实现。在支持
            AES-NI（高级加密标准新指令集）的 x86_64 CPU
            上，硬件加速实现会被自动选中。
            

查看当前系统可用的加密算法：
            
```
cat /proc/crypto | grep -E "^name|^driver|^type|^priority" | head -40
```

            

查看 dm-crypt 使用的具体驱动：
            
```
dmsetup table --showkeys /dev/mapper/my_encrypted_vol
```

            

### 2.3 IO 路径分析

            

dm-crypt 的 IO
            路径涉及多个内核线程和工作队列。理解这个路径对于性能调优至关重要。
            

**写入路径**：
            
```
1. 文件系统发起写 BIO（Block IO）
2. BIO 到达 dm-crypt Target
3. dm-crypt 从内存池分配加密缓冲区
4. 将明文数据复制到加密缓冲区
5. kcryptd 线程使用 Kernel Crypto API 加密数据
6. 将加密后的 BIO 提交给底层物理设备
7. 物理设备完成写入，释放加密缓冲区
```

            

**读取路径**：
            
```
1. 文件系统发起读 BIO
2. BIO 到达 dm-crypt Target
3. dm-crypt 将读请求转发给底层物理设备
4. 物理设备返回加密数据
5. kcryptd 线程使用 Kernel Crypto API 解密数据
6. 将解密后的数据返回给文件系统
```

            

### 2.4 工作队列与并行化

            

dm-crypt 使用专用的内核工作队列来处理加密和解密操作：
            
            
- **kcryptd**：处理加密/解密计算任务
            
- **kcryptd_io**：处理 IO 提交任务
            
            

从 Linux 4.0 开始，dm-crypt
            支持多队列（Multi-Queue）模式，可以利用多核 CPU
            并行处理加密操作。这对于高 IOPS 的 NVMe 设备尤为重要。
            
```
# 查看 dm-crypt 相关的内核线程
ps aux | grep kcryptd
```

            

dm-crypt 的关键内核参数：
            
```
# 使用同一个 CPU 核心进行加密和 IO 提交（减少缓存失效）
echo "1" > /sys/module/dm_crypt/parameters/same_cpu_crypt

# 使用内联加密提交（减少上下文切换）
echo "1" > /sys/module/dm_crypt/parameters/submit_from_crypt_cpus
```

            

### 2.5 内联加密（Inline
            Encryption）

            

从 Linux 5.9 开始，内核引入了内联加密框架（Inline
            Encryption
            Framework），允许存储控制器在硬件层面执行加密操作。如果底层设备支持内联加密（如某些
            UFS/eMMC/NVMe 控制器），dm-crypt
            可以将加密操作卸载到硬件，完全消除 CPU 开销。
            
```
# 检查设备是否支持内联加密
cat /sys/block/nvme0n1/queue/crypto_profile/modes
```

            

内联加密与传统 dm-crypt 的对比：
            
```
传统 dm-crypt：
  应用 → 文件系统 → dm-crypt（CPU 加密）→ 块层 → 存储控制器 → 磁盘

内联加密：
  应用 → 文件系统 → dm-crypt（标记加密上下文）→ 块层 → 存储控制器（硬件加密）→ 磁盘
```

            
            

## 三、LUKS 头部结构

            

### 3.1 为什么需要 LUKS

            

dm-crypt 本身只提供加密引擎，不定义磁盘格式。裸用
            dm-crypt（即 plain
            mode）需要用户自行管理加密参数和密钥。LUKS（Linux Unified
            Key Setup，Linux 统一密钥设置）在 dm-crypt
            之上定义了一个标准化的磁盘头部格式，解决了以下问题：
            
            
- **密钥管理**：支持多个密钥槽（Key
            Slot），允许多个用户/密码解锁同一个加密卷
            
- **参数持久化**：加密算法、密钥长度、IV
            模式等参数存储在头部，不需要用户记忆
            
- **兼容性**：标准化的格式允许不同发行版、不同版本的
            cryptsetup 互操作
            
- **密钥派生**：内置密钥派生函数（KDF），将用户密码转换为加密密钥
            
            

### 3.2 LUKS1 头部格式

            

LUKS1 的磁盘布局如下：
            
```
偏移量          内容
┌──────────────────────────────────────┐
│ 0x0000        LUKS 魔数              │  "LUKS\xba\xbe"（6 字节）
│ 0x0006        版本号                 │  0x0001
│ 0x0008        密码算法名             │  如 "aes"
│ 0x0028        密码模式               │  如 "xts-plain64"
│ 0x0048        哈希算法               │  如 "sha256"
│ 0x0068        数据偏移（扇区数）     │  数据区起始位置
│ 0x006C        主密钥长度（字节）     │  如 64（AES-256-XTS）
│ 0x0070        主密钥摘要             │  PBKDF2 派生的校验值
│ 0x0084        主密钥盐               │  32 字节随机盐值
│ 0x00A4        主密钥迭代次数         │  PBKDF2 迭代次数
│ 0x00A8        UUID                   │  卷的唯一标识
│ 0x00C8        密钥槽 0               │  第一个密钥槽元数据
│ 0x0110        密钥槽 1               │  第二个密钥槽元数据
│  ...          ...                    │
│ 0x0230        密钥槽 7               │  第八个密钥槽元数据
├──────────────────────────────────────┤
│ 0x0258+       密钥材料区             │  各密钥槽的加密密钥材料
├──────────────────────────────────────┤
│ 数据偏移处    加密数据区             │  实际的加密数据
└──────────────────────────────────────┘
```

            

LUKS1 头部固定占用 592
            字节的元数据，加上密钥材料区域（取决于密钥长度和条带数），整个头部通常占用
            2 MiB。
            

### 3.3 LUKS2 头部格式

            

LUKS2 是 2018 年随 cryptsetup 2.0 引入的新格式，相比
            LUKS1 有重大改进：
            
```
┌──────────────────────────────────────┐
│ 主 JSON 区域（Primary Header）       │
│ ├── 二进制头部（4096 字节）          │
│ │   ├── 魔数："LUKS\xba\xbe"        │
│ │   ├── 版本：0x0002                │
│ │   ├── 头部大小                    │
│ │   ├── 校验和（SHA-256）           │
│ │   └── 盐值                        │
│ ├── JSON 元数据区                   │
│ │   ├── config（配置）              │
│ │   ├── keyslots（密钥槽定义）      │
│ │   ├── segments（数据段定义）      │
│ │   ├── digests（密钥摘要）         │
│ │   └── tokens（令牌）              │
│ └── 密钥槽二进制数据区              │
├──────────────────────────────────────┤
│ 备份 JSON 区域（Secondary Header）   │
│ └── 主头部的完整副本                │
├──────────────────────────────────────┤
│ 加密数据区                           │
└──────────────────────────────────────┘
```

            

LUKS2 的关键改进：
            
            
            
            特性
            LUKS1
            LUKS2
            
            
            
            
            头部格式
            固定二进制
            JSON + 二进制
            
            
            头部冗余
            无
            双份头部
            
            
            密钥槽数
            最多 8 个
            最多 32 个
            
            
            密钥派生
            仅 PBKDF2
            PBKDF2 + Argon2i/Argon2id
            
            
            完整性保护
            无
            支持 AEAD（dm-integrity）
            
            
            令牌系统
            无
            支持外部令牌（FIDO2、TPM2）
            
            
            在线重加密
            不支持
            支持
            
            
            头部大小
            2 MiB
            默认 16 MiB
            
            
            
            

### 3.4 密钥槽机制

            

LUKS 的密钥管理采用两层结构：
            
```
用户密码 A ──→ KDF ──→ 解密密钥槽 0 ──→ 主密钥（Master Key）
用户密码 B ──→ KDF ──→ 解密密钥槽 1 ──┘        │
密钥文件 C ──→ KDF ──→ 解密密钥槽 2 ──┘        │
                                                 ↓
                                         AES-XTS 加密引擎
                                                 │
                                                 ↓
                                           加密数据
```

            

**主密钥（Master
            Key）**是实际用于加密数据的密钥，在
            `luksFormat`
            时随机生成，在加密卷的整个生命周期内不变。每个密钥槽存储的是用不同密码/密钥加密后的主密钥副本。这种设计意味着：
            
            
- 可以添加或删除密钥槽而不需要重新加密整个磁盘
            
- 多个用户可以用不同密码解锁同一个加密卷
            
- 修改密码只需要重新加密对应的密钥槽
            
            

### 3.5 反取证分割器

            

LUKS1 使用了一种名为 AF-Splitter（Anti-Forensic
            Splitter，反取证分割器）的技术来存储密钥材料。其目的是增加从残留磁扇区恢复被删除密钥的难度。
            

原理：将密钥材料”扩散”到远大于密钥本身的存储空间中。例如，一个
            64 字节的主密钥会被扩散到 4000 个条带中，每个条带 64
            字节，总共占用 256
            KiB。只有当所有条带都完整可用时，才能恢复出原始密钥。如果任何一个条带被覆写或损坏，密钥就无法恢复。
            
```
主密钥（64 字节）
      │
      ↓ AF-Split（4000 个条带）
┌─────────────────────────────┐
│ 条带 1 │ 条带 2 │ ... │ 条带 4000 │  共 256 KiB
└─────────────────────────────┘
      │
      ↓ 用户密码派生的密钥加密
┌─────────────────────────────┐
│        加密后的密钥材料       │  存储在磁盘上
└─────────────────────────────┘
```

            

这意味着当用户删除一个密钥槽时（`luksKillSlot`），只需要确保覆写了至少一个条带，就能保证密钥无法恢复。对于传统磁盘来说，这比覆写整个密钥区域提供了更好的安全保证。
            

### 3.6 LUKS 头部备份与恢复

            

LUKS
            头部包含了解密数据的所有必要信息（除了用户密码）。头部损坏意味着数据永久丢失。因此，备份
            LUKS 头部是至关重要的操作：
            
```
# 备份 LUKS 头部
cryptsetup luksHeaderBackup /dev/sdb1 --header-backup-file luks-header-backup.bin

# 从备份恢复 LUKS 头部
cryptsetup luksHeaderRestore /dev/sdb1 --header-backup-file luks-header-backup.bin
```

            

安全注意事项：LUKS
            头部备份文件包含了加密的主密钥副本。如果攻击者同时获得了头部备份和用户密码，就能解密数据。因此，头部备份文件的存储安全性与密码本身同等重要。特别是在执行
            `luksRemoveKey`
            删除密钥槽之前制作的备份，即使密钥槽被删除，备份中仍然保留着对应的密钥材料。
            
            

## 四、密钥派生

            

### 4.1
            为什么需要密钥派生函数

            

用户输入的密码通常具有较低的熵（Entropy）——一个 12
            字符的密码大约有 40-70 比特的熵，而 AES-256 需要 256
            比特的均匀随机密钥。密钥派生函数（Key Derivation
            Function，KDF）解决了两个关键问题：
            
            
- 

**密钥拉伸（Key
            Stretching）**：通过增加计算量来增加暴力破解的成本。即使密码只有
            40 比特的熵，如果每次尝试需要 1
            秒的计算，暴力破解仍然需要数万亿年。
            
- 

**密钥白化（Key
            Whitening）**：将低熵的密码转换为看起来随机的固定长度密钥，使其适合作为对称加密算法的输入。
            
            

### 4.2 PBKDF2

            

PBKDF2（Password-Based Key Derivation Function
            2，基于密码的密钥派生函数 2）是 LUKS1
            使用的密钥派生函数，定义在 RFC 8018 中。
            
```
PBKDF2(密码, 盐值, 迭代次数, 输出长度)

计算过程：
U1 = HMAC(密码, 盐值 || 00000001)
U2 = HMAC(密码, U1)
U3 = HMAC(密码, U2)
...
Uc = HMAC(密码, U(c-1))

输出 = U1 ⊕ U2 ⊕ U3 ⊕ ... ⊕ Uc
```

            

PBKDF2 的主要参数：
            
            
- **哈希函数**：通常使用 SHA-256 或
            SHA-512
            
- **盐值（Salt）**：随机生成的值，防止预计算攻击（Rainbow
            Table，彩虹表）
            
- **迭代次数（Iteration
            Count）**：决定计算量。cryptsetup
            默认根据系统性能自动选择迭代次数，目标是使一次密钥派生耗时约
            1-2 秒
            
            

查看当前 LUKS 卷的 PBKDF2 参数：
            
```
cryptsetup luksDump /dev/sdb1 | grep -A5 "Key Slot"
```

            

PBKDF2 的局限性在于它只消耗 CPU
            时间，不消耗大量内存。这使得基于 GPU 和 FPGA
            的暴力破解攻击非常有效——GPU
            拥有数千个计算核心，可以大规模并行执行 PBKDF2 计算。
            

### 4.3 Argon2id

            

Argon2 是 2015 年密码哈希竞赛（Password Hashing
            Competition，PHC）的获胜者，LUKS2 默认使用 Argon2id
            变体。Argon2id 结合了
            Argon2i（数据无关的内存访问模式，抗侧信道攻击）和
            Argon2d（数据相关的内存访问模式，抗 GPU 攻击）的优点。
            
```
Argon2id(密码, 盐值, 时间成本, 内存成本, 并行度)

关键参数：
├── 时间成本（t）：迭代次数，每次迭代遍历整个内存
├── 内存成本（m）：以 KiB 为单位的内存用量
└── 并行度（p）：并行计算的线程数
```

            

Argon2id 相比 PBKDF2 的关键优势是**内存硬度（Memory
            Hardness）**。Argon2id
            在计算过程中需要访问大量内存，且内存访问模式无法压缩或预测。这使得
            GPU 和 ASIC
            攻击的成本大幅增加——这些设备拥有大量计算核心，但每核心的内存带宽和容量有限。
            

cryptsetup 创建 LUKS2 卷时的默认 Argon2id 参数：
            
```
# cryptsetup 默认 Argon2id 参数（可通过 luksDump 查看）：
# 时间成本：根据系统性能自动调整
# 内存成本：1 GiB（1048576 KiB）
# 并行度：4

# 手动指定参数：
cryptsetup luksFormat --type luks2 \
  --pbkdf argon2id \
  --pbkdf-memory 2097152 \
  --pbkdf-parallel 4 \
  --pbkdf-force-iterations 8 \
  /dev/sdb1
```

            

### 4.4 PBKDF2 与 Argon2id
            对比

            
            
            
            维度
            PBKDF2
            Argon2id
            
            
            
            
            抗 GPU 攻击
            弱
            强（内存硬度）
            
            
            抗 ASIC 攻击
            弱
            强
            
            
            内存消耗
            可忽略
            可配置（默认 1 GiB）
            
            
            CPU 消耗
            高
            中
            
            
            标准化
            RFC 8018
            RFC 9106
            
            
            适用场景
            内存受限环境
            通用场景
            
            
            LUKS 支持
            LUKS1/LUKS2
            仅 LUKS2
            
            
            
            

在内存充足的服务器环境中，应始终优先选择
            Argon2id。只有在嵌入式设备或内存极度受限的环境中（如内存小于
            256 MiB），才需要回退到 PBKDF2。
            

### 4.5 密钥派生参数调优

            

密钥派生参数的选择是安全性与可用性的权衡：
            
```
# 基准测试：测试不同 Argon2id 参数下的解锁时间
cryptsetup benchmark --pbkdf argon2id \
  --pbkdf-memory 1048576 \
  --pbkdf-parallel 4

# 针对高安全场景增加内存成本
cryptsetup luksFormat --type luks2 \
  --pbkdf argon2id \
  --pbkdf-memory 4194304 \
  --pbkdf-parallel 4 \
  --pbkdf-force-iterations 12 \
  /dev/sdb1

# 针对嵌入式/低内存场景降低内存成本
cryptsetup luksFormat --type luks2 \
  --pbkdf argon2id \
  --pbkdf-memory 262144 \
  --pbkdf-parallel 2 \
  --pbkdf-force-iterations 4 \
  /dev/sdb1
```

            

一个常见的误区是将密钥派生时间设置得过长。虽然更长的派生时间增加了暴力破解的成本，但用户每次开机解锁都需要等待这段时间。对于交互式使用场景，1-3
            秒是合理的范围；对于无人值守的服务器启动场景（使用密钥文件），可以降低计算量以加快启动速度。
            
            

## 五、加密算法选择

            

### 5.1 AES-XTS-plain64

            

AES-XTS-plain64 是 dm-crypt/LUKS
            的默认加密模式，也是目前最被广泛推荐的磁盘加密算法。
            

**AES（Advanced Encryption
            Standard，高级加密标准）**：美国 NIST 于 2001
            年标准化的对称加密算法。密钥长度支持 128、192 和 256
            比特。在磁盘加密场景中，通常使用 AES-256。
            

**XTS（XEX-based Tweaked-codebook mode with
            ciphertext Stealing，基于 XEX
            的可调密码本模式）**：IEEE P1619
            标准定义的磁盘加密模式。XTS 的关键特性：
            
            
- 每个扇区使用不同的”调整值（Tweak）“，即使两个扇区包含相同的明文，密文也不同
            
- 不需要初始化向量（IV）链——每个扇区可以独立加密/解密，支持随机访问
            
- 不提供认证（Authentication）——无法检测密文是否被篡改
            
            
```
XTS 加密过程（单个 16 字节块）：

T = AES_K2(扇区号) ⊗ α^j    （α 是 GF(2^128) 中的原根，j 是块索引）
PP = P ⊕ T                   （P 是明文块）
CC = AES_K1(PP)               （加密）
C = CC ⊕ T                   （C 是密文块）

注意：XTS 使用两个独立的 AES 密钥 K1 和 K2
      AES-256-XTS 实际需要 512 比特（64 字节）的密钥材料
```

            

**plain64**：IV（Initialization
            Vector，初始化向量）生成模式。plain64 使用 64 位的扇区号作为
            IV。相比旧的 plain 模式（32 位扇区号），plain64 支持大于 2
            TiB 的设备。
            

### 5.2 其他加密模式

            

除了 AES-XTS，dm-crypt 还支持其他加密模式：
            

**AES-CBC-ESSIV（密码块链接模式 +
            加密盐扇区初始化向量）**：较早的加密模式。CBC
            模式下同一扇区的加密是串行的，无法并行处理。ESSIV 解决了 CBC
            模式下 IV 可预测导致的水印攻击问题。已不推荐使用。
            

**AES-GCM（伽罗瓦/计数器模式）**：提供认证加密（AEAD），可以检测密文篡改。但
            GCM 需要不可重复的
            nonce——在磁盘加密场景中，同一扇区可能被多次覆写，nonce
            管理成为难题。LUKS2 通过集成 dm-integrity
            来解决这个问题，但会引入额外的存储和性能开销。
            

**Adiantum**：Google 为低端硬件（缺少 AES
            硬件加速的 ARM 处理器）设计的加密方案，使用 ChaCha20 和
            Poly1305 构建。在没有 AES-NI 的设备上，Adiantum
            的性能显著优于 AES-XTS。
            

### 5.3
            Adiantum：低端硬件的选择

            

Adiantum 由 Google 在 2018 年提出，专门解决低端 ARM
            设备（如 Android Go 手机、嵌入式设备）上 AES
            加密性能不足的问题。
            
```
Adiantum 构造：
  ├── ChaCha12/ChaCha20（流密码）：核心加密
  ├── Poly1305（MAC）：用于哈希运算
  └── AES-256（单次调用）：处理 16 字节的调整值

性能对比（无 AES-NI 的 ARM Cortex-A7）：
  AES-256-XTS：约 24 MiB/s
  Adiantum：    约 112 MiB/s（约 4.7 倍提升）
```

            

在支持 AES-NI 的 x86_64 CPU 上，AES-XTS 的性能远超
            Adiantum，因此 Adiantum
            仅推荐用于缺少硬件加速的低端设备。
            
```
# 使用 Adiantum 创建 LUKS2 卷
cryptsetup luksFormat --type luks2 \
  --cipher xchacha20,aes-adiantum-plain64 \
  --key-size 256 \
  /dev/sdb1
```

            

### 5.4 密码基准测试

            

cryptsetup
            提供了内置的基准测试工具，可以在当前系统上测试各种算法的性能：
            
```
cryptsetup benchmark
```

            

典型输出（x86_64，Intel i7-10700，支持 AES-NI）：
            
```
# 测试由 cryptsetup 输出的近似值
PBKDF2-sha1      1567890 iterations per second for 256-bit key
PBKDF2-sha256    2031579 iterations per second for 256-bit key
PBKDF2-sha512    1456789 iterations per second for 256-bit key
#     Algorithm |       Key |      Encryption |      Decryption
        aes-cbc        128b      1150.3 MiB/s      3680.5 MiB/s
    serpent-cbc        128b        95.1 MiB/s       523.7 MiB/s
    twofish-cbc        128b       198.4 MiB/s       373.5 MiB/s
        aes-cbc        256b       876.4 MiB/s      2915.2 MiB/s
    serpent-cbc        256b        96.3 MiB/s       524.0 MiB/s
    twofish-cbc        256b       199.6 MiB/s       372.7 MiB/s
        aes-xts        256b      3501.2 MiB/s      3508.7 MiB/s
    serpent-xts        256b       533.8 MiB/s       515.2 MiB/s
    twofish-xts        256b       370.0 MiB/s       373.1 MiB/s
        aes-xts        512b      2798.5 MiB/s      2803.1 MiB/s
    serpent-xts        512b       536.4 MiB/s       515.6 MiB/s
    twofish-xts        512b       370.5 MiB/s       373.0 MiB/s
```

            

从基准测试可以看出，AES-XTS 在有 AES-NI
            的系统上性能极高（超过 2.8 GiB/s），远超 Serpent 和 Twofish
            等替代算法。这也是 AES-XTS 成为默认选择的原因。
            

### 5.5 算法选择建议

            
```
决策树：

是否有 AES 硬件加速（AES-NI / ARMv8 CE）？
├── 是 → AES-256-XTS-plain64（默认选择）
│        └── 需要认证加密？
│            ├── 是 → AES-256-GCM + dm-integrity（LUKS2）
│            └── 否 → AES-256-XTS-plain64
└── 否 → Adiantum（xchacha20,aes-adiantum-plain64）
```

            
            

## 六、cryptsetup 实战

            

### 6.1 安装与环境准备

            
```
# Debian/Ubuntu
apt-get install cryptsetup

# RHEL/CentOS/Fedora
dnf install cryptsetup

# 确认 dm-crypt 内核模块已加载
modprobe dm-crypt
lsmod | grep dm_crypt

# 确认 AES-NI 支持
grep -o aes /proc/cpuinfo | head -1
```

            

### 6.2
            luksFormat：创建加密卷

            
```
# 标准 LUKS2 格式化（使用默认参数：AES-256-XTS，Argon2id）
cryptsetup luksFormat /dev/sdb1

# 明确指定所有参数
cryptsetup luksFormat \
  --type luks2 \
  --cipher aes-xts-plain64 \
  --key-size 512 \
  --hash sha256 \
  --pbkdf argon2id \
  --pbkdf-memory 1048576 \
  --pbkdf-parallel 4 \
  --label "encrypted-data" \
  --subsystem "" \
  --sector-size 4096 \
  /dev/sdb1

# 使用密钥文件（非交互式）
dd if=/dev/urandom of=keyfile.bin bs=4096 count=1
chmod 600 keyfile.bin
cryptsetup luksFormat /dev/sdb1 keyfile.bin
```

            

`--sector-size 4096` 参数值得关注：对于
            4Kn（4K 原生扇区）磁盘和高级格式磁盘，使用 4096
            字节的加密扇区大小可以避免读-改-写（Read-Modify-Write）放大。
            

### 6.3
            luksOpen/luksClose：打开和关闭加密卷

            
```
# 使用密码打开加密卷
cryptsetup luksOpen /dev/sdb1 my_encrypted_vol
# 等效的新语法
cryptsetup open --type luks /dev/sdb1 my_encrypted_vol

# 使用密钥文件打开
cryptsetup luksOpen /dev/sdb1 my_encrypted_vol --key-file keyfile.bin

# 打开后，加密卷出现在 /dev/mapper/ 下
ls -la /dev/mapper/my_encrypted_vol

# 在解密设备上创建文件系统
mkfs.ext4 /dev/mapper/my_encrypted_vol

# 挂载使用
mount /dev/mapper/my_encrypted_vol /mnt/encrypted

# 卸载并关闭加密卷
umount /mnt/encrypted
cryptsetup luksClose my_encrypted_vol
```

            

### 6.4
            luksAddKey/luksRemoveKey：密钥槽管理

            
```
# 添加新密码（需要先验证一个已有密码）
cryptsetup luksAddKey /dev/sdb1

# 使用密钥文件添加新密码
cryptsetup luksAddKey /dev/sdb1 --key-file existing-keyfile.bin

# 添加密钥文件作为新密钥槽
cryptsetup luksAddKey /dev/sdb1 new-keyfile.bin

# 指定密钥槽号
cryptsetup luksAddKey /dev/sdb1 --key-slot 3

# 删除指定密码（交互式输入要删除的密码）
cryptsetup luksRemoveKey /dev/sdb1

# 删除指定密钥槽
cryptsetup luksKillSlot /dev/sdb1 3

# 修改密码（先删除旧密码，再添加新密码，或使用 luksChangeKey）
cryptsetup luksChangeKey /dev/sdb1
```

            

密钥管理的安全实践：
            
```
# 始终确保至少保留一个有效密钥槽
# 删除密钥前检查当前密钥槽状态
cryptsetup luksDump /dev/sdb1 | grep "Key Slot"

# 在删除密钥前备份头部（以防误操作）
cryptsetup luksHeaderBackup /dev/sdb1 \
  --header-backup-file /safe/location/header-backup.bin
```

            

### 6.5
            luksDump：查看加密卷信息

            
```
cryptsetup luksDump /dev/sdb1
```

            

典型的 LUKS2 luksDump 输出：
            
```
LUKS header information
Version:        2
Epoch:          5
Metadata area:  16384 [bytes]
Keyslots area:  16744448 [bytes]
UUID:           a1b2c3d4-e5f6-7890-abcd-ef1234567890
Label:          encrypted-data
Subsystem:      (no subsystem)
Flags:          (no flags)

Data segments:
  0: crypt
    offset: 16777216 [bytes]
    length: (whole device)
    cipher: aes-xts-plain64
    sector: 4096 [bytes]

Keyslots:
  0: luks2
    Key:        512 bits
    Priority:   normal
    Cipher:     aes-xts-plain64
    Cipher key: 512 bits
    PBKDF:      argon2id
      Time cost:    4
      Memory:       1048576
      Threads:      4
    AF stripes: 4000
    AF hash:    sha256
    Area offset:77824 [bytes]
    Area length:258048 [bytes]
    Digest ID:  0
  1: luks2
    Key:        512 bits
    Priority:   normal
    ...

Tokens:
  0: systemd-tpm2
    ...

Digests:
  0: pbkdf2
    Hash:       sha256
    Iterations: 131072
    Salt:       ab cd ef ...
    Digest:     12 34 56 ...
```

            

### 6.6 开机自动解锁配置

            

通过 `/etc/crypttab` 配置开机自动解锁：
            
```
# /etc/crypttab 格式：
#       

# 使用密码交互式解锁
my_encrypted_vol  UUID=a1b2c3d4-e5f6-7890-abcd-ef1234567890  none  luks

# 使用密钥文件自动解锁
my_encrypted_vol  UUID=a1b2c3d4-e5f6-7890-abcd-ef1234567890  /root/keyfile.bin  luks

# 使用密钥文件 + 丢弃支持（SSD TRIM）
my_encrypted_vol  UUID=a1b2c3d4-e5f6-7890-abcd-ef1234567890  /root/keyfile.bin  luks,discard

# 对应的 /etc/fstab 条目
# /dev/mapper/my_encrypted_vol  /mnt/encrypted  ext4  defaults  0  2
```

            

关于 `discard` 选项的安全考量：启用
            `discard`（TRIM）后，SSD 的 TRIM
            操作会透过加密层传递到底层设备。这意味着攻击者可以通过分析哪些扇区被
            TRIM
            来推断文件系统的使用模式（如哪些区域有数据、哪些区域是空闲的）。在高安全场景中，应禁用
            `discard`，但这会影响 SSD 的写入性能和寿命。
            

### 6.7 在线重加密

            

LUKS2 支持在线重加密（Online
            Re-encryption），可以在不卸载文件系统的情况下：
            
            
- 更改加密算法或密钥大小
            
- 加密现有的未加密分区
            
- 解密已加密的分区
            
            
```
# 更改加密算法（在线操作）
cryptsetup reencrypt /dev/sdb1 \
  --cipher aes-xts-plain64 \
  --key-size 512

# 加密现有未加密分区（会缩减文件系统以腾出 LUKS 头部空间）
cryptsetup reencrypt --encrypt --reduce-device-size 32M /dev/sdb1

# 解密已加密分区
cryptsetup reencrypt --decrypt /dev/sdb1

# 在线重加密支持断点续传——如果过程中系统崩溃或断电，
# 下次运行 cryptsetup 时会自动恢复中断的重加密操作
```

            
            

## 七、性能影响分析

            

### 7.1 AES-NI 硬件加速

            

AES-NI（AES New Instructions，AES 新指令集）是 Intel 在
            2010 年引入的 CPU 指令集扩展，AMD
            在同年也提供了等效支持。AES-NI
            提供了六条专用指令，在硬件层面实现 AES 的关键操作：
            
```
AES-NI 指令集：
├── AESENC      单轮加密
├── AESENCLAST  最后一轮加密
├── AESDEC      单轮解密
├── AESDECLAST  最后一轮解密
├── AESKEYGENASSIST  密钥扩展辅助
└── AESIMC      逆列混合（用于解密密钥调度）
```

            

检查系统是否支持 AES-NI：
            
```
grep -o aes /proc/cpuinfo | head -1
# 或者更详细的检查
grep -m1 "flags" /proc/cpuinfo | tr ' ' '\n' | grep -E "^aes$"
```

            

ARM 平台上的等效特性是 ARMv8 Cryptography
            Extensions（ARMv8 密码学扩展），提供了类似的硬件加速。
            

### 7.2 基准测试方法论

            

准确的加密性能测试需要控制多个变量：
            
```
# 方法一：使用 cryptsetup 内置基准测试（测试原始加密吞吐量）
cryptsetup benchmark

# 方法二：使用 dd 测试顺序读写吞吐量
# 先准备加密卷和对照（未加密）卷
# 写入测试
dd if=/dev/zero of=/mnt/encrypted/testfile bs=1M count=4096 oflag=direct
dd if=/dev/zero of=/mnt/plain/testfile bs=1M count=4096 oflag=direct

# 读取测试
dd if=/mnt/encrypted/testfile of=/dev/null bs=1M iflag=direct
dd if=/mnt/plain/testfile of=/dev/null bs=1M iflag=direct

# 方法三：使用 fio 进行更全面的测试
# 顺序写入
fio --name=seq-write --filename=/dev/mapper/my_encrypted_vol \
  --ioengine=libaio --direct=1 --rw=write \
  --bs=128k --iodepth=32 --numjobs=1 --size=4G

# 随机读取（4K）
fio --name=rand-read --filename=/dev/mapper/my_encrypted_vol \
  --ioengine=libaio --direct=1 --rw=randread \
  --bs=4k --iodepth=64 --numjobs=4 --size=4G

# 混合随机读写
fio --name=randrw --filename=/dev/mapper/my_encrypted_vol \
  --ioengine=libaio --direct=1 --rw=randrw --rwmixread=70 \
  --bs=4k --iodepth=64 --numjobs=4 --size=4G
```

            

### 7.3
            不同工作负载下的性能开销

            

加密的性能开销因工作负载类型而异：
            

**顺序大块
            IO**（视频流、数据库全表扫描）：
            

在有 AES-NI 的现代 CPU 上，AES-XTS 加密吞吐量超过 2
            GiB/s，远高于大多数存储设备的带宽上限。因此顺序大块 IO
            的性能开销通常可以忽略不计（小于
            3%）。瓶颈在存储设备本身，而非加密引擎。
            
```
典型结果（NVMe SSD，AES-256-XTS，AES-NI）：

工作负载                未加密        加密          开销
──────────────────────────────────────────────────────────
顺序读 128K            3200 MiB/s    3150 MiB/s    ~1.5%
顺序写 128K            2800 MiB/s    2750 MiB/s    ~1.8%
随机读 4K（QD=32）     580K IOPS     540K IOPS     ~6.9%
随机写 4K（QD=32）     480K IOPS     440K IOPS     ~8.3%
随机读写 4K 7:3        520K IOPS     470K IOPS     ~9.6%
```

            

**随机小块 IO**（数据库
            OLTP、元数据密集型操作）：
            

随机小块 IO 的加密开销相对较高，主要原因： - 每个 IO
            请求都需要一次加密/解密操作，但数据量很小，加密引擎的初始化和调度开销相对显著
            - dm-crypt 的工作队列调度引入了额外的上下文切换 - CPU
            缓存效率降低——加密操作可能将有用数据从缓存中驱逐
            

### 7.4 性能调优参数

            
```
# 允许加密和 IO 使用同一 CPU（减少缓存失效）
echo "1" > /sys/module/dm_crypt/parameters/same_cpu_crypt

# 在加密完成后立即提交 IO（减少上下文切换）
echo "1" > /sys/module/dm_crypt/parameters/submit_from_crypt_cpus

# 调整加密设备的 IO 调度器（对于 NVMe，none 通常最优）
echo "none" > /sys/block/dm-0/queue/scheduler

# 调整预读值
blockdev --setra 2048 /dev/mapper/my_encrypted_vol

# 对于 LUKS2，使用 4K 扇区大小以匹配 4Kn 磁盘
cryptsetup luksFormat --sector-size 4096 /dev/sdb1
```

            

在 crypttab 中持久化性能选项：
            
```
# /etc/crypttab
my_encrypted_vol  UUID=...  /root/keyfile.bin  luks,same-cpu-crypt,submit-from-crypt-cpus
```

            

### 7.5 无 AES-NI
            环境的性能考量

            

在没有 AES-NI 的环境中（旧 CPU、某些虚拟化环境不暴露
            AES-NI、低端 ARM 设备），AES
            加密完全由软件实现，性能显著下降：
            
```
无 AES-NI 环境（软件 AES）：

工作负载                未加密        加密          开销
──────────────────────────────────────────────────────────
顺序读 128K            2500 MiB/s     400 MiB/s    ~84%
顺序写 128K            2200 MiB/s     380 MiB/s    ~83%
随机读 4K              300K IOPS      180K IOPS    ~40%
```

            

在这种环境下，有两种选择： 1. 使用 Adiantum 算法替代
            AES-XTS 2. 确保虚拟化平台暴露了 AES-NI 指令（KVM 使用
            `-cpu host`，VMware 启用 AES-NI passthrough）
            
            

## 八、自加密盘（SED/OPAL）

            

### 8.1 TCG Opal 标准

            

自加密盘（Self-Encrypting
            Drive，SED）是在磁盘控制器硬件中实现加密的存储设备。TCG（Trusted
            Computing Group，可信计算组织）定义了 Opal
            安全子系统类（Opal SSC）标准，规范了 SED 的管理接口。
            
```
SED 架构：

┌─────────────────────────────────────┐
│              主机系统                │
│  ┌──────────────────────────────┐   │
│  │       应用 / 文件系统        │   │
│  ├──────────────────────────────┤   │
│  │        块设备层              │   │  ← 无 dm-crypt
│  └──────────┬───────────────────┘   │
└─────────────┼───────────────────────┘
              │  SATA/NVMe 命令
┌─────────────┼───────────────────────┐
│  SED 磁盘   │                       │
│  ┌──────────┴───────────────────┐   │
│  │     磁盘控制器               │   │
│  │  ┌──────────────────────┐    │   │
│  │  │  AES 加密引擎（硬件） │   │   │
│  │  └──────────────────────┘    │   │
│  ├──────────────────────────────┤   │
│  │     NAND 闪存 / 磁盘盘面    │   │  ← 数据始终加密存储
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

            

SED 的核心特性：
            
            
- **零 CPU
            开销**：加密完全由磁盘控制器硬件完成
            
- **零性能损失**：加密引擎工作在磁盘控制器的数据路径中，不引入额外延迟
            
- **即时安全擦除（Instant Secure
            Erase）**：只需销毁加密密钥，整个磁盘的数据立即变为不可恢复——无需覆写每个扇区
            
- **对操作系统透明**：不需要任何驱动或软件支持即可工作（但需要管理工具来设置密码）
            
            

### 8.2 硬件加密 vs 软件加密

            

2018 年，荷兰拉德堡德大学的研究人员 Carlo Meijer 和
            Bernard van Gastel 发表了一篇重要论文《Self-encrypting
            deception: weaknesses in the encryption of solid state
            drives》，揭示了多个主流 SSD
            品牌的自加密实现存在严重缺陷：
            
            
- 某些 SSD
            的加密密钥与用户密码完全独立——设置了密码但实际上没有用它保护加密密钥
            
- 某些 SSD 使用固定的全零 DEK（数据加密密钥）
            
- 某些 SSD 的 JTAG 调试端口允许直接读取明文数据
            
- ATA 安全模式和 TCG Opal 模式之间的实现不一致
            
            

这些发现导致了一个重要的安全建议：**不要仅依赖硬件加密**。在高安全场景中，应该使用
            dm-crypt/LUKS 软件加密，或者在 SED
            之上叠加软件加密（双层加密）。
            
```
信任模型对比：

软件加密（dm-crypt/LUKS）：
  信任：Linux 内核、Kernel Crypto API（开源、可审计）
  不信任：磁盘硬件

硬件加密（SED/OPAL）：
  信任：磁盘控制器固件（闭源、不可审计）
  不信任：（无——完全信任硬件）

推荐（纵深防御）：
  软件加密 + 硬件加密
  信任：Linux 内核
  不信任：磁盘硬件（即使硬件加密被绕过，软件加密仍然保护数据）
```

            

### 8.3 sedutil 管理工具

            

sedutil 是一个开源的 TCG Opal SED 管理工具，可以用来配置
            SED 的安全功能：
            
```
# 安装 sedutil
# 从 https://github.com/Drive-Trust-Alliance/sedutil 获取

# 扫描系统中的 SED 支持设备
sedutil-cli --scan

# 输出示例：
# /dev/sda  2  Samsung SSD 860 EVO 500GB  Opal 2.0

# 初始化 SED（设置 SID 密码）
sedutil-cli --initialSetup 

 /dev/sda

# 启用锁定功能
sedutil-cli --enableLockingRange 0 

 /dev/sda

# 设置锁定范围（全盘）
sedutil-cli --setLockingRange 0 LK 

 /dev/sda

# 启用开机预引导认证（PBA）
sedutil-cli --setMBREnable on 

 /dev/sda
sedutil-cli --loadPBAimage 

  /dev/sda

# 查看磁盘安全状态
sedutil-cli --query /dev/sda

# 即时安全擦除（PSID Revert）
# 注意：这会永久销毁所有数据！
sedutil-cli --yesIreallywanttoERASEALLmydatausingthePSID  /dev/sda
```

            

### 8.4 NVMe 安全特性

            

现代 NVMe 规范定义了自己的安全特性，部分独立于 TCG
            Opal：
            
```
# 使用 nvme-cli 查看 NVMe 磁盘的安全能力
nvme id-ctrl /dev/nvme0n1 | grep -i -E "oacs|fna"

# NVMe 安全擦除（Secure Erase）
# 用户数据擦除
nvme format /dev/nvme0n1 --ses=1

# 密码擦除（如果支持）
nvme format /dev/nvme0n1 --ses=2
```

            
            

## 九、密钥管理进阶

            

### 9.1 密钥托管策略

            

在企业环境中，加密密钥的管理是比加密本身更复杂的问题。密钥托管（Key
            Escrow）策略需要平衡安全性和可用性：
            
```
密钥托管方案选项：

方案 A：集中式密钥服务器
  ┌──────────┐      ┌──────────────┐
  │ 服务器 1  │─────→│  密钥管理    │
  │ 服务器 2  │─────→│  服务器      │
  │ 服务器 N  │─────→│ (HashiCorp   │
  └──────────┘      │  Vault 等)   │
                    └──────────────┘

方案 B：密钥分割（Shamir 秘密分享）
  主密钥 → 分割为 N 份，需要 M 份恢复（M-of-N）
  ├── 份额 1 → 管理员 A
  ├── 份额 2 → 管理员 B
  ├── 份额 3 → 管理员 C
  └── 份额 4 → 保险柜（离线存储）

方案 C：网络绑定加密（NBDE，见 9.3）
```

            

### 9.2 TPM 集成

            

TPM（Trusted Platform
            Module，可信平台模块）是一个专用的安全协处理器，可以安全地存储加密密钥。将
            LUKS 密钥绑定到 TPM
            可以实现无人值守的自动解锁，同时确保只有在”可信”的系统状态下（BIOS/UEFI、引导加载器、内核未被篡改）才能解锁。
            
```
# 使用 systemd-cryptenroll 将 LUKS2 密钥绑定到 TPM2
# （需要 systemd 248+）

# 查看 TPM2 设备
systemd-cryptenroll --tpm2-device=list

# 将密钥绑定到 TPM2 的 PCR 7（安全启动状态）
systemd-cryptenroll --tpm2-device=auto \
  --tpm2-pcrs=7 \
  /dev/sdb1

# 绑定到多个 PCR（更严格的平台状态验证）
systemd-cryptenroll --tpm2-device=auto \
  --tpm2-pcrs=0+2+4+7 \
  /dev/sdb1

# PCR 含义：
# PCR 0：UEFI 固件代码
# PCR 2：UEFI 驱动和选项 ROM
# PCR 4：引导管理器（GRUB/systemd-boot）
# PCR 7：安全启动状态（签名验证策略）

# 使用 TPM2 自动解锁的 crypttab 配置
my_encrypted_vol  UUID=...  -  tpm2-device=auto
```

            

TPM 绑定的安全模型：
            
```
系统启动流程：
UEFI 固件 → 度量到 PCR 0
  → Secure Boot 验证 → 度量到 PCR 7
    → GRUB 引导 → 度量到 PCR 4
      → 内核加载 → TPM2 检查 PCR 值
        → PCR 值匹配 → 释放 LUKS 密钥 → 解锁加密卷
        → PCR 值不匹配 → 拒绝释放密钥 → 要求手动输入密码
```

            

### 9.3
            Clevis/Tang：网络绑定磁盘加密

            

Clevis/Tang 是 Red Hat
            开发的网络绑定磁盘加密（Network-Bound Disk
            Encryption，NBDE）方案。其核心思想是：加密密钥只能在连接到特定网络时才能解锁。当服务器被物理移走（离开安全网络），即使磁盘未被拆除，加密卷也无法解锁。
            
```
NBDE 架构：

┌──────────────────┐        ┌──────────────────┐
│  客户端（Clevis） │←──────→│  服务器（Tang）   │
│                  │  HTTPS  │                  │
│  ├── LUKS 加密卷 │        │  ├── 公钥/私钥    │
│  ├── Clevis PIN  │        │  └── 无状态       │
│  └── JWE 令牌    │        │      无认证       │
└──────────────────┘        │      无日志       │
                            └──────────────────┘
```

            

Tang
            服务器的关键设计原则是**无状态**——它不存储任何客户端信息，不进行认证，不记录日志。安全性完全基于网络可达性：只有能够访问
            Tang 服务器的客户端才能解锁。
            
```
# === Tang 服务器端配置 ===

# 安装 Tang
dnf install tang

# 启动 Tang 服务（默认监听端口 80）
systemctl enable --now tangd.socket

# Tang 的密钥存储在 /var/db/tang/
ls /var/db/tang/

# 轮换 Tang 密钥
tangd-keygen /var/db/tang/
tangd-update /var/db/tang/

# === 客户端（Clevis）配置 ===

# 安装 Clevis
dnf install clevis clevis-luks clevis-dracut

# 将 LUKS 卷绑定到 Tang 服务器
clevis luks bind -d /dev/sdb1 tang '{"url":"http://tang.example.com"}'

# 验证绑定
clevis luks list -d /dev/sdb1

# 手动解锁测试
clevis luks unlock -d /dev/sdb1

# 将 Clevis 集成到 initramfs（支持开机自动解锁）
dracut -fv --regenerate-all

# 高可用：绑定到多个 Tang 服务器（Shamir 秘密分享）
clevis luks bind -d /dev/sdb1 sss \
  '{"t":2,"pins":{"tang":[{"url":"http://tang1.example.com"},{"url":"http://tang2.example.com"},{"url":"http://tang3.example.com"}]}}'
# t=2 表示需要 3 个 Tang 服务器中的任意 2 个可用即可解锁
```

            

### 9.4 FIDO2 密钥解锁

            

LUKS2 和 systemd 252+ 支持使用 FIDO2（Fast IDentity
            Online 2，快速在线身份验证 2）安全密钥（如
            YubiKey）解锁加密卷：
            
```
# 将 FIDO2 密钥注册到 LUKS2 卷
systemd-cryptenroll --fido2-device=auto /dev/sdb1

# 需要 FIDO2 密钥的物理触摸确认
systemd-cryptenroll --fido2-device=auto \
  --fido2-with-user-verification=yes \
  /dev/sdb1

# crypttab 配置
my_encrypted_vol  UUID=...  -  fido2-device=auto
```

            

### 9.5 密钥层次架构

            

在大规模部署中，推荐构建分层的密钥管理架构：
            
```
┌─────────────────────────────────────────────────┐
│ 根密钥（Root Key）                               │
│ 存储位置：HSM / 离线冷存储                       │
│ 用途：加密/解密主密钥                             │
├─────────────────────────────────────────────────┤
│ 主密钥（Key Encryption Key，KEK）                │
│ 存储位置：密钥管理服务器（Vault/KMS）             │
│ 用途：加密/解密数据加密密钥                       │
├─────────────────────────────────────────────────┤
│ 数据加密密钥（Data Encryption Key，DEK）         │
│ 存储位置：LUKS 头部（被 KEK 加密）               │
│ 用途：加密/解密实际数据                           │
└─────────────────────────────────────────────────┘
```

            
            

## 十、LUKS 与 LVM/RAID
            集成

            

### 10.1 LUKS on LVM vs LVM
            on LUKS

            

LUKS 与 LVM（Logical Volume
            Manager，逻辑卷管理器）的集成有两种拓扑：
            

**方案一：LVM on LUKS（推荐）**
            
```
┌──────────────────────────────────────┐
│            文件系统                   │
│         (ext4 / XFS)                │
├──────────────────────────────────────┤
│            LVM 逻辑卷               │
│    (root-lv / home-lv / swap-lv)    │
├──────────────────────────────────────┤
│            LVM 卷组                  │
│          (system-vg)                │
├──────────────────────────────────────┤
│          LUKS 加密层                 │
│       (/dev/mapper/crypt)           │
├──────────────────────────────────────┤
│          物理分区                    │
│         (/dev/sda2)                 │
└──────────────────────────────────────┘
```

            

优势： - 只需要一个密码/密钥解锁整个系统 -
            所有逻辑卷共享一个加密层，管理简单 - 交换分区也自动加密 -
            大多数 Linux 发行版安装器的默认选择
            

实施步骤：
            
```
# 1. 创建分区（假设 /dev/sda2 用于加密）
# 2. 创建 LUKS 加密层
cryptsetup luksFormat /dev/sda2
cryptsetup luksOpen /dev/sda2 crypt

# 3. 在解密设备上创建 LVM
pvcreate /dev/mapper/crypt
vgcreate system-vg /dev/mapper/crypt
lvcreate -L 50G -n root-lv system-vg
lvcreate -L 100G -n home-lv system-vg
lvcreate -L 16G -n swap-lv system-vg

# 4. 创建文件系统
mkfs.ext4 /dev/system-vg/root-lv
mkfs.ext4 /dev/system-vg/home-lv
mkswap /dev/system-vg/swap-lv
```

            

**方案二：LUKS on LVM**
            
```
┌──────────────────────────────────────┐
│            文件系统                   │
├──────────────────────────────────────┤
│          LUKS 加密层                 │
│  (/dev/mapper/crypt-root)           │
│  (/dev/mapper/crypt-home)           │
├──────────────────────────────────────┤
│           LVM 逻辑卷                │
│    (root-lv / home-lv)              │
├──────────────────────────────────────┤
│           LVM 卷组                   │
├──────────────────────────────────────┤
│           物理卷                     │
│         (/dev/sda2)                 │
└──────────────────────────────────────┘
```

            

优势： -
            不同逻辑卷可以使用不同密钥，实现更细粒度的访问控制 -
            不同卷可以由不同用户或角色解锁 -
            某些卷可以不加密（如非敏感数据）
            

劣势： - 需要管理多个密码/密钥 - LVM 元数据未加密 -
            配置和管理更复杂
            
```
# LUKS on LVM 实施步骤
# 1. 创建 LVM
pvcreate /dev/sda2
vgcreate data-vg /dev/sda2
lvcreate -L 100G -n secure-lv data-vg
lvcreate -L 200G -n public-lv data-vg

# 2. 只对敏感数据卷加密
cryptsetup luksFormat /dev/data-vg/secure-lv
cryptsetup luksOpen /dev/data-vg/secure-lv crypt-secure

# 3. 创建文件系统
mkfs.ext4 /dev/mapper/crypt-secure
mkfs.ext4 /dev/data-vg/public-lv  # 不加密
```

            

### 10.2 LUKS + mdadm RAID

            

LUKS 与软件 RAID（mdadm）的集成同样有两种拓扑：
            

**方案一：LUKS on
            RAID（推荐用于大多数场景）**
            
```
文件系统
    │
LUKS 加密层
    │
mdadm RAID（/dev/md0）
    │
┌───┴───┐
sda1   sdb1
```

            
```
# 1. 创建 RAID
mdadm --create /dev/md0 --level=1 --raid-devices=2 /dev/sda1 /dev/sdb1

# 2. 在 RAID 设备上创建 LUKS
cryptsetup luksFormat /dev/md0
cryptsetup luksOpen /dev/md0 crypt-raid

# 3. 创建文件系统
mkfs.ext4 /dev/mapper/crypt-raid
```

            

优势： - 只需管理一个 LUKS 卷和一个密钥 - RAID
            重建操作在加密层之下进行，对加密透明 - 性能更好——RAID
            层可以合并 IO 请求
            

**方案二：RAID on
            LUKS（每个磁盘独立加密）**
            
```
文件系统
    │
mdadm RAID（/dev/md0）
    │
┌───┴───────────┐
crypt-sda1   crypt-sdb1    ← 各自独立的 LUKS 层
    │            │
  sda1         sdb1
```

            
```
# 1. 分别加密每个磁盘
cryptsetup luksFormat /dev/sda1
cryptsetup luksFormat /dev/sdb1
cryptsetup luksOpen /dev/sda1 crypt-sda1
cryptsetup luksOpen /dev/sdb1 crypt-sdb1

# 2. 在解密设备上创建 RAID
mdadm --create /dev/md0 --level=1 --raid-devices=2 \
  /dev/mapper/crypt-sda1 /dev/mapper/crypt-sdb1

# 3. 创建文件系统
mkfs.ext4 /dev/md0
```

            

优势： - 每个磁盘独立加密——单个磁盘被盗时不需要担心 RAID
            元数据泄露 - 磁盘可以安全地单独退役
            

劣势： - 需要管理多个 LUKS 卷和密钥 - RAID
            重建操作需要先解密，增加了复杂性
            

### 10.3 启动分区加密

            

全盘加密的一个挑战是启动分区（`/boot`）的处理。传统上，`/boot`
            必须保持未加密状态，因为 GRUB（GRand Unified
            Bootloader，统一引导加载器）在早期启动阶段没有加密解密能力。
            

GRUB 2.06+ 支持直接从 LUKS2 加密分区引导：
            
```
# GRUB 支持的 LUKS2 配置（需要 GRUB 2.06+）
# 注意：GRUB 的 LUKS2 支持要求使用 PBKDF2（不支持 Argon2id）
cryptsetup luksFormat --type luks2 \
  --pbkdf pbkdf2 \
  /dev/sda2

# GRUB 配置（/etc/default/grub）
GRUB_ENABLE_CRYPTODISK=y
GRUB_CMDLINE_LINUX="rd.luks.uuid= rd.luks.options=discard"

# 重新生成 GRUB 配置
grub-mkconfig -o /boot/grub/grub.cfg

# 重新安装 GRUB
grub-install /dev/sda
```

            

对于加密的 `/boot` 分区，需要注意：
            
            
- GRUB 目前仅支持 LUKS2 + PBKDF2 的组合（不支持
            Argon2id），因为 GRUB 的加密实现不包含 Argon2 库
            
- 用户需要在 GRUB 阶段输入一次密码，然后在 initramfs
            阶段再次输入密码（除非配置了密钥文件传递）
            
- 可以通过在 initramfs
            中嵌入密钥文件来避免输入两次密码
            
            

### 10.4
            完整的加密系统搭建示例

            

以下是一个从零开始搭建全盘加密系统的完整示例，使用 LVM on
            LUKS 方案：
            
```
# === 分区方案 ===
# /dev/sda1: 1 GiB, EFI 系统分区（ESP），FAT32，不加密
# /dev/sda2: 剩余空间，LUKS2 加密，内含 LVM

# 1. 分区
parted /dev/sda -- mklabel gpt
parted /dev/sda -- mkpart ESP fat32 1MiB 1025MiB
parted /dev/sda -- set 1 esp on
parted /dev/sda -- mkpart primary 1025MiB 100%

# 2. 创建 EFI 分区
mkfs.fat -F32 /dev/sda1

# 3. 创建 LUKS2 加密卷
cryptsetup luksFormat --type luks2 \
  --cipher aes-xts-plain64 \
  --key-size 512 \
  --hash sha256 \
  --pbkdf argon2id \
  --pbkdf-memory 1048576 \
  --label "system-crypt" \
  /dev/sda2

# 4. 打开加密卷
cryptsetup luksOpen /dev/sda2 crypt

# 5. 创建 LVM
pvcreate /dev/mapper/crypt
vgcreate system-vg /dev/mapper/crypt
lvcreate -L 80G -n root-lv system-vg
lvcreate -L 200G -n home-lv system-vg
lvcreate -L 16G -n swap-lv system-vg

# 6. 创建文件系统
mkfs.ext4 -L root /dev/system-vg/root-lv
mkfs.ext4 -L home /dev/system-vg/home-lv
mkswap -L swap /dev/system-vg/swap-lv

# 7. 挂载并安装系统
mount /dev/system-vg/root-lv /mnt
mkdir -p /mnt/home /mnt/boot/efi
mount /dev/system-vg/home-lv /mnt/home
mount /dev/sda1 /mnt/boot/efi
swapon /dev/system-vg/swap-lv

# 8. 安装系统后，配置 /etc/crypttab
# crypt  UUID=  none  luks

# 9. 更新 initramfs
# Debian/Ubuntu: update-initramfs -u -k all
# RHEL/Fedora:   dracut -fv --regenerate-all
```

            

### 10.5 灾难恢复流程

            

当加密系统出现问题时的恢复步骤：
            
```
# 场景一：正常恢复（已知密码）
cryptsetup luksOpen /dev/sda2 crypt
vgchange -ay system-vg
mount /dev/system-vg/root-lv /mnt
# 进入 chroot 环境修复问题
mount --bind /dev /mnt/dev
mount --bind /proc /mnt/proc
mount --bind /sys /mnt/sys
chroot /mnt

# 场景二：从头部备份恢复
cryptsetup luksHeaderRestore /dev/sda2 \
  --header-backup-file /backup/luks-header.bin
cryptsetup luksOpen /dev/sda2 crypt

# 场景三：使用分离头部（Detached Header）
# 分离头部将 LUKS 头部存储在单独的设备上
# 即使攻击者拿到了加密磁盘，没有头部文件也无法尝试暴力破解
cryptsetup luksFormat --header /secure/header.img /dev/sda2
cryptsetup luksOpen --header /secure/header.img /dev/sda2 crypt
```

            
            

## 参考文献

            
            
- 

Fruhwirth, C. (2005). “New Methods in Hard Disk
            Encryption.” Institute for Computer Languages, Theory and
            Logic Group, Vienna University of Technology. https://clemens.endorphin.org/nmihde/nmihde-A4-ds.pdf
            
- 

LUKS1 On-Disk Format Specification, Version 1.2.3. https://gitlab.com/cryptsetup/cryptsetup/-/wikis/LUKS-standard/on-disk-format.pdf
            
- 

LUKS2 On-Disk Format Specification. https://gitlab.com/cryptsetup/LUKS2-docs
            
- 

Biryukov, A., Dinu, D., & Khovratovich, D.
            (2016). “Argon2: the memory-hard function for password
            hashing and other applications.” RFC 9106. https://www.rfc-editor.org/rfc/rfc9106
            
- 

Meijer, C., & van Gastel, B. (2018).
            “Self-encrypting deception: weaknesses in the encryption of
            solid state drives.” Radboud University. https://www.ru.nl/publish/pages/909282/draft-paper.pdf
            
- 

IEEE Std 1619-2018. “IEEE Standard for Cryptographic
            Protection of Data on Block-Oriented Storage Devices.” https://standards.ieee.org/standard/1619-2018.html
            
- 

cryptsetup 官方文档与 FAQ：https://gitlab.com/cryptsetup/cryptsetup/-/wikis/FrequentlyAskedQuestions
            
- 

Red Hat Enterprise Linux 安全指南——LUKS 磁盘加密：https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/security_hardening/encrypting-block-devices-using-luks_security-hardening
            
- 

Crowley, P., & Biggers, E. (2018). “Adiantum:
            length-preserving encryption for entry-level processors.”
            Google. [https://eprint.iacr.org/2018/720.pdf](https://eprint.iacr.org/2018/720.pdf)
            
- 

TCG Storage Architecture Core Specification, Version
            2.01. Trusted Computing Group. https://trustedcomputinggroup.org/resource/tcg-storage-architecture-core-specification/
            
- 

Tang/Clevis 项目文档：https://github.com/latchset/tang 和 https://github.com/latchset/clevis
            
- 

Linux Kernel 文档——dm-crypt：https://docs.kernel.org/admin-guide/device-mapper/dm-crypt.html
            
- 

Kaliski, B. (2000). “PKCS #5: Password-Based
            Cryptography Specification Version 2.0.” RFC 8018. https://www.rfc-editor.org/rfc/rfc8018
            
- 

NIST SP 800-111. “Guide to Storage Encryption
            Technologies for End User Devices.” https://csrc.nist.gov/publications/detail/sp/800-111/final
            
            
            

**上一篇**: Device
            Mapper：Linux 存储虚拟化层 **下一篇**: 存储快照与精简配置
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-09-23 · storage
                    

### 【存储工程】存储加密工程

                    

全面剖析静态数据加密的工程实践——块级加密、文件级加密与应用级加密的架构对比，AES-XTS/AES-GCM 选型，密钥层次与轮转，硬件加速性能分析
                

                
                    

2025-08-30 · storage
                    

### 【存储工程】Device Mapper：Linux 存储虚拟化层

                    

拆解 Linux Device Mapper 框架的内核架构、映射表机制与七种核心 target driver，从 dm-linear 到 dm-verity，覆盖 dmsetup 实战和容器存储应用。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。