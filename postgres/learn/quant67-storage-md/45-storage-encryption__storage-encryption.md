# 【存储工程】存储加密工程

来源: https://quant67.com/post/storage/45-storage-encryption/storage-encryption.html
日期: 2025-09-23 |

---

一块磁盘从服务器上拔下来，接到另一台机器上就能直接读取全部数据。一块
            SSD
            退役送去销毁，中途被截获，上面的用户数据一览无余。一台云主机的底层宿主机被攻破，租户的虚拟磁盘镜像文件直接暴露。这些场景有一个共同点：数据在存储介质上以明文形式存在，物理访问等于逻辑访问。
            

静态数据加密（Data-at-Rest
            Encryption）就是为了切断这条路径——即使攻击者拿到了存储介质的物理访问权限，没有密钥也无法读取数据内容。这个需求听起来直白，但工程实现上要回答的问题远不止”用
            AES
            加密一下”这么简单：加密应该在哪一层做？用什么模式？密钥放在哪里？轮转怎么做？对性能的影响有多大？
            

本文从威胁模型和合规要求出发，依次拆解块级加密（Block-Level
            Encryption）、文件级加密（File-Level
            Encryption）和应用级加密（Application-Level
            Encryption）三种架构，分析各自的加密算法选型，深入讨论密钥管理与轮转的工程设计，最后用性能实测数据回答”加密到底慢多少”这个关键问题。代码和命令基于
            Linux 6.x 内核、cryptsetup 2.7.x、fscrypt
            0.3.x，数据库部分基于 MySQL 8.0 和 PostgreSQL 16。
            
            

## 一、静态数据加密的工程动机

            

### 合规要求：不是可选项

            

静态数据加密在许多行业已经从”最佳实践”变成了硬性合规要求：
            
            
- **PCI DSS
            4.0**（支付卡行业数据安全标准）：要求 3.5.1
            明确规定，存储的主账号（PAN）必须通过加密等方式使其不可读。
            
- **GDPR**（通用数据保护条例）：第 32
            条要求采取”适当的技术和组织措施”来保护个人数据，加密被明确列为手段之一。
            
- **HIPAA**（健康保险流通与责任法案）：安全规则
            164.312(a)(2)(iv)
            要求对电子受保护健康信息（ePHI）实施加密。
            
- **等保
            2.0**（中国网络安全等级保护）：三级及以上系统要求对存储的重要数据进行加密保护。
            
            

这些合规要求的共同特点是：它们不关心你用什么算法、在哪一层实现，但要求你能证明数据在存储介质上不是明文。审计时需要提供的证据包括：加密方案文档、密钥管理策略、轮转记录和访问日志。
            

### 威胁模型：加密到底防什么

            

静态数据加密的防护边界需要明确。它能防护的威胁：
            
            
            
            威胁场景
            加密是否有效
            说明
            
            
            
            
            磁盘被盗或丢失
            有效
            攻击者无法读取介质上的密文
            
            
            退役硬件数据残留
            有效
            即使数据未擦除，没有密钥也无法解读
            
            
            快照/备份泄露
            有效
            加密后的快照/备份同样是密文
            
            
            多租户隔离失效
            有效
            宿主机层面的越权访问拿到的是密文
            
            
            操作系统被入侵后的内存读取
            无效
            密钥在内存中，攻击者可以提取
            
            
            应用层 SQL 注入
            无效
            应用通过正常路径读数据，加密层已经解密
            
            
            特权管理员滥用
            部分有效
            取决于密钥管理架构是否与管理员权限分离
            
            
            
            

关键认知：静态数据加密保护的是”数据脱离系统控制后”的安全性，不保护运行时（Runtime）的数据访问。如果攻击者已经拿到了操作系统的
            root 权限，静态加密基本失效，因为密钥通常在内核内存中。
            

### 加密粒度的选择

            

在决定加密方案之前，还需要回答一个关键问题：加密的粒度是什么？
            
            
- **全盘加密**（Full Disk Encryption,
            FDE）：整个块设备都被加密，包括文件系统元数据。
            
- **分区加密**：只加密特定分区，例如只加密
            `/data` 分区而不加密 `/boot`。
            
- **文件级加密**：只加密特定目录或文件，同一个文件系统内可以同时存在加密和未加密的文件。
            
- **字段级加密**：在应用层只加密数据库表中的特定列。
            
            

粒度越细，灵活性越高，但管理复杂度也越高。下一节从架构层面展开这个选择。
            
            

## 二、加密层次架构

            

存储加密可以在存储栈的不同层实现，每一层的定位和特性不同。下面这张图展示了三种主要加密层次在
            Linux 存储栈中的位置：
            
```
加密层次在存储栈中的位置

┌─────────────────────────────────────────────────────────────────┐
│                         应用层                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  应用级加密（Application-Level Encryption）                │  │
│  │  MySQL TDE / PostgreSQL TDE / 应用自行加密                │  │
│  │  加密对象：表空间、列、字段                                │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                       文件系统层                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  文件级加密（File-Level Encryption）                       │  │
│  │  fscrypt（ext4/f2fs）/ eCryptfs                           │  │
│  │  加密对象：文件内容 + 文件名                               │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                       块设备层                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  块级加密（Block-Level Encryption）                        │  │
│  │  dm-crypt / LUKS                                          │  │
│  │  加密对象：整个块设备的所有扇区                             │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                    物理存储设备                                   │
│  HDD / SSD / NVMe                                               │
│  （部分设备支持自加密驱动器 SED）                                 │
└─────────────────────────────────────────────────────────────────┘
```

            

### 三种层次的对比

            
            
            
            
            
            
            
            
            
            维度
            块级加密
            文件级加密
            应用级加密
            
            
            
            
            加密粒度
            整个块设备
            单个文件/目录
            表空间/列/字段
            
            
            对文件系统的影响
            无（文件系统不感知加密）
            深度集成或堆叠
            无（数据库内部处理）
            
            
            多用户/多密钥
            通常一个设备一把密钥
            每个目录可以不同密钥
            每个表空间可以不同密钥
            
            
            元数据保护
            全部加密（包括文件系统元数据）
            文件内容和文件名加密，目录结构可见
            只加密数据页，索引结构通常明文
            
            
            性能开销
            最低（内核态批量处理）
            中等
            较高（应用层加解密）
            
            
            备份兼容性
            备份密文，恢复需要密钥
            可以选择性备份加密或明文
            备份工具需要数据库配合
            
            
            典型实现
            dm-crypt/LUKS, BitLocker
            fscrypt, eCryptfs
            MySQL TDE, PostgreSQL TDE
            
            
            适用场景
            服务器全盘保护、云盘加密
            多租户共享存储、移动设备
            数据库合规、细粒度访问控制
            
            
            
            

选择哪一层取决于威胁模型和运维约束。块级加密最简单、最透明，适合”只要磁盘不被偷就行”的场景；文件级加密适合需要为不同用户或目录使用不同密钥的场景；应用级加密最灵活，但侵入性也最强。实际生产中，这三层可以组合使用——例如底层用
            LUKS 做全盘加密，数据库层再用 TDE 加密敏感表空间。
            
            

## 三、块级加密：dm-crypt
            与 LUKS

            

