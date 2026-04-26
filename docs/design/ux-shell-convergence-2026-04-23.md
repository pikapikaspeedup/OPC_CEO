# UX Shell Convergence

日期：2026-04-23

## 目标

把当前前端从“过渡态壳层”收口到更稳定的最终态信息架构：

- 移除 `Home` 作为一级主页面
- 默认落点切到 `CEO Office`
- 保留 `Projects / Knowledge / Ops / Settings` 作为一级工作面
- `Chats` 继续保留线程工作态能力，但不再与主页面叙事竞争

## 最终态一级页面

1. `CEO Office`
   - 默认首页
   - 负责公司态势、指令下发、决策处理、例行节奏
2. `Projects`
   - 公司执行工作面
   - 负责项目树、执行链路、阻塞与推进
3. `Knowledge`
   - 知识工作面
   - 负责沉淀、检索、阅读、编辑、引用
4. `Ops`
   - 系统运行与资产控制面
   - 负责 scheduler、runtime health、quota、tunnel、assets
5. `Settings`
   - 配置中心
   - 负责 profile、provider、API keys、scene、MCP、messaging

## 非一级页面

- `Chats`
  - 保留为线程工作态
  - 从 `CEO Office`、`Projects`、工作区上下文进入
  - 不再承担“默认首页”或“产品主叙事”职责

## 第一阶段实现范围

本阶段只处理壳层收口，不做大规模页面内部重写：

- URL 默认 section 从 `overview` 切到 `ceo`
- 类型与导航去掉 `overview`
- Header / 主导航 / caption 文案同步收口
- Settings 保持 utility panel 入口
- 线程工作态仍保留现有 `conversations` section，但在导航叙事里降权

## 暂不在本阶段处理

- `CEO Office` 内部右栏的重新编排
- `Projects` 工作台深层布局重构
- `Knowledge / Ops / Settings` 页面内部视觉细化
- `conversations` route 与 sidebar 的彻底重定位

## 第二阶段实现范围

第二阶段把“没有 Home 的五个主页面”收口成统一页面承载，但不删除原业务组件和操作入口。

已落地：

- 新增统一 `WorkspaceHero` 与 `WorkspaceMetricCard`
- `CEO Office` 增加 executive cockpit hero
- `CEO Office` 继续保留：
  - CEO 对话
  - ChatInput
  - 仪表盘
  - 模板
  - 项目摘要
  - Persona / Playbook Prompt 资产编辑
- `OPC` 增加页面 Hero 和指标带
- `OPC` 继续保留：
  - 项目创建 / 编辑 / 删除 / 归档
  - 项目派发
  - pipeline / template 校验
  - run 恢复 / 取消
  - 部门设置回流入口
- `Knowledge` 增加页面 Hero 和指标带
- `Knowledge` 继续保留：
  - 知识条目预览
  - artifact 编辑
  - metadata 保存
  - 删除
  - Department Memory 面板
- `Ops` 增加页面 Hero 和指标带
- `Ops` 继续保留：
  - Scheduler
  - Analytics
  - Token quota
  - MCP status
  - Tunnel
  - Codex
  - Assets manager
  - 第三方 Provider / API Keys 入口
- `Settings` 增加页面 Hero 和指标带
- `Settings` 继续保留：
  - CEO Profile
  - Provider
  - API Keys
  - Scene overrides
  - MCP
  - Messaging

## 第二阶段不做的事

- 不迁移业务数据
- 不删除已有 API
- 不删除原有 panels
- 不把 `Chats / conversations` 彻底移除，只继续保持为线程工作态
- 不改 Antigravity 原生 IDE 的 Language Server / workspace runtime 启动逻辑

## 第三阶段实现范围

第三阶段开始处理页面内部深层视觉，并先把重复前端样式解耦为公共组件，避免每个页面复制一套 Apple-style glass class。

公共组件位置：

- `src/components/ui/workspace-primitives.tsx`

公共组件职责：

- `WorkspaceSurface`
  - 通用玻璃态卡片容器
  - 统一圆角、边框、背景、内阴影和 blur
- `WorkspaceInteractiveSurface`
  - 可点击卡片 / 列表容器
  - 统一 hover、active、键盘触发
- `WorkspaceMiniMetric`
  - 页面内部小指标卡
  - 用于项目详情、scheduler 时间、CEO dashboard KPI
- `WorkspaceListItem`
  - 通用列表项
  - 用于知识条目、scheduler job、风险项、项目摘要
