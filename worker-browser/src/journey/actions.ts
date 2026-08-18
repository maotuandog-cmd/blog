import type { Page } from "playwright";
import type { AgentDecision, JourneyStep, StepResult } from "../types.js";
import { assertUrlAllowed } from "../security/allowlist.js";
import { humanClick, humanScroll, humanType } from "../runtime/humanize.js";

/** Hybrid deterministic steps before agent loop. */
export async function runDeterministic(
  page: Page,
  steps: JourneyStep[],
  allowedHosts: string[],
  stepResults: StepResult[]
): Promise<void> {
  for (const [i, step] of (steps || []).entries()) {
    const name = `det-${i + 1}-${step.action}`;
    const t0 = Date.now();
    try {
      if (step.action === "navigate") {
        assertUrlAllowed(step.url!, allowedHosts);
        await page.goto(step.url!, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
      } else if (step.action === "fill") {
        await humanType(page, step.selector!, step.value ?? "");
      } else if (step.action === "click") {
        await humanClick(page, step.selector!);
      } else if (step.action === "wait") {
        await page.waitForTimeout((step.timeoutSec || 1) * 1000);
      } else {
        throw new Error(`unsupported det action ${step.action}`);
      }
      stepResults.push({ name, success: true, durationMs: Date.now() - t0 });
    } catch (err) {
      stepResults.push({
        name,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      });
      throw err;
    }
  }
}

/** Apply one LLM-planned action. */
export async function applyAction(
  page: Page,
  action: AgentDecision,
  allowedHosts: string[]
): Promise<void> {
  const a = action.action;
  if (a === "navigate") {
    const target = String(action.value || action.url || "");
    assertUrlAllowed(target, allowedHosts);
    await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    return;
  }
  if (a === "fill") {
    await humanType(page, action.selector!, String(action.value ?? ""));
    return;
  }
  if (a === "click") {
    await humanClick(page, action.selector!);
    return;
  }
  if (a === "scroll") {
    await humanScroll(page);
    return;
  }
  if (a === "wait") {
    await page.waitForTimeout(Number(action.value || 1) * 1000);
    return;
  }
  if (a === "extract") return;
  if (a === "done" || a === "fail") return;
  throw new Error(`unknown action ${a}`);
}