### dm-crypt 的内核架构

            

dm-crypt 是 Linux 内核的设备映射（Device
            Mapper）框架的一个目标（Target）。它在块设备层工作，把一个加密的块设备映射为一个明文的虚拟块设备。上层文件系统和应用对加密完全无感知。
            

dm-crypt 的数据路径如下：
            
            
- 应用发起写请求，数据通过文件系统到达块设备层。
            
- dm-crypt 拦截 I/O 请求，对数据进行加密。
            
- 加密后的数据写入底层物理设备。
            
- 读取时反向操作：从物理设备读取密文，dm-crypt
            解密后返回给上层。
            
            

内核中的关键数据结构是
            `struct crypt_config`（Linux
            6.x，`drivers/md/dm-crypt.c`），它保存了加密算法、密钥、初始向量（IV）生成方式等配置。dm-crypt
            使用内核加密 API（Crypto
            API）来调用具体的加密算法实现，这意味着它可以自动利用 AES-NI
            等硬件加速。
            

### LUKS 格式

            

LUKS（Linux Unified Key Setup）是 dm-crypt
            之上的一个标准化密钥管理格式。裸用 dm-crypt
            需要用户自己管理密钥，而 LUKS
            定义了一个标准的磁盘头部格式来存储加密元数据和密钥槽（Key
            Slot）。
            

LUKS2 头部结构（cryptsetup 2.x）：
            
```
LUKS2 磁盘布局

偏移量          内容
──────────────────────────────────────────
0x0000          主头部（Primary Header）
                ├── 魔数：LUKS\xba\xbe
                ├── 版本：0x0002
                ├── 头部大小
                ├── JSON 元数据区域
                │   ├── 加密算法和模式
                │   ├── 密钥槽配置（最多 32 个）
                │   └── 段描述（加密区域范围）
                └── 校验和
──────────────────────────────────────────
头部备份        二进制密钥材料区域
                ├── Keyslot 0 的密钥材料
                ├── Keyslot 1 的密钥材料
                └── ...
──────────────────────────────────────────
数据区域        加密后的用户数据
                （按扇区加密，每个扇区 512B 或 4096B）
──────────────────────────────────────────
```

            

LUKS2 相比 LUKS1 的改进：
            
            
- 元数据区域从固定二进制格式改为 JSON
            格式，可扩展性更好。
            
- 支持 Argon2id 作为密钥派生函数（Key Derivation Function,
            KDF），替代 PBKDF2，抗 GPU/ASIC 暴力破解能力更强。
            
- 支持数据完整性保护（配合
            dm-integrity），可以检测密文被篡改。
            
- 支持在线重加密（Online
            Re-encryption），可以在不卸载文件系统的情况下更换加密算法或密钥。
            
            

### 实战：使用 LUKS2
            加密一个块设备

            

以下演示在一个空块设备上创建 LUKS2 加密卷并挂载使用。
            
```
# 环境：Linux 6.x, cryptsetup 2.7.x
# 警告：以下操作会销毁目标设备上的所有数据

# 1. 创建 LUKS2 加密卷
# 使用 AES-XTS 模式，256 位密钥（实际使用 512 位，因为 XTS 需要两把子密钥）
# KDF 使用 Argon2id
sudo cryptsetup luksFormat --type luks2 \
    --cipher aes-xts-plain64 \
    --key-size 512 \
    --hash sha256 \
    --pbkdf argon2id \
    --pbkdf-memory 1048576 \
    --pbkdf-parallel 4 \
    --pbkdf-force-iterations 4 \
    /dev/sdb

# 2. 打开加密卷，创建明文映射设备
sudo cryptsetup open /dev/sdb encrypted_data

# 此时 /dev/mapper/encrypted_data 就是明文块设备
# 3. 在明文设备上创建文件系统
sudo mkfs.ext4 /dev/mapper/encrypted_data

# 4. 挂载使用
sudo mount /dev/mapper/encrypted_data /mnt/secure

# 5. 查看加密状态
sudo cryptsetup status encrypted_data
```

            

输出类似：
            
```
/dev/mapper/encrypted_data is active and is in use.
  type:    LUKS2
  cipher:  aes-xts-plain64
  keysize: 512 bits
  key location: keyring
  device:  /dev/sdb
  sector size:  512
  offset:  32768 sectors
  size:    209682432 sectors
  mode:    read/write
```

            

### LUKS 密钥槽管理

            

LUKS 支持最多 32
            个密钥槽（LUKS2），每个槽可以存储一个独立的口令（Passphrase）或密钥文件，它们都能解锁同一个主密钥（Master
            Key）。这个设计允许：
            
            
- 多个管理员使用不同口令访问同一个加密卷。
            
- 在不重新加密数据的情况下更换口令。
            
- 使用密钥文件实现无人值守解锁（例如服务器启动时自动解锁）。
            
            
```
# 添加一个新的密钥槽（需要提供现有口令来验证）
sudo cryptsetup luksAddKey /dev/sdb

# 删除指定槽位
sudo cryptsetup luksKillSlot /dev/sdb 1

# 查看密钥槽状态
sudo cryptsetup luksDump /dev/sdb
```

            

`luksDump` 输出的 JSON
            元数据中可以看到每个密钥槽的 KDF 参数：
            
```
{
  "keyslots": {
    "0": {
      "type": "luks2",
      "key_size": 64,
      "kdf": {
        "type": "argon2id",
        "time": 4,
        "memory": 1048576,
        "cpus": 4
      },
      "af": {
        "type": "luks1",
        "stripes": 4000
      }
    }
  }
}
```

            

### dm-crypt 的 IV
            生成模式

            

块级加密需要为每个扇区生成不同的初始向量（Initialization
            Vector,
            IV），否则相同的明文扇区会产生相同的密文，泄露数据模式。dm-crypt
            支持多种 IV 生成器：
            
            
            
            
            
            
            
            
            
            IV 模式
            原理
            安全性
            适用场景
            
            
            
            
            `plain`
            IV = 扇区号的低 32 位
            低（扇区号超过 2^32 后 IV 重复）
            不推荐
            
            
            `plain64`
            IV = 扇区号的完整 64 位
            中（满足大多数场景）
            默认推荐
            
            
            `essiv`
            IV = E(sector_number, hash(key))
            高（隐藏扇区号与 IV 的关系）
            需要额外防护水印攻击时
            
            
            `benbi`
            IV = 大端序扇区号右移
            中
            兼容某些硬件
            
            
            
            

`plain64` 是目前的默认选择。`essiv`
            提供更强的安全性，但在使用 AES-XTS 模式时不必要，因为 XTS
            本身已经将扇区号融入加密过程。
            

### 扇区大小的影响

            

传统上 dm-crypt 使用 512 字节扇区大小。现代 NVMe
            设备通常使用 4096 字节（4K）物理扇区。cryptsetup 2.x
            支持通过 `--sector-size`
            参数设置加密扇区大小：
            
```
sudo cryptsetup luksFormat --type luks2 \
    --cipher aes-xts-plain64 \
    --key-size 512 \
    --sector-size 4096 \
    /dev/nvme0n1p3
```

            

