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

## 2026-04-27 Projects 真实性收口

本轮不再继续给 `Projects` 加“看起来像完整控制台”的假解释层，而是把 browse 首屏重新收口到真实业务数据：

- 右侧 `项目健康度` 改为 `执行概览`
  - 不再展示前端 heuristics 算出来的 0-100 健康分
  - 只展示真实 `project.status / stage counts / run counts / child project count / latest run`
- 右侧 `负责人` 改为 `执行工作区`
  - 不再伪造 owner persona、头像 initials、participants
  - 改为展示真实 workspace 绑定、department type/provider、skills/workflow-bound/templates 数量
- browse `阶段进度` 不再兜底伪造五步生命周期
  - 没有真实 runtime stage 时，明确展示“模板已绑定，但尚未生成运行状态”
- 部门上下文移除 `fallback refs`
  - 该值是内部 `skillRefs` fallback 计数，不再作为产品指标暴露
- browse run drilldown 改为显式携带 `projectId`
  - page 层保留 `api.agentRun(runId)` fallback，避免历史 run 因全局缓存缺失而打不开详情
- browse filter/tree 再收口
  - `进行中` 只保留真实 `active`
  - `查看其余 N 个部门` 现在展开全部 `openTreeSections`
  - 搜索 / 筛选改变后，如果当前 focus 已不在可见树中，会自动清理失效 focus
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

## 2026-04-27 Ops 收口补记

本轮已补上 `Ops` 页内部首层重构，不再停留在“旧 widget 纵向拼接”的过渡态：

- `src/app/page.tsx`
  - `Ops` header 改为标题 + badge + 搜索入口，不再把 Provider / API Key 按钮放成首层主 CTA
- `src/components/ops-dashboard.tsx`
  - 新增聚合式 Ops dashboard，首层改成 `4 KPI + 调度任务 + 系统状态 + MCP / 配额 / Tunnel + 资产管理 + 最近活动`
  - 统一到与 `Projects` 相同的紧凑浅色驾驶舱密度
- `src/components/scheduler-panel.tsx`
  - 增加受控 `createRequestToken` 入口，允许 Ops 首层 `新建任务` 直接复用原有 scheduler 创建弹窗
- 保留深层能力但后移：
  - `SchedulerPanel`
  - `AssetsManager`
  - `AnalyticsDashboard`
  - `CodexWidget`

结果：

- `Ops` 已从“工具箱首页”收口为“运营驾驶舱首页”
- 首屏优先回答调度是否正常、哪里阻塞、配额是否安全、连接是否可用、资产与活动发生了什么
- 老的重型面板没有删除，只是退到第二层，减少与首页叙事竞争

同日第二轮继续收口：

- `src/components/ops-dashboard.tsx`
  - 首屏继续压缩，KPI、panel header、empty state、表头全部改为更接近运维控制台的密度
  - `系统状态 / MCP / 配额 / Tunnel` 从 summary card 改为 compact table
  - `调度任务` 行内动作从 icon-only 改成 `立即执行 / 启用-暂停 / 调度治理`
  - `高级调度治理 / 资产 Studio / 扩展工具` 三段旧 appendix 合并成一个 `深层工作台`
  - 资产首页开始同屏显示 `已接入 / 待导入`，最近活动改成 `类别 + 状态 + 详情` 的可扫读结构
- `src/app/page.tsx`
  - `Ops` header 搜索明确标注为 `本页` 过滤，不再假装是全局 command bar
- 验收补充：
  - `bb-browser` 仍优先尝试，但 `snapshot / eval` 在 `:3999` 上继续只返回空白 `body`
  - 因而回退到一次性 Playwright，对同一 `:3999` 页面断言：
    - `深层工作台` 替代旧三段 appendix
    - `新建任务` 可打开既有 `New Scheduled Job`
    - `资产工作台` 可展开全量资产面板并显示 `可执行资产`
    - 无 console error / page error / bad response

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

