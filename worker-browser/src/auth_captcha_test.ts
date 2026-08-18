/**
 * Unit checks for login field scoring / captcha classification (no Playwright).
 */
import {
  classifyCaptcha,
  type CaptchaDomSnapshot,
} from "./runtime/captchaDetect.ts";
import {
  credentialsReady,
  resolveLoginFieldsFromDescs,
  scoreUserField,
  isSubmitLabel,
  type FieldDesc,
} from "./journey/login.ts";

function field(p: Partial<FieldDesc> & { selector: string }): FieldDesc {
  return {
    tag: "input",
    type: "text",
    name: "",
    id: "",
    autocomplete: "",
    placeholder: "",
    visible: true,
    ...p,
  };
}

const user = field({ selector: "#user", id: "user", name: "username" });
const pass = field({ selector: "#pass", type: "password", id: "pass" });
const pass2 = field({ selector: "#pass2", type: "password", id: "pass2" });
const hidden = field({ selector: "#x", type: "hidden", visible: false });

if (scoreUserField(user) <= 0) throw new Error("user score");
if (scoreUserField(pass) >= 0) throw new Error("password must not score as user");

const resolved = resolveLoginFieldsFromDescs(
  [user, pass, hidden],
  [{ selector: "button.login", text: "登录", type: "submit" }]
);
if (resolved.user !== "#user" || resolved.pass !== "#pass") {
  throw new Error("resolve user/pass");
}
if (resolved.submit !== "button.login") throw new Error("submit");

let amb = false;
try {
  resolveLoginFieldsFromDescs([user, pass, pass2], []);
} catch (e) {
  amb = String(e).includes("ambiguous");
}
if (!amb) throw new Error("expected ambiguous login form");

const withSel = resolveLoginFieldsFromDescs([user, pass, pass2], [], {
  userSelector: "#user",
  passSelector: "#pass",
});
if (withSel.pass !== "#pass") throw new Error("explicit selectors");

if (!isSubmitLabel("登录")) throw new Error("submit 登录");
if (!credentialsReady({ username: "a", password: "b" })) {
  throw new Error("creds ready");
}
if (credentialsReady({})) throw new Error("empty creds");

let half = false;
try {
  credentialsReady({ username: "a" });
} catch {
  half = true;
}
if (!half) throw new Error("partial creds should throw");

const emptySnap: CaptchaDomSnapshot = {
  iframeHits: [],
  hasSliderHandle: false,
  hasCaptchaInput: false,
  hasCaptchaImage: false,
  hasClickChallenge: false,
  hasSliderText: false,
};
if (classifyCaptcha(emptySnap).found) throw new Error("empty captcha");

const img = classifyCaptcha({
  ...emptySnap,
  hasCaptchaInput: true,
  inputSelector: "#captcha",
});
if (!img.found || img.kind !== "image" || !img.applicable || img.selector !== "#captcha") {
  throw new Error("image captcha");
}

const imgNoInput = classifyCaptcha({
  ...emptySnap,
  hasCaptchaImage: true,
  containerSelector: "#captcha",
  imageSelector: "#code",
});
if (!imgNoInput.found || imgNoInput.applicable) {
  throw new Error("image without input must not be applicable");
}
if (imgNoInput.selector) throw new Error("must not fill container div");

const click = classifyCaptcha({
  ...emptySnap,
  hasClickChallenge: true,
  containerSelector: ".captcha",
});
if (!click.found || click.kind !== "click") throw new Error("click captcha");

const slider = classifyCaptcha({
  ...emptySnap,
  hasSliderHandle: true,
  handleSelector: ".geetest_slider_button",
});
if (!slider.found || slider.kind !== "slider") throw new Error("slider captcha");

const iframe = classifyCaptcha({
  ...emptySnap,
  iframeHits: ["https://www.google.com/recaptcha/api2/anchor"],
});
if (!iframe.found) throw new Error("iframe captcha");

console.log("auth_captcha_ok");
