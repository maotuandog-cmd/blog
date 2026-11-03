"""
PG18 quant67 对照笔记 batch helper
作为脚本独立运行时, 被 __main__ 引入
"""
import os, subprocess, re
from pathlib import Path

src_root = Path('/opt/pg-src/postgresql-18.6')
ch_dir = Path('/home/obsidian/postgres/learn/quant67-pg18-study/chapters')
ev_dir = Path('/home/obsidian/postgres/learn/quant67-pg18-study/evidence')
ch_dir.mkdir(parents=True, exist_ok=True)
ev_dir.mkdir(parents=True, exist_ok=True)

env = os.environ.copy()
env['PGDATA'] = '/tmp/pg18-data'
env['PATH'] = '/opt/pg-18/bin:' + env.get('PATH', '')
env['LD_LIBRARY_PATH'] = '/opt/pg-18/lib:' + env.get('LD_LIBRARY_PATH', '')


def extract_func(file, func_name, max_chars=3000):
    """提取函数 body (粗略花括号匹配)"""
    p = src_root / file
    if not p.exists(): return ''
    text = p.read_text()
    m = re.search(rf'^[a-zA-Z_*\s]*\b{func_name}\s*\([^)]*\)\s*\n?\{{', text, flags=re.M)
    if not m: return ''
    start = m.end() - 1
    depth = 0
    i = start
    while i < len(text):
        c = text[i]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return text[m.start():i+1][:max_chars]
        i += 1
    return ''


def extract_struct(file, struct_name, max_chars=3000):
    """提取 struct/typedef 块"""
    p = src_root / file
    if not p.exists(): return ''
    text = p.read_text()
    m = re.search(rf'(?:typedef\s+)?struct\s+{struct_name}\s*\{{[^}}]+\}}\s*{struct_name}\s*;',
                  text, flags=re.S)
    if m: return m.group()[:max_chars]
    m = re.search(rf'typedef\s+struct\s+{struct_name}\s*\{{[^}}]+\}}\s*{struct_name}\s*;',
                  text, flags=re.S)
    if m: return m.group()[:max_chars]
    return ''


def write_chapter(n, title, slug, pg_loc="", excerpts="", diff="",
                  verify_sql="", gdb_hints="", next_link=""):
    course_path = Path(f'/home/obsidian/postgres/learn/quant67-pg-kernel/{n:02d}-{slug}.txt')
    out = ch_dir / f'ch{n:02d}-{slug}.md'

    md = []
    md.append(f"# 第 {n:02d} 章 对照笔记 — {title} (PG18.6)\n")
    md.append(f"> 课程原文: /home/obsidian/postgres/learn/quant67-pg-kernel/{n:02d}-{slug}.txt")
    md.append(f"> PG18 源码: /opt/pg-src/postgresql-18.6/")
    md.append(f"> 实操验证: 见末尾 evidence/ch{n:02d}-{slug}-evidence.txt\n")
    md.append("=" * 78)

    md.append("\n## 一、课程要点 (节选)\n")
    md.append("```")
    md.append(course_path.read_text()[:1800])
    md.append("```")

    md.append("\n## 二、PG18 源码定位\n")
    md.append(pg_loc)

    md.append("\n## 三、PG18 源码摘录\n")
    md.append(excerpts)

    md.append("\n## 四、PG18 vs 课程(以 PG17 为主线) 差异点\n")
    md.append(diff)

    if verify_sql:
        md.append("\n## 五、实操验证\n")
        r = subprocess.run(['psql', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '-c', verify_sql],
                           capture_output=True, text=True, env=env, timeout=20)
        ev_path = ev_dir / f'ch{n:02d}-{slug}-evidence.txt'
        with open(ev_path, 'w') as f:
            f.write(f"=== Chapter {n:02d} verification ===\n")
            f.write(r.stdout + (r.stderr if r.returncode != 0 else ''))
        md.append(f"\n**真实运行输出已保存到**: `evidence/ch{n:02d}-{slug}-evidence.txt`\n")
        md.append("\n### 关键输出\n```\n" + r.stdout + "\n```\n")
        section_gdb = "## 六、GDB 调试示例\n"
        section_sum = "## 七、小结 — 与下章衔接\n"
    else:
        section_gdb = "## 五、GDB 调试示例\n"
        section_sum = "## 六、小结 — 与下章衔接\n"

    if gdb_hints:
        md.append("\n" + section_gdb)
        md.append(gdb_hints)

    md.append("\n" + section_sum)
    md.append(next_link)

    out.write_text('\n'.join(md))
    print(f"  ch{n:02d}-{slug}.md  ({sum(len(l) for l in md)} chars)")
    return out
