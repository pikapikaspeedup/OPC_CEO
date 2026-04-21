# 首页用户旅程与断裂点审计（2026-04-20）

## 范围

本轮只审计当前根路由 `/` 对应的首页壳层，不做修复实现。

覆盖文件：

1. `src/app/page.tsx`
2. `src/components/sidebar.tsx`
3. `src/components/projects-panel.tsx`
4. `src/components/onboarding-wizard.tsx`
5. `src/components/settings-panel.tsx`
6. `src/components/ceo-office-settings.tsx`
7. `src/lib/app-url-state.ts`

方法：

1. 以代码真实挂载关系为准，还原首页的实际用户旅程
2. 识别“入口存在但用户目标不闭环”的断裂点
3. 把旅程问题和性能问题放在同一张图里看

说明：

1. 本机当前没有运行中的前端 dev 服务
2. 本轮没有额外拉起新本地服务，避免引入新的 CPU/后台进程噪音
3. 结论基于代码实装状态，不基于设计预期

---

## 核心判断

当前“首页”并不是一个真正意义上的首页，而是一个把五个一级产品、一个隐藏设置面板、多个初始化逻辑、多个轮询任务、多个工作台强行挂在一起的超级壳层。

这直接带来四个后果：

1. 用户不知道“首页到底是入口、工作台、仪表盘，还是路由器”
2. 首屏默认落点和用户真实目标并不稳定匹配
3. 性能慢和旅程乱不是两个问题，而是同一个架构问题的两个表现
4. 后续继续往首页叠功能，只会让认知负担和请求负担一起继续上升

最关键的事实是：

1. 根页面默认 section 是 `projects`，不是“最近工作”、不是“我的任务”、也不是“继续上次工作”
   - 证据：`src/app/page.tsx:77`
   - 证据：`src/lib/app-url-state.ts:33-35`
2. 首页 mount 就会加载 models、templates、skills、workflows、rules 及 discovered 版本
   - 证据：`src/app/page.tsx:131-157`
3. 首页同时会周期性拉 projects、agent runs、servers、workspaces、hidden workspaces
   - 证据：`src/app/page.tsx:211-250`
4. Sidebar 自己还会重复加载 conversations、knowledge、skills、workflows、servers、workspaces、rules
   - 证据：`src/components/sidebar.tsx:183-223`
5. ProjectsPanel 自己还会继续轮询 scheduler jobs 和 project detail runs
   - 证据：`src/components/projects-panel.tsx:256-262`
   - 证据：`src/components/projects-panel.tsx:368-400`

换句话说，当前首页同时承担了：

1. 顶层路由器
2. 全局控制面数据装配器
3. OPC 项目工作台
4. CEO 聊天工作台
5. 对话入口
6. 配置入口
7. 轮询协调器

这就是首页旅程混乱的总根因。

---

## 当前首页实际用户旅程

## 1. 系统级首屏行为

用户打开 `/` 后，系统不是先给一个明确的“去哪里、做什么”，而是先进入一个重型壳层初始化流程：

1. URL 状态解析默认把用户放到 `projects`
   - 证据：`src/lib/app-url-state.ts:25-52`
2. `Settings` 默认 tab 是 `provider`
   - 证据：`src/app/page.tsx:79-83`
   - 证据：`src/lib/app-url-state.ts:48-50`
3. 首屏 mount 后立即加载全局模型、模板、技能、工作流、规则
   - 证据：`src/app/page.tsx:131-157`
4. 同时拉取 project/run/server/workspace 状态，并每 5 秒刷新一次
   - 证据：`src/app/page.tsx:211-250`
5. 还会为所有可见 workspace 拉部门配置
   - 证据：`src/app/page.tsx:681-705`
6. 还会轮询审批数和审计事件
   - 证据：`src/app/page.tsx:712-738`

所以用户感知到的“首页”其实不是一个静态入口页，而是一个一直在工作的 control plane。

## 2. 首次进入用户旅程

首次进入的默认路径是：

1. 打开 `/`
2. 被直接落到 `OPC / Projects`
3. 如果所有部门都是默认 `build` 且没有 `okr`，顶部出现 onboarding banner
4. 点击“开始配置”后，进入多步部门初始化向导
5. 完成后回到项目页，继续创建项目或 AI 生成模板

证据：

1. 首页默认渲染 `projects`
   - `src/app/page.tsx:77`
2. onboarding banner 只在 `isOpcUnconfigured && !onboardingDismissed` 时出现
   - `src/app/page.tsx:707-710`
   - `src/app/page.tsx:940-962`
