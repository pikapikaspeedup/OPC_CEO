# Frontend UI Redundancy Audit

日期：2026-04-25

范围：主页面壳层、Sidebar、CEO Office、OPC、Knowledge、Ops、Settings，以及相关公共 UI primitives。

性质：研究 / 审计文档。本文不记录已完成实现，不写入 `docs/PROJECT_PROGRESS.md`。

## 结论

当前前端重复不是单点视觉问题，而是信息架构 ownership 失效。

同一类职责被四层同时承担：

1. `AppShell/Header` 在做当前页面身份和说明
2. `Sidebar` 在做导航以外的业务摘要、列表索引和快捷操作
3. `src/app/page.tsx` 在每个主页面上再做 `WorkspaceHero`、指标卡、状态标签和右轨
4. 子组件内部又各自再做标题、指标、tab、列表、动作和数据轮询

结果是用户看到很多“像是不同入口但实际指向同一功能”的界面，开发侧也产生重复数据拉取和重复状态维护。

## 本轮整改 Todos

状态：2026-04-25 已完成并通过 lint、单测、production build 验证。

1. Header / Sidebar 说明文案收口：顶部 Header 不再渲染 `currentViewCaption`，移动端主菜单不再展示每个主入口的说明文案，Sidebar 当前分区只保留标题。
2. Sidebar 降级为纯导航：删除 CEO cockpit、OPC project tree、Knowledge entries、Ops assets/workspaces 的侧栏业务列表；非 Conversations 分区不再拉 Knowledge / Runtime / Ops assets 数据。
3. CEO Office 主入口去重：Hero、空态、输入区 fallback 不再重复出现 `创建 CEO 对话`、`Profile 偏好`、`查看线程工作台`；主创建入口收敛到 Command Center。
4. CEO Dashboard 去 Scheduler 化：删除 CEO Dashboard 内部 `api.schedulerJobs()` / audit 轮询和 Scheduler 列表；删除第二个 `CEOSchedulerCommandCard` 指令入口。
5. ProjectsPanel 去 Scheduler 化：删除项目页对 `api.schedulerJobs()` 的 10s 轮询、循环任务摘要和 Ops deep-link 按钮。
6. Settings Provider 层级收敛：第三方配置改为“第三方连接信息”，生效选择改为“运行 Provider”，Provider 支持矩阵降级为折叠诊断区，高级 layer override 默认折叠。
7. Provider 选择器透明化：Provider 下拉展示 Antigravity、Codex Native、Codex MCP、Claude/OpenAI/Gemini/Grok/Custom 等全部 provider；未配置项禁用但可见。
8. API Key 卡片组件化：抽出 `ApiKeyCard`，Anthropic / OpenAI / Gemini / Grok 复用同一状态、输入、显示/隐藏、测试结果 UI。
9. Ops 资产术语用户化：`Canonical / Discovered` 改为 `可执行资产 / 发现待导入`，资产行不再重复展示内部 source 徽标。
10. Profile 页文案收口：删除 Journey / 结构化设计解释类长文案，只保留字段、状态与必要操作反馈。

## 判断原则

后续整改应按以下原则判断是否重复：

1. 一个页面只能有一个主标题区
2. 一个页面只能有一个主状态摘要区
3. 一个动作只能有一个主入口，其他位置只能做轻量 deep link
4. Sidebar 只能做导航，不承载业务内容索引
5. 页面级组件负责布局，业务组件负责具体工作面，二者不能同时做同一批指标
6. Scheduler、Assets、Approvals、Agent Runs 这类跨页数据必须有统一 summary owner，不能每个组件自己轮询
7. Settings 里“凭证 / Provider 连接 / 默认运行配置 / 场景覆盖”必须分层，不允许用不同卡片反复表达同一配置链路

## 问题 1：全局 Header、页面 Hero、子组件标题重复表达同一页面身份

证据：