- `WorkspaceTabsList`
  - 通用 TabsList
  - 支持 `pill` 和 `underline` 两种主视觉
- `WorkspaceTabsTrigger`
  - 通用 TabsTrigger
  - 与 `WorkspaceTabsList` 配套
- `WorkspaceEditorFrame`
  - 通用 prompt / code / long text 编辑器外框

已开始替换的页面内部：

- `CEO Office`
  - `CeoOfficeSettings` 主 tab
  - project summary mini metrics
  - active / failed / paused project list
  - Prompt 资产编辑器外框
  - `CEODashboard` KPI、风险卡、routine、evolution 容器、部门卡、scheduler 摘要
- `OPC`
  - project detail metrics
  - department context 外层卡片
  - empty state
  - CEO decision card
  - CEO command / AI reasoning sub-card
- `Knowledge`
  - overview list cards
  - knowledge list item
- `Ops`
  - scheduler empty state
  - scheduler job card
  - next / last run mini metrics
  - expanded scheduler run list
- `Settings`
  - settings panel 外层 surface
  - settings 主 tabs
  - settings 内部 `Card` 基座

第三阶段继续约束：

- 只替换 UI 承载组件，不迁移业务状态
- 不删除 panels
- 不删除 API
- 不改变 Scheduler / Runtime / Language Server 的启动和执行逻辑
- 不把页面内部所有操作一次性重写，优先复用公共 primitives 分批收敛

## 第四阶段实现范围

第四阶段处理“为什么看起来完全不像参考图”的根因：不是组件数量不够，而是壳层主题方向走错了。

根因：

- 参考图本体是浅色 Apple enterprise dashboard
- 实际实现沿用了旧的深色 Antigravity shell
- 所以即使已经抽了公共组件，也只是在深色体系里做精修，视觉方向天然偏离

已落地：

- `src/app/layout.tsx`
  - 去掉强制 `.dark`
  - `themeColor` 改为浅色壳层
- `src/app/globals.css`
  - `app` / `agent` token 切到浅色 Apple-style enterprise dashboard 体系
  - `agent-stage / app-shell-stage / app-pane / chat-stage-panel / chat-composer-frame` 改为浅色背景
  - 新增 `.apple-reference-shell` 覆盖层，统一把旧的深色文本/边框/卡片 class 拉回浅色参考图语义
- `src/components/ui/app-shell.tsx`
  - AppShell 根节点增加 `apple-reference-shell`
  - StatusChip / WorkspaceMetricCard 调整到浅色语义
- `src/components/ui/workspace-primitives.tsx`
  - Surface / InteractiveSurface / MiniMetric / ListItem / Tabs / EditorFrame 全部切到浅色 Apple-style 语义
- `src/app/page.tsx`
  - 顶部 header 改成浅色导航条
  - CEO Office 主工作面写死的深色 panel 渐变改成浅色
  - mobile menu 改成浅色弹层
- `src/components/sidebar.tsx`
  - 左侧壳层改成浅色侧栏
  - rail item / profile / current project / launcher card 调整到浅色语义

第四阶段结果：

- 当前实现已经不再是深色 Antigravity 壳层
- 整体观感已经回到参考图的大方向：
  - 白底浅灰
  - 蓝色强调
  - 轻玻璃态卡片
  - 浅色导航与侧栏

第四阶段仍未完成的差距：

- `CEO Office` 仍然是 chat-first 结构，不是参考图中的 dashboard-first 结构
- 左侧仍然保留大量线程历史，不是参考图中的纯一级导航侧栏
- `Projects / Ops / Settings / Knowledge` 的页面内部排布还没有做到参考图级别的 1:1 结构对齐

## 第五阶段实现范围

第五阶段开始动真正的信息架构，不再只做壳层和 token：

- `CEO Office` 从 `chat-first` 改成 `dashboard-first`
- CEO 侧栏不再承载线程历史，回到“导航 + 快速跳转”职责
- `CeoOfficeSettings` 从“右侧重复 dashboard”改成真正的 `Control Center`
- CEO 线程历史迁回 `CEO Office` 右侧控制面，保留快速切换，但不再占据一级侧栏

已落地：

- `src/app/page.tsx`
  - `CEO Office` 改为 `WorkspaceHero + Command Center + Company Cockpit + Recent Threads + Control Center`
  - 命令线程缩成命令卡片，保留 `Chat / ChatInput / revert / proceed / cancel / model / workflow / skill` 等原能力
  - 新增页面内 `ceoHistory` 轮询，只拉 CEO 工作区最近线程，不再依赖侧栏加载全部会话
  - `currentViewTitle` 对 `CEO Office` 固定为页面名，不再被单条线程标题劫持
