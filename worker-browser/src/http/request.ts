import type { IncomingMessage, ServerResponse } from "node:http";
import type { LLMConfig } from "../types.js";

/**
 * HTTP body helpers for browser-worker API.
 */
export async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

export function unwrapPayload(parsed: unknown): Record<string, unknown> {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  if (typeof obj.payload === "string") {
    return JSON.parse(obj.payload) as Record<string, unknown>;
  }
  if (obj.payload && typeof obj.payload === "object") {
    return obj.payload as Record<string, unknown>;
  }
  return obj;
}

export function unwrapLLM(
  parsed: unknown,
  defaults: Partial<LLMConfig> = {}
): LLMConfig {
  const obj = (parsed ?? {}) as {
    llm?: Partial<LLMConfig>;
  };
  return {
    apiKey: obj.llm?.apiKey || defaults.apiKey || "",
    baseUrl:
      obj.llm?.baseUrl || defaults.baseUrl || "https://api.openai.com/v1",
    model: obj.llm?.model || defaults.model || "gpt-4o-mini",
  };
}

export function unwrapJobId(parsed: unknown): string {
  const obj = (parsed ?? {}) as { jobId?: unknown };
  return typeof obj.jobId === "string" && obj.jobId ? obj.jobId : "anonymous";
}

export function sendJSON(
  res: ServerResponse,
  code: number,
  obj: unknown
): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}
