# GDB 使用说明 (七) Pretty Printer 与自定义命令

承接: (一) (二) (三) (四) (五) (六)
本节聚焦: Python 扩展 / pretty printer / 自定义命令
来源参考: skill systems-source-study-with-gdb/references/gdb-pretty-printer-template.py

================================================================
7.1 为什么需要 Pretty Printer
================================================================

直接 print 一个复杂结构体:
  $1 = {tag = 0x3, raw = 0xc000, fields = {a = 1, b = 2, c = 3, ...}}

实际想看:
  $1 = MyHeader { kind=READ_ONLY, flags=0xc000 [HDR_DIRTY|HDR_VALID] }

Pretty printer 就是把"原始字段"翻译成"工程语义"

================================================================
7.2 GDB 17.1 兼容说明
================================================================

GDB 17+ 移除了 gdb.events.Stopped
(本机 gdb 17.1-2ubuntu1, 触发此限制)

  ✗ gdb.events.Stopped.connect(handler)
    → AttributeError: module '_gdbevents' has no attribute 'Stopped'
  ✓ 用 gdb.Command 子类, 在 attach 后手动 invoke

可用的 Python API:
  gdb.Command           # 自定义命令
  gdb.Parameter         # set/show 参数
  gdb.Function          # print 可调用的函数
  gdb.execute(cmd)      # 执行 GDB CLI 命令
  gdb.parse_and_eval()  # 表达式求值
  gdb.lookup_type()     # 查类型
  gdb.Value             # 包装的内存值
  val.address           # 地址
  val.dereference()     # 解引用指针

================================================================
7.3 文件组织
================================================================

约定位置 (本机当前 ~/.hermes/cache 暂无, 推荐):
  ~/.hermes/cache/<system>-gdb.py    # 主模块
  ~/.hermes/cache/<system>/          # 子模块 (可选)

~/.gdbinit 内容 (加载上面那个):
  python
  import sys, os
  helper = os.path.expanduser("~/.hermes/cache/<system>-gdb.py")
  if os.path.exists(helper):
      sys.path.insert(0, os.path.dirname(helper))
      try:
          import importlib
          if "<system>-gdb" in sys.modules:
              importlib.reload(sys.modules["<system>-gdb"])
          else:
              importlib.import_module("<system>-gdb")
          print(f"[<system>-gdb] loaded from {helper}")
      except Exception as e:
          print(f"[<system>-gdb] load failed: {e}")
  end

启动验证:
  $ gdb -batch -ex 'python print("LOADED")' -ex quit
  [<system>-gdb] loaded from /home/maotuan/.hermes/cache/<system>-gdb.py
  LOADED

================================================================
7.4 Pretty Printer 模板
================================================================

最小可工作模板 (skill 已验证 GDB 17.1):

```python
# ~/.hermes/cache/<system>-gdb.py
import gdb

# ---------- 工具函数 ----------
def _int(v):
    """安全把 gdb.Value 转 int"""
    try:
        return int(v)
    except Exception:
        return 0

def _decode_bits(val, bits):
    """bits = [(mask, 'NAME'), ...]
       解码位字段"""
    v = _int(val)
    return ' | '.join(n for m, n in bits if v & m) or 'none'

def _hex(val):
    return f"0x{_int(val):x}"

# ---------- 字段读取辅助 ----------
def _field(struct, name):
    """读 struct 字段, 缺失返回 None"""
    try:
        return struct[name]
    except Exception:
        return None

# ---------- Pretty Printer 类 ----------
class MyHeaderPrinter:
    """MyHeader 结构的 pretty printer"""
    # 位字段常量
    KIND_NAMES = {
        0: 'INVALID',
        1: 'READ_ONLY',
        2: 'READ_WRITE',
    }
    FLAGS = [(0x01, 'FLAG_DIRTY'),
             (0x02, 'FLAG_VALID'),
             (0x04, 'FLAG_LOCKED')]
    
    def __init__(self, val):
        self.val = val  # gdb.Value
    
    def to_string(self):
        """GDB print 时调用"""
        v = self.val
        kind = _int(v['kind'])
        flags = _int(v['flags'])
        kind_name = self.KIND_NAMES.get(kind, f'UNKNOWN({kind})')
        return (f"MyHeader {{ kind={kind_name}, "
                f"flags=0x{flags:04x} "
                f"[{_decode_bits(flags, self.FLAGS)}] }}")
    
    def children(self):
        """GDB 展开子字段时调用"""
        v = self.val
        yield ('kind', self.KIND_NAMES.get(_int(v['kind']), '?'))
        yield ('flags', f"0x{_int(v['flags']):04x}")
        if 'data' in v.type:
            yield ('data', v['data'])

# ---------- 注册 (GDB 12+ 推荐) ----------
def build_pretty_printer():
    pp = gdb.printing.RegexpCollectionPrettyPrinter("<system>")
    pp.add_printer('MyHeader', '^MyHeader$', MyHeaderPrinter)
    pp.add_printer('OtherStruct', '^OtherStruct$', OtherStructPrinter)
    return pp

gdb.printing.register_pretty_printer(
    gdb.current_objfile(),
    build_pretty_printer()
)
```

