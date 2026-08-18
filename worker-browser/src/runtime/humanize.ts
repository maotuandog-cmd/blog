import type { Page } from "playwright";

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export type PauseKind = "think" | "type" | "click" | "scroll";

export async function humanPause(
  page: Page,
  kind: PauseKind | string = "think"
): Promise<void> {
  const ranges: Record<string, [number, number]> = {
    think: [400, 1200],
    type: [40, 120],
    click: [120, 380],
    scroll: [200, 600],
  };
  const [a, b] = ranges[kind] || ranges.think!;
  await page.waitForTimeout(rand(a!, b!));
}

export async function humanType(
  page: Page,
  selector: string,
  text: string
): Promise<void> {
  await page.click(selector, { timeout: 15000 });
  await humanPause(page, "click");
  for (const ch of String(text ?? "")) {
    await page.keyboard.type(ch, { delay: rand(40, 140) });
  }
}

export async function humanClick(page: Page, selector: string): Promise<void> {
  const loc = page.locator(selector).first();
  const box = await loc.boundingBox();
  if (box) {
    const x = box.x + box.width * rand(0.3, 0.7);
    const y = box.y + box.height * rand(0.3, 0.7);
    await page.mouse.move(x, y, { steps: 8 + Math.floor(Math.random() * 10) });
    await humanPause(page, "click");
    await page.mouse.click(x, y);
  } else {
    await loc.click({ timeout: 15000 });
  }
}

export async function humanScroll(page: Page): Promise<void> {
  await page.mouse.wheel(0, rand(200, 700));
  await humanPause(page, "scroll");
}