- `src/components/sidebar.tsx`
  - CEO 侧栏历史列表删除
  - 改为 `Cockpit mode` 摘要卡 + `打开线程工作台 / 查看 OPC / 打开 Ops` 三个快速跳转
- `src/lib/home-shell.ts`
  - CEO 侧栏不再请求 conversations 数据
  - CEO 侧栏轮询周期降低到 `20s`
- `src/components/ceo-office-settings.tsx`
  - 删除重复的 dashboard tab
  - 重排为 `项目摘要 / 模板 / Prompt 资产`
  - 头部语义改成 `Control Center`
  - 顶部补充控制 posture 与快捷入口

第五阶段结果：

- `CEO Office` 已经不再是“聊天页加一个右栏”
- 左侧 CEO 侧栏已经回到一级导航应有的职责
- 线程历史保留了，但位置从侧栏迁回主工作面右侧
- `Control Center` 和 `Company Cockpit` 的职责开始分离

第五阶段仍未完成的差距：

- `Projects / Knowledge / Ops / Settings` 还没有按参考图逐页做结构级 1:1 收口
- `CEODashboard` 内部仍有部分历史深色 class 和高密度区块，后续还需要继续去遗留
- `TemplateBrowser` 等深层子面板还没有统一做到完整 Apple-style 视觉

第五阶段验证时额外观察到的既有问题：

- 隔离预览使用 `AG_ROLE=web tsx server.ts` 时，日志仍会出现 `Scheduler` refresh、`RunRegistry` load、`ProjectRegistry` persist 等后台初始化噪音
- 这说明 `web` 入口与后台恢复逻辑仍未彻底隔离
- 该问题本轮只做了再次确认，没有在 UX Phase 5 中处理

## 第六阶段实现范围

第六阶段继续把剩余主页面往参考图方向收口，并顺手处理 Phase 5 验证暴露的 web 角色副作用问题。

主页面结构已落地：

- `OPC`
  - 原 `ProjectsPanel` 保留为主工作台
  - 右侧新增 `Execution queue`
  - 右侧新增 `Control shortcuts`
  - 部门未配置提示改成浅色 Apple-style banner
- `Knowledge`
  - 主区保留 `KnowledgeWorkspace`
  - 右侧新增 `Memory posture`
  - `DepartmentMemoryPanel` 下沉到右侧状态轨
  - 保留知识预览、编辑、删除、artifact 管理能力
- `Ops`
  - 主区保留 `SchedulerPanel + AnalyticsDashboard`
  - 右侧新增 `Runtime stack`
  - `TokenQuota / MCP / Tunnel / Codex` 收进右侧运行状态轨
  - `AssetsManager` 保留为全宽资产工作面
- `Settings`
  - 左侧新增 `Configuration index`
  - 左侧新增 `Readiness`
  - 右侧保留原 `SettingsPanel` 全部 tab
  - Settings 外层容器和通用标题/字段/Provider 下拉从深色残留切回浅色语义

web 角色隔离已落地：

- `src/proxy.ts`
  - `AG_ROLE=web` 且缺少 `AG_CONTROL_PLANE_URL` 或 `AG_RUNTIME_URL` 时，直接阻断 `/api/*`
  - 避免 web-only 进程里的 Next route handler 直接初始化 scheduler / project registry
- `server.ts`
  - web-only cleanup 不再无条件 import scheduler worker
- `src/lib/gateway-role.ts`
  - 新增 `hasCompleteWebApiBackend()`
  - 新增 `shouldBlockUnconfiguredWebApi()`

第六阶段结果：

- 五个一级主页面已经形成更一致的 Apple-style 工作台结构
- `OPC / Knowledge / Ops / Settings` 不再只是“Hero 下方堆旧组件”
- `web` 角色在缺少后端 URL 时不会再通过 `/api/projects`、`/api/scheduler/jobs` 触发本地控制面副作用

第六阶段仍需后续继续精修的差距：

- `ProjectsPanel / SettingsPanel / SchedulerPanel` 深层内部还有部分历史 `text-white/*`、`bg-white/*` 类，当前由浅色 token 覆盖和局部替换兜住，后续可以继续按组件逐步清扫
- `WS` ingress 仍会在订阅 Antigravity conversation 时连接本机 Language Server；这是当前 web ingress 设计，不属于 scheduler/project registry 后台 worker 问题