使用 4K 扇区大小的好处：
            
            
- 与底层设备的物理扇区对齐，避免读-改-写（Read-Modify-Write）放大。
            
- 减少加密操作的次数（同样的数据量，4K 扇区比 512B 扇区少
            8 倍加密调用）。
            
- 在 AES-XTS 模式下，更大的扇区提供更好的扩散性。
            
            

但也有限制：4K 扇区要求上层文件系统的最小 I/O 单元不小于
            4K，这在 ext4 默认配置下是满足的。
            
            

## 四、文件级加密：fscrypt
            与 eCryptfs

            

### 为什么需要文件级加密

            

块级加密对整个设备”一刀切”——要么全加密，要么不加密。在以下场景中，文件级加密更合适：
            
            
- **多用户系统**：不同用户的文件用不同密钥加密，一个用户的密钥泄露不影响其他用户。
            
- **选择性加密**：只加密敏感目录（如
            `/home/user/documents`），性能敏感的目录（如
            `/var/log`）保持明文。
            
- **云存储**：在共享的文件系统上为不同租户提供密钥隔离。
            
- **移动设备**：Android 从 7.0
            开始使用文件级加密（File-Based Encryption,
            FBE），不同的保护级别（锁屏前/后）对应不同的密钥。
            
            

### fscrypt 的架构

            

fscrypt 是 Linux 内核原生的文件级加密框架（Linux 4.1+
            引入，5.4+
            版本趋于成熟）。它直接集成在文件系统代码中（目前支持
            ext4、f2fs 和
            UBIFS），在文件系统写入磁盘前加密数据，读取时解密。
            

fscrypt 的核心设计：
            
            
- **加密策略（Encryption
            Policy）**：绑定到目录上，该目录下的所有新建文件自动继承加密策略。
            
- **双层加密**：文件内容用 AES-256-XTS
            加密，文件名用 AES-256-CTS-CBC（密文挪用，Ciphertext
            Stealing）或 AES-256-HCTR2 加密。
            
- **密钥层次**：用户提供的口令/密钥经过 KDF
            派生出每个文件的唯一密钥（Per-File Key）。
            
            

fscrypt 的密钥派生流程：
            
```
fscrypt 密钥派生

用户口令
    │
    ▼
┌────────────────────┐
│  HKDF-SHA512       │  从主密钥派生出 per-file key
│  salt: 文件 nonce  │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  Per-File Key      │  每个文件的加密密钥不同
│  256 bits          │
└────────┬───────────┘
         │
    ┌────┴────┐
    ▼         ▼
 文件内容   文件名
 AES-XTS   AES-CTS
```

            

### fscrypt 实战

            
```
# 环境：Linux 6.x, fscrypt 0.3.x, ext4 文件系统
# 前提：文件系统在挂载时启用了 encrypt 特性

# 1. 检查文件系统是否支持加密
sudo tune2fs -l /dev/sda2 | grep -i encrypt
# 输出应包含：Filesystem features: ... encrypt ...

# 如果不支持，启用加密特性（需要卸载）
sudo tune2fs -O encrypt /dev/sda2

# 2. 初始化 fscrypt 元数据
sudo fscrypt setup /
sudo fscrypt setup /mnt/data

# 3. 创建加密目录
mkdir /mnt/data/secrets
fscrypt encrypt /mnt/data/secrets
# 交互式选择保护方式：login passphrase / custom passphrase / raw key

# 4. 验证加密状态
fscrypt status /mnt/data/secrets
```

            

加密后的效果：
            
```
# 已解锁状态：正常读写
echo "sensitive data" > /mnt/data/secrets/test.txt
cat /mnt/data/secrets/test.txt
# 输出：sensitive data

# 锁定目录
fscrypt lock /mnt/data/secrets

# 锁定后：文件名变成加密哈希，内容不可读
ls /mnt/data/secrets/
# 输出类似：,Dv9SPBqdMCEXmGn0yF0tKg
cat /mnt/data/secrets/,Dv9SPBqdMCEXmGn0yF0tKg
# 输出：乱码（密文）

# 重新解锁
fscrypt unlock /mnt/data/secrets
```

            

### fscrypt v2 策略

            

fscrypt v1 策略为每个文件从主密钥直接派生 per-file
            key，存在一个问题：非特权用户可以添加任意密钥到内核密钥环（Keyring），可能导致密钥混淆攻击。
            

fscrypt v2 策略（Linux 5.4+）的改进：
            
            
- 密钥通过 `FS_IOC_ADD_ENCRYPTION_KEY` ioctl
            添加到文件系统级别的密钥环，而非进程级别的密钥环。
            
- 引入密钥标识符（Key Identifier），使用 HKDF-SHA512
            从主密钥派生。
            
- 支持 DIRECT_KEY
            模式：所有文件共享同一个密钥，但每个文件使用不同的
            IV（基于文件 nonce）。这对硬件内联加密引擎（Inline
            Encryption
            Engine）非常重要，因为硬件通常只支持有限数量的密钥槽。
            
            
```
# 使用 v2 策略创建加密目录
fscrypt encrypt --policy-version=2 /mnt/data/secrets
```

            

### eCryptfs：堆叠式文件级加密

            

eCryptfs 是另一种 Linux
            文件级加密方案，它以堆叠文件系统（Stacked
            Filesystem）的方式实现：eCryptfs
            挂载在一个底层文件系统之上，对写入的文件进行加密后存储到底层文件系统，读取时解密。
            

eCryptfs 与 fscrypt 的对比：
            
            
            
            维度
            fscrypt
            eCryptfs
            
            
            
            
            实现方式
            内联在文件系统代码中
            堆叠文件系统
            
            
            支持的底层文件系统
            ext4, f2fs, UBIFS
            任意（堆叠在上层）
            
            
            性能
            更好（少一层间接调用）
            较差（双层文件系统开销）
            
            
            元数据存储
            文件系统扩展属性
            文件头部
            
            
            内核维护状态
            积极维护
            功能冻结（Linux 6.x 中已标记为候选移除）
            
            
            Android 使用
            是（FBE 方案）
            否（已废弃）
            
            
            
            

当前的工程建议：新项目使用 fscrypt，不要使用
            eCryptfs。eCryptfs 已不再接受新特性，内核社区的长期方向是
            fscrypt。Ubuntu 从 21.04 开始也将主目录加密方案从 eCryptfs
            切换到了 fscrypt。
            
            

## 五、应用级加密：透明数据加密

            

### TDE 的基本原理

            

透明数据加密（Transparent Data Encryption,
            TDE）在数据库引擎内部实现，对应用程序透明——应用通过 SQL
            正常读写数据，加解密由数据库引擎在数据页（Data
            Page）写入磁盘和从磁盘读取时自动完成。
            

TDE 的”透明”体现在：
            
            
- 不需要修改应用代码。
            
- 不需要修改 SQL 语句。
            
- 索引、约束、存储过程正常工作。
            
- 备份文件自动包含密文。
            
            

但 TDE 不加密的内容包括：
            
            
- 传输中的数据（这是 TLS 的职责）。
            
- 内存中的数据（数据在缓冲池/Buffer Pool 中是明文）。
            