1. `src/app/page.tsx:915` 定义 `currentSectionLabel`
2. `src/app/page.tsx:921` 定义 `currentViewTitle`
3. `src/app/page.tsx:1039` 在 Header 渲染当前 section label
4. `src/app/page.tsx:1040` 在 Header 渲染当前 view title
5. `src/app/page.tsx:1132` Settings 再渲染 `WorkspaceHero`
6. `src/app/page.tsx:1156` OPC 再渲染 `WorkspaceHero`
7. `src/app/page.tsx:1306` Knowledge 再渲染 `WorkspaceHero`
8. `src/app/page.tsx:1343` Ops 再渲染 `WorkspaceHero`
9. `src/app/page.tsx:1413` CEO Office 再渲染 `WorkspaceHero`

问题：

Header 已经说明用户当前在哪个主页面，但每个页面顶部又放一个大 Hero。随后子组件内部继续出现自己的 header，例如 Scheduler、Assets、Projects、Settings tabs。用户会连续看到多层“当前页面解释”，信息密度被重复标题吃掉。

影响：

1. 首屏空间被说明性区域占用
2. 用户无法判断哪个标题代表真正的工作面
3. 修改某个页面的视觉时容易在 Header、Hero、子组件 header 之间反复补丁

建议：

1. 保留顶部主导航，但 Header 只显示 app 级导航和必要状态
2. 每个一级页面只保留一个页面标题来源
3. 如果保留 `WorkspaceHero`，Header 不再显示 `currentViewCaption`
4. 子组件嵌入一级页面时默认不再渲染大标题，只保留局部 section title

## 问题 2：Sidebar 已经变成第二套工作台

证据：

1. `src/components/sidebar.tsx:383` 定义每个 section 的 meta
2. `src/components/sidebar.tsx:447` 渲染 section eyebrow / title / description
3. `src/components/sidebar.tsx:531` CEO sidebar 开始渲染 cockpit 内容
4. `src/components/sidebar.tsx:534` CEO sidebar 有 `Cockpit mode`
5. `src/components/sidebar.tsx:552` CEO sidebar 有 `打开线程工作台`
6. `src/components/sidebar.tsx:655` OPC sidebar 有 `Workspace coverage`
7. `src/components/sidebar.tsx:672` OPC sidebar 有 `Project Tree`
8. `src/components/sidebar.tsx:737` Knowledge sidebar 有 `Entries`
9. `src/components/sidebar.tsx:770` Ops sidebar 有 `Automation & control`
10. `src/components/sidebar.tsx:814` Ops sidebar 有 `Assets`
11. `src/components/sidebar.tsx:859` Ops sidebar 有 `Workspaces`

问题：

Sidebar 不是纯导航，而是在每个 section 下再渲染业务状态、业务列表和快捷入口。这样它与页面主体争夺同一批信息 ownership。

影响：

1. OPC 页面有 Sidebar project tree，也有 ProjectsPanel 内部项目列表
2. Knowledge 页面有 Sidebar entries，也有 KnowledgeWorkspace overview/list
3. Ops 页面有 Sidebar assets，也有 AssetsManager
4. CEO 页面有 Sidebar cockpit，也有 CEO 主页面 cockpit
5. Sidebar 自己还会拉业务数据和轮询，放大请求量

建议：

1. Sidebar 收敛为一级导航和轻量二级导航
2. 删除 Sidebar 内业务卡片、业务列表、状态卡
3. 只保留当前 section 的 navigation anchors，例如 `Overview / Projects / Scheduler / Assets`
4. 业务状态和业务列表回归页面主体

## 问题 3：CEO Office 的主动作入口重复

证据：

