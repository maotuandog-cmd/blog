/**
 * Generate labeled captchas matching captcha-demo/src/server.ts rendering.
 * Uses canvas from captcha-demo/node_modules (demo dir is root-owned).
 *
 * Output: captcha-solver/datasets/demo_char_detect/
 *
 *   COUNT=1000 node scripts/generate_demo_train_set.mjs
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEMO = path.resolve(ROOT, "../captcha-demo");
const require = createRequire(path.join(DEMO, "package.json"));
const { createCanvas } = require("canvas");

const CHARSET =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const COUNT = Math.max(1, Number(process.env.COUNT || 1000));
const VAL_RATIO = Math.min(0.5, Math.max(0.05, Number(process.env.VAL_RATIO || 0.2)));
const OUT_DIR = path.resolve(
  process.env.OUT_DIR || path.join(ROOT, "datasets/demo_char_detect")
);

function randomString(length) {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CHARSET[crypto.randomInt(0, CHARSET.length)];
  }
  return result;
}

function randomColor(min = 30, max = 180) {
  const r = crypto.randomInt(min, max);
  const g = crypto.randomInt(min, max);
  const b = crypto.randomInt(min, max);
  return `rgb(${r},${g},${b})`;
}

function pickLength() {
  const r = Math.random();
  if (r < 0.7) return 6;
  if (r < 0.85) return 5;
  return 4;
}

function rotatePoint(px, py, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: px * c - py * s, y: px * s + py * c };
}

/** Same recipe as captcha-demo generateCaptchaImage + per-char AABB. */
function generateCaptchaImage(text) {
  const width = 260;
  const height = 90;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#f2f2f2");
  gradient.addColorStop(0.5, "#ffffff");
  gradient.addColorStop(1, "#e5e5e5");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 1500; i++) {
    const x = crypto.randomInt(0, width);
    const y = crypto.randomInt(0, height);
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
    ctx.fill();
  }

  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = randomColor(80, 220);
    ctx.fillRect(crypto.randomInt(0, width), crypto.randomInt(0, height), 1, 1);
  }

  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(crypto.randomInt(0, width), crypto.randomInt(0, height));
    ctx.bezierCurveTo(
      crypto.randomInt(0, width),
      crypto.randomInt(0, height),
      crypto.randomInt(0, width),
      crypto.randomInt(0, height),
      crypto.randomInt(0, width),
      crypto.randomInt(0, height)
    );
    ctx.strokeStyle = `rgba(0,0,0,${0.2 + Math.random() * 0.5})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.stroke();
  }

  const charWidth = 38;
  const boxes = [];
  const fonts = [
    { css: "bold 42px Arial", size: 42 },
    { css: "bold 44px Georgia", size: 44 },
    { css: "bold 40px Verdana", size: 40 },
    { css: "bold 43px Times New Roman", size: 43 },
  ];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const x = 18 + i * charWidth + crypto.randomInt(-5, 6);
    const y = 62 + crypto.randomInt(-8, 9);
    const angle = (crypto.randomInt(-25, 26) * Math.PI) / 180;
    const font = fonts[crypto.randomInt(0, fonts.length)];

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.font = font.css;
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = randomColor(10, 130);
    ctx.fillText(char, 0, 0);
    ctx.shadowColor = "transparent";
    for (let j = 0; j < 5; j++) {
      ctx.fillStyle = randomColor(20, 180);
      ctx.fillRect(
        crypto.randomInt(0, 30),
        crypto.randomInt(-35, 5),
        crypto.randomInt(2, 6),
        crypto.randomInt(2, 8)
      );
    }
    const tw = Math.max(8, ctx.measureText(char).width);
    const ascent = font.size * 0.82;
    const descent = font.size * 0.22;
    const pad = 3;
    const local = [
      { x: -pad, y: -ascent - pad },
      { x: tw + pad, y: -ascent - pad },
      { x: tw + pad, y: descent + pad },
      { x: -pad, y: descent + pad },
    ];
    ctx.restore();

    const xs = local.map((p) => rotatePoint(p.x, p.y, angle).x + x);
    const ys = local.map((p) => rotatePoint(p.x, p.y, angle).y + y);
    let x1 = Math.max(0, Math.min(...xs));
    let y1 = Math.max(0, Math.min(...ys));
    let x2 = Math.min(width, Math.max(...xs));
    let y2 = Math.min(height, Math.max(...ys));
    if (x2 - x1 < 4) x2 = Math.min(width, x1 + 4);
    if (y2 - y1 < 4) y2 = Math.min(height, y1 + 4);
    boxes.push({ char, x1, y1, x2, y2 });
  }

  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(crypto.randomInt(0, width), crypto.randomInt(0, height));
    ctx.lineTo(crypto.randomInt(0, width), crypto.randomInt(0, height));
    ctx.strokeStyle = `rgba(0,0,0,${0.2 + Math.random() * 0.5})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, width, height);

  return { png: canvas.toBuffer("image/png"), boxes, width, height };
}

