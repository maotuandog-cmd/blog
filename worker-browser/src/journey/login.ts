/**
 * Auto-login: detect or use selectors, fill credentials (values never logged).
 */
import type { Page } from "playwright";
import { failStep, runStep, type RunStepContext } from "../browser/steps.js";
import { detectCaptcha, maybeAutoCaptcha } from "../runtime/captchaDetect.js";
import type { BrowserCredentials, StepResult } from "../types.js";

export const USER_HINT =
  /user|account|login|email|phone|mobile|name|用户|账号|帐号|邮箱|手机/i;

export interface FieldDesc {
  selector: string;
  tag: string;
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  placeholder: string;
  visible: boolean;
}

export interface ButtonDesc {
  selector: string;
  text: string;
  type: string;
}

export function scoreUserField(f: FieldDesc): number {
  const t = (f.type || "").toLowerCase();
  if (
    t === "password" ||
    t === "hidden" ||
    t === "submit" ||
    t === "button" ||
    t === "checkbox" ||
    t === "radio" ||
    t === "file"
  ) {
    return -100;
  }
  let s = 0;
  if (t === "email") s += 4;
  if (t === "tel") s += 2;
  if (t === "text" || t === "" || t === "search") s += 1;
  const ac = (f.autocomplete || "").toLowerCase();
  if (ac === "username" || ac === "email") s += 5;
  const blob = `${f.name} ${f.id} ${f.placeholder} ${f.selector}`;
  if (USER_HINT.test(blob)) s += 6;
  return s;
}

export function isSubmitLabel(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  return /^(登录|登入|sign in|log in|login|submit)$/i.test(t) || /(登录|登入|sign in|log in)/i.test(t);
}

