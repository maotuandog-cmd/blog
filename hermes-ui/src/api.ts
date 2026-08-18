import type { AuditEvent, Job, QueueStats } from "./types";

const TOKEN_KEY = "hermes.apiToken";
const BASE_KEY = "hermes.apiBase";

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(v: string): void {
  localStorage.setItem(TOKEN_KEY, v);
}

/** Empty = same origin / Vite proxy. */
export function getApiBase(): string {
  return localStorage.getItem(BASE_KEY) || "";
}

export function setApiBase(v: string): void {
  localStorage.setItem(BASE_KEY, v.replace(/\/$/, ""));
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${getApiBase()}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function createJob(body: unknown, idempotencyKey?: string): Promise<Job> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return request<Job>("/v1/jobs", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export function getJob(id: string): Promise<Job> {
  return request<Job>(`/v1/jobs/${id}`);
}

export function cancelJob(id: string): Promise<Job> {
  return request<Job>(`/v1/jobs/${id}/cancel`, { method: "POST" });
}

export function rerunJob(id: string): Promise<Job> {
  return request<Job>(`/v1/jobs/${id}/rerun`, { method: "POST" });
}

export function listAudit(params: {
  protocol?: string;
  limit?: number;
}): Promise<{ items: AuditEvent[]; count: number }> {
  const q = new URLSearchParams();
  if (params.protocol) q.set("protocol", params.protocol);
  q.set("limit", String(params.limit ?? 40));
  return request(`/v1/audit?${q}`);
}

export function getQueue(): Promise<QueueStats> {
  return request("/v1/admin/queue");
}

export function getDrain(): Promise<{ drain: boolean; drainMode?: string }> {
  return request("/v1/admin/drain");
}

export function setDrain(body: {
  enabled: boolean;
  mode?: "soft" | "hard" | string;
}): Promise<{ drain: boolean; drainMode?: string }> {
  return request("/v1/admin/drain", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function reclaim(params?: {
  minIdleSec?: number;
  count?: number;
}): Promise<{ requeued: number; minIdleSec: number; count: number; note?: string }> {
  const q = new URLSearchParams();
  if (params?.minIdleSec != null) q.set("minIdleSec", String(params.minIdleSec));
  if (params?.count != null) q.set("count", String(params.count));
  const qs = q.toString();
  return request(`/v1/admin/reclaim${qs ? `?${qs}` : ""}`, { method: "POST" });
}

export async function healthz(): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBase()}/healthz`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Browser-worker health via Vite proxy `/bw` → :8090, or absolute URL. */
export async function browserWorkerHealthz(
  base = getBrowserWorkerBase()
): Promise<boolean> {
  try {
    const url = base
      ? `${base.replace(/\/$/, "")}/healthz`
      : `${getApiBase()}/bw/healthz`;
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

const BW_KEY = "hermes.browserWorkerBase";

export function getBrowserWorkerBase(): string {
  return localStorage.getItem(BW_KEY) || "";
}

export function setBrowserWorkerBase(v: string): void {
  localStorage.setItem(BW_KEY, v.replace(/\/$/, ""));
}
