import { listAudit, getQueue, getJob, healthz } from "../api";
import type { AuditEvent, QueueStats } from "../types";

export const BROWSER_PROTOCOLS = ["BROWSER", "BROWSER_AGENT"] as const;

export type HealthState = "healthy" | "degraded" | "down" | "unknown";

export interface ProbePoint {
  event: AuditEvent;
  at: number;
  ok: boolean;
  app: string;
}

export interface AppRow {
  app: string;
  protocol: string;
  asset: string;
  lastStatus: string;
  lastAt: string;
  successRate: number;
  total: number;
  failed: number;
  lastJobId: string;
}

export interface OverviewStats {
  health: HealthState;
  availability: number;
  successRate5m: number;
  successRate1h: number;
  failCount15m: number;
  failCount1h: number;
  total1h: number;
  runningHint: number;
  alertHint: number;
  queue: QueueStats | null;
  gatewayOk: boolean;
  apps: AppRow[];
  recentFails: ProbePoint[];
  trend24h: { t: number; label: string; total: number; ok: number; rate: number }[];
  points: ProbePoint[];
  /** Sampled from recent terminal jobs via getJob. */
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  durationSample: number;
}

function isBrowser(p: string): boolean {
  return BROWSER_PROTOCOLS.some((x) => x === p.toUpperCase());
}

/** Prefer completion audits (have success flag or terminal status). */
export function isTerminalAudit(ev: AuditEvent): boolean {
  const st = String(ev.status || "").toUpperCase();
  if (st === "SUCCESS" || st === "FAILED") return true;
  if (ev.success === true || ev.success === false) return true;
  return false;
}

export function auditOk(ev: AuditEvent): boolean {
  if (ev.success === true) return true;
  if (ev.success === false) return false;
  return String(ev.status).toUpperCase() === "SUCCESS";
}

export function appKey(ev: AuditEvent): string {
  return (ev.name && ev.name.trim()) || "未命名任务";
}

export async function fetchBrowserAudits(limit = 100): Promise<AuditEvent[]> {
  const [a, b] = await Promise.all([
    listAudit({ protocol: "BROWSER", limit }),
    listAudit({ protocol: "BROWSER_AGENT", limit }),
  ]);
  const merged = [...a.items, ...b.items]
    .filter((e) => isBrowser(e.protocol))
    .sort(
      (x, y) =>
        new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime()
    );
  return merged;
}

export function toPoints(events: AuditEvent[]): ProbePoint[] {
  return events
    .filter(isTerminalAudit)
    .map((event) => ({
      event,
      at: new Date(event.createdAt).getTime(),
      ok: auditOk(event),
      app: appKey(event),
    }));
}

function rate(ok: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round((ok / total) * 10000) / 100;
}

function healthFrom(avail: number, fail15: number): HealthState {
  if (avail >= 99 && fail15 === 0) return "healthy";
  if (avail >= 95) return "degraded";
  if (avail < 95) return "down";
  return "unknown";
}

export function buildApps(points: ProbePoint[]): AppRow[] {
  const map = new Map<string, ProbePoint[]>();
  for (const p of points) {
    const list = map.get(p.app) || [];
    list.push(p);
    map.set(p.app, list);
  }
  const rows: AppRow[] = [];
  for (const [app, list] of map) {
    const sorted = [...list].sort((a, b) => b.at - a.at);
    const total = sorted.length;
    const failed = sorted.filter((x) => !x.ok).length;
    const last = sorted[0]!;
    rows.push({
      app,
      protocol: last.event.protocol,
      asset: last.event.asset || "—",
      lastStatus: last.event.status,
      lastAt: last.event.createdAt,
      successRate: rate(total - failed, total),
      total,
      failed,
      lastJobId: last.event.jobId,
    });
  }
  return rows.sort((a, b) => a.successRate - b.successRate);
}

export function buildTrend(
  points: ProbePoint[],
  hours = 24,
  buckets = 24
): OverviewStats["trend24h"] {
  const now = Date.now();
  const start = now - hours * 3600 * 1000;
  const width = (hours * 3600 * 1000) / buckets;
  const out: OverviewStats["trend24h"] = [];
  for (let i = 0; i < buckets; i++) {
    const t0 = start + i * width;
    const t1 = t0 + width;
    const slice = points.filter((p) => p.at >= t0 && p.at < t1);
    const ok = slice.filter((p) => p.ok).length;
    const total = slice.length;
    const d = new Date(t0);
    out.push({
      t: t0,
      label: `${String(d.getHours()).padStart(2, "0")}:00`,
      total,
      ok,
      rate: rate(ok, total),
    });
  }
  return out;
}

/** Nearest-rank percentile; `sorted` ascending. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

/** Fetch durationMs for up to `limit` distinct recent job IDs. */
export async function sampleJobDurations(
  jobIds: string[],
  limit = 24
): Promise<number[]> {
  const ids = [...new Set(jobIds.filter(Boolean))].slice(0, limit);
  if (ids.length === 0) return [];
  const jobs = await Promise.all(ids.map((id) => getJob(id).catch(() => null)));
  return jobs
    .map((j) => j?.result?.durationMs)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);
}