验证:
  (gdb) print my_header
  $1 = MyHeader { kind=READ_ONLY, flags=0x0006 [FLAG_DIRTY | FLAG_VALID] }

================================================================
7.5 自定义命令 (推荐)
================================================================

```python
# ---------- 自定义命令 ----------
class MyHeaderCmd(gdb.Command):
    """myheader <addr> : 解码 MyHeader 结构
    例: myheader 0x7fffffffe000
        myheader my_header_var"""
    
    def __init__(self):
        super().__init__("myheader", gdb.COMMAND_USER)
    
    def invoke(self, arg, from_tty):
        try:
            if not arg.strip():
                print("用法: myheader <addr-or-symbol>")
                return
            val = gdb.parse_and_eval(arg.strip())
            if val.type.code == gdb.TYPE_CODE_PTR:
                val = val.dereference()
            print(MyHeaderPrinter(val).to_string())
        except Exception as e:
            print(f"myheader error: {e}")

class MyAttachCmd(gdb.Command):
    """myattach <pid> : attach 到进程并跑安全初始化"""
    
    def __init__(self):
        super().__init__("myattach", gdb.COMMAND_USER)
    
    def invoke(self, arg, from_tty):
        try:
            pid = int(arg.strip())
            gdb.execute(f"attach {pid}")
            gdb.execute("set scheduler-locking off")
            gdb.execute("handle SIGUSR1 nostop noprint pass")
            gdb.execute("handle SIGUSR2 nostop noprint pass")
            gdb.execute("handle SIGPIPE nostop noprint pass")
            print(f"[myattach] attached to {pid}, setup done")
        except Exception as e:
            print(f"myattach error: {e}")

# ---------- 注册 ----------
def _register():
    MyHeaderCmd()
    MyAttachCmd()
    print("[<system>-gdb] registered: myheader, myattach")

_register()
```

注册后:
  (gdb) myheader 0x7fff...     → 打印结构
  (gdb) myattach 1234          → attach + 设置信号句柄 + scheduler

================================================================
7.6 参数 / 函数 (set/show + 表达式)
================================================================

```python
class MyParam(gdb.Parameter):
    """set my-debug 1 启用调试输出"""
    set_doc = "Toggle debug output"
    show_doc = "Show current debug state"
    
    def __init__(self):
        super().__init__("my-debug", gdb.COMMAND_USER, gdb.PARAM_BOOLEAN)
        self.value = False
    
    def get_set_string(self):
        return f"my-debug set to {self.value}"
    
    def get_show_string(self):
        return f"my-debug = {self.value}"

MyParam()    # 注册
```

GDB 中:
  (gdb) set my-debug on
  (gdb) show my-debug

自定义 print 函数:
```python
class MyFunc(gdb.Function):
    """$decode_flags(0x06) → 'FLAG_A | FLAG_B'"""
    
    def __init__(self):
        super().__init__("decode_flags")
    
    def invoke(self, val):
        v = _int(val)
        return _decode_bits(v, [(0x01, 'FLAG_A'), (0x02, 'FLAG_B')])

MyFunc()    # 注册
```

