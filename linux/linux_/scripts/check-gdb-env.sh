#!/bin/bash
# GDB 调试环境诊断脚本
# 来源: gdb-02 调试环境与准备 (二) 2.7 + skill systems-source-study-with-gdb/scripts/check-gdb-prereqs.sh
# 用法: bash check-gdb-env.sh [binary-path] [pid]
# 例:   bash check-gdb-env.sh /usr/bin/myprog 1234

set -u

BIN=${1:-}
PID=${2:-}

echo "=== GDB 调试环境诊断 ==="
echo "时间: $(date '+%F %T')"
echo "用户: $(whoami) (uid=$(id -u))"
echo "内核: $(uname -r)"

echo
echo "=== 1. GDB 安装与版本 ==="
if ! command -v gdb >/dev/null 2>&1; then
    echo "  FAIL: gdb 未安装"
    echo "  安装: sudo apt-get install gdb   (Debian/Ubuntu)"
    echo "        sudo yum install gdb        (RHEL/CentOS)"
    exit 2
fi
GDB_VER=$(gdb --version | head -1)
echo "  $GDB_VER"
GDB_MAJOR=$(gdb --version | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1 | cut -d. -f1)
if [ "${GDB_MAJOR:-0}" -ge 17 ]; then
    echo "  NOTE: GDB 17+ 移除了 gdb.events.Stopped, 自定义命令需手动触发"
fi
# 配套工具
for cmd in gdbserver gdb-multiarch; do
    if command -v $cmd >/dev/null 2>&1; then
        echo "  ✓ $cmd: $(command -v $cmd)"
    else
        echo "  ✗ $cmd 未安装 (远程/跨平台调试需要)"
    fi
done

echo
echo "=== 2. ptrace 权限 ==="
PTRACE=$(cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || echo "unknown")
echo "  kernel.yama.ptrace_scope = $PTRACE"
echo "    0 = classic (允许任意 attach)"
echo "    1 = restricted (默认, 同 uid 父子进程)"
echo "    2 = admin only"
echo "    3 = no attach"

if [ "$PTRACE" = "1" ] || [ "$PTRACE" = "2" ] || [ "$PTRACE" = "3" ]; then
    GDB_PATH=$(which gdb)
    SETCAP=$(getcap "$GDB_PATH" 2>/dev/null)
    if [ -n "$SETCAP" ]; then
        echo "  ✓ gdb 已有 setcap: $SETCAP"
        echo "  ✓ 可以直接 attach 同 uid 进程"
    else
        echo "  ✗ gdb 没有 setcap, 修法 (三选一):"
        echo "    A. sudo setcap cap_sys_ptrace+ep $GDB_PATH  (持久)"
        echo "    B. sudo sysctl -w kernel.yama.ptrace_scope=0 (临时, 重启失效)"
        echo "    C. sudo gdb -p <pid>                        (临时, 每会话 sudo)"
    fi
fi

echo
echo "=== 3. Core dump 配置 ==="
ULIMIT_C=$(ulimit -c)
echo "  ulimit -c = $ULIMIT_C (当前 shell)"
echo "  推荐: ulimit -c unlimited"

if [ -f /proc/sys/kernel/core_pattern ]; then
    PATTERN=$(cat /proc/sys/kernel/core_pattern)
    echo "  /proc/sys/kernel/core_pattern = $PATTERN"
    # 检测 apport/systemd-coredump
    if echo "$PATTERN" | grep -q "apport"; then
        echo "  ⚠ Ubuntu apport 接管 core, 用 coredumpctl 或 /var/log/apport 取 dump"
    elif echo "$PATTERN" | grep -q "systemd-coredump"; then
        echo "  ✓ systemd-coredump 接管"
    else
        echo "  → 直接写到当前目录, 文件名按 pattern 规则"
    fi
fi

if command -v coredumpctl >/dev/null 2>&1; then
    DUMP_COUNT=$(coredumpctl list 2>/dev/null | grep -c -i core || echo 0)
    echo "  ✓ systemd-coredumpctl 可用"
    echo "  已有 dump 数: $DUMP_COUNT"
    echo "  操作: coredumpctl list | gdb | info"
