set pagination off
set confirm off
set print pretty on
set debuginfod enabled off
directory /opt/pg-src/postgresql-18.6

python
import gdb

class LimitedBp(gdb.Breakpoint):
    def __init__(self, spec, limit=1, extra=None):
        super().__init__(spec)
        self.limit = limit
        self.hits = 0
        self.extra = extra or []
        self.silent = True

    def stop(self):
        self.hits += 1
        gdb.write("\n==== HIT %s #%d ====\n" % (self.location, self.hits))
        try:
            gdb.execute("bt 8")
        except Exception as e:
            gdb.write("bt error: %s\n" % e)
        for cmd in self.extra:
            try:
                gdb.execute(cmd)
            except Exception as e:
                gdb.write("extra error (%s): %s\n" % (cmd, e))
        if self.hits >= self.limit:
            self.enabled = False
            gdb.write("---- disabled %s ----\n" % self.location)
        return False

LimitedBp("GetSnapshotData", limit=1, extra=['pgproc'])
LimitedBp("HeapTupleSatisfiesMVCC", limit=2)
LimitedBp("HeapTupleSetHintBits", limit=2, extra=[
    'printf "infomask|=0x%04x xid=%u\\n", infomask, xid',
])
LimitedBp("AssignTransactionId", limit=1, extra=['pgproc'])
LimitedBp("StartTransaction", limit=1)
LimitedBp("CommitTransaction", limit=1)
LimitedBp("LockAcquire", limit=1)
LimitedBp("lazy_scan_heap", limit=1)
end

pgsetup
printf "[batch2] breakpoints ready\n"
continue
printf "\n==== continue returned (unexpected) ====\n"
detach
quit