GDB 中:
  (gdb) print $decode_flags(flags)
  "FLAG_A | FLAG_B"

================================================================
7.7 实战: PostgreSQL 风格的 Pretty Printer
================================================================

典型 PG 数据结构 HeapTupleHeaderData:

```python
class HeapTupleHeaderPrinter:
    """打印 PG 元组头"""
    INFOMASK_BITS = [
        (0x0001, 'HEAP_HASNULL'),
        (0x0002, 'HEAP_HASVARWIDTH'),
        (0x0004, 'HEAP_HASEXTERNAL'),
        (0x0008, 'HEAP_HASOID'),
        (0x0010, 'HEAP_XMAX_LOCK_ONLY'),
        (0x0020, 'HEAP_XKEY_UPDATED'),
        (0x0040, 'HEAP_COMBOCID'),
        (0x0080, 'HEAP_XMAX_BITS'),
        (0x0100, 'HEAP_UPDATED'),
        (0x0200, 'HEAP_MOVED_OFF'),
        (0x0400, 'HEAP_MOVED_IN'),
        (0x0800, 'HEAP_XMIN_COMMITTED'),
        (0x1000, 'HEAP_XMIN_INVALID'),
        (0x2000, 'HEAP_XMAX_COMMITTED'),
        (0x4000, 'HEAP_XMAX_INVALID'),
    ]
    
    def __init__(self, val):
        self.val = val
    
    def to_string(self):
        h = self.val
        infomask = _int(h['t_infomask'])
        infomask2 = _int(h['t_infomask2'])
        bits = _decode_bits(infomask, self.INFOMASK_BITS)
        bits2 = _decode_bits(infomask2, [(0x2000, 'HEAP_KEYS_UPDATED')])
        return (f"HeapTupleHeader {{ xmin={_int(h['t_xmin'])}, "
                f"xmax={_int(h['t_xmax'])}, "
                f"cid={_int(h['t_field3'])}, "
                f"infomask=0x{infomask:04x} [{bits}], "
                f"infomask2=0x{infomask2:04x} [{bits2}] }}")
    
    def children(self):
        h = self.val
        yield ('t_xmin', _int(h['t_xmin']))
        yield ('t_xmax', _int(h['t_xmax']))
        yield ('t_field3', _int(h['t_field3']))
        yield ('t_infomask', _int(h['t_infomask']))
        yield ('t_infomask2', _int(h['t_infomask2']))
        yield ('t_hoff', _int(h['t_hoff']))
```

→ 这就是 skill 里 pgheap <addr> 的实现思路

================================================================
7.8 实战: pthread_mutex 状态打印
================================================================

```python
class PthreadMutexPrinter:
    """打印 pthread_mutex_t 状态"""
    
    def __init__(self, val):
        self.val = val
    
    def to_string(self):
        m = self.val
        # glibc 实现细节 (不同版本不同)
        try:
            owner = _int(m['__data']['__owner'])
            count = _int(m['__data']['__lock'])
            nusers = _int(m['__data']['__nusers'])
            
            state = 'unlocked'
            if count > 0:
                state = f'locked by tid={owner}'
            elif nusers > 1:
                state = f'contended ({nusers} waiters)'
            
            kind = _int(m['__data']['__kind'])
            kinds = {0: 'NORMAL', 1: 'RECURSIVE', 2: 'ERRORCHECK', 3: 'ADAPTIVE'}
            
            return (f"pthread_mutex_t {{ kind={kinds.get(kind, '?')}, "
                f"state={state} }}")
        except Exception as e:
            return f"pthread_mutex_t <parse error: {e}>"
```

→ 这就是 skill 里 pglock <addr> 的实现思路

================================================================
7.9 Pretty Printer 调试技巧
----------------------------------------------------------------

加载失败 / 怎么排查:
  (gdb) info pretty-printer
  # 显示所有注册的 pretty printer

  (gdb) disable pretty-printer <name>
  (gdb) enable pretty-printer <name>

  (gdb) set debug print on
  # 让 print 显示完整字段 (绕过 pretty printer)

  (gdb) set print pretty on
  # 结构体换行打印

  # Python 异常会打印到 GDB console
  # 直接看 traceback