- 重做日志（Redo Log）和二进制日志（Binary Log）——MySQL
            8.0 支持加密 redo log 和 binlog，但需要单独配置。
            
- 临时表空间——MySQL 8.0.16+ 支持加密临时表空间。
            
            

### MySQL 8.0 TDE 实战

            

MySQL 8.0 的 TDE 架构使用两层密钥：
            
            
- **主密钥（Master
            Key）**：存储在外部密钥管理服务（Keyring
            Plugin）中，用于加密表空间密钥。
            
- **表空间密钥（Tablespace
            Key）**：每个加密表空间有一把独立的密钥，存储在表空间的头部（用主密钥加密后存储）。
            
            
```
MySQL TDE 密钥层次

┌──────────────────────────────────┐
│  外部密钥存储                      │
│  （keyring_file / keyring_vault） │
│  ┌────────────────────────────┐  │
│  │  Master Key（主密钥）       │  │
│  └──────────┬─────────────────┘  │
└─────────────┼────────────────────┘
              │ 加密/解密
              ▼
┌──────────────────────────────────┐
│  表空间头部                        │
│  ┌────────────────────────────┐  │
│  │  Tablespace Key（密文）     │  │
│  └──────────┬─────────────────┘  │
└─────────────┼────────────────────┘
              │ 加密/解密
              ▼
┌──────────────────────────────────┐
│  数据页                            │
│  ┌────────────────┐              │
│  │  Page 0 (密文)  │  16KB       │
│  │  Page 1 (密文)  │  16KB       │
│  │  ...            │             │
│  └────────────────┘              │
└──────────────────────────────────┘
```

            

配置步骤：
            
```
# my.cnf
[mysqld]
# 使用文件密钥环（生产环境应使用 HashiCorp Vault 等外部 KMS）
early-plugin-load=keyring_file.so
keyring_file_data=/var/lib/mysql-keyring/keyring

# 加密 InnoDB redo log
innodb_redo_log_encrypt=ON

# 加密二进制日志
binlog_encryption=ON

# 加密 undo log
innodb_undo_log_encrypt=ON
```

            
```
-- 创建加密表空间
CREATE TABLESPACE ts_encrypted
    ADD DATAFILE 'ts_encrypted.ibd'
    ENCRYPTION='Y';

-- 在加密表空间中创建表
CREATE TABLE sensitive_data (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    ssn VARCHAR(20)
) TABLESPACE ts_encrypted ENCRYPTION='Y';

-- 对已有表启用加密
ALTER TABLE existing_table ENCRYPTION='Y';

-- 查看加密状态
SELECT TABLE_SCHEMA, TABLE_NAME, CREATE_OPTIONS
FROM INFORMATION_SCHEMA.TABLES
WHERE CREATE_OPTIONS LIKE '%ENCRYPTION%';

-- 轮转主密钥（不需要重新加密数据页，只重新加密表空间密钥）
ALTER INSTANCE ROTATE INNODB MASTER KEY;
```

            

### PostgreSQL TDE

            

PostgreSQL 的 TDE 历史比较曲折。社区版本长期缺乏原生 TDE
            支持，直到 PostgreSQL 16 引入了集簇级加密（Cluster-Level
            Encryption）的基础设施。具体情况：
            
            
- **社区版 PostgreSQL
            16+**：支持透明数据加密，通过 `initdb`
            时的 `--cluster-key-command`
            参数指定密钥获取命令。
            
- **第三方方案**：Percona 的
            `pg_tde` 扩展提供表级粒度的 TDE。
            
            

PostgreSQL TDE 的配置（以 pg_tde 扩展为例）：
            
```
-- 安装扩展
CREATE EXTENSION pg_tde;

-- 配置密钥提供者（可以是文件、Vault 等）
SELECT pg_tde_add_key_provider_file(
    'local_file',
    '/etc/postgresql/tde_keyfile'
);

-- 设置主密钥
SELECT pg_tde_set_principal_key(
    'my_principal_key',
    'local_file'
);

-- 创建加密表（使用 tde_heap 访问方法）
CREATE TABLE classified_info (
    id SERIAL PRIMARY KEY,
    content TEXT
) USING tde_heap;
```

            

### 列级加密：pgcrypto

            

对于不需要整个表空间加密，而只需要加密特定列的场景，PostgreSQL
            的 `pgcrypto` 扩展提供了字段级加密函数：
            
```
-- 安装 pgcrypto
CREATE EXTENSION pgcrypto;

-- 使用 AES-256-CBC 加密敏感字段
INSERT INTO users (name, encrypted_ssn)
VALUES (
    'Zhang San',
    pgp_sym_encrypt('310-12-3456', 'my_secret_key', 'cipher-algo=aes256')
);

-- 解密读取
SELECT name, pgp_sym_decrypt(encrypted_ssn, 'my_secret_key') AS ssn
FROM users;
```

            

列级加密的优势是粒度最细，但代价也明显：加密列无法建索引（因为索引存储的是密文），范围查询和模糊查询无法在密文上执行。如果查询模式需要对加密列做搜索，需要引入确定性加密（Deterministic
            Encryption）或同态加密（Homomorphic
            Encryption）等更复杂的技术，但这些方案目前在性能上仍不实用。
            
            

## 六、加密算法选型

            

### AES-XTS：磁盘加密的事实标准

            

AES-XTS（XEX-based Tweaked-codebook mode with ciphertext
            Stealing）是 IEEE P1619
            标准定义的磁盘加密模式。它是目前块级加密和文件级加密的默认选择。
            

AES-XTS 的工作原理：
            
            
- 将扇区号（Sector Number）作为可调参数（Tweak），经过 AES
            加密生成 Tweak 值。
            
- 将明文分成 128 位（16 字节）的块。
            
- 每个块先与 Tweak 异或，然后 AES 加密，再与 Tweak
            异或。
            
- Tweak 值在每个块之间通过 GF(2^128) 上的乘法更新。
            
            
```
AES-XTS 加密一个扇区

Sector Number ──▶ AES(Key2) ──▶ T (初始 Tweak)
                                  │
                                  ▼
Block 0:  P0 ⊕ T ──▶ AES(Key1) ──▶ ⊕ T ──▶ C0
                                  │
                                  ▼ T = T * α (GF 乘法)
Block 1:  P1 ⊕ T ──▶ AES(Key1) ──▶ ⊕ T ──▶ C1
                                  │
                                  ▼ T = T * α
Block 2:  P2 ⊕ T ──▶ AES(Key1) ──▶ ⊕ T ──▶ C2
                                  ...
```

            

AES-XTS 的关键特性：
            
            
- **不提供认证**：XTS
            是一种非认证加密模式，它不能检测密文是否被篡改。这在磁盘加密场景下是可接受的，因为磁盘扇区的随机篡改通常只会导致解密后的数据损坏，而不会泄露信息。
            
- **需要两把子密钥**：一把用于数据加密（Key1），一把用于
            Tweak 加密（Key2）。所以 AES-256-XTS 实际需要 512
            位密钥。
            
- **扇区内扩散**：同一扇区内的明文变化会影响整个扇区的密文（通过
            Tweak 链），但不同扇区之间没有扩散。
            