## 第七阶段实现范围

第七阶段处理 Phase 6 暴露的“壳层已浅色，但深层旧组件仍混有暗色 utility”的视觉断裂。

已落地：

- `src/app/globals.css`
  - 扩展 `.apple-reference-shell` 兼容层
  - 覆盖更多旧版 `text-white/*`、`bg-white/*`、`border-white/*` 深色 utility
  - 对 `bg-[var(--app-accent)] / bg-sky-500 / bg-red-500 / bg-emerald-500 / bg-amber-500` 主按钮恢复白字，避免兼容层误伤行动按钮
- `src/components/settings-panel.tsx`
  - 第三方 Provider onboarding 主卡片从旧深色渐变改为浅色 Apple-style 渐变
- `src/components/scheduler-panel.tsx`
  - Scheduler 新建/编辑任务弹窗 label 与 hint 改为 `--app-*` 浅色语义，避免 portal 场景逃出 `.apple-reference-shell` 作用域
- `src/components/projects-panel.tsx`
  - 循环任务入口、空态、详情返回、详情 header 等显性暗色断点改为浅色语义
- `src/components/knowledge-panel.tsx`
  - 删除按钮从旧深色红字改为浅色可读红色语义
- `src/app/page.tsx`
  - Ops 主行动按钮统一恢复蓝底白字

第七阶段结果：

- 主页面不再只依赖壳层浅色化；深层卡片、列表、表单、弹窗的显性暗色断点已继续收口
- 新增结构继续复用 `WorkspaceSurface / WorkspaceMiniMetric / WorkspaceListItem` 等公共 primitives
- 保留原业务组件和操作能力，没有删除项目、知识、调度、资产、Provider、API Key、MCP 等入口

第七阶段验证：

- `npx eslint` 通过 TS/TSX 检查
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts src/lib/gateway-role.test.ts` 通过，`20 tests passed`
- `npm run build` 通过
- `bb-browser` 点击验证 `OPC / Knowledge / Ops / Settings` 主页面关键结构
- `bb-browser errors` 返回无 JS 错误
- `AG_ROLE=web` 预览下 `/api/projects`、`/api/scheduler/jobs` 均返回 503，未触发 scheduler/project registry 后台初始化日志
- 预览服务已回收，端口 `3321` 已释放

## 第八阶段实现范围

第八阶段继续处理“页面框架已经收口，但深层卡片、表格、列表、tab 还没有彻底统一”的问题。

已落地：

- `src/components/ui/workspace-primitives.tsx`
  - 新增 `WorkspaceBadge`
  - 新增 `WorkspaceEmptyBlock`
  - 新增 `workspaceFieldClassName`
  - 新增 `workspaceOutlineActionClassName`
  - 深层表单、徽标、空态和 outline action 可以复用同一套浅色 Apple-style 语义
- `src/components/settings-panel.tsx`
  - Provider 默认配置、layer 配置、API Keys、本地登录态、Scenes、MCP server 管理全部从旧深色 utility 改为 `--app-*` token 或公共 field/action primitive
  - 仅保留主行动按钮的蓝底白字，不再把白字当作暗色壳层残留
- `src/components/projects-panel.tsx`
  - 项目详情、最近执行、CEO 决策建议、分支 tab、待派发状态、手动派发区、创建/编辑/派发弹窗表单全部切到浅色语义
  - `ProjectsPanel` 已不再命中 `text-white / bg-white / border-white / text-slate / bg-slate / dark:` 旧关键字
- `src/components/sidebar.tsx`
  - 会话、项目、知识、Ops asset、workspace 列表里的 badge、空态、hover 和 workspace row 改为浅色 token
- `src/components/ui/app-shell.tsx`
  - tab hover 不再使用旧 `bg-white/[...]` 兜底
- `src/lib/agents/run-registry.ts`
  - 删除导致 Turbopack broad pattern warning 的动态 `path.join(dynamic, dynamic, dynamic)` 文件模式
  - 改为受控 artifact path 拼接，并通过 `process.getBuiltinModule('fs')` 走 Node runtime fs 访问
  - 清掉本文件动态 `require`，避免 Next route bundle 做过宽依赖扫描
- `src/lib/agents/project-registry.ts`
  - 清掉 `require('fs')` 与 `require('./run-registry')`
  - 补齐 touched path 的 unknown error handling 和 deep merge 类型
- `src/lib/agents/project-events.ts`
  - 清掉 `require('./ops-audit')`
- `src/lib/agents/run-registry.test.ts`
  - 补齐静态化 import 后需要的 gateway-home mock 字段

第八阶段结果：

- 深层视觉不再主要依赖 `.apple-reference-shell` 兼容层兜底，Settings / OPC / Sidebar 已经进入公共 primitive + token 的可维护状态
- `ceo-dashboard.tsx` 已无旧深色关键字命中
- 当前扫描只剩主行动按钮的 `text-white` 命中：
  - `settings-panel.tsx`: 5
  - `app/page.tsx`: 5
  - `ceo-office-settings.tsx`: 2
  - `sidebar.tsx`: 1
- `run-registry.ts` 的 Turbopack broad pattern warning 已消除

第八阶段验证：

- `npx eslint src/app/page.tsx src/components/settings-panel.tsx src/components/projects-panel.tsx src/components/sidebar.tsx src/components/ceo-dashboard.tsx src/components/ceo-office-settings.tsx src/components/ui/app-shell.tsx src/components/ui/workspace-primitives.tsx src/lib/agents/run-registry.ts src/lib/agents/run-registry.test.ts src/lib/agents/project-registry.ts src/lib/agents/project-events.ts` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts src/lib/gateway-role.test.ts src/lib/agents/run-registry.test.ts src/lib/agents/scheduler.test.ts src/lib/storage/gateway-db.test.ts` 通过，`42 tests passed`
- `npm run build` 通过，且没有 `run-registry.ts` Turbopack broad pattern warning
- `AG_ROLE=web` 单服务预览验证：
  - `/` 返回 `200`
  - `/api/projects` 返回 `503`
  - `/api/scheduler/jobs` 返回 `503`
  - `bb-browser errors` 返回无 JS 错误
