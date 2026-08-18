/**
 * Captcha Trace IDs: attemptId + imageHash (REQ_CAPTCHA_TRACE_BINDING).
 */
import { createHash, randomUUID } from "node:crypto";
import { config } from "../config.js";

export function newAttemptId(): string {
  return `att_${randomUUID()}`;
}

/** SHA-256 of raw screenshot bytes (not Base64 string). */
export function hashScreenshotBytes(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function deriveFeedbackUrl(webhookUrl?: string): string {
  const url = String(webhookUrl || config.captchaWebhook || "").trim();
  if (!url) return "";
  if (url.includes("/captcha/feedback")) return url;
  if (url.endsWith("/captcha")) return url.replace(/\/captcha$/, "/captcha/feedback");
  if (url.endsWith("/")) return `${url}captcha/feedback`;
  return `${url}/captcha/feedback`;
}

export type CaptchaSiteResult = "passed" | "failed" | "unknown";

export async function postCaptchaFeedback(body: {
  attemptId: string;
  sessionId?: string;
  siteResult: CaptchaSiteResult;
  failReason?: string;
  imageHash?: string;
  timestamp?: number;
}): Promise<void> {
  const url = deriveFeedbackUrl();
  if (!url) return;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.captchaApiKey) {
    headers.Authorization = `Bearer ${config.captchaApiKey}`;
  }
  const payload = {
    attemptId: body.attemptId,
    ...(body.sessionId ? { sessionId: body.sessionId } : {}),
    siteResult: body.siteResult,
    status: body.siteResult,
    reason: body.failReason || "",
    failReason: body.failReason || "",
    timestamp: body.timestamp ?? Date.now(),
    ...(body.imageHash ? { imageHash: body.imageHash } : {}),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch {
    /* feedback must never break the journey */
  } finally {
    clearTimeout(timer);
  }
}
