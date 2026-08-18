#!/usr/bin/env python3
"""Hermes auth/captcha E2E fixtures: static pages + mock captcha webhook."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PAGE_PORT = int(__import__("os").environ.get("HERMES_AUTH_PAGE_PORT", "18083"))
HOOK_PORT = int(__import__("os").environ.get("HERMES_AUTH_HOOK_PORT", "18084"))

PIXEL = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00"
    b"\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)

LOCK = threading.Lock()
CALLS: list[dict] = []


def login_form(extra: str, captcha_js: str = "") -> bytes:
    html = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>login</title>
<style>
body {{ font-family: sans-serif; margin: 24px; }}
label {{ display:block; margin: 8px 0 4px; }}
input {{ padding: 6px 8px; }}
button {{ margin-top: 12px; padding: 6px 16px; }}
.captcha {{ margin: 16px 0; padding: 12px; border: 1px solid #ccc; min-height: 48px; }}
.dot {{ position:fixed; width:40px; height:40px; border-radius:50%; background:#c33; color:#fff;
  display:flex; align-items:center; justify-content:center; z-index:9; }}
#d1 {{ left:80px; top:180px; }}
#d2 {{ left:140px; top:180px; }}
#d3 {{ left:200px; top:180px; }}
.geetest_slider_button {{ width:40px; height:40px; background:#09c; position:absolute; left:0; top:0; cursor:pointer; }}
.track {{ width:220px; height:40px; background:#eee; position:relative; margin-top:8px; }}
</style></head>
<body>
<h1>登录</h1>
<form id="f">
  <label>用户名</label>
  <input id="user" name="username" autocomplete="username" />
  <label>密码</label>
  <input id="pass" name="password" type="password" autocomplete="current-password" />
  {extra}
  <div id="err"></div>
  <button type="submit">登录</button>
</form>
<script>
const CAPTCHA_OK = {captcha_js or "() => true"};
document.getElementById("f").addEventListener("submit", (e) => {{
  e.preventDefault();
  const u = document.getElementById("user").value;
  const p = document.getElementById("pass").value;
  if (u !== "alice" || p !== "secret") {{
    document.getElementById("err").textContent = "bad credentials";
    return;
  }}
  if (!CAPTCHA_OK()) {{
    document.getElementById("err").textContent = "bad captcha";
    return;
  }}
  location.href = "/app";
}});
</script>
</body></html>"""
    return html.encode("utf-8")


PAGES = {
    "/": "<!doctype html><html><head><title>hermes</title></head><body><h1 id=\"ok\">hello-hermes</h1></body></html>".encode(),
    "/app": "<!doctype html><html><head><title>app</title></head><body><h1 id=\"welcome\">logged-in</h1></body></html>".encode(),
}

IMAGE_EXTRA = """
<div id="captcha-box" class="captcha">
  <img id="captcha-img" alt="captcha" width="80" height="32" src="/pixel.png" />
  <label>验证码</label>
  <input id="captcha" name="captcha" placeholder="验证码" />
</div>
<script>
document.getElementById("captcha").addEventListener("input", (e) => {
  if (e.target.value === "AB12") {
    const box = document.getElementById("captcha-box");
    if (box) box.remove();
    window.__captchaSolved = true;
  }
});
</script>
"""

CLICK_EXTRA = """
<div id="captcha-box" class="captcha">请依次点击
  <button type="button" class="dot" id="d1" data-n="1">1</button>
  <button type="button" class="dot" id="d2" data-n="2">2</button>
  <button type="button" class="dot" id="d3" data-n="3">3</button>
</div>
<script>
window.__seq = [];
window.__captchaSolved = false;
function onDot(n) {
  window.__seq.push(n);
  if (window.__seq.join("") === "123") {
    window.__captchaSolved = true;
    const box = document.getElementById("captcha-box");
    if (box) box.remove();
  }
}
["d1","d2","d3"].forEach((id) => {
  document.getElementById(id).addEventListener("click", (e) => {
    e.preventDefault();
    onDot(Number(e.currentTarget.getAttribute("data-n")));
  });
});
</script>
"""

SLIDER_EXTRA = """
<div id="captcha-box" class="captcha geetest_panel">
  <div>向右滑动</div>
  <div class="track">
    <div class="geetest_slider_button" id="handle"></div>
  </div>
</div>
<script>
window.__captchaSolved = false;
const h = document.getElementById("handle");
let down = false, startX = 0, startL = 0;
h.addEventListener("mousedown", (e) => {
  down = true; startX = e.clientX; startL = parseFloat(h.style.left) || 0; e.preventDefault();
});
window.addEventListener("mousemove", (e) => {
  if (!down) return;
  const left = Math.max(0, Math.min(180, startL + e.clientX - startX));
  h.style.left = left + "px";
});
window.addEventListener("mouseup", () => {
  if (!down) return;
  down = false;
  if ((parseFloat(h.style.left) || 0) >= 100) {
    window.__captchaSolved = true;
    const box = document.getElementById("captcha-box");
    if (box) box.remove();
  }
});
</script>
"""

