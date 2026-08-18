import type { Page } from "playwright";
import type { JourneyStep, StepResult } from "../types.js";
import {
  dragByDelta,
  solveAndApplyCaptcha,
} from "../runtime/captcha.js";
import {
  maybeAutoCaptcha,
  type CaptchaBudget,
  type CaptchaTraceEntry,
} from "../runtime/captchaDetect.js";

export interface RunStepContext {
  jobId?: string;
  autoCaptcha?: boolean;
  captchaBudget?: CaptchaBudget;
  captchaSelector?: string;
  skipAutoCaptcha?: boolean;
  captchaEvents?: CaptchaTraceEntry[];
}

const AUTO_CAPTCHA_AFTER = new Set(["navigate", "fill", "click", "drag"]);

function parseDragDeltas(step: JourneyStep): { deltaX: number; deltaY: number } {
  if (typeof step.deltaX === "number" && Number.isFinite(step.deltaX)) {
    return {
      deltaX: step.deltaX,
      deltaY: typeof step.deltaY === "number" ? step.deltaY : 0,
    };
  }
  if (typeof step.toX === "number" && Number.isFinite(step.toX)) {
    // toX absolute is applied in runStep after bounding box
    return { deltaX: NaN, deltaY: 0 };
  }
  if (step.value) {
    try {
      const j = JSON.parse(step.value) as {
        deltaX?: number;
        deltaY?: number;
        toX?: number;
      };
      if (typeof j.deltaX === "number") {
        return { deltaX: j.deltaX, deltaY: typeof j.deltaY === "number" ? j.deltaY : 0 };
      }
    } catch {
      const n = Number(step.value);
      if (Number.isFinite(n)) return { deltaX: n, deltaY: 0 };
    }
  }
  throw new Error("drag requires deltaX, toX, or value JSON/number");
}

/**
 * Shared deterministic step runner for BROWSER journeys.
 */
export async function runStep(
  page: Page,
  step: JourneyStep,
  name: string,
  ctx: RunStepContext = {}
): Promise<StepResult> {
  const t0 = Date.now();
  let output: string | undefined;
  switch (step.action) {
    case "navigate":
      await page.goto(step.url!, {
        waitUntil: "domcontentloaded",
        timeout: (step.timeoutSec || 60) * 1000,
      });
      break;
    case "fill":
      await page.fill(step.selector!, step.value ?? "");
      break;
    case "click":
      await page.click(step.selector!, {
        timeout: (step.timeoutSec || 30) * 1000,
      });
      break;
    case "wait":
      await page.waitForTimeout((step.timeoutSec || 1) * 1000);
      break;
    case "assertText": {
      const text = await page.locator(step.selector!).innerText();
      if (!text.includes(step.value || "")) {
        throw new Error(`assertText failed: got="${text}"`);
      }
      break;
    }
    case "screenshot": {
      const path = step.value || `screenshot-${Date.now()}.png`;
      await page.screenshot({ path, fullPage: true });
      break;
    }
    case "drag": {
      if (!step.selector) throw new Error("drag requires selector");
      if (typeof step.toX === "number" && Number.isFinite(step.toX)) {
        const box = await page.locator(step.selector).first().boundingBox();
        if (!box) throw new Error(`drag target not found: ${step.selector}`);
        const fromX = box.x + Math.min(box.width * 0.5, Math.max(4, box.width * 0.2));
        const fromY = box.y + box.height / 2;
        await page.mouse.move(fromX, fromY);
        await page.mouse.down();
        await page.mouse.move(step.toX, fromY, { steps: 20 });
        await page.mouse.up();
        output = `drag toX=${step.toX}`;
      } else {
        const { deltaX, deltaY } = parseDragDeltas(step);
        await dragByDelta(page, step.selector, deltaX, deltaY);
        output = `drag deltaX=${deltaX}`;
      }
      break;
    }
    case "solveCaptcha": {
      output = await solveAndApplyCaptcha(page, {
        jobId: ctx.jobId,
        kind: step.kind || step.value,
        selector: step.selector,
        timeoutSec: step.timeoutSec,
        events: ctx.captchaEvents,
      });
      break;
    }
    default:
      throw new Error(`unknown action: ${step.action}`);
  }
  if (!ctx.skipAutoCaptcha && AUTO_CAPTCHA_AFTER.has(String(step.action))) {
    const cap = await maybeAutoCaptcha(page, {
      ...ctx,
      waitCaptchaInputMs: step.action === "navigate" ? 800 : 5000,
    });
    if (cap) output = output ? `${output}; ${cap}` : cap;
  }
  return { name, success: true, durationMs: Date.now() - t0, output };
}

export function failStep(
  name: string,
  error: unknown,
  durationMs = 0
): StepResult {
  return {
    name,
    success: false,
    error: error instanceof Error ? error.message : String(error),
    durationMs,
  };
}
