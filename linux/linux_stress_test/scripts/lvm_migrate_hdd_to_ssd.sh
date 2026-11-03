#!/bin/bash
# LVM 在线介质迁移: HDD → SSD (业务不中断)
# 来源: quant67/storage 06-storage-media-selection (md:1352-1362)
# 用法: sudo ./lvm_migrate_hdd_to_ssd.sh <源PV> <目标PV> <VG名>
# 例:   sudo ./lvm_mdd_to_ssd.sh /dev/sda1 /dev/nvme0n1p1 vg0

set -euo pipefail

if [ $# -ne 3 ]; then
    echo "用法: $0 <源PV> <目标PV> <VG名>"
    echo "例:   $0 /dev/sda1 /dev/nvme0n1p1 vg0"
    exit 2
fi

SRC_PV=$1
DST_PV=$2
VG=$3

# 前置检查
command -v pvmove >/dev/null 2>&1 || { echo "LVM 工具未安装"; exit 1; }

echo "==== 1. 检查 VG 与 PV 状态 ===="
pvs "$SRC_PV" "$DST_PV" 2>&1
vgs "$VG" 2>&1

echo ""
echo "==== 2. 初始化目标 SSD PV ===="
pvcreate "$DST_PV"

echo ""
echo "==== 3. 扩展 VG (把 SSD 加入) ===="
vgextend "$VG" "$DST_PV"

echo ""
echo "==== 4. 启动 pvmove 在线迁移 ===="
echo "    数据从 $SRC_PV 迁移到 $DST_PV"
echo "    进度监控: watch -n 5 'lvs'"
echo ""
pvmove "$SRC_PV" "$DST_PV"

echo ""
echo "==== 5. 迁移完成, 验证 ===="
pvs "$SRC_PV" "$DST_PV"

echo ""
echo "==== 6. 从 VG 移除源 PV ===="
vgreduce "$VG" "$SRC_PV"
pvremove "$SRC_PV"

echo ""
echo "==== 完成 ===="
echo "当前 LV 分布:"
lvs -o+devices "$VG"