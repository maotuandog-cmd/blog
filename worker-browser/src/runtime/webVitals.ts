import type { Page } from "playwright";

export interface WebVitalsMetrics {
  hermes_browser_ttfb_ms?: number;
  hermes_browser_fcp_ms?: number;
  hermes_browser_lcp_ms?: number;
  hermes_browser_tbt_ms?: number;
  hermes_browser_dom_nodes?: number;
  hermes_browser_js_heap_used_bytes?: number;
}

export interface WebVitalsExtra {
  collectedAt: string;
  lcpTimedOut?: boolean;
  notes?: string[];
}

/**
 * Collect synthetic Web Vitals via page.evaluate.
 * Omit keys that cannot be observed (do not invent zeros).
 */
export async function collectWebVitals(
  page: Page,
  { settleMs = 800, lcpWaitMs = 3000 }: { settleMs?: number; lcpWaitMs?: number } = {}
): Promise<{ metrics: WebVitalsMetrics; extra: WebVitalsExtra }> {
  if (settleMs > 0) {
    await new Promise((r) => setTimeout(r, settleMs));
  }

  const raw = await page.evaluate(async (waitMs: number) => {
    const notes: string[] = [];
    const out: Record<string, number | boolean | string | string[] | null> = {
      notes,
    };

    try {
      const nav = performance.getEntriesByType(
        "navigation"
      )[0] as PerformanceNavigationTiming | undefined;
      if (nav && Number.isFinite(nav.responseStart) && Number.isFinite(nav.requestStart)) {
        const ttfb = nav.responseStart - nav.requestStart;
        if (ttfb >= 0) out.ttfb = Math.round(ttfb);
      } else {
        notes.push("no navigation timing");
      }
    } catch (e) {
      notes.push("nav: " + String(e));
    }

    try {
      const paints = performance.getEntriesByType("paint");
      const fcp = paints.find((p) => p.name === "first-contentful-paint");
      if (fcp) out.fcp = Math.round(fcp.startTime);
    } catch (e) {
      notes.push("fcp: " + String(e));
    }

    try {
      out.lcp = await new Promise<number | null>((resolve) => {
        let last: number | null = null;
        let done = false;
        const finish = (v: number | null, timedOut: boolean) => {
          if (done) return;
          done = true;
          out.lcpTimedOut = timedOut;
          resolve(v);
        };
        try {
          const obs = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const e = entries[entries.length - 1];
            if (e) last = e.startTime;
          });
          obs.observe({ type: "largest-contentful-paint", buffered: true } as PerformanceObserverInit);
          setTimeout(() => {
            try {
              obs.disconnect();
            } catch {
              /* ignore */
            }
            finish(last != null ? Math.round(last) : null, last == null);
          }, waitMs);
        } catch {
          finish(null, true);
        }
      });
    } catch (e) {
      notes.push("lcp: " + String(e));
    }

    try {
      const longs = performance.getEntriesByType("longtask") as PerformanceEntry[];
      let tbt = 0;
      for (const t of longs) {
        const blocked = Math.max(0, t.duration - 50);
        tbt += blocked;
      }
      out.tbt = Math.round(tbt);
    } catch (e) {
      notes.push("tbt: " + String(e));
    }

    try {
      out.domNodes = document.querySelectorAll("*").length;
    } catch (e) {
      notes.push("dom: " + String(e));
    }

    try {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } })
        .memory;
      if (mem && typeof mem.usedJSHeapSize === "number") {
        out.jsHeap = mem.usedJSHeapSize;
      }
    } catch {
      /* chrome-only */
    }

    return out;
  }, lcpWaitMs);

  const metrics: WebVitalsMetrics = {};
  if (typeof raw.ttfb === "number") metrics.hermes_browser_ttfb_ms = raw.ttfb;
  if (typeof raw.fcp === "number") metrics.hermes_browser_fcp_ms = raw.fcp;
  if (typeof raw.lcp === "number") metrics.hermes_browser_lcp_ms = raw.lcp;
  if (typeof raw.tbt === "number") metrics.hermes_browser_tbt_ms = raw.tbt;
  if (typeof raw.domNodes === "number")
    metrics.hermes_browser_dom_nodes = raw.domNodes;
  if (typeof raw.jsHeap === "number")
    metrics.hermes_browser_js_heap_used_bytes = raw.jsHeap;

  const extra: WebVitalsExtra = {
    collectedAt: new Date().toISOString(),
    lcpTimedOut: raw.lcpTimedOut === true,
    notes: Array.isArray(raw.notes) ? (raw.notes as string[]) : [],
  };
  return { metrics, extra };
}

/** Merge vitals into existing metrics map (omit undefined). */
export function mergeMetrics(
  base: Record<string, number> | undefined,
  vitals: WebVitalsMetrics
): Record<string, number> | undefined {
  const out: Record<string, number> = { ...(base || {}) };
  for (const [k, v] of Object.entries(vitals)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
