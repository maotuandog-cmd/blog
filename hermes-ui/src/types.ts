export type Protocol = "BROWSER" | "BROWSER_AGENT";

export type JobStatus =
  | "PENDING"
  | "CLAIMED"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "RETRY_WAIT"
  | "CANCELLED"
  | string;

export interface StepResult {
  name: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

export interface JobResult {
  success: boolean;
  message?: string;
  durationMs: number;
  steps?: StepResult[];
  metrics?: Record<string, number>;
  artifacts?: Record<string, string>;
  extra?: Record<string, unknown>;
  retryable?: boolean;
}

export interface Job {
  id: string;
  name: string;
  protocol: string;
  type: string;
  status: JobStatus;
  payload?: {
    credentials?: {
      username?: string;
      password?: string;
      loginUrl?: string;
      captchaSelector?: string;
    };
    autoCaptcha?: boolean;
    [key: string]: unknown;
  };
  timeoutSec?: number;
  retries?: number;
  maxRetries?: number;
  traceId?: string;
  createdAt: string;
  updatedAt: string;
  result?: JobResult;
}

export interface AuditEvent {
  id: string;
  jobId: string;
  traceId?: string;
  actor: string;
  protocol: string;
  name?: string;
  asset?: string;
  purpose?: string;
  status: string;
  success?: boolean;
  message?: string;
  createdAt: string;
}

export interface QueueStats {
  streamLength?: number;
  pending?: number;
  drain?: boolean;
  drainMode?: string;
  [key: string]: unknown;
}

export interface ResourceBucket {
  count: number;
  failed: number;
  durationMsSum?: number;
  durationMsMax?: number;
  bytesSum?: number;
}

export interface ResourceSummary {
  total?: number;
  failed?: number;
  durationMsSum?: number;
  durationMsMax?: number;
  bytesSum?: number;
  byType?: Record<string, ResourceBucket>;
  byHost?: Record<string, ResourceBucket>;
  slowest?: Array<{
    url: string;
    host: string;
    resourceType: string;
    status?: number;
    durationMs: number;
    ok: boolean;
  }>;
  detail?: Array<{
    url: string;
    host: string;
    resourceType: string;
    status: number;
    ok: boolean;
    durationMs: number;
    sizeBytes?: number;
  }>;
}