1. `src/app/page.tsx:1426` Hero actions 有 `创建 CEO 对话`
2. `src/app/page.tsx:1433` Hero actions 有 `查看线程工作台`
3. `src/app/page.tsx:1440` Hero actions 有 `Profile 偏好`
4. `src/app/page.tsx:1467` Command Center 头部又有 `进入线程工作台`
5. `src/app/page.tsx:1503` 空态里再次出现 `创建 CEO 对话`
6. `src/app/page.tsx:1510` 空态里再次出现 `打开 Profile 偏好`
7. `src/app/page.tsx:1546` ChatInput fallback 再次出现 `创建 CEO 对话`
8. `src/app/page.tsx:1650` 右轨有 `Recent threads`
9. `src/app/page.tsx:1658` 右轨又有 `查看全部`
10. `src/components/sidebar.tsx:552` Sidebar 也有 `打开线程工作台`

问题：

同一个用户意图有多个视觉重量接近的入口。用户无法判断哪个是主入口，也容易误以为这些入口背后是不同功能。

影响：

1. CEO Office 首屏显得乱
2. 主路径“下达指令”被多个线程管理按钮稀释
3. 后续埋点和权限控制难以判断哪个入口代表真实用户意图

建议：

1. CEO Office 只保留一个主 CTA：`下达指令` 或 `创建 CEO 对话`
2. `线程工作台` 降级为右上角 secondary link
3. `Profile 偏好` 从 CEO 首屏移走，放到 Settings/Profile 或个人菜单
4. 空态里不重复全局 CTA，只给当前卡片最小必要动作

## 问题 4：CEO Dashboard 过度承载 OPC / Ops / Settings 职责

证据：

1. `src/components/ceo-dashboard.tsx:221` 渲染 Active Projects
2. `src/components/ceo-dashboard.tsx:222` 渲染 Pending Approvals
3. `src/components/ceo-dashboard.tsx:223` 渲染 Active Schedulers
4. `src/components/ceo-dashboard.tsx:224` 渲染 Recent Knowledge
5. `src/components/ceo-dashboard.tsx:297` 渲染 Evolution Pipeline
6. `src/components/ceo-dashboard.tsx:393` 渲染部门区
7. `src/components/ceo-dashboard.tsx:415` 支持 `+ 添加部门`
8. `src/components/ceo-dashboard.tsx:493` 嵌入 `DepartmentComparisonWidget`
9. `src/components/ceo-dashboard.tsx:499` 嵌入 `CEOSchedulerCommandCard`
10. `src/components/ceo-dashboard.tsx:591` 再渲染 Scheduler 区
11. `src/components/ceo-dashboard.tsx:683` 渲染日报 / 周报 / 月报

问题：

CEO Dashboard 同时包含项目状态、部门管理、Scheduler、日报、Evolution、审计等能力。这些能力本身应该属于 OPC、Ops、Knowledge 或 Settings 的下钻页面。CEO Office 应该显示公司态势和决策入口，而不是承载所有工作面的详细功能。

影响：

1. CEO Office 与 OPC/Ops/Knowledge/Settings 功能边界重叠
2. 任何业务模块新增功能时都倾向于再塞进 CEO Dashboard
3. 首页越来越像所有功能的拼盘，用户找不到主任务路径

建议：

1. CEO Dashboard 只保留 executive summary、风险、审批、关键项目、关键任务
2. 部门配置移回 OPC/Settings
3. Scheduler 创建和管理移回 Ops
4. 日报详情移回 Knowledge/Ops，只在 CEO 展示最新摘要
5. Evolution Pipeline 作为独立功能入口，不在 CEO 首屏展开完整列表

## 问题 5：Scheduler UI 和轮询重复

证据：

1. `src/components/ceo-dashboard.tsx:83` CEO Dashboard 调用 `api.schedulerJobs()`
2. `src/components/ceo-dashboard.tsx:104` CEO Dashboard 每 10 秒刷新 scheduler
3. `src/components/projects-panel.tsx:212` ProjectsPanel 调用 `api.schedulerJobs()`
4. `src/components/projects-panel.tsx:265` ProjectsPanel 每 10 秒刷新 scheduler
5. `src/components/scheduler-panel.tsx:183` SchedulerPanel 调用 `api.schedulerJobs()`
6. `src/app/page.tsx:1380` Ops 页面挂载完整 `SchedulerPanel`
7. `src/components/ceo-dashboard.tsx:591` CEO Dashboard 又渲染 Scheduler 区