第七阶段处理第六阶段后的壳层分叉问题：`CEO Office` 已经使用独立 Apple-style 左侧导航壳，但 `Projects / Knowledge / Ops / Settings` 仍通过旧 `AppShell Header + Sidebar + WorkspaceHero` 过渡结构承载，导致用户看到两套主页面产品语言。

已落地：

- 新增 `src/components/workspace-concept-shell.tsx`
  - 统一左侧 `OPC` 导航、用户卡片、公司入口和移动端主导航
  - 统一主页面标题区、状态 badge、页面动作和右上工具区承载方式
  - 复用 CEO Office 的浅色 Apple-style 视觉方向：浅灰背景、蓝色强调、白色卡片、低对比边框
- `src/app/page.tsx`
  - `Projects / Knowledge / Ops / Settings` 切到 `WorkspaceConceptShell`
  - 非 CEO 主页面不再渲染旧顶部 pill nav，也不再渲染旧 Sidebar
  - 页面级 `WorkspaceHero` 改为紧凑标题 + 指标卡，避免 Header/Hero/子组件三层标题重复
  - 保留原业务组件：`ProjectsPanel`、`KnowledgeWorkspace`、`SchedulerPanel`、`AnalyticsDashboard`、`AssetsManager`、`SettingsPanel`
- URL 初始化竞态修复
  - CEO 自动打开最近线程的 effect 必须等待 URL state 初始化完成
  - 当当前打开的是 Settings utility panel 时，不再被 CEO 自动线程覆盖
  - 直达 `?section=projects`、`?section=knowledge`、`?section=operations`、`?panel=settings` 能稳定停留在目标页面

第七阶段结果：

- 五个一级主页面的外壳层重新统一到同一套 Apple-style 主导航语言
- `CEO Office` 不再是唯一遵循设计稿方向的页面
- `Projects / Knowledge / Ops / Settings` 的深层业务组件仍保留现有能力，后续可继续按组件清理历史暗色 class 和重复局部标题

验证记录：

- `npx eslint src/app/page.tsx src/components/workspace-concept-shell.tsx`
- `npx tsc --noEmit --pretty false`
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts`
- `npm run build`
- 浏览器验证优先尝试 `bb-browser`；`open` 成功，但 `snapshot/eval/screenshot` daemon 请求超时，因此退回一次性 Playwright 脚本，只连接既有 `:3000` 服务，不启动新服务
- Playwright 验证：
  - `?section=projects`：`h1=Projects`，`hasOldTopNav=false`，`hasConceptRail=true`
  - `?section=knowledge`：`h1=Knowledge`，`hasOldTopNav=false`，`hasConceptRail=true`
  - `?section=operations`：`h1=Ops`，`hasOldTopNav=false`，`hasConceptRail=true`
  - `?panel=settings&tab=provider`：`h1=Settings`，`hasOldTopNav=false`，`hasConceptRail=true`

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

## Phase 14：Projects 页面 deep pass

本阶段按 `docs/design/mockups/apple-reference-pages-2026-04-23/projects.png` 先完成一个主页面的深层收口，并把 TODO 固化到 `docs/design/projects-page-todos-2026-04-26.md`。

已落地：

- `src/app/page.tsx`
  - Projects 页移除页面级右侧 `Execution queue`，避免 `page.tsx` 和 `ProjectsPanel` 分别拥有半个项目页面。
  - Projects 页只保留壳层、顶部指标、部门配置 banner 和 `ProjectsPanel` 主工作面。
- `src/components/projects-panel.tsx`
  - Browse mode 从空标题区改成完整 Projects 工作台。
  - 新增项目树：搜索、All/Active/Attention/Done 筛选、按部门/状态分组、进度条、编辑、归档。
  - 新增执行工作台：默认聚焦需要关注或活跃项目，展示目标、状态、模板、进度、活跃 runs、风险、子项目和 pipeline 阶段。
  - 新增右侧面板：项目健康评分、负责人/部门画像、关联推进、快捷操作。
  - 保留主页面可达操作：创建项目、AI Generate Pipeline、派发、编辑、归档、删除、打开详情。
  - `lg` 断点启用两列、`xl` 断点启用三列，避免 1512px 桌面宽度下项目树独占整行。
  - Detail mode 保留现有 `Pipeline / Operations / Deliverables` 工作台，不新增 scheduler/worker 轮询副作用。

验证结果：

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx` 通过
- `npx tsc --noEmit --pretty false` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` 通过，`13 tests passed`
- `npm run build` 通过，仅保留既有 Turbopack broad-pattern warnings
- `bb-browser open http://localhost:3000/?section=projects` 成功
- `bb-browser eval` 验证 Project browse surface 已渲染项目树、项目健康、快捷操作，并且旧 `风险与最近推进` 队列不再出现
- `bb-browser screenshot /tmp/opc-projects-page-bb-2.png` 验证 1512px 桌面宽度下三列布局成立
- `bb-browser` 点击 `打开详情` 后进入 `?section=projects&project=...`，`Pipeline / Operations / Deliverables` 可见，`bb-browser errors` 无 JS 错误
- 详情截图：`/tmp/opc-projects-detail-bb.png`

