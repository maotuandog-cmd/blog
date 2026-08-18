import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext } from "playwright";
import type { CaptureTraceMode } from "../config.js";
import { s3Configured } from "../config.js";
import { uploadTraceZip } from "./s3.js";

export async function startTracing(context: BrowserContext): Promise<void> {
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false,
  });
}

export function shouldKeepTrace(
  mode: CaptureTraceMode,
  success: boolean
): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  return !success;
}

/**
 * Stop tracing; if keep, upload to S3 and merge into artifacts.
 * Never embeds zip as base64.
 */
export async function finishTracing(opts: {
  context: BrowserContext;
  jobId: string;
  mode: CaptureTraceMode;
  success: boolean;
  artifacts?: Record<string, string>;
}): Promise<Record<string, string> | undefined> {
  const { context, jobId, mode, success } = opts;
  const artifacts = { ...(opts.artifacts || {}) };
  const keep = shouldKeepTrace(mode, success);

  if (!keep) {
    try {
      await context.tracing.stop();
    } catch {
      /* may not have started */
    }
    return Object.keys(artifacts).length ? artifacts : opts.artifacts;
  }

  const dir = await mkdtemp(join(tmpdir(), "hermes-trace-"));
  const zipPath = join(dir, "trace.zip");
  try {
    await context.tracing.stop({ path: zipPath });
  } catch (err) {
    artifacts.traceError =
      "tracing.stop: " + (err instanceof Error ? err.message : String(err));
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return artifacts;
  }

  if (!s3Configured()) {
    artifacts.traceError = "S3 not configured (HERMES_S3_*)";
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return artifacts;
  }

  try {
    const { traceUrl, traceObjectKey } = await uploadTraceZip(zipPath, jobId);
    artifacts.traceUrl = traceUrl;
    artifacts.traceObjectKey = traceObjectKey;
  } catch (err) {
    artifacts.traceError =
      "upload: " + (err instanceof Error ? err.message : String(err));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return artifacts;
}
