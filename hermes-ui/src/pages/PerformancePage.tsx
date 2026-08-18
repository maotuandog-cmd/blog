import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  loadAppLatencies,
  type AppLatencyRow,
} from "../lib/aggregate";
import { fmtDurationMs, pct } from "../lib/format";

export function PerformancePage() {
  const [rows, setRows] = useState<AppLatencyRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const list = await loadAppLatencies();
      setRows(
        [...list].sort((a, b) => (b.p95Ms ?? -1) - (a.p95Ms ?? -1))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const hasVitals = rows.some((r) => r.vitalsSample > 0);

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>性能</h1>
          <p>
            按应用抽样任务耗时（平均 / P95）。开启{" "}
            <code>collectWebVitals</code> 的任务会汇总 TTFB / FCP / LCP（合成拨测，非
            RUM）。资源瀑布与步骤条见任务详情。
          </p>
        </div>
        <button className="btn ghost" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "抽样中…" : "刷新"}
        </button>
      </div>
      {error ? <div className="panel err">{error}</div> : null}
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>应用</th>
              <th>协议</th>
              <th>成功率</th>
              <th>平均耗时</th>
              <th>P95</th>
              <th>抽样</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  暂无浏览器拨测样本
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.app}>
                  <td>{r.app}</td>
                  <td className="mono">{r.protocol}</td>
                  <td>{pct(r.successRate)}</td>
                  <td className="mono">{fmtDurationMs(r.avgMs)}</td>
                  <td className="mono">{fmtDurationMs(r.p95Ms)}</td>
                  <td className="mono">n={r.sample}</td>
                  <td>
                    <Link to={`/jobs/${r.lastJobId}`}>资源/步骤</Link>
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
            <h3>Web Vitals（抽样）</h3>
            <p className="muted">
              来自近期任务 <code>result.metrics</code>
              {hasVitals ? "" : "；当前抽样尚无 vitals，请在提交页开启 collectWebVitals"}。
            </p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>应用</th>
              <th>TTFB avg</th>
              <th>TTFB P95</th>
              <th>FCP avg</th>
              <th>FCP P95</th>
              <th>LCP avg</th>
              <th>LCP P95</th>
              <th>TBT avg</th>
              <th>vitals n</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="muted">
                  暂无样本
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={`v-${r.app}`}>
                  <td>
                    <Link to={`/jobs/${r.lastJobId}`}>{r.app}</Link>
                  </td>
                  <td className="mono">{fmtDurationMs(r.avgTtfbMs)}</td>
                  <td className="mono">{fmtDurationMs(r.p95TtfbMs)}</td>
                  <td className="mono">{fmtDurationMs(r.avgFcpMs)}</td>
                  <td className="mono">{fmtDurationMs(r.p95FcpMs)}</td>
                  <td className="mono">{fmtDurationMs(r.avgLcpMs)}</td>
                  <td className="mono">{fmtDurationMs(r.p95LcpMs)}</td>
                  <td className="mono">{fmtDurationMs(r.avgTbtMs)}</td>
                  <td className="mono">{r.vitalsSample}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
