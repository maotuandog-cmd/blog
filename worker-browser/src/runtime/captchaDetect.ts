/**
 * Runtime captcha DOM probe (F-BRW-06 auto-detect).
 * Classification is pure; Playwright only gathers a snapshot.
 */
import type { Page } from "playwright";
import {
  captchaConfigured,
  solveAndApplyCaptcha,
} from "./captcha.js";
import {
  captchaLog,
  pushCaptchaTrace,
  type CaptchaTraceEntry,
} from "./captchaLog.js";

export type { CaptchaTraceEntry } from "./captchaLog.js";
export { captchaLog, pushCaptchaTrace } from "./captchaLog.js";

export type CaptchaKindGuess = "image" | "click" | "slider" | "auto";

export interface CaptchaDomSnapshot {
  iframeHits: string[];
  hasSliderHandle: boolean;
  hasCaptchaInput: boolean;
  hasCaptchaImage: boolean;
  hasClickChallenge: boolean;
  hasSliderText: boolean;
  containerSelector?: string;
  handleSelector?: string;
  inputSelector?: string;
  imageSelector?: string;
}

export interface CaptchaProbe {
  found: boolean;
  /** Ready to fill / click / drag. Image without a fillable input is not applicable. */
  applicable: boolean;
  kind: CaptchaKindGuess;
  selector?: string;
  imageSelector?: string;
  containerSelector?: string;
}

export interface CaptchaBudget {
  used: number;
  max: number;
}

export function classifyCaptcha(snap: CaptchaDomSnapshot): CaptchaProbe {
  if (snap.hasSliderHandle) {
    return {
      found: true,
      applicable: Boolean(snap.handleSelector),
      kind: "slider",
      selector: snap.handleSelector || snap.containerSelector,
      containerSelector: snap.containerSelector,
      imageSelector: snap.imageSelector,
    };
  }
  if (snap.hasSliderText && snap.containerSelector && !snap.hasCaptchaInput) {
    return {
      found: true,
      applicable: false,
      kind: "slider",
      containerSelector: snap.containerSelector,
    };
  }
  if (snap.hasClickChallenge) {
    return {
      found: true,
      applicable: true,
      kind: "click",
      selector: snap.containerSelector,
      containerSelector: snap.containerSelector,
      imageSelector: snap.imageSelector,
    };
  }
  if (snap.hasCaptchaInput && snap.inputSelector) {
    return {
      found: true,
      applicable: true,
      kind: "image",
      selector: snap.inputSelector,
      imageSelector: snap.imageSelector,
      containerSelector: snap.containerSelector,
    };
  }
  if (snap.hasCaptchaImage) {
    return {
      found: true,
      applicable: false,
      kind: "image",
      imageSelector: snap.imageSelector,
      containerSelector: snap.containerSelector,
    };
  }
  if (snap.iframeHits.length) {
    return {
      found: true,
      applicable: true,
      kind: "auto",
      selector: snap.containerSelector,
      containerSelector: snap.containerSelector,
    };
  }
  return { found: false, applicable: false, kind: "auto" };
}

export async function detectCaptcha(page: Page): Promise<CaptchaProbe> {
  const snap = await page.evaluate(gatherCaptchaSnapshot);
  return classifyCaptcha(snap);
}