问题：

Scheduler 被当成跨页小组件到处嵌入，但没有统一 summary 数据源。每个组件自己拉数据、自己轮询、自己渲染不同版本的 Scheduler 摘要。

影响：

1. 同时打开页面时请求噪音增加
2. 任务状态可能在不同区域显示不一致
3. 未来修复 Scheduler 文案、状态、权限时要改多个地方
4. 这类模式会继续放大 CPU 和后台噪音问题

建议：

1. Ops/SchedulerPanel 是唯一完整管理入口
2. 其他页面只能消费 `SchedulerSummary`，不直接调用 `api.schedulerJobs()`
3. Summary 由页面级或全局 query cache 统一刷新
4. CEO/OPC 只显示最多 1 个状态 chip 或 deep link

## 问题 6：OPC 项目导航与状态重复

证据：

1. `src/app/page.tsx:1156` OPC 页面有 Hero
2. `src/app/page.tsx:1186` OPC Hero 显示 Projects 指标
3. `src/app/page.tsx:1187` OPC Hero 显示 Needs attention 指标
4. `src/app/page.tsx:1188` OPC Hero 显示 Departments 指标
5. `src/components/sidebar.tsx:672` Sidebar 有 Project Tree
6. `src/app/page.tsx:1243` 主工作面挂载 `ProjectsPanel`
7. `src/app/page.tsx:1271` 右侧还有 Execution queue
8. `src/components/projects-panel.tsx:1241` ProjectsPanel 自己渲染项目标题
9. `src/components/projects-panel.tsx:691` 项目详情里又渲染结果概览

问题：

OPC 页面同时存在 Hero 指标、Sidebar 项目树、ProjectsPanel 列表/详情、右轨风险列表。它们都围绕 project status 和 project selection，但没有明确哪个是主选择器，哪个是摘要。

影响：

1. 用户在 OPC 内有多个项目选择入口
2. 项目状态在 Hero、Sidebar、列表、右轨重复出现
3. 页面内部空间被重复索引消耗，真正项目详情反而被挤压

建议：

1. OPC 的项目选择器只能有一个，建议放在 ProjectsPanel 内
2. Sidebar 删除 Project Tree
3. 右轨 Execution queue 只保留高优风险，不做通用最近项目列表
4. Hero 指标只保留公司级摘要，不重复 project list 状态

## 问题 7：部门配置入口分散

证据：

1. `src/app/page.tsx:1173` OPC Hero action 有 `部门设置`
2. `src/app/page.tsx:1199` OPC 页面有部门画像未完整提示
3. `src/app/page.tsx:1220` OPC 页面还有部门初始化提示
4. `src/components/ceo-dashboard.tsx:393` CEO Dashboard 有部门区
5. `src/components/ceo-dashboard.tsx:415` CEO Dashboard 支持添加部门
6. `src/components/ceo-dashboard.tsx:453` 部门卡片内还有 `部门设置`
7. `src/components/projects-panel.tsx:759` 项目详情可查看部门上下文
8. `src/components/ceo-profile-settings-tab.tsx:315` Profile 页面示例文案还出现“部门设置解耦”

问题：

部门作为公司组织结构配置，同时散落在 CEO、OPC、Projects detail、Settings Profile 的不同上下文中。用户不知道部门配置到底属于 OPC 还是 Settings。

影响：

1. 部门设置的心智模型不稳定
2. CEO 页面承担了配置工作
3. 项目详情容易变成部门配置的第二入口

建议：

1. 部门配置归属 OPC 或 Settings/Departments，不能由 CEO Dashboard 直接管理
2. CEO 只显示部门健康摘要和跳转
3. 项目详情只读展示部门上下文，不提供完整配置入口