## Phase 15：Projects 页面设计稿二次收口

本阶段继续按 `docs/design/mockups/apple-reference-pages-2026-04-23/projects.png` 收紧 Projects 主页面完整度，重点是“更像参考稿，同时不丢功能”。

已落地：

- `src/app/page.tsx`
  - Projects 顶部指标改为参考稿风格的四张紧凑 KPI：进行中项目、阻塞项目、本周完成、待评审。
  - `xl` 断点起四张 KPI 同排，避免 1512px 桌面宽度下指标区变成两行大卡。
- `src/components/projects-panel.tsx`
  - 移除 browse body 内二级 `项目执行总览` hero，正文直接进入三栏工作面。
  - 项目树改成更密的部门树行项目：支持搜索、筛选、聚焦态、进度、状态、编辑和归档/恢复。
  - 新增 browse focus state：点击项目行只更新中间工作台；`打开详情` 才进入完整 detail mode。
  - 执行工作台补齐参考稿结构：标题/状态/目标、阶段进度、最近运行、阻塞项、下一步。
  - 右侧栏按参考稿顺序收敛为项目健康度、负责人、关联运行、快捷操作。
  - 保留主页面动作入口：创建项目、AI Generate、派发、新建运行、编辑、归档/恢复、删除、打开详情、run selection。

验证结果：

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx` 通过
- `npx tsc --noEmit --pretty false` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` 通过，`13 tests passed`
- `npm run build` 通过，仅保留既有 Turbopack broad-pattern warnings
- `bb-browser` 在临时 web-only `http://127.0.0.1:3999/?section=projects` 验证：
  - Projects 主页面包含 `进行中项目 / 阻塞项目 / 本周完成 / 待评审 / 项目树 / 执行工作台 / 阶段进度 / 最近运行 / 阻塞项 / 下一步 / 项目健康度 / 负责人 / 关联运行 / 快捷操作`
  - 四张 KPI 在验证视口同排
  - 旧 `项目执行总览` 二级 hero 和旧外置 `风险与最近推进` 队列均不存在
  - 点击项目行后 URL 仍停留在 `?section=projects`
  - 点击 `打开详情` 后进入 `?section=projects&project=...`，`Pipeline / Operations / Deliverables` 可见
  - `bb-browser screenshot /tmp/opc-projects-round2-final.png` 完成截图
  - `bb-browser errors` 无 JS 错误

## Phase 16：Projects 页面设计稿第三轮密度收口

本阶段继续按 `docs/design/mockups/apple-reference-pages-2026-04-23/projects.png` 收紧 Projects 主页面剩余差异，目标是让页面顶部和主工作面更接近参考稿，同时保留第二轮补齐的所有项目功能。