else
    echo "  ✗ coredumpctl 未装 (apt install systemd-coredump)"
fi

echo
echo "=== 4. 调试符号服务器 (debuginfod) ==="
# 检查 debuginfod 配置
if [ -d ~/.cache/debuginfod ] || [ -d /var/cache/debuginfod ]; then
    echo "  ✓ 本地有 debuginfod 缓存"
else
    echo "  ✗ 未配置 debuginfod, 调试第三方二进制会缺符号"
    echo "  安装: apt install debuginfod  (Ubuntu)"
    echo "        dnf install debuginfo-install (Fedora)"
    echo "  GDB 内启用: set debuginfod enabled on"
fi

echo
echo "=== 5. Python 集成 (GDB 7+ 内置) ==="
GDB_PY_RAW=$(gdb -batch -ex 'python import sys; print("GDBPY", sys.version_info[:3])' -ex quit 2>&1)
GDB_PY=$(echo "$GDB_PY_RAW" | grep -m1 '^GDBPY' | awk '{print $2, $3, $4}')
if [ -n "$GDB_PY" ]; then
    echo "  ✓ Python 集成可用: $GDB_PY"
    echo "  验证: gdb -batch -ex 'python print(\"OK\")' -ex quit"
else
    echo "  ✗ Python 集成失败 (无法用 pretty printer)"
    echo "  故障排查:"
    echo "    $ gdb -batch -ex 'python print(\"OK\")' -ex quit"
    echo "    看是否有 ImportError"
fi

echo
echo "=== 6. 验证二进制 (如提供) ==="
if [ -n "$BIN" ]; then
    if [ ! -f "$BIN" ]; then
        echo "  FAIL: 文件不存在: $BIN"
    else
        if file "$BIN" | grep -q "with debug_info"; then
            echo "  ✓ $BIN 含调试符号"
        else
            echo "  ✗ $BIN 无调试符号"
            echo "  重新编译: gcc -O0 -g3 -ggdb foo.c -o foo"
            echo "  或安装 debuginfo 包"
        fi
        NM_COUNT=$(nm "$BIN" 2>/dev/null | wc -l)
        echo "  符号数: $NM_COUNT"
        if [ "$NM_COUNT" -lt 1000 ]; then
            echo "  ⚠ 符号数偏少, 可能是 stripped 二进制"
        fi
    fi
fi

echo
echo "=== 7. 目标进程 (如提供 PID) ==="
if [ -n "$PID" ]; then
    if ! kill -0 "$PID" 2>/dev/null; then
        echo "  FAIL: PID $PID 不存在"
        exit 3
    fi
    PID_OWNER=$(ps -o user= -p "$PID")
    MY_UID=$(id -u)
    PID_UID=$(id -u "$PID_OWNER" 2>/dev/null || echo "?")
    echo "  PID $PID 存活, owner=$PID_OWNER (uid=$PID_UID)"
    if [ "$MY_UID" != "$PID_UID" ] && [ "$PID_UID" != "?" ]; then
        echo "  ✗ UID 不匹配 ($MY_UID vs $PID_UID), 需要 sudo 或 setcap"
    else
        echo "  ✓ UID 一致"
    fi

    # 看进程状态
    STATE=$(ps -o stat= -p "$PID" 2>/dev/null)
    echo "  进程状态: $STATE"
    if echo "$STATE" | grep -qE 'D|Z'; then
        echo "  ⚠ 进程在 D (不可中断) 或 Z (僵尸) 状态, GDB attach 不会工作"
    fi
fi

echo
echo "=== 诊断完成 ==="
echo "下一步:"
echo "  1. 解决 ptrace 问题 (见第 2 节)"
echo "  2. 启用 core dump (见第 3 节)"
echo "  3. 装 Pretty printer (见 gdb-07)"
echo "  4. 跑通冒烟测试: gdb -batch -ex 'break main' -ex 'run' -ex 'bt' ./prog"