## 问题 8：Knowledge 的列表和概览重复

证据：

1. `src/app/page.tsx:1306` Knowledge 页面有 Hero
2. `src/app/page.tsx:1317` Knowledge Hero 显示 Departments 指标
3. `src/app/page.tsx:1318` Knowledge Hero 显示 Active runs 指标
4. `src/components/sidebar.tsx:737` Sidebar 有 Knowledge `Entries`
5. `src/components/knowledge-panel.tsx:120` KnowledgeWorkspace 自己加载 knowledge list
6. `src/components/knowledge-panel.tsx:237` Knowledge overview 渲染 Recent Additions
7. `src/components/knowledge-panel.tsx:243` Knowledge overview 渲染 High Reuse
8. `src/components/knowledge-panel.tsx:250` Knowledge overview 渲染 Stale / Conflict
9. `src/components/knowledge-panel.tsx:257` Knowledge overview 渲染 Proposal Signals
10. `src/app/page.tsx:1332` 右轨又挂载 DepartmentMemoryPanel

问题：

Knowledge 的选择列表在 Sidebar，概览列表在 KnowledgeWorkspace，部门记忆在右轨，Hero 又显示部门和 active runs。一个知识工作面被拆成多个入口和摘要区。

影响：

1. 用户不知道该从 Sidebar 选知识，还是从主页面卡片进入
2. Knowledge 页面同时表达知识库、部门记忆、运行状态，主任务不清晰
3. Sidebar 和 KnowledgeWorkspace 可能加载不同粒度的数据

建议：

1. Knowledge 主页面自己拥有 knowledge list / search / filters
2. Sidebar 不显示 knowledge entries
3. DepartmentMemoryPanel 作为 Knowledge 内一个 tab 或下钻，不作为永久右轨
4. Hero 不显示 Active runs，运行状态交给全局通知或 Ops

## 问题 9：Ops 的 Assets 和运行状态重复

证据：

1. `src/app/page.tsx:1343` Ops 页面有 Hero
2. `src/app/page.tsx:1372` Ops Hero 显示 Assets 指标
3. `src/app/page.tsx:1373` Ops Hero 显示 Active runs 指标
4. `src/app/page.tsx:1374` Ops Hero 显示 Providers 指标
5. `src/components/sidebar.tsx:770` Ops Sidebar 有 Automation & control
6. `src/components/sidebar.tsx:814` Ops Sidebar 有 Assets
7. `src/components/sidebar.tsx:859` Ops Sidebar 有 Workspaces
8. `src/app/page.tsx:1380` 主区有 SchedulerPanel
9. `src/app/page.tsx:1391` 页面下方有 AssetsManager
10. `src/components/assets-manager.tsx:363` AssetsManager 自己有 `Assets 管理`
11. `src/components/assets-manager.tsx:445` AssetsManager 有 Canonical section
12. `src/components/assets-manager.tsx:451` AssetsManager 有 Discovered section

问题：

Ops 页面同时用 Hero、Sidebar、右轨 widget、AssetsManager 表达 assets/runtime/provider/workspace。Assets 特别明显：Sidebar 先给资产摘要和前 4 个条目，AssetsManager 再完整管理。

影响：

1. Ops 页面信息密度过高
2. 用户看到多个资产入口，不知道哪个能编辑、哪个只是浏览
3. Runtime status 和 workspaces 在 Sidebar 与右轨 widgets 间重复

建议：

1. Assets 只在 AssetsManager 完整管理
2. Sidebar 删除 Ops assets 列表
3. Ops Hero 只保留一级健康摘要，不列 assets/provider 细节
4. Runtime widgets 按重要性收敛为单一 Runtime health card

## 问题 10：Settings Provider / API Keys / 运行配置概念仍然混杂

证据：

