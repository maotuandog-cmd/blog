/**
 * Collect browser network resource timings for synthetic probes (optional L2 layer).
 * Default output is aggregated by host + resourceType; optional top-N detail list.
 */

import type { Page, Request } from "playwright";
import type {
  ResourceBucket,
  ResourceEntry,
  ResourceSummary,
} from "../types.js";

function hostOf(url: string): string {
  try {
    return new URL(url).host || "unknown";
  } catch {
    return "unknown";
  }
}

function classify(request: Request): string {
  return request.resourceType?.() || "other";
}

export interface ResourceCollector {
  attach(page: Page): void;
  detach(page: Page): void;
  settle(ms?: number): Promise<void>;
  snapshot(): ResourceSummary;
}

export function createResourceCollector({
  detail = false,
  detailLimit = 40,
}: { detail?: boolean; detailLimit?: number } = {}): ResourceCollector {
  const entries: ResourceEntry[] = [];
  let startedAt = 0;
  let attached = false;

  function onFinished(request: Request): void {
    Promise.resolve()
      .then(async () => {
        const timing = request.timing();
        const response = await request.response().catch(() => null);
        const url = request.url();
        const resourceType = classify(request);
        const status = response ? response.status() : 0;
        const durationMs = Math.max(0, Math.round(timing?.responseEnd ?? 0));
        let size = 0;
        try {
          const headers = response ? await response.allHeaders() : {};
          const cl = headers["content-length"];
          if (cl) size = Number(cl) || 0;
        } catch {
          /* ignore */
        }
        entries.push({
          url: url.slice(0, 512),
          host: hostOf(url),
          resourceType,
          status,
          ok: status >= 200 && status < 400,
          durationMs: durationMs || 0,
          sizeBytes: size,
          phase: startedAt ? "collecting" : "early",
        });
      })
      .catch(() => {});
  }

  function onFailed(request: Request): void {
    const url = request.url();
    entries.push({
      url: url.slice(0, 512),
      host: hostOf(url),
      resourceType: classify(request),
      status: 0,
      ok: false,
      durationMs: 0,
      sizeBytes: 0,
      phase: "failed",
      error: request.failure()?.errorText || "requestfailed",
    });
  }

  return {
    attach(page: Page) {
      if (attached) return;
      attached = true;
      startedAt = Date.now();
      page.on("requestfinished", onFinished);
      page.on("requestfailed", onFailed);
    },
    detach(page: Page) {
      if (!attached) return;
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
      attached = false;
    },
    async settle(ms = 300) {
      await new Promise((r) => setTimeout(r, ms));
    },
    snapshot() {
      return summarizeResources(entries, { detail, detailLimit });
    },
  };
}

export function summarizeResources(
  entries: ResourceEntry[],
  { detail = false, detailLimit = 40 }: { detail?: boolean; detailLimit?: number } = {}
): ResourceSummary {
  const byType: Record<string, ResourceBucket> = {};
  const byHost: Record<string, ResourceBucket> = {};
  let total = 0;
  let failed = 0;
  let durationSum = 0;
  let durationMax = 0;
  let bytesSum = 0;

  for (const e of entries) {
    total += 1;
    if (!e.ok) failed += 1;
    durationSum += e.durationMs || 0;
    durationMax = Math.max(durationMax, e.durationMs || 0);
    bytesSum += e.sizeBytes || 0;

    const t = e.resourceType || "other";
    if (!byType[t]) {
      byType[t] = {
        count: 0,
        failed: 0,
        durationMsSum: 0,
        durationMsMax: 0,
        bytesSum: 0,
      };
    }
    byType[t]!.count += 1;
    if (!e.ok) byType[t]!.failed += 1;
    byType[t]!.durationMsSum += e.durationMs || 0;
    byType[t]!.durationMsMax = Math.max(
      byType[t]!.durationMsMax,
      e.durationMs || 0
    );
    byType[t]!.bytesSum = (byType[t]!.bytesSum || 0) + (e.sizeBytes || 0);

    const h = e.host || "unknown";
    if (!byHost[h]) {
      byHost[h] = { count: 0, failed: 0, durationMsSum: 0, durationMsMax: 0 };
    }
    byHost[h]!.count += 1;
    if (!e.ok) byHost[h]!.failed += 1;
    byHost[h]!.durationMsSum += e.durationMs || 0;
    byHost[h]!.durationMsMax = Math.max(
      byHost[h]!.durationMsMax,
      e.durationMs || 0
    );
  }

  const slowest = [...entries]
    .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
    .slice(0, Math.min(10, detailLimit))
    .map((e) => ({
      url: e.url,
      host: e.host,
      resourceType: e.resourceType,
      status: e.status,
      durationMs: e.durationMs,
      ok: e.ok,
    }));

  const out: ResourceSummary = {
    total,
    failed,
    durationMsSum: durationSum,
    durationMsMax: durationMax,
    bytesSum,
    byType,
    byHost,
    slowest,
  };
  if (detail) {
    out.detail = entries.slice(0, detailLimit);
  }
  return out;
}

/** Flat metrics map for Hermes Result.metrics */
export function resourcesToMetrics(
  summary: ResourceSummary | undefined | null
): Record<string, number> {
  if (!summary) return {};
  const m: Record<string, number> = {
    hermes_browser_resource_total: summary.total || 0,
    hermes_browser_resource_failed: summary.failed || 0,
    hermes_browser_resource_duration_ms_sum: summary.durationMsSum || 0,
    hermes_browser_resource_duration_ms_max: summary.durationMsMax || 0,
    hermes_browser_resource_bytes_sum: summary.bytesSum || 0,
  };
  for (const [t, v] of Object.entries(summary.byType || {})) {
    const key = t.replace(/[^a-zA-Z0-9_]/g, "_");
    m[`hermes_browser_resource_type_${key}_count`] = v.count;
    m[`hermes_browser_resource_type_${key}_failed`] = v.failed;
    m[`hermes_browser_resource_type_${key}_duration_ms_max`] = v.durationMsMax;
  }
  return m;
}
