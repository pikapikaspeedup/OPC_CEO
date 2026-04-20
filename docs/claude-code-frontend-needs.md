# Claude Code 前端需求分析

**日期**: 2026-04-11

## 已覆盖（不需要新 UI）

| 模块 | 前端组件 | 说明 |
|:-----|:---------|:-----|
| Provider 配置 | settings-panel.tsx | layer/scene/custom 全覆盖 |
| Agent Run 监控 | agent-runs-panel.tsx | 状态/输出/干预 |
| Approval 审批 | approval-panel.tsx | 通用审批框架 |
| MCP 管理 | mcp-status-widget.tsx + settings MCP tab | 服务器管理 |

## 需要新前端（按优先级）

### P0: 工具管理面板
- **后端**: `src/lib/claude-engine/tools/` 有 6 个核心工具
- **缺失**: 无工具启用/禁用 UI、无权限绑定
- **建议位置**: Settings → 新增 "Tools" Tab
- **需要 API**: `GET /api/claude-engine/tools`

### P0: 权限规则编辑器
- **后端**: `src/lib/claude-engine/permissions/` 支持 allow/deny/ask
- **缺失**: 无规则编辑界面
- **建议位置**: Settings → 新增 "Permissions" Tab
- **需要 API**: `GET/POST /api/claude-engine/permissions`

### P1: 对话历史 + Token 统计
- **后端**: `src/lib/claude-engine/engine/query-loop.ts` 有完整对话数据
- **缺失**: 无 session 级对话历史展示、无 token 实时统计
- **建议位置**: agent-run-detail 新增 "对话" 标签页

### P2: 记忆浏览器
- **后端**: `src/lib/claude-engine/memory/` 完整实现
- **缺失**: 无记忆查看/管理 UI
- **参考**: department-memory-panel.tsx
- **需要 API**: `GET /api/claude-engine/memory`

## 缺失的 API 路由

| 路由 | 方法 | 功能 |
|:-----|:-----|:-----|
| `/api/claude-engine/sessions` | GET | 列表 Claude Code session |
| `/api/claude-engine/tools` | GET | 列表工具 + 权限状态 |
| `/api/claude-engine/tools/:name/toggle` | POST | 启用/禁用工具 |
| `/api/claude-engine/permissions` | GET/POST | 权限规则 CRUD |
| `/api/claude-engine/memory` | GET | 查询记忆 |

## 结论

Claude Code 后端已完整，前端主要缺 2 个 P0：工具管理 + 权限编辑。
这两个都可以放在 Settings Panel 中作为新的 Tab 页。
