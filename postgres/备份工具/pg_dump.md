使用 `pg_dump` 命令行工具导出 5 个特定的表到一个文件，可以使用 `-t` 或 `--table` 参数指定表名。

  

### 常用命令

Bash

```
pg_dump -h <主机名> -p <端口> -U <用户名> -d <数据库名> -t <表1> -t <表2> -t <表3> -t <表4> -t <表5> -f my_tables.sql
```

### 实际示例

假设你的数据库名为 `mydb`，用户名是 `postgres`，要将 `users`, `orders`, `products`, `logs`, `payments` 这 5 个表导出到 `my_5_tables.sql` 文件中：

  

**导出为 SQL Plain (纯文本文本格式):**

  

Bash

```
pg_dump -U postgres -d mydb -t users -t orders -t products -t logs -t payments -f my_5_tables.sql
```

**导出为自定义格式 (Custom format - `.dump`/`.tar`，推荐，方便后续并行恢复或指定恢复部分):**

  

Bash

```
pg_dump -U postgres -d mydb -Fc -t users -t orders -t products -t logs -t payments -f my_5_tables.dump
```

### 参数说明

- `-d` / `--dbname`：数据库名称。
    
      
    
- `-U` / `--username`：连接的数据库用户名。
    
      
    
- `-h` / `--host`：数据库主机地址（本地可省略，默认 `localhost`）。
    
      
    
- `-p` / `--port`：数据库端口（默认 `5432`）。
    
      
    
- `-t` / `--table`：指定要导出的表名。**导出多个表时，重复追加 `-t` 参数即可**。
    
      
    
- `-f` / `--file`：指定导出的目标文件名。
    
      
    
- `-Fc`：（可选）使用 PostgreSQL 自定义压缩格式，占用空间小且可以通过 `pg_restore` 进行快速恢复。
    
      
    

### 导出提示与验证

1. **包含 Schema 名称：** 如果表位于非默认 schema（例如 `app` schema），可以使用完整表名：`-t app.users`。
    
      
    
2. **通配符匹配：** 如果 5 个表的名称有共同前缀（例如 `app_1`, `app_2` ...），也可以使用通配符匹配：`-t 'app_*'`。
    
      
    
3. **验证导出文件：**
    
      
    - **纯文本格式 (.sql)**：运行 `head -n 20 my_5_tables.sql` 确认里面包含指定的表定义及 `COPY` 数据。
        
          
        
    - **自定义格式 (.dump)**：运行 `pg_restore -l my_5_tables.dump` 即可列表查看文件包含的所有数据表目录。