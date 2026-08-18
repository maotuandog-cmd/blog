import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildApps,
  fetchBrowserAudits,
  toPoints,
  type AppRow,
  type ProbePoint,
} from "../lib/aggregate";
import { fmtTime, pct, shortId, statusClass } from "../lib/format";

export function TasksPage() {
  const [rows, setRows] = useState<AppRow[]>([]);
  const [recent, setRecent] = useState<ProbePoint[]>([]);
  const [q, setQ] = useState("");
  const [protocol, setProtocol] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const points = toPoints(await fetchBrowserAudits(150));
      setRows(buildApps(points));
      setRecent(points.slice(0, 25));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (protocol && r.protocol !== protocol) return false;
      if (!q) return true;
      const s = q.toLowerCase();
      return (
        r.app.toLowerCase().includes(s) ||
        r.asset.toLowerCase().includes(s) ||
        r.protocol.toLowerCase().includes(s)
      );
    });
  }, [rows, q, protocol]);

  const recentFiltered = useMemo(() => {
    return recent.filter((p) => {
      if (protocol && p.event.protocol !== protocol) return false;
      if (!q) return true;
      const s = q.toLowerCase();
      return (
        p.app.toLowerCase().includes(s) ||
        (p.event.asset || "").toLowerCase().includes(s) ||
        p.event.protocol.toLowerCase().includes(s) ||
        p.event.jobId.toLowerCase().includes(s)
      );
    });
  }, [recent, q, protocol]);

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>拨测任务</h1>
          <p>按应用聚合 + 最近终态作业；点进任务详情可取消/重跑。</p>
        </div>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
          <Link className="btn" to="/submit">
            提交拨测
          </Link>
        </div>
      </div>
      {error ? <div className="panel err">{error}</div> : null}

      <div className="panel row">
        <div className="field">
          <label>搜索</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="应用名 / URL / 协议 / jobId"
          />
        </div>
        <div className="field" style={{ maxWidth: 200 }}>
          <label>协议</label>
          <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
            <option value="">全部浏览器</option>
            <option value="BROWSER">BROWSER</option>
            <option value="BROWSER_AGENT">BROWSER_AGENT</option>
          </select>
        </div>
      </div>

      <div className="panel">
        <div className="section-head">
          <div>
            <h3>按应用</h3>
            <p className="muted">应用 ≈ 任务名（labels.app）。</p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>应用</th>
              <th>资产</th>
              <th>类型</th>
              <th>状态</th>
              <th>成功率</th>
              <th>样本</th>
              <th>更新</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  暂无数据。可先提交拨测。
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.app + r.protocol}>
                  <td>
                    <Link to={`/jobs/${r.lastJobId}`}>{r.app}</Link>
                  </td>
                  <td className="mono">{r.asset}</td>
                  <td className="mono">{r.protocol}</td>
                  <td>
                    <span className={statusClass(r.lastStatus)}>{r.lastStatus}</span>
                  </td>
                  <td>{pct(r.successRate)}</td>
                  <td>
                    {r.total - r.failed}/{r.total}
                  </td>
                  <td>{fmtTime(r.lastAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="section-head">
          <div>
            <h3>最近作业</h3>
            <p className="muted">审计终端态，最多 25 条。</p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>应用</th>
              <th>协议</th>
              <th>状态</th>
              <th>消息</th>
              <th>任务</th>
            </tr>
          </thead>
          <tbody>
            {recentFiltered.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  暂无终态作业
                </td>
              </tr>
            ) : (
              recentFiltered.map((p) => (
                <tr key={p.event.id}>
                  <td>{fmtTime(p.event.createdAt)}</td>
                  <td>{p.app}</td>
                  <td className="mono">{p.event.protocol}</td>
                  <td>
                    <span className={statusClass(p.event.status)}>{p.event.status}</span>
                  </td>
                  <td className="mono">{p.event.message || "—"}</td>
                  <td>
                    <Link className="mono" to={`/jobs/${p.event.jobId}`}>
                      {shortId(p.event.jobId)}
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
