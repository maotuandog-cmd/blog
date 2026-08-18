import type { Page } from "playwright";
import { sanitizeForLLM } from "../llm/client.js";

export interface PageObservation {
  title: string;
  url: string;
  text: string;
  controls: Array<{
    i: number;
    tag: string;
    type: string;
    name: string;
    id: string;
    ph: string;
    aria: string;
    text: string;
    sel: string | null;
  }>;
}

/** Compact page observation for planner. */
export async function observe(page: Page): Promise<PageObservation> {
  const title = await page.title().catch(() => "");
  const url = page.url();
  const text = await page.evaluate(() => {
    const t = document.body?.innerText || "";
    return t.replace(/\s+/g, " ").trim().slice(0, 8000);
  });
  const controls = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(
        "a[href],button,input,select,textarea,[role='button'],[role='link'],[role='tab']"
      )
    ).slice(0, 80);
    return nodes.map((el, i) => {
      const htmlEl = el as HTMLElement;
      const tag = htmlEl.tagName.toLowerCase();
      const type = htmlEl.getAttribute("type") || "";
      const name = htmlEl.getAttribute("name") || "";
      const id = htmlEl.id || "";
      const ph = htmlEl.getAttribute("placeholder") || "";
      const aria = htmlEl.getAttribute("aria-label") || "";
      const text = (
        htmlEl.innerText ||
        (htmlEl as HTMLInputElement).value ||
        ""
      )
        .trim()
        .slice(0, 80);
      const sel = id
        ? `#${CSS.escape(id)}`
        : name
          ? `${tag}[name="${name}"]`
          : ph
            ? `${tag}[placeholder="${ph}"]`
            : null;
      return { i, tag, type, name, id, ph, aria, text, sel };
    });
  });
  return { title, url, text: sanitizeForLLM(text, 8000), controls };
}