已落地：

- `src/components/workspace-concept-shell.tsx`
  - 新增 `headerVariant="compact"`，用于 Projects 这类需要更密页面头的主页面。
  - compact 模式把 `Projects` 和 `项目总览` 放在同一行，降低 H1 尺寸和标题区高度。
- `src/app/page.tsx`
  - Projects 顶部加入真实搜索框，和 `ProjectsPanel` 的项目树搜索共享状态。
  - 顶部加入蓝色主按钮 `新建项目`，直接打开既有创建项目 Dialog。
  - KPI 卡继续收紧为白底低半径指标块：左侧图标、较小数值、低对比边框。
- `src/components/projects-panel.tsx`
  - 接收受控搜索值和顶部创建请求 token，不复制创建逻辑。
  - 主工作面进一步降低 gap、radius、padding；项目树、执行工作台、右栏卡片密度更接近参考稿。
  - Detail mode 的部门上下文优先使用页面已加载的 departments Map；只有组件独立使用且未传入 Map 时才回退请求，避免当前页面详情切换时对受限 workspace 额外打出 403。

验证结果：

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx src/components/workspace-concept-shell.tsx` 通过
- `npx tsc --noEmit --pretty false` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` 通过，`13 tests passed`
- `npm run build` 通过，仅保留既有 Turbopack broad-pattern warnings
- 临时 web-only `http://127.0.0.1:3999/?section=projects` 验证：
  - compact header 渲染 `Projects` + `项目总览`
  - 旧 `项目、部门与执行链路的公司工作面。` 和旧 `打开 Ops` 页面动作均不存在
  - 顶部搜索和项目树搜索同步，`baogaoai` 过滤为 `1 visible / 67 total`
  - 顶部 `新建项目` 打开既有创建项目 Dialog
  - `打开详情` 进入 `?section=projects&project=...`，详情内容仍显示 `结果概览` / `OUTPUT EVIDENCE`
  - Final browser run 没有 bad HTTP responses 和 console/page errors；关闭浏览器时仅出现预期的 SSE `/api/approval/events` abort
- 截图：`/tmp/opc-projects-round3-final.png`
- 浏览器验证优先使用 `bb-browser`；`open` 与早期 DOM 验证成功，但 daemon 后续在刷新/截图标签页时超时，最终截图和完整交互断言回退到项目已有 Playwright 依赖。

## Phase 17：Projects 页面视觉精修

本阶段处理第三轮后剩余的参考稿细节差异，继续保持功能不丢失。

已落地：

- `src/app/page.tsx`
  - Projects 顶部 action cluster 移除额外 `部门设置`，只保留搜索和主操作 `新建项目`。
  - 部门配置提示条压薄为低高度 notice，降低对主工作面的占用。
- `src/components/projects-panel.tsx`
  - 新增 `onOpenDepartmentSettings`，把部门配置入口迁入右侧快捷操作，避免功能丢失。
  - 右侧 `项目健康度` 从圆环 + 纵向 progress bars 改成参考稿方向的圆环 + 图例数值。
  - 当真实项目只有 0/1 或少量 stage 时，仍渲染五步视觉轨道，并把真实 stage 状态合并到轨道中。
  - 快捷操作从泛化 `更多操作` 改为明确 `AI 生成`，并保留新建运行、创建项目、编辑项目、部门设置、删除项目。

验证结果：

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx src/components/workspace-concept-shell.tsx` 通过
- `npx tsc --noEmit --pretty false` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` 通过，`13 tests passed`
- `npm run build` 通过，仅保留既有 Turbopack broad-pattern warnings
- 临时 web-only `http://127.0.0.1:3999/?section=projects` 验证：
  - header 在 KPI 前不再出现 `部门设置`
  - `部门设置` 仍在右侧快捷操作可达
  - slim setup notice、health legend 和 top `新建项目` 均可见
  - 稀疏项目显示五步轨道：`目标确认 / Coding Worker / 结果验证 / 交付归档 / 复盘优化`
  - 顶部 `新建项目` 打开既有创建项目 Dialog
  - `打开详情` 进入 `?section=projects&project=...` 并显示 detail 内容
  - no bad HTTP responses / no console or page errors；关闭浏览器时仅出现预期的 SSE `/api/approval/events` abort
