set pagination off
set confirm off
set debuginfod enabled off
directory /opt/pg-src/postgresql-18.6
pgsetup
break heap_insert
printf "waiting at heap_insert\n"
continue
printf "\n==== stopped at heap_insert ====\n"
bt 12
printf "tup->t_len=%u t_data=%p\n", tup->t_len, tup->t_data
pgheap tup->t_data
pgproc
detach
quit