- `bb-browser` 页面验证并截图：
  - `/tmp/opc-ceo-main-phase8-ceo-2026-04-23.png`
  - `/tmp/opc-ceo-main-phase8-opc-2026-04-23.png`
  - `/tmp/opc-ceo-main-phase8-knowledge-2026-04-23.png`
  - `/tmp/opc-ceo-main-phase8-ops-2026-04-23.png`
  - `/tmp/opc-ceo-main-phase8-settings-provider-2026-04-23.png`
- 预览完成后已停止 `bb-browser daemon`，端口 `3321` 已释放，`demolong/projects` 无污染

## Phase 9：Settings web-only 降级与 Approval 推送链路

第九阶段只处理“独立要独立”的收尾问题，不再扩散页面结构：

- `SettingsPanel` 在 `AG_ROLE=web` 且未配置 `AG_CONTROL_PLANE_URL` / `AG_RUNTIME_URL` 时，不再显示笼统的“无法加载 AI 配置”，而是显示明确的 Control Plane / Runtime 连接要求。
- web-only 模式下的配置 API 仍由 `src/proxy.ts` 阻断，Settings 前端只做只读降级，不穿透到本地 route handler，也不触发 scheduler / registry 副作用。
- Approval 新增独立 Web notification event bus 和 `/api/approval/events` SSE 流；Web UI 只订阅事件并刷新待审批列表，不把审批通知逻辑塞回页面组件。
- Webhook / IM 通道统一使用 signed feedback URL；Webhook 通道现在执行真实 POST，未配置 endpoint 时不会产生失败 delivery。
- Approval 创建后会持久化 notification delivery 结果，方便后续在 UI 或审计中解释“是否已推送”。

第九阶段验证：

- `npx eslint src/lib/types.ts src/lib/api.ts src/lib/api-response.ts src/components/settings-panel.tsx src/lib/approval/tokens.ts src/lib/approval/approval-urls.ts src/lib/approval/notification-events.ts src/lib/approval/channels/web.ts src/lib/approval/channels/im.ts src/lib/approval/channels/webhook.ts src/lib/approval/channels/index.ts src/lib/approval/dispatcher.ts src/lib/approval/handler.ts src/lib/approval/request-store.ts src/lib/approval/index.ts src/lib/approval/__tests__/notification-events.test.ts src/app/page.tsx src/app/api/approval/events/route.ts src/server/control-plane/routes/approval-events.ts src/server/control-plane/server.ts` 通过
- `npx vitest run src/lib/approval/__tests__/notification-events.test.ts src/lib/approval/__tests__/handler.test.ts src/lib/approval/__tests__/request-store.test.ts src/lib/gateway-role.test.ts src/lib/home-shell.test.ts` 通过，`19 tests passed`
- `npm run build` 通过，`/api/approval/events` 已进入 Next route table
- `AG_ROLE=web` 单服务验证：`/api/ai-config` 返回 `503`，Settings 页面显示“Settings 需要连接 Control Plane / Runtime”，`bb-browser errors` 无 JS 错误
- all-in-one 临时 HOME 验证：创建审批后 SSE 回放 `approval_request`，PATCH 审批后 SSE 回放 `approval_response`，notification delivery 持久化为 `web success=true`
- 预览/验证完成后已停止服务与 `bb-browser daemon`，端口 `3321` 已释放

