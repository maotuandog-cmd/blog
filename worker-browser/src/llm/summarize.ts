import type { LLMConfig, StepResult, SummaryResult } from "../types.js";
import { chatJSON, sanitizeForLLM } from "./client.js";
import { SUMMARY_SYSTEM } from "./prompts.js";

export async function summarize({
  llm,
  goal,
  steps,
  extracted,
  purpose,
}: {
  llm: LLMConfig;
  goal?: string;
  purpose?: string;
  steps?: StepResult[];
  extracted?: unknown;
}): Promise<SummaryResult> {
  const user = sanitizeForLLM(
    JSON.stringify(
      {
        purpose,
        goal,
        steps: (steps || []).map((s) => ({
          name: s.name,
          success: s.success,
          output: s.output?.slice?.(0, 500),
          error: s.error,
        })),
        extracted,
      },
      null,
      2
    ),
    14000
  );
  return chatJSON<SummaryResult>({
    baseUrl: llm.baseUrl,
    apiKey: llm.apiKey,
    model: llm.model,
    system: SUMMARY_SYSTEM,
    user,
    temperature: 0.1,
  });
}
