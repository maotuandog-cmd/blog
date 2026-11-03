set pagination off
set confirm off
set print pretty on
set debuginfod enabled off
directory /opt/pg-src/postgresql-18.6

pgsetup
printf "\n==== bt after attach ====\n"
bt 8
printf "\n==== pgproc ====\n"
pgproc
printf "\n==== pgshare ====\n"
pgshare
printf "\n==== pglocks ====\n"
pglocks

python
import gdb

class Once(gdb.Breakpoint):
    def __init__(self, spec, extra=None):
        super().__init__(spec)
        self.hits = 0
        self.extra = extra or []
        self.silent = True

    def stop(self):
        self.hits += 1
        gdb.write("\n==== LIVE HIT %s #%d ====\n" % (self.location, self.hits))
        gdb.execute("bt 12")
        for cmd in self.extra:
            try:
                gdb.execute(cmd)
            except Exception as e:
                gdb.write("extra error: %s\n" % e)
        self.enabled = False
        gdb.write("---- disabled %s ----\n" % self.location)
        return False

Once("heap_insert", extra=[
    'printf "tup->t_len=%u t_data=%p\\n", tup->t_len, tup->t_data',
    'pgheap tup->t_data',
    'pgproc',
])
Once("XLogInsert", extra=['printf "rmid=%u info=0x%02x\\n", rmid, info'])
end

printf "\n==== waiting for heap_insert / XLogInsert ====\n"
continue
printf "\n==== done, detaching ====\n"
detach
quit