3. onboarding 是弹窗式 wizard，不是持久任务清单
   - `src/components/onboarding-wizard.tsx:175-210`
   - `src/components/onboarding-wizard.tsx:214-370`
4. 没有项目时，ProjectsPanel 提供的行动只有“创建项目”和“AI Generate”
   - `src/components/projects-panel.tsx:527-556`

这个旅程的问题在于：

1. 首页默认直接把用户扔进“项目工作台”，而不是先确认用户此刻要配置公司、执行项目、还是继续对话
2. onboarding 是一次性弹出，不是长期可回到的 setup checklist
3. 一旦用户点了“稍后”，首页没有强可见的常驻回流入口

## 3. 返回型项目用户旅程

已有项目的用户当前默认旅程是：

1. 打开 `/`
2. 进入 `OPC`
3. 通过左栏项目树选择项目
4. 进入项目 detail/workbench
5. 在一个页面里同时看到循环任务摘要、最近运行、结果摘要、output evidence、关注项、部门上下文、分支、pipeline workbench 或待决策面板

证据：

1. Sidebar 在 `projects` 下明确写着“这里只提供项目上下文，不承载主导航”
   - `src/components/sidebar.tsx:373-377`
   - `src/components/sidebar.tsx:608-622`
2. 项目 detail 模式会把多类信息堆在同一屏
   - `src/components/projects-panel.tsx:558-725`
   - `src/components/projects-panel.tsx:1023-1233`
3. 即使在项目页面，也会展示 scheduler loop 摘要并引导跳到 Ops
   - `src/components/projects-panel.tsx:285-310`
   - `src/components/projects-panel.tsx:598-600`
   - `src/components/projects-panel.tsx:1248-1249`

这个旅程的问题在于：

1. 用户以为自己进入的是“项目详情”，实际进入的是“项目详情 + 调度状态 + 部门上下文 + 执行工作台 + 决策面板”的混合页
2. 项目 detail 的信息层级过多，缺少渐进展开
3. 项目页内部还夹带调度和控制面信息，导致“我是在做项目，还是在管系统”边界不清

## 4. 对话用户旅程

想从首页去普通对话，用户需要：

1. 先从默认的 `OPC` 切到 `Chats`
2. 在侧栏选择 workspace
3. 点击“开始对话”
4. 如果 workspace 未运行，还要先触发工作区启动
5. 等待轮询检测 server ready
6. 才能真正创建会话

证据：

1. `Chats` 不是默认入口
   - `src/app/page.tsx:77`
   - `src/app/page.tsx:752-758`
2. 对话入口依赖 workspace selector
   - `src/components/sidebar.tsx:468-495`
3. 未运行 workspace 会先打开 launch dialog
   - `src/components/sidebar.tsx:325-338`
4. launch 后每 2 秒轮询 server，最长 30 秒
   - `src/components/sidebar.tsx:239-277`

这条旅程的问题在于：

1. “开始聊天”前面还塞了一个基础设施启动步骤
2. 用户目标是对话，但 UI 先把用户带进了 workspace 运维判断
3. 对首次用户来说，这个链路比预期长很多

## 5. CEO 用户旅程

CEO 路径当前是：

1. 从主导航进入 `CEO Office`
2. 系统自动查找 CEO 专属会话
3. 如果不存在，就自动创建一个 CEO conversation
4. 左侧是 CEO 历史，右侧是聊天窗口
5. 同屏再挂一个 `CEO 管理中心`，里面还有 dashboard、templates、projects、Prompt 资产

证据：

1. 进入 CEO section 时会自动查找或自动创建 CEO conversation
   - `src/app/page.tsx:421-442`
2. CEO 主视图是聊天 + 配置双栏
   - `src/app/page.tsx:1080-1137`
3. CEO 管理中心内部还包含 dashboard、templates、projects、Prompt 资产四个 tab
   - `src/components/ceo-office-settings.tsx:111-130`

这条旅程的问题在于：

1. 切换 section 会产生隐式副作用，用户并没有明确确认“创建 CEO 会话”
2. CEO 页面本身已经是一个子产品，但它又嵌在首页壳层里
3. CEO 页面内部再次内嵌 dashboard/templates/projects/config，形成二级产品壳

## 6. 配置用户旅程

想修改设置的用户当前旅程是：

1. 先在顶部图标区发现一个 `Settings` 图标
2. 点击后，整个页面切换到隐藏的 utility panel
3. 正常 sidebar 消失
4. 默认落到 `Provider 配置`
5. 如果是从 Ops 或 CEO Prompt 资产跳过来，实际上是一次跨区跳转

证据：

1. Settings 不是一级导航，而是 header 右上角 icon
   - `src/app/page.tsx:908-917`