- `bb-browser` 优先用于打开、DOM 检查、截图和错误检查；因长期 profile 中混有旧 `:3999` 标签，最终交互断言使用一次性 Playwright。
- 截图：`/tmp/opc-projects-round4-final.png`、`/tmp/opc-projects-round4-final-playwright.png`

## Phase 18：Projects 默认工作面收敛

本阶段处理用户指出的“还有大量没完成”，重点不是继续堆控件，而是把默认首屏从真实数据直出改成参考稿式的代表性工作面。

已落地：

- `src/app/page.tsx`
  - Projects header 不再显示旧的 setup 状态 chip，顶部保留 `Projects / 项目总览`、搜索和 `新建项目`。
  - KPI tile 由图标 + 数值 + 细节同行改为参考稿更接近的纵向堆叠。
- `src/components/projects-panel.tsx`
  - 新增 noisy project heuristics，默认首屏降权 `test / Auto-Trigger / file_Users...` 一类原始噪音项目。
  - 项目树默认只展示更有代表性的部门区块；如果存在足够的业务项目区块，则不再把 `backend/test` 放进首屏。
  - 默认 workbench focus 改为跟随可见项目树，不再落到树外隐藏项目。
  - 移除 `All / Active / Attention / Done` 筛选 chips，保持左栏密度更接近参考稿。
  - workbench 右上角 `...` 变成真实下拉动作菜单，保留编辑项目、新建运行、归档/恢复、删除。

验证结果：

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx src/components/workspace-concept-shell.tsx` 通过
- `npx tsc --noEmit --pretty false` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` 通过，`13 tests passed`
- `npm run build` 通过，仅保留既有 Turbopack broad-pattern warnings
- `bb-browser` 先用于本地打开 `:3999`，但其长期 daemon profile 混入旧 `:3999` 标签，导致抓到的页面状态不可作为最终验收依据
- 最终使用一次性 Playwright 对重新 build 的 `http://127.0.0.1:3999/?section=projects` 做干净断言：
  - 顶部仍有搜索和 `新建项目`
  - 默认树区块包含 `WorkSatation / AI情报工作室 / 线索跟踪部门 / Openmind`
  - 默认焦点不再落到 hidden `test` / `Auto-Trigger` 项目
  - `项目健康度 / 快捷操作 / 已完成项目 / 打开详情` 仍可用
  - 无 bad HTTP responses / 无 console 和 page errors
- 最终截图：`/tmp/opc-projects-round5-playwright-final.png`

## Phase 19：Projects 业务回归修复

本阶段处理 review 中确认的真实业务回归，而不是继续做视觉收口。

已落地：

- `src/components/projects-panel.tsx`
  - 历史项目过滤改回可浏览闭环：`completed / archived / cancelled` 会在树中按 `Completed / Archived / Cancelled` 分组显示，不再切到空树。
  - 左栏 filter 按钮改成下拉菜单，恢复 `进行中` 入口，同时保留 `全部 / 关注项 / 历史项目`。
  - 默认首屏部门树继续只显示代表区块，但补回 `查看其余 N 个部门 / 收起其他部门`，避免后续部门完全消失。
- `src/app/page.tsx`
  - Projects 页点击 run 时不再只写入 `selectedAgentRunId`；现在会导航到目标 project detail。
- `src/components/project-workbench.tsx`
  - 新增外部 `selectedRunId` 对齐逻辑，Projects browse mode 点击 run 后，detail workbench 会自动聚焦到匹配的 stage 或 prompt run。

验证结果：

