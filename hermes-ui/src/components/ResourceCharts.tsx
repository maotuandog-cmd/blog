import type { ResourceSummary } from "../types";

const TYPE_COLORS: Record<string, string> = {
  document: "#0d7a6f",
  script: "#1d4f91",
  stylesheet: "#b45309",
  image: "#7c3aed",
  font: "#0f766e",
  xhr: "#be123c",
  fetch: "#be123c",
  other: "#64748b",
};

function colorFor(type: string): string {
  return TYPE_COLORS[type] || TYPE_COLORS.other!;
}

function fmtBytes(n?: number): string {
  if (n == null || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function truncate(s: string, n = 56): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function ResourceCharts({
  resources,
  metrics,
}: {
  resources: ResourceSummary;
  metrics?: Record<string, number>;
}) {
  const byType = Object.entries(resources.byType || {});
  const byHost = Object.entries(resources.byHost || {});
  const slowest = [...(resources.slowest || [])].sort(
    (a, b) => (b.durationMs || 0) - (a.durationMs || 0)
  );
  const maxTypeMs = Math.max(1, ...byType.map(([, v]) => v.durationMsMax || 0));
  const maxTypeCount = Math.max(1, ...byType.map(([, v]) => v.count || 0));
  const maxSlow = Math.max(1, ...slowest.map((s) => s.durationMs || 0));
  const maxHostMs = Math.max(1, ...byHost.map(([, v]) => v.durationMsMax || 0));

  const total =
    resources.total ?? metrics?.hermes_browser_resource_total ?? 0;
  const failed =
    resources.failed ?? metrics?.hermes_browser_resource_failed ?? 0;
  const maxMs =
    resources.durationMsMax ??
    metrics?.hermes_browser_resource_duration_ms_max ??
    0;
  const bytes =
    resources.bytesSum ?? metrics?.hermes_browser_resource_bytes_sum ?? 0;

  return (
    <section className="panel resource-panel">
      <div className="section-head">
        <div>
          <h3>资源耗时</h3>
          <p className="muted">按类型 / 主机聚合，以及最慢资源瀑布。</p>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <span className="kpi-label">请求数</span>
          <strong className="kpi-value">{total}</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">失败</span>
          <strong className={`kpi-value ${failed ? "bad-text" : ""}`}>
            {failed}
          </strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">最慢单请求</span>
          <strong className="kpi-value">{maxMs} ms</strong>
        </div>
        <div className="kpi">
          <span className="kpi-label">传输体量</span>
          <strong className="kpi-value">{fmtBytes(bytes)}</strong>
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-block">
          <h4>类型 · 最大耗时</h4>
          <div className="hbar-list">
            {byType.length === 0 ? (
              <p className="muted">无数据</p>
            ) : (
              byType.map(([type, v]) => (
                <div className="hbar-row" key={type}>
                  <div className="hbar-meta">
                    <span className="dot" style={{ background: colorFor(type) }} />
                    <span className="mono">{type}</span>
                    <span className="muted">
                      n={v.count}
                      {v.failed ? ` · fail ${v.failed}` : ""}
                    </span>
                    <span className="hbar-val">{v.durationMsMax ?? 0} ms</span>
                  </div>
                  <div className="hbar-track">
                    <div
                      className="hbar-fill"
                      style={{
                        width: `${((v.durationMsMax || 0) / maxTypeMs) * 100}%`,
                        background: colorFor(type),
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="chart-block">
          <h4>类型 · 请求数量</h4>
          <div className="vbar-wrap" role="img" aria-label="by type count">
            {byType.map(([type, v]) => (
              <div className="vbar-col" key={type}>
                <div className="vbar-track">
                  <div
                    className="vbar-fill"
                    style={{
                      height: `${(v.count / maxTypeCount) * 100}%`,
                      background: colorFor(type),
                    }}
                    title={`${type}: ${v.count}`}
                  />
                </div>
                <span className="vbar-label mono">{type.slice(0, 6)}</span>
                <span className="vbar-n">{v.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="chart-block">
        <h4>最慢资源瀑布</h4>
        <div className="waterfall">
          {slowest.length === 0 ? (
            <p className="muted">无 slowest 数据</p>
          ) : (
            slowest.map((s, i) => (
              <div className="wf-row" key={`${s.url}-${i}`}>
                <div className="wf-label">
                  <span
                    className="type-chip"
                    style={{
                      background: `${colorFor(s.resourceType)}22`,
                      color: colorFor(s.resourceType),
                    }}
                  >
                    {s.resourceType}
                  </span>
                  <span className="mono wf-url" title={s.url}>
                    {truncate(s.url || s.host)}
                  </span>
                  <span className={s.ok ? "badge ok" : "badge bad"}>
                    {s.ok ? "OK" : "FAIL"}
                  </span>
                  <span className="wf-ms">{s.durationMs} ms</span>
                </div>
                <div className="wf-track">
                  <div
                    className="wf-bar"
                    style={{
                      width: `${(s.durationMs / maxSlow) * 100}%`,
                      background: `linear-gradient(90deg, ${colorFor(s.resourceType)}aa, ${colorFor(s.resourceType)})`,
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {byHost.length > 0 ? (
        <div className="chart-block">
          <h4>按主机 · 最大耗时</h4>
          <div className="hbar-list">
            {byHost
              .sort((a, b) => (b[1].durationMsMax || 0) - (a[1].durationMsMax || 0))
              .map(([host, v]) => (
                <div className="hbar-row" key={host}>
                  <div className="hbar-meta">
                    <span className="mono">{host}</span>
                    <span className="muted">n={v.count}</span>
                    <span className="hbar-val">{v.durationMsMax ?? 0} ms</span>
                  </div>
                  <div className="hbar-track">
                    <div
                      className="hbar-fill host"
                      style={{
                        width: `${((v.durationMsMax || 0) / maxHostMs) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
