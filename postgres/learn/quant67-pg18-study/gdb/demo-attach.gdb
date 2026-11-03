set pagination off
attach 28674
pgsetup
echo \n=== bt ===\n
bt 6
echo \n=== pgproc ===\n
pgproc
echo \n=== pglocks ===\n
pglocks
echo \n=== pgshare ===\n
pgshare
echo \n=== info threads ===\n
info threads
detach
quit
