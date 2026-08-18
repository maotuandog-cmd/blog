# E1-C.1 Joint Evidence Attribution (captcha_ocr_bench_20260815T111025Z.json)

- label: `E1-C2-B-ppllocr-lengate`
- accepts: **23** (true=19, FA=4)

## Matrix: charEvidence × independentSource

| cell | correct | wrong | total | FAR in cell | share of FA | share of true |
|------|--------:|------:|------:|------------:|------------:|--------------:|
| `strong|agree` | 1 | 0 | 1 | 0% | 0% | 5% |
| `strong|conflict` | 1 | 0 | 1 | 0% | 0% | 5% |
| `strong|unknown` | 4 | 0 | 4 | 0% | 0% | 21% |
| `weak|agree` | 3 | 0 | 3 | 0% | 0% | 16% |
| `weak|conflict` | 3 | 2 | 5 | 40% | 50% | 16% |
| `weak|unknown` | 7 | 2 | 9 | 22% | 50% | 37% |

## Focus cells
- high-risk `weak|conflict`: among FA **0.5**, among true **0.1579**
- high-trust `strong|agree`: among FA **0.0**, among true **0.0526**
- high-risk + tight char margin among FA: **0.5**

## Per-ACCEPT rows

| outcome | text | char | indep | margin | charMin | charMinMargin | secondary |
|---------|------|------|-------|--------|--------:|--------------:|-----------|
| correct | `nxkoh5` | strong | agree | loose | 0.7961 | 0.6098 | `NxKoH5` |
| correct | `crhwes` | weak | unknown | loose | 0.3333 | 0.1674 | `crwes` |
| wrong | `oumdg7` | weak | conflict | tight | 0.2361 | 0.1465 | `oundg7` |
| correct | `3qwamg` | strong | unknown | loose | 0.5408 | 0.1992 | `3QFazMgz` |
| correct | `dvee42` | weak | agree | loose | 0.4125 | 0.2446 | `dveE=42` |
| correct | `jyw5yp` | weak | conflict | tight | 0.2758 | 0.0489 | `JYXw5p` |
| correct | `bn3xkz` | weak | agree | loose | 0.3911 | 0.2304 | `BN3xKz` |
| correct | `q5t6yx` | weak | conflict | loose | 0.2414 | 0.1893 | `q5et6x` |
| correct | `iyz3c5` | weak | unknown | loose | 0.4401 | 0.3169 | `iYz3zc5` |
| correct | `8csrvm` | strong | conflict | loose | 0.9171 | 0.8727 | `8esRvm` |
| correct | `qypsvt` | strong | unknown | loose | 0.6176 | 0.575 | `qYpst` |
| wrong | `vei3hz` | weak | unknown | loose | 0.4104 | 0.3049 | `ve13Hz=` |
| correct | `dswdy2` | weak | unknown | loose | 0.4907 | 0.4769 | `d2swZDy2` |
| correct | `pqbxau` | strong | unknown | loose | 0.5405 | 0.356 | `pzqBxZAU` |
| correct | `rkvzws` | weak | unknown | loose | 0.4036 | 0.2628 | `Rrkv2zws` |
| correct | `4gbhfh` | strong | unknown | loose | 0.6886 | 0.4297 | `4SebHfzH` |
| wrong | `rthpqj` | weak | conflict | tight | 0.2818 | 0.0504 | `RinPQJ` |
| correct | `fmmaaw` | weak | unknown | loose | 0.3789 | 0.2407 | `FUM/YmAaw` |
| wrong | `gwrysx` | weak | unknown | tight | 0.5135 | 0.0279 | `Gwysx` |
| correct | `mvukwc` | weak | unknown | tight | 0.422 | 0.1359 | `MyNukwc` |
| correct | `tfbsu6` | weak | unknown | loose | 0.3621 | 0.2262 | `TBsu6` |
| correct | `kyrkz5` | weak | conflict | tight | 0.1485 | 0.0408 | `K*R/Kzz5` |
| correct | `jbw64j` | weak | agree | tight | 0.3106 | 0.024 | `Jbw64J` |

## Interpretation guide

- If FA concentrates in `weak|conflict` while true concentrates in `strong|agree`, joint evidence is stronger than either axis alone → candidate for careful E1-D.
- If true still heavily occupies `weak|conflict`, do **not** gate on that cell (F2-D failure mode).
- RapidOCR/cross-family gaps remain a capability issue separate from this matrix.