- `npx eslint src/app/page.tsx src/components/projects-panel.tsx src/components/project-workbench.tsx src/components/workspace-concept-shell.tsx` 通过
- `npx tsc --noEmit --pretty false` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` 通过，`13 tests passed`
- `npm run build` 通过，仅保留既有 Turbopack broad-pattern warnings
- `bb-browser` 先用于本地打开 `:3999`，但其 daemon 仍把新页面绑定到历史 `:3999` 标签集合，页面状态不适合作最终回归验收
- 最终使用一次性 Playwright 对 `http://127.0.0.1:3999/?section=projects` 做回归断言：
  - filter menu 含 `全部项目 / 进行中 / 关注项 / 历史项目`
  - `历史项目` 能渲染 closed sections
  - 树存在 `查看其余 N 个部门` 并能切换为 `收起其他部门`
  - 搜索 `baogaoai` 后点击 browse-mode run 会进入 `?section=projects&project=...`，并显示选中 run 的 detail 内容
  - 无 bad HTTP responses / 无 console 和 page errors
- 截图：`/tmp/opc-projects-review-fixes-final.png`、`/tmp/opc-projects-run-drilldown-fix.png`

## Phase 20：Projects 历史 run 证据恢复

本阶段处理用户指出的“老详情页里有 pipeline 运行情况，新页面里不见了”。

根因不是后端缺数据，而是前端在两个地方仍然错误依赖全局分页 `agentRuns`：

- browse surface 的 `最近运行 / 关联运行 / 健康度 / 最近活动时间`
- detail surface 的 `ProjectWorkbench`

虽然组件已经单独请求了 project-scoped runs，但旧代码没有把这批 scoped runs 真正传给上述渲染链路。于是当历史项目的 run 不在全局 `/api/agent-runs?pageSize=100` 首屏里时，页面就只剩 pipeline 摘要，丢掉 run-backed evidence。

已落地：

- `src/components/projects-panel.tsx`
  - 引入 focused project runs 状态，当前 focus project 无论处于 browse 还是 detail mode，都单独拉取 `api.agentRunsByFilterAll({ projectId })`。
  - browse mode 的 `最近运行 / 关联运行 / 健康度 / 最近活动时间` 改为优先使用 focused project runs，而不是只看全局分页 runs。
  - detail mode 的 `viewProjectRuns` 改为优先使用 focused project runs。
  - detail mode 渲染 `ProjectWorkbench` 时，传入 `viewProjectRuns`，不再传全局 `agentRuns`。

验证结果：

- `npx eslint src/components/projects-panel.tsx src/app/page.tsx src/components/project-workbench.tsx src/components/workspace-concept-shell.tsx` 通过
- `npx tsc --noEmit --pretty false` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` 通过，`13 tests passed`
- `npm run build` 通过，仅保留既有 Turbopack broad-pattern warnings
- 数据验证：
  - root project `19885e25-248b-4e17-ae37-2653b4018598` 的 scoped run `857995d5-a1bf-4067-84bf-deae5f91707d` 不在全局 `/api/agent-runs?pageSize=100`
  - 但存在于 `/api/agent-runs?projectId=19885e25-248b-4e17-ae37-2653b4018598&pageSize=200`
- 浏览器验证：
  - 先尝试 `bb-browser`，但当前 session 仍绑定到外部 `eastmoney` 页面，无法作为本地 Projects 验收依据
  - 回退到一次性 Playwright，仅连接既有 `http://127.0.0.1:3000`
  - 验证 root detail 已恢复 `最近执行 / 结果概览 / output evidence / 关注项`
  - 验证 pipeline detail 已恢复 `Batch Planner / Research Fan-Out / Branches / Research Join`
- 截图：`/tmp/opc-projects-root-detail-evidence.png`、`/tmp/opc-projects-detail-run-evidence.png`

## Phase 21：Projects 详情降层与 Fan-Out 一层融合

