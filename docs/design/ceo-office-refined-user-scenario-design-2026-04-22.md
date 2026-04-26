# CEO Office 精细化用户场景设计（2026-04-22）

## 目标

基于当前代码真实状态，收敛出下一阶段的前台信息架构与用户场景设计，解决以下根问题：

1. `Home`、`CEO Office`、`OPC` 三者职责重叠
2. CEO 主场景仍然是“聊天 + 右侧管理中心”，不是“经营驾驶舱”
3. 高频经营动作和低频配置动作混在同一层
4. 用户需要在 `CEO / Projects / Ops / Settings` 之间来回跳，无法在一个视角闭环

本设计不讨论底层执行器替换，不改变原生 Antigravity IDE 的 Language Server 发现、workspace 启动、provider 执行链。

---

## 一句话结论

如果当前系统的主用户真的是 CEO / 经营者，那么顶层不应该继续保留一个独立 `Home` 作为并列产品入口。

更合理的形态是：

1. `/` 直接落到 `CEO Office`
2. `CEO Office` 变成唯一的公司经营驾驶舱
3. `OPC`、`Knowledge`、`Ops`、`Settings` 全部退到“下钻工作面”
4. CEO 聊天不再占据一半主屏，而是收口成 CEO 驾驶舱中的一个指令能力

---

## 当前代码证据

当前重叠不是概念问题，而是代码已经形成双驾驶舱：

1. `src/components/home-overview.tsx`
   - 同时承担入口分流、setup 状态、continue work、统计摘要
2. `src/app/page.tsx`
   - `ceo` section 仍是双栏：
     - 左侧聊天
     - 右侧 `CeoOfficeSettings`
3. `src/components/ceo-office-settings.tsx`
   - 又内嵌：
     - `dashboard`
     - `templates`
     - `projects`
     - `config`
4. `src/components/ceo-dashboard.tsx`
   - 又继续承载：
     - 管理摘要
     - 风险面板
     - evolution
     - 部门网格
     - scheduler 摘要
     - audit
     - digest
     - `CEOSchedulerCommandCard`
5. `src/components/ceo-scheduler-command-card.tsx`
   - 又提供了一条独立的“CEO 指令中心”

所以当前不是“一个 CEO 页面不够强”，而是：

1. `HomeOverview` 是一个轻首页
2. `CEO Office` 又是一个半聊天半后台
3. `CEODashboard` 再是一个子驾驶舱
4. `CEOSchedulerCommandCard` 还是一条平行下令入口

这就是认知混乱的直接来源。

---

## 产品立场

下一阶段应该明确采用下面这套分层：

1. `CEO Office`
   - 高频经营动作的唯一主场景
   - 回答“现在公司怎么样、我该做什么、我可以立刻下什么命令”
2. `OPC`
   - 项目执行工作台
   - 回答“这个项目具体怎么跑、卡在哪、证据是什么、怎么继续”
3. `Knowledge`
   - 结果与知识沉淀浏览面
   - 回答“历史产物在哪、这件事以前怎么做、日报/周报/研究结果在哪里”
4. `Ops`
   - 低频系统运营面
   - 回答“scheduler、资产、MCP、quota、provider runtime 是否正常”
5. `Settings`
   - 用户与系统配置面
   - 回答“profile、provider、API keys、组织偏好、通知方式怎么设”

核心原则：

1. 高频经营动作进 `CEO Office`
2. 具体执行与排障进 `OPC`
3. 低频配置绝不留在 CEO 主场景
4. 任意深动作都有下钻入口，但不把下层页面重新塞回 CEO 首页

---

## 顶层信息架构

### 1. 顶层导航

建议收敛为：

1. `CEO Office`
2. `Projects`
3. `Knowledge`
4. `Ops`
5. `Settings`

建议取消独立 `Home` 一级入口。

`Chats` 不建议继续作为一级并列入口，应该改成：

1. `CEO Office` 内的 CEO 指令历史
2. 各 workspace / project / department 下的上下文对话能力

也就是说，聊天是交互方式，不是顶层产品。

### 2. 根路由

`/` 的目标语义应当是：

1. “进入 CEO 办公室”
2. 而不是“进入产品切换器”

如果担心一次性删除 `Home` 风险过大，过渡期可以：

1. `/` 仍保留 overview route
2. 但只做极薄重定向壳
3. 首屏 CTA 只保留“进入 CEO Office”

