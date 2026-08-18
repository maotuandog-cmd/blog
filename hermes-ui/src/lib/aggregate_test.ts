/**
 * Lightweight checks for aggregate helpers (run: npx tsx src/lib/aggregate_test.ts).
 */
import {
  buildHeuristicAlerts,
  extractVitals,
  normalizeFailMessage,
  percentile,
  topFailMessages,
  type ProbePoint,
} from "./aggregate.ts";
import type { AuditEvent } from "../types.ts";

function ev(
  partial: Partial<AuditEvent> & Pick<AuditEvent, "id" | "jobId" | "name" | "status">
): AuditEvent {
  return {
    protocol: "BROWSER",
    createdAt: partial.createdAt || new Date().toISOString(),
    success: partial.success,
    message: partial.message,
    asset: partial.asset,
    ...partial,
  } as AuditEvent;
}

function point(
  app: string,
  ok: boolean,
  at: number,
  message?: string
): ProbePoint {
  return {
    app,
    ok,
    at,
    event: ev({
      id: `${app}-${at}`,
      jobId: `job-${app}`,
      name: app,
      status: ok ? "SUCCESS" : "FAILED",
      success: ok,
      message,
      createdAt: new Date(at).toISOString(),
    }),
  };
}

const sorted = [10, 20, 30, 40, 100];
if (percentile(sorted, 95) !== 100) throw new Error("p95");
if (percentile([], 95) !== 0) throw new Error("empty p95");

const norm = normalizeFailMessage(
  "assertText failed Timeout 30000ms id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
);
if (!norm.includes("Timeout") || norm.includes("30000")) {
  throw new Error("normalize " + norm);
}

const now = Date.now();
const streakPoints = [
  point("app-a", false, now - 1000, "assert fail"),
  point("app-a", false, now - 2000, "assert fail"),
  point("app-a", false, now - 3000, "assert fail"),
  point("app-b", true, now - 1000),
];
const alerts = buildHeuristicAlerts(streakPoints, now);
if (!alerts.some((a) => a.app === "app-a" && a.severity === "crit")) {
  throw new Error("expected streak alert " + JSON.stringify(alerts));
}

const msgs = topFailMessages(
  [
    point("x", false, now, "Timeout 10000ms"),
    point("y", false, now - 1, "Timeout 20000ms"),
    point("z", false, now - 2, "other"),
  ],
  5
);
if (msgs[0]!.count < 2) throw new Error("top msg group " + JSON.stringify(msgs));

const v = extractVitals({
  hermes_browser_ttfb_ms: 12,
  hermes_browser_lcp_ms: 800,
  hermes_browser_resource_total: 3,
});
if (!v || v.ttfbMs !== 12 || v.lcpMs !== 800 || v.fcpMs != null) {
  throw new Error("extractVitals " + JSON.stringify(v));
}
if (extractVitals({}) !== null) throw new Error("empty vitals");
if (extractVitals({ hermes_browser_fcp_ms: Number.NaN }) !== null) {
  throw new Error("nan vitals");
}

console.log("aggregate_ok");
