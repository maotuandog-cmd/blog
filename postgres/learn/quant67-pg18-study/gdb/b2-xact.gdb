set pagination off
set confirm off
set debuginfod enabled off
directory /opt/pg-src/postgresql-18.6
pgsetup
break StartTransaction
break AssignTransactionId
break CommitTransaction
printf "waiting xact\n"
continue
printf "\n==== %s ====\n", $_function
bt 6
pgproc
continue
printf "\n==== %s ====\n", $_function
bt 6
pgproc
continue
printf "\n==== %s ====\n", $_function
bt 6
pgproc
detach
quit
