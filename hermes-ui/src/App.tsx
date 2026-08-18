import { NavLink, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  getApiBase,
  getToken,
  healthz,
  setApiBase,
  setToken,
} from "./api";
import { AlertsPage } from "./pages/AlertsPage";
import { AvailabilityPage } from "./pages/AvailabilityPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ErrorsPage } from "./pages/ErrorsPage";
import { JobDetailPage } from "./pages/JobDetailPage";
import { NodesPage } from "./pages/NodesPage";
import { PerformancePage } from "./pages/PerformancePage";
import { SubmitPage } from "./pages/SubmitPage";
import { TasksPage } from "./pages/TasksPage";
import { TrendsPage } from "./pages/TrendsPage";

const NAV = [
  { to: "/", label: "总览", end: true },
  { to: "/tasks", label: "拨测任务" },
  { to: "/submit", label: "提交拨测" },
  { to: "/availability", label: "可用性" },
  { to: "/performance", label: "性能" },
  { to: "/errors", label: "错误分析" },
  { to: "/trends", label: "趋势" },
  { to: "/alerts", label: "告警" },
  { to: "/nodes", label: "节点" },
] as const;

export function App() {
  const [token, setTokenState] = useState(getToken());
  const [base, setBaseState] = useState(getApiBase());
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    void healthz().then(setOk);
  }, [base, token]);

  return (
    <div className="app-shell">
      <aside className="side">
        <p className="brand">Hermes</p>
        <p className="brand-sub">Web 拨测监控 · Phase A+</p>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={"end" in n ? n.end : false}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="field">
            <label>API Token</label>
            <input
              type="password"
              value={token}
              placeholder="Bearer（INSECURE 可空）"
              onChange={(e) => {
                setTokenState(e.target.value);
                setToken(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label>API Base</label>
            <input
              value={base}
              placeholder="空=Vite 代理 :8080"
              onChange={(e) => {
                setBaseState(e.target.value);
                setApiBase(e.target.value);
              }}
            />
          </div>
          <span className={ok ? "badge ok" : "badge bad"}>
            Gateway {ok ? "可达" : "不可达"}
          </span>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/submit" element={<SubmitPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/availability" element={<AvailabilityPage />} />
          <Route path="/performance" element={<PerformancePage />} />
          <Route path="/errors" element={<ErrorsPage />} />
          <Route path="/trends" element={<TrendsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/nodes" element={<NodesPage />} />
        </Routes>
      </main>
    </div>
  );
}
