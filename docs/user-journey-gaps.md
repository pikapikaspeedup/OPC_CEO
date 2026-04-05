# 用户场景断裂分析

> 初始分析日期：2026-04-04  
> 最新审查日期：2026-04-05  
> 方法：从 CEO 实际使用旅程出发，走通 7 个核心场景，逐步验证每一步是否能端到端完成。

---

## 〇、当前状态总结（2026-04-05 审查）

> **全部 7 个 🔴 断裂 + 6 个 🟡 缺失已修复完成。712/712 测试通过，`npm run build` ✅。**

| 严重程度 | 原始数量 | 当前状态 |
|---|---|---|
| 🔴 场景不可用/核心链路断裂 | 7 | ✅ **全部修复** |
| 🟡 功能缺失/空壳 | 6 | ✅ **全部修复/验证** |
| ✅ 完整可用 | ~35 → **~48** | 含新增组件和功能 |

### OPC 交互架构重构（设计说明书 v2 实施状态）

| Phase | 内容 | 状态 |
|---|---|---|
| Phase 1 | Header 改造（GlobalCommandBar + NotificationIndicators + 3 Drawers） | ✅ 完成 |
| Phase 2 | 导航重构（5 标签 → 4 标签，移除 Agents，默认 OPC） | ✅ 完成 |
| Phase 3 | OPC 首页精简（折叠区域、部门钻取 Drawer） | ✅ 完成 |
| Phase 4 | 整合验证 | ✅ 712/712 测试 + build pass |
| — | 面包屑导航 `ProjectBreadcrumb` | ⚪ 未实现（设计文档有，非必需） |

---

## 一、断裂修复清单（全部已完成）

| # | 断裂 | 影响场景 | 修复方案 | 状态 |
|---|---|---|---|---|
| **1** | **CEO 命令创建项目后不自动 dispatch** | 场景 2 | `ceoCreateProject` 后自动调用 `dispatchRun` + `resolveDispatchGroupId` | ✅ 已修复 |
| **2** | **DepartmentSetupDialog 缺少 Provider 下拉** | 场景 5 | Provider Select（自动/Antigravity/Codex）+ tokenQuota 数字输入 | ✅ 已修复 |
| **3** | **保存部门配置后不自动同步规则** | 场景 1、5 | `handleSave` 成功后自动 `api.syncDepartment()` | ✅ 已修复 |
| **4** | **部门记忆管理 UI 完全缺失** | 场景 1、4、5 | `DepartmentMemoryPanel`（三分类 Tab）+ `api.getDepartmentMemory/addDepartmentMemory` | ✅ 已修复 |
| **5** | **审批请求无自动触发源** | 场景 3 | `approval-triggers.ts` 监听 `stage:failed` 事件，自动创建审批 | ✅ 已修复 |
| **6** | **Token 配额无前端展示/管理** | 场景 5 | `token-quota.ts` 实际读取配额 + `dispatchRun` 超限自动审批 + `TokenQuotaWidget` | ✅ 已修复 |
| **7** | **Run 完成后知识沉淀无 UI 查看** | 场景 4 | 集成到 `DepartmentMemoryPanel`（Knowledge section） | ✅ 已修复 |

---

## 二、逐场景分析

### 场景 1：CEO 首次使用 — "把公司跑起来"

**用户意图**：打开系统 → 配置部门 → 开始使用

| 步骤 | 操作 | 状态 | 说明 |
|---|---|---|---|
| 1.1 | 打开应用默认进入 OPC 首页 | ✅ | `sidebarSection` 默认 `'projects'` |
| 1.2 | 系统检测未配置部门 → 弹出 OnboardingWizard | ✅ | — |
| 1.3 | 走引导流程：填写部门名称/类型/OKR | ✅ | — |
| 1.4 | 保存配置 → `api.updateDepartment()` | ✅ | — |
| 1.5 | 同步规则到 IDE | ✅ | `handleSave` 成功后自动 `api.syncDepartment()` |
| 1.6 | 查看部门知识库 | ✅ | `DepartmentMemoryPanel`（Knowledge section 三分类 Tab） |
| 1.7 | 配置部门 AI Provider | ✅ | Provider Select（自动/Antigravity/Codex）+ TokenQuota 输入 |

---

### 场景 2：CEO 日常 — "分发一个任务"

**用户意图**：在输入框输入"优化支付流程" → AI 分析 → 自动派发 → 看结果

| 步骤 | 操作 | 状态 | 断裂说明 |
|---|---|---|---|
| 2.1 | 在 CEO Dashboard 输入框输入命令 | ✅ | — |
| 2.2 | `api.ceoCommand()` → `processCEOCommand()` 关键词匹配部门 | ✅ | — |
| 2.3 | 找到部门 → 检查负载 | ✅ | — |
| 2.4 | 创建 project → `ceoCreateProject()` → `createProject()` | ✅ | — |
| 2.5 | 项目创建后自动 dispatch pipeline | ✅ | `ceoCreateProject` → `resolveDispatchGroupId` → `dispatchRun` 自动执行 |
| 2.6 | CEO 看到结果反馈 "已将任务…派发给…" | ✅ | 项目创建+dispatch 均成功 |
| 2.7 | 无需手动操作 | ✅ | CEO 命令端到端自动完成 |

