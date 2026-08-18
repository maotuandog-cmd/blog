import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildHeuristicAlerts,
  fetchBrowserAudits,
  toPoints,
  type HeuristicAlert,
} from "../lib/aggregate";
import { pct } from "../lib/format";

export function AlertsPage() {
  const [alerts, setAlerts] = useState<HeuristicAlert[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setAlerts(buildHeuristicAlerts(toPoints(await fetchBrowserAudits(150))));
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
          <h1>告警中心</h1>
          <p>
            Hermes <strong>不内置告警通知</strong>。正式规则请用 Prometheus /
            Alertmanager（见 <code>deploy/alertmanager-browser-examples.yml</code>
            ）。本页仅为审计启发式调试视图。
          </p>
        </div>
        <button className="btn ghost" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>
      {error ? <div className="panel err">{error}</div> : null}

      <div className="panel">
        <div className="section-head">
          <div>
            <h3>当前启发式告警</h3>
            <p className="muted">基于审计终端态，非持久化规则引擎。</p>
          </div>
          <span className="muted">{alerts.length} 条</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>级别</th>
              <th>应用</th>
              <th>原因</th>
              <th>成功率</th>
              <th>任务</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  当前无启发式告警
                </td>
              </tr>
            ) : (
              alerts.map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className={a.severity === "crit" ? "badge bad" : "badge warn"}>
                      {a.severity === "crit" ? "严重" : "警告"}
                    </span>
                  </td>
                  <td>{a.app}</td>
                  <td>{a.reason}</td>
                  <td>{a.rate != null ? pct(a.rate) : "—"}</td>
                  <td>
                    <Link className="mono" to={`/jobs/${a.jobId}`}>
                      查看
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Prometheus / Alertmanager</h3>
        <ul className="muted">
          <li>刮取 worker-core <code>:8081/metrics</code>：journey_finished、vitals histograms</li>
          <li>Gateway <code>:8080/metrics</code>：入队等控制面计数</li>
          <li>示例规则：<code>deploy/alertmanager-browser-examples.yml</code></li>
          <li>Hermes UI 不负责通知投递</li>
        </ul>
        <Link className="btn ghost" to="/">
          返回总览
        </Link>
      </div>
    </div>
  );
}