最终形态仍应去掉独立首页。

---

## 目标页面结构

`CEO Office` 不应该再是“左边聊天，右边后台 tab”。

建议变成四块固定结构：

### A. 公司脉搏区

回答：

1. 现在有哪些紧急事项
2. 哪些项目正在推进
3. 哪些任务失败或待决策
4. 今天例行任务运行是否正常

应该展示：

1. Pending approvals
2. Needs decision
3. Active projects
4. Failed / blocked runs
5. Active schedulers
6. Recent deliveries

### B. CEO 决策区

回答：

1. CEO 此刻最需要拍板的是什么
2. 哪些项目需要批准、驳回、改派、补充上下文

应该展示：

1. 待审批队列
2. 待决策队列
3. 高风险提醒
4. 可直接执行的动作：
   - approve
   - reject
   - ask follow-up
   - retry
   - reroute department
   - open project detail

### C. CEO 指令区

回答：

1. 我现在要下发什么任务
2. 这个任务是即时执行、建项目，还是创建定时任务

应该统一：

1. 当前聊天输入
2. `CEOSchedulerCommandCard`
3. 项目创建捷径
4. 调度创建捷径

也就是说，CEO 只有一个下令入口，不允许再并行存在：

1. 左侧 CEO chat
2. 右侧指令中心

两者要并成一个 `Executive Command Center`。

### D. 经营下钻区

回答：

1. 某个部门最近状态如何
2. 某个项目为什么卡住
3. 某个 routine 产生了什么产物

这里不直接放完整执行工作台，而只放：

1. 部门脉搏
2. 项目摘要
3. 例行任务摘要
4. 最近交付
5. 最近日报 / 周报

点进去再进入：

1. `Projects`
2. `Knowledge`
3. `Ops`

---

## 精细化用户场景

下面按真实使用频率拆分场景。优先级不是“技术难度”，而是“CEO 每天最可能做的事”。

## 场景 P0-1：CEO 开机晨检

### 用户目标

在 30 到 60 秒内完成公司级扫描，判断今天要不要介入。

### 进入方式

1. 打开系统
2. 直接进入 `/`
3. 自动落到 `CEO Office`

### 用户此刻真正想知道的事

1. 今天有哪些必须拍板的事项
2. 哪些项目处于风险态
3. 哪些 routine 正常运行
4. 昨天晚上到现在有什么新交付

### 首屏必须直接回答的四个问题

1. `Now`
   - 当前最高优先级事件是什么
2. `Risk`
   - 哪些项目 / run / job 异常
3. `Decision`
   - 哪些审批和决策待处理
4. `Delivery`
   - 最近完成了什么

### 主操作

1. 处理一个待审批项
2. 点开一个风险项目
3. 打开一个最新交付
4. 下发一个紧急任务

### 成功标准

用户不需要先切到 `Projects`、`Ops`、`Settings` 才能知道系统当前状态。

### 当前断点

1. `HomeOverview` 只能做浅层摘要
2. `CEO Office` 首屏还是聊天壳，不是经营态
3. 经营信息被拆散在 `home-overview`、`ceo-dashboard`、`projects-panel`

---

## 场景 P0-2：CEO 即时下令

### 用户目标

一句话把任务派发出去，不关心底层到底生成 run、project 还是 scheduler。

### 典型语句

1. “让市场部分析最近一周的竞品投放变化”
2. “让研发部评估下一个版本的技术风险”
3. “基于这个日报，拉一个项目继续跟进”

### 交互要求

系统必须在一个统一入口里完成：

1. 意图识别
2. 目标部门建议
3. 项目 / prompt / scheduler 分流
4. 执行回执
5. 后续跟踪入口

### 首次反馈必须明确告诉用户

1. 这是即时 run
2. 还是新项目
3. 还是新定时任务
4. 落到哪个部门
5. 现在可以从哪里继续跟踪

### 成功标准

用户不需要分别理解：

1. CEO chat 是一条链
2. `CEOSchedulerCommandCard` 是另一条链

当前必须合并成一个命令中心。

### 当前断点

1. CEO 聊天是一条入口
2. `CEOSchedulerCommandCard` 又是一条入口
3. 指令成功后回流路径并不统一

---

## 场景 P0-3：CEO 创建例行任务

### 用户目标

