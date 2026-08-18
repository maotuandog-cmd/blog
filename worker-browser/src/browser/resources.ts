import type { Page } from "playwright";
import type { ResourceOptions, ResourceSummary } from "../types.js";
import {
  createResourceCollector,
  resourcesToMetrics,
  type ResourceCollector,
} from "../runtime/resources.js";

export function maybeCreateCollector(
  resourceOpts: ResourceOptions | undefined
): ResourceCollector | null {
  if (!resourceOpts?.enabled) return null;
  return createResourceCollector({
    detail: resourceOpts.detail,
    detailLimit: resourceOpts.detailLimit,
  });
}

/** Finalize collector → { resources, metrics }. */
export async function finalizeCollector(
  page: Page,
  collector: ResourceCollector | null,
  resourceOpts: ResourceOptions
): Promise<{
  resources: ResourceSummary | undefined;
  metrics: Record<string, number> | undefined;
}> {
  if (!collector) return { resources: undefined, metrics: undefined };
  if (resourceOpts.waitNetworkIdle) {
    await page
      .waitForLoadState("networkidle", { timeout: 15000 })
      .catch(() => {});
  }
  await collector.settle(resourceOpts.settleMs);
  const resources = collector.snapshot();
  collector.detach(page);
  return { resources, metrics: resourcesToMetrics(resources) };
}