## Phase 10：新 UI 深层视觉收尾

第十阶段处理“主页面参考图已落地，但下钻组件仍有旧深色残留”的收尾问题。

已落地：

- `src/components/ui/workspace-primitives.tsx`
  - 新增 `workspaceGhostActionClassName`
  - 新增 `workspaceCodeBlockClassName`
  - 新增 `WorkspaceIconFrame`
  - 新增 `WorkspaceStatusDot`
  - 新增 `WorkspaceSectionHeader`
- Ops 深层组件
  - `McpStatusWidget / CodexWidget / TunnelStatusWidget / AssetsManager` 改为 `WorkspaceSurface / WorkspaceBadge / WorkspaceEmptyBlock / workspaceFieldClassName` 等公共 primitive
  - 资产列表、发现结果、编辑器、代码预览、MCP/Tunnel/Codex 状态块统一成浅色 Apple-style token
- OPC / CEO 深层组件
  - `ProjectOpsPanel` 从旧暗色卡片迁移到 `WorkspaceSurface`，覆盖 health、stage、branch、reconcile、policy、journal、checkpoint、audit
  - `Chat` 的 planner/notify/empty state 改为浅色气泡与浅色空态，工具组不再使用暗底
  - `CEOSchedulerCommandCard` 改为浅色渐变、浅色 preset、浅色结果卡，并移除 Prompt Run / Ad-hoc Project emoji
  - `CEODashboard / DepartmentComparisonWidget / DepartmentMemoryPanel / DepartmentDetailDrawer` 移除显性 emoji 标题，改用 lucide 图标
- Settings / 弹窗 / Portal
  - `CEOProfileSettingsTab` 从旧深色 profile 卡片改为浅色 token 和公共 field/action class
  - `NotificationIndicators` 的 body portal drawer 改为浅色抽屉，避免逃出 `.apple-reference-shell` 后出现暗色面板
  - `DepartmentDetailDrawer` 的 body portal dialog 改为浅色语义，OKR、经营指标、风险、Token、项目列表、日报、完成项都改为图标标题和浅色卡片
  - `TemplateBrowser` 的 clone/delete/add node/add edge portal dialog 标题、边框、辅助文字、选项 pill 改为浅色语义

第十阶段结果：

- CEO / OPC / Ops / Settings 的主工作面、核心下钻弹窗、运行抽屉和资产面板已经从“参考图外壳”推进到“深层组件可读且一致”的状态
- 仍保留 `.apple-reference-shell` 作为旧组件过渡兼容层，但本轮已把最明显、最高风险的 portal 和暗色渐变组件改成直接 token 化
- 没有删除原功能入口：CEO 指令、线程、项目、部门、调度、资产、MCP、Tunnel、Codex、Provider、API Keys、模板、审批仍保留

第十阶段验证：

