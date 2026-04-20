# 前端用户旅程差距分析

**日期**: 2026-04-11
**分析范围**: Antigravity-Mobility-CLI 全前端 + 79 个后端 API

---

## 导航结构

单页应用框架，所有导航通过 `page.tsx` 中 `SidebarSection` 状态切换：
- conversations / projects / knowledge / operations / ceo / settings
- **Settings 入口**: 侧栏按钮，可正常打开 SettingsPanel

---

## P0 缺口（用户旅程断裂）

### 1. Agent Groups 管理 — 后端完整，前端零
- 后端 `/api/agent-groups/` 路由存在
- 前端 `agent-groups-panel.tsx` 组件被导入但 sidebarSection 中没有匹配分支
- 用户无法创建/查看/管理 agent group

### 2. Workflow 编辑保存 — 前端编辑器存在但无法保存
- `TemplateBrowser.tsx` 有 DAG 编辑器、`NodeEditor` 组件
- `api.ts` 只有 `workflows: () => fetchJson<Workflow[]>('/api/workflows')` 列表
- **缺少** `updateWorkflow()`, `deleteWorkflow()`, `createWorkflow()` 函数
- 后端 `PUT /api/workflows/{name}`, `DELETE /api/workflows/{name}` 存在

### 3. Rule CRUD — 后端有，前端无
- `api.ts` 只有 `rules: () => fetchJson<Rule[]>('/api/rules')` 列表
- 无管理 UI，无 CRUD 函数

### 4. Skill 管理 — 后端有，前端无  
- `api.ts` 只有 `skills: () => fetchJson<Skill[]>('/api/skills')` 列表
- `SkillBrowser.tsx` 只分类展示
- 无编辑/创建/删除功能

---

## P1 缺口（功能不完整）

### 5. Approval 通知 — placeholder
- SSE 推送、Webhook 真实发送均为 placeholder
- 审批人收不到实时通知

### 6. CEO 回调 — placeholder
- Agent 批准后无法自动通知
- dispatcher.ts 中 "Implement agent notification" 注释

### 7. Model 测试连接
- Settings 中无 Test 按钮验证 Provider 可用性

---

## P2 缺口（体验优化）

### 8. 深链接
- 无 URL 路由，无法分享功能链接

### 9. Conversation 删除
- 无 DELETE 端点/UI

---

## Provider 管理专项分析

### ✅ 已完成
- Settings → Provider Config Tab 完整
- 支持 6 种 Provider（antigravity, claude-api, claude-code, codex, openai-api, custom）
- Layer 级别覆盖（executive/management/execution/utility）
- Scene 级别覆盖
- API Key 管理 Tab
- MCP 服务器管理 Tab（刚完成）
- 保存到 `/api/ai-config` (PUT)

### ❌ 缺失
- 无 Provider 连接测试按钮
- 无模型自动发现（从 Provider 拉取可用模型列表）
- 无 Provider 状态监控

---

## api.ts 缺失函数清单

| 后端 API | 缺失的前端函数 |
|---------|--------------|
| `PUT /api/workflows/{name}` | `updateWorkflow(name, config)` |
| `DELETE /api/workflows/{name}` | `deleteWorkflow(name)` |
| `POST /api/workflows` | `createWorkflow(config)` |
| `PUT /api/rules/{name}` | `updateRule(name, config)` |
| `DELETE /api/rules/{name}` | `deleteRule(name)` |
| `POST /api/rules` | `createRule(config)` |
| `POST /api/skills` | `createSkill(skill)` |
| `PUT /api/skills/{name}` | `updateSkill(name, skill)` |
| `DELETE /api/skills/{name}` | `deleteSkill(name)` |
| `GET /api/agent-groups` | `agentGroups()` |
| `POST /api/agent-groups` | `createAgentGroup(config)` |
| `PUT /api/agent-groups/{id}` | `updateAgentGroup(id, config)` |
| `DELETE /api/agent-groups/{id}` | `deleteAgentGroup(id)` |
| `DELETE /api/conversations/{id}` | `deleteConversation(id)` |
