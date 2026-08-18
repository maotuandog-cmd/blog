import type { ResourceOptions, ScriptPayload } from "./types.js";

function envFlag(v: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(v || "").trim().toLowerCase());
}

/** Accept host:port, http://host:port, or full /captcha URL. */
export function normalizeCaptchaWebhook(raw?: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : `http://${s}`;
  try {
    const u = new URL(withScheme);
    if (!u.pathname || u.pathname === "/") {
      u.pathname = "/captcha";
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return s;
  }
}

/** Runtime config from environment. */
export const config = {
  port: Number(process.env.HERMES_BROWSER_PORT || 8090),
  locale: process.env.HERMES_BROWSER_LOCALE || "zh-CN",
  headless: (process.env.HERMES_BROWSER_HEADLESS || "true") !== "false",
  proxyUrl: process.env.HERMES_PROXY_URL || "",
  captchaWebhook: normalizeCaptchaWebhook(process.env.HERMES_CAPTCHA_WEBHOOK),
  captchaTimeoutSec: Number(process.env.HERMES_CAPTCHA_TIMEOUT_SEC || 60),
  captchaApiKey: process.env.HERMES_CAPTCHA_API_KEY || "",
  llm: {
    apiKey: process.env.HERMES_LLM_API_KEY || "",
    baseUrl: process.env.HERMES_LLM_BASE_URL || "https://api.openai.com/v1",
    model: process.env.HERMES_LLM_MODEL || "gpt-4o-mini",
  },
  /** T02: skip real Chat Completions; see src/llm/mock.ts */
  llmMock: envFlag(process.env.HERMES_LLM_MOCK),
  s3: {
    endpoint: process.env.HERMES_S3_ENDPOINT || "",
    bucket: process.env.HERMES_S3_BUCKET || "",
    accessKey: process.env.HERMES_S3_ACCESS_KEY || "",
    secretKey: process.env.HERMES_S3_SECRET_KEY || "",
    region: process.env.HERMES_S3_REGION || "us-east-1",
    forcePathStyle: envFlag(process.env.HERMES_S3_FORCE_PATH_STYLE || "true"),
    urlTtlSec: Number(process.env.HERMES_TRACE_URL_TTL_SEC || 86400),
  },
};

export function s3Configured(): boolean {
  const s = config.s3;
  return Boolean(s.endpoint && s.bucket && s.accessKey && s.secretKey);
}

export type CaptureTraceMode = "on_failure" | "always" | "never";

export function captureTraceMode(payload: ScriptPayload = {}): CaptureTraceMode {
  const raw = String(payload.captureTrace || "on_failure").toLowerCase();
  if (raw === "always" || raw === "never" || raw === "on_failure") return raw;
  return "on_failure";
}

export function resourceOptions(payload: ScriptPayload = {}): ResourceOptions {
  return {
    enabled: payload.collectResources === true,
    detail: payload.resourceDetail === true,
    detailLimit: payload.resourceDetailLimit || 40,
    settleMs:
      Number(payload.resourceSettleMs) > 0
        ? Number(payload.resourceSettleMs)
        : 800,
    waitNetworkIdle: payload.waitNetworkIdle === true,
    collectMode:
      payload.collectMode ||
      ((payload.authSteps || []).length ? "afterAuth" : "all"),
  };
}