1. `src/components/settings-panel.tsx:877` Provider 页有 `Provider 支持矩阵`
2. `src/components/settings-panel.tsx:895` Provider 页有 `默认配置`
3. `src/components/settings-panel.tsx:933` Provider 页有 `层级覆盖`
4. `src/components/settings-panel.tsx:1220` API Keys 页有 Anthropic API Key
5. `src/components/settings-panel.tsx:1299` API Keys 页有 OpenAI API Key
6. `src/components/settings-panel.tsx:1377` API Keys 页有 本地登录态
7. `src/components/settings-panel.tsx:1434` API Keys 页有 Gemini API Key
8. `src/components/settings-panel.tsx:1491` API Keys 页有 Grok API Key
9. `src/components/settings-panel.tsx:1669` Scenes 页说明覆盖层级配置和默认配置

问题：

虽然已经删除了最严重的 `应用到运行配置` 重复入口，但 Settings 里仍然同时出现 Provider 能力检测、第三方连接配置、官方 API Key、本地登录态、默认 provider、layer provider、scene override。它们都围绕“运行时选哪个模型/Provider”，但页面没有清楚表达层级关系。

影响：

1. 用户仍可能问“为什么 Provider 配置和 API Key 分开”
2. `custom provider` 和 OpenAI API Key 容易被理解为同一层能力
3. 默认配置、层级覆盖、Scene 覆盖会被理解成三套平行配置，而不是覆盖链

建议：

1. Settings Provider 页面顶部显示唯一配置链：`Credential -> Provider Profile -> Default Runtime -> Layer Override -> Scene Override`
2. API Keys 只负责 credential，不出现运行配置文案
3. Provider 支持矩阵降级为折叠诊断区
4. 默认配置和层级覆盖保留为唯一正式运行配置入口
5. Scene 覆盖只在高级模式展开

## 问题 11：API Key 卡片代码重复

证据：

1. `src/components/settings-panel.tsx:1220` Anthropic API Key 卡片
2. `src/components/settings-panel.tsx:1299` OpenAI API Key 卡片
3. `src/components/settings-panel.tsx:1434` Gemini API Key 卡片
4. `src/components/settings-panel.tsx:1491` Grok API Key 卡片

问题：

四个 API Key provider 的状态、输入、显示/隐藏、测试连接、错误展示逻辑基本重复实现。

影响：

1. 新增 provider 时会继续复制一套状态和 handler
2. 测试连接和错误样式很容易不一致
3. UI 精修需要改四处

建议：

1. 抽 `ApiKeyProviderCard`
2. 用 provider metadata 驱动 label、placeholder、status、test state
3. 把 test status 合并为 `Record<providerId, TestState>`
4. 保留特殊 provider 的 override，而不是复制整张卡

## 问题 12：CEO Profile 与 Prompt 资产职责重叠

证据：

1. `src/components/ceo-profile-settings-tab.tsx:248` 有 `CEO Profile Journey`
2. `src/components/ceo-profile-settings-tab.tsx:279` 有 `Structured Preferences`
3. `src/components/ceo-profile-settings-tab.tsx:396` 有 `Feedback Signals`
4. `src/components/ceo-office-settings.tsx:111` CEO Office Settings 有 `Prompt 资产`
5. `src/components/ceo-office-settings.tsx:263` Prompt 资产下有 `Persona Prompt`
6. `src/components/ceo-office-settings.tsx:264` Prompt 资产下有 `Playbook Prompt`
7. `src/app/page.tsx:1689` CEO Office 右轨嵌入 `CeoOfficeSettings`

问题：

用户会同时看到结构化 CEO Profile 和 Persona/Playbook Prompt 两套“影响 CEO 行为”的配置入口。两者可能都是合理能力，但缺少明确关系。

影响：

1. 用户不知道改 CEO 行为该改 Profile 还是 Prompt
2. CEO Office 右轨承担了 Settings 的配置职责
3. 后续行为调优可能出现一边更新、一边被另一边覆盖的心智混乱