- **窄块问题**：XTS 的安全性在处理 16
            字节或更小的数据单元时较弱。NIST SP 800-38E
            建议数据单元不小于 128 位。
            
            

### AES-GCM：认证加密

            

AES-GCM（Galois/Counter
            Mode）是一种认证加密模式（Authenticated Encryption with
            Associated Data, AEAD），同时提供机密性和完整性保护。
            

AES-GCM 在磁盘加密中的优势和限制：
            
            
- **优势**：提供完整性标签（Authentication
            Tag），可以检测密文被篡改。
            
- **限制 1**：GCM 要求每个
            IV（Nonce）只能使用一次。如果同一个密钥下的 IV
            重复，安全性完全崩溃。在磁盘加密场景中，同一个扇区会被反复覆写，如何为每次写入生成唯一
            IV 是个工程难题。
            
- **限制
            2**：认证标签需要额外存储空间。每个扇区需要额外 16
            字节来存储标签，这意味着加密后的数据量比明文大。磁盘是按扇区寻址的，这个膨胀需要额外的元数据区域来存放。
            
- **限制
            3**：随机写入性能受影响，每次写入都需要更新认证标签。
            
            

dm-crypt 支持通过 dm-integrity 配合 AEAD 模式（包括
            AES-GCM）来实现认证加密：
            
```
# 使用认证加密模式（AES-GCM + dm-integrity）
# 注意：初始格式化较慢，因为需要初始化完整性元数据
sudo cryptsetup luksFormat --type luks2 \
    --cipher aes-gcm-random \
    --key-size 256 \
    --integrity aead \
    --sector-size 4096 \
    /dev/sdb
```

            

但在实际生产中，使用 AES-GCM
            做磁盘加密的部署并不多。主要原因是 IV
            管理复杂、性能开销大、以及对现有存储栈的侵入性强。
            

### ChaCha20-Poly1305

            

ChaCha20-Poly1305 是 Google 推广的一种 AEAD 方案，由
            ChaCha20 流密码和 Poly1305 消息认证码组合而成。
            

它在存储加密中的定位：
            
            
- **软件性能**：在没有 AES
            硬件加速（AES-NI）的设备上（例如旧款 ARM 处理器），ChaCha20
            的软件实现比 AES 快 3-5 倍。
            
- **Android 使用**：Android 引入了 Adiantum
            模式（基于 ChaCha20 和 AES），专门用于没有 AES
            指令集的低端设备。
            
- **服务器场景**：现代服务器 CPU 普遍支持
            AES-NI，此时 AES-XTS 的硬件加速性能远超 ChaCha20
            的软件实现。
            
            

### 算法选型总结

            
            
            
            
            
            
            
            
            
            
            
            算法模式
            认证
            IV/Nonce 管理
            密文膨胀
            硬件加速
            推荐场景
            
            
            
            
            AES-256-XTS
            否
            扇区号作为 Tweak，简单
            无
            AES-NI
            块级/文件级加密的默认选择
            
            
            AES-256-GCM
            是
            必须保证唯一，复杂
            16B/扇区
            AES-NI + CLMUL
            需要完整性保护时
            
            
            ChaCha20-Poly1305
            是
            必须保证唯一
            16B/扇区
            无（纯软件优势）
            无 AES-NI 的低端设备
            
            
            Adiantum
            否
            扇区号
            无
            无
            Android 低端设备
            
            
            AES-256-CBC-ESSIV
            否
            ESSIV 模式
            无
            AES-NI
            遗留系统兼容
            
            
            
            

工程判断：对于 x86 服务器上的存储加密，AES-256-XTS
            是默认选择。只有在需要检测密文篡改时才考虑 AES-GCM（配合
            dm-integrity），代价是性能下降和部署复杂度上升。ChaCha20
            系列在嵌入式和移动端有用武之地，在服务器端基本不考虑。
            
            

## 七、密钥层次与管理

            

### KEK/DEK 双层密钥架构

            

几乎所有成熟的存储加密方案都采用双层密钥架构：
            
            
- **数据加密密钥（Data Encryption Key,
            DEK）**：直接用于加密数据。每个加密单元（磁盘、分区、表空间、文件）有自己的
            DEK。
            
- **密钥加密密钥（Key Encryption Key,
            KEK）**：用于加密 DEK。KEK
            存储在安全的密钥管理系统中。
            
            

这种设计的核心好处是**密钥轮转不需要重新加密数据**。轮转
            KEK 时，只需要用新的 KEK 重新加密现有的
            DEK，数据本身不动。由于 DEK 通常只有 32-64 字节，重新加密
            DEK 的开销可以忽略。
            
```
双层密钥架构

┌───────────────────────────────────────────┐
│  密钥管理系统（Vault / KMS）               │
│                                           │
│  KEK（密钥加密密钥）                        │
│  ├── 版本 1: 0xAB12...（已轮转）           │
│  ├── 版本 2: 0xCD34...（当前）             │
│  └── 版本 3: （预生成，待启用）              │
│                                           │
│  KEK 的生命周期由 KMS 管理                  │
│  KEK 永远不离开 KMS 的内存                  │
└───────────────┬───────────────────────────┘
                │  用 KEK 加密/解密 DEK
                ▼
┌───────────────────────────────────────────┐
│  加密元数据（LUKS Header / 表空间头）        │
│                                           │
│  E(KEK, DEK) = 密文形式的 DEK              │
│  存储在加密卷头部或表空间头部                 │
└───────────────┬───────────────────────────┘
                │  用 DEK 加密/解密数据
                ▼
┌───────────────────────────────────────────┐
│  加密数据                                  │
│  E(DEK, Data) = 密文数据                   │
│  存储在磁盘扇区 / 数据页                     │
└───────────────────────────────────────────┘
```

            

### HashiCorp Vault 集成

            

HashiCorp Vault 是最常用的开源密钥管理系统之一。Vault 的
            Transit 密钥引擎（Transit Secrets
            Engine）提供”加密即服务”（Encryption as a
            Service），密钥永远不离开 Vault。
            

Vault Transit 与 LUKS 的集成方式：
            
```
# 1. 在 Vault 中创建加密密钥
vault secrets enable transit
vault write -f transit/keys/luks-kek type=aes256-gcm96

# 2. 生成 DEK（随机密钥材料）
DEK=$(head -c 64 /dev/urandom | base64)

# 3. 用 Vault 加密 DEK
ENCRYPTED_DEK=$(vault write -field=ciphertext \
    transit/encrypt/luks-kek \
    plaintext="$DEK")

# 4. 存储加密后的 DEK（安全存储，例如 etcd 或配置管理系统）
echo "$ENCRYPTED_DEK" > /etc/luks/encrypted-dek.txt

# 5. 解锁 LUKS 卷时，先从 Vault 解密 DEK
PLAIN_DEK=$(vault write -field=plaintext \
    transit/decrypt/luks-kek \
    ciphertext="$ENCRYPTED_DEK" | base64 -d)

# 6. 用解密后的 DEK 打开 LUKS 卷
echo -n "$PLAIN_DEK" | sudo cryptsetup open --key-file=- /dev/sdb encrypted_data
```

            

### 云 KMS 集成

            

