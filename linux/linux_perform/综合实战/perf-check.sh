#!/usr/bin/env bash
# Linux 性能快检：按 USE 扫一遍资源，再列出可疑进程。
# 阈值是启发式，不同负载基线不同，只标「该往哪钻」，不是告警系统。
#
# 用法:
#   ./perf-check.sh              # 采样 3 秒
#   ./perf-check.sh -s 5 -n 8    # 采样 5 秒，进程榜 8 条
#   sudo ./perf-check.sh         # 部分 /proc、dmesg OOM 更完整
set -u

SAMPLE=3
TOPN=5

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \?//'
  exit 0
}

while getopts "s:n:h" opt; do
  case "$opt" in
    s) SAMPLE="$OPTARG" ;;
    n) TOPN="$OPTARG" ;;
    h) usage ;;
    *) usage ;;
  esac
done

if ! [[ "$SAMPLE" =~ ^[1-9][0-9]*$ ]]; then
  echo "采样秒数必须是正整数" >&2
  exit 2
fi

if [[ -t 1 ]]; then
  C_RED=$'\033[31m'
  C_YEL=$'\033[33m'
  C_GRN=$'\033[32m'
  C_CYN=$'\033[36m'
  C_DIM=$'\033[2m'
  C_OFF=$'\033[0m'
else
  C_RED= C_YEL= C_GRN= C_CYN= C_DIM= C_OFF=
fi

WARN=0
CRIT=0
HINTS=()

have() { command -v "$1" >/dev/null 2>&1; }

note() { HINTS+=("$1"); }

flag() {
  local level="$1" msg="$2" hint="${3:-}"
  case "$level" in
    crit)
      CRIT=$((CRIT + 1))
      printf '%s[CRIT]%s %s\n' "$C_RED" "$C_OFF" "$msg"
      ;;
    warn)
      WARN=$((WARN + 1))
      printf '%s[WARN]%s %s\n' "$C_YEL" "$C_OFF" "$msg"
      ;;
    ok)
      printf '%s[OK]%s   %s\n' "$C_GRN" "$C_OFF" "$msg"
      ;;
    info)
      printf '%s[INFO]%s %s\n' "$C_CYN" "$C_OFF" "$msg"
      ;;
  esac
  [[ -n "$hint" ]] && note "$hint"
}

section() {
  printf '\n%s== %s ==%s\n' "$C_CYN" "$1" "$C_OFF"
}

