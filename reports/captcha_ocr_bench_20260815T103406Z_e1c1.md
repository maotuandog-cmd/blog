# E1-C.1 Joint Evidence Attribution (captcha_ocr_bench_20260815T103406Z.json)

- label: `E1-C2-A-stability`
- accepts: **40** (true=24, FA=16)

## Matrix: charEvidence × independentSource

| cell | correct | wrong | total | FAR in cell | share of FA | share of true |
|------|--------:|------:|------:|------------:|------------:|--------------:|
| `strong|agree` | 7 | 0 | 7 | 0% | 0% | 29% |
| `strong|conflict` | 3 | 1 | 4 | 25% | 6% | 12% |
| `weak|agree` | 6 | 2 | 8 | 25% | 12% | 25% |
| `weak|conflict` | 8 | 13 | 21 | 62% | 81% | 33% |

## Focus cells
- high-risk `weak|conflict`: among FA **0.8125**, among true **0.3333**
- high-trust `strong|agree`: among FA **0.0**, among true **0.2917**
- high-risk + tight char margin among FA: **0.6875**

## Per-ACCEPT rows

| outcome | text | char | indep | margin | charMin | charMinMargin | secondary |
|---------|------|------|-------|--------|--------:|--------------:|-----------|
| correct | `qnd2qj` | weak | conflict | tight | 0.4147 | 0.0433 | `qndzqj` |
| correct | `xpxvnp` | weak | agree | tight | 0.1477 | 0.0882 | `xpxvnp` |
| correct | `anwroc` | strong | agree | loose | 0.5095 | 0.3673 | `anwroc` |
| correct | `gffauc` | weak | conflict | tight | 0.3617 | 0.0486 | `gffanc` |
| wrong | `amyiax` | weak | conflict | loose | 0.405 | 0.3185 | `amyrax` |
| correct | `q4n99t` | strong | agree | loose | 0.5772 | 0.282 | `Q4n99t` |
| wrong | `qkvzbz` | weak | conflict | tight | 0.1735 | 0.0048 | `qKBZ` |
| correct | `hmbcub` | weak | agree | tight | 0.5417 | 0.0845 | `hmbcub` |
| wrong | `inv6wa` | weak | conflict | tight | 0.3183 | 0.031 | `fy6wa` |
| correct | `sdt4gq` | weak | conflict | loose | 0.4463 | 0.4013 | `sdr4gq` |
| wrong | `hw94n8` | strong | conflict | loose | 0.8265 | 0.6937 | `hw9an8` |
| wrong | `artmwa` | weak | agree | tight | 0.5493 | 0.0992 | `artmwa` |
| wrong | `3i4oph` | weak | conflict | tight | 0.2575 | 0.1103 | `3I4pH` |
| wrong | `lbpied` | weak | conflict | tight | 0.4385 | 0.0771 | `zbpied` |
| correct | `ghnscx` | weak | agree | tight | 0.4691 | 0.1248 | `ghNscx` |
| correct | `sphsky` | strong | agree | loose | 0.5224 | 0.2727 | `sphsky` |
| wrong | `xgjpuo` | weak | conflict | tight | 0.2877 | 0.1069 | `xgmuo` |
| correct | `xzj65d` | weak | conflict | tight | 0.1491 | 0.0486 | `xz65D` |
| correct | `ekeyvb` | weak | agree | tight | 0.526 | 0.0576 | `ekeyvb` |
| wrong | `ccxc5g` | weak | conflict | tight | 0.2841 | 0.1375 | `cexcs` |
| correct | `pzqjpf` | weak | conflict | tight | 0.2943 | 0.129 | `pzqpf` |
| correct | `zwaovd` | weak | conflict | tight | 0.4215 | 0.0355 | `zw4ovD` |
| correct | `vtdgot` | weak | conflict | loose | 0.3051 | 0.1882 | `vtdcoT` |
| correct | `vy6nkp` | strong | conflict | loose | 0.5944 | 0.5066 | `6-nkp` |
| correct | `gtyxff` | weak | agree | loose | 0.3183 | 0.1523 | `Gtyxff` |
| correct | `xdowdd` | strong | agree | loose | 0.5142 | 0.224 | `xdowDd` |
| correct | `29enos` | strong | agree | loose | 0.8415 | 0.6974 | `29enos` |
| wrong | `bdp2r3` | weak | conflict | tight | 0.2726 | 0.0566 | `6ap2r3` |
| wrong | `vtymbk` | weak | conflict | tight | 0.3274 | 0.0758 | `vtyMok` |
| wrong | `yeyypb` | weak | conflict | tight | 0.1638 | 0.0378 | `yEPpb` |
| wrong | `lfdz4e` | weak | conflict | tight | 0.2705 | 0.0704 | `tfnzae` |
| correct | `4d4pox` | strong | agree | loose | 0.5929 | 0.5875 | `4D4pox` |
| wrong | `te7oxk` | weak | conflict | tight | 0.2274 | 0.019 | `Teoxk` |
| correct | `jyscfx` | weak | conflict | tight | 0.4643 | 0.0911 | `了yscfx` |
| correct | `6nj6ek` | strong | conflict | loose | 0.5996 | 0.5028 | `6nl6Ek` |
| correct | `v65v5n` | weak | agree | tight | 0.4539 | 0.0829 | `v65v5n` |
| correct | `ptdy6n` | strong | agree | loose | 0.5186 | 0.2131 | `Ptdy6n` |
| correct | `2bqq2w` | strong | conflict | loose | 0.8341 | 0.6839 | `26` |
| wrong | `mm4dtf` | weak | conflict | loose | 0.4804 | 0.1864 | `m4utr` |
| wrong | `qkzwab` | weak | agree | tight | 0.2711 | 0.0734 | `qkzwab` |

## Interpretation guide

- If FA concentrates in `weak|conflict` while true concentrates in `strong|agree`, joint evidence is stronger than either axis alone → candidate for careful E1-D.
- If true still heavily occupies `weak|conflict`, do **not** gate on that cell (F2-D failure mode).
- RapidOCR/cross-family gaps remain a capability issue separate from this matrix.