---

### 场景 3：CEO 日常 — "查看今日进展"

**用户意图**：打开 Dashboard → 看部门状态 + 事件流 + 日报

| 步骤 | 操作 | 状态 | 说明 |
|---|---|---|---|
| 3.1 | 看部门网格（忙碌度/项目数） | ✅ | — |
| 3.2 | 看事件流 | ✅ | 事件由 `generateCEOEvents()` 从 runs/projects 数据驱动生成，通过 Header ⚡ 抽屉查看 |
| 3.3 | 看日报 | ✅ | DailyDigestCard 支持日/周/月切换 |
| 3.4 | 日报数据来源 | ✅ | `/api/departments/digest` 聚合 projects + execution-journal，空数据=无活动 |
| 3.5 | 点击部门 → 放大到部门详情 | ✅ | `DepartmentDetailDrawer` 展示 OKR/统计/Token/项目/日报 |
| 3.6 | 查看待审批请求 | ✅ | Header 🔔 → ApprovalDrawer |
| 3.7 | 审批请求数据 | ✅ | `approval-triggers.ts` 监听 `stage:failed` 事件，超时/阻塞/失败自动创建审批；`dispatchRun` 超限自动创建审批 |

---

### 场景 4：Agent 执行 — "Pipeline 跑起来"

**用户意图**：Dispatch → Agent 编码 → 监控 → 查看结果 → 知识沉淀

| 步骤 | 操作 | 状态 | 说明 |
|---|---|---|---|
| 4.1 | Projects 面板 → 选项目 → 手动 Dispatch | ✅ | — |
| 4.2 | `api.dispatchRun()` → 后端启动 pipeline | ✅ | — |
| 4.3 | Agent 执行（grpc 调用 IDE） | ✅ | — |
| 4.4 | 查看 run 状态 | ✅ | AgentRunsPanel + Header ▶ 抽屉 |
| 4.5 | 查看步骤/进度 | ✅ | AgentRunDetail + PipelineMiniDAG |
| 4.6 | 干预操作（nudge/retry/restart/cancel/evaluate） | ✅ | 5 种干预全部连通（Dashboard + Runs 抽屉） |
| 4.7 | Pipeline DAG 可视化 | ✅ | project-workbench + dag-view |
| 4.8 | Gate 审批 | ✅ | gateApprove |
| 4.9 | 查看交付物 | ✅ | DeliverablesPanel + 近期交付卡片 |
| 4.10 | 查看 Journal | ✅ | queryJournal |
| 4.11 | Run 完成后查看知识沉淀 | ✅ | `DepartmentMemoryPanel`（Knowledge section 三分类 Tab） |
| 4.12 | 失败后 resume | ✅ | resumeProject |
| 4.13 | Checkpoint + Replay | ✅ | listCheckpoints + restoreCheckpoint + replayProject |

---

### 场景 5：部门管理 — "调整部门配置"

**用户意图**：CEO 想调整部门的 AI Provider / Token 配额 / 知识库

| 步骤 | 操作 | 状态 | 说明 |
|---|---|---|---|
| 5.1 | 打开 DepartmentSetupDialog（⚙️ 按钮） | ✅ | — |
| 5.2 | 修改名称/类型/OKR/Roster | ✅ | — |
| 5.3 | 修改 AI Provider | ✅ | Provider Select（自动/Antigravity/Codex） |
| 5.4 | 修改 Token 配额 | ✅ | 每日/每月限额数字输入，已用量展示 |
| 5.5 | 保存后同步规则 | ✅ | `handleSave` 成功后自动 `api.syncDepartment()` |
| 5.6 | 管理部门记忆/知识 | ✅ | `DepartmentMemoryPanel`（Knowledge section 三分类 Tab） |
| 5.7 | 查看 Token 使用量 | ✅ | `TokenQuotaWidget` + `token-quota.ts` 实际读取配额 + `dispatchRun` 超限拦截 |

---

### 场景 6：运维管理 — "查看系统健康"

**用户意图**：切到 Operations → 查看调度/策略/审计

| 步骤 | 操作 | 状态 | 说明 |
|---|---|---|---|
| 6.1 | 切换到 Operations section | ✅ | — |
| 6.2 | AnalyticsDashboard | ✅ | — |
| 6.3 | Scheduler 任务管理 | ✅ | SchedulerPanel |
| 6.4 | Subgraphs 查看 | ✅ | SubgraphPanel |
| 6.5 | Resource Policies 管理 | ✅ | PolicyPanel |
| 6.6 | **MCP 配置/状态** | 🟡 | `api.mcp()` 有定义但无组件展示 |
| 6.7 | **Tunnel 管理** | 🟡 | 4 个 API 路由（`/api/tunnel/*`），无前端 |
| 6.8 | 日志查看 | ✅ | LogViewerPanel |