- `npx eslint src/components/ui/workspace-primitives.tsx src/components/mcp-status-widget.tsx src/components/codex-widget.tsx src/components/tunnel-status-widget.tsx src/components/assets-manager.tsx src/components/project-ops-panel.tsx src/components/chat.tsx src/components/ceo-profile-settings-tab.tsx src/components/department-comparison-widget.tsx src/components/department-memory-panel.tsx src/components/ceo-dashboard.tsx src/components/ceo-scheduler-command-card.tsx src/components/notification-indicators.tsx src/components/department-detail-drawer.tsx src/components/template-browser.tsx` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts src/lib/gateway-role.test.ts` 通过，`20 tests passed`
- `npm run build` 通过
- 复用现有 `localhost:3000`，没有启动第二套 dev/start/watch 服务
- `bb-browser` 验证：
  - CEO 首页可打开，`darkClassCount=6`
  - Ops 可打开，`darkClassCount=5`
  - Settings web-only 降级页可打开，`darkClassCount=1`
  - OPC 可打开，`darkClassCount=1`
  - `bb-browser errors` 返回无 JS 错误
- 截图：
  - `/tmp/opc-ui-finish-ceo-2026-04-24.png`
  - `/tmp/opc-ui-finish-ops-2026-04-24.png`
  - `/tmp/opc-ui-finish-settings-2026-04-24.png`
  - `/tmp/opc-ui-finish-projects-2026-04-24.png`

## Phase 11：默认本地启动 API 恢复

本阶段修复“视觉改造后页面没有数据”的直接原因：默认 `npm run dev` / `npm run start` 被配置成 `AG_ROLE=web`，但没有配置 `AG_CONTROL_PLANE_URL` 和 `AG_RUNTIME_URL`。在当前架构里，裸 `web` 角色会由 `src/proxy.ts` 阻断 `/api/*` 并返回 503，因此页面会表现为无数据。

已调整：

- `package.json`
  - `npm run dev` 改为 `AG_ROLE=all AG_ENABLE_SCHEDULER=0 AG_DISABLE_BRIDGE_WORKER=1`
  - `npm run start` 改为同样的本地一体化安全模式
  - `dev:split:web` / `start:split:web` 保留，继续用于显式 split 部署
- `README.md` / `README_EN.md`
  - 明确默认本地启动是单进程 Web + API 数据可用
  - 明确裸 `AG_ROLE=web` 是 split ingress，不是默认开发方式
- `ARCHITECTURE.md`
  - 补充本地默认模式和 web-only 保护边界

验证结果：

- `npx eslint src/lib/gateway-role.ts src/proxy.ts src/app/page.tsx src/components/ui/workspace-primitives.tsx src/components/analytics-dashboard.tsx src/components/token-quota-widget.tsx src/components/platform-manager.tsx` 通过
- `npx vitest run src/lib/gateway-role.test.ts src/lib/home-shell.test.ts src/lib/app-url-state.test.ts` 通过，`20 tests passed`
- `npm run build` 通过
- 临时 `PORT=3001 AG_ROLE=all AG_ENABLE_SCHEDULER=0 AG_DISABLE_BRIDGE_WORKER=1` 服务验证：
  - `/api/projects?page=1&pageSize=5` 返回 `200`，`total=163`
  - `/api/agent-runs?page=1&pageSize=5` 返回 `200`，`total=4762`
  - `/api/workspaces?page=1&pageSize=5` 返回 `200`，`workspaces=26`
  - `/api/ai-config` 返回 `200`
- 现有 `localhost:3000` 验证：
  - `/api/projects?page=1&pageSize=1` 返回 `200`
  - `/api/agent-runs?page=1&pageSize=1` 返回 `200`
  - `/api/workspaces?page=1&pageSize=1` 返回 `200`
- `bb-browser` 页面态验证：
  - 页面内 fetch `/api/projects`、`/api/agent-runs`、`/api/workspaces` 均返回 `200`
  - 页面没有出现 `AG_ROLE=web` / `503` API 错误文案
- 临时 3001 服务已回收，`bb-browser daemon` 已停止，端口 `3001` 已释放；现有 `3000` 保持运行。

## Phase 12：同设备前后端两服务收敛

本阶段把部署口径从“多角色 split”收敛成用户可理解的同设备两服务：

- `opc-web`：前端服务，默认端口 `3000`
- `opc-api`：后端服务，默认端口 `3101`

已落地：

- 新增 `AG_ROLE=api`
  - 组合 control-plane routes 和 runtime routes
  - `/health` 返回 `{ ok: true, role: "api" }`
  - 默认不启动 scheduler，不启动 bridge worker
  - `AG_ENABLE_SCHEDULER=1` / `AG_ENABLE_IMPORTERS=1` 仍可作为内部高级开关
- 新增 `src/server/api/server.ts`
  - 同一后端端口承载项目、审批、部门、设置、runs、conversations、models、workspaces 等 HTTP API
- `package.json`
  - `npm run dev` 改为同时启动 `dev:api` 和 `dev:web`
  - `npm run dev:api`：`PORT=3101 AG_ROLE=api`
  - `npm run dev:web`：`PORT=3000 AG_ROLE=web`，control-plane/runtime URL 均指向 `http://127.0.0.1:3101`
  - `npm run start` / `start:api` / `start:web` 同步收敛
  - 不再把 `control-plane/runtime/scheduler` 作为默认 npm scripts 暴露
- `scripts/run-local-services.mjs`
  - 同时拉起 `opc-api + opc-web`
  - 转发 `SIGINT / SIGTERM`
  - 任一子服务退出时主动回收另一侧服务，避免半边残留
- `server.ts`
  - 支持 `api` 后端组合角色
- `README.md` / `README_EN.md` / `ARCHITECTURE.md`
  - 改为同设备 `opc-web + opc-api` 部署说明
  - 明确 Docker 不是默认推荐路径，因为本项目和宿主机 Antigravity IDE、Language Server、workspace、`~/.gemini` 耦合较深

验证结果：

- `npx eslint server.ts src/lib/gateway-role.ts src/lib/gateway-role.test.ts src/server/control-plane/server.ts src/server/runtime/server.ts src/server/api/server.ts scripts/run-local-services.mjs` 通过
- `npx vitest run src/lib/gateway-role.test.ts` 通过，`7 tests passed`
- `npx vitest run src/lib/gateway-role.test.ts src/lib/home-shell.test.ts src/lib/app-url-state.test.ts` 通过，`20 tests passed`
- `npm run build` 通过
- 临时 `PORT=3101 AG_ROLE=api AG_ENABLE_SCHEDULER=0 AG_DISABLE_BRIDGE_WORKER=1` 服务验证：
  - `/health` 返回 `200`
  - `/api/projects?page=1&pageSize=1` 返回 `200`
  - `/api/agent-runs?page=1&pageSize=1` 返回 `200`
  - `/api/workspaces?page=1&pageSize=1` 返回 `200`
  - `/api/models` 返回 `200`
- 临时 `PORT=3002 AG_ROLE=web AG_CONTROL_PLANE_URL=http://127.0.0.1:3101 AG_RUNTIME_URL=http://127.0.0.1:3101` 服务验证：
  - `/api/projects?page=1&pageSize=1` 经 web 代理返回 `200`
  - `/api/agent-runs?page=1&pageSize=1` 经 web 代理返回 `200`
  - `/api/models` 经 web 代理返回 `200`
  - `/api/ai-config` 经 web 代理返回 `200`
- 临时 `3101` / `3002` 服务均已停止，端口已释放。

## 设计参考

苹果风主页面参考稿位于：

- [apple-reference-pages-2026-04-23.md](./apple-reference-pages-2026-04-23.md)

## Phase 13：主页面信息架构去重

本阶段基于 `docs/research/frontend-ui-redundancy-audit-2026-04-25.md` 收口主页面 ownership：

- Header 只保留当前页面身份和主导航，不再渲染 `currentViewCaption`。
- Sidebar 降级为导航与 Conversations 线程入口，不再承载 OPC project tree、Knowledge entries、Ops assets/workspaces、CEO cockpit 等业务列表。
- CEO Office 只保留一个主创建入口，空态和输入区 fallback 不再重复放 `创建 CEO 对话 / Profile 偏好 / 查看历史线程`。
- CEO Dashboard 不再直接轮询 Scheduler，也不再嵌入第二个 CEO 指令中心；Scheduler 完整管理归 Ops。
- ProjectsPanel 不再直接轮询 Scheduler，也不显示循环任务摘要。
- Settings 中第三方连接信息、运行 Provider、高级覆盖、Scene 覆盖分层展示；Provider 诊断矩阵默认折叠。
- API Key 卡片抽为通用 `ApiKeyCard`，避免 Anthropic / OpenAI / Gemini / Grok 四套重复 JSX。
- Ops 资产管理将 `Canonical / Discovered` 改成 `可执行资产 / 发现待导入`。
- CEO Profile 页删除 Journey/设计解释类长文案，保留字段和操作反馈。

验证结果：

- `npm run lint -- src/components/ceo-dashboard.tsx src/app/page.tsx src/components/sidebar.tsx src/lib/home-shell.ts src/lib/home-shell.test.ts src/components/projects-panel.tsx src/components/settings-panel.tsx src/lib/providers/provider-availability.ts src/lib/providers/provider-availability.test.ts src/components/ceo-office-settings.tsx src/components/assets-manager.tsx src/components/ceo-profile-settings-tab.tsx` 通过
- `npm test -- src/lib/providers/provider-availability.test.ts src/lib/home-shell.test.ts` 通过，`11 tests passed`
- `npm run build` 通过
