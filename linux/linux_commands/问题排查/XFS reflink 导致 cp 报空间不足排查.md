# XFS reflink 导致 cp 报"空间不足"排查

> 排查日期：2026-10-29
> 涉及系统：KVM 虚拟机 `rocky10-2`（Rocky Linux 10.2，100G qcow2，NAT 192.168.122.56）
> 现象关键词：`cp: failed to clone ... No space left on device`，但 `df` 显示 35G 可用

## 一、问题现象

在 guest 内执行发布拷贝：

```bash
cd /root/data/prod_img/release/AIF/
cp -rp noarch/jpsoft/data/engine/* /jpsoft/data/engine/
```

报错：

```text
cp: failed to clone '/jpsoft/data/engine/application-prod.yml' from 'noarch/jpsoft/data/engine/application-prod.yml': No space left on device
cp: failed to clone '/jpsoft/data/engine/application.yml' from 'noarch/jpsoft/data/engine/application.yml': No space left on device
cp: failed to clone '/jpsoft/data/engine/config.yaml' from 'noarch/jpsoft/data/engine/config.yaml': No space left on device
cp: failed to clone '/jpsoft/data/engine/omp.yml' from 'noarch/jpsoft/data/engine/omp.yml': No space left on device
```

而磁盘明明有空间：

```text
Filesystem     Type      Size  Used Avail Use% Mounted on
/dev/vda4      xfs        97G   63G   35G  65% /
```

**关键观察：只有 4 个普通文件失败，4 个子目录（`cert/`、`guacd-driver/`、`guacd-records/`、`screenshots/`）全部拷贝成功。**
同样是"复制"，一部分成功一部分失败 —— 说明不是整体空间问题。

失败后目标目录留下 4 个 **0 字节**的空文件（`cp` 先创建了目标文件，克隆失败后没有回滚）。

## 二、排查过程

### 1. 排除三个常见嫌疑：inode、配额、普通写入

```bash
df -i /              # Inodes 50854848  IUsed 590979  IUse% 2%     → inode 充裕
mount | grep vda4    # ... (rw,relatime,seclabel,attr2,inode64,noquota)
```

挂载选项带 `noquota`，系统也无配额工具。再验证普通写入：

```bash
dd if=/dev/zero of=/root/_t.bin bs=4096 count=100   # 400KB，成功
dd if=/dev/zero of=/jpsoft/_t.bin bs=4096 count=100 # 成功
dd if=/dev/zero of=/tmp/_t.bin   bs=4096 count=100 # 成功
```

结论：**inode 正常、无配额、普通写入正常**。磁盘是真的够。

### 2. 定位失败的系统调用 —— strace

关键一步。`strace` 未安装，顺手装上：

```bash
yum -y install strace
strace -f -e trace=openat,ioctl,write,ftruncate,close \
  cp -rp noarch/jpsoft/data/engine/application.yml /jpsoft/data/engine/_probe.yml
```

输出：

```text
openat(AT_FDCWD, "/jpsoft/data/engine/_probe.yml", O_WRONLY|O_CREAT|O_EXCL, 0700) = 4
ioctl(4, FICLONE, 3) = -1 ENOSPC (No space left on device)
write(2, "failed to clone '/jpsoft/data/en"..., 97...)
write(2, ": No space left on device", 25)
```

**失败的不是 `write()`，而是 `ioctl(FICLONE)`。**

`FICLONE` = `0x40049409`，是 XFS 的 **reflink（写时复制）克隆**接口。源和目标在同一个文件系统上时，coreutils 的 `cp` 会走这条捷径：不做真实拷贝，而是让两个文件共享同一批数据块（CoW），非常快。

**所以"空间不足"是内核对克隆操作返回的 ENOSPC，不是写数据时的 ENOSPC。** 这一步直接把问题从"磁盘"转向了"reflink"。

### 3. 排除目标位置因素

把同一批文件拷到不同目标，逐一验证：

