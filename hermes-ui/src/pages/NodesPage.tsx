import { useEffect, useState } from "react";
import {
  browserWorkerHealthz,
  getBrowserWorkerBase,
  getDrain,
  getQueue,
  healthz,
  reclaim,
  setBrowserWorkerBase,
  setDrain,
} from "../api";
import type { QueueStats } from "../types";

export function NodesPage() {
  const [gw, setGw] = useState(false);
  const [bw, setBw] = useState(false);
  const [bwBase, setBwBaseState] = useState(getBrowserWorkerBase());
  const [queue, setQueue] = useState<QueueStats | null>(null);
  const [drain, setDrainState] = useState<{
    drain: boolean;
    drainMode?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try {
      const [g, q, d, b] = await Promise.all([
        healthz(),
        getQueue(),
        getDrain(),
        browserWorkerHealthz(),
      ]);
      setGw(g);
      setQueue(q);
      setDrainState(d);
      setBw(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(t);
  }, [bwBase]);

  async function applyDrain(enabled: boolean, mode?: "soft" | "hard") {
    setBusy(true);
    setMsg("");
    setError("");
    try {
      const d = await setDrain({ enabled, mode });
      setDrainState(d);
      setMsg(enabled ? `已开启排水（${d.drainMode || mode || "soft"}）` : "已关闭排水");
      setQueue(await getQueue().catch(() => queue));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onReclaim() {
    if (
      !window.confirm(
        "强制回收空闲 pending（默认 minIdleSec=120）。确认继续？"
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg("");
    setError("");
    try {
      const r = await reclaim({ minIdleSec: 120, count: 32 });
      setMsg(`回收完成：requeued=${r.requeued}（minIdle=${r.minIdleSec}）`);
      setQueue(await getQueue());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="topbar">
        <div>
          <h1>节点与运维</h1>
          <p>Gateway / browser-worker / 队列 / 排水 / 强制回收。</p>
        </div>
        <button className="btn ghost" type="button" onClick={() => void load()} disabled={busy}>
          刷新
        </button>
      </div>
      {error ? <div className="panel err">{error}</div> : null}
      {msg ? <div className="panel">{msg}</div> : null}

      <div className="kpi-grid">
        <div className="kpi">
          <span className="kpi-label">Gateway</span>
          <strong className={`kpi-value ${gw ? "" : "bad-text"}`}>
            {gw ? "在线" : "离线"}
          </strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">browser-worker</span>
          <strong className={`kpi-value ${bw ? "" : "bad-text"}`}>
            {bw ? "在线" : "离线"}
          </strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">排水</span>
          <strong className="kpi-value">
            {drain?.drain ? drain.drainMode || "on" : "关闭"}
          </strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">Stream / Pending</span>
          <strong className="kpi-value mono">
            {Number(queue?.streamLength ?? 0)} / {Number(queue?.pending ?? 0)}
          </strong>
        </div>
      </div>

      <div className="panel">
        <div className="field">
          <label>browser-worker Base（空=Vite 代理 /bw → :8090）</label>
          <input
            value={bwBase}
            placeholder="例如 http://127.0.0.1:8090"
            onChange={(e) => {
              setBwBaseState(e.target.value);
              setBrowserWorkerBase(e.target.value);
            }}
          />
        </div>
      </div>

      <div className="panel">
        <div className="section-head">
          <div>
            <h3>运维操作</h3>
            <p className="muted">
              soft：拒新任务，worker 清 backlog；hard：同时停止 Claim。
            </p>
          </div>
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            onClick={() => void applyDrain(true, "soft")}
          >
            开启 soft 排水
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            onClick={() => void applyDrain(true, "hard")}
          >
            开启 hard 排水
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || !drain?.drain}
            onClick={() => void applyDrain(false)}
          >
            关闭排水
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            onClick={() => void onReclaim()}
          >
            强制回收 pending
          </button>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>队列快照</h3>
        <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>
          {queue ? JSON.stringify(queue, null, 2) : "—"}
        </pre>
      </div>
    </div>
  );
}