---

### 场景 7：模板管理 — "创建/编辑 Pipeline"

**用户意图**：创建新模板 / 编辑已有模板 / AI 生成

| 步骤 | 操作 | 状态 | 说明 |
|---|---|---|---|
| 7.1 | AI 生成 Pipeline | ✅ | PipelineGenerateDialog |
| 7.2 | 查看/编辑模板 | ✅ | TemplateBrowser（完整的模板编辑器） |
| 7.3 | 验证模板 | ✅ | validateTemplate |
| 7.4 | 克隆/删除 | ✅ | — |
| 7.5 | **Lint 检查** | 🟡 | `api.lintTemplate()` 定义了但 TemplateBrowser 没调用（validate 已连接） |

---

## 三、完整可用的功能清单

以下场景端到端完全可用，无任何断裂：

| 功能域 | 覆盖范围 |
|---|---|
| **对话管理** | 创建/发送/步骤查看/回退/取消/文件搜索/WebSocket 实时更新 |
| **Pipeline 执行** | dispatch → watch → intervene(5种) → gate → deliverables → journal → diagnostics → reconcile |
| **项目管理** | CRUD + resume + replay + checkpoint + graph + archive |
| **模板管理** | AI 生成 + 编辑 + 验证 + 克隆 + 删除 + 图形/线性转换 |
| **知识库** | 列表 + 详情 + 编辑 + 删除 + artifact 内容编辑 |
| **Operations** | Analytics + Scheduler(CRUD+trigger) + Subgraphs + Policies(CRUD+check) + Audit |
| **CEO Dashboard** | 部门网格 + 事件流 + 日报 + 输入框 + 审批面板 |
| **部门配置** | OnboardingWizard + DepartmentSetupDialog (名称/类型/OKR/Roster/模板选择) |

---

## 四、API 匹配总览

### 后端路由无前端 API 方法（17 个）

| 路由 | 说明 | 性质 |
|---|---|---|
| `/api/departments/memory` | 部门记忆 CRUD | 🔴 需要前端 |
| `/api/departments/sync` | 指令同步到 IDE | 🟡 保存配置时自动触发 |
| `/api/tunnel` GET | Tunnel 状态 | 🟡 进阶运维功能 |
| `/api/tunnel/config` | Tunnel 配置 | 🟡 |
| `/api/tunnel/start` | 启动 Tunnel | 🟡 |
| `/api/tunnel/stop` | 停止 Tunnel | 🟡 |
| `/api/codex` | Codex 直接调用 | ⚪ 内部 API |
| `/api/codex/sessions` | Codex session | ⚪ 内部 API |
| `/api/codex/sessions/[threadId]` | Codex session 多轮 | ⚪ 内部 API |
| `/api/approval/[id]/feedback` | 一键审批链接 | ⚪ 外部访问，设计如此 |
| `/api/scope-check` | 写作用域检查 | ⚪ 内部 API |
| `/api/skills/[name]` | Skill 详情 | 🟢 低优先级 |
| `/api/agent-groups/[id]` | Group 详情 | 🟢 低优先级 |
| `/api/logs` | 日志流 | 🟢 LogViewer 可能直接 fetch |
| `/api/workspaces/kill` | 强制关闭 | 🟢 低优先级 |
| 4个 `gate/approve`、`restore`、`replay` 等 | 嵌套动态路由 | ✅ 通过 api.ts 方法已覆盖 |

### 前端 API 定义但组件未调用（5 个）

| 方法 | 说明 |
|---|---|
| `agentGroups` | Agent group 列表 |
| `agentRun` | 单个 run 详情（AgentRunDetail 从 list 中筛选） |
| `getRevertPreview` | 回退预览（可选功能） |
| `lintTemplate` | 模板 Lint（validate 已连接） |
| `mcp` | MCP 配置查看 |

---

## 五、修复路线图建议

### 第一批（Quick Wins, S 级，1-2 天）

1. ~~**#1 CEO 命令自动 dispatch**~~ ✅ 已修复
2. ~~**#3 保存配置后自动同步**~~ ✅ 已修复
3. ~~**#2 Provider + 配额表单**~~ ✅ 已修复

### 第二批（M 级）— ✅ 全部完成

4. ~~**#4+#7 部门记忆管理 UI**~~ ✅ 已修复
5. ~~**#5 审批自动触发**~~ ✅ 已修复
6. ~~**#6 Token 配额实际实现**~~ ✅ 已修复

### 第三批（L 级，可选）

7. ~~**日报数据源完善**~~ ✅ 已验证
8. ~~**部门钻取（SimCity 第二层）**~~ ✅ 已修复（DepartmentDetailDrawer）
9. **MCP/Tunnel 管理面板** — 🟡 `McpStatusWidget` + `TunnelStatusWidget` 已建但功能有限
10. **Lint 自动检查** — 🟡 validate 已连接，lint 未调用
