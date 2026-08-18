import {
  summarizeResources,
  resourcesToMetrics,
} from "./runtime/resources.js";
import type { ResourceEntry } from "./types.js";

const sample: ResourceEntry[] = [
  {
    url: "https://a.com/a.js",
    host: "a.com",
    resourceType: "script",
    status: 200,
    ok: true,
    durationMs: 120,
    sizeBytes: 1000,
  },
  {
    url: "https://a.com/a.css",
    host: "a.com",
    resourceType: "stylesheet",
    status: 200,
    ok: true,
    durationMs: 40,
    sizeBytes: 200,
  },
  {
    url: "https://cdn.x/b.js",
    host: "cdn.x",
    resourceType: "script",
    status: 500,
    ok: false,
    durationMs: 800,
    sizeBytes: 0,
  },
];

const s = summarizeResources(sample, { detail: false });
if (s.total !== 3 || s.failed !== 1) {
  console.error("bad summary", s);
  process.exit(1);
}
if (!s.byType.script || s.byType.script.count !== 2) {
  console.error("bad byType", s.byType);
  process.exit(1);
}
const m = resourcesToMetrics(s);
if (m.hermes_browser_resource_total !== 3) {
  console.error("bad metrics", m);
  process.exit(1);
}
console.log("resources_ok");