| 目标位置 | 结果 |
|---------|------|
| `/root/` | ENOSPC |
| `/jpsoft/` | ENOSPC |
| `/jpsoft/data/engine/` | ENOSPC |
| `/tmp/` | ENOSPC |

**失败与目标目录无关。** 反过来，再造一个内容完全相同的文件测试：

```bash
cp noarch/jpsoft/data/engine/application.yml /root/_fresh1.yml
# 在同一目录下原样复制一份 → FICLONE 成功
```

| 测试对象 | 所在 AG | FICLONE |
|---------|---------|---------|
| `application.yml`（原文件） | AG4 | **ENOSPC** |
| `_fresh1.yml`（内容完全相同的副本） | AG0/AG1 | **成功** |

内容和大小都不影响成败，**只有"源文件在哪个 AG"决定结果**。

### 4. 定位到残尾 AG4

```bash
xfs_info /
```

```text
meta-data=/dev/vda4  isize=512  agcount=5, agsize=6356800 blks
         =  crc=1  finobt=1, sparse=1, rmapbt=1
         =  reflink=1  bigtime=1  inobtcount=1  nrext64=1
data     =  bsize=4096  blocks=25427451
```

`agcount=5` × `agsize=6356800`。前 4 个 AG 各 6356800 块，最后一个 AG 只剩：
`25427451 - 4×6356800 = 251` 块 —— 一个**只有 251 块的残尾 runt AG**。

用 `filefrag -v` 看失败文件的物理位置：

```text
application.yml       0..0 : 25427416..25427416 : 1 extent   ← AG4
application-prod.yml  0..1 : 25427417..25427418 : 2 extents  ← AG4
config.yaml           0..0 : 25427419..25427419 : 1 extent   ← AG4
omp.yml               0..2 : 25427420..25427422 : 3 extents  ← AG4
```

对照能成功克隆的文件（166KB 的 PNG）：

```text
  0..40: 12792493..12792533: 41 extents  ← AG2
```

**4 个失败文件全部落在 AG4，成功文件在 AG2。**

各 AG 的空闲块分布：

```bash
xfs_db -r -c "agf 4" -c "p" /dev/vda4
```

```text
length = 251          ← 残尾 runt AG
freeblks = 6          ← 仅剩 6 块
rmapblocks = 1
refcntblocks = 1
btreeblks = 0
flfirst = 1  fllast = 6  flcount = 6
```

```text
AG0: length = 6356800  freeblks = 3345037
AG1: length = 6356800  freeblks =  966255
AG2: length = 6356800  freeblks = 2662809
AG3: length = 6356800  freeblks = 2559800
AG4: length = 251      freeblks = 6      ← 4 个失败文件全在这里
```

AG4 的空闲空间分布（`xfs_db -r -c "freesp -a 4" /dev/vda4`）：

```text
   from      to extents blocks    pct blkcdf extcdf
      1       1       7      7  58.33 100.00 100.00
      4       7       1      5  41.67  41.67  12.50
```

### 5. 内核机制 —— 为什么 35G 空闲也会 ENOSPC

XFS 内核 `fs/xfs/xfs_reflink.c`：

```c
static int
xfs_reflink_ag_has_free_space(
    struct xfs_mount	*mp,
    xfs_agnumber_t		agno)
{
	...
	pag = xfs_perag_get(mp, agno);
	if (xfs_ag_resv_critical(pag, XFS_AG_RESV_RMAPBT) ||
	    xfs_ag_resv_critical(pag, XFS_AG_RESV_METADATA))
		error = -ENOSPC;
	...
}
```

调用处：

```c
xfs_reflink_remap_extent(...)
	...
	xfs_reflink_ag_has_free_space(mp, XFS_FSB_TO_AGNO(mp, irec->br_startblock));
```

**两个关键点：**

1. **检查的是源文件所在的 AG**（`XFS_FSB_TO_AGNO(mp, irec->br_startblock)`），不是目标目录的 AG。
2. **检查的是该 AG 的关键元数据预留**（`XFS_AG_RESV_RMAPBT` / `XFS_AG_RESV_METADATA`）是否告急，而不是数据块总量。

