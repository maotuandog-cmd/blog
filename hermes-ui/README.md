# Hermes UI — Web 拨测监控（Phase A）

React + TypeScript。聚焦 **BROWSER / BROWSER_AGENT**。

应用概念：优先任务名；提交时写入 `labels.app`（与任务名相同，便于后续扩展）。

## 导航

| 页 | 说明 |
|----|------|
| 总览 | 健康态、可用率、成功率、失败、启发式告警、趋势、排行、最近故障 |
| 拨测任务 | 按应用聚合列表 + 搜索/协议过滤 |
| 提交拨测 | 创建 BROWSER / AGENT |
| 可用性 | 24h 成功/失败与柱状趋势 |
| 性能 | 入口到任务详情资源/步骤（Web Vitals → Phase B） |
| 错误分析 | TOP 失败应用 + 事件列表 |
| 趋势 | 1h / 24h / 7d 成功率折线 |
| 告警 | 占位（规则引擎 Phase B） |
| 节点 | Gateway/队列；多地域探针 Phase C |

任务详情：步骤条、资源图表瀑布、Agent 总结、失败截图。

## 开发

```bash
cd hermes-ui
npm install
npm run dev
# http://192.168.85.144:5173
```

代理 Gateway `:8080`。侧栏可填 Token。
