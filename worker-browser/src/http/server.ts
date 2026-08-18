import http from "node:http";
import { config } from "../config.js";
import { runAgentJourney } from "../journey/agent.js";
import { runScriptJourney } from "../journey/script.js";
import type { AgentPayload, ScriptPayload } from "../types.js";
import { readJson, sendJSON, unwrapJobId, unwrapLLM, unwrapPayload } from "./request.js";

/**
 * Hermes browser-worker HTTP API:
 *   GET  /healthz
 *   POST /v1/browser/run    — deterministic BROWSER
 *   POST /v1/browser/agent  — BROWSER_AGENT
 */
export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      if (req.method === "POST" && req.url === "/v1/browser/run") {
        const parsed = await readJson(req);
        const jobId = unwrapJobId(parsed);
        const result = await runScriptJourney(
          unwrapPayload(parsed) as ScriptPayload,
          { jobId }
        );
        sendJSON(res, 200, result);
        return;
      }
      if (req.method === "POST" && req.url === "/v1/browser/agent") {
        const parsed = await readJson(req);
        const jobId = unwrapJobId(parsed);
        const payload = unwrapPayload(parsed) as unknown as AgentPayload;
        const llm = unwrapLLM(parsed, config.llm);
        const result = await runAgentJourney(payload, llm, { jobId });
        sendJSON(res, 200, result);
        return;
      }
      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      sendJSON(res, 500, {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

export function startServer(port = config.port): http.Server {
  const server = createServer();
  server.listen(port, () => {
    console.log(
      `hermes browser-worker on :${port} headless=${config.headless} locale=${config.locale} captchaWebhook=${config.captchaWebhook || "(none)"}`
    );
  });
  return server;
}
