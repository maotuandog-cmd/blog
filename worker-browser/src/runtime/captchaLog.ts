export interface CaptchaTraceEntry {
  phase: "probe" | "skip" | "webhook" | "apply";
  url?: string;
  kind?: string;
  selector?: string;
  imageSelector?: string;
  text?: string;
  fillSelector?: string;
  solved?: boolean;
  reason?: string;
  note?: string;
}

export function captchaLog(
  jobId: string | undefined,
  phase: string,
  extra: Record<string, unknown> = {}
): void {
  const slim: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === "" || v === false) continue;
    if (k.toLowerCase().includes("screenshot")) continue;
    slim[k] = v;
  }
  console.log(`[captcha] job=${jobId || "-"} ${phase} ${JSON.stringify(slim)}`);
}

export function pushCaptchaTrace(
  events: CaptchaTraceEntry[] | undefined,
  entry: CaptchaTraceEntry
): void {
  events?.push(entry);
}