AG4 只有 251 块，其中 `rmapblocks=1`、`btreeblks=0`、AGFL 段 `flfirst=1..fllast=6` 已占满元数据空间 —— 一个连 rmap btree 扩展块都放不下的 AG，判定为 critical → 返回 ENOSPC。**这与全盘还有 35G 空闲毫无关系**，因为判据是单个 AG 的元数据预留状态。

相关内核讨论见 `xfs: account extra freespace btree splits for multiple allocations`（Dave Chinner ↔ Gao Xiang，lkml.iu.edu/2211.2/06534.html）：AG btree / AGFL 块被计入 free 而非 reserved，是这类"虚假 ENOSPC"的根源。

### 6. coreutils 为什么不降级为普通拷贝

`src/copy.c` 的 `is_terminal_error()` 把 `ENOSPC`/`EDQUOT` 当作**终止性错误**，克隆一失败就直接报错退出，**不会退化成 read + write**。

实测三种模式：

| 命令 | 退出码 | 结果 |
|------|-------|------|
| `cp --reflink=never` | **0** | 307 字节文件，内容、权限完全正确 |
| `cp --reflink=auto` | 1 | 同样 ENOSPC，**不触发回退** |
| `cp --reflink=always` | 1 | 同样 ENOSPC |

这正是上游 bug **GNU coreutils #81776**（"cp --reflink=auto does not fallback on XFS if reflink AG is full"，https://debbugs.gnu.org/db/81/81776.html）。Pádraig Brady 与 Paul Eggert 均确认 ENOSPC/EDQUOT 不应被当作终止性错误。

### 7. AG4 这个残尾是怎么来的 —— 不是 XFS 的锅

前面解释了残尾 AG 会导致什么，但没解释它**为什么存在**。追查后发现，这是**装机脚本的设计**造成的，与 XFS 本身无关。

盘上的实际几何：

```text
agcount=5, agsize=6356800 blks, blocks=25427451
```

算术：`6356800 × 4 = 25427200`，`25427451 − 25427200 = 251` —— 4 个满 AG + 一个 **251 块的残尾 AG4**。

关键疑点：**guest 自己的 `mkfs.xfs 6.16.0` 在同样 97G 上默认建出来的是 `agcount=4, agsize=6356863`（4 个满 AG，无残尾）**。也就是说盘上这个 `agcount=5` 不是 mkfs 默认算出来的，是**后来被加上去的**。

答案在 kickstart 的分区指令：

```
part / --fstype=xfs --size=${rootsz} --grow
```

`${rootsz}` 是磁盘容量减去预留分区的精确值（`size_mib - 1024 - 2048 - 1024`）。流程是：

```text
anaconda 按 --size=98304MiB 建分区 + mkfs.xfs
        ↓
mkfs 按 98304MiB 计算几何 → agcount=4, agsize=6291456   (4 个满 AG，完美均分)
        ↓
--grow / xfs_growfs 把 fs 撑到最终 97G
        ↓
xfs_growfs 只能「新增 AG」，无法调整已有 AG 的 agsize
        ↓
blocks: 25165824 → 25427451，需要第 5 个 AG
        ↓
★ 残尾 runt AG 诞生 ★
```

**在 guest 上用 loop 设备精确复现了这条路径**，得到的数值与实际盘完全一致：

```text
data blocks changed from 25165824 to 25427451     ← 与 guest 完全相同
agcount=4 → 5                                     ← 与 guest 完全相同
```

所以：**凡是用"精确 size + grow"方式装出来的 Rocky 虚拟机，都有这个残尾 AG。** 它平时完全不影响读写——直到有人用 reflink 去克隆恰好落在 AG4 里的文件。而发布脚本里的 `cp -rp` 正是最典型的 reflink 触发场景。

这也解释了为什么 `rocky10-2` 上 4 个文件失败、4 个子目录成功：子目录结构不需要克隆（或落在健康 AG），所以安然通过。

## 三、根本原因

