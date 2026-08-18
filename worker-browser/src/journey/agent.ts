import { captureTraceMode, resourceOptions } from "../config.js";
import { openSession } from "../browser/session.js";
import { finalizeCollector, maybeCreateCollector } from "../browser/resources.js";
import { assertUrlAllowed } from "../security/allowlist.js";
import { maybeSolveCaptcha } from "../runtime/antiDetect.js";
import { captureFailureEvidence } from "../runtime/evidence.js";
import { humanPause } from "../runtime/humanize.js";
import { finishTracing, startTracing } from "../runtime/trace.js";
import { chatJSON, sanitizeForLLM } from "../llm/client.js";
import { isLLMMock } from "../llm/mock.js";
import { AGENT_SYSTEM } from "../llm/prompts.js";
import { summarize } from "../llm/summarize.js";
import { applyAction, runDeterministic } from "./actions.js";
import { observe } from "./observe.js";
import type {
  AgentDecision,
  AgentPayload,
  JourneyResult,
  LLMConfig,
  StepResult,
  SummaryResult,
} from "../types.js";
import type { JourneyRunOpts } from "./script.js";

/**
 * BROWSER_AGENT: observe → LLM plan → act → reflect → optional summary.
 * No Web Vitals (BROWSER only). Failure Trace → MinIO supported.
 */
export async function runAgentJourney(
  payload: AgentPayload,
  llm: LLMConfig,
  opts: JourneyRunOpts = {}
): Promise<JourneyResult> {
  const started = Date.now();
  const allowedHosts = payload.allowedHosts || [];
  const maxSteps = payload.maxSteps || 12;
  const summarizeOn = payload.summarize !== false;
  const antiDetect = payload.antiDetect || "L3";
  const stepResults: StepResult[] = [];
  let extracted: unknown = null;
  let success = false;
  let message = "ok";
  const traceMode = captureTraceMode(payload);
  const jobId = opts.jobId || "anonymous";

  assertUrlAllowed(payload.startUrl, allowedHosts);

  const resOpts = resourceOptions(payload);
  const session = await openSession({
    locale: payload.locale,
    antiDetect,
    proxyUrl: payload.proxyUrl,
  });
  const { page, context, level } = session;
  const collector = maybeCreateCollector(resOpts);
  if (collector) collector.attach(page);

  const tracingOn = traceMode !== "never";
  if (tracingOn) {
    await startTracing(context).catch(() => {});
  }

  try {
    await page.goto(payload.startUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    stepResults.push({
      name: "start-navigate",
      success: true,
      output: page.url(),
      durationMs: 0,
    });
    await humanPause(page, "think");
    await maybeSolveCaptcha(page);

    if (payload.deterministic?.length) {
      await runDeterministic(
        page,
        payload.deterministic,
        allowedHosts,
        stepResults
      );
    }

    for (let i = 0; i < maxSteps; i++) {
      assertUrlAllowed(page.url(), allowedHosts);
      const obs = await observe(page);
      const t0 = Date.now();
      let decision: AgentDecision;
      try {
        decision = await chatJSON<AgentDecision>({
          baseUrl: llm.baseUrl,
          apiKey: llm.apiKey,
          model: llm.model,
          system: AGENT_SYSTEM,
          user: sanitizeForLLM(
            JSON.stringify({
              goal: payload.goal,
              purpose: payload.purpose,
              step: i + 1,
              maxSteps,
              observation: obs,
              extractSchema: payload.extractSchema || null,
            }),
            14000
          ),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stepResults.push({
          name: `llm-${i + 1}`,
          success: false,
          error: msg,
          durationMs: Date.now() - t0,
        });
        message = msg;
        success = false;
        break;
      }

      const name = `agent-${i + 1}-${decision.action || "unknown"}`;
      try {
        if (decision.action === "done") {
          if (decision.value) {
            try {
              extracted =
                typeof decision.value === "string"
                  ? JSON.parse(decision.value)
                  : decision.value;
            } catch {
              extracted = { raw: decision.value };
            }
          }
          stepResults.push({
            name,
            success: true,
            output: decision.reason || "done",
            durationMs: Date.now() - t0,
          });
          success = true;
          message = "done";
          break;
        }
        if (decision.action === "fail") {
          throw new Error(
            String(decision.value || decision.reason || "agent fail")
          );
        }
        await applyAction(page, decision, allowedHosts);
        await humanPause(page, "think");
        stepResults.push({
          name,
          success: true,
          output: decision.reason || "",
          durationMs: Date.now() - t0,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stepResults.push({
          name,
          success: false,
          error: msg,
          durationMs: Date.now() - t0,
        });
        message = msg;
        success = false;
        break;
      }
    }

    if (!success && message === "ok") {
      message = "max steps reached without done";
    }

    let artifacts: Record<string, string> | undefined;
    if (!success) {
      artifacts = await captureFailureEvidence(page);
    }

    const { resources, metrics } = await finalizeCollector(
      page,
      collector,
      resOpts
    );

    let summary: SummaryResult | null = null;
    if (summarizeOn && (llm?.apiKey || isLLMMock())) {
      try {
        summary = await summarize({
          llm,
          goal: payload.goal,
          purpose: payload.purpose,
          steps: stepResults,
          extracted,
        });
      } catch (err) {
        summary = {
          conclusion: "总结失败",
          anomalies: [err instanceof Error ? err.message : String(err)],
          findings: [],
          evidenceRefs: [],
        };
      }
    }

    if (tracingOn) {
      artifacts = await finishTracing({
        context,
        jobId,
        mode: traceMode,
        success,
        artifacts,
      });
    }

    return {
      success,
      message,
      durationMs: Date.now() - started,
      steps: stepResults,
      artifacts,
      metrics,
      extra: {
        antiDetect: level,
        extracted,
        summary,
        finalUrl: page.url(),
        ...(resources ? { resources } : {}),
      },
    };
  } finally {
    await session.close();
  }
}