建议：

1. CEO Profile 是用户偏好和结构化策略
2. Persona/Playbook 是系统 prompt 资产，高级配置
3. CEO Office 只给 Profile 摘要和 deep link，不直接编辑 prompt 资产
4. Prompt 资产移到 Settings/Profile Advanced 或 Assets

## 问题 13：公共 UI primitives 本身存在职责重叠

证据：

1. `src/components/ui/app-shell.tsx:251` 定义 `WorkspaceHero`
2. `src/components/ui/app-shell.tsx:214` 定义 `WorkspaceMetricCard`
3. `src/components/ui/app-shell.tsx:286` 定义 `InspectorTabs`
4. `src/components/ui/workspace-primitives.tsx:116` 定义 `WorkspaceMiniMetric`
5. `src/components/ui/workspace-primitives.tsx:325` 定义 `WorkspaceTabsList`
6. `src/components/ui/workspace-primitives.tsx:347` 定义 `WorkspaceTabsTrigger`

问题：

`app-shell.tsx` 和 `workspace-primitives.tsx` 都在提供 header、metric、tabs 类能力。组件名称看似不同，但职责相近，导致页面开发时很容易一层用 `WorkspaceMetricCard`，下一层又用 `WorkspaceMiniMetric`。

影响：

1. 视觉体系不稳定
2. 页面会自然堆出多层 metric
3. 公共组件越多，反而越难约束信息架构

建议：

1. 明确 `app-shell.tsx` 只提供全局 shell primitives
2. `workspace-primitives.tsx` 只提供业务工作面 primitives
3. 删除或合并重复的 metric/tab/header primitive
4. 为每个 primitive 写使用边界注释

## 问题 14：数据拉取和轮询分散，容易制造后台噪音

证据：

1. `src/app/page.tsx:292` `loadAgentState` 同时拉 projects、agent runs、servers、workspaces、hidden workspaces
2. `src/app/page.tsx:327` `loadAgentState` 按页面周期轮询
3. `src/app/page.tsx:848` pending approval 轮询
4. `src/app/page.tsx:864` audit events 轮询
5. `src/components/sidebar.tsx:231` Sidebar 自己按 section 轮询
6. `src/components/ceo-dashboard.tsx:104` CEO Dashboard scheduler 轮询
7. `src/components/projects-panel.tsx:265` ProjectsPanel scheduler 轮询
8. `src/components/projects-panel.tsx:399` 项目详情 run 轮询
9. `src/components/scheduler-panel.tsx:211` SchedulerPanel expanded runs 轮询

问题：

前端多个组件各自建立轮询，而不是统一按页面可见性和数据 ownership 管理。此前已经出现过大量 Node CPU 的用户反馈，这类分散轮询是同类风险。

影响：

1. 页面越复杂，后台请求越多
2. 同一数据被多处重复拉取
3. 用户切换页面时可能仍有多个组件级轮询存在
4. 请求失败时没有统一退避策略

建议：

1. 建立 page-level data owner
2. 建立 `useSchedulerSummary`、`useAgentRunSummary`、`useApprovalSummary` 等共享 hook
3. 按页面可见区域启停轮询
4. 统一 stale time、poll interval 和错误退避
5. 子组件默认接收 props，不直接轮询全局数据

## 问题 15：说明性文案仍偏多，视觉没有完全承担表达

证据：

1. `src/app/page.tsx:1070` Header 有当前页面说明
2. `src/app/page.tsx:1133` Settings Hero 有 `Settings / Control`
3. `src/app/page.tsx:1157` OPC Hero 有 `OPC / Operating Center`
4. `src/app/page.tsx:1307` Knowledge Hero 有 `Knowledge / Memory`
5. `src/app/page.tsx:1344` Ops Hero 有 `Ops / Runtime`
6. `src/app/page.tsx:1414` CEO Hero 有 `CEO Office / Executive Cockpit`
7. `src/components/ceo-profile-settings-tab.tsx:248` Profile 页还有 Journey 说明
8. `src/components/assets-manager.tsx:445` AssetsManager 用 Canonical 说明
9. `src/components/assets-manager.tsx:451` AssetsManager 用 Discovered 说明