2. 打开 Settings 后 sidebar 会被直接移除
   - `src/app/page.tsx:791-807`
   - `src/app/page.tsx:922-934`
3. Settings 默认 tab 是 `provider`
   - `src/app/page.tsx:79-83`
   - `src/lib/app-url-state.ts:48-50`
4. Settings 现在已经承载 `profile / provider / api-keys / scenes / mcp / messaging`
   - `src/components/settings-panel.tsx:157-163`
5. CEO Prompt 资产会提示用户跳到 `Settings > Profile 偏好`
   - `src/components/ceo-office-settings.tsx:268-289`

这条旅程的问题在于：

1. 关键设置已经很多，但入口仍然是工具图标级别
2. Settings 打开后会切断原 sidebar 上下文，用户容易迷路
3. Ops 和 CEO 内部都在把用户导向 Settings，说明 Settings 已经是主能力，不该继续藏在 utility panel

---

## 主要断裂点

## P0. “首页”定义本身就是断裂的

当前首页不是一个单一任务入口，而是五个并列产品：

1. `CEO Office`
2. `OPC`
3. `Chats`
4. `Knowledge`
5. `Ops`
6. 再加一个隐藏 `Settings`

证据：

1. 一级导航五项：`src/app/page.tsx:752-758`
2. Settings 作为额外 utility panel：`src/app/page.tsx:760-766`
3. URL 状态也把整个首页建模成 `section + panel + tab`：`src/lib/app-url-state.ts:6-14`

影响：

1. 用户无法回答“这里的首页到底是哪个公司驾驶舱，还是只是产品切换器”
2. 团队后续每加一个主功能，都会继续挤压首页壳层

## P0. 默认首屏与用户真实目标错位

系统默认把用户落到 `projects`，但很多关键能力并不在这里：

1. 普通对话在 `Chats`
2. CEO 决策在 `CEO Office`
3. 配置在隐藏 `Settings`
4. 运维资产在 `Ops`

证据：

1. 默认 section：`src/app/page.tsx:77`
2. URL 默认 section：`src/lib/app-url-state.ts:33-35`
3. Projects sidebar 还明确声明自己“不承载主导航”：`src/components/sidebar.tsx:373-377`

影响：

1. 首屏并没有真正对齐“用户最常见的下一步动作”
2. 首屏默认落点和主信息架构自己打架

## P0. 旅程复杂度和性能负担耦死在一起

当前首页越像“总控面板”，它就越要在首屏加载和持续轮询大量数据。

证据：

1. `Home` 首屏加载全局静态资产：`src/app/page.tsx:131-157`
2. `Home` 每 5 秒轮询 agent state：`src/app/page.tsx:211-250`
3. `Sidebar` 每 8 秒重复拉全局数据：`src/components/sidebar.tsx:183-223`
4. `Home` 还每 8 秒拉 approvals / audit：`src/app/page.tsx:712-738`
5. `ProjectsPanel` 每 10 秒拉 scheduler jobs：`src/components/projects-panel.tsx:256-262`
6. `ProjectsPanel` detail 里每 10 秒拉 detail runs：`src/components/projects-panel.tsx:368-400`

影响：

1. 用户感知到“首页很慢”
2. 机器感知到“首页一直忙”
3. 任何 section 只要挂在首页壳层内，就天然要和这些轮询共享成本

这不是接口偶发慢，而是首页被设计成“持续运转的 control plane”。

## P1. Onboarding 是一次性弹层，不是持久旅程

当前 onboarding 只有在特定条件下出现，而且可以被“稍后”直接隐藏。

证据：

1. banner 受 `onboardingDismissed` 控制：`src/app/page.tsx:687-688`
2. 触发条件苛刻：`src/app/page.tsx:707-710`
3. 入口只在 banner 里：`src/app/page.tsx:940-958`

影响：

1. 首次用户跳过一次后，很容易失去回流入口
2. setup 任务没有沉淀成“待完成的系统任务”

## P1. Sidebar 语义在不同 section 下漂移太大

Sidebar 在每个 section 做的事情完全不同：

1. `projects` 下是项目上下文树
2. `conversations` 下是 workspace selector + 对话历史
3. `ceo` 下是 CEO history
4. `operations` 下是资产概览 + 工作区控制
5. `knowledge` 下是知识条目列表

证据：

1. section meta 定义：`src/components/sidebar.tsx:367-392`
2. projects 侧栏：`src/components/sidebar.tsx:606-685`
3. conversations 侧栏：`src/components/sidebar.tsx:468-603`
4. operations 侧栏：`src/components/sidebar.tsx:720-860`

