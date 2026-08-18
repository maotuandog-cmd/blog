import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { loadOverview, type OverviewStats } from "../lib/aggregate";
import {
  fmtDurationMs,
  fmtTime,
  healthClass,
  healthLabel,
  pct,
  shortId,
  statusClass,
} from "../lib/format";

function TrendSpark({
  data,
}: {
  data: OverviewStats["trend24h"];
}) {
  const w = 560;
  const h = 120;
  const pad = 8;
  const rates = data.map((d) => d.rate);
  const min = Math.min(95, ...rates) - 1;
  const max = 100;
  const pts = data
    .map((d, i) => {
      const x = pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
      const y =
        pad + (1 - (d.rate - min) / Math.max(0.01, max - min)) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" role="img" aria-label="可用性趋势">
      <polyline
        fill="none"
        stroke="url(#g)"
        strokeWidth="2.5"
        points={pts}
      />
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#1a5f8a" />
          <stop offset="100%" stopColor="#0b6e64" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function DashboardPage() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setStats(await loadOverview());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>Web 应用健康总览</h1>
          <p>仅统计 BROWSER / BROWSER_AGENT。应用 ≈ 任务名（或后续 labels.app）。</p>
        </div>
        <button className="btn ghost" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      {error ? <div className="panel err">{error}</div> : null}

      {stats ? (
        <>
          <div className="panel health-hero">
            <div>
              <div className="muted">浏览器拨测状态</div>
              <div className="health-title">
                <span className={healthClass(stats.health)}>
                  {healthLabel(stats.health)}
                </span>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                Gateway {stats.gatewayOk ? "可达" : "不可达"} · 近 1h 样本{" "}
                {stats.total1h} 次
              </p>
            </div>
            <div className="kpi-grid hero-kpis">
              <div className="kpi">
                <span className="kpi-label">可用率（1h）</span>
                <strong className="kpi-value">
                  <Link to="/availability">{pct(stats.availability)}</Link>
                </strong>
              </div>
              <div className="kpi">
                <span className="kpi-label">成功率 5m / 1h</span>
                <strong className="kpi-value">
                  {pct(stats.successRate5m)}
                  <span className="kpi-sub"> / {pct(stats.successRate1h)}</span>
                </strong>
              </div>
              <div className="kpi">
                <span className="kpi-label">失败（15m / 1h）</span>
                <strong className={`kpi-value ${stats.failCount15m ? "bad-text" : ""}`}>
                  <Link to="/errors">
                    {stats.failCount15m} / {stats.failCount1h}
                  </Link>
                </strong>
              </div>
              <div className="kpi">
                <span className="kpi-label">启发式告警 / 队列</span>
                <strong className="kpi-value">
                  <Link to="/alerts">{stats.alertHint}</Link>
                  {" / "}
                  <Link to="/nodes">{stats.runningHint}</Link>
                </strong>
              </div>
              <div className="kpi">
                <span className="kpi-label">
                  平均 / P95 耗时
                  {stats.durationSample
                    ? `（n=${stats.durationSample}）`
                    : ""}
                </span>
                <strong className="kpi-value">
                  <Link to="/performance">
                    {fmtDurationMs(stats.avgDurationMs)}
                    <span className="kpi-sub">
                      {" "}
                      / {fmtDurationMs(stats.p95DurationMs)}
                    </span>
                  </Link>
                </strong>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="section-head">
              <div>
                <h3>24h 成功率趋势</h3>
                <p className="muted">按小时桶聚合终端态审计（无样本桶显示为 100%）。</p>
              </div>
            </div>
            <TrendSpark data={stats.trend24h} />
          </div>

          <div className="grid-2">
            <div className="panel">
              <div className="section-head">
                <div>
                  <h3>应用健康排行</h3>
                  <p className="muted">按成功率升序，优先关注异常。</p>
                </div>
                <Link className="btn ghost" to="/tasks">
                  全部任务
                </Link>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>应用</th>
                    <th>协议</th>
                    <th>成功率</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.apps.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        暂无浏览器拨测完成记录
                      </td>
                    </tr>
                  ) : (
                    stats.apps.slice(0, 8).map((a) => (
                      <tr key={a.app}>
                        <td>
                          <Link to={`/jobs/${a.lastJobId}`}>{a.app}</Link>
                        </td>
                        <td className="mono">{a.protocol}</td>
                        <td>{pct(a.successRate)}</td>
                        <td>
                          <span className={statusClass(a.lastStatus)}>
                            {a.lastStatus}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="panel">
              <div className="section-head">
                <div>
                  <h3>最近故障</h3>
                  <p className="muted">终端失败审计事件。</p>
                </div>
                <Link className="btn ghost" to="/errors">
                  错误分析
                </Link>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>应用</th>
                    <th>信息</th>
                    <th>任务</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentFails.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="muted">
                        近期无失败
                      </td>
                    </tr>
                  ) : (
                    stats.recentFails.map((f) => (
                      <tr key={f.event.id}>
                        <td>{fmtTime(f.event.createdAt)}</td>
                        <td>{f.app}</td>
                        <td className="mono">{f.event.message || f.event.status}</td>
                        <td>
                          <Link className="mono" to={`/jobs/${f.event.jobId}`}>
                            {shortId(f.event.jobId)}
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