本阶段处理用户指出的“项目详情太深，要点多次才能看到真正详情”，尤其是 Fan-Out root project 的第一层工作面不够完整。

已落地：

- `src/components/projects-panel.tsx`
  - 把 `ProjectWorkbench` 前移到 detail mode 第一层，不再要求用户先进入摘要后再额外点 stage 才能看到真实 stage 详情。
  - 新增 `关联项目` 横向 rail，把 root overview 和 fan-out child projects 放到同一屏第一层。
  - detail mode 进入时会推断首个有效焦点；当项目包含 child projects / branch fan-out 时，优先聚焦 fan-out stage。
  - 对 `selectedRunId` 做 project-scope 收口：只有当 run 真属于当前 `viewProjectRuns` 时才采用，避免页面级全局 run 选择把项目详情带进空选中态。
- `src/components/project-workbench.tsx`
  - 支持外部 `selectedStageId`，允许无 `runId` 的 fan-out stage 直接作为默认焦点。
  - 新增 `defaultSelectionMode="fanout-first"` 和 `defaultViewMode="list"`，保证 fan-out detail 默认就在可读的列表工作面上。
  - `stickySelection` 下，stage / role / prompt-run 不会因为重复点击而把 detail panel 折叠回空白。

验证结果：

- `npx eslint src/components/projects-panel.tsx src/components/project-workbench.tsx src/app/page.tsx src/components/workspace-concept-shell.tsx` 通过
- `npx tsc --noEmit --pretty false` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` 通过，`13 tests passed`
- `npm run build` 通过，仅保留既有 Turbopack broad-pattern warnings
- `bb-browser` 快照确认第一层 detail 同时包含 `Fan-Out 项目直接放在第一层`、`Research Fan-Out stage`、`Stage Details`、`Open sub-project`
- 一次性 Playwright 对 `http://127.0.0.1:3999/?section=projects&project=19885e25-248b-4e17-ae37-2653b4018598` 的断言确认：
  - `Research Fan-Out` 默认选中
  - `Stage Details` 在第一层同屏可见
  - branch 列表和子项目打开动作未丢失
- 截图：`/tmp/opc-projects-round8-final.png`

## Phase 22：Projects 详情减重与 Fan-Out 工作面聚焦

本阶段处理上一轮 detail 改造后剩余的视觉冗余问题，目标是在不丢功能的情况下，让第一层 detail 更像真正的工作台而不是多个重复卡片的堆叠。

已落地：

- `src/components/projects-panel.tsx`
  - 顶部 detail 摘要从四张独立卡压成单条 summary strip，保留 `最近执行 / 结果摘要 / 交付产物 / 关注项`，减少首屏卡片噪音。
  - `关联项目` 从大卡片 rail 改成 compact focus strip，只保留主项目 / 子项目切换所需的最小信息。
- `src/components/project-workbench.tsx`
  - `列表 / 拓扑` 切换并入阶段区标题行，去掉额外的一整行模式切换。
  - 选中 fan-out stage 时，左侧阶段导航不再重复展开 branch 列表；branch 主内容改由右侧 detail pane 承担。
  - workbench 顶部 tabs 和阶段工作区标签统一为中文：`执行流 / 运行 / 交付`、`执行阶段`。
- `src/components/pipeline-stage-card.tsx`
  - 阶段状态、分支标签、角色数量、`打开` 按钮改为中文。
  - fan-out stage header 增加分支数量 badge，左侧导航在不展开 branch 列表时仍能看出 fan-out 规模。
- `src/components/stage-detail-panel.tsx`
  - `阶段详情` 本地化为中文。
  - 当选中 fan-out stage 且没有直属 run 摘要时，右侧优先渲染 `分支工作面`：关联项目数、完成分支、执行中分支、异常分支，以及每个子项目的时长 / run id / 打开子项目动作。

验证结果：

