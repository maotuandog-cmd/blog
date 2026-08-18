import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchBrowserAudits,
  topFailMessages,
  toPoints,
  type FailMessageRow,
  type ProbePoint,
} from "../lib/aggregate";
import { fmtTime, shortId } from "../lib/format";

export function ErrorsPage() {
  const [fails, setFails] = useState<ProbePoint[]>([]);
  const [topMsg, setTopMsg] = useState<FailMessageRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const points = toPoints(await fetchBrowserAudits(150)).filter((p) => !p.ok);
        setFails(points.slice(0, 40));
        setTopMsg(topFailMessages(points, 8));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>错误分析</h1>
          <p>失败消息聚合（归一化超时/ID）与最近事件；截图与步骤见任务详情。</p>
        </div>
      </div>
      {error ? <div className="panel err">{error}</div> : null}

      <div className="grid-2">
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>错误消息 TOP</h3>
          <table className="table">
            <thead>
              <tr>
                <th>模式</th>
                <th>次数</th>
                <th>最近应用</th>
              </tr>
            </thead>
            <tbody>
              {topMsg.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    无失败样本
                  </td>
                </tr>
              ) : (
                topMsg.map((t) => (
                  <tr key={t.key}>
                    <td>
                      <Link className="mono" to={`/jobs/${t.lastJobId}`} title={t.sample}>
                        {t.key}
                      </Link>
                    </td>
                    <td className="bad-text">{t.count}</td>
                    <td>{t.lastApp}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>类型说明</h3>
          <ul className="muted">
            <li>浏览器步骤 / assertText</li>
            <li>鉴权段失败（authSteps）</li>
            <li>Agent 未达成 / LLM 失败</li>
            <li>资源加载失败见详情瀑布 ok=false</li>
          </ul>
          <p className="muted">HTTP 状态码分布与页面 JS 异常聚合属 Phase B。</p>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>最近失败事件</h3>
        <table className="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>应用</th>
              <th>协议</th>
              <th>消息</th>
              <th>任务</th>
            </tr>
          </thead>
          <tbody>
            {fails.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  近期无失败
                </td>
              </tr>
            ) : (
              fails.map((f) => (
                <tr key={f.event.id}>
                  <td>{fmtTime(f.event.createdAt)}</td>
                  <td>{f.app}</td>
                  <td className="mono">{f.event.protocol}</td>
                  <td className="mono">{f.event.message || "—"}</td>
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
  );
}
