set pagination off
set confirm off
set debuginfod enabled off
directory /opt/pg-src/postgresql-18.6
pgsetup
break LockAcquire
printf "waiting lock\n"
continue
printf "\n==== LockAcquire ====\n"
bt 8
printf "lockmode=%d\n", lockmode
detach
quit