主要云厂商都提供托管的密钥管理服务（Key Management
            Service, KMS）：
            
            
            
            云厂商
            KMS 服务
            与存储加密的集成
            
            
            
            
            AWS
            AWS KMS
            EBS 加密、RDS TDE、S3 SSE-KMS
            
            
            阿里云
            密钥管理服务 KMS
            云盘加密、RDS TDE、OSS 服务端加密
            
            
            GCP
            Cloud KMS
            Persistent Disk 加密、Cloud SQL
            
            
            Azure
            Azure Key Vault
            Managed Disk 加密、Azure SQL TDE
            
            
            
            

云 KMS 的优势是硬件安全模块（Hardware Security Module,
            HSM）托管、自动轮转和审计日志。但也引入了对云厂商的强依赖——KEK
            存储在云端，离开该云就无法解密数据。
            

### 密钥的安全存储要求

            

无论使用什么密钥管理方案，都需要满足以下工程要求：
            
            
- **密钥与密文分离**：KEK
            不能存储在被加密的同一个设备上，否则加密形同虚设。
            
- **最小权限**：只有需要解密数据的服务才能访问密钥。使用
            Vault/KMS 的策略（Policy）来限制密钥访问范围。
            
- **审计日志**：每次密钥的使用（加密、解密、轮转）都要记录日志，支持事后审计。
            
- **高可用**：密钥管理系统本身必须高可用，否则密钥不可用等于数据不可用。Vault
            建议至少 3 节点集群。
            
- **灾难恢复**：KEK
            的备份策略必须独立于加密数据的备份策略。建议使用 Shamir
            秘密分享（Shamir’s Secret Sharing）将 KEK
            备份拆分给多个管理员。
            
            
            

## 八、密钥轮转工程

            

### 为什么要轮转密钥

            

密钥轮转（Key Rotation）是安全运维的基本要求：
            
            
- **合规要求**：PCI DSS
            要求加密密钥至少每年轮转一次。
            
- **限制泄露影响**：如果密钥泄露，轮转可以限制攻击者能够解密的数据范围。
            
- **员工离职**：持有密钥或口令的人员离开组织后，应该轮转相关密钥。
            
            

### KEK 轮转（快速路径）

            

KEK 轮转不需要碰数据，只需要：
            
            
- 在 KMS 中生成新的 KEK 版本。
            
- 用旧 KEK 解密所有 DEK。
            
- 用新 KEK 重新加密所有 DEK。
            
- 更新加密元数据（LUKS 头部 / 表空间头部）。
            
- 废弃旧 KEK 版本（但保留一段时间以防回滚）。
            
            

这个过程通常在秒级完成，因为 DEK 的数量有限且体积小。
            

MySQL TDE 的主密钥轮转就是这种模式：
            
```
-- MySQL 主密钥轮转：秒级完成，不影响在线业务
ALTER INSTANCE ROTATE INNODB MASTER KEY;

-- 轮转过程：
-- 1. 生成新的 Master Key（从 keyring 插件）
-- 2. 读取所有加密表空间的头部，用旧 Master Key 解密 Tablespace Key
-- 3. 用新 Master Key 重新加密 Tablespace Key，写回表空间头部
-- 4. 更新 keyring 中的密钥版本
-- 数据页不需要重新加密
```

            

### DEK 轮转（慢路径）

            

DEK
            轮转需要用新密钥重新加密全部数据，开销与数据量成正比。这是一个
            I/O 密集型操作，对在线业务有影响。
            

LUKS2 的在线重加密功能可以在不卸载文件系统的情况下轮转
            DEK：
            
```
# LUKS2 在线重加密（cryptsetup 2.4+）
# 这会生成新的 DEK 并用新密钥重新加密全部数据
# 操作期间设备正常可用，但 I/O 性能会下降

# 查看当前加密参数
sudo cryptsetup luksDump /dev/sdb

# 在线重加密：更换加密算法和密钥
sudo cryptsetup reencrypt /dev/sdb \
    --cipher aes-xts-plain64 \
    --key-size 512 \
    --resilience journal

# --resilience 选项：
#   journal: 使用日志保证崩溃安全（推荐，但需要额外空间）
#   checksum: 使用校验和检测中断位置
#   none: 不做崩溃保护（最快，但中断后可能丢数据）

# 监控重加密进度
sudo cryptsetup status encrypted_data
```

            

在线重加密的工程注意事项：
            
            
- 速度取决于 I/O 带宽和 CPU 加密速度，1TB 数据在典型 NVMe
            设备上大约需要 30-60 分钟。
            
- 操作期间会消耗额外的 I/O 带宽，建议在低峰期执行。
            
- 必须选择 `journal` 或 `checksum`
            的 resilience 模式，确保崩溃后可以恢复。
            
- 重加密完成前，旧密钥和新密钥同时存在于 LUKS 头部。
            
            

### 零停机轮转策略

            

对于不能中断服务的系统，DEK 轮转的零停机策略：
            
            
- **滚动轮转**：如果数据分布在多个加密卷上（例如分片数据库），可以逐个卷轮转。每个卷轮转时，该分片短暂降级但整体服务可用。
            
- **双写过渡**：在轮转期间，新写入的数据用新密钥加密，旧数据逐步用后台任务迁移到新密钥。需要加密元数据同时维护新旧两个
            DEK。
            
- **存储级快照**：先对加密卷做快照，在快照上执行重加密验证，确认无误后再在主卷上执行。
            
            
            

## 九、硬件加速：AES-NI 与
            QAT

            

### AES-NI 指令集

            

AES-NI（Advanced Encryption Standard New Instructions）是
            Intel 从 Westmere 架构（2010 年）开始引入的 x86
            指令集扩展，提供了 AES 加密操作的硬件加速。AMD 从 Bulldozer
            架构（2011 年）开始支持等效指令。
            

AES-NI 的核心指令：
            
            
            
            指令
            功能
            
            
            
            
            `AESENC`
            执行一轮 AES 加密
            
            
            `AESENCLAST`
            执行最后一轮 AES 加密
            
            
            `AESDEC`
            执行一轮 AES 解密
            
            
            `AESDECLAST`
            执行最后一轮 AES 解密
            
            
            `AESKEYGENASSIST`
            辅助密钥扩展
            
            
            `PCLMULQDQ`
            无进位乘法（用于 GCM 的 GHASH）
            
            
            
            

检查系统是否支持 AES-NI：
            
```
# 检查 CPU 是否支持 AES-NI
grep -o aes /proc/cpuinfo | head -1
# 输出 "aes" 表示支持

# 检查内核是否加载了 AES-NI 加速模块
lsmod | grep aesni
# 应看到 aesni_intel 模块

# 查看内核 Crypto API 中注册的 AES 实现
cat /proc/crypto | grep -A 4 "name.*aes"
```

            

AES-NI 的性能优势来自两方面：
            
            
- **指令级加速**：一条 `AESENC`
            指令完成一整轮 AES 变换（SubBytes + ShiftRows + MixColumns +
            AddRoundKey），而软件实现需要数十条指令完成同样的操作。
            
