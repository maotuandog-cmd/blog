/** Shared domain types for hermes-worker-browser (declaration only — no runtime JS). */

export type StepAction =
  | "navigate"
  | "fill"
  | "click"
  | "wait"
  | "assertText"
  | "screenshot"
  | "drag"
  | "solveCaptcha";

export type AgentActionName =
  | "click"
  | "fill"
  | "navigate"
  | "scroll"
  | "extract"
  | "done"
  | "fail"
  | "wait";

export interface JourneyStep {
  action: StepAction | string;
  url?: string;
  selector?: string;
  value?: string;
  /** solveCaptcha: auto|image|click|slider; drag: optional JSON {"deltaX":n} */
  kind?: string;
  timeoutSec?: number;
  /** Absolute drag end X (optional alternative to delta). */
  toX?: number;
  deltaX?: number;
  deltaY?: number;
}

export interface StepResult {
  name: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

export interface ResourceOptions {
  enabled: boolean;
  detail: boolean;
  detailLimit: number;
  settleMs: number;
  waitNetworkIdle: boolean;
  collectMode: "all" | "afterAuth" | string;
}

export interface BrowserCredentials {
  username?: string;
  password?: string;
  loginUrl?: string;
  userSelector?: string;
  passSelector?: string;
  submitSelector?: string;
  captchaSelector?: string;
}

export interface ScriptPayload {
  locale?: string;
  proxyUrl?: string;
  credentials?: BrowserCredentials;
  /** Default true: probe captcha after navigate/fill/click/drag. */
  autoCaptcha?: boolean;
  authSteps?: JourneyStep[];
  steps?: JourneyStep[];
  collectResources?: boolean;
  collectWebVitals?: boolean;
  captureTrace?: "on_failure" | "always" | "never" | string;
  collectMode?: string;
  resourceDetail?: boolean;
  resourceDetailLimit?: number;
  resourceSettleMs?: number;
  waitNetworkIdle?: boolean;
}

export interface AgentPayload extends ScriptPayload {
  startUrl: string;
  goal?: string;
  purpose?: string;
  allowedHosts?: string[];
  maxSteps?: number;
  summarize?: boolean;
  antiDetect?: string;
  extractSchema?: unknown;
  deterministic?: JourneyStep[];
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AgentDecision {
  action?: AgentActionName | string;
  selector?: string;
  value?: string | unknown;
  url?: string;
  reason?: string;
}

export interface SummaryResult {
  conclusion?: string;
  findings?: string[];
  anomalies?: string[];
  evidenceRefs?: string[];
}

export interface JourneyResult {
  success: boolean;
  message: string;
  durationMs: number;
  steps: StepResult[];
  artifacts?: Record<string, string>;
  metrics?: Record<string, number>;
  extra?: Record<string, unknown>;
}

export interface ResourceEntry {
  url: string;
  host: string;
  resourceType: string;
  status: number;
  ok: boolean;
  durationMs: number;
  sizeBytes: number;
  phase?: string;
  error?: string;
}

export interface ResourceBucket {
  count: number;
  failed: number;
  durationMsSum: number;
  durationMsMax: number;
  bytesSum?: number;
}

export interface ResourceSummary {
  total: number;
  failed: number;
  durationMsSum: number;
  durationMsMax: number;
  bytesSum: number;
  byType: Record<string, ResourceBucket>;
  byHost: Record<string, ResourceBucket>;
  slowest: Array<{
    url: string;
    host: string;
    resourceType: string;
    status: number;
    durationMs: number;
    ok: boolean;
  }>;
  detail?: ResourceEntry[];
}