export function resolveLoginFieldsFromDescs(
  fields: FieldDesc[],
  buttons: ButtonDesc[],
  opts: {
    userSelector?: string;
    passSelector?: string;
    submitSelector?: string;
  } = {}
): { user: string; pass: string; submit?: string } {
  const visible = fields.filter((f) => f.visible);
  if (opts.passSelector && opts.userSelector) {
    return {
      user: opts.userSelector,
      pass: opts.passSelector,
      submit: opts.submitSelector,
    };
  }

  const passHits = opts.passSelector
    ? []
    : visible.filter((f) => (f.type || "").toLowerCase() === "password");
  if (!opts.passSelector) {
    if (passHits.length === 0) {
      throw new Error("login password field not found, provide passSelector");
    }
    if (passHits.length > 1) {
      throw new Error("ambiguous login form, provide selectors");
    }
  }
  const pass = opts.passSelector || passHits[0]!.selector;

  let user = opts.userSelector;
  if (!user) {
    const candidates = visible
      .filter((f) => (f.type || "").toLowerCase() !== "password")
      .map((f) => ({ f, score: scoreUserField(f) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) {
      throw new Error("username field not found, provide userSelector");
    }
    user = candidates[0]!.f.selector;
  }

  let submit = opts.submitSelector;
  if (!submit) {
    const typed = buttons.find((b) => (b.type || "").toLowerCase() === "submit");
    const labeled = buttons.find((b) => isSubmitLabel(b.text));
    submit = typed?.selector || labeled?.selector;
  }
  return { user, pass, submit };
}

export function credentialsReady(
  c?: BrowserCredentials
): c is BrowserCredentials & { username: string; password: string } {
  if (!c) return false;
  const user = String(c.username || "").trim();
  const pass = String(c.password || "");
  if (user && !pass) {
    throw new Error("credentials.username and credentials.password are both required");
  }
  if (!user && pass) {
    throw new Error("credentials.username and credentials.password are both required");
  }
  return Boolean(user && pass);
}

function gatherLoginSnapshot(): { fields: FieldDesc[]; buttons: ButtonDesc[] } {
  const vis = (el: Element | null): boolean => {
    if (!el || !(el instanceof HTMLElement)) return false;
    const st = window.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return (
      r.width >= 4 &&
      r.height >= 4 &&
      st.visibility !== "hidden" &&
      st.display !== "none"
    );
  };
  const uniqueSelector = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const name = el.getAttribute("name");
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type");
    if (name) {
      const sel = type
        ? `${tag}[type="${CSS.escape(type)}"][name="${CSS.escape(name)}"]`
        : `${tag}[name="${CSS.escape(name)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    const cls = [...el.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
    if (cls) {
      const sel = `${tag}${cls}`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
    return tag;
  };
  const fields: FieldDesc[] = [...document.querySelectorAll("input, textarea")].map((el) => ({
    selector: uniqueSelector(el),
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute("type") || "").toLowerCase(),
    name: el.getAttribute("name") || "",
    id: el.id || "",
    autocomplete: el.getAttribute("autocomplete") || "",
    placeholder: el.getAttribute("placeholder") || "",
    visible: vis(el),
  }));
  const buttons: ButtonDesc[] = [
    ...document.querySelectorAll("button, input[type=submit], [role=button]"),
  ]
    .filter(vis)
    .map((el) => ({
      selector: uniqueSelector(el),
      text: (el.textContent || (el as HTMLInputElement).value || "").trim(),
      type: (el.getAttribute("type") || "").toLowerCase(),
    }));
  return { fields, buttons };
}

export async function resolveLoginFields(
  page: Page,
  creds: BrowserCredentials
): Promise<{ user: string; pass: string; submit?: string }> {
  if (creds.userSelector && creds.passSelector) {
    await page.locator(creds.userSelector).first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator(creds.passSelector).first().waitFor({ state: "visible", timeout: 15000 });
    return {
      user: creds.userSelector,
      pass: creds.passSelector,
      submit: creds.submitSelector,
    };
  }
  const snap = await page.evaluate(gatherLoginSnapshot);
  return resolveLoginFieldsFromDescs(snap.fields, snap.buttons, {
    userSelector: creds.userSelector,
    passSelector: creds.passSelector,
    submitSelector: creds.submitSelector,
  });
}

export async function waitLoginSettled(
  page: Page,
  passSelector: string,
  timeoutMs = 15000
): Promise<void> {
  const startUrl = page.url();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const urlChanged = page.url() !== startUrl;
    const passVisible = await page
      .locator(passSelector)
      .first()
      .isVisible()
      .catch(() => false);
    if (urlChanged || !passVisible) return;
    await page.waitForTimeout(250);
  }
  const probe = await detectCaptcha(page).catch(() => ({
    found: false,
    applicable: false,
  }));
  const errText = (
    await page
      .locator("#err, .error, .login-error, [class*='error']")
      .first()
      .textContent()
      .catch(() => "")
  )
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (probe.found && probe.applicable) {
    throw new Error("auth failed: still on login page (captcha still present)");
  }
  if (errText && /密码|账号|用户|credential|password|account/i.test(errText)) {
    throw new Error("auth failed: still on login page (account error)");
  }
  throw new Error("auth failed: still on login page");
}

export async function runAutoLogin(
  page: Page,
  creds: BrowserCredentials,
  ctx: RunStepContext
): Promise<{ results: StepResult[]; consumedNavigateUrl?: string }> {
  const results: StepResult[] = [];
  const loginUrl = String(creds.loginUrl || "").trim();
  if (!loginUrl) {
    throw new Error("credentials.loginUrl or a navigate step required");
  }
  const capCtx: RunStepContext = {
    ...ctx,
    captchaSelector: creds.captchaSelector || ctx.captchaSelector,
  };
  results.push(
    await runStep(page, { action: "navigate", url: loginUrl }, "auth-auto-navigate", capCtx)
  );

  const fields = await resolveLoginFields(page, creds);
  results.push(
    await runStep(
      page,
      { action: "fill", selector: fields.user, value: creds.username },
      "auth-auto-fill-user",
      { ...capCtx, skipAutoCaptcha: true }
    )
  );
  await page.locator(fields.user).first().blur();
  const afterUser = await maybeAutoCaptcha(page, {
    ...capCtx,
    waitCaptchaInputMs: 5000,
  });
  if (afterUser) {
    const last = results[results.length - 1];
    if (last) last.output = last.output ? `${last.output}; ${afterUser}` : afterUser;
  }

  results.push(
    await runStep(
      page,
      { action: "fill", selector: fields.pass, value: creds.password },
      "auth-auto-fill-pass",
      { ...capCtx, skipAutoCaptcha: true }
    )
  );
  const afterPass = await maybeAutoCaptcha(page, {
    ...capCtx,
    waitCaptchaInputMs: 5000,
  });
  if (afterPass) {
    const last = results[results.length - 1];
    if (last) last.output = last.output ? `${last.output}; ${afterPass}` : afterPass;
  }

  if (fields.submit) {
    results.push(
      await runStep(
        page,
        { action: "click", selector: fields.submit },
        "auth-auto-submit",
        capCtx
      )
    );
  } else {
    const t0 = Date.now();
    try {
      await page.locator(fields.pass).first().press("Enter");
      await maybeAutoCaptcha(page, capCtx);
      results.push({
        name: "auth-auto-submit",
        success: true,
        output: "Enter on password",
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      results.push(failStep("auth-auto-submit", err, Date.now() - t0));
      throw err;
    }
  }

  await maybeResubmitAfterCaptcha(page, fields, capCtx);
  await waitLoginSettled(page, fields.pass);
  return { results, consumedNavigateUrl: loginUrl };
}

async function maybeResubmitAfterCaptcha(
  page: Page,
  fields: { user: string; pass: string; submit?: string },
  ctx: RunStepContext
): Promise<void> {
  const passVisible = await page
    .locator(fields.pass)
    .first()
    .isVisible()
    .catch(() => false);
  if (!passVisible) return;
  await maybeAutoCaptcha(page, { ...ctx, waitCaptchaInputMs: 5000 });
  const still = await page
    .locator(fields.pass)
    .first()
    .isVisible()
    .catch(() => false);
  if (!still) return;
  const probe = await detectCaptcha(page);
  if (probe.applicable) return;
  if (fields.submit) {
    await page.click(fields.submit, { timeout: 8000 });
  } else {
    await page.locator(fields.pass).first().press("Enter");
  }
}
