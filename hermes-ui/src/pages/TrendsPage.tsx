import { useEffect, useMemo, useState } from "react";
import {
  buildApps,
  buildTrend,
  fetchBrowserAudits,
  toPoints,
  type ProbePoint,
} from "../lib/aggregate";
import { pct } from "../lib/format";

type Range = "1h" | "24h" | "7d";

export function TrendsPage() {
  const [points, setPoints] = useState<ProbePoint[]>([]);
  const [range, setRange] = useState<Range>("24h");
  const [app, setApp] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        setPoints(toPoints(await fetchBrowserAudits(200)));
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

  const hours = range === "1h" ? 1 : range === "24h" ? 24 : 24 * 7;
  const buckets = range === "1h" ? 12 : range === "24h" ? 24 : 28;
  const trend = useMemo(
    () => buildTrend(scoped, hours, buckets),
    [scoped, hours, buckets]
  );

  const w = 640;
  const h = 160;
  const pad = 12;
  const rates = trend.map((d) => d.rate);
  const min = Math.min(90, ...rates) - 1;
  const max = 100;
  const line = trend
    .map((d, i) => {
      const x = pad + (i / Math.max(1, trend.length - 1)) * (w - pad * 2);
      const y =
        pad + (1 - (d.rate - min) / Math.max(0.01, max - min)) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const windowPts = scoped.filter(
    (p) => Date.now() - p.at <= hours * 3600 * 1000
  );
  const ok = windowPts.filter((p) => p.ok).length;

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>趋势分析</h1>
          <p>浏览器拨测成功率历史（审计点；非 Prometheus 长周期）。</p>
        </div>
        <div className="row">
          {(["1h", "24h", "7d"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              className={`btn ghost${range === r ? " active-range" : ""}`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
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
          <span className="kpi-label">窗口样本</span>
          <strong className="kpi-value">{windowPts.length}</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">成功率</span>
          <strong className="kpi-value">
            {pct(windowPts.length ? (ok / windowPts.length) * 100 : 100)}
          </strong>
        </div>
      </div>

      <div className="panel">
        <svg viewBox={`0 0 ${w} ${h}`} className="spark wide" role="img">
          <polyline
            fill="none"
            stroke="#0b6e64"
            strokeWidth="2.5"
            points={line}
          />
        </svg>
        <p className="muted">
          7d 仍受审计保留与拉取 limit 限制；长趋势属 Phase B（时序库）。
        </p>
      </div>
    </div>
  );
}
