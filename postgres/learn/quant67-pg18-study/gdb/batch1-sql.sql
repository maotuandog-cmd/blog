CREATE TABLE t_heap(id int, v text);
INSERT INTO t_heap VALUES (1, 'hello-gdb');
CHECKPOINT;
SELECT id, v FROM t_heap;
CREATE TABLE t_buf(id int);
INSERT INTO t_buf SELECT g FROM generate_series(1, 200) g;
SELECT count(*) FROM t_buf;
CHECKPOINT;
