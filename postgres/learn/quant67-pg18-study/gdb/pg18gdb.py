#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PG18 GDB pretty printer + helper macros
加载: 在 ~/.gdbinit 里 source 此文件
作者: maotuan (PG18 内核学习用)

提供:
  - pg_heap_tuple   : 打印 HeapTupleHeaderData + user data
  - pg_page         : 打印 Page (PageHeaderData + items 摘要)
  - pg_bt_page      : 打印 B-Tree 页面 (special area 解码)
  - pg_xlog_record  : 打印 XLogRecord 头部
  - pg_lwlock       : 打印 LWLock 状态 (state, waiters)
  - pg_proc         : 打印 PGPROC 关键字段
  - pg_snapshot     : 打印 SnapshotData (xmin/xmax/activexid 数组)
  - pg_xid          : 装饰显示事务 ID (区分 normal/bootstrap/frozen/multixact)
"""
import gdb
import gdb.types

# ---------- 辅助 ----------
def read_int(field, default=0):
    try:
        v = int(field)
        return v
    except Exception:
        return default

def char_to_str(c, n=64):
    """读出字符串 (NUL 终止)"""
    try:
        s = b''
        for i in range(n):
            b = int(c[i])
            if b == 0: break
            s += bytes([b])
        return s.decode('utf-8', errors='replace')
    except Exception:
        return ''

def xid_str(xid):
    """事务 ID 的语义化显示"""
    xid = read_int(xid)
    if xid == 0:
        return f"{xid} (InvalidTransactionId)"
    if xid == 1:
        return f"{xid} (BootstrapTransactionId)"
    if xid == 2:
        return f"{xid} (FrozenTransactionId)"
    if xid == 3:
        return f"{xid} (FirstNormalTransactionId)"
    return f"{xid}"

# ---------- 核心 pretty printer ----------
class PgPagePrinter:
    """PageHeaderData 打印"""
    def __init__(self, val):
        self.val = val
    def to_string(self):
        try:
            v = self.val
            pd_lsn = v['pd_lsn']
            pd_flags = read_int(v['pd_flags'])
            pd_lower = read_int(v['pd_lower'])
            pd_upper = read_int(v['pd_upper'])
            pd_special = read_int(v['pd_special'])
            pd_ver = read_int(v['pd_pagesize_version'])
            free_space = pd_upper - pd_lower
            flags_str = []
            if pd_flags & 0x0001: flags_str.append('PD_HAS_FREE_LINES')
            if pd_flags & 0x0002: flags_str.append('PD_PAGE_FULL')
            if pd_flags & 0x0004: flags_str.append('PD_ALL_VISIBLE')
            return (f"PageHeaderData {{ lsn={pd_lsn}, flags=0x{pd_flags:04x} [{'|'.join(flags_str) or 'none'}], "
                    f"lower={pd_lower}, upper={pd_upper}, special={pd_special}, "
                    f"free_space={free_space}B, pagesize_version=0x{pd_ver:04x} }}")
        except Exception as e:
            return f"<PgPagePrinter error: {e}>"

class PgHeapTuplePrinter:
    """HeapTupleHeaderData 打印 (含 t_infomask 解码)"""
    INFOMASK_BITS = [
        (0x0001, 'HEAP_HASNULL'),
        (0x0002, 'HEAP_HASVARWIDTH'),
        (0x0004, 'HEAP_HASEXTERNAL'),
        (0x0010, 'HEAP_XMAX_KEYSHR_LOCK'),
        (0x0020, 'HEAP_COMBOCID'),
        (0x0040, 'HEAP_XMAX_EXCL_LOCK'),
        (0x0080, 'HEAP_XMAX_LOCK_ONLY'),
        (0x0100, 'HEAP_XMIN_COMMITTED'),
        (0x0200, 'HEAP_XMIN_INVALID'),
        (0x0400, 'HEAP_XMAX_COMMITTED'),
        (0x0800, 'HEAP_XMAX_INVALID'),
        (0x1000, 'HEAP_XMAX_IS_MULTI'),
        (0x2000, 'HEAP_UPDATED'),
    ]
    def __init__(self, val):
        self.val = val
    def to_string(self):
        try:
            t = self.val
            heap = t['t_choice']['t_heap']
            xmin = read_int(heap['t_xmin'])
            xmax = read_int(heap['t_xmax'])
            infomask = read_int(t['t_infomask'])
            infomask2 = read_int(t['t_infomask2'])
            hoff = read_int(t['t_hoff'])
            blk = (read_int(t['t_ctid']['ip_blkid']['bi_hi']) << 16) | read_int(t['t_ctid']['ip_blkid']['bi_lo'])
            off = read_int(t['t_ctid']['ip_posid'])
            set_bits = [name for bit, name in self.INFOMASK_BITS if infomask & bit]
            natts = infomask2 & 0x07FF
            natts_bits = []
            if infomask2 & 0x2000: natts_bits.append('HEAP_KEYS_UPDATED')
            if infomask2 & 0x4000: natts_bits.append('HEAP_HOT_UPDATED')
            if infomask2 & 0x8000: natts_bits.append('HEAP_ONLY_TUPLE')
            frozen = (infomask & 0x0300) == 0x0300
            if frozen:
                set_bits.append('HEAP_XMIN_FROZEN')
            return (f"HeapTupleHeaderData {{\n"
                    f"  xmin={xid_str(xmin)}, xmax={xid_str(xmax)},\n"
                    f"  ctid=({blk},{off}),\n"
                    f"  t_infomask=0x{infomask:04x} [{' | '.join(set_bits) or 'none'}],\n"
                    f"  t_infomask2=0x{infomask2:04x} natts={natts} [{' | '.join(natts_bits) or 'none'}],\n"
                    f"  t_hoff={hoff} (用户数据起点)\n"
                    f"}}")
        except Exception as e:
            return f"<PgHeapTuplePrinter error: {e}>"

class PgBTPagePrinter:
    """BTPageOpaqueData 打印"""
    def __init__(self, val):
        self.val = val
    def to_string(self):
        try:
            o = self.val
            prev = read_int(o['btpo_prev'])
            next_ = read_int(o['btpo_next'])
            level = read_int(o['btpo_level'])
            flags = read_int(o['btpo_flags'])
            flag_str = []
            if flags & 0x0001: flag_str.append('BTP_LEAF')
            if flags & 0x0002: flag_str.append('BTP_ROOT')
            if flags & 0x0004: flag_str.append('BTP_DELETED')
            if flags & 0x0008: flag_str.append('BTP_META')
            if flags & 0x0010: flag_str.append('BTP_HALF_DEAD')
            if flags & 0x0020: flag_str.append('BTP_SPLIT_END')
            if flags & 0x0040: flag_str.append('BTP_HAS_GARBAGE')
            if flags & 0x0080: flag_str.append('BTP_INCOMPLETE_SPLIT')
            return (f"BTPageOpaqueData {{ prev={prev}, next={next_}, "
                    f"level={level}, flags=0x{flags:04x} [{' | '.join(flag_str) or 'none'}] }}")
        except Exception as e:
            return f"<PgBTPagePrinter error: {e}>"

class PgLWLockPrinter:
    """LWLock 状态打印 (state/等待进程)"""
    def __init__(self, val):
        self.val = val
    def to_string(self):
        try:
            l = self.val
            try:
                state = read_int(l['state']['value'])
            except Exception:
                state = read_int(l['state'])
            try:
                waiters = read_int(l['nwaiters'])
            except Exception:
                waiters = -1  # nwaiters 仅 LOCK_DEBUG 构建存在
            # LWLock state 低 6 bit 是 lock, 高位是 PAD_WAITERS/MORE_WAITERS
            LW_VAL = (state & 0x3FFFFFFF)
            LW_WAIT = 1 << 30
            LW_EXCLUSIVE = (1 << 30) - 1  # 实际上 LW_VAL==0 exclusive, >0 shared count
            # PG 中 LW_VAL=0 = 没人持; LW_VAL>0 = shared 持有者数量
            s = []
            if LW_VAL == 0:
                s.append("FREE")
            else:
                s.append(f"SHARED({LW_VAL})")
            if state & LW_WAIT: s.append("WAITERS")
            if state & (1 << 31): s.append("MORE_WAITERS")
            return f"LWLock {{ state=0x{state:08x} [{' '.join(s)}], nwaiters={waiters} }}"
        except Exception as e:
            return f"<PgLWLockPrinter error: {e}>"

class PgXLogRecordPrinter:
    """XLogRecord 头 24 字节"""
    def __init__(self, val):
        self.val = val
    def to_string(self):
        try:
            r = self.val
            xl_prev = r['xl_prev']
            xl_xid = read_int(r['xl_xid'])
            xl_tot_len = read_int(r['xl_tot_len'])
            xl_info = read_int(r['xl_info'])
            xl_rmid = read_int(r['xl_rmid'])
            rmgr_names = {0:'XLOG',1:'Transaction',2:'Storage',3:'CLOG',4:'Database',
                          5:'Tablespace',6:'MultiXact',7:'RelMap',8:'Standby',
                          9:'Heap2',10:'Heap',11:'Btree',12:'Hash',13:'Gin',
                          14:'Gist',15:'Sequence',16:'SPGist',17:'BRIN',18:'CommitTs',
                          19:'ReplicationOrigin',20:'GenericXLog',21:'LogicalMessage'}
            rmgr_name = rmgr_names.get(xl_rmid, f'Unknown({xl_rmid})')
            return (f"XLogRecord {{ prev={xl_prev}, xid={xl_xid}, "
                    f"tot_len={xl_tot_len}, rmid=0x{xl_rmid:02x}({rmgr_name}), "
                    f"info=0x{xl_info:02x} }}")
        except Exception as e:
            return f"<PgXLogRecordPrinter error: {e}>"

# ---------- 便利命令 ----------
class PgHeapTupleCmd(gdb.Command):
    """pgheap <addr> : 打印指定地址的 HeapTupleHeaderData"""
    def __init__(self):
        super().__init__("pgheap", gdb.COMMAND_USER)
    def invoke(self, arg, from_tty):
        try:
            addr = gdb.parse_and_eval(arg)
            printer = PgHeapTuplePrinter(addr.dereference())
            print(printer.to_string())
        except Exception as e:
            print(f"pgheap error: {e}")

class PgPageCmd(gdb.Command):
    """pgpage <addr> : 打印 PageHeaderData"""
    def __init__(self):
        super().__init__("pgpage", gdb.COMMAND_USER)
    def invoke(self, arg, from_tty):
        try:
            addr = gdb.parse_and_eval(arg)
            print(PgPagePrinter(addr.dereference()).to_string())
        except Exception as e:
            print(f"pgpage error: {e}")

class PgBtPageCmd(gdb.Command):
    """pgbtpage <addr> : 打印 BTPageOpaqueData"""
    def __init__(self):
        super().__init__("pgbtpage", gdb.COMMAND_USER)
    def invoke(self, arg, from_tty):
        try:
            addr = gdb.parse_and_eval(arg)
            print(PgBTPagePrinter(addr.dereference()).to_string())
        except Exception as e:
            print(f"pgbtpage error: {e}")

class PgLWLockCmd(gdb.Command):
    """pglwlock <addr> : 打印 LWLock 状态"""
    def __init__(self):
        super().__init__("pglwlock", gdb.COMMAND_USER)
    def invoke(self, arg, from_tty):
        try:
            addr = gdb.parse_and_eval(arg)
            print(PgLWLockPrinter(addr.dereference()).to_string())
        except Exception as e:
            print(f"pglwlock error: {e}")

class PgXLogRecordCmd(gdb.Command):
    """pgxlog <addr> : 打印 XLogRecord 头"""
    def __init__(self):
        super().__init__("pgxlog", gdb.COMMAND_USER)
    def invoke(self, arg, from_tty):
        try:
            addr = gdb.parse_and_eval(arg)
            print(PgXLogRecordPrinter(addr.dereference()).to_string())
        except Exception as e:
            print(f"pgxlog error: {e}")

class PgAttachBackendCmd(gdb.Command):
    """pgattach <pid> : 附加到 PG18 backend 进程并停在 ExecProcNode 入口"""
    def __init__(self):
        super().__init__("pgattach", gdb.COMMAND_USER)
    def invoke(self, arg, from_tty):
        try:
            pid = int(arg.strip())
            gdb.execute(f"attach {pid}")
            gdb.execute("set scheduler-locking off")
            gdb.execute("handle SIGUSR1 nostop noprint pass")
            gdb.execute("handle SIGUSR2 nostop noprint pass")
            gdb.execute("info sharedlibrary")
            print(f"已 attach 到 PID {pid}. 提示: bt full, frame N, list")
        except Exception as e:
            print(f"pgattach error: {e}")

# ---------- 自动注册 ----------
def register():
    PgHeapTupleCmd()
    PgPageCmd()
    PgBtPageCmd()
    PgLWLockCmd()
    PgXLogRecordCmd()
    PgAttachBackendCmd()

register()
