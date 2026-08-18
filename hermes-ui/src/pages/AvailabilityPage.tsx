import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildApps,
  buildTrend,
  fetchBrowserAudits,
  toPoints,
  type ProbePoint,
} from "../lib/aggregate";
import { pct } from "../lib/format";

export function AvailabilityPage() {
  const [points, setPoints] = useState<ProbePoint[]>([]);
  const [app, setApp] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        setPoints(toPoints(await fetchBrowserAudits(150)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const apps = useMemo(() => buildApps(points).map((a) => a.app), [points]);
  const scoped = useMemo(
    () => (app ? points.filter((p) => p.app === app) : points),
    [points, app]
  );

  const now = Date.now();
  const day = scoped.filter((p) => now - p.at <= 24 * 3600 * 1000);
  const ok = day.filter((p) => p.ok).length;
  const fail = day.length - ok;
  const trend = useMemo(() => buildTrend(scoped, 24, 24), [scoped]);
  const maxRate = 100;
  const minRate = Math.min(90, ...trend.map((t) => t.rate));

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>可用性</h1>
          <p>浏览器拨测成功率与近 24 小时趋势（审计终端态）。</p>
        </div>
      </div>
      {error ? <div className="panel err">{error}</div> : null}

      <div className="panel row">
        <div className="field" style={{ maxWidth: 320 }}>
          <label>应用筛选</label>
          <select value={app} onChange={(e) => setApp(e.target.value)}>
            <option value="">全部应用</option>
            {apps.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <span className="kpi-label">24h 请求</span>
          <strong className="kpi-value">{day.length}</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">成功</span>
          <strong className="kpi-value">{ok}</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">失败</span>
          <strong className={`kpi-value ${fail ? "bad-text" : ""}`}>{fail}</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">可用率</span>
          <strong className="kpi-value">
            {pct(day.length ? (ok / day.length) * 100 : 100)}
          </strong>
        </div>
      </div>

      <div className="panel">
        <div className="section-head">
          <div>
            <h3>24h 可用率</h3>
            <p className="muted">柱高表示该小时成功率。</p>
          </div>
        </div>
        <div className="avail-bars">
          {trend.map((b) => (
            <div className="avail-col" key={b.t} title={`${b.label}: ${b.rate}% (${b.ok}/${b.total})`}>
              <div className="avail-track">
                <div
                  className="avail-fill"
                  style={{
                    height: `${((b.rate - minRate) / Math.max(0.01, maxRate - minRate)) * 100}%`,
                  }}
                />
              </div>
              <span className="avail-label">{b.label.slice(0, 2)}</span>
            </div>
          ))}
        </div>
        <p className="muted">
          Phase A 无独立 HTTP 状态码分布；浏览器失败请看{" "}
          <Link to="/errors">错误分析</Link> 与任务详情证据。
        </p>
      </div>
    </div>
  );
}