ncpu=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo)
read -r load1 load5 load15 running_total _ </proc/loadavg
running=${running_total%%/*}

mem_kb() { awk -v k="$1" '$1==k":"{print $2; exit}' /proc/meminfo; }

read_cpu() {
  # 输出: user nice system idle iowait irq softirq steal ctxt intr procs_running
  awk '
    /^cpu / { u=$2; n=$3; s=$4; i=$5; w=$6; h=$7; si=$8; st=$9 }
    /^ctxt / { c=$2 }
    /^intr / { ir=$2 }
    /^procs_running / { pr=$2 }
    END { print u, n, s, i, w, h, si, st, c, ir, pr }
  ' /proc/stat
}

read_vm() {
  awk '
    /^(pswpin|pswpout|pgmajfault|pgfault) / { v[$1]=$2 }
    END {
      printf "%s %s %s %s\n", v["pswpin"]+0, v["pswpout"]+0, v["pgmajfault"]+0, v["pgfault"]+0
    }
  ' /proc/vmstat
}

read_softirq() {
  # /proc/softirqs 第一列自带冒号，如 HI:
  awk 'NR==1 { next }
       {
         name=$1
         sub(/:$/, "", name)
         t=0
         for (i=2;i<=NF;i++) t+=$i
         printf "%s=%s ", name, t
       }
       END { print "" }' /proc/softirqs
}

read_disk() {
  # name rd_ios rd_ticks wr_ios wr_ticks io_ticks
  awk '
    {
      name=$3
      if (name ~ /loop|ram|zram|fd|sr/) next
      if (name ~ /^nvme.*p[0-9]+$/) next
      if (name ~ /^(sd|vd|hd|xvd)[a-z]+[0-9]+$/) next
      if (name ~ /^mmcblk[0-9]+p[0-9]+$/) next
      print name, $4, $7, $8, $11, $13
    }
  ' /proc/diskstats
}

read_net() {
  awk -F'[: ]+' '
    NR>2 {
      i=1
      if ($1=="") i=2
      iface=$i
      if (iface=="" || iface=="lo") next
      print iface, $(i+1), $(i+9), $(i+3), $(i+11), $(i+4), $(i+12)
    }
  ' /proc/net/dev
}

tcp_snmp() {
  awk '
    /^Tcp: / && !hdr { split($0, h); hdr=1; next }
    /^Tcp: / && hdr {
      for (i=1;i<=NF;i++) t[h[i]]=$i
      print t["OutSegs"]+0, t["RetransSegs"]+0, t["CurrEstab"]+0, t["InErrs"]+0
    }
  ' /proc/net/snmp
}

listen_drops() {
  awk '
    /^TcpExt: / && !hdr { split($0, h); hdr=1; next }
    /^TcpExt: / && hdr {
      for (i=1;i<=NF;i++) t[h[i]]=$i
      print t["ListenOverflows"]+0, t["ListenDrops"]+0, t["TCPAbortOnMemory"]+0
    }
  ' /proc/net/netstat 2>/dev/null || echo "0 0 0"
}

pct() {
  awk -v a="$1" -v b="$2" 'BEGIN{
    if (b<=0) { print 0; exit }
    printf "%.1f", 100.0*a/b
  }'
}

delta() { awk -v a="$1" -v b="$2" 'BEGIN{print a-b}'; }

rate() {
  awk -v a="$1" -v b="$2" -v s="$3" 'BEGIN{
    if (s<=0) { print 0; exit }
    printf "%.1f", (a-b)/s
  }'
}

cgroup_mem() {
  local cur max
  if [[ -f /sys/fs/cgroup/memory.current ]]; then
    cur=$(cat /sys/fs/cgroup/memory.current)
    max=$(cat /sys/fs/cgroup/memory.max)
    echo "v2 $cur $max"
    return
  fi
  if [[ -f /sys/fs/cgroup/memory/memory.usage_in_bytes ]]; then
    cur=$(cat /sys/fs/cgroup/memory/memory.usage_in_bytes)
    max=$(cat /sys/fs/cgroup/memory/memory.limit_in_bytes)
    echo "v1 $cur $max"
    return
  fi
  echo "none 0 0"
}

cgroup_cpu() {
  if [[ -f /sys/fs/cgroup/cpu.max ]]; then
    read -r quota period </sys/fs/cgroup/cpu.max
    echo "v2 $quota $period"
    return
  fi
  if [[ -f /sys/fs/cgroup/cpu/cpu.cfs_quota_us ]]; then
    echo "v1 $(cat /sys/fs/cgroup/cpu/cpu.cfs_quota_us) $(cat /sys/fs/cgroup/cpu/cpu.cfs_period_us)"
    return
  fi
  echo "none 0 0"
}

in_container() {
  [[ -f /.dockerenv ]] && return 0
  [[ -f /run/.containerenv ]] && return 0
  grep -qaE 'docker|lxc|kubepods|containerd' /proc/1/cgroup 2>/dev/null
}

# ---------- 采样 ----------
cpu1=$(read_cpu)
vm1=$(read_vm)
soft1=$(read_softirq)
disk1=$(read_disk)
net1=$(read_net)
tcp1=$(tcp_snmp)
ext1=$(listen_drops)
tcp1=${tcp1:-0 0 0 0}
ext1=${ext1:-0 0 0}

PIDSTAT_LOG=""
PIDSTAT_PID=""
if have pidstat; then
  PIDSTAT_LOG=$(mktemp /tmp/perf-check-pidstat.XXXXXX)
  pidstat -u -d -r 1 "$SAMPLE" >"$PIDSTAT_LOG" 2>/dev/null &
  PIDSTAT_PID=$!
fi

sleep "$SAMPLE"
if [[ -n "$PIDSTAT_PID" ]]; then
  wait "$PIDSTAT_PID" 2>/dev/null || true
fi

cpu2=$(read_cpu)
vm2=$(read_vm)
soft2=$(read_softirq)
disk2=$(read_disk)
net2=$(read_net)
tcp2=$(tcp_snmp)
ext2=$(listen_drops)
tcp2=${tcp2:-0 0 0 0}
ext2=${ext2:-0 0 0}

# ---------- 标题 ----------
printf '%sLinux 性能快检%s  %s  kernel %s  nproc=%s  sample=%ss\n' \
  "$C_CYN" "$C_OFF" "$(hostname)" "$(uname -r)" "$ncpu" "$SAMPLE"
printf '%s%s  load %s %s %s  running %s%s\n' \
  "$C_DIM" "$(date '+%F %T %z')" "$load1" "$load5" "$load15" "$running" "$C_OFF"
if in_container; then
  flag info "当前像在容器里：free/top 看到的是宿主机资源，限额看下面 cgroup"
fi

# ---------- CPU ----------
section "CPU（USE：使用率 / 饱和度）"
read -r u1 n1 s1 i1 w1 h1 si1 st1 c1 ir1 pr1 <<<"$cpu1"
read -r u2 n2 s2 i2 w2 h2 si2 st2 c2 ir2 pr2 <<<"$cpu2"
dt=$(awk -v a="$u1 $n1 $s1 $i1 $w1 $h1 $si1 $st1" -v b="$u2 $n2 $s2 $i2 $w2 $h2 $si2 $st2" '
  BEGIN{
    split(a,x); split(b,y); t=0
    for (i=1;i<=8;i++) t+=y[i]-x[i]
    if (t<=0) t=1
    printf "%.1f %.1f %.1f %.1f %.1f %.1f %.1f %d\n",
      100*(y[1]-x[1]+y[2]-x[2])/t,
      100*(y[3]-x[3])/t,
      100*(y[5]-x[5])/t,
      100*(y[7]-x[7])/t,
      100*(y[6]-x[6])/t,
      100*(y[8]-x[8])/t,
      100*(y[4]-x[4])/t,
      t
  }')
read -r pus psy pwa psi phi pst pidle _ <<<"$dt"
cs_s=$(rate "$c2" "$c1" "$SAMPLE")
in_s=$(rate "$ir2" "$ir1" "$SAMPLE")

printf "  us=%s%%  sy=%s%%  wa=%s%%  si=%s%%  hi=%s%%  st=%s%%  idle=%s%%\n" \
  "$pus" "$psy" "$pwa" "$psi" "$phi" "$pst" "$pidle"
printf "  上下文切换 %s/s  中断 %s/s  procs_running=%s\n" "$cs_s" "$in_s" "$pr2"

awk -v l="$load1" -v n="$ncpu" 'BEGIN{exit !(l>n)}' && \
  flag warn "1分钟负载 $load1 > 逻辑核 $ncpu（饱和：跑队列偏长）" \
    "下一步: vmstat 1 看 r/b；r 高回 top，b 高转 I/O" || \
  flag ok "负载 $load1 / ${ncpu} 核，暂未超过核数"

awk -v u="$pus" -v s="$psy" 'BEGIN{exit !(u+s>90)}' && \
  flag crit "用户+内核 CPU ${pus}+${psy}% > 90%" \
    "下一步: pidstat -u 1；us 高 strace/perf，sy 高查系统调用或内核线程" || \
awk -v u="$pus" -v s="$psy" 'BEGIN{exit !(u+s>80)}' && \
  flag warn "用户+内核 CPU ${pus}+${psy}% > 80%" \
    "下一步: pidstat -u 1 找进程" || \
  flag ok "计算型 CPU（us+sy）未打满"

awk -v w="$pwa" 'BEGIN{exit !(w>40)}' && \
  flag crit "iowait ${pwa}% 很高（等块设备/NFS，不是套接字）" \
    "下一步: iostat -d -x 1 再 pidstat -d 1" || \
awk -v w="$pwa" 'BEGIN{exit !(w>20)}' && \
  flag warn "iowait ${pwa}% 偏高" \
    "下一步: iostat -d -x 1" || true

awk -v s="$psi" 'BEGIN{exit !(s>20)}' && \
  flag warn "软中断 si=${psi}% 偏高" \
    "下一步: watch -n1 cat /proc/softirqs；NET_RX 则 sar -n DEV + tcpdump" || true

awk -v s="$pst" 'BEGIN{exit !(s>5)}' && \
  flag warn "steal st=${pst}% ，虚拟机 CPU 被宿主机抢走" \
    "下一步: 查超卖或同机其他虚机" || true

awk -v cs="$cs_s" -v n="$ncpu" 'BEGIN{exit !(cs>n*20000)}' && \
  flag warn "切换 ${cs_s}/s 很高" \
    "下一步: pidstat -w 1 看自愿/非自愿；非自愿多是抢 CPU" || true

# 软中断增量最大的类型
section "软中断（本窗口增量最大）"
if ! SOFT1="$soft1" SOFT2="$soft2" python3 <<'PY'
import os
a, b = os.environ.get("SOFT1",""), os.environ.get("SOFT2","")
def parse(s):
    d={}
    for p in s.split():
        if '=' in p:
            k,v=p.split('=',1)
            d[k]=int(v)
    return d
da, db = parse(a), parse(b)
items=sorted(((db.get(k,0)-da.get(k,0), k) for k in db), reverse=True)
shown=False
for n,k in items[:5]:
    if n>0:
        print(f"  {k:16s} +{n}")
        shown=True
if not shown:
    print("  本窗口软中断增量很小")
PY
then
  printf '  %s无法解析 softirqs（需要 python3）%s\n' "$C_DIM" "$C_OFF"
fi

# ---------- 内存 ----------
section "内存（USE：容量 / 换页=饱和）"
mt=$(mem_kb MemTotal)
ma=$(mem_kb MemAvailable)
mf=$(mem_kb MemFree)
buf=$(mem_kb Buffers)
cac=$(mem_kb Cached)
sre=$(mem_kb SReclaimable)
st=$(mem_kb SwapTotal)
sf=$(mem_kb SwapFree)
su=$((st - sf))
avail_pct=$(pct "$ma" "$mt")
used_without_cache=$((mt - mf - buf - cac - sre))

printf "  Total=%sMB  Available=%sMB (%s%%)  Free=%sMB  Buff=%sMB  Cache=%sMB\n" \
  $((mt/1024)) $((ma/1024)) "$avail_pct" $((mf/1024)) $((buf/1024)) $((cac/1024))
printf "  Swap used=%sMB / %sMB\n" $((su/1024)) $((st/1024))

read -r pin1 pout1 maj1 pf1 <<<"$vm1"
read -r pin2 pout2 maj2 pf2 <<<"$vm2"
si=$(rate "$pin2" "$pin1" "$SAMPLE")
so=$(rate "$pout2" "$pout1" "$SAMPLE")
maj=$(rate "$maj2" "$maj1" "$SAMPLE")
printf "  换入 %s 页/s  换出 %s 页/s  主缺页 %s/s\n" "$si" "$so" "$maj"

awk -v p="$avail_pct" 'BEGIN{exit !(p<5)}' && \
  flag crit "MemAvailable 只剩 ${avail_pct}% ，新进程几乎没空间" \
    "下一步: 排除 cache 后 pidstat -r / top 按 M；pmap 看地址空间" || \
awk -v p="$avail_pct" 'BEGIN{exit !(p<10)}' && \
  flag warn "MemAvailable ${avail_pct}% 偏低" \
    "下一步: free -h；pidstat -r 1 找大户" || \
  flag ok "MemAvailable ${avail_pct}% ，暂时够用（Cache 大不等于内存不够）"

if (( st > 0 )); then
  swp=$(pct "$su" "$st")
  awk -v p="$swp" 'BEGIN{exit !(p>30)}' && \
    flag warn "Swap 已用 ${swp}%" \
      "下一步: 看 si/so 是否仍在换；能关 Swap 就关，或降 swappiness" || true
fi
awk -v a="$si" -v b="$so" 'BEGIN{exit !(a+b>1)}' && \
  flag warn "正在换页 si=${si}/s so=${so}/s ，访问会变慢" \
    "下一步: sar -B；/proc/pid/status 的 VmSwap" || \
  flag ok "本窗口几乎没有 Swap 换入换出"

awk -v m="$maj" 'BEGIN{exit !(m>100)}' && \
  flag warn "主缺页 ${maj}/s 偏高（要走磁盘/Swap）" \
    "下一步: pidstat -r 1 看 majflt" || true

read -r cgv cgcur cgmax <<<"$(cgroup_mem)"
if [[ "$cgv" != "none" ]]; then
  if [[ "$cgmax" == "max" || "$cgmax" == "-1" || "$cgmax" -gt 9000000000000000000 ]]; then
    flag info "cgroup 内存无上限（$cgv），进程看到的还可能是宿主机容量"
  else
    cgp=$(pct "$cgcur" "$cgmax")
    printf "  cgroup 内存 %s  %sMB / %sMB (%s%%)\n" \
      "$cgv" $((cgcur/1024/1024)) $((cgmax/1024/1024)) "$cgp"
    awk -v p="$cgp" 'BEGIN{exit !(p>90)}' && \
      flag crit "cgroup 内存用了 ${cgp}% ，容易 OOMKilled=137" \
        "下一步: dmesg | grep -i oom；Java 要按限额设 -Xmx 并留非堆余量" || \
    awk -v p="$cgp" 'BEGIN{exit !(p>75)}' && \
      flag warn "cgroup 内存 ${cgp}%" \
        "下一步: 对照容器 -m 和进程实际堆/RSS" || true
  fi
fi

read -r cpv quota period <<<"$(cgroup_cpu)"
if [[ "$cpv" != "none" && "$quota" != "max" && "$quota" != "-1" && "$period" -gt 0 ]]; then
  cores=$(awk -v q="$quota" -v p="$period" 'BEGIN{printf "%.2f", q/p}')
  flag info "cgroup CPU 限额 ≈ ${cores} 核（quota/period）。限额过小启动会干等，pidstat %wait 会很高"
  awk -v c="$cores" 'BEGIN{exit !(c<0.5)}' && \
    flag warn "CPU 限额只有 ${cores} 核，启动/编译会非常慢" \
      "下一步: 按压测定限额，不要图省事去掉，也不要设成 0.1 核" || true
fi

# ---------- I/O ----------
section "磁盘 I/O（使用率>60% 就要警惕）"
disk_out=$(python3 - "$SAMPLE" "$disk1" "$disk2" <<'PY'
import sys
sec=float(sys.argv[1])
def parse(block):
    d={}
    for line in block.strip().splitlines():
        p=line.split()
        if len(p)<6: continue
        d[p[0]]=list(map(int,p[1:]))
    return d
a,b=parse(sys.argv[2]), parse(sys.argv[3])
print("  设备           util%   await_ms    rIOPS   wIOPS")
print("  " + "-"*52)
any_dev=False
for name, v2 in sorted(b.items(), key=lambda kv: kv[1][4], reverse=True):
    v1=a.get(name,[0,0,0,0,0])
    rd, rdt, wr, wrt, iot = (v2[i]-v1[i] for i in range(5))
    ios=rd+wr
    util=min(100.0, iot/10.0/sec)
    await_ms=(rdt+wrt)/ios if ios else 0
    print(f"  {name:12s} {util:6.1f}  {await_ms:8.1f}  {rd/sec:7.1f} {wr/sec:7.1f}")
    any_dev=True
    if util>=90:
        print(f"FLAG crit {name} util {util:.1f}%")
    elif util>=60:
        print(f"FLAG warn {name} util {util:.1f}%")
    if await_ms>=50 and ios>10:
        print(f"FLAG warn {name} await {await_ms:.1f}ms")
if not any_dev:
    print("  没有可统计的块设备")
PY
)
while IFS= read -r line; do
  if [[ "$line" == FLAG* ]]; then
    set -- $line
    flag "$2" "磁盘 $3 $4 $5" "下一步: iostat -d -x 1；pidstat -d 1；用户进程再 strace -f + lsof"
  else
    printf '%s\n' "$line"
  fi
done <<<"$disk_out"

section "文件系统容量 / inode"
df -hT -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | sed 's/^/  /'
while read -r mp pused; do
  [[ -z "${mp:-}" ]] && continue
  pu=${pused%%%}
  if awk -v p="$pu" 'BEGIN{exit !(p>=95)}'; then
    flag crit "磁盘 $mp 已用 ${pused}" "下一步: du -xhd1 $mp | sort -h"
  elif awk -v p="$pu" 'BEGIN{exit !(p>=85)}'; then
    flag warn "磁盘 $mp 已用 ${pused}" "下一步: du -xhd1 $mp | sort -h"
  fi
done < <(df -P -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | awk 'NR>1{print $6,$5}')

while read -r _ mp ip; do
  [[ -z "${mp:-}" ]] && continue
  flag warn "inode $mp 已用 $ip（小文件会先把 inode 用光）" "下一步: df -i；查大量小文件目录"
done < <(df -iP -x tmpfs -x devtmpfs 2>/dev/null | awk 'NR>1 && $5+0>=80 {print "x",$6,$5}')

# ---------- 网络 ----------
section "网络（吞吐 / 错误 / 连接）"
net_out=$(python3 - "$SAMPLE" "$net1" "$net2" <<'PY'
import sys
sec=float(sys.argv[1])
def parse(b):
    d={}
    for line in b.strip().splitlines():
        p=line.split()
        if len(p)<7: continue
        d[p[0]]=list(map(int,p[1:]))
    return d
a,b=parse(sys.argv[2]), parse(sys.argv[3])
if not b:
    print("  没有读到网卡计数")
    raise SystemExit(0)
print("  接口          RX MB/s   TX MB/s   rxerr/s txerr/s rxdrop/s txdrop/s")
print("  " + "-"*70)
for name,v2 in sorted(b.items()):
    v1=a.get(name,[0]*6)
    rx,tx,re,te,rd,td=[(v2[i]-v1[i])/sec for i in range(6)]
    print(f"  {name:12s} {rx/1048576:8.3f} {tx/1048576:8.3f}  {re:7.1f} {te:7.1f} {rd:8.1f} {td:8.1f}")
    if re+te>0:
        print(f"FLAG warn {name} 网卡错误 rxerr={re:.1f}/s txerr={te:.1f}/s")
    if rd+td>1:
        print(f"FLAG warn {name} 网卡丢包 rxdrop={rd:.1f}/s txdrop={td:.1f}/s")
PY
)
while IFS= read -r line; do
  if [[ "$line" == FLAG* ]]; then
    set -- $line
    shift
    lvl=$1; shift
    flag "$lvl" "$*" "下一步: 按层查 sar -n EDEV / ethtool -S；软中断则 /proc/softirqs"
  else
    printf '%s\n' "$line"
  fi
done <<<"$net_out"

read -r out1 retr1 estab1 _ <<<"$tcp1"
read -r out2 retr2 estab2 _ <<<"$tcp2"
out_s=$(rate "$out2" "$out1" "$SAMPLE")
retr_s=$(rate "$retr2" "$retr1" "$SAMPLE")
retr_ratio=$(awk -v r="$retr2 $retr1" -v o="$out2 $out1" 'BEGIN{
  split(r,a); split(o,b); rd=a[1]-a[2]; od=b[1]-b[2];
  if (od<=0) { print 0; exit }
  printf "%.2f", 100*rd/od
}')
printf "  TCP 已建立=%s  发送段 %s/s  重传 %s/s  本窗口重传率 %s%%\n" \
  "$estab2" "$out_s" "$retr_s" "$retr_ratio"
awk -v p="$retr_ratio" 'BEGIN{exit !(p>3)}' && \
  flag warn "TCP 重传率 ${retr_ratio}% 偏高" \
    "下一步: ss -ti；tcpdump 看是否丢包/延迟/窗口" || true

read -r ov1 drop1 abort1 <<<"$ext1"
read -r ov2 drop2 abort2 <<<"$ext2"
if (( ov2 > ov1 || drop2 > drop1 )); then
  flag warn "ListenOverflows +$((ov2-ov1))  ListenDrops +$((drop2-drop1))" \
    "下一步: ss -ltn 看 Recv-Q；加大 backlog / 应用 accept 太慢"
fi
if (( abort2 > abort1 )); then
  flag warn "TCPAbortOnMemory +$((abort2-abort1))（tcp 内存压力）" \
    "下一步: dmesg | grep tcp_mem；看 net.ipv4.tcp_mem"
fi

if have ss; then
  printf "  ss 状态统计: "
  ss -ant 2>/dev/null | awk 'NR>1{c[$1]++} END{for (k in c) printf "%s=%s ", k, c[k]; print ""}'
else
  flag info "未安装 ss，跳过连接状态（iproute2）"
fi

ct_count=""
ct_max=""
for f in \
  /proc/sys/net/netfilter/nf_conntrack_count \
  /proc/sys/net/ipv4/netfilter/ip_conntrack_count; do
  [[ -r "$f" ]] && ct_count=$(cat "$f") && break
done
for f in \
  /proc/sys/net/netfilter/nf_conntrack_max \
  /proc/sys/net/ipv4/netfilter/ip_conntrack_max; do
  [[ -r "$f" ]] && ct_max=$(cat "$f") && break
done
if [[ -n "$ct_count" && -n "$ct_max" && "$ct_max" -gt 0 ]]; then
  ctp=$(pct "$ct_count" "$ct_max")
  printf "  conntrack %s / %s (%s%%)\n" "$ct_count" "$ct_max" "$ctp"
  awk -v p="$ctp" 'BEGIN{exit !(p>=90)}' && \
    flag crit "conntrack 表 ${ctp}% ，新连接会丢/变慢" \
      "下一步: 查 NAT/防火墙规则；适当加大 nf_conntrack_max 或减超时" || \
  awk -v p="$ctp" 'BEGIN{exit !(p>=80)}' && \
    flag warn "conntrack ${ctp}%" \
      "下一步: conntrack -S 或看表项谁在占" || \
    flag ok "conntrack ${ctp}%"
fi

if [[ -r /proc/net/sockstat ]]; then
  printf "  sockstat: %s\n" "$(tr '\n' ' ' </proc/net/sockstat)"
fi

# ---------- 软件资源 ----------
section "软件资源（fd / 进程数）"
file_nr=$(cat /proc/sys/fs/file-nr)
file_max=$(awk '{print $3}' <<<"$file_nr")
file_used=$(awk '{print $1}' <<<"$file_nr")
fdp=$(pct "$file_used" "$file_max")
if awk -v m="$file_max" 'BEGIN{exit !(m>1000000000)}'; then
  printf "  系统 fd 已用 %s  file-max 未限制\n" "$file_used"
else
  printf "  系统 fd %s / %s (%s%%)\n" "$file_used" "$file_max" "$fdp"
  awk -v p="$fdp" 'BEGIN{exit !(p>=80)}' && \
    flag warn "系统文件句柄 ${fdp}%" "下一步: lsof | awk '{print \$1}' | sort | uniq -c | sort -nr | head" || \
    flag ok "系统 fd ${fdp}%"
fi

threads=$(ps -eL --no-headers 2>/dev/null | wc -l)
pid_max=$(cat /proc/sys/kernel/pid_max)
printf "  线程约 %s  pid_max=%s\n" "$threads" "$pid_max"

d_count=$(ps -eo state --no-headers 2>/dev/null | awk '$1=="D"{n++} END{print n+0}')
z_count=$(ps -eo state --no-headers 2>/dev/null | awk '$1=="Z"{n++} END{print n+0}')
printf "  D(不可中断)=%s  Z(僵尸)=%s\n" "$d_count" "$z_count"
(( d_count > 5 )) && flag warn "不可中断进程 D=${d_count}（常等 I/O）" \
  "下一步: ps -eo pid,stat,wchan:20,cmd | awk '\$2 ~ /D/'"
(( z_count > 5 )) && flag warn "僵尸进程 Z=${z_count}（父进程没 wait）" \
  "下一步: ps -eo pid,ppid,stat,cmd | awk '\$3 ~ /Z/'"

# ---------- 进程榜 ----------
section "进程榜 CPU（瞬时，已排除本脚本）"
ps -eo pcpu,pmem,pid,user,stat,comm --sort=-pcpu --no-headers \
  | awk -v self="$$" -v n="$TOPN" '
      $3==self || $6=="ps" || $6=="awk" || $6=="perf-check.sh" { next }
      ++c<=n { printf "  %6s%%cpu %5s%%mem %6s %-10s %-4s %s\n",$1,$2,$3,$4,$5,$6 }
    '

section "进程榜 RSS"
ps -eo rss,pcpu,pid,user,stat,comm --sort=-rss --no-headers | awk -v n="$TOPN" 'NR<=n{printf "  %8.0fMB %6s%%cpu %6s %-10s %-4s %s\n",$1/1024,$2,$3,$4,$5,$6}'

if have pidstat && [[ -n "$PIDSTAT_LOG" && -s "$PIDSTAT_LOG" ]]; then
  section "pidstat 本窗口平均（sysstat）"
  awk 'NF && $0 ~ /Average:/ && $0 !~ /Average:.*CPU/{print "  "$0}' "$PIDSTAT_LOG" | head -n "$TOPN"
  rm -f "$PIDSTAT_LOG"
elif have pidstat; then
  flag info "pidstat 本窗口没有进程行（太闲或权限不足）"
  rm -f "$PIDSTAT_LOG"
else
  flag info "未安装 pidstat（sysstat）。建议: apt install sysstat"
fi

# ---------- OOM 近况 ----------
if have dmesg; then
  oom=$(dmesg -T 2>/dev/null | grep -iE 'oom-kill|Out of memory' | tail -n 3)
  if [[ -n "$oom" ]]; then
    section "dmesg 里最近的 OOM"
    printf '%s\n' "$oom" | sed 's/^/  /'
    flag warn "内核记录过 OOM" "下一步: journalctl -k | grep -i oom；对照 cgroup 限额"
  fi
fi

# ---------- 汇总 ----------
section "结论"
if (( CRIT + WARN == 0 )); then
  flag ok "本窗口没打到启发式阈值。偶发问题要靠监控留历史，不要只扫一次。"
else
  printf "  合计 %sCRIT %s / WARN %s%s\n" "$C_RED" "$CRIT" "$WARN" "$C_OFF"
fi

if ((${#HINTS[@]})); then
  printf '\n%s建议的下一步（去重）:%s\n' "$C_CYN" "$C_OFF"
  printf '%s\n' "${HINTS[@]}" | awk 'NF && !seen[$0]++ {print "  - "$0}'
fi

cat <<EOF

${C_DIM}应用变慢还要看 RED（QPS / 错误率 / 延迟），本脚本只扫机器资源。
CPU 很低也可能被锁或 RPC 拖死。跨服务用 TraceID，细节在日志里。${C_OFF}
EOF
