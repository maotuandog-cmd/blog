# demo_char_detect

Mirrors `captcha-demo/src/server.ts` `generateCaptchaImage` (CHARSET, noise, lines, rotate).

- class `0 = character` (detect-only)
- `gt/*.txt` full answer for OCR A/B
- regenerate: `COUNT=1000 node captcha-solver/scripts/generate_demo_train_set.mjs`
