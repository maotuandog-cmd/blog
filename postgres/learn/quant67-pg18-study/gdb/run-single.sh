#!/bin/bash
exec /opt/pg-18/bin/postgres --single -D /tmp/pg18-gdb-data postgres \
  < /home/obsidian/postgres/learn/quant67-pg18-study/gdb/batch1-sql.sql