- **流水线并行**：AES-NI 指令的延迟约 4
            个时钟周期，但吞吐量为每周期 1
            条指令。通过对多个独立块交错执行加密，可以充分利用流水线。AES-XTS
            模式天然支持这种并行，因为同一扇区内的各个块的 Tweak
            值可以预先计算。
            
            

### Intel QAT

            

Intel QuickAssist Technology（QAT）是一种专用加速硬件，以
            PCIe 卡或芯片组集成的形式提供，用于卸载加密和压缩操作。
            

QAT 与 AES-NI 的定位区别：
            
            
            
            维度
            AES-NI
            QAT
            
            
            
            
            形态
            CPU 指令集
            独立加速器（PCIe / 芯片组集成）
            
            
            占用 CPU 核心
            是
            否（异步卸载）
            
            
            延迟
            极低（纳秒级）
            较高（微秒级，含 DMA 开销）
            
            
            吞吐量
            受 CPU 核心数限制
            单卡可达 100 Gbps+
            
            
            适用场景
            通用加密，中低吞吐
            高吞吐加密卸载，释放 CPU
            
            
            
            

QAT
            的典型应用场景不是磁盘加密（延迟敏感），而是网络加密（TLS
            终结）和大批量数据加密。对于存储加密，AES-NI
            已经足够满足绝大多数场景的性能需求。
            

### 性能对比

            

以下引用数据来自 Linux 内核 Crypto API 的 benchmark
            框架（`tcrypt` 模块）和
            `cryptsetup benchmark` 工具的典型结果。不同 CPU
            型号的绝对数值会有差异，但相对关系稳定。
            

测试环境描述（引用数据，非本地实测）：
            
```
典型测试环境：
- CPU: Intel Xeon（Icelake 或 Sapphire Rapids 系列，支持 AES-NI 和 VAES）
- 内存: DDR4/DDR5
- OS: Linux 6.x
- 工具: cryptsetup benchmark / tcrypt 内核模块
```

            

`cryptsetup benchmark` 典型结果：
            
```
# cryptsetup benchmark（引用数据）
# 测试对象：各加密算法在内核 Crypto API 中的吞吐量

算法                密钥长度    加密速度        解密速度
aes-cbc             128 bit   1200 MiB/s     4100 MiB/s
aes-cbc             256 bit   900 MiB/s      3100 MiB/s
aes-xts             256 bit   3700 MiB/s     3800 MiB/s
aes-xts             512 bit   2900 MiB/s     3000 MiB/s
serpent-xts          256 bit   470 MiB/s      480 MiB/s
twofish-xts          256 bit   370 MiB/s      380 MiB/s
```

            

关键观察：
            
            
- AES-XTS 在 AES-NI
            加速下，加密和解密速度基本对称，单核可达 3-4 GB/s。
            
- AES-CBC 的加密速度远低于解密速度，因为 CBC
            加密是串行的（每个块依赖前一个块的密文），无法流水线化；而
            CBC 解密是可并行的。
            
- Serpent 和 Twofish 没有硬件加速，速度只有 AES 的 1/6 到
            1/8。
            
            

这个吞吐量意味着：在现代服务器上，AES-NI 加速的 AES-XTS
            加密不太可能成为 I/O 路径的瓶颈。一个典型的 NVMe SSD
            的顺序读写速度在 3-7 GB/s 范围，单核 AES-XTS
            的加密速度与之匹配。
            
            

## 十、加密对存储性能的影响

            

### 性能开销的来源

            

存储加密的性能开销由以下几部分组成：
            
            
- **CPU 加密计算**：AES-NI
            加速后，这部分开销通常很小。
            
- **内存拷贝**：dm-crypt
            需要分配额外的缓冲区来存放加密前/后的数据，增加内存拷贝次数。
            
- **I/O
            路径延长**：加密引入了额外的处理层，增加了每个 I/O
            请求的延迟。
            
- **内核线程调度**：dm-crypt
            使用内核工作队列（Workqueue）来执行加密操作，线程调度引入额外延迟。
            
- **密文膨胀（AEAD 模式）**：使用 AES-GCM
            等认证加密模式时，认证标签占用额外空间，有效容量下降。
            
            

### IOPS 和吞吐量影响

            

以下是典型的性能影响范围（综合多个公开的 benchmark
            报告得出的经验值，具体数值因硬件和工作负载而异）：
            
            
            
            工作负载类型
            无加密基线
            dm-crypt AES-XTS（AES-NI）
            性能损失比例
            
            
            
            
            顺序读（128K 块）
            3500 MB/s
            3200-3400 MB/s
            3%-8%
            
            
            顺序写（128K 块）
            3000 MB/s
            2700-2900 MB/s
            3%-10%
            
            
            随机读（4K, QD32）
            600K IOPS
            500K-570K IOPS
            5%-15%
            
            
            随机写（4K, QD32）
            500K IOPS
            400K-470K IOPS
            6%-20%
            
            
            
            

说明：以上数据是综合多个公开 benchmark
            报告（Phoronix、Arch Wiki、Red Hat
            文档）的经验范围，不是在单一环境下的精确实测。实际影响取决于
            CPU 型号、NVMe 设备型号、内核版本、dm-crypt
            配置参数和并发度。
            

关键趋势：
            
            
- **顺序 I/O 影响小**：大块顺序 I/O
            的瓶颈通常是设备带宽而非 CPU 加密速度，AES-NI
            的加密吞吐量足以匹配。
            
- **随机小块 I/O 影响较大**：4K 随机 I/O 在高
            IOPS 场景下，每次 I/O 的加密延迟累积效应明显。
            
- **队列深度影响**：dm-crypt
            的工作队列机制在高并发下表现更好，低队列深度时延迟增加更显著。
            
            

### 延迟分析

            

加密引入的额外延迟需要从 I/O 路径的角度分析：
            
```
未加密的 I/O 路径延迟分解（4K 随机读）

应用 → 文件系统 → 块层 → NVMe 驱动 → 设备
       ~1μs        ~1μs    ~1μs        ~80μs
                                    总延迟 ≈ 83μs

加密的 I/O 路径延迟分解（4K 随机读，dm-crypt）

应用 → 文件系统 → dm-crypt → 块层 → NVMe 驱动 → 设备
       ~1μs       ~3-5μs    ~1μs    ~1μs        ~80μs
                                            总延迟 ≈ 86-88μs
```

            

dm-crypt 增加的约 3-5
            微秒包括：工作队列调度、加密计算和额外的内存拷贝。对于 NVMe
            设备（基线延迟约 80-100 微秒），这个增量占比约
            4%-6%。但对于更慢的 SATA SSD（基线延迟约 30-50 微秒）或
            HDD（基线延迟数毫秒），加密延迟占比更小，几乎不可感知。
            

### dm-crypt 性能优化参数

            

dm-crypt 有几个内核参数可以影响性能：
            
```
# 查看当前 dm-crypt 配置
sudo dmsetup table encrypted_data

# 优化 1：使用 no_read_workqueue 和 no_write_workqueue（Linux 5.9+）
# 跳过工作队列，在提交 I/O 的线程中直接加密
# 减少线程调度延迟，对延迟敏感的场景有帮助
sudo cryptsetup --perf-no_read_workqueue --perf-no_write_workqueue \
    refresh encrypted_data

# 优化 2：使用 submit_from_crypt_cpus（Linux 4.0+）
# 让加密线程直接提交 I/O，避免线程切换
sudo cryptsetup --perf-submit_from_crypt_cpus \
    refresh encrypted_data

# 优化 3：调整 sector-size 对齐
# 确保加密扇区大小与底层设备匹配
sudo cryptsetup --sector-size 4096 \
    refresh encrypted_data
```

            

