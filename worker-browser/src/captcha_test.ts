/**
 * Unit checks for captcha kind resolution / apply rules (no Playwright).
 */
import { createHash } from "node:crypto";
import { normalizeCaptchaWebhook } from "./config.ts";
import {
  deriveFeedbackUrl,
  hashScreenshotBytes,
  newAttemptId,
} from "./runtime/captchaIds.ts";
import { compareFrameFingerprints } from "./runtime/captchaFrame.ts";
import {
  callCaptchaSolver,
  captchaConfigured,
  normalizeCaptchaKind,
  pickCaptchaSelector,
  resolveAppliedKind,
  type CaptchaSolveResponse,
} from "./runtime/captcha.ts";

if (normalizeCaptchaWebhook("") !== "") throw new Error("empty webhook");
if (
  normalizeCaptchaWebhook("127.0.0.1:18085") !==
  "http://127.0.0.1:18085/captcha"
) {
  throw new Error("host:port webhook");
}
if (
  normalizeCaptchaWebhook("http://127.0.0.1:18085/captcha") !==
  "http://127.0.0.1:18085/captcha"
) {
  throw new Error("full webhook");
}

if (normalizeCaptchaKind() !== "auto") throw new Error("default kind");
if (normalizeCaptchaKind("SLIDER") !== "slider") throw new Error("slider kind");

const imageResp: CaptchaSolveResponse = { solved: true, text: "AB12" };
if (resolveAppliedKind("auto", imageResp) !== "image") {
  throw new Error("infer image");
}
const clickResp: CaptchaSolveResponse = {
  solved: true,
  points: [{ x: 1, y: 2 }],
};
if (resolveAppliedKind("auto", clickResp) !== "click") {
  throw new Error("infer click");
}
const sliderResp: CaptchaSolveResponse = { solved: true, offsetX: 120 };
if (resolveAppliedKind("auto", sliderResp) !== "slider") {
  throw new Error("infer slider");
}
if (resolveAppliedKind("image", { solved: true, kind: "slider", text: "x" }) !== "slider") {
  throw new Error("resp kind wins");
}

let threw = false;
try {
  resolveAppliedKind("auto", { solved: true });
} catch {
  threw = true;
}
if (!threw) throw new Error("expected missing fields error");

const usable = (s: string) => s === "#verification" || s === "#user-cap";
const probed = pickCaptchaSelector({
  kind: "image",
  probeSelector: "#verification",
  webhookFillSelector: "#captcha",
  usable,
  pageUrl: "https://example/login",
});
if (probed.selector !== "#verification" || probed.source !== "probe") {
  throw new Error("probe should beat unusable webhook fillSelector");
}
const userPicked = pickCaptchaSelector({
  kind: "image",
  userSelector: "#user-cap",
  probeSelector: "#verification",
  webhookFillSelector: "#captcha",
  usable,
});
if (userPicked.source !== "user" || userPicked.selector !== "#user-cap") {
  throw new Error("user selector wins");
}
let selErr = false;
try {
  pickCaptchaSelector({
    kind: "image",
    webhookFillSelector: "#captcha",
    usable,
    pageUrl: "https://example/login",
  });
} catch (e) {
  const msg = String(e);
  selErr = msg.includes("not usable") && msg.includes("#captcha") && msg.includes("https://example/login");
}
if (!selErr) throw new Error("expected unusable selector error");

const buf = Buffer.from("png-bytes-fixture");
const h = hashScreenshotBytes(buf);
const expect = createHash("sha256").update(buf).digest("hex");
if (h !== expect) throw new Error("imageHash sha256 mismatch");
if (!newAttemptId().startsWith("att_")) throw new Error("attemptId prefix");
if (
  deriveFeedbackUrl("http://127.0.0.1:18085/captcha") !==
  "http://127.0.0.1:18085/captcha/feedback"
) {
  throw new Error("feedback url derive");
}

const stale = compareFrameFingerprints(
  {
    channels: [{ id: "img_src", ok: true, value: "a.png" }],
    capturedAt: 1,
  },
  {
    channels: [{ id: "img_src", ok: true, value: "b.png" }],
    capturedAt: 2,
  }
);
if (stale.ok || stale.reason !== "captcha_frame_stale") {
  throw new Error("expected frame stale");
}
const unavailable = compareFrameFingerprints(
  { channels: [{ id: "img_src", ok: false, error: "empty" }], capturedAt: 1 },
  { channels: [{ id: "img_src", ok: false, error: "empty" }], capturedAt: 2 }
);
if (unavailable.ok || unavailable.reason !== "frame_fingerprint_unavailable") {
  throw new Error("expected fingerprint unavailable");
}

if (captchaConfigured()) {
  console.log("captcha_ok (webhook set; skip not-configured assert)");
} else {
  let cfgErr = false;
  try {
    await callCaptchaSolver({
      jobId: "t",
      pageUrl: "http://x",
      kind: "auto",
      screenshotBase64: "aa",
    });
  } catch (e) {
    cfgErr = String(e).includes("not configured");
  }
  if (!cfgErr) throw new Error("expected not configured error");
  console.log("captcha_ok");
}
