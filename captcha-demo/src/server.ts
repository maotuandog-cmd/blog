import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import { createCanvas } from "canvas";

const app = express();

app.use(express.json());
app.use(cookieParser());


const HOST = "192.168.85.144";
const PORT = 3000;

app.listen(PORT, HOST, () => {
  console.log(
    `CAPTCHA server running at http://${HOST}:${PORT}`
  );
});
/**
 * CAPTCHA 配置
 */
const CAPTCHA_LENGTH = 6;
const CAPTCHA_EXPIRE_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * 不使用容易混淆的字符
 *
 * 例如：
 * 0 / O
 * 1 / I / l
 */
const CHARSET =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * 内存 Session
 *
 * 生产环境建议换 Redis。
 */
interface CaptchaSession {
  id: string;

  answerHash: string;

  createdAt: number;

  expiresAt: number;

  attempts: number;

  used: boolean;

  ip?: string;

  userAgent?: string;
}

const sessions = new Map<string, CaptchaSession>();

/**
 * ==============================
 * 工具函数
 * ==============================
 */

function randomString(length: number): string {
  let result = "";

  for (let i = 0; i < length; i++) {
    const index = crypto.randomInt(0, CHARSET.length);

    result += CHARSET[index];
  }

  return result;
}

function sha256(value: string): string {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function randomColor(
  min = 30,
  max = 180
): string {
  const r = crypto.randomInt(min, max);
  const g = crypto.randomInt(min, max);
  const b = crypto.randomInt(min, max);

  return `rgb(${r},${g},${b})`;
}

/**
 * 常量时间比较
 */
function safeEqual(
  a: string,
  b: string
): boolean {

  const aa = Buffer.from(a);
  const bb = Buffer.from(b);

  if (aa.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(aa, bb);
}

/**
 * ==============================
 * CAPTCHA 图片生成
 * ==============================
 */

function generateCaptchaImage(
  text: string
): Buffer {

  const width = 260;
  const height = 90;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  /**
   * 背景
   */
  const gradient = ctx.createLinearGradient(
    0,
    0,
    width,
    height
  );

  gradient.addColorStop(0, "#f2f2f2");
  gradient.addColorStop(0.5, "#ffffff");
  gradient.addColorStop(1, "#e5e5e5");

  ctx.fillStyle = gradient;

  ctx.fillRect(
    0,
    0,
    width,
    height
  );

  /**
   * 背景噪声点
   */
  for (let i = 0; i < 1500; i++) {

    const x = crypto.randomInt(0, width);
    const y = crypto.randomInt(0, height);

    const radius =
      Math.random() * 1.5;

    ctx.beginPath();

    ctx.arc(
      x,
      y,
      radius,
      0,
      Math.PI * 2
    );

    ctx.fillStyle =
      `rgba(0,0,0,${Math.random() * 0.25})`;

    ctx.fill();
  }

  /**
   * 背景彩色噪声
   */
  for (let i = 0; i < 500; i++) {

    const x = crypto.randomInt(0, width);
    const y = crypto.randomInt(0, height);

    ctx.fillStyle = randomColor(
      80,
      220
    );

    ctx.fillRect(
      x,
      y,
      1,
      1
    );
  }

  /**
   * 随机干扰线
   */
  for (let i = 0; i < 12; i++) {

    ctx.beginPath();

    ctx.moveTo(
      crypto.randomInt(0, width),
      crypto.randomInt(0, height)
    );

    ctx.bezierCurveTo(
      crypto.randomInt(0, width),
      crypto.randomInt(0, height),

      crypto.randomInt(0, width),
      crypto.randomInt(0, height),

      crypto.randomInt(0, width),
      crypto.randomInt(0, height)
    );

    ctx.strokeStyle =
      `rgba(0,0,0,${0.2 + Math.random() * 0.5})`;

    ctx.lineWidth =
      1 + Math.random() * 2;

    ctx.stroke();
  }

  /**
   * 字符
   */
  const charWidth = 38;

  for (let i = 0; i < text.length; i++) {

    const char = text[i];

    const x =
      18 +
      i * charWidth +
      crypto.randomInt(-5, 6);

    const y =
      62 +
      crypto.randomInt(-8, 9);

    const angle =
      (crypto.randomInt(-25, 26) *
        Math.PI) /
      180;

    ctx.save();

    ctx.translate(x, y);

    ctx.rotate(angle);

    /**
     * 字体随机
     */
    const fonts = [
      "bold 42px Arial",
      "bold 44px Georgia",
      "bold 40px Verdana",
      "bold 43px Times New Roman",
    ];

    const font =
      fonts[
        crypto.randomInt(
          0,
          fonts.length
        )
      ];

    ctx.font = font;

    /**
     * 阴影
     */
    ctx.shadowColor =
      "rgba(0,0,0,0.3)";

    ctx.shadowBlur = 2;

    ctx.shadowOffsetX = 1;

    ctx.shadowOffsetY = 1;

    ctx.fillStyle =
      randomColor(10, 130);

    ctx.fillText(
      char,
      0,
      0
    );

    /**
     * 字符内部干扰
     */
    ctx.shadowColor = "transparent";

    for (let j = 0; j < 5; j++) {

      ctx.fillStyle =
        randomColor(20, 180);

      ctx.fillRect(
        crypto.randomInt(0, 30),
        crypto.randomInt(-35, 5),
        crypto.randomInt(2, 6),
        crypto.randomInt(2, 8)
      );
    }

    ctx.restore();
  }

  /**
   * 前景干扰线
   */
  for (let i = 0; i < 8; i++) {

    ctx.beginPath();

    ctx.moveTo(
      crypto.randomInt(0, width),
      crypto.randomInt(0, height)
    );

    ctx.lineTo(
      crypto.randomInt(0, width),
      crypto.randomInt(0, height)
    );

    ctx.strokeStyle =
      `rgba(0,0,0,${0.2 + Math.random() * 0.5})`;

    ctx.lineWidth =
      1 + Math.random() * 2;

    ctx.stroke();
  }

  /**
   * 边框
   */
  ctx.strokeStyle =
    "rgba(0,0,0,0.25)";

  ctx.lineWidth = 2;

  ctx.strokeRect(
    0,
    0,
    width,
    height
  );

  return canvas.toBuffer(
    "image/png"
  );
}

/**
 * ==============================
 * 创建 CAPTCHA
 * ==============================
 */

app.get(
  "/api/captcha",
  (req, res) => {

    const sessionId =
      crypto.randomBytes(32)
        .toString("hex");

    const answer =
      randomString(CAPTCHA_LENGTH);

    const now =
      Date.now();

    const session: CaptchaSession = {
      id: sessionId,

      /**
       * 服务端只保存 Hash
       */
      answerHash:
        sha256(
          answer.toLowerCase()
        ),

      createdAt: now,

      expiresAt:
        now + CAPTCHA_EXPIRE_MS,

      attempts: 0,

      used: false,

      ip: req.ip,

      userAgent:
        req.headers["user-agent"],
    };

    sessions.set(
      sessionId,
      session
    );

    /**
     * Cookie 不直接保存答案
     */
    res.cookie(
      "captcha_session",
      sessionId,
      {
        httpOnly: true,

        sameSite: "strict",

        secure:
          process.env.NODE_ENV ===
          "production",

        maxAge:
          CAPTCHA_EXPIRE_MS,
      }
    );

    const image =
      generateCaptchaImage(answer);

    res.setHeader(
      "Content-Type",
      "image/png"
    );

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    res.send(image);
  }
);

/**
 * ==============================
 * CAPTCHA 验证
 * ==============================
 */

app.post(
  "/api/captcha/verify",
  (req, res) => {

    const {
      code
    } = req.body;

    if (
      typeof code !== "string"
    ) {

      return res.status(400).json({
        success: false,
        message: "验证码不能为空",
      });
    }

    const sessionId =
      req.cookies.captcha_session;

    if (!sessionId) {

      return res.status(400).json({
        success: false,
        message: "验证码会话不存在",
      });
    }

    const session =
      sessions.get(sessionId);

    if (!session) {

      return res.status(400).json({
        success: false,
        message: "验证码不存在或已经失效",
      });
    }

    /**
     * 过期
     */
    if (
      Date.now() >
      session.expiresAt
    ) {

      sessions.delete(sessionId);

      return res.status(400).json({
        success: false,
        message: "验证码已过期",
      });
    }

    /**
     * 一次性验证码
     */
    if (session.used) {

      return res.status(400).json({
        success: false,
        message: "验证码已经使用",
      });
    }

    /**
     * 最大失败次数
     */
    if (
      session.attempts >=
      MAX_ATTEMPTS
    ) {

      sessions.delete(sessionId);

      return res.status(429).json({
        success: false,
        message: "尝试次数过多",
      });
    }

    session.attempts++;

    const inputHash =
      sha256(
        code
          .trim()
          .toLowerCase()
      );

    const success =
      safeEqual(
        inputHash,
        session.answerHash
      );

    if (!success) {

      return res.status(400).json({
        success: false,

        message:
          `验证码错误，还可以尝试 ${
            MAX_ATTEMPTS -
            session.attempts
          } 次`,
      });
    }

    /**
     * 验证成功后立即销毁
     */
    session.used = true;

    sessions.delete(sessionId);

    res.clearCookie(
      "captcha_session"
    );

    return res.json({
      success: true,
      message: "验证码验证成功",
    });
  }
);

/**
 * ==============================
 * Demo 页面
 * ==============================
 */

app.get(
  "/",
  (_, res) => {

    res.send(`
<!DOCTYPE html>

<html lang="zh-CN">

<head>

<meta charset="UTF-8">

<title>CAPTCHA OCR Test</title>

<style>

body {
    font-family: Arial;
    background: #f5f5f5;
}

.container {
    width: 420px;
    margin: 100px auto;
    padding: 30px;
    background: white;
    border-radius: 12px;
    box-shadow:
        0 5px 30px rgba(0,0,0,.1);
}

.captcha {
    display: flex;
    align-items: center;
    gap: 10px;
}

img {
    width: 260px;
    height: 90px;
    border: 1px solid #ddd;
}

button {
    padding: 10px 20px;
    cursor: pointer;
}

input {
    padding: 12px;
    width: 180px;
    margin-top: 20px;
    font-size: 18px;
}

#result {
    margin-top: 20px;
    font-weight: bold;
}

</style>

</head>

<body>

<div class="container">

<h2>CAPTCHA OCR Test</h2>

<div class="captcha">

<img
    id="captcha"
    src="/api/captcha"
/>

<button
    onclick="refreshCaptcha()"
>
刷新
</button>

</div>

<br>

<input
    id="code"
    placeholder="输入验证码"
    autocomplete="off"
/>

<br><br>

<button
    onclick="verify()"
>
验证
</button>

<div id="result"></div>

</div>

<script>

function refreshCaptcha() {

    document.getElementById(
        "captcha"
    ).src =
        "/api/captcha?t=" +
        Date.now();
}

async function verify() {

    const code =
        document.getElementById(
            "code"
        ).value;

    const response =
        await fetch(
            "/api/captcha/verify",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        code
                    })
            }
        );

    const data =
        await response.json();

    document.getElementById(
        "result"
    ).innerText =
        data.message;

    if (data.success) {

        setTimeout(
            refreshCaptcha,
            500
        );
    }
}

</script>

</body>

</html>
`);
  }
);

/**
 * ==============================
 * Session 清理
 * ==============================
 */

setInterval(
  () => {

    const now =
      Date.now();

    for (
      const [
        id,
        session
      ] of sessions
    ) {

      if (
        now >
        session.expiresAt
      ) {

        sessions.delete(id);
      }
    }

  },
  60 * 1000
);

/**
 * ==============================
 * 启动
 * ==============================
 */

app.listen(
  PORT,
  () => {

    console.log(
      `CAPTCHA server running at http://127.0.0.1:${PORT}`
    );

  }
);