- `npx eslint src/components/projects-panel.tsx src/components/project-workbench.tsx src/components/pipeline-stage-card.tsx src/components/stage-detail-panel.tsx src/app/page.tsx src/components/workspace-concept-shell.tsx` 通过
- `npx tsc --noEmit --pretty false` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` 通过，`13 tests passed`
- `npm run build` 通过，仅保留既有 Turbopack broad-pattern warnings
- `bb-browser` 先用于本地打开 `:3999`，但当前环境下 snapshot 仍只返回不完整 `body` 骨架，无法作为最终布局验收依据
- 一次性 Playwright 对 `http://127.0.0.1:3999/?section=projects&project=19885e25-248b-4e17-ae37-2653b4018598` 断言通过：
  - `Research Fan-Out` 默认选中
  - 第一层 detail 已包含 `关联项目 / 主项目 / 结果摘要 / 交付产物 / 关注项`
  - 右侧 detail 已包含 `分支工作面` 和 `打开子项目`
  - 无 bad HTTP responses / 无 console 和 page errors
- 截图：`/tmp/opc-projects-round9-optimized.png`

## Phase 23：Settings 页面结构收口

本阶段把 `Settings` 从“旧壳层叠一个 panel”的过渡态，收口到和 `Projects / Ops / Knowledge` 同方向的浅色配置中心，同时保留原有 Provider / API Keys / Scene / MCP / Messaging 功能。

已落地：

- `src/app/page.tsx`
  - `Settings` 入口默认 tab 从 `provider` 改为 `profile`，直达 `?panel=settings` 时优先展示个人偏好。
  - 移除旧的顶部三张 metrics，避免页面首屏继续停留在过渡态 dashboard。
- `src/lib/app-url-state.ts`
  - URL state 默认 `settingsTab` 改为 `profile`，并同步测试用例。
- `src/components/settings-panel.tsx`
  - 外层重构为 `主配置区 + 右侧摘要轨` 的两栏布局。
  - 顶部 tabs 改成参考稿方向的 segmented control，不再换行；`消息平台` 等长标签保持同一行。
  - 新增右侧 `当前配置 / 活跃 Provider / 连接状态 / 当前标签` 四个摘要卡，让 Settings 首屏具备上下文而不是空白表单。
  - `Profile` 成为默认首屏，其余 Provider / API Keys / Scene / MCP / Messaging 全部保留。
- `src/components/ceo-profile-settings-tab.tsx`
  - `CEO Profile` 重排为 `个人信息 / 沟通偏好 / 反馈信号` 三段，更接近设计稿的个人偏好页结构。
  - 下拉控件触发器直接显示中文标签，不再把内部枚举值 `normal / balanced / medium / preference` 暴露给用户。
  - 卡片底座、字段布局、保存动作统一到浅色 `Workspace` token 体系。

验证结果：

- `npx eslint src/app/page.tsx src/components/settings-panel.tsx src/components/ceo-profile-settings-tab.tsx src/components/knowledge-panel.tsx src/components/knowledge-browser-workspace.tsx src/lib/app-url-state.ts src/lib/app-url-state.test.ts src/app/api/knowledge/route.ts` 通过
- `npx tsc --noEmit --pretty false` 通过
- `npx vitest run src/lib/app-url-state.test.ts src/lib/home-shell.test.ts` 通过，`13 tests passed`
- `npm run build` 通过，仅保留既有 Turbopack broad-pattern warnings
- 浏览器验收：
  - 先按约束尝试 `bb-browser`，但当前环境里的 daemon 返回 `Chrome not connected (CDP 503)`，无法作为本地 Settings 验收工具
  - 回退到一次性 Playwright，复用既有 `http://127.0.0.1:3000/?section=projects&panel=settings&tab=profile`
  - 断言通过：7 个 settings tabs 同行显示、`个人信息 / 沟通偏好 / 反馈信号 / 当前配置 / 活跃 Provider / 连接状态` 可见，Profile 下拉值显示中文
- 截图：`/tmp/opc-settings-profile-final-clean.png`
