# E1-C.1 Joint Evidence Attribution (captcha_ocr_bench_20260815T110823Z.json)

- label: `E1-C2-B-ppllocr`
- accepts: **12** (true=7, FA=5)

## Matrix: charEvidence × independentSource

| cell | correct | wrong | total | FAR in cell | share of FA | share of true |
|------|--------:|------:|------:|------------:|------------:|--------------:|
| `strong|agree` | 1 | 0 | 1 | 0% | 0% | 14% |
| `strong|conflict` | 2 | 1 | 3 | 33% | 20% | 29% |
| `weak|agree` | 1 | 0 | 1 | 0% | 0% | 14% |
| `weak|conflict` | 3 | 4 | 7 | 57% | 80% | 43% |

## Focus cells
- high-risk `weak|conflict`: among FA **0.8**, among true **0.4286**
- high-trust `strong|agree`: among FA **0.0**, among true **0.1429**
- high-risk + tight char margin among FA: **0.6**

## Per-ACCEPT rows

| outcome | text | char | indep | margin | charMin | charMinMargin | secondary |
|---------|------|------|-------|--------|--------:|--------------:|-----------|
| wrong | `vymazu` | weak | conflict | tight | 0.2395 | 0.149 | `vyMazL` |
| correct | `gdhyyx` | strong | agree | loose | 0.6741 | 0.5817 | `gdhyyx` |
| wrong | `rc439o` | strong | conflict | loose | 0.5132 | 0.1597 | `re4399=` |
| wrong | `vprc39` | weak | conflict | tight | 0.3818 | 0.0396 | `iZPRc359` |
| correct | `jyhu8k` | weak | agree | loose | 0.2592 | 0.1839 | `jyHu8K` |
| correct | `qxknyi` | weak | conflict | tight | 0.1602 | 0.0587 | `qxkN=` |
| correct | `rihjsz` | weak | conflict | tight | 0.3713 | 0.0878 | `2Rih2jsz` |
| correct | `qkbrgq` | strong | conflict | loose | 0.7066 | 0.4606 | `QKbzRgq` |
| correct | `ejyphk` | weak | conflict | tight | 0.3111 | 0.1186 | `ejyphzk` |
| wrong | `fvkjkz` | weak | conflict | tight | 0.1554 | 0.0459 | `xv7kjEKZz` |
| wrong | `kjdtbc` | weak | conflict | loose | 0.2756 | 0.164 | `kJfdTbSG` |
| correct | `ord8bh` | strong | conflict | loose | 0.612 | 0.3237 | `oR7D8bh` |

## Interpretation guide

- If FA concentrates in `weak|conflict` while true concentrates in `strong|agree`, joint evidence is stronger than either axis alone → candidate for careful E1-D.
- If true still heavily occupies `weak|conflict`, do **not** gate on that cell (F2-D failure mode).
- RapidOCR/cross-family gaps remain a capability issue separate from this matrix.

