/**
 * OpenAI-compatible Chat Completions client.
 * Never log apiKey. Caller must sanitize content before send.
 */

import { isLLMMock, mockChatJSON } from "./mock.js";

export interface ChatJSONInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
}

export async function chatJSON<T = Record<string, unknown>>({
  baseUrl,
  apiKey,
  model,
  system,
  user,
  temperature = 0.2,
}: ChatJSONInput): Promise<T> {
  if (isLLMMock()) {
    return mockChatJSON(system, user) as T;
  }
  if (!apiKey) {
    throw new Error("HERMES_LLM_API_KEY missing");
  }
  const url = `${String(baseUrl || "").replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`llm http ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(content) as T;
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new Error("llm returned non-json");
  }
}

/** Strip secrets-ish patterns before sending page text to public cloud. */
export function sanitizeForLLM(text: string, maxLen = 12000): string {
  let s = String(text || "");
  s = s.replace(
    /(password|passwd|pwd|token|authorization|cookie)\s*[:=]\s*\S+/gi,
    "$1:[REDACTED]"
  );
  s = s.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, "Bearer [REDACTED]");
  if (s.length > maxLen) s = s.slice(0, maxLen) + "\n...(truncated)";
  return s;
}
