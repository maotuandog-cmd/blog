import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from "playwright";
import { chromium } from "playwright";
import { config } from "../config.js";
import { applyAntiDetect, buildContextOptions } from "../runtime/antiDetect.js";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  level: string;
  close(): Promise<void>;
}

/**
 * Isolated Playwright session with anti-detect profile.
 * Always close via session.close().
 */
export async function openSession({
  locale,
  antiDetect = "L2",
  proxyUrl,
  headless = config.headless,
}: {
  locale?: string;
  antiDetect?: string;
  proxyUrl?: string;
  headless?: boolean;
} = {}): Promise<BrowserSession> {
  const { level, opts } = buildContextOptions({
    locale: locale || config.locale,
    antiDetect,
    proxyUrl: proxyUrl || config.proxyUrl || undefined,
  });
  const browser = await chromium.launch({
    headless,
    args:
      level === "L3" ? ["--disable-blink-features=AutomationControlled"] : [],
  });
  const context = await browser.newContext(opts as BrowserContextOptions);
  await applyAntiDetect(context, level);
  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    level,
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
