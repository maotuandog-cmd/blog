/**
 * Captcha solver Webhook client + apply helpers (F-BRW-06).
 * Hermes does not solve captchas; it orchestrates an external solver.
 */
import type { Page } from "playwright";
import { config } from "../config.js";
import {
  hashScreenshotBytes,
  newAttemptId,
  postCaptchaFeedback,
} from "./captchaIds.js";
import {
  captureFrameFingerprint,
  compareFrameFingerprints,
  recaptureMatchingChannels,
} from "./captchaFrame.js";
import {
  captchaLog,
  pushCaptchaTrace,
  type CaptchaTraceEntry,
} from "./captchaLog.js";

export type CaptchaKind = "auto" | "image" | "click" | "slider";

export interface CaptchaPoint {
  x: number;
  y: number;
}

export interface CaptchaSolveRequest {
  jobId: string;
  pageUrl: string;
  kind: CaptchaKind;
  screenshotBase64: string;
  attemptId?: string;
  imageHash?: string;
  timestamp?: number;
  sessionId?: string;
  hint?: { selector?: string; siteKey?: string; [k: string]: unknown };
}

export interface CaptchaSolveResponse {
  solved?: boolean;
  kind?: string;
  text?: string;
  fillSelector?: string;
  points?: CaptchaPoint[];
  offsetX?: number;
  track?: CaptchaPoint[];
  coord?: "viewport" | "page" | string;
  reason?: string;
  attemptId?: string;
  imageHash?: string;
  sessionId?: string;
}

export function captchaConfigured(): boolean {
  return Boolean(config.captchaWebhook);
}

export function normalizeCaptchaKind(raw?: string): CaptchaKind {
  const k = String(raw || "auto").toLowerCase();
  if (k === "image" || k === "click" || k === "slider" || k === "auto") return k;
  return "auto";
}

/**
 * Call external solver. Throws if not configured or HTTP/timeout failure.
 */