MULTI = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>multi</title></head>
<body>
<h1>登录</h1>
<input id="user" name="username" />
<input id="pass" name="password" type="password" />
<input id="pass2" name="password2" type="password" />
<button type="submit">登录</button>
</body></html>""".encode("utf-8")

VERIFICATION_EXTRA = """
<div id="captcha-box" class="captcha">
  <img id="code" alt="captcha" width="80" height="32" src="/pixel.png" />
  <label>图形验证码</label>
  <input id="verification" name="verification" placeholder="验证码" />
</div>
<script>
document.getElementById("verification").addEventListener("input", (e) => {
  if (e.target.value === "AB12") {
    const box = document.getElementById("captcha-box");
    if (box) box.remove();
    window.__captchaSolved = true;
  }
});
</script>
"""

TEXT_ONLY_EXTRA = """
<p>图形验证码</p>
"""

DELAYED_EXTRA = """
<div id="captcha-slot"></div>
<script>
document.getElementById("user").addEventListener("blur", () => {
  if (document.getElementById("verification")) return;
  document.getElementById("captcha-slot").innerHTML = `
    <div id="captcha-box" class="captcha">
      <img id="code" alt="captcha" width="80" height="32" src="/pixel.png" />
      <label>图形验证码</label>
      <input id="verification" name="verification" placeholder="验证码" />
    </div>`;
  document.getElementById("verification").addEventListener("input", (e) => {
    if (e.target.value === "AB12") {
      const box = document.getElementById("captcha-box");
      if (box) box.remove();
      window.__captchaSolved = true;
    }
  });
});
</script>
"""


class PageHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):  # noqa: ARG002
        return

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path == "/pixel.png":
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.end_headers()
            self.wfile.write(PIXEL)
            return
        if path == "/login":
            body = login_form("", "() => true")
        elif path == "/login-image":
            body = login_form(IMAGE_EXTRA, "() => !!window.__captchaSolved")
        elif path == "/login-click":
            body = login_form(CLICK_EXTRA, "() => !!window.__captchaSolved")
        elif path == "/login-slider":
            body = login_form(SLIDER_EXTRA, "() => !!window.__captchaSolved")
        elif path == "/login-multi":
            body = MULTI
        elif path == "/login-verification":
            body = login_form(VERIFICATION_EXTRA, "() => !!window.__captchaSolved")
        elif path == "/login-wrong-sel":
            body = login_form(VERIFICATION_EXTRA, "() => !!window.__captchaSolved")
        elif path == "/login-text-only":
            body = login_form(TEXT_ONLY_EXTRA, "() => true")
        elif path == "/login-delayed":
            body = login_form(DELAYED_EXTRA, "() => !!window.__captchaSolved")
        else:
            body = PAGES.get(path, PAGES["/"])
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class HookHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):  # noqa: ARG002
        return

    def _json(self, code: int, obj: dict):
        raw = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802
        if urlparse(self.path).path == "/calls":
            with LOCK:
                self._json(200, {"count": len(CALLS), "pages": [c.get("pageUrl") for c in CALLS]})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            req = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            req = {}
        with LOCK:
            CALLS.append(req)
        page = str(req.get("pageUrl") or "")
        hint = req.get("hint") if isinstance(req.get("hint"), dict) else {}
        hint_sel = str(hint.get("selector") or "").strip()
        fixture = "127.0.0.1:" in page or "localhost:" in page
        if "/login-click" in page:
            # centers of 40x40 dots at (80,180), (140,180), (200,180)
            body = {
                "solved": True,
                "kind": "click",
                "coord": "viewport",
                "points": [
                    {"x": 100, "y": 200},
                    {"x": 160, "y": 200},
                    {"x": 220, "y": 200},
                ],
            }
        elif "/login-slider" in page:
            body = {"solved": True, "kind": "slider", "offsetX": 140}
        elif "/login-wrong-sel" in page:
            body = {
                "solved": True,
                "kind": "image",
                "text": "AB12",
                "fillSelector": "#captcha",
            }
        else:
            fill = hint_sel
            if not fill and fixture and "/login-image" in page:
                fill = "#captcha"
            if fixture:
                print(
                    f"[captcha-mock] fixture image text=AB12 page={page} fillSelector={fill or hint_sel}",
                    flush=True,
                )
                body = {"solved": True, "kind": "image", "text": "AB12"}
                if fill:
                    body["fillSelector"] = fill
            else:
                print(
                    f"[captcha-mock] refuse non-fixture page={page} (will not fill fake AB12)",
                    flush=True,
                )
                body = {
                    "solved": False,
                    "reason": "local mock only serves 127.0.0.1 fixture; AB12 is not OCR. Set HERMES_CAPTCHA_WEBHOOK to a real solver.",
                }
        self._json(200, body)


def main() -> None:
    pages = ThreadingHTTPServer(("127.0.0.1", PAGE_PORT), PageHandler)
    hook = ThreadingHTTPServer(("127.0.0.1", HOOK_PORT), HookHandler)
    threading.Thread(target=pages.serve_forever, daemon=True).start()
    print(f"auth-e2e pages :{PAGE_PORT} webhook :{HOOK_PORT}", flush=True)
    try:
        hook.serve_forever()
    except KeyboardInterrupt:
        pages.shutdown()
        hook.shutdown()


if __name__ == "__main__":
    main()