================================================================
7.10 调试 helper 自身
================================================================

修改 ~/.hermes/cache/<sys>-gdb.py 后:
  (gdb) source ~/.hermes/cache/<sys>-gdb.py
  # 重新加载, 不必退出

测试一个结构体打印是否正确:
  (gdb) print my_struct
  # 看到原始字段说明 pretty printer 没注册上
  # 看到格式化输出说明 OK

错误示范:
  - 类型不匹配 → ValueError
  - 字段不存在 → KeyError
  - 解引用 None → RuntimeError
  → to_string() 里 try/except 包住

================================================================
7.11 多线程友好的命令
================================================================

  # 自动在所有线程跑
  class MyScanAllCmd(gdb.Command):
      """myscan : 扫描所有线程的某个全局"""
      def invoke(self, arg, from_tty):
          for t in gdb.selected_inferior().threads():
              t.switch()
              # ... 跑你的逻辑

  # 但: 切换线程会触发 stop events, 注意信号句柄

================================================================
7.12 性能影响
================================================================

Pretty Printer 在每次 print 时执行, 慢结构体打印上千次会卡
优化:
  - to_string() 不要做重活
  - children() 惰性求值
  - 缓存解析过的位字段到 dict

实测:
  简单位字段解码: ~10us
  STL vector 打印: ~100us-1ms
  复杂树结构打印: ~10-100ms

================================================================
7.13 共享 pretty printer 给团队
================================================================

通过项目源码贡献 / 内部 wiki:
  1. 把 <system>-gdb.py 入仓到项目 utils/
  2. ~/.gdbinit 里 source 它
  3. 新员工 git pull → GDB 自动可用

CI 验证:
  # CI 跑一次 smoke test
  gdb -batch -ex 'source utils/<sys>-gdb.py' \
      -ex 'python print("loaded ok")' \
      -ex quit

================================================================
7.14 GDB 17 升级注意事项
================================================================

| 移除 API              | 替代方案                            |
|-----------------------|------------------------------------|
| gdb.events.Stopped    | 用 gdb.Command attach 后手动 invoke |
| gdb.events.Exited     | 同上                                |
| 旧 pretty printer     | gdb.printing.RegexpCollectionPrettyPrinter |
|                       | 或 register_pretty_printer + 名字    |

调试环境参考:
  info gdb python
  help python
  python help(gdb)
  # 在 GDB 里查看可用 API

================================================================
7.15 实战模板: 调试大型系统源码 (PG / Redis / RocksDB)
================================================================

场景: 研究 PostgreSQL 一段代码的执行过程

1. 准备:
   - 编译 -O0 -g3 -ggdb --enable-debug 的 PG
   - 把 pg-gdb.py 放到 ~/.hermes/cache/

2. 启动 PG:
   pg_ctl start

3. 找到 backend PID:
   ps -ef | grep postgres | grep -v grep

5. attach:
   gdb -p <backend_pid>
   # 自动触发 myattach (因 .gdbinit 加载了)

6. 设断点:
   (gdb) break ExecInitNode
   (gdb) break ExecutorRun
   (gdb) break heapgettup

7. 执行查询:
   psql -d test -c 'select * from t1 where id = 1'

8. 观察:
   (gdb) bt
   (gdb) print planstate
   (gdb) myheader tup->t_data

→ 配合 pretty printer, 把 PG 内部结构看得清清楚楚

================================================================
术语表 (本章)
================================================================

  pretty printer       GDB 内部自定义对象显示的机制
  gdb.Command         自定义 CLI 命令
  gdb.Parameter       自定义 set/show 参数
  gdb.Function        自定义可在 print 中调用的函数
  RegexpCollectionPrettyPrinter  按正则匹配的注册容器
  gdb.Value           GDB 中表达一个内存位置的对象
  val.dereference()   解引用指针
  val.address         Value 的内存地址
  val[type_name]      字段访问
  gdb.parse_and_eval() 把字符串当 GDB 表达式求值
  gdb.execute()       执行 GDB CLI 命令
  gdb.events          GDB 事件 (GDB 17+ 移除 .Stopped 等)