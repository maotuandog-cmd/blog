/**
 * Deterministic LLM stub for T02 (no public cloud / API key).
 * Enable with HERMES_LLM_MOCK=true|1|yes.
 */

import { SUMMARY_SYSTEM } from "./prompts.js";

let plannerCalls = 0;

export function isLLMMock(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const v = String(env.HERMES_LLM_MOCK || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Test helper. */
export function resetLLMMockState(): void {
  plannerCalls = 0;
}

export function mockChatJSON(
  system: string,
  _user: string
): Record<string, unknown> {
  if (system.includes("运维巡检") || system === SUMMARY_SYSTEM) {
    return {
      conclusion: "mock summary: journey completed under HERMES_LLM_MOCK",
      findings: ["mock planner returned done"],
      anomalies: [],
      evidenceRefs: ["start-navigate"],
    };
  }

  plannerCalls += 1;
  return {
    action: "done",
    value: JSON.stringify({ mock: true, plannerCalls }),
    reason: "HERMES_LLM_MOCK",
  };
}
