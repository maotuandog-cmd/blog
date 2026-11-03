
  

### 原因 1：`-mtime 0` 的计算方式与预期不符（最常见）

`find` 的 `-mtime 0` 指的是 **当前时间前的 24 小时内（即 $0 \times 24$ 到 $1 \times 24$ 小时之间）**。

  

1. **系统时间不匹配**：如果系统当前时间是 **9月22日 18:00**，那么 9月21日 16:52 距今已经超过了 24 小时（约 25 小时），`-mtime 0` 就会漏掉它（它此时属于 `-mtime 1`）。
    
      
    
2. **测试替代方案**：使用 `-mmin`（按分钟）或 `-mtime -1` 尝试：
    
      
    
    Bash
    
    ```
    # 查找最近 1 天（24小时内）修改的文件
    find /jpsoft/logs -mtime -1 \( -type f -o -type l \) \( -name '*.log' -o -name '*.txt' -o -name '*.out' \)
    ```
    
    > **区别**：`-mtime 0` 是严格的 $[0, 24)$ 小时；`-mtime -1` 表示 $<24$ 小时（通常更符合“今天/最近一天”的逻辑）。
    > 
    >   
    

可以通过以下命令验证该文件的精确修改时间与系统当前时间的差距：

  

Bash

```
stat /jpsoft/logs/polardb/log/postgresql-2026-09-21_165029_error.log
date
```

验证是否通过：若 `date` 打印的时间比文件时间晚了 24 小时以上，证明落在了 `-mtime 0` 范围之外。

  

### 原因 2：父级目录的权限问题（权限拒绝）

截图显示该文件所有者是 `nicsystem:input`，权限是 `-rw-------` (600)。

虽然你当前是 `root` 用户，但如果上层目录 `/jpsoft/logs/polardb/log` 或中间目录的执行/读取权限有特殊限制，或者挂载了 NFS/跨文件系统，`find` 在递归遍历时可能会直接跳过。

  

排查方式：

尝试直接对该子目录执行 `find`：

  

Bash

```
find /jpsoft/logs/polardb/log/ -mtime 0
```

验证是否通过：如果有输出，说明问题仅在 `-mtime` 时间匹配上；若提示 `Permission denied`，说明存在权限阻断。

  

### 原因 3：`-print0` 在终端中不可见或被截断

`-print0` 会将输出结果中的换行符替换为空字符 `\0`。在某些终端模拟器中，如果直接在命令行执行 `-print0` 而没有通过管道传给 `xargs -0`，可能会导致多条输出粘在同一行，或者由于包含了不可见字符导致显示异常。

  

排查方式：

去掉 `-print0`，直接标准输出测试：

  

Bash

```
find /jpsoft/logs -mtime -1 \( -type f -o -type l \) \( -name '*.log' -o -name '*.txt' -o -name '*.out' \)
```

验证是否通过：终端按行正常打印出路径即为成功。