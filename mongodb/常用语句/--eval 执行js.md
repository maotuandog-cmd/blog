为了避免文件找不到的问题，你可以直接使用 `--eval` 参数将这段 JavaScript 代码作为字符串传递给 `mongo` 客户端。

  

在 Linux 终端中，你可以用**单引号 `''`** 将多行代码包裹起来，这样既保证了可读性，又不会与里面的双引号冲突。

  

请直接复制并运行以下完整的命令：

  

Bash

```
mongo "mongodb://localhost:27017/admin" --eval '
  // 初始化副本集并等待其完成启动
  rs.initiate();
  sleep(5000); 

  var adminDb = db.getSiblingDB("admin");

  // 创建 root 用户
  adminDb.createUser({
    user: "root",
    pwd: "JPsoft_2021",
    roles: [ { role: "root", db: "admin" } ]
  });

  // 认证 root 用户
  adminDb.auth("root", "JPsoft_2021");

  // 创建管理员用户
  adminDb.createUser({
    user: "admin",
    pwd: "JPsoft_adin_2025", 
    roles: [
      { role: "userAdminAnyDatabase", db: "admin" },
      { role: "readWriteAnyDatabase", db: "admin" }
    ],
    mechanisms: ["SCRAM-SHA-1", "SCRAM-SHA-256"]
  });

  // 创建监控用户
  adminDb.createUser({
    user: "monitors",
    pwd: "JPsoft_Monitors_25", 
    roles: [
      { role: "readWriteAnyDatabase", db: "admin" },
      { role: "clusterMonitor", db: "admin" },
      { role: "read", db: "local" }
    ],
    mechanisms: ["SCRAM-SHA-1", "SCRAM-SHA-256"]
  });

  // 创建备份用户
  adminDb.createUser({
    user: "backupUser",
    pwd: "backupPassword123",  
    roles: [ { role: "backup", db: "admin" } ]
  });

  // 切换到 DCP 数据库并创建特定数据库用户
  var dcpDb = db.getSiblingDB("DCP");
  dcpDb.createUser({
    user: "jpsoft",
    pwd: "JPsoft_2021", 
    roles: [ { role: "dbOwner", db: "DCP" } ],
    mechanisms: ["SCRAM-SHA-1", "SCRAM-SHA-256"]
  });
'
```

### 注意事项：

1. **外单内双**：在 Bash 中使用 `--eval` 时，最外层必须使用单引号 `'` 包裹，代码里面的所有字符串（用户名、密码等）必须使用双引号 `"`。
    
      
    
2. **连接地址**：由于你在这个脚本里执行了 `rs.initiate()` 并且设置了账号密码，请确保这是个**全新的、未被初始化的 MongoDB 实例**，否则 `rs.initiate()` 会报错并中断后续执行。