影响：

1. 左栏不再是稳定的导航构件，而是一个随 section 变形的上下文容器
2. 用户需要重新学习同一块区域在不同页面里的语义

## P1. 项目 detail 页面过载

Projects detail 当前是典型的“全塞进一个页面再说”。

证据：

1. 详情头部同时展示状态、摘要、evidence、attention：`src/components/projects-panel.tsx:671-725`
2. 同屏展示 department context：`src/components/projects-panel.tsx:728-758`
3. 同屏展示 workbench 或待决策面板：`src/components/projects-panel.tsx:1023-1233`
4. 同屏继续挂 loop summary：`src/components/projects-panel.tsx:598-600`

影响：

1. 用户在项目层无法快速判断“先看结果、先派发、先排查、还是先看部门”
2. 首次使用和回访使用都缺少清晰的信息优先级

## P1. CEO 旅程存在隐式副作用

切到 `CEO Office` 会自动寻找或创建 CEO conversation。

证据：

1. `src/app/page.tsx:421-442`

影响：

1. section 切换不再只是导航动作，而带有数据创建副作用
2. 用户难以区分“我是在进入页面”还是“系统在替我新建对象”

## P1. Settings 已经是主能力，但仍被当成辅助面板

当前 Settings 承载的内容已经很多：

1. Profile 偏好
2. Provider 配置
3. API Keys
4. Scene 覆盖
5. MCP
6. 消息平台

证据：

1. `src/components/settings-panel.tsx:157-163`

影响：

1. 它已经不是“小工具”
2. 继续把它放在 icon-only utility panel，会持续制造发现性问题

## P2. 对话旅程前置了“工作区运行态”判断

用户只是想开始聊天，但 UI 先让用户处理 workspace server 是否运行。

证据：

1. `src/components/sidebar.tsx:325-338`
2. `src/components/sidebar.tsx:239-277`

影响：

1. 首次聊天旅程被基础设施心智污染
2. 用户把“开始对话”理解成“我要先启动一个系统”

## P2. 子项目选择的心理模型不直观

当用户选择 child project 时，detail 其实先回到 top-level parent，再在内部 focus child。

证据：

1. `src/components/projects-panel.tsx:326-345`

影响：

1. 用户点了子项目，却不一定看到“纯粹的子项目详情页”
2. 层级项目的导航反馈不够直接

---

## 根因归纳

当前首页问题不是若干个散点 bug，而是三层架构混在一起：

## 1. 产品架构混合

首页同时承载：

1. 公司级入口
2. 项目执行工作台
3. 对话工作台
4. CEO 工作台
5. 运维控制台
6. 配置中心

结果就是首页不再有单一职责。

## 2. 数据架构混合

首页壳层、Sidebar、ProjectsPanel 各自都在拿自己的全局数据，没有形成明确的数据所有权边界。

结果就是：

1. 重复请求
2. 重复轮询
3. 状态同步复杂
4. 用户每打开一次首页，都在启动一套全局控制面刷新机制

## 3. 旅程架构混合

当前没有一个被明确建模的“主旅程”。

系统实际上混杂了四种不同目标：

1. setup company
2. continue execution
3. start a conversation
4. reconfigure the system

但 UI 没有先问“你现在要做哪一种”，而是默认把用户推进 `projects`。

---

## 结论

如果只修某一个按钮、某一个 tab、某一个跳转，首页还是会继续乱，因为问题根本不在单点交互，而在首页的职责边界。

当前最重要的结论不是“哪个入口再补一个按钮”，而是：

1. 不要再把新能力继续堆到 `src/app/page.tsx`
2. 不要再让首页承担更多控制面轮询
3. 不要再把一级能力藏在 utility panel 或二级壳层里
4. 必须先定义首页的单一使命，再决定哪些能力应该留在首页，哪些应该迁出

一句话总结：

当前首页不是“慢了一点的首页”，而是“被设计成超级控制面之后，必然又慢又乱的首页”。

---

## 下一步建议方向

下一阶段如果要真正收口，建议按这个顺序推进：

1. 先定义首页使命
   - 首页只做入口分流、继续上次工作、待办提醒，不再承载完整工作台
2. 再拆数据装配边界
   - Shell 只保留最小全局状态，section 数据改为按需加载
3. 再重建设置与 onboarding
   - Settings 升级为明确可发现的一级能力
   - onboarding 升级为持久 checklist，而不是一次性弹窗
4. 最后才做页面细化
   - Projects、CEO、Ops 各自收回自己的工作台和轮询逻辑

这才是能同时解决旅程断裂和首页性能问题的整体路径。
