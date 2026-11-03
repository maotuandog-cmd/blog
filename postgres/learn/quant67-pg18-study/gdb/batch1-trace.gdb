set pagination off
set confirm off
set print pretty on
directory /opt/pg-src/postgresql-18.6

python
import gdb

class LimitedBp(gdb.Breakpoint):
    def __init__(self, spec, limit=2, extra=None):
        super().__init__(spec)
        self.limit = limit
        self.hits = 0
        self.extra = extra
        self.silent = True

    def stop(self):
        self.hits += 1
        gdb.write("\n==== HIT %s #%d ====\n" % (self.location, self.hits))
        try:
            gdb.execute("bt 10", to_string=False)
        except Exception as e:
            gdb.write("bt error: %s\n" % e)
        if self.extra:
            cmds = self.extra if isinstance(self.extra, (list, tuple)) else [self.extra]
            for cmd in cmds:
                try:
                    gdb.execute(cmd, to_string=False)
                except Exception as e:
                    gdb.write("extra error (%s): %s\n" % (cmd, e))
        if self.hits >= self.limit:
            self.enabled = False
            gdb.write("---- disabled %s after %d hits ----\n" % (self.location, self.hits))
        return False

LimitedBp("InitProcess", limit=1)
LimitedBp("PostgresMain", limit=1)
LimitedBp("heap_insert", limit=2, extra=[
    'printf "tup->t_len=%u t_data=%p\\n", tup->t_len, tup->t_data',
    'pgheap tup->t_data',
])
LimitedBp("XLogInsert", limit=3, extra=['printf "rmid=%u info=0x%02x\\n", rmid, info'])
LimitedBp("CreateCheckPoint", limit=2, extra=['printf "flags=%d\\n", flags'])
LimitedBp("StrategyGetBuffer", limit=2)
end

printf "[batch1] breakpoints ready, starting postgres --single\n"
run --single -D /tmp/pg18-gdb-data postgres < /home/obsidian/postgres/learn/quant67-pg18-study/gdb/batch1-sql.sql
printf "\n==== inferior exited ====\n"
quit