问题：

很多界面还在靠英文 eyebrow、长说明、辅助文案解释页面结构。用户界面不应该像设计说明文档。稳定后应更多依赖布局、图标、状态、分组和视觉层级表达。

影响：

1. 视觉密度高
2. 用户扫视效率低
3. 页面像 demo 或设计稿说明，而不像产品

建议：

1. 一级页面只保留必要标题，不要保留设计解释
2. 说明性文案移入 tooltip、empty state 或 help drawer
3. `Canonical / Discovered` 这类术语需要换成用户语言，或只在高级模式显示
4. 用 icon、status dot、badge、分组 spacing 表达状态，不用反复写说明

## 优先级建议

P0：先做架构边界，不要继续逐卡片修。

1. `Sidebar` 降级为纯导航
2. `src/app/page.tsx` 拆成五个 page container
3. Scheduler summary 数据统一
4. CEO Office 删除重复 CTA 和配置型右轨

P1：收敛主页面重复。

1. OPC 只保留一个项目选择器
2. Knowledge 只保留一个知识列表入口
3. Ops 只保留一个 Assets 管理入口
4. Settings Provider/API Key/Runtime config 建立层级链路

P2：收敛 primitives 和文案。

1. 合并 metric/tab/header primitives
2. API Key 卡片组件化
3. 删除大多数说明性文案
4. 高级概念默认折叠

## 推荐整改顺序

第一阶段：冻结信息架构规则。

产出：`docs/design/frontend-information-architecture-rules.md`

内容：

1. Header 职责
2. Sidebar 职责
3. Page container 职责
4. Child panel 职责
5. Cross-page summary 数据职责

第二阶段：拆 `src/app/page.tsx`。

目标结构：

1. `src/components/pages/ceo-page.tsx`
2. `src/components/pages/opc-page.tsx`
3. `src/components/pages/knowledge-page.tsx`
4. `src/components/pages/ops-page.tsx`
5. `src/components/pages/settings-page.tsx`

第三阶段：清 Sidebar。

删除：

1. CEO cockpit cards
2. Project Tree
3. Knowledge Entries
4. Ops Assets
5. Ops Workspaces

保留：

1. 一级导航
2. 当前 section 的最小二级导航
3. 用户身份和必要全局动作

第四阶段：清 CEO Office。

保留：

1. 公司态势摘要
2. 统一指令中心
3. 决策/审批/风险队列
4. 最近 CEO 线程轻量入口

移出：

1. 完整 Scheduler 管理
2. 完整部门配置
3. 完整 Prompt 资产编辑
4. 完整日报列表

第五阶段：清跨页数据轮询。

新增：

1. `useSchedulerSummary`
2. `useApprovalSummary`
3. `useAgentRunSummary`
4. `useAssetsSummary`

要求：

1. 子组件默认不直接轮询全局数据
2. 页面 container 负责数据加载
3. Ops 负责完整管理面

## 验收标准

完成整改后应满足：

1. CEO Office 首屏不再出现多个 `创建 CEO 对话`
2. Sidebar 不再显示 project tree / knowledge entries / assets list
3. Scheduler 只有 Ops 页面完整管理，其他页面只显示 summary link
4. Settings 里用户能清楚区分 credential、provider profile、runtime default、layer override、scene override
5. `src/app/page.tsx` 不再超过合理规模，主页面布局由独立 page container 承担
6. 全站没有同一功能在同一视口内出现两个同级入口
7. 页面说明文案减少，视觉层级和图标承担主要表达
8. 前端轮询点有清单、有统一 interval、有页面可见性控制
