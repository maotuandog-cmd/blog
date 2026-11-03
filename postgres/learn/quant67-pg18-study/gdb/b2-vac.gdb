set pagination off
set confirm off
set debuginfod enabled off
directory /opt/pg-src/postgresql-18.6
pgsetup
break lazy_scan_heap
printf "waiting vacuum\n"
continue
printf "\n==== lazy_scan_heap ====\n"
bt 8
detach
quit
