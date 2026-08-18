import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { createJob } from "../api";
import type { Protocol } from "../types";

type CaptureTraceMode = "on_failure" | "always" | "never";

function defaultRunAtLocal(): string {
  const d = new Date(Date.now() + 2 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SubmitPage() {
  const nav = useNavigate();
  const [protocol, setProtocol] = useState<Protocol>("BROWSER");
  const [name, setName] = useState("ui-probe");
  const [url, setUrl] = useState("http://127.0.0.1:18081/");
  const [assertText, setAssertText] = useState("hello-hermes");
  const [collectResources, setCollectResources] = useState(true);
  const [collectWebVitals, setCollectWebVitals] = useState(false);
  const [captureTrace, setCaptureTrace] = useState<CaptureTraceMode>("on_failure");
  const [goal, setGoal] = useState("打开页面并完成巡检");
  const [purpose, setPurpose] = useState("ui-authorized-check");
  const [allowedHosts, setAllowedHosts] = useState("127.0.0.1");
  const [summarize, setSummarize] = useState(true);
  const [timed, setTimed] = useState(false);
  const [runAtLocal, setRunAtLocal] = useState(defaultRunAtLocal);
  const [maxRetries, setMaxRetries] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginUrl, setLoginUrl] = useState("");
  const [userSelector, setUserSelector] = useState("");
  const [passSelector, setPassSelector] = useState("");
  const [submitSelector, setSubmitSelector] = useState("");
  const [captchaSelector, setCaptchaSelector] = useState("");
  const [autoCaptcha, setAutoCaptcha] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let body: Record<string, unknown>;
      if (protocol === "BROWSER") {
        const user = username.trim();
        if ((user && !password) || (!user && password)) {
          throw new Error("用户名与密码需同时填写");
        }
        const payload: Record<string, unknown> = {
          collectResources,
          collectWebVitals,
          captureTrace,
          autoCaptcha,
          resourceSettleMs: 800,
          waitNetworkIdle: true,
          steps: [
            { action: "navigate", url, timeoutSec: 30 },
            ...(assertText
              ? [{ action: "assertText", selector: "body", value: assertText }]
              : []),
          ],
        };
        if (user && password) {
          payload.credentials = {
            username: user,
            password,
            ...(loginUrl.trim() ? { loginUrl: loginUrl.trim() } : {}),
            ...(userSelector.trim() ? { userSelector: userSelector.trim() } : {}),
            ...(passSelector.trim() ? { passSelector: passSelector.trim() } : {}),
            ...(submitSelector.trim()
              ? { submitSelector: submitSelector.trim() }
              : {}),
            ...(captchaSelector.trim()
              ? { captchaSelector: captchaSelector.trim() }
              : {}),
          };
        }
        body = {
          name,
          protocol,
          timeoutSec: 120,
          maxRetries,
          labels: { app: name },
          payload,
        };
      } else {
        body = {
          name,
          protocol,
          timeoutSec: 180,
          maxRetries,
          labels: { app: name },
          payload: {
            goal,
            startUrl: url,
            purpose,
            allowedHosts: allowedHosts
              .split(/[,\s]+/)
              .map((s) => s.trim())
              .filter(Boolean),
            antiDetect: "L2",
            maxSteps: 8,
            summarize,
            collectResources,
            captureTrace,
          },
        };
      }

      if (timed) {
        const runAt = new Date(runAtLocal);
        if (Number.isNaN(runAt.getTime())) {
          throw new Error("定时时间无效");
        }
        body.type = "timed";
        body.runAt = runAt.toISOString();
      } else {
        body.type = "instant";
      }

      const job = await createJob(body, `ui-${Date.now()}`);
      setPassword("");
      nav(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>提交拨测</h1>
          <p>创建 BROWSER / BROWSER_AGENT；可选登录凭据、定时调度与 maxRetries。</p>
        </div>
      </div>

      <form className="panel stack" onSubmit={(e) => void onSubmit(e)}>
        <div className="grid-2">
          <div className="field">
            <label>协议</label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as Protocol)}
            >
              <option value="BROWSER">BROWSER</option>
              <option value="BROWSER_AGENT">BROWSER_AGENT</option>
            </select>
          </div>
          <div className="field">
            <label>任务名</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        </div>

        <div className="field">
          <label>{protocol === "BROWSER" ? "目标 URL" : "startUrl"}</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} required />
        </div>

        <div className="grid-2">
          <div className="field">
            <label>maxRetries（BROWSER 业务失败通常不重试）</label>
            <input
              type="number"
              min={0}
              max={10}
              value={maxRetries}
              onChange={(e) => setMaxRetries(Number(e.target.value) || 0)}
            />
          </div>
          <div className="field">
            <label className="row" style={{ gap: "0.4rem", marginTop: "1.6rem" }}>
              <input
                type="checkbox"
                checked={timed}
                onChange={(e) => setTimed(e.target.checked)}
              />
              定时任务（type=timed）
            </label>
          </div>
        </div>

        {timed ? (
          <div className="field">
            <label>执行时间（本地时区，将转为 UTC runAt）</label>
            <input
              type="datetime-local"
              value={runAtLocal}
              onChange={(e) => setRunAtLocal(e.target.value)}
              required
            />
          </div>
        ) : null}

        {protocol === "BROWSER" ? (
          <>
            <div className="field">
              <label>页面应包含文本（assertText，可空）</label>
              <input
                value={assertText}
                onChange={(e) => setAssertText(e.target.value)}
              />
            </div>

            <div className="auth-block">
              <h3 style={{ margin: "0 0 0.35rem" }}>登录信息（可选）</h3>
              <p className="muted" style={{ margin: "0 0 0.75rem" }}>
                拨测时自动探测并填写；密码不会出现在任务详情中。验证码按当前页定位输入框；真实站点需配置能识图的{" "}
                <code>HERMES_CAPTCHA_WEBHOOK</code>（本机 mock 仅用于本地 fixture）。
              </p>
              <div className="grid-2">
                <div className="field">
                  <label>用户名</label>
                  <input
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>密码</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label>登录 URL（可空，默认用上方目标 URL）</label>
                <input
                  value={loginUrl}
                  onChange={(e) => setLoginUrl(e.target.value)}
                  placeholder="空 = 先打开目标 URL 再填登录框"
                />
              </div>
              <label className="row" style={{ gap: "0.4rem" }}>
                <input
                  type="checkbox"
                  checked={autoCaptcha}
                  onChange={(e) => setAutoCaptcha(e.target.checked)}
                />
                运行中自动探测并处理验证码（autoCaptcha）
              </label>
              <details>
                <summary>高级：CSS 选择器（可空则自动探测）</summary>
                <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                  <div className="field">
                    <label>用户名选择器</label>
                    <input
                      value={userSelector}
                      onChange={(e) => setUserSelector(e.target.value)}
                      placeholder="#user"
                    />
                  </div>
                  <div className="field">
                    <label>密码选择器</label>
                    <input
                      value={passSelector}
                      onChange={(e) => setPassSelector(e.target.value)}
                      placeholder="#pass"
                    />
                  </div>
                </div>
                <div className="field">
                  <label>提交按钮选择器</label>
                  <input
                    value={submitSelector}
                    onChange={(e) => setSubmitSelector(e.target.value)}
                    placeholder="button[type=submit]"
                  />
                </div>
                <div className="field">
                  <label>验证码输入框选择器</label>
                  <input
                    value={captchaSelector}
                    onChange={(e) => setCaptchaSelector(e.target.value)}
                    placeholder="#verification"
                  />
                </div>
              </details>
            </div>

            <label className="row" style={{ gap: "0.4rem" }}>
              <input
                type="checkbox"
                checked={collectResources}
                onChange={(e) => setCollectResources(e.target.checked)}
              />
              采集资源耗时（collectResources）
            </label>
            <label className="row" style={{ gap: "0.4rem" }}>
              <input
                type="checkbox"
                checked={collectWebVitals}
                onChange={(e) => setCollectWebVitals(e.target.checked)}
              />
              采集 Web Vitals（TTFB/FCP/LCP/TBT）
            </label>
          </>
        ) : (
          <>
            <div className="field">
              <label>goal</label>
              <input value={goal} onChange={(e) => setGoal(e.target.value)} required />
            </div>
            <div className="field">
              <label>purpose（审计声明，必填）</label>
              <input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label>allowedHosts（逗号分隔）</label>
              <input
                value={allowedHosts}
                onChange={(e) => setAllowedHosts(e.target.value)}
                required
              />
            </div>
            <label className="row" style={{ gap: "0.4rem" }}>
              <input
                type="checkbox"
                checked={summarize}
                onChange={(e) => setSummarize(e.target.checked)}
              />
              生成总结（summarize）
            </label>
            <label className="row" style={{ gap: "0.4rem" }}>
              <input
                type="checkbox"
                checked={collectResources}
                onChange={(e) => setCollectResources(e.target.checked)}
              />
              采集资源耗时（collectResources）
            </label>
          </>
        )}

        <div className="field">
          <label>Playwright Trace（captureTrace → MinIO）</label>
          <select
            value={captureTrace}
            onChange={(e) => setCaptureTrace(e.target.value as CaptureTraceMode)}
          >
            <option value="on_failure">失败时上传（默认）</option>
            <option value="always">总是上传</option>
            <option value="never">从不上传</option>
          </select>
          <p className="muted" style={{ margin: "0.35rem 0 0" }}>
            需配置 <code>HERMES_S3_*</code>；未配置时失败会写{" "}
            <code>artifacts.traceError</code>。
          </p>
        </div>

        {error ? <div className="err">{error}</div> : null}

        <div className="row">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "提交中…" : timed ? "提交定时任务" : "立即提交"}
          </button>
        </div>
      </form>
    </div>
  );
}