/** Collapse volatile parts so similar assert/timeout errors group. */
export function normalizeFailMessage(msg: string): string {
  return msg
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>")
    .replace(/Timeout\s+\d+\s*ms/gi, "Timeout")
    .replace(/\b\d{4,}\b/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export interface FailMessageRow {
  key: string;
  count: number;
  lastAt: string;
  lastApp: string;
  lastJobId: string;
  sample: string;
}

export function topFailMessages(
  fails: ProbePoint[],
  limit = 8
): FailMessageRow[] {
  const map = new Map<string, FailMessageRow>();
  for (const p of fails) {
    const raw = (p.event.message || p.event.status || "unknown").trim();
    const key = normalizeFailMessage(raw) || "unknown";
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        key,
        count: 1,
        lastAt: p.event.createdAt,
        lastApp: p.app,
        lastJobId: p.event.jobId,
        sample: raw.slice(0, 160),
      });
    } else {
      cur.count++;
      if (p.at > new Date(cur.lastAt).getTime()) {
        cur.lastAt = p.event.createdAt;
        cur.lastApp = p.app;
        cur.lastJobId = p.event.jobId;
        cur.sample = raw.slice(0, 160);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export type AlertSeverity = "crit" | "warn";

export interface HeuristicAlert {
  id: string;
  severity: AlertSeverity;
  app: string;
  reason: string;
  jobId: string;
  streak?: number;
  rate?: number;
}

function failStreak(sortedDesc: ProbePoint[]): number {
  let streak = 0;
  for (const p of sortedDesc) {
    if (!p.ok) streak++;
    else break;
  }
  return streak;
}

/** Live heuristic alerts from terminal audits (no Alertmanager). */
export function buildHeuristicAlerts(
  points: ProbePoint[],
  now = Date.now()
): HeuristicAlert[] {
  const in1h = points.filter((p) => now - p.at <= 60 * 60 * 1000);
  const byApp = new Map<string, ProbePoint[]>();
  for (const p of in1h) {
    const list = byApp.get(p.app) || [];
    list.push(p);
    byApp.set(p.app, list);
  }
  const out: HeuristicAlert[] = [];
  for (const [app, list] of byApp) {
    const sorted = [...list].sort((a, b) => b.at - a.at);
    const last = sorted[0]!;
    const streak = failStreak(sorted);
    const total = sorted.length;
    const failed = sorted.filter((x) => !x.ok).length;
    const successRate = rate(total - failed, total);

    if (streak >= 3) {
      out.push({
        id: `streak:${app}`,
        severity: "crit",
        app,
        reason: `近 1h 连续失败 ${streak} 次`,
        jobId: last.event.jobId,
        streak,
        rate: successRate,
      });
    } else if (total >= 5 && successRate < 95) {
      out.push({
        id: `rate:${app}`,
        severity: successRate < 90 ? "crit" : "warn",
        app,
        reason: `近 1h 成功率 ${successRate.toFixed(1)}%（样本 ${total}）`,
        jobId: last.event.jobId,
        rate: successRate,
      });
    }
  }
  return out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "crit" ? -1 : 1;
    return (b.streak || 0) - (a.streak || 0);
  });
}

export interface AppLatencyRow {
  app: string;
  protocol: string;
  successRate: number;
  total: number;
  failed: number;
  lastJobId: string;
  avgMs: number | null;
  p95Ms: number | null;
  sample: number;
  /** Jobs in the latency sample that had at least one Web Vital. */
  vitalsSample: number;
  avgTtfbMs: number | null;
  p95TtfbMs: number | null;
  avgFcpMs: number | null;
  p95FcpMs: number | null;
  avgLcpMs: number | null;
  p95LcpMs: number | null;
  avgTbtMs: number | null;
}

export interface VitalsMetrics {
  ttfbMs?: number;
  fcpMs?: number;
  lcpMs?: number;
  tbtMs?: number;
}

/** Pull synthetic Web Vitals from job result.metrics (omit missing / non-finite). */
export function extractVitals(
  metrics?: Record<string, number> | null
): VitalsMetrics | null {
  if (!metrics) return null;
  const out: VitalsMetrics = {};
  const ttfb = metrics.hermes_browser_ttfb_ms;
  const fcp = metrics.hermes_browser_fcp_ms;
  const lcp = metrics.hermes_browser_lcp_ms;
  const tbt = metrics.hermes_browser_tbt_ms;
  if (typeof ttfb === "number" && Number.isFinite(ttfb) && ttfb >= 0) out.ttfbMs = ttfb;
  if (typeof fcp === "number" && Number.isFinite(fcp) && fcp >= 0) out.fcpMs = fcp;
  if (typeof lcp === "number" && Number.isFinite(lcp) && lcp >= 0) out.lcpMs = lcp;
  if (typeof tbt === "number" && Number.isFinite(tbt) && tbt >= 0) out.tbtMs = tbt;
  return Object.keys(out).length ? out : null;
}

function avgOf(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function p95Of(nums: number[]): number | null {
  if (!nums.length) return null;
  return percentile([...nums].sort((a, b) => a - b), 95);
}

/** Per-app latency via sampled getJob (cap total fetches). */
export async function loadAppLatencies(
  auditLimit = 150,
  perApp = 4,
  maxFetches = 40
): Promise<AppLatencyRow[]> {
  const points = toPoints(await fetchBrowserAudits(auditLimit));
  const apps = buildApps(points);
  const byApp = new Map<string, string[]>();
  for (const p of points) {
    const ids = byApp.get(p.app) || [];
    if (!ids.includes(p.event.jobId)) ids.push(p.event.jobId);
    byApp.set(p.app, ids);
  }

  const fetchIds: string[] = [];
  const plan = new Map<string, string[]>();
  for (const a of apps) {
    const ids = (byApp.get(a.app) || []).slice(0, perApp);
    plan.set(a.app, ids);
    for (const id of ids) {
      if (fetchIds.length >= maxFetches) break;
      if (!fetchIds.includes(id)) fetchIds.push(id);
    }
  }

  const jobs = await Promise.all(
    fetchIds.map((id) => getJob(id).then((j) => [id, j] as const).catch(() => [id, null] as const))
  );
  const dur = new Map<string, number>();
  const vitals = new Map<string, VitalsMetrics>();
  for (const [id, j] of jobs) {
    const ms = j?.result?.durationMs;
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) dur.set(id, ms);
    const v = extractVitals(j?.result?.metrics);
    if (v) vitals.set(id, v);
  }

  return apps.map((a) => {
    const ids = plan.get(a.app) || [];
    const samples = ids.map((id) => dur.get(id)).filter((n): n is number => n != null);
    const sorted = [...samples].sort((x, y) => x - y);
    const vSamples = ids.map((id) => vitals.get(id)).filter((v): v is VitalsMetrics => !!v);
    const ttfbs = vSamples.map((v) => v.ttfbMs).filter((n): n is number => n != null);
    const fcps = vSamples.map((v) => v.fcpMs).filter((n): n is number => n != null);
    const lcps = vSamples.map((v) => v.lcpMs).filter((n): n is number => n != null);
    const tbts = vSamples.map((v) => v.tbtMs).filter((n): n is number => n != null);
    return {
      app: a.app,
      protocol: a.protocol,
      successRate: a.successRate,
      total: a.total,
      failed: a.failed,
      lastJobId: a.lastJobId,
      avgMs:
        sorted.length === 0
          ? null
          : sorted.reduce((s, n) => s + n, 0) / sorted.length,
      p95Ms: sorted.length === 0 ? null : percentile(sorted, 95),
      sample: sorted.length,
      vitalsSample: vSamples.length,
      avgTtfbMs: avgOf(ttfbs),
      p95TtfbMs: p95Of(ttfbs),
      avgFcpMs: avgOf(fcps),
      p95FcpMs: p95Of(fcps),
      avgLcpMs: avgOf(lcps),
      p95LcpMs: p95Of(lcps),
      avgTbtMs: avgOf(tbts),
    };
  });
}

export async function loadOverview(): Promise<OverviewStats> {
  const [events, gatewayOk, queue] = await Promise.all([
    fetchBrowserAudits(120),
    healthz(),
    getQueue().catch(() => null),
  ]);
  const points = toPoints(events);
  const now = Date.now();
  const in5m = points.filter((p) => now - p.at <= 5 * 60 * 1000);
  const in15m = points.filter((p) => now - p.at <= 15 * 60 * 1000);
  const in1h = points.filter((p) => now - p.at <= 60 * 60 * 1000);

  const ok5 = in5m.filter((p) => p.ok).length;
  const ok1h = in1h.filter((p) => p.ok).length;
  const fail15 = in15m.filter((p) => !p.ok).length;
  const fail1h = in1h.filter((p) => !p.ok).length;
  const avail = rate(ok1h, in1h.length);
  const successRate5m = rate(ok5, in5m.length);
  const successRate1h = rate(ok1h, in1h.length);

  const alerts = buildHeuristicAlerts(points, now);
  const alertHint = alerts.length;

  const runningHint =
    typeof queue?.pending === "number"
      ? Number(queue.pending)
      : typeof queue?.streamLength === "number"
        ? Number(queue.streamLength)
        : 0;

  const durationSource = (in1h.length > 0 ? in1h : points).map(
    (p) => p.event.jobId
  );
  const durations = await sampleJobDurations(durationSource, 24);
  const sorted = [...durations].sort((a, b) => a - b);
  const avgDurationMs =
    sorted.length === 0
      ? null
      : sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p95DurationMs = sorted.length === 0 ? null : percentile(sorted, 95);

  return {
    health: points.length === 0 ? "unknown" : healthFrom(avail, fail15),
    availability: avail,
    successRate5m,
    successRate1h,
    failCount15m: fail15,
    failCount1h: fail1h,
    total1h: in1h.length,
    runningHint,
    alertHint,
    queue,
    gatewayOk,
    apps: buildApps(points),
    recentFails: points.filter((p) => !p.ok).slice(0, 12),
    trend24h: buildTrend(points, 24, 24),
    points,
    avgDurationMs,
    p95DurationMs,
    durationSample: sorted.length,
  };
}