把一个已验证有价值的动作沉淀成 routine，而不是每次手工再说一遍。

### 典型语句

1. “每天北京时间 20 点生成 AI 日报”
2. “每周一上午 10 点巡检核心项目健康度”
3. “工作日早上 9 点汇总各部门风险”

### 用户真正关心的不是 cron，而是五件事

1. 谁执行
2. 什么时候执行
3. 产物发到哪里
4. 失败后谁看到
5. 如何暂停 / 恢复

### 所以在 CEO 主场景中应该展示

1. routine 名称
2. owner department
3. next run
4. last run result
5. quick pause / resume
6. 跳转 `Ops` 查看全量细节

### 成功标准

用户可以在 `CEO Office` 创建 routine，但不需要在 `CEO Office` 里维护全部 scheduler 细节。

### 当前断点

1. `CEODashboard` 里有 scheduler 摘要
2. `CEOSchedulerCommandCard` 也能建 scheduler
3. `Ops > Scheduler` 又是完整管理面
4. 三处都能做类似动作，边界不清

---

## 场景 P0-4：CEO 处理风险与卡点

### 用户目标

在问题刚暴露时快速判断：

1. 是要批准
2. 要追问
3. 要换部门
4. 要暂停
5. 还是要进入项目工作台深查

### 入口

来自：

1. 风险面板
2. 待决策队列
3. 审批队列
4. 失败的 routine / run

### 首屏必须给出的最小上下文

1. 哪个项目 / run / job
2. 谁触发的
3. 当前状态是什么
4. 为什么阻塞
5. 最近一次动作是什么
6. 推荐下一步是什么

### 在 CEO 页允许的动作

1. approve / reject
2. 要求补充信息
3. 暂停 / 恢复
4. 打开项目详情
5. 跳到知识证据

### 不应该在 CEO 页直接塞入的东西

1. 完整项目时间线
2. 全量 artifact 树
3. 所有 scheduler 字段编辑
4. 所有部门配置项

这些应下钻到对应页面。

### 当前断点

1. 风险、审批、项目卡点没有形成一个统一队列
2. 很多信息散落在项目页、审计页、scheduler 页
3. CEO 要判断问题时，必须跨页面拼上下文

---

## 场景 P1-1：CEO 查看经营成果

### 用户目标

快速浏览：

1. 最近完成了什么
2. 哪些交付值得复盘或转 routine
3. 哪些日报 / 周报值得继续跟进

### 入口

1. `CEO Office` 的最近交付区
2. `CEO Office` 的 digest / report 摘要区

### 主动作

1. 查看摘要
2. 打开对应项目
3. 打开对应知识产物
4. 基于结果再次下令

### 成功标准

CEO 可以在一个地方完成“看结果 -> 决定是否继续投入”。

### 当前断点

1. `HomeOverview` 有 continue work
2. `CEODashboard` 有 recent completions
3. `Knowledge` 又是另一套浏览面
4. 结果消费路径不统一

---

## 场景 P1-2：CEO 查看部门经营状态

### 用户目标

把部门当成经营单元，而不是只把 workspace 当成技术目录。

### 在 CEO 主场景应该能看到

1. 每个部门的身份
2. 当前活跃项目数
3. 最近交付
4. 风险状态
5. 最近 routine 输出
6. 是否仍未完成初始化

### 点开部门后应该进入一个轻量抽屉，而不是完整设置页

抽屉里回答：

1. 这个部门现在在做什么
2. 哪些项目属于它
3. 最近失败或卡住了什么
4. 需要进一步设置时再进入 department settings

### 当前断点

1. `CEODashboard` 的部门网格混合了展示、导入、设置
2. setup 和经营状态放在同一层
3. 部门是“技术配置对象”，还不是“经营对象”

---

## 场景 P2-1：低频配置与治理

### 用户目标

处理这些低频但必要的事项：

1. Provider
2. API keys
3. Prompt 资产
4. 模板
5. MCP
6. 规则
7. 通知设置

### 设计原则

这些动作不应该再留在 CEO 首屏右栏。

因为它们的共同特点是：

1. 低频
2. 配置型
3. 需要更强表单 / 列表 / 编辑器
4. 不属于“此刻公司运营发生了什么”

### 页面归属

1. `Settings`
   - profile
   - provider
   - api keys
   - messaging
