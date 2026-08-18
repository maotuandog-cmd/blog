import type { Page } from "playwright";

/**
 * Capture failure evidence for F-BRW-04: screenshot + page text snapshot.
 * Returns artifacts map suitable for Hermes Result.artifacts.
 */
export async function captureFailureEvidence(
  page: Page,
  { maxText = 8000 }: { maxText?: number } = {}
): Promise<Record<string, string>> {
  const artifacts: Record<string, string> = {};
  try {
    const buf = await page.screenshot({ fullPage: true, type: "png" });
    artifacts.screenshotPngBase64 = Buffer.from(buf).toString("base64");
  } catch (err) {
    artifacts.screenshotError = err instanceof Error ? err.message : String(err);
  }
  try {
    const text = await page.evaluate(() => {
      const t = document.body?.innerText || "";
      return t.replace(/\s+/g, " ").trim();
    });
    artifacts.pageText = String(text || "").slice(0, maxText);
  } catch (err) {
    artifacts.pageTextError = err instanceof Error ? err.message : String(err);
  }
  try {
    artifacts.finalUrl = page.url();
    artifacts.pageTitle = await page.title().catch(() => "");
  } catch {
    /* ignore */
  }
  return artifacts;
}