/** Browser-side snapshot (serialized). */
export function gatherCaptchaSnapshot(): CaptchaDomSnapshot {
  const vis = (el: Element | null): el is Element => {
    if (!el || !(el instanceof HTMLElement)) return false;
    const st = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return (
      r.width >= 20 &&
      r.height >= 16 &&
      st.visibility !== "hidden" &&
      st.display !== "none" &&
      Number(st.opacity) !== 0
    );
  };
  const uniqueSelector = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const name = el.getAttribute("name");
    const tag = el.tagName.toLowerCase();
    if (name) {
      const sel = `${tag}[name="${CSS.escape(name)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    const cls = [...el.classList]
      .slice(0, 2)
      .map((c) => `.${CSS.escape(c)}`)
      .join("");
    if (cls) {
      const sel = `${tag}${cls}`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    return tag;
  };
  const blob = (el: Element) =>
    `${el.id} ${el.className} ${el.getAttribute("src") || ""} ${el.getAttribute("title") || ""} ${el.getAttribute("alt") || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
  const captchaRe =
    /captcha|geetest|recaptcha|hcaptcha|nc_wrapper|verify-wrap|tcaptcha|aliyun|netease|yidun|verification|verifycode|vcode/;
  const inputHintRe = /captcha|verification|verifycode|vcode|checkcode|校验码|验证码|图形码/;
  const userishRe = /user|account|login|email|phone|mobile|username|用户|账号|帐号|邮箱/;

  const iframeHits = [...document.querySelectorAll("iframe")]
    .filter((f) => vis(f) && captchaRe.test(blob(f) + (f as HTMLIFrameElement).src))
    .map((f) => (f as HTMLIFrameElement).src || f.id || "iframe");

  const containers = [
    ...document.querySelectorAll(
      '[id*="captcha" i], [class*="captcha" i], [class*="geetest" i], [class*="nc_wrapper"], [id*="nc_"]'
    ),
  ].filter(vis);

  const bodyText = (document.body?.innerText || "").slice(0, 4000);
  const hasSliderText = /向右滑动|滑动验证|拖动滑块|slide to/.test(bodyText);
  const hasClickChallenge =
    /请依次点击|点选文字|click in order|请点击图中/.test(bodyText) &&
    containers.length > 0;

  const handleEl = [
    ...document.querySelectorAll(
      ".geetest_slider_button, .geetest_btn, [class*='slider-btn'], [class*='slide-btn'], [class*='handler']"
    ),
  ].find((el) =>
    vis(el) &&
    captchaRe.test(blob(el) + (el.parentElement ? blob(el.parentElement) : ""))
  );

  const isFillableInput = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea") return false;
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (
      t === "password" ||
      t === "hidden" ||
      t === "submit" ||
      t === "button" ||
      t === "checkbox" ||
      t === "radio" ||
      t === "file"
    ) {
      return false;
    }
    const b = `${el.id} ${el.getAttribute("name") || ""} ${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("autocomplete") || ""}`;
    if (userishRe.test(b) && !inputHintRe.test(b)) return false;
    return vis(el);
  };

  const hintedInput = [
    ...document.querySelectorAll("input, textarea"),
  ].find((el) => {
    if (!isFillableInput(el)) return false;
    const b = `${el.id} ${el.getAttribute("name") || ""} ${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""}`;
    return inputHintRe.test(b);
  });

  const imgEl = [...document.querySelectorAll("img, canvas")].find((el) => {
    if (!vis(el)) return false;
    const nearCaptcha =
      captchaRe.test(blob(el)) ||
      el.id === "code" ||
      /captcha|verify|vcode|校验/.test(el.id) ||
      Boolean(
        el.closest(
          '[id*="captcha" i], [class*="captcha" i], [class*="geetest" i]'
        )
      );
    return nearCaptcha;
  });

  let nearInput: Element | undefined;
  if (!hintedInput && imgEl) {
    const root = imgEl.parentElement || imgEl;
    nearInput = [...root.querySelectorAll("input, textarea")].find(isFillableInput);
    if (!nearInput && root.parentElement) {
      nearInput = [...root.parentElement.querySelectorAll("input, textarea")].find(
        isFillableInput
      );
    }
  }

  const inputEl = hintedInput || nearInput;
  const container =
    containers[0] ||
    handleEl?.parentElement ||
    inputEl?.closest("div") ||
    imgEl?.closest("div") ||
    undefined;

  return {
    iframeHits,
    hasSliderHandle: Boolean(handleEl),
    hasCaptchaInput: Boolean(inputEl),
    hasCaptchaImage: Boolean(imgEl),
    hasClickChallenge,
    hasSliderText,
    containerSelector: container ? uniqueSelector(container) : undefined,
    handleSelector: handleEl ? uniqueSelector(handleEl) : undefined,
    inputSelector: inputEl ? uniqueSelector(inputEl) : undefined,
    imageSelector: imgEl ? uniqueSelector(imgEl) : undefined,
  };
}

export async function maybeAutoCaptcha(
  page: Page,
  ctx: {
    jobId?: string;
    autoCaptcha?: boolean;
    captchaBudget?: CaptchaBudget;
    captchaSelector?: string;
    waitCaptchaInputMs?: number;
    captchaEvents?: CaptchaTraceEntry[];
  }
): Promise<string | undefined> {
  if (ctx.autoCaptcha === false) return;
  await page.waitForTimeout(400);
  let probe = await detectCaptcha(page);
  probe = await overlayUserSelector(page, probe, ctx.captchaSelector);

  if (probe.found && !probe.applicable && probe.kind === "image") {
    captchaLog(ctx.jobId, "wait-input", {
      url: page.url(),
      kind: probe.kind,
      imageSelector: probe.imageSelector,
    });
    const deadline = Date.now() + Math.max(0, ctx.waitCaptchaInputMs ?? 5000);
    while (Date.now() < deadline) {
      await page.waitForTimeout(400);
      probe = await overlayUserSelector(
        page,
        await detectCaptcha(page),
        ctx.captchaSelector
      );
      if (probe.applicable || !probe.found) break;
    }
  }

  captchaLog(ctx.jobId, "probe", {
    url: page.url(),
    found: probe.found,
    applicable: probe.applicable,
    kind: probe.kind,
    selector: probe.selector,
    imageSelector: probe.imageSelector,
  });
  if (probe.found) {
    pushCaptchaTrace(ctx.captchaEvents, {
      phase: "probe",
      url: page.url(),
      kind: probe.kind,
      selector: probe.selector,
      imageSelector: probe.imageSelector,
      note: probe.applicable ? "ready" : "found but not fillable yet",
    });
  }

  if (!probe.found || !probe.applicable) {
    if (probe.found && !probe.applicable) {
      captchaLog(ctx.jobId, "skip", {
        reason: "no fillable captcha control",
        kind: probe.kind,
      });
      pushCaptchaTrace(ctx.captchaEvents, {
        phase: "skip",
        url: page.url(),
        kind: probe.kind,
        reason: "no fillable captcha control",
      });
    }
    return;
  }
  if (!captchaConfigured()) {
    throw new Error(
      "captcha detected but solver not configured (HERMES_CAPTCHA_WEBHOOK)"
    );
  }
  const budget = ctx.captchaBudget;
  let last = "";
  for (let i = 0; i < 2; i++) {
    if (budget && budget.used >= budget.max) {
      throw new Error("captcha solve limit exceeded");
    }
    last = await solveAndApplyCaptcha(page, {
      jobId: ctx.jobId,
      kind: probe.kind,
      selector: probe.selector,
      probeSelector: probe.selector,
      userSelector: ctx.captchaSelector,
      imageSelector: probe.imageSelector,
      containerSelector: probe.containerSelector,
      events: ctx.captchaEvents,
    });
    if (budget) budget.used += 1;
    await page.waitForTimeout(400);
    probe = await overlayUserSelector(
      page,
      await detectCaptcha(page),
      ctx.captchaSelector
    );
    if (!probe.found || !probe.applicable) return last;
  }
  throw new Error("captcha still present after retry");
}

async function overlayUserSelector(
  page: Page,
  probe: CaptchaProbe,
  userSelector?: string
): Promise<CaptchaProbe> {
  const sel = String(userSelector || "").trim();
  if (!sel) return probe;
  const loc = page.locator(sel).first();
  const n = await loc.count().catch(() => 0);
  if (!n) return probe;
  const visible = await loc.isVisible().catch(() => false);
  if (!visible) return probe;
  const fillable = await loc
    .evaluate((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") return true;
      return Boolean((el as HTMLElement).isContentEditable);
    })
    .catch(() => false);
  if (!fillable) return probe;
  return {
    ...probe,
    found: true,
    applicable: true,
    kind: probe.kind === "auto" ? "image" : probe.kind,
    selector: sel,
  };
}
