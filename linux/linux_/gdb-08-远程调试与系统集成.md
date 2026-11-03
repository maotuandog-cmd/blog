# GDB 使用说明 (八) 远程调试 + 系统集成

承接: (一) (二) (三) (四) (五) (六) (七)
本节聚焦: gdbserver / 多机调试 / CI 集成 / IDE 集成

================================================================
8.1 远程调试模型
================================================================

  目标机 (被调试)            调试机 (开发本)
  ┌─────────────┐  网络    ┌─────────────┐
  │ gdbserver   │◄──────────│ gdb         │
  │ port 9999   │  GDB RSP │             │
  │ + 应用进程   │  协议    │             │
  └─────────────┘          └─────────────┘

gdbserver 可以:
  - 启动一个新程序:  gdbserver :9999 ./app
  - attach 已有进程: gdbserver :9999 --attach <pid>

================================================================
8.2 目标机: gdbserver 命令
================================================================

----------------------------------------------------------------
8.2.1 基本启动
----------------------------------------------------------------
  gdbserver :9999 ./app
  # 监听 :9999 (所有接口), 跑 ./app
  # 等 GDB 连上来再跑

  gdbserver localhost:9999 ./app
  # 仅本地接口

  gdbserver 0.0.0.0:9999 ./app
  # 所有接口 (不推荐, 应配防火墙)

----------------------------------------------------------------
8.2.2 attach 已运行进程
----------------------------------------------------------------
  gdbserver :9999 --attach <pid>

  # 多线程:
  gdbserver --multi :9999
  # 监听但不跑程序, 等 GDB 用 target extended-remote 连 + run 命令

----------------------------------------------------------------
8.2.3 端口冲突
----------------------------------------------------------------
  gdbserver --once :9999 ./app
  # 仅接 1 次连接, 之后退出

  # 看哪些进程在监听
  ss -tlnp | grep gdbserver

----------------------------------------------------------------
8.2.4 安全性
----------------------------------------------------------------
gdbserver 不加密, 也不认证, 仅防火墙隔离
  - 生产: 仅在 VPN / 内网使用
  - 用 SSH 隧道转发: ssh -L 9999:target:9999 user@target

================================================================
8.3 调试机: 连接 gdbserver
================================================================

----------------------------------------------------------------
8.3.1 基本连接
----------------------------------------------------------------
  gdb
  (gdb) target remote 192.168.1.10:9999
  # 同步模式 (调试机需全程在线)

  (gdb) target extended-remote 192.168.1.10:9999
  # 异步模式 (允许断开重连, multi-process)

  (gdb) file /path/to/binary      # 加载调试符号
  (gdb) set sysroot /target-root  # 远端 /lib /usr/lib 路径
  # 或
  (gdb) set sysroot ssh://remote
  # 自动从远端拉文件

----------------------------------------------------------------
8.3.2 SSH 隧道 (安全)
----------------------------------------------------------------
  本地:
  ssh -L 9999:localhost:9999 user@target 'gdbserver :9999 ./app'

  GDB:
  (gdb) target remote localhost:9999

  或 (gdbserver 在远端手动启动):
  本地:
  ssh -L 9999:localhost:9999 user@target

  远端:
  gdbserver :9999 ./app

  GDB:
  (gdb) target remote localhost:9999

----------------------------------------------------------------
8.3.3 嵌入式 / 跨平台
----------------------------------------------------------------
  # 安装 gdb-multiarch
  apt install gdb-multiarch

  gdb-multiarch
  (gdb) set sysroot /opt/cross/rootfs
  (gdb) set arch arm
  (gdb) target remote 192.168.1.50:9999

================================================================
8.4 Core dump 远程分析
================================================================

  远端生成 dump, 本地分析:
  # 1. 远端 dump (不重启进程)
  gdb -p <pid> -batch -ex 'gcore /tmp/core.remote' -ex detach -ex quit

  # 2. 拉 dump 到本地
  scp user@target:/tmp/core.remote .

  # 3. 本地分析
  gdb /usr/bin/app ./core.remote

  # 4. 共享符号 (.debug_*)
  # 本地有符号, 远端无 → 直接 gdb 能用
  # 远端有符号, 本地无 → set sysroot + debug-file-directory

================================================================
8.5 调试容器 / K8s 进程
================================================================

