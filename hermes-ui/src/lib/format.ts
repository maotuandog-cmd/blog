import type { HealthState } from "./aggregate";
import type { JobStatus } from "../types";

export function statusClass(status: JobStatus): string {
  const s = String(status).toUpperCase();
  if (s === "SUCCESS") return "badge ok";
  if (s === "FAILED" || s === "CANCELLED") return "badge bad";
  if (s === "RUNNING" || s === "CLAIMED" || s === "PENDING") return "badge run";
  if (s === "RETRY_WAIT") return "badge warn";
  return "badge";
}

export function healthClass(h: HealthState): string {
  if (h === "healthy") return "badge ok";
  if (h === "degraded") return "badge warn";
  if (h === "down") return "badge bad";
  return "badge";
}

export function healthLabel(h: HealthState): string {
  if (h === "healthy") return "正常";
  if (h === "degraded") return "部分异常";
  if (h === "down") return "异常";
  return "未知";
}

export function fmtTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) + "…" : id;
}

export function pct(n: number): string {
  return `${n.toFixed(n >= 99.95 ? 2 : 1)}%`;
}

/** Humanize duration in ms (avg/P95 KPI). */
export function fmtDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}
