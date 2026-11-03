set pagination off
set confirm off
set debuginfod enabled off
directory /opt/pg-src/postgresql-18.6
pgsetup
break HeapTupleSatisfiesMVCC
break HeapTupleSetHintBits
printf "waiting MVCC\n"
continue
printf "\n==== stop1 %s ====\n", $_function
bt 8
continue
printf "\n==== stop2 %s ====\n", $_function
bt 6
detach
quit
