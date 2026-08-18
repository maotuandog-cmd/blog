import {
  captureTraceMode,
  resourceOptions,
} from "../config.js";
import { openSession } from "../browser/session.js";
import { failStep, runStep } from "../browser/steps.js";
import { finalizeCollector, maybeCreateCollector } from "../browser/resources.js";
import { captureFailureEvidence } from "../runtime/evidence.js";
import { finishTracing, startTracing } from "../runtime/trace.js";
import {
  collectWebVitals,
  mergeMetrics,
} from "../runtime/webVitals.js";
import { credentialsReady, runAutoLogin } from "./login.js";
import type { CaptchaBudget, CaptchaTraceEntry } from "../runtime/captchaDetect.js";
import type {
  BrowserCredentials,
  JourneyResult,
  ScriptPayload,
  StepResult,
} from "../types.js";

export interface JourneyRunOpts {
  jobId?: string;
}

/**
 * Deterministic BROWSER journey: optional auto-login → authSteps → business steps.
 */
export async function runScriptJourney(
  payload: ScriptPayload,
  opts: JourneyRunOpts = {}
): Promise<JourneyResult> {
  const authSteps = payload.authSteps || [];
  const steps = payload.steps || [];
  const resOpts = resourceOptions(payload);
  const traceMode = captureTraceMode(payload);
  const wantVitals = payload.collectWebVitals === true;
  const jobId = opts.jobId || "anonymous";
  const autoCaptcha = payload.autoCaptcha !== false;
  const captchaBudget: CaptchaBudget = { used: 0, max: 3 };
  const captchaEvents: CaptchaTraceEntry[] = [];
  const stepCtx = { jobId, autoCaptcha, captchaBudget, captchaEvents };

  const session = await openSession({
    locale: payload.locale,
    antiDetect: "L2",
    proxyUrl: payload.proxyUrl,
  });
  const { page, context, level } = session;
  const collector = maybeCreateCollector(resOpts);
  const results: StepResult[] = [];
  const started = Date.now();
  let success = true;
  let message = "ok";
  let artifacts: Record<string, string> | undefined;

  const tracingOn = traceMode !== "never";
  if (tracingOn) {
    await startTracing(context).catch(() => {});
  }

  try {
    if (collector && resOpts.collectMode === "all") {
      collector.attach(page);
    }

    let skipNavigateUrl: string | undefined;
    try {
      if (credentialsReady(payload.credentials)) {
        const creds: BrowserCredentials = { ...payload.credentials };
        if (!String(creds.loginUrl || "").trim()) {
          const firstNav = steps.find((s) => s.action === "navigate" && s.url);
          if (firstNav?.url) creds.loginUrl = firstNav.url;
        }
        const auto = await runAutoLogin(page, creds, {
          ...stepCtx,
          captchaSelector: creds.captchaSelector,
        });
        results.push(...auto.results);
        skipNavigateUrl = auto.consumedNavigateUrl;
      }
    } catch (err) {
      success = false;
      message = "auth failed: " + (err instanceof Error ? err.message : String(err));
      if (!results.some((r) => !r.success)) {
        results.push(failStep("auth-auto", message));
      }
      artifacts = await captureFailureEvidence(page);
    }

    if (success) {
      for (const [i, step] of authSteps.entries()) {
        const name = `auth-${i + 1}-${step.action}`;
        try {
          results.push(await runStep(page, step, name, stepCtx));
        } catch (err) {
          success = false;
          message = "auth failed: " + (err instanceof Error ? err.message : String(err));
          results.push(failStep(name, message));
          artifacts = await captureFailureEvidence(page);
          break;
        }
      }
    }

    if (success && collector && resOpts.collectMode === "afterAuth") {
      collector.attach(page);
    }

    if (success) {
      for (const [i, step] of steps.entries()) {
        const name = `step-${i + 1}-${step.action}`;
        if (
          i === 0 &&
          step.action === "navigate" &&
          skipNavigateUrl &&
          step.url === skipNavigateUrl
        ) {
          results.push({
            name,
            success: true,
            output: "skipped (already on login url)",
            durationMs: 0,
          });
          continue;
        }
        const t0 = Date.now();
        try {
          results.push(await runStep(page, step, name, stepCtx));
        } catch (err) {
          success = false;
          message = err instanceof Error ? err.message : String(err);
          results.push(failStep(name, err, Date.now() - t0));
          artifacts = await captureFailureEvidence(page);
          break;
        }
      }
    }

    const { resources, metrics: resMetrics } = await finalizeCollector(
      page,
      collector,
      resOpts
    );

    let metrics = resMetrics;
    let webVitalsExtra: unknown;
    if (wantVitals && success) {
      try {
        const { metrics: vm, extra } = await collectWebVitals(page, {
          settleMs: resOpts.settleMs,
        });
        metrics = mergeMetrics(resMetrics, vm);
        webVitalsExtra = extra;
      } catch (err) {
        webVitalsExtra = {
          error: err instanceof Error ? err.message : String(err),
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
      steps: results,
      artifacts,
      metrics,
      extra: {
        antiDetect: level,
        ...(resources
          ? { resources, collectMode: resOpts.collectMode }
          : {}),
        ...(webVitalsExtra ? { webVitals: webVitalsExtra } : {}),
        ...(captchaEvents.length ? { captcha: captchaEvents } : {}),
      },
    };
  } finally {
    await session.close();
  }
}