> **两层根因。**
>
> **表层（为什么报错是"空间不足"）：** `cp` 在同一文件系统内做 reflink 克隆（FICLONE ioctl）时，内核检查**源文件所在 AG** 的关键元数据预留是否告急。失败的 4 个文件恰好全部位于 **AG4** —— 这个文件系统最后一个只有 251 块的残尾 runt AG，其 rmap btree / metadata 预留已耗尽，内核对 FICLONE 返回 ENOSPC。coreutils 将 ENOSPC 视为终止性错误，不降级为普通字节拷贝，于是把"reflink 元数据不足"原样报成了"磁盘空间不足"。
>
> **深层（为什么会有残尾 AG）：** 装机 kickstart 用 `part / --size=<精确值> --grow`，anaconda 先按精确值建分区再 `xfs_growfs` 撑大。而 `xfs_growfs` 只能新增 AG、不能调整已有 AG 的 `agsize`，因此必然留下一个残尾 runt AG。这是装机脚本的设计缺陷，不是 XFS 的 bug。

因果链：

```text
【深层】kickstart: part / --size=<精确值> --grow
        ↓
anaconda 按精确值建分区 + mkfs → agcount=4（4 个满 AG，无残尾）
        ↓
xfs_growfs 撑大 → 只能新增 AG，不能调整已有 AG 的 agsize
        ↓
agcount 4→5，新增的末 AG 只剩 251 块 → ★ 残尾 runt AG4 ★
        ↓
【表层】发布脚本 cp -rp，源文件恰好落在 AG4
        ↓
cp 走 FICLONE reflink 捷径（源与目标同一 fs）
        ↓
xfs_reflink_ag_has_free_space() 检查源 AG 预留 → -ENOSPC
        ↓
coreutils is_terminal_error() 把 ENOSPC 当终止错误 → 不降级
        ↓
报 "No space left on device"（实际磁盘有 35G 空闲）
```

**为什么有的成功有的失败**：同一次 `cp` 里，4 个普通文件在 AG4（失败），4 个子目录的文件在 AG0/AG1/AG2（成功）。子目录结构不需要 reflink 克隆（或落在健康 AG），所以安然通过。

## 四、解决方案

### 立即可用：禁用 reflink

```bash
cd /root/data/prod_img/release/AIF
cp -rp --reflink=never noarch/jpsoft/data/engine/* /jpsoft/data/engine/
```

`--reflink=never` 让 `cp` 跳过 FICLONE，走普通字节拷贝。`-p` 保留权限、时间戳、属主。
`rsync`、`cat`、`dd` 同理不会触发 reflink。

**发布脚本应固化这个参数**——只要源文件还在 AG4，普通 `cp` 就会一直踩。

### 根治：改 kickstart 的分区参数（已实施）

把

```
part / --fstype=xfs --size=${rootsz} --grow
```

改成

```
part / --fstype=xfs --size=0 --grow
```

`--size=0` 让 anaconda **占满剩余磁盘空间**建分区，mkfs.xfs 直接按最终容量计算几何 → **4 个均分满 AG，无残尾**。

已实测确认 `--size=0` 在 Rocky 9 的 pykickstart 下语义正确
（`partition.py:84` — `if self.size and self.size != 0:`，即 size=0 时不输出 `--size`，交由 anaconda 自动决定；与 `--grow` 组合不冲突）。

**这个改动只影响之后新建的虚拟机**，已装好的盘仍带残尾 AG，需用下面的手段处理。

### 根治 AG4（针对已存在的盘）

| 手段 | 说明 |
|------|------|
| 释放 AG4 内的块 | 删除该 AG 中的文件，空闲块会回填 AGFL，预留随之恢复 |
| `xfs_fsr` 迁移源文件 | 把源文件搬到健康 AG，之后 reflink 又能正常工作（`/usr/sbin/xfs_fsr`） |
| 重建文件系统 | `agsize`/`agcount` **在挂载后无法调整**，残尾 AG 无法通过改参数消除 |

**只要源文件还在 AG4，普通 `cp` 就会一直踩这个坑** —— 发布脚本里应固化 `--reflink=never`。

