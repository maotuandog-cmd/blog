/**
 * Progressive frame fingerprint (REQ_CAPTCHA_TRACE_BINDING §4.1).
 * L0 img src → L1 canvas DataURL → L2 computed bg → L3 10×10 micro-hash.
 */
import { createHash } from "node:crypto";
import type { Locator, Page } from "playwright";

export type FrameChannelId =
  | "img_src"
  | "canvas_dataurl"
  | "computed_bg"
  | "micro_clip_hash";

export interface FrameChannel {
  id: FrameChannelId;
  ok: boolean;
  value?: string;
  error?: string;
}

export interface FrameFingerprint {
  channels: FrameChannel[];
  capturedAt: number;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function resolveTarget(
  page: Page,
  imageSelector?: string,
  containerSelector?: string
): Promise<Locator | null> {
  for (const sel of [imageSelector, containerSelector]) {
    if (!sel) continue;
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) > 0) return loc;
  }
  return null;
}

async function collectImgSrc(loc: Locator): Promise<FrameChannel> {
  try {
    const value = await loc.evaluate((el) => {
      if (el instanceof HTMLImageElement) {
        return el.currentSrc || el.src || "";
      }
      const img = el.querySelector?.("img");
      if (img instanceof HTMLImageElement) {
        return img.currentSrc || img.src || "";
      }
      return "";
    });
    if (!value) return { id: "img_src", ok: false, error: "empty" };
    const box = await loc.boundingBox().catch(() => null);
    const meta = box
      ? `${value}|${Math.round(box.width)}x${Math.round(box.height)}`
      : value;
    return { id: "img_src", ok: true, value: meta };
  } catch (e) {
    return { id: "img_src", ok: false, error: String(e).slice(0, 120) };
  }
}

async function collectCanvas(loc: Locator): Promise<FrameChannel> {
  try {
    const value = await loc.evaluate((el) => {
      const canvas =
        el instanceof HTMLCanvasElement
          ? el
          : el.querySelector?.("canvas");
      if (!(canvas instanceof HTMLCanvasElement)) return "";
      try {
        return canvas.toDataURL();
      } catch {
        return "__TAINTED__";
      }
    });
    if (!value) return { id: "canvas_dataurl", ok: false, error: "empty" };
    if (value === "__TAINTED__") {
      return { id: "canvas_dataurl", ok: false, error: "tainted" };
    }
    // Don't store full DataURL in logs elsewhere; value kept in-memory only.
    return { id: "canvas_dataurl", ok: true, value };
  } catch (e) {
    return { id: "canvas_dataurl", ok: false, error: String(e).slice(0, 120) };
  }
}

async function collectBg(loc: Locator): Promise<FrameChannel> {
  try {
    const value = await loc.evaluate((el) => {
      const bg = window.getComputedStyle(el).backgroundImage || "";
      if (!bg || bg === "none") {
        const child = el.querySelector?.("*");
        if (child) {
          const cbg = window.getComputedStyle(child).backgroundImage || "";
          return cbg === "none" ? "" : cbg;
        }
        return "";
      }
      return bg;
    });
    if (!value) return { id: "computed_bg", ok: false, error: "none" };
    return { id: "computed_bg", ok: true, value };
  } catch (e) {
    return { id: "computed_bg", ok: false, error: String(e).slice(0, 120) };
  }
}

async function collectMicroClip(
  page: Page,
  loc: Locator
): Promise<FrameChannel> {
  try {
    const box = await loc.boundingBox();
    if (!box || box.width < 4 || box.height < 4) {
      return { id: "micro_clip_hash", ok: false, error: "no_box" };
    }
    const clip = {
      x: Math.max(0, box.x + box.width / 2 - 5),
      y: Math.max(0, box.y + box.height / 2 - 5),
      width: Math.min(10, box.width),
      height: Math.min(10, box.height),
    };
    const buf = await page.screenshot({ clip });
    return { id: "micro_clip_hash", ok: true, value: sha256Hex(buf) };
  } catch (e) {
    return { id: "micro_clip_hash", ok: false, error: String(e).slice(0, 120) };
  }
}

/**
 * Capture progressive fingerprint for the captcha visual target.
 */
export async function captureFrameFingerprint(
  page: Page,
  opts: { imageSelector?: string; containerSelector?: string }
): Promise<FrameFingerprint> {
  const loc = await resolveTarget(page, opts.imageSelector, opts.containerSelector);
  if (!loc) {
    return {
      channels: [{ id: "micro_clip_hash", ok: false, error: "no_target" }],
      capturedAt: Date.now(),
    };
  }
  const channels: FrameChannel[] = [];
  channels.push(await collectImgSrc(loc));
  channels.push(await collectCanvas(loc));
  channels.push(await collectBg(loc));

  const cheapOk = channels.some((c) => c.ok);
  if (!cheapOk) {
    channels.push(await collectMicroClip(page, loc));
  } else {
    // Still record L3 when L0–L2 exist? REQ: L3 only when L0–L2 fail.
    // Keep optional micro only as fallback — already handled.
  }

  // If still no ok channel, force L3 once more (may already be present).
  if (!channels.some((c) => c.ok) && !channels.some((c) => c.id === "micro_clip_hash")) {
    channels.push(await collectMicroClip(page, loc));
  }

  return { channels, capturedAt: Date.now() };
}

export type FrameCompareResult =
  | { ok: true }
  | { ok: false; reason: "captcha_frame_stale" | "frame_fingerprint_unavailable"; detail: string };

/**
 * Compare before/after using channels that succeeded on the before snapshot.
 */
export function compareFrameFingerprints(
  before: FrameFingerprint,
  after: FrameFingerprint
): FrameCompareResult {
  const beforeOk = before.channels.filter((c) => c.ok && c.value);
  if (!beforeOk.length) {
    return {
      ok: false,
      reason: "frame_fingerprint_unavailable",
      detail: "no successful fingerprint channel",
    };
  }
  const afterById = new Map(after.channels.map((c) => [c.id, c]));
  for (const ch of beforeOk) {
    const a = afterById.get(ch.id);
    if (!a || !a.ok || a.value !== ch.value) {
      return {
        ok: false,
        reason: "captcha_frame_stale",
        detail: `channel ${ch.id} changed`,
      };
    }
  }
  return { ok: true };
}

/** Re-capture only the channel ids that were ok in `before`. */
export async function recaptureMatchingChannels(
  page: Page,
  before: FrameFingerprint,
  opts: { imageSelector?: string; containerSelector?: string }
): Promise<FrameFingerprint> {
  const loc = await resolveTarget(page, opts.imageSelector, opts.containerSelector);
  if (!loc) {
    return {
      channels: before.channels.map((c) => ({
        id: c.id,
        ok: false,
        error: "detached",
      })),
      capturedAt: Date.now(),
    };
  }
  const want = new Set(before.channels.filter((c) => c.ok).map((c) => c.id));
  // If before had no ok, force full capture.
  if (!want.size) return captureFrameFingerprint(page, opts);

  const channels: FrameChannel[] = [];
  if (want.has("img_src")) channels.push(await collectImgSrc(loc));
  if (want.has("canvas_dataurl")) channels.push(await collectCanvas(loc));
  if (want.has("computed_bg")) channels.push(await collectBg(loc));
  if (want.has("micro_clip_hash")) channels.push(await collectMicroClip(page, loc));
  return { channels, capturedAt: Date.now() };
}
