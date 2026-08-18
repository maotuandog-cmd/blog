import type { BrowserContext, Page } from "playwright";

const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

export function pickUserAgent(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)]!;
}

/** Stealth-ish init script: reduce obvious automation signals (L2/L3). */
export const STEALTH_INIT_SCRIPT = `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
window.chrome = window.chrome || { runtime: {} };
Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) => (
  parameters.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission })
    : originalQuery(parameters)
);
`;

export interface ContextBuildInput {
  locale?: string;
  antiDetect?: string;
  proxyUrl?: string;
}

export function buildContextOptions({
  locale,
  antiDetect,
  proxyUrl,
}: ContextBuildInput): {
  level: string;
  opts: Record<string, unknown>;
} {
  const level = (antiDetect || "L3").toUpperCase();
  const opts: Record<string, unknown> = {
    locale: locale || "zh-CN",
    ignoreHTTPSErrors: true,
    viewport: {
      width: 1365 + Math.floor(Math.random() * 40),
      height: 900 + Math.floor(Math.random() * 40),
    },
    userAgent: pickUserAgent(),
    timezoneId: "Asia/Shanghai",
  };
  if ((level === "L3" || level === "L2") && proxyUrl) {
    opts.proxy = parseProxy(proxyUrl);
  }
  return { level, opts };
}

function parseProxy(proxyUrl: string): {
  server: string;
  username?: string;
  password?: string;
} {
  const u = new URL(proxyUrl);
  const server = `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`;
  const out: { server: string; username?: string; password?: string } = {
    server,
  };
  if (u.username) out.username = decodeURIComponent(u.username);
  if (u.password) out.password = decodeURIComponent(u.password);
  return out;
}

export async function applyAntiDetect(
  context: BrowserContext,
  level: string
): Promise<void> {
  if (level === "L2" || level === "L3") {
    await context.addInitScript(STEALTH_INIT_SCRIPT);
  }
}

/**
 * Optional captcha hook for L3. If HERMES_CAPTCHA_WEBHOOK is set,
 * POST { pageUrl, screenshotBase64 } and expect { solved: true }.
 */
export async function maybeSolveCaptcha(page: Page): Promise<boolean> {
  const hook = process.env.HERMES_CAPTCHA_WEBHOOK;
  if (!hook) return false;
  const url = page.url();
  const buf = await page.screenshot({ fullPage: false });
  const res = await fetch(hook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageUrl: url,
      screenshotBase64: buf.toString("base64"),
    }),
  });
  if (!res.ok) return false;
  const data = (await res.json().catch(() => ({}))) as { solved?: boolean };
  return Boolean(data.solved);
}