function toYoloLine(box, imgW, imgH) {
  const xc = (box.x1 + box.x2) / 2 / imgW;
  const yc = (box.y1 + box.y2) / 2 / imgH;
  const w = (box.x2 - box.x1) / imgW;
  const h = (box.y2 - box.y1) / imgH;
  const clip = (v) => Math.min(0.999, Math.max(0.001, v));
  return `0 ${clip(xc).toFixed(6)} ${clip(yc).toFixed(6)} ${clip(w).toFixed(6)} ${clip(h).toFixed(6)}`;
}

function ensureDirs(root) {
  for (const p of ["images/train", "images/val", "labels/train", "labels/val", "gt"]) {
    fs.mkdirSync(path.join(root, p), { recursive: true });
  }
}

ensureDirs(OUT_DIR);
const valCount = Math.max(1, Math.round(COUNT * VAL_RATIO));
const trainCount = COUNT - valCount;
const manifestPath = path.join(OUT_DIR, "manifest.jsonl");
const mf = fs.createWriteStream(manifestPath, { flags: "w" });

console.log(
  `Generating ${COUNT} → ${OUT_DIR} (train=${trainCount}, val=${valCount})`
);

for (let i = 0; i < COUNT; i++) {
  const split = i < trainCount ? "train" : "val";
  const answer = randomString(pickLength());
  const { png, boxes, width, height } = generateCaptchaImage(answer);
  const id = `demo_${String(i).padStart(5, "0")}`;
  const imgRel = `images/${split}/${id}.png`;
  const labelRel = `labels/${split}/${id}.txt`;
  const gtRel = `gt/${id}.txt`;

  fs.writeFileSync(path.join(OUT_DIR, imgRel), png);
  fs.writeFileSync(
    path.join(OUT_DIR, labelRel),
    boxes.map((b) => toYoloLine(b, width, height)).join("\n") + "\n"
  );
  fs.writeFileSync(path.join(OUT_DIR, gtRel), answer + "\n");
  mf.write(
    JSON.stringify({
      id,
      split,
      path: imgRel,
      label: labelRel,
      answer,
      length: answer.length,
      boxes: boxes.map((b) => ({
        char: b.char,
        x1: +b.x1.toFixed(2),
        y1: +b.y1.toFixed(2),
        x2: +b.x2.toFixed(2),
        y2: +b.y2.toFixed(2),
      })),
    }) + "\n"
  );
  if ((i + 1) % 100 === 0 || i + 1 === COUNT) console.log(`  ${i + 1}/${COUNT}`);
}
mf.end();

fs.writeFileSync(
  path.join(OUT_DIR, "data.yaml"),
  `path: ${OUT_DIR}
train: images/train
val: images/val
names:
  0: character
nc: 1
`
);

fs.writeFileSync(
  path.join(OUT_DIR, "README.md"),
  `# demo_char_detect

Mirrors \`captcha-demo/src/server.ts\` \`generateCaptchaImage\` (CHARSET, noise, lines, rotate).

- class \`0 = character\` (detect-only)
- \`gt/*.txt\` full answer for OCR A/B
- regenerate: \`COUNT=1000 node captcha-solver/scripts/generate_demo_train_set.mjs\`
`
);

console.log("done");