### 本次执行结果

```bash
# 覆盖 4 个 0 字节残留（cp -p --reflink=never）
application-prod.yml  exit=0  5225 B  md5 17717c4d38e49e1b61e73537e0f30e9b
application.yml        exit=0   307 B  md5 1b77fc2ece5efaabe81684bd2a57c697
config.yaml           exit=0   317 B  md5 7d76f7a1e26e83374d4bd524005366e5
omp.yml               exit=0  8405 B  md5 0accabacd20cca06001c488843709836
```

md5 与源一致，权限（`0777`/`0644`）、mtime、SELinux 上下文（`admin_home_t`）均与源一致。
注意权限已从残留的 `0700` 修正 —— 失败时 `cp` 只创建了空文件，没走到 chmod。

## 五、顺带发现的隐患（与本次报错无关）

`/jpsoft/data/engine/` 下所有文件的 SELinux 上下文是 **`admin_home_t`** —— 从 `/root/data/...` 继承而来，因为源目录本身位于 `/root` 下，而不是应用数据目录应有的类型。

当前是 Enforcing 模式。若 jpsoft 服务以**非 root 身份**运行并读取这些配置，SELinux 可能拒绝访问（典型症状：发布后服务起不来，报 Permission denied）。

排查建议：

```bash
# 看服务以什么身份运行
systemctl cat <service> | grep -i user
# 看有没有被拒绝的记录
ausearch -m avc -ts recent
```

修正时按目录设永久规则（不要直接 `chcon`，重启后会丢）：

```bash
semanage fcontext -a -t var_t '/jpsoft/data/engine(/.*)?'
restorecon -Rv /jpsoft/data/engine
```

## 六、易踩坑记录

- **不要被错误信息带偏。** "No space left on device" 在 reflink 场景下与磁盘空间无关，先用 `strace` 看清失败的是哪个 syscall。
- **`df` 看到的是全盘聚合，XFS 的实际分配粒度是 AG。** 单个残尾 AG 的状态与全盘空闲量无关。
- **`--reflink=auto` 不等于"失败就降级"。** coreutils 把 ENOSPC 当终止错误，auto 和 always 表现完全一样，必须显式 `--reflink=never`。
- **源文件的位置决定成败，与内容、目标目录无关。** 内容相同的副本换个地方就能克隆成功。
- **残尾 runt AG 是 mkfs 时按 `agsize` 切分后剩下的余数**，无法在线调整，只能靠释放空间或迁移文件绕过。
- **失败后目标目录会留下 0 字节文件**，且权限是 `0700`（创建时的默认），与源文件权限不符 —— 排查时别把这些空文件误认为"已成功"。

## 七、本次用到的命令速查

```bash
# 确认 df/inode/配额
df -Th / && df -i / && mount | grep vda4

# 看清失败的是哪个 syscall（核心一步）
strace -f -e trace=openat,ioctl,write,ftruncate,close \
  cp -rp <src> <dst>

# 文件系统特性：reflink/rmapbt/agcount/agsize
xfs_info /

# 每个 AG 的空闲块、rmapbt、AGFL 状态
xfs_db -r -c "agf 4" -c "p" /dev/vda4
xfs_db -r -c "freesp -a 4" /dev/vda4

# 文件的物理块分布 → 判断落在哪个 AG
filefrag -v <file>
xfs_db -r -c "inode <inum>" -c "bmap" /dev/vda4

# 手工验证 FICLONE（FICLONE=0x40049409）
python3 -c "
import fcntl,os
s=os.open('<src>',os.O_RDONLY); d=os.open('<dst>',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
try: fcntl.ioctl(d,0x40049409,s); print('OK')
except OSError as e: print('FAIL',e)"

# 三种 reflink 模式对比
cp --reflink=never  <src> <dst>   # 预期成功
cp --reflink=auto   <src> <dst>   # 预期失败（coreutils 不降级）
cp --reflink=always <src> <dst>   # 预期失败

# 迁移文件到别的 AG（解除 AG4 占用）
xfs_fsr -v <file>
```