----------------------------------------------------------------
8.5.1 nsenter 直接进容器命名空间
----------------------------------------------------------------
  # 找容器内 PID
  CONTAINER_PID=$(docker inspect --format '{{.State.Pid}}' my_container)

  # 进容器 namespace, attach 进程 1
  sudo nsenter -t $CONTAINER_PID -m -p -F -- gdb -p 1

  # K8s pod
  POD_PID=$(crictl inspect --output go-template --template '{{.info.pid}}' <container-id>
  sudo nsenter -t $POD_PID -m -p -F -- gdb -p <process_pid_in_pod>

----------------------------------------------------------------
8.5.2 kubectl debug (推荐)
----------------------------------------------------------------
  kubectl debug pod-name --image=busybox --target=<container>
  # 进 pod 的同一个 PID namespace

  # 启动 sidecar
  kubectl debug -it pod-name --image=linux-perf --target=<container>
  # 在 pod 内启动一个调试容器, 共享 PID/网络/卷

  # 调试进程:
  kubectl debug -it pod-name \
    --image=your-build-image-with-gdb \
    --target=<container> \
    -- /usr/bin/gdb -p 1

================================================================
8.7 CI 集成
================================================================

----------------------------------------------------------------
8.7.1 批处理模式核心
----------------------------------------------------------------
  gdb -batch \
    -ex 'set pagination off' \
    -ex 'file ./myprog' \
    -ex 'core-file ./core.1234' \
    -ex 'thread apply all bt 5' \
    -ex 'set logging file /tmp/analysis.txt' \
    -ex 'set logging on' \
    -ex 'info registers' \
    -ex 'set logging off' \
    -ex quit

----------------------------------------------------------------
8.7.2 测试驱动开发 (TDD) 风格的调试
----------------------------------------------------------------

  模板: 出错时自动 dump + 自动分析
  CFLAGS=-g3 -ggdb ...
  app 内捕获 SIGSEGV → generate-core-file → 退出

  CI:
    - 构建产物 + 跑测试
    - 若失败: gdb -batch -c core -ex bt -ex quit myprog > report.txt
    - 上传 report.txt 到 artifact

----------------------------------------------------------------
8.7.3 .gdbinit 自动化
----------------------------------------------------------------
  # 项目级 .gdbinit (放在仓库根, 用户 source 它)
  set confirm off
  set pagination off
  set print pretty on
  file ./build/myprog

  # CI:
  gdb -batch -x ./.gdbinit -ex 'run --input test1.json'

================================================================
8.8 IDE 集成
================================================================

----------------------------------------------------------------
8.8.1 VSCode
----------------------------------------------------------------
  launch.json:
  {
    "version": "0.2.0",
    "configurations": [
      {
        "name": "gdb-launch",
        "type": "cppdbg",
        "request": "launch",
        "program": "${workspaceFolder}/build/myprog",
        "args": ["--input", "test.json"],
        "stopAtEntry": false,
        "cwd": "${workspaceFolder}",
        "environment": [],
        "externalConsole": true,
        "MIMode": "gdb",
        "setupCommands": [
          {"text": "-enable-pretty-printing"},
          {"text": "-gdb-set disassembly-flavor intel"}
        ]
      },
      {
        "name": "gdb-attach",
        "type": "cppdbg",
        "request": "attach",
        "program": "${workspaceFolder}/build/myprog",
        "processId": "${command:pickProcess}",
        "MIMode": "gdb"
      }
    ]
  }

----------------------------------------------------------------
8.8.2 CLion
----------------------------------------------------------------
  - 工具链: Settings → Build → Toolchains → Custom GDB
  - Run/Debug 配置: 默认用 Bundled GDB
  - 远程: 配 Deployment + Remote Host

----------------------------------------------------------------
8.8.3 Vim termdebug
----------------------------------------------------------------
  :packadd termdebug
  :Termdebug ./myprog          # 启动
  :Termdebug --args ./myprog arg1

  vim 内: GDB 命令一行 + 源码窗
  :Program 下一步 :Step 进函数

----------------------------------------------------------------
8.8.4 Emacs gdb-mi (M-x gdb)
----------------------------------------------------------------
  M-x gdb
  Run gdb (like this): gdb -i=mi myprog
  # GUD 模式: C-x C-a 在源码里设断点 (需 gdb-many-windows)

================================================================
8.9 性能分析 / Profiling 与 GDB
================================================================

GDB 本身慢, 不能 profile; 用 perf / callgrind 配合

----------------------------------------------------------------
8.9.1 用 gdbserver 配合 perf
----------------------------------------------------------------
  # 远端跑 perf record, 本地用 perf report
  perf record -g -p <pid>           # 远端
  perf report                       # 本地

  # GDB 调 sample 命中:
  gdb --pid <pid>
  (gdb) print %function_from_perf_report

----------------------------------------------------------------
8.9.2 perf annotate + GDB
----------------------------------------------------------------
  perf record -g -p <pid>
  perf annotate
  # 显示每条汇编的耗时

  # GDB 中:
  (gdb) disassemble /m my_hot_func
  # 对比 perf 的热点

================================================================
8.10 反向调试 (record/replay)
================================================================

  (gdb) target record-full          # 录制 (慢, 占内存)
  (gdb) continue
  (gdb) reverse-step                # 反向 step
  (gdb) reverse-continue            # 反向跑
  (gdb) target record-stop          # 停止录制

限制:
  - 默认 record-full 慢 50-100 倍
  - 不支持多线程 (GDB 12+ 支持 btrace)
  - 占用大量内存 (录制全部内存写入)

  # Intel Processor Trace (硬件录制, 更快)
  (gdb) target record-btrace        # btrace 模式
  (gdb) record btrace:pt
  # 比 record-full 慢 <5%, 但只支持反向 step, 不能跳回任意点

================================================================
8.11 安全考虑
================================================================

⚠️ GDB 可读写目标进程任意内存
  → 不要 attach 到生产关键进程
  → core dump 文件可能含敏感数据 (密钥, 密码)
  → 传输/归档 core 时加密
  → 设置 ulimit -c 0 阻止敏感进程生成 dump

⚠️ GDB 命令可执行任意操作
  → GDB 命令日志写到 ~/.gdb_history, 定期清
  → GDB 共享屏幕/会话时注意 shoulder surfing

================================================================
8.12 实战: Kubernetes 中的 Go 服务
================================================================

  # 1. 在 pod 内运行 gdbserver
  kubectl exec -it pod -- /bin/bash
  apk add gdb
  gdbserver :9999 --attach 1
  # 进程 1 通常是服务本身

  # 2. 本地端口转发
  kubectl port-forward pod 9999:9999 &

  # 3. 本地 GDB
  gdb-multiarch
  (gdb) file ./bin/myservice  # 调试符号
  (gdb) set sysroot /opt/remote-rootfs
  (gdb) target remote localhost:9999
  (gdb) bt

  # 4. 上传 core
  kubectl exec pod -- bash -c 'kill -SIGABRT 1'    # 触发 core
  kubectl cp pod:/tmp/core ./core
  gdb ./bin/myservice ./core

================================================================
8.13 实战: ARM 嵌入式开发
================================================================

  # 1. 远端 (板子)
  gdbserver :9999 /mnt/nfs/app

  # 2. 本地 (x86_64)
  apt install gdb-multiarch
  gdb-multiarch

  (gdb) set arch armv7
  (gdb) file ./build/app-arm.elf
  (gdb) set sysroot /opt/arm-toolchain/sysroot
  (gdb) target remote 192.168.1.50:9999

  (gdb) load                                # 加载到目标
  (gdb) break main
  (gdb) continue

  # OpenOCD + 仿真器
  (gdb) target extended-remote localhost:3333
  # 通过 OpenOCD 调 ARM 芯片

================================================================
8.14 故障排查清单
================================================================

  gdbserver 连不上?
    → telnet 测端口; 防火墙; SELinux (audit2allow)

  GDB 加载 .so 找不到符号?
    → set sysroot; set debug-file-directory; debuginfod

  远端 GDB 输入响应慢?
    → 网络延迟; 用 SSH -L 隧道; 升级 GDB 版本

  btrace 不可用?
    → CPU 不支持 Intel PT; 老 kernel 不支持

  record-full 太慢?
    → 用 record-btrace 或 perf record (独立工具)

================================================================
术语表 (本章)
================================================================

  gdbserver              远程调试服务端
  GDB RSP                GDB Remote Serial Protocol
  target remote          GDB 同步远程模式
  target extended-remote  GDB 异步远程模式 (支持多进程)
  sysroot                远端根目录 (含 /lib 等)
  btrace                 Intel Processor Trace 硬件录制
  record-full            GDB 软件录制
  nsenter                进进程命名空间
  kubectl debug          K8s 调试 sidecar
  MIMode                 VSCode 调试器模式 (gdb/lldb)