### 内联加密引擎

            

现代存储控制器和 UFS/eMMC
            控制器开始支持内联加密引擎（Inline Encryption
            Engine），在硬件层面完成加密/解密，完全不占用 CPU。Linux
            内核从 5.9
            版本开始支持内联加密框架（`blk-crypto`），允许
            dm-crypt 和 fscrypt
            将加密操作卸载到存储控制器的硬件引擎。
            

内联加密的优势：
            
            
- 零 CPU 开销。
            
- 零额外延迟（加密与 DMA 传输并行完成）。
            
- 零额外内存拷贝。
            
            

但限制也明显：
            
            
- 依赖存储控制器硬件支持，目前主要在移动设备（UFS
            3.x）和部分企业级 NVMe 控制器上可用。
            
- 硬件密钥槽数量有限（通常几十到几百个），不适合需要大量独立密钥的场景。
            
- 算法选择受限于硬件支持的算法。
            
            
```
# 检查设备是否支持内联加密
cat /sys/block/sda/queue/crypto_profile/modes/AES-256-XTS 2>/dev/null
# 如果文件存在且内容非空，表示设备支持 AES-256-XTS 内联加密
```

            

### 性能影响的工程总结

            
            
            
            
            
            
            
            
            
            场景
            加密方式
            性能影响
            工程建议
            
            
            
            
            服务器全盘加密
            dm-crypt + AES-NI
            3%-15%
            默认开启，性能损失可接受
            
            
            数据库 TDE
            应用层加密
            5%-20%
            只加密敏感表空间，避免全库加密
            
            
            高 IOPS 工作负载
            dm-crypt + no_workqueue
            5%-10%
            启用 no_read/write_workqueue 优化
            
            
            移动设备
            fscrypt + 内联加密
            <1%
            依赖硬件内联加密引擎
            
            
            低端 ARM 设备
            Adiantum
            5%-15%
            无 AES-NI 时的折中方案
            
            
            
            

核心判断：在配备 AES-NI 的现代 x86 服务器上，dm-crypt
            的性能开销在大多数工作负载下处于可接受范围（单位数百分比）。加密不再是”用不起”的奢侈品，而是应该默认启用的基础设施。性能调优的重点不在加密算法本身，而在
            dm-crypt 的工作队列配置和扇区大小对齐。
            
            

## 十一、参考文献

            

### 规范与标准

            
            
- IEEE P1619-2018, *Standard for Cryptographic
            Protection of Data on Block-Oriented Storage
            Devices*（AES-XTS 标准）
            
- NIST SP 800-38E, *Recommendation for Block Cipher
            Modes of Operation: The XTS-AES Mode for Confidentiality on
            Storage Devices*
            
- NIST SP 800-38D, *Recommendation for Block Cipher
            Modes of Operation: Galois/Counter Mode (GCM) and
            GMAC*
            
- PCI DSS v4.0, Requirement 3.5.1（存储数据加密要求）
            
- LUKS2 On-Disk Format Specification, *https://gitlab.com/cryptsetup/LUKS2-docs*
            
            

### 源码与文档

            
            
- Linux 内核 dm-crypt
            实现：`drivers/md/dm-crypt.c`
            
- Linux 内核 fscrypt
            框架：`fs/crypto/`，内核文档
            `Documentation/filesystems/fscrypt.rst`
            
- cryptsetup 项目：*https://gitlab.com/cryptsetup/cryptsetup*
            
- fscrypt 用户空间工具：*https://github.com/google/fscrypt*
            
- MySQL 8.0 InnoDB Tablespace Encryption：*https://dev.mysql.com/doc/refman/8.0/en/innodb-data-encryption.html*
            
- PostgreSQL pg_tde 扩展：*https://github.com/percona/pg_tde*
            
            

### 论文与书籍

            
            
- Rogaway, P. (2004). *Efficient Instantiations of
            Tweakable Blockciphers and Refinements to Modes OCB and
            PMAC*（XEX/XTS 理论基础）
            
- Halevi, S. & Rogaway, P. (2003). *A Tweakable
            Enciphering Scheme*（可调加密的理论框架）
            
- Ferguson, N. (2006). *AES-CBC + Elephant diffuser: A
            Disk Encryption Algorithm for Windows Vista*（BitLocker
            早期设计）
            
- Brumley, B. & Tuveri, N. (2011). *Remote Timing
            Attacks are Still Practical*（AES
            软件实现的侧信道攻击，AES-NI 的安全动机之一）
            
            

### 工具与实验

            
            
- `cryptsetup benchmark`：内核加密算法性能测试
            
- `fio`：I/O 性能基准测试工具，配合 dm-crypt
            测量加密性能影响
            
- Linux 内核 `tcrypt` 模块：内核态加密算法
            benchmark
            
- HashiCorp Vault Transit Secrets Engine：*https://developer.hashicorp.com/vault/docs/secrets/transit*
            
            
            

**上一篇**: 序列化格式深度对比
            **下一篇**: 对象存储模型：从文件到对象的范式转变
        

## 同主题继续阅读

把当前热点继续串成多页阅读，而不是停在单篇消费。
                
                    

2025-08-31 · storage
                    

### 【存储工程】块存储加密：LUKS 与 dm-crypt

                    

在存储系统的安全防线中，加密是最后一道也是最重要的一道屏障。当物理安全措施失效——磁盘被盗、服务器被非法访问、退役硬盘未彻底销毁——只有加密能确保数据不被未授权方读取。块级加密（Block-Level Encryption）在存储栈的最低层工作，对上层文件系统和应用程序完全透明，不需要修改任何一行应用代码就能保护磁盘上…
                

                
                    

2025-08-30 · storage
                    

### 【存储工程】Device Mapper：Linux 存储虚拟化层

                    

拆解 Linux Device Mapper 框架的内核架构、映射表机制与七种核心 target driver，从 dm-linear 到 dm-verity，覆盖 dmsetup 实战和容器存储应用。
                

                
                    

2026-04-22 · db / storage
                    

### 数据库内核实验索引

                    

汇总本站数据库内核文章：PostgreSQL / MySQL InnoDB / 列存引擎 / 数据湖与开放表格式 / 流式数据处理 / 分布式 OLAP 查询引擎，以及 LSM-Tree 从零实现实验。
                

                
                    

2026-06-30 · database / storage
                    

### 【数据湖与开放表格式】Lakehouse 全景：从 Hive 表到开放表格式

                    

Hive 目录式分区表把『表』等同于『一组目录加 metastore 里的分区行』，于是没有原子提交、planning 要 LIST 目录、schema 与分区演进常要重写。本文用这三个硬伤切入，讲清 lakehouse 把表拆成『不可变数据文件 + 可变元数据指针 + catalog』三层后各自解决了什么，并给出全系列的分层地图。