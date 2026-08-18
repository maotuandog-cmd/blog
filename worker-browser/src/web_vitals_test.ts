/**
 * Unit checks for web vitals merge helpers.
 */
import { mergeMetrics, type WebVitalsMetrics } from "./runtime/webVitals.ts";

const v: WebVitalsMetrics = {
  hermes_browser_ttfb_ms: 10,
  hermes_browser_lcp_ms: 100,
};
const m = mergeMetrics({ hermes_browser_resource_total: 3 }, v);
if (!m || m.hermes_browser_resource_total !== 3 || m.hermes_browser_ttfb_ms !== 10) {
  throw new Error("merge failed " + JSON.stringify(m));
}
const empty = mergeMetrics(undefined, {});
if (empty !== undefined) throw new Error("empty should be undefined");
console.log("web_vitals_ok");
