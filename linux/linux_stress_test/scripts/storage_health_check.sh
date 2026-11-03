#!/bin/bash
# 存储设备健康巡检脚本
# 来源: 整合自 quant67/storage 06-storage-media-selection (md:1279-1290, 1307-1315)
# 用途: 一键采集所有块设备的 SMART / NVMe 健康读数,按告警阈值标红
# 退出码: 0=健康 1=存在告警项 2=依赖缺失

set -uo pipefail

THRESHOLD_PCT_USED=80          # SSD 寿命消耗告警阈值 (%)
THRESHOLD_AVAIL_SPARE=10       # SSD 可用备用块告警阈值 (%)
THRESHOLD_REALLOC=10           # HDD 重映射扇区阈值
THRESHOLD_HDD_TEMP=55          # HDD 温度告警 (°C)
THRESHOLD_NVME_TEMP=70         # NVMe 温度告警 (°C)

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'

WARN=0

echo "=========================================="
echo " 存储设备健康巡检 $(date '+%F %T')"
echo "=========================================="

# ---------- 1. NVMe 设备 ----------
for dev in /sys/class/nvme/nvme*; do
    [ -d "$dev" ] || continue
    name=$(basename "$dev")
    nsdev="/dev/${name}n1"
    [ -b "$nsdev" ] || continue

    echo ""
    echo "[NVMe] $nsdev"
    if ! command -v nvme >/dev/null 2>&1; then
        echo -e "  ${YELLOW}nvme-cli 未安装 (apt install nvme-cli)${NC}"
        continue
    fi

    log=$(nvme smart-log "$nsdev" 2>/dev/null)
    [ -z "$log" ] && { echo "  读取失败"; continue; }

    pct_used=$(echo "$log" | awk '/^percentage_used/ {print $3}' | tr -d '%')
    avail_spare=$(echo "$log" | awk '/^available_spare/ {print $3}' | tr -d '%')
    media_err=$(echo "$log" | awk '/^media_errors/ {print $3}')
    err_log=$(echo "$log" | awk '/^num_err_log_entries/ {print $4}')
    warn_temp=$(echo "$log" | awk '/^warning_temp_time/ {print $3}')
    crit_temp=$(echo "$log" | awk '/^critical_compliance_time/ {print $3}')
    temperature=$(echo "$log" | awk '/^temperature/ {print $2}')

    printf "  percentage_used     : %s%%\n" "$pct_used"
    printf "  available_spare     : %s%%\n" "$avail_spare"
    printf "  media_errors        : %s\n" "$media_err"
    printf "  num_err_log_entries : %s\n" "$err_log"
    printf "  temperature         : %s °C\n" "$temperature"
    printf "  warning_temp_time   : %s (ms)\n" "$warn_temp"
    printf "  critical_temp_time  : %s (ms)\n" "$crit_temp"

    # 阈值判定
    [ "${pct_used:-0}" -ge "$THRESHOLD_PCT_USED" ] && \
        { echo -e "  ${RED}WARN: percentage_used ≥ $THRESHOLD_PCT_USED%, 计划替换${NC}"; WARN=1; }
    [ "${avail_spare:-100}" -le "$THRESHOLD_AVAIL_SPARE" ] && \
        { echo -e "  ${RED}WARN: available_spare ≤ $THRESHOLD_AVAIL_SPARE%, 备用块不足${NC}"; WARN=1; }
    [ "${media_err:-0}" -gt 0 ] && \
        { echo -e "  ${RED}WARN: media_errors > 0, 存在介质错误${NC}"; WARN=1; }
    [ "${err_log:-0}" -gt 0 ] && \
        { echo -e "  ${YELLOW}WARN: 错误日志非空, 建议查 nvme get-log${NC}"; WARN=1; }
    [ "${temperature:-0}" -ge "$THRESHOLD_NVME_TEMP" ] && \
        { echo -e "  ${RED}WARN: 温度 ≥ $THRESHOLD_NVME_TEMP°C${NC}"; WARN=1; }
done

# ---------- 2. SATA/SCSI 设备 (走 SMART) ----------
if command -v smartctl >/dev/null 2>&1; then
    for dev in /sys/block/sd*; do
        [ -d "$dev" ] || continue
        bdev="/dev/$(basename "$dev")"
        rota=$(cat "$dev/queue/rotational" 2>/dev/null)
        [ -z "$rota" ] && continue

        echo ""
        echo "[$( [ "$rota" = "1" ] && echo HDD || echo SSD )] $bdev"

        attrs=$(smartctl -A "$bdev" 2>/dev/null)
        [ -z "$attrs" ] && { echo "  读取失败"; continue; }

        # 温度 (兼容 HDD/SSD)
        temp=$(echo "$attrs" | awk '/Temperature_Celsius|Temperature_Internal/ {print $10; exit}')

        # Reallocated_Sector_Ct (ID 5)
        realloc=$(echo "$attrs" | awk '$1==5 {print $10}')
        realloc=${realloc:-0}

        # Spin_Retry_Count (ID 10)
        spin=$(echo "$attrs" | awk '$1==10 {print $10}')
        spin=${spin:-0}

        # Reallocated_Event_Count (ID 196, 部分 SSD)
        realloc_evt=$(echo "$attrs" | awk '$1==196 {print $10}')
        realloc_evt=${realloc_evt:-N/A}

        # Wear Leveling Count (ID 177, Intel SSD)
        wear=$(echo "$attrs" | awk '$1==177 {print $10}')
        wear=${wear:-N/A}

        printf "  temperature         : %s °C\n" "$temp"
        printf "  Reallocated_Sectors : %s\n" "$realloc"
        printf "  Spin_Retry_Count    : %s\n" "$spin"
        printf "  Reallocated_Events  : %s\n" "$realloc_evt"
        printf "  Wear_Leveling       : %s\n" "$wear"

        [ "${realloc:-0}" -ge "$THRESHOLD_REALLOC" ] && \
            { echo -e "  ${RED}WARN: 重映射扇区 ≥ $THRESHOLD_REALLOC, 物理退化${NC}"; WARN=1; }
        [ "${spin:-0}" -gt 0 ] && \
            { echo -e "  ${RED}WARN: Spin_Retry_Count > 0, 机械故障征兆${NC}"; WARN=1; }
        [ -n "$temp" ] && [ "$temp" -ge "$THRESHOLD_HDD_TEMP" ] && [ "$rota" = "1" ] && \
            { echo -e "  ${RED}WARN: HDD 温度 ≥ $THRESHOLD_HDD_TEMP°C${NC}"; WARN=1; }
    done
else
    echo ""
    echo -e "${YELLOW}smartctl 未安装 (apt install smartmontools),跳过 SATA/SCSI 巡检${NC}"
fi

# ---------- 3. iostat 实时快照 ----------
echo ""
echo "=========================================="
echo " iostat 快照 (1 秒采样, 共 3 次)"
echo "=========================================="
if command -v iostat >/dev/null 2>&1; then
    iostat -xz 1 3 2>/dev/null
else
    echo -e "${YELLOW}sysstat 未安装 (apt install sysstat)${NC}"
fi

echo ""
if [ "$WARN" -eq 0 ]; then
    echo -e "${GREEN}所有指标在阈值内${NC}"
    exit 0
else
    echo -e "${RED}存在告警项, 请逐项排查${NC}"
    exit 1
fi