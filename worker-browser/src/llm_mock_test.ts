import { chatJSON } from "./llm/client.js";
import { isLLMMock, resetLLMMockState } from "./llm/mock.js";
import { AGENT_SYSTEM, SUMMARY_SYSTEM } from "./llm/prompts.js";

resetLLMMockState();
process.env.HERMES_LLM_MOCK = "true";

if (!isLLMMock()) {
  console.error("isLLMMock expected true");
  process.exit(1);
}

const plan = await chatJSON({
  baseUrl: "http://unused",
  apiKey: "",
  model: "mock",
  system: AGENT_SYSTEM,
  user: JSON.stringify({ goal: "t", step: 1 }),
});
if (plan.action !== "done") {
  console.error("expected done", plan);
  process.exit(1);
}

const summary = await chatJSON({
  baseUrl: "http://unused",
  apiKey: "",
  model: "mock",
  system: SUMMARY_SYSTEM,
  user: "{}",
});
if (!summary.conclusion || !Array.isArray(summary.findings)) {
  console.error("bad summary", summary);
  process.exit(1);
}

delete process.env.HERMES_LLM_MOCK;
resetLLMMockState();
console.log("llm_mock_ok");