export async function callCaptchaSolver(
  req: CaptchaSolveRequest,
  timeoutSec?: number
): Promise<CaptchaSolveResponse> {
  const url = config.captchaWebhook;
  if (!url) {
    throw new Error("captcha solver not configured (HERMES_CAPTCHA_WEBHOOK)");
  }
  const ms = Math.max(
    5,
    Number(timeoutSec) > 0 ? Number(timeoutSec) : config.captchaTimeoutSec || 60
  ) * 1000;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.captchaApiKey) {
    headers.Authorization = `Bearer ${config.captchaApiKey}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`captcha webhook ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as CaptchaSolveResponse;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`captcha webhook timeout after ${ms}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve effective kind from request + response. */
export function resolveAppliedKind(
  requestKind: CaptchaKind,
  resp: CaptchaSolveResponse
): "image" | "click" | "slider" {
  const fromResp = String(resp.kind || "").toLowerCase();
  if (fromResp === "image" || fromResp === "click" || fromResp === "slider") {
    return fromResp;
  }
  if (requestKind === "image" || requestKind === "click" || requestKind === "slider") {
    return requestKind;
  }
  if (typeof resp.text === "string" && resp.text) return "image";
  if (Array.isArray(resp.points) && resp.points.length) return "click";
  if (typeof resp.offsetX === "number" || (Array.isArray(resp.track) && resp.track.length)) {
    return "slider";
  }
  throw new Error("captcha response missing kind and actionable fields");
}

export type CaptchaSelectorSource = "user" | "probe" | "webhook";

export interface PickCaptchaSelectorOpts {
  kind: "image" | "click" | "slider";
  userSelector?: string;
  probeSelector?: string;
  webhookFillSelector?: string;
  usable: (selector: string) => boolean;
  pageUrl?: string;
}

/** user > probe > webhook (webhook only if that locator is usable). */
export function pickCaptchaSelector(
  opts: PickCaptchaSelectorOpts
): { selector: string; source: CaptchaSelectorSource } {
  const candidates: Array<[CaptchaSelectorSource, string | undefined]> = [
    ["user", opts.userSelector],
    ["probe", opts.probeSelector],
    ["webhook", opts.webhookFillSelector],
  ];
  for (const [source, sel] of candidates) {
    const s = String(sel || "").trim();
    if (s && opts.usable(s)) return { selector: s, source };
  }
  throw new Error(
    `captcha selector not usable url=${opts.pageUrl || "-"} probe=${opts.probeSelector || "-"} webhook=${opts.webhookFillSelector || "-"} user=${opts.userSelector || "-"}`
  );
}

export async function locatorIsFillable(
  page: Page,
  selector: string
): Promise<boolean> {
  const loc = page.locator(selector).first();
  const n = await loc.count().catch(() => 0);
  if (!n) return false;
  if (!(await loc.isVisible().catch(() => false))) return false;
  return loc
    .evaluate((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") return true;
      return Boolean((el as HTMLElement).isContentEditable);
    })
    .catch(() => false);
}

export async function locatorIsVisible(
  page: Page,
  selector: string
): Promise<boolean> {
  const loc = page.locator(selector).first();
  const n = await loc.count().catch(() => 0);
  if (!n) return false;
  return loc.isVisible().catch(() => false);
}

async function screenshotCaptchaRegion(
  page: Page,
  imageSelector?: string,
  containerSelector?: string
): Promise<Buffer> {
  // Prefer tight locator screenshots. Padded page.clip often pulls in chrome
  // around DCP #code and used to fall through to a full-viewport shot when
  // the image was not ready — both caused solver "ocr low confidence".
  for (const sel of [imageSelector, containerSelector]) {
    if (!sel) continue;
    const loc = page.locator(sel).first();
    if (!(await loc.count().catch(() => 0))) continue;
    try {
      await loc.waitFor({ state: "visible", timeout: 5000 });
    } catch {
      continue;
    }
    // Wait for a non-trivial box (image swapped in after login click).
    let box = await loc.boundingBox().catch(() => null);
    for (let i = 0; i < 8 && (!box || box.width < 8 || box.height < 8); i++) {
      await page.waitForTimeout(150);
      box = await loc.boundingBox().catch(() => null);
    }
    if (!box || box.width < 4 || box.height < 4) continue;
    try {
      return await loc.screenshot({ timeout: 5000 });
    } catch {
      try {
        return await page.screenshot({
          clip: {
            x: Math.max(0, box.x),
            y: Math.max(0, box.y),
            width: box.width,
            height: box.height,
          },
        });
      } catch {
        /* fall through */
      }
    }
  }
  throw new Error(
    `captcha screenshot failed selectors=${imageSelector || "-"}/${containerSelector || "-"}`
  );
}

/**
 * Apply solver response on the page (auto fill / click / drag).
 */
export async function applyCaptchaSolution(
  page: Page,
  resp: CaptchaSolveResponse,
  opts: {
    selector?: string;
    userSelector?: string;
    probeSelector?: string;
    requestKind?: CaptchaKind;
  } = {}
): Promise<string> {
  if (!resp.solved) {
    throw new Error(
      "captcha not solved: " + (resp.reason || "solved=false")
    );
  }
  const kind = resolveAppliedKind(opts.requestKind || "auto", resp);
  const probeSelector = opts.probeSelector || opts.selector || "";

  if (kind === "click") {
    const points = resp.points || [];
    if (!points.length) throw new Error("captcha click response missing points");
    for (const p of points) {
      const x = Number(p.x);
      const y = Number(p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("captcha click point invalid");
      }
      await page.mouse.click(x, y);
      await page.waitForTimeout(80);
    }
    return `click ${points.length} point(s)`;
  }

  const needFillable = kind === "image";
  const usableSync: Record<string, boolean> = {};
  for (const sel of [
    opts.userSelector,
    probeSelector,
    resp.fillSelector,
  ]) {
    const s = String(sel || "").trim();
    if (!s || s in usableSync) continue;
    usableSync[s] = needFillable
      ? await locatorIsFillable(page, s)
      : await locatorIsVisible(page, s);
  }
  const picked = pickCaptchaSelector({
    kind,
    userSelector: opts.userSelector,
    probeSelector,
    webhookFillSelector: resp.fillSelector,
    pageUrl: page.url(),
    usable: (s) => Boolean(usableSync[s]),
  });
  return applyPicked(page, resp, kind, picked.selector);
}

async function applyPicked(
  page: Page,
  resp: CaptchaSolveResponse,
  kind: "image" | "slider",
  selector: string
): Promise<string> {
  if (kind === "image") {
    const text = String(resp.text || "");
    if (!text) throw new Error("captcha image response missing text");
    await page.fill(selector, text, { timeout: 8000 });
    const mockNote = text === "AB12" ? " (fixture mock AB12, not OCR)" : "";
    return `image filled ${selector} text=${text}${mockNote}`;
  }

  if (Array.isArray(resp.track) && resp.track.length >= 2) {
    await page.mouse.move(resp.track[0]!.x, resp.track[0]!.y);
    await page.mouse.down();
    for (const pt of resp.track.slice(1)) {
      await page.mouse.move(pt.x, pt.y, { steps: 2 });
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    return `slider track ${resp.track.length} pts`;
  }

  const offsetX = Number(resp.offsetX);
  if (!Number.isFinite(offsetX)) {
    throw new Error("captcha slider response missing offsetX or track");
  }
  await dragByDelta(page, selector, offsetX, 0);
  return `slider offsetX=${offsetX}`;
}

/** Drag element by delta (or absolute toX via step value). */
export async function dragByDelta(
  page: Page,
  selector: string,
  deltaX: number,
  deltaY = 0
): Promise<void> {
  const loc = page.locator(selector).first();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`drag target not found: ${selector}`);
  const fromX = box.x + Math.min(box.width * 0.5, Math.max(4, box.width * 0.2));
  const fromY = box.y + box.height / 2;
  const toX = fromX + deltaX;
  const toY = fromY + deltaY;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  const steps = Math.max(8, Math.min(40, Math.floor(Math.abs(deltaX) / 4) || 12));
  await page.mouse.move(toX, toY, { steps });
  await page.mouse.up();
}

/**
 * Full solveCaptcha step: fingerprint → screenshot → webhook → frame check → apply.
 */
export async function solveAndApplyCaptcha(
  page: Page,
  opts: {
    jobId?: string;
    kind?: string;
    selector?: string;
    userSelector?: string;
    probeSelector?: string;
    imageSelector?: string;
    containerSelector?: string;
    siteKey?: string;
    timeoutSec?: number;
    events?: CaptchaTraceEntry[];
  }
): Promise<string> {
  const kind = normalizeCaptchaKind(opts.kind);
  const fillHint =
    String(opts.userSelector || "").trim() ||
    String(opts.probeSelector || opts.selector || "").trim();
  const jobId = opts.jobId || "anonymous";
  const sessionId = jobId;
  const attemptId = newAttemptId();
  const frameSel = {
    imageSelector: opts.imageSelector,
    containerSelector: opts.containerSelector,
  };

  const fpBefore = await captureFrameFingerprint(page, frameSel);
  const buf = await screenshotCaptchaRegion(
    page,
    opts.imageSelector,
    opts.containerSelector
  );
  const imageHash = hashScreenshotBytes(buf);
  const timestamp = Date.now();

  captchaLog(jobId, "webhook-request", {
    url: page.url(),
    kind,
    selector: fillHint,
    imageSelector: opts.imageSelector,
    screenshotBytes: buf.length,
    attemptId,
    imageHash: imageHash.slice(0, 16),
    frameChannels: fpBefore.channels
      .filter((c) => c.ok)
      .map((c) => c.id)
      .join(","),
  });

  let resp: CaptchaSolveResponse;
  try {
    resp = await callCaptchaSolver(
      {
        jobId,
        sessionId,
        attemptId,
        imageHash,
        timestamp,
        pageUrl: page.url(),
        kind,
        screenshotBase64: buf.toString("base64"),
        hint: {
          ...(fillHint ? { selector: fillHint } : {}),
          ...(opts.imageSelector ? { imageSelector: opts.imageSelector } : {}),
          ...(opts.kind ? { kindGuess: kind } : {}),
          ...(opts.siteKey ? { siteKey: opts.siteKey } : {}),
        },
      },
      opts.timeoutSec
    );
  } catch (err) {
    void postCaptchaFeedback({
      attemptId,
      sessionId,
      siteResult: "unknown",
      failReason: String(err).slice(0, 200),
      imageHash,
    });
    throw err;
  }

  const fixtureAnswer = String(resp.text || "") === "AB12";
  captchaLog(jobId, "webhook-response", {
    url: page.url(),
    solved: resp.solved,
    kind: resp.kind,
    text: resp.text,
    fillSelector: resp.fillSelector,
    reason: resp.reason,
    attemptId: resp.attemptId,
    imageHash: resp.imageHash ? String(resp.imageHash).slice(0, 16) : undefined,
    fixtureMockAnswer: fixtureAnswer,
  });
  if (fixtureAnswer) {
    console.warn(
      `[captcha] job=${jobId} solver returned AB12 (local fixture mock, not OCR) url=${page.url()}`
    );
  }
  pushCaptchaTrace(opts.events, {
    phase: "webhook",
    url: page.url(),
    kind: String(resp.kind || kind),
    selector: fillHint,
    imageSelector: opts.imageSelector,
    text: resp.text,
    fillSelector: resp.fillSelector,
    solved: resp.solved,
    reason: resp.reason,
    note: fixtureAnswer
      ? "AB12 is the local mock fixture answer, not OCR"
      : `attemptId=${attemptId}`,
  });

  if (resp.attemptId && resp.attemptId !== attemptId) {
    void postCaptchaFeedback({
      attemptId,
      sessionId,
      siteResult: "unknown",
      failReason: "attempt_mismatch",
      imageHash,
    });
    throw new Error(
      `captcha attempt_mismatch local=${attemptId} remote=${resp.attemptId}`
    );
  }
  if (resp.imageHash && resp.imageHash !== imageHash) {
    void postCaptchaFeedback({
      attemptId,
      sessionId,
      siteResult: "unknown",
      failReason: "image_hash_mismatch",
      imageHash,
    });
    throw new Error("captcha image_hash_mismatch on response");
  }

  if (!resp.solved) {
    void postCaptchaFeedback({
      attemptId,
      sessionId: resp.sessionId || sessionId,
      siteResult: "unknown",
      failReason: String(resp.reason || "solved=false"),
      imageHash,
    });
    throw new Error("captcha not solved: " + (resp.reason || "solved=false"));
  }

  const fpAfter = await recaptureMatchingChannels(page, fpBefore, frameSel);
  const frameCmp = compareFrameFingerprints(fpBefore, fpAfter);
  if (!frameCmp.ok) {
    void postCaptchaFeedback({
      attemptId,
      sessionId: resp.sessionId || sessionId,
      siteResult: "unknown",
      failReason: frameCmp.reason,
      imageHash,
    });
    throw new Error(`${frameCmp.reason}: ${frameCmp.detail}`);
  }

  try {
    const applied = await applyCaptchaSolution(page, resp, {
      selector: opts.selector,
      userSelector: opts.userSelector,
      probeSelector: opts.probeSelector || opts.selector,
      requestKind: kind,
    });
    captchaLog(jobId, "apply", {
      output: applied,
      url: page.url(),
      attemptId,
    });
    pushCaptchaTrace(opts.events, {
      phase: "apply",
      url: page.url(),
      kind: String(resp.kind || kind),
      selector: fillHint,
      text: resp.text,
      note: applied,
    });
    return applied;
  } catch (err) {
    void postCaptchaFeedback({
      attemptId,
      sessionId: resp.sessionId || sessionId,
      siteResult: "unknown",
      failReason: String(err).slice(0, 200),
      imageHash,
    });
    throw err;
  }
}