2. `Ops`
   - workflow / skills / rules / MCP / scheduler 全量管理
3. `Projects`
   - 模板驱动的具体执行编排

### 当前断点

1. `CeoOfficeSettings` 把 dashboard、templates、projects、prompt assets 全塞一起
2. CEO 首屏和配置中心没有明确边界

---

## 页面职责重划

### `HomeOverview`

目标状态：

1. 过渡期保留为极薄跳转壳
2. 最终删除独立业务内容

不再承担：

1. continue work 主入口
2. setup 状态主入口
3. 公司摘要主入口

这些都应并入 `CEO Office`。

### `CeoOfficeSettings`

目标状态：

1. 不再是 tab 化“后台管理中心”
2. 改成 `CEO Right Rail` 或 `Executive Context Rail`

保留内容：

1. 当前选中对象的轻上下文
2. 快捷操作
3. 跳转按钮

移出内容：

1. templates
2. projects summary
3. prompt assets editor

### `CEODashboard`

目标状态：

1. 从“什么都挂一点”的页面
2. 收缩成：
   - company pulse
   - decision queue
   - command center
   - department pulse
   - recent delivery
   - routine summary

### `CEOSchedulerCommandCard`

目标状态：

1. 不再作为独立大卡片存在
2. 并入统一的 `Executive Command Center`

### `ProjectsPanel`

目标状态：

1. 专注项目执行与证据
2. 不再承担 CEO 总览角色

### `SettingsPanel`

目标状态：

1. 明确是配置中心
2. 不再隐藏在二级 utility panel 心智里

---

## 与原生 Antigravity IDE 的兼容边界

这套改造应该只动“前台场景编排”，不动“原生执行链”。

必须保持不变的部分：

1. Antigravity Native 的 workspace 启动逻辑
2. Language Server 发现与对应进程启动逻辑
3. provider 选择为 `Antigravity` 时的原执行路径
4. project/run/stage 的真相源
5. conversation API 与已有历史记录

可以调整的部分：

1. 哪个页面是默认 landing
2. 哪些模块在 CEO 主场景显示
3. 聊天和指令入口怎么合并
4. 低频配置页面从哪里进入

因此，这不是“改掉 Antigravity IDE”，而是：

1. 保持原生执行器存在
2. 把它放回执行层
3. 让前台控制层场景不再混乱

---

## 推荐实施顺序

### Phase 1：去首页并确立单一 landing

1. `/` 直接进入 `CEO Office`
2. `HomeOverview` 退化为过渡壳或删除

### Phase 2：合并 CEO 双指令入口

1. 合并 CEO chat 与 `CEOSchedulerCommandCard`
2. 建立统一 `Executive Command Center`

### Phase 3：拆掉 `CeoOfficeSettings` tab 化后台

1. 移出 templates
2. 移出 projects summary
3. 移出 prompt assets editor
4. 只保留右侧上下文 rail

### Phase 4：重做 CEO 主屏模块

1. 公司脉搏
2. 决策队列
3. 风险卡点
4. 部门脉搏
5. 最近交付
6. routine 摘要

### Phase 5：稳定下钻关系

1. CEO -> Project detail
2. CEO -> Knowledge artifact
3. CEO -> Ops scheduler
4. CEO -> Settings profile/provider

---

## 验收标准

完成后，应该满足下面五条：

1. 用户打开系统后，不再先思考“该去 Home 还是 CEO”
2. CEO 每日 80% 的经营动作可以在 `CEO Office` 完成
3. 任意一次下令都只有一个入口，一个回执，一个跟踪入口
4. 低频配置不再污染 CEO 主场景
5. 不影响原生 Antigravity IDE 的语言服务与执行器工作链

---

## 最终判断

你的判断是对的：

1. 当前独立 `Home` 的价值很低
2. 现在真正缺的不是“再补一个首页模块”
3. 而是把 `CEO Office` 真的做成唯一经营驾驶舱

真正要避免的不是“首页消失”，而是另一种更糟的情况：

1. 名义上删掉 `Home`
2. 实际把 `Home + CEO + 配置中心 + 调度中心` 全部堆进一个巨型 CEO 页面

所以正确方向不是简单删页面，而是：

1. 删除并列首页
2. 收缩 CEO 职责到高频经营动作
3. 把低频配置和深执行页面明确下放

这才是稳定、长期可扩展的场景设计。
