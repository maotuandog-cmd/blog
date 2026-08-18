import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { cancelJob, getJob, rerunJob } from "../api";
import { ResourceCharts } from "../components/ResourceCharts";
import { fmtTime, statusClass } from "../lib/format";
import type { Job, ResourceSummary } from "../types";

const ACTIVE = new Set(["PENDING", "CLAIMED", "RUNNING", "RETRY_WAIT"]);
const TERMINAL = new Set(["SUCCESS", "FAILED", "CANCELLED"]);

export function JobDetailPage() {
  const { id = "" } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [actionMsg, setActionMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);

  const [showRaw, setShowRaw] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      setJob(await getJob(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  useEffect(() => {
    if (!job) return;
    const s = String(job.status).toUpperCase();
    if (!ACTIVE.has(s)) return;
    const t = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(t);
  }, [id, job?.status]);

  async function onCancel() {
    if (!id || !window.confirm("确认取消该任务？")) return;
    setActing(true);
    setActionMsg("");
    setError("");
    try {
      setJob(await cancelJob(id));
      setActionMsg("已取消");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }

  async function onRerun() {
    if (!id || !window.confirm("确认重跑该终态任务？")) return;
    setActing(true);
    setActionMsg("");
    setError("");
    try {
      setJob(await rerunJob(id));
      setActionMsg("已重跑入队");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActing(false);
    }
  }

  const result = job?.result;
  const status = String(job?.status || "").toUpperCase();
  const canCancel = ACTIVE.has(status);
  const canRerun = TERMINAL.has(status);
  const extra = (result?.extra || {}) as Record<string, unknown>;
  const resources = extra.resources as ResourceSummary | undefined;
  const summary = extra.summary as
    | { conclusion?: string; findings?: string[]; anomalies?: string[] }
    | undefined;
  const shot = result?.artifacts?.screenshotPngBase64;
  const pageText = result?.artifacts?.pageText;
  const traceUrl = result?.artifacts?.traceUrl;
  const traceError = result?.artifacts?.traceError;
  const traceKey = result?.artifacts?.traceObjectKey;
  const steps = result?.steps || [];
  const captchaEvents = (
    Array.isArray(extra.captcha) ? extra.captcha : []
  ) as Array<{
    phase?: string;
    url?: string;
    kind?: string;
    selector?: string;
    imageSelector?: string;
    text?: string;
    fillSelector?: string;
    solved?: boolean;
    reason?: string;
    note?: string;
  }>;
  const captchaFilled = [...captchaEvents]
    .reverse()
    .find((e) => e.phase === "apply" && e.text);
  const maxStepMs = Math.max(1, ...steps.map((s) => s.durationMs || 0));
  const metrics = result?.metrics || {};
  const vitalsRows = [
    ["TTFB", metrics.hermes_browser_ttfb_ms],
    ["FCP", metrics.hermes_browser_fcp_ms],
    ["LCP", metrics.hermes_browser_lcp_ms],
    ["TBT", metrics.hermes_browser_tbt_ms],
    ["DOM nodes", metrics.hermes_browser_dom_nodes],
    ["JS heap", metrics.hermes_browser_js_heap_used_bytes],
  ].filter(([, v]) => typeof v === "number") as [string, number][];

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>任务详情</h1>
          <p className="mono">{id}</p>
        </div>
        <div className="row">
          <Link className="btn ghost" to="/tasks">
            拨测任务
          </Link>
          <button
            className="btn ghost"
            type="button"
            onClick={() => void load()}
            disabled={loading || acting}
          >
            刷新
          </button>
          {canCancel ? (
            <button
              className="btn ghost"
              type="button"
              onClick={() => void onCancel()}
              disabled={acting}
            >
              取消
            </button>
          ) : null}
          {canRerun ? (
            <button
              className="btn"
              type="button"
              onClick={() => void onRerun()}
              disabled={acting}
            >
              重跑
            </button>
          ) : null}
          <button
            className="btn ghost"
            type="button"
            onClick={() => setShowRaw((v) => !v)}
          >
            {showRaw ? "隐藏 JSON" : "原始 JSON"}
          </button>
        </div>
      </div>

      {error ? <div className="panel err">{error}</div> : null}
      {actionMsg ? <div className="panel">{actionMsg}</div> : null}

      {job ? (
        <>
          <div className="panel">
            <div className="hero-meta">
              <div>
                <div className="title">{job.name}</div>
                <div className="muted mono" style={{ marginTop: 4 }}>
                  {job.protocol} · {job.type} · trace {job.traceId || "—"}
                  {job.retries != null ? ` · retries ${job.retries}` : ""}
                </div>
              </div>
              <span className={statusClass(job.status)}>{job.status}</span>
            </div>
            <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>
              创建 {fmtTime(job.createdAt)} · 更新 {fmtTime(job.updatedAt)}
              {result ? ` · 执行 ${result.durationMs} ms` : ""}
              {result && result.retryable === false ? " · 不可重试失败" : ""}
            </p>
            {result?.message ? (
              <p style={{ marginBottom: 0, marginTop: 8 }}>{result.message}</p>
            ) : null}
            {job.payload?.credentials ? (
              <p className="muted" style={{ marginBottom: 0, marginTop: 8 }}>
                登录用户 {job.payload.credentials.username || "—"} · 密码{" "}
                {job.payload.credentials.password || "[REDACTED]"}
                {job.payload.autoCaptcha === false ? " · 未开启自动验证码" : " · 自动验证码"}
                {job.payload.credentials.captchaSelector
                  ? ` · 验证码框 ${job.payload.credentials.captchaSelector}`
                  : ""}
              </p>
            ) : null}
          </div>

          {captchaEvents.length > 0 ? (
            <div className="panel">
              <div className="section-head">
                <div>
                  <h3>验证码</h3>
                  <p className="muted">
                    探测与求解轨迹。本机 mock 对 fixture 固定返回 AB12，不是识图。
                  </p>
                </div>
              </div>
              {captchaFilled?.text ? (
                <p style={{ marginTop: 0 }}>
                  填入验证码{" "}
                  <strong className="mono">{captchaFilled.text}</strong>
                  {captchaFilled.selector ? (
                    <span className="muted"> → {captchaFilled.selector}</span>
                  ) : null}
                  {captchaFilled.text === "AB12" ? (
                    <span className="muted">
                      {" "}
                      （本机 mock 固定答案；真实站点需配置识图 Webhook）
                    </span>
                  ) : null}
                </p>
              ) : null}
              <table className="table">
                <thead>
                  <tr>
                    <th>阶段</th>
                    <th>类型 / 选择器</th>
                    <th>文本 / 说明</th>
                  </tr>
                </thead>
                <tbody>
                  {captchaEvents.map((e, i) => (
                    <tr key={`${e.phase}-${i}`}>
                      <td className="mono">{e.phase}</td>
                      <td className="mono">
                        {[e.kind, e.selector || e.fillSelector]
                          .filter(Boolean)
                          .join(" ")}
                      </td>
                      <td className="mono">
                        {e.text
                          ? `text=${e.text}`
                          : e.reason || e.note || (e.solved === false ? "unsolved" : "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="panel">
            <div className="section-head">
              <div>
                <h3>步骤</h3>
                <p className="muted">执行轨迹与相对耗时条。</p>
              </div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>结果</th>
                  <th>耗时</th>
                  <th>输出 / 错误</th>
                </tr>
              </thead>
              <tbody>
                {steps.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      尚无步骤（任务可能仍在排队）
                    </td>
                  </tr>
                ) : (
                  steps.map((s) => (
                    <tr key={s.name + s.durationMs}>
                      <td className="mono">{s.name}</td>
                      <td>
                        <span className={s.success ? "badge ok" : "badge bad"}>
                          {s.success ? "OK" : "FAIL"}
                        </span>
                      </td>
                      <td className="mono">{s.durationMs} ms</td>
                      <td className="mono">{s.error || s.output || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {steps.length > 0 ? (
              <div className="step-bars">
                {steps.map((s) => (
                  <div className="step-bar-row" key={`bar-${s.name}`}>
                    <span className="mono">{s.name}</span>
                    <div className="step-bar-track">
                      <div
                        className={`step-bar-fill${s.success ? "" : " fail"}`}
                        style={{
                          width: `${(s.durationMs / maxStepMs) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="mono">{s.durationMs} ms</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {vitalsRows.length > 0 ? (
            <div className="panel">
              <div className="section-head">
                <div>
                  <h3>Web Vitals</h3>
                  <p className="muted">合成拨测采集（collectWebVitals）。</p>
                </div>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>值</th>
                  </tr>
                </thead>
                <tbody>
                  {vitalsRows.map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono">{k}</td>
                      <td className="mono">
                        {k === "JS heap"
                          ? `${(v / (1024 * 1024)).toFixed(2)} MB`
                          : k === "DOM nodes"
                            ? String(v)
                            : `${Math.round(v)} ms`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {resources ? (
            <ResourceCharts resources={resources} metrics={result?.metrics} />
          ) : null}

          {summary ? (
            <div className="panel">
              <div className="section-head">
                <div>
                  <h3>Agent 总结</h3>
                  <p className="muted">模型输出的结论与发现。</p>
                </div>
              </div>
              <p style={{ fontSize: "1.05rem", marginTop: 0 }}>
                {summary.conclusion}
              </p>
              {summary.findings?.length ? (
                <ul>
                  {summary.findings.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : null}
              {summary.anomalies?.length ? (
                <p className="err">异常：{summary.anomalies.join("；")}</p>
              ) : null}
            </div>
          ) : null}

          {shot || pageText || traceUrl || traceError ? (
            <div className="panel">
              <div className="section-head">
                <div>
                  <h3>失败证据</h3>
                  <p className="muted">截图、页面文本与 Playwright Trace（MinIO）。</p>
                </div>
                <div className="row">
                  {traceUrl ? (
                    <a className="btn ghost" href={traceUrl} target="_blank" rel="noreferrer">
                      打开 Trace
                    </a>
                  ) : null}
                  {shot ? (
                    <a
                      className="btn ghost"
                      href={`data:image/png;base64,${shot}`}
                      download={`hermes-${id.slice(0, 8)}.png`}
                    >
                      下载截图
                    </a>
                  ) : null}
                </div>
              </div>
              {traceError ? (
                <p className="muted mono">traceError: {traceError}</p>
              ) : null}
              {traceKey ? (
                <p className="muted mono">object: {traceKey}</p>
              ) : null}
              {shot ? (
                <img
                  className="shot"
                  alt="failure screenshot"
                  src={`data:image/png;base64,${shot}`}
                />
              ) : null}
              {pageText ? (
                <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>
                  {pageText}
                </pre>
              ) : null}
            </div>
          ) : null}

          {showRaw ? (
            <div className="panel">
              <div className="section-head">
                <div>
                  <h3>原始 JSON</h3>
                  <p className="muted">完整 Job 对象，便于排障与对接。</p>
                </div>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      JSON.stringify(job, null, 2)
                    );
                    setActionMsg("已复制 JSON");
                  }}
                >
                  复制
                </button>
              </div>
              <pre className="mono" style={{ whiteSpace: "pre-wrap", maxHeight: 420, overflow: "auto" }}>
                {JSON.stringify(job, null, 2)}
              </pre>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
