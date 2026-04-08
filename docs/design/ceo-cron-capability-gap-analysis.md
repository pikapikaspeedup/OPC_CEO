# CEO Cron 能力差距分析（实现前快照）

**日期**: 2026-04-08
**范围**: CEO Office / Scheduler / CEO Command / MCP / Event Flow

> 更新说明：本文记录的是实现前的能力差距快照。截止 2026-04-08 晚间，仓库已经补齐 CEO Dashboard 自然语言创建定时任务、`/api/ceo/command` 的 schedule intent 解析、MCP 的 scheduler 写能力，以及 scheduler 审计事件回流 CEO 视图。本文剩余价值主要在于解释当时为什么会出现这个缺口，以及哪些深层产品问题仍值得继续优化。

## 一页结论

当前系统**已经具备可工作的 Scheduler 基础设施**，但它仍然是一个面向技术参数的 Ops 工具，而不是 CEO 的原生经营能力。

问题不在“能不能存储和触发 cron job”，而在：

1. **CEO 没有创建 scheduler job 的能力入口**，只有查看和跳转入口。
2. **用户仍被迫直接配置底层字段**，例如 cron 表达式、workspace、prompt、goal。
3. **CEO 命令链路没有把 scheduler 当成可调用动作**，因此无法通过自然语言把经营动作转为定时任务。
4. **调度结果没有进入 CEO 的统一经营视图**，导致“创建了 job”与“经营上发生了什么”是断开的。

结论可以压缩成一句话：

> 现在的 Scheduler 是“系统能跑”，不是“CEO 能用”。

---

## 1. 当前交互现状

### 1.1 CEO 入口现状

当前 CEO 的调度入口链路是：

`CEO Office → Dashboard → Scheduler 卡片 → Open → 独立 Scheduler Panel`

这条链路的问题不是“找不到”，而是**层级太深且语义错误**：

1. CEO Dashboard 只展示最近 jobs 和一个 `Open` 按钮。
2. 它没有“新建定时任务”“把当前经营动作转为 cron”“从项目生成定时任务”这类直接动作。
3. 用户必须离开 CEO 当前思路，跳到一个技术表单页，切换成配置者视角。

### 1.2 创建交互现状

在 Scheduler Panel 里点击 `New` 后，弹出的仍然是底层配置表单，而不是业务语义化引导。

用户需要直接输入或决定：

1. `name`
2. `type = cron | interval | once`
3. `cronExpression`
4. `actionWorkspace`
5. `actionPrompt`
6. `actionTemplateId`
7. `actionStageId`
8. `departmentWorkspaceUri`
9. `opcGoal`
10. `opcSkillHint`

这意味着系统默认把 CEO 当成一个知道底层运行时契约的人，而不是经营者。

### 1.3 同类交互问题已经在别处出现

这不是 Scheduler 独有的问题。CEO Dashboard 添加部门时，也仍然使用浏览器 `prompt()` 直接要求用户输入路径。

这说明当前 CEO 面板整体上仍带着一层明显的“工程配置台”味道，而不是“经营指挥台”。

---

## 2. 当前代码现状

### 2.1 后端基础设施其实已经完整

Scheduler 基础能力并不缺：

1. [src/lib/agents/scheduler.ts](src/lib/agents/scheduler.ts) 已实现 `createScheduledJob()`、`triggerScheduledJob()`、`listScheduledJobsEnriched()` 以及轮询 `tick()`。
2. [src/app/api/scheduler/jobs/route.ts](src/app/api/scheduler/jobs/route.ts) 已提供 `GET/POST`。
3. [src/app/api/scheduler/jobs/[id]/route.ts](src/app/api/scheduler/jobs/[id]/route.ts) 已提供 `GET/PATCH/DELETE`。
4. [src/app/api/scheduler/jobs/[id]/trigger/route.ts](src/app/api/scheduler/jobs/[id]/trigger/route.ts) 已提供手动触发。
5. [src/lib/agents/scheduler-types.ts](src/lib/agents/scheduler-types.ts) 已支持 `cron / interval / once`、`dispatch-pipeline / health-check` 以及 `opcAction.create_project`。

所以，这个子系统当前的真实状态是：

> **后端已具备“可运行的定时调度器”，但没有上升为 CEO 原生能力。**

### 2.2 前端已经有 CRUD，但它是 Ops 表单，不是 CEO 能力

[src/components/scheduler-panel.tsx](src/components/scheduler-panel.tsx) 的职责很明确：

1. 列表
2. 新建
3. 编辑
4. 删除
5. Trigger

但它的产品定位也非常明确：

1. 直接暴露 `Cron Expression`
2. 直接暴露 `Workspace`
3. 直接暴露 `Prompt`
4. 直接暴露 `Department Workspace URI`
5. 直接暴露 `Task Goal`

也就是说，这个面板本质上是**给理解运行时结构的人**用的。

### 2.3 CEO 视图只接了“查看”，没有接“创建能力”

1. [src/components/ceo-dashboard.tsx](src/components/ceo-dashboard.tsx) 会调用 `api.schedulerJobs()` 拉取最近 jobs。
2. 同一个组件只提供 `onOpenScheduler()`，没有直接创建动作。
3. [src/components/ceo-office-settings.tsx](src/components/ceo-office-settings.tsx) 也只是把这个打开动作透传下去。

这说明现在 CEO 视图和 Scheduler 之间的耦合点，只停留在“信息展示 + 页面跳转”。

### 2.4 CEO Command 链路没有 scheduler 动作模型

从现有代码和搜索结果看，CEO 命令链路目前并没有一个显式的 scheduler 创建能力：

1. [src/app/api/ceo/command/route.ts](src/app/api/ceo/command/route.ts) 仍然把自然语言交给 `processCEOCommand(...)`。
2. 现有仓库中没有找到与 scheduler / cron / schedule 相关的 CEO prompt、playbook 或 agent 分支实现。
3. [docs/design/ceo-native-conversation-design.md](docs/design/ceo-native-conversation-design.md) 也明确写了当前 CEO 路径仍是 `llm-oneshot`，**无多轮对话、无流式、无工具调用**。

这意味着即便用户对 CEO 说“每天 9 点让市场部做日报”，当前系统也缺一层把自然语言意图翻译为 `ScheduledJob` 的原生能力。

### 2.5 MCP 也只有只读，没有创建能力

[src/mcp/server.ts](src/mcp/server.ts) 当前只暴露了 `antigravity_list_scheduler_jobs`，没有 `create/update/delete/trigger scheduler job` 的工具。

因此 CEO 即使以后走 MCP 工具路径，目前也依然**只能看，不能建**。

### 2.6 CEO 事件流里没有 scheduler 领域事件

[src/lib/ceo-events.ts](src/lib/ceo-events.ts) 目前只是把“打开调度”作为一个导航动作拼进项目事件里，但没有：

1. job 创建事件
2. job 失败告警
3. job 触发成功事件
4. job 生成项目后的经营回链

所以 CEO 看到的是“有个 Scheduler 页面”，而不是“有哪些经营动作正在按计划发生”。

---

## 3. 现状与目标之间的关键差距

### Gap 1: 能力差距

**现状**：Scheduler 只能通过前端表单或裸 API 创建。  
**目标**：CEO 应该能直接创建、修改、暂停、恢复 cron。

根问题：Scheduler 只是一个子系统 API，不是 CEO 的动作词表。

### Gap 2: 语义差距

**现状**：用户要写 `cronExpression`、`workspace`、`prompt`、`goal`。  
**目标**：CEO 应该表达“每天 9 点收日报”“每周一巡检健康度”“明早给设计部建一个 ad-hoc 项目”。

根问题：当前产品暴露的是运行时参数，不是经营语义模板。

### Gap 3: 上下文差距

**现状**：用户要自己知道部门 workspace、模板、stage、prompt。  
**目标**：CEO 应该从现有公司上下文自动解析这些信息，只在有歧义时做确认。

根问题：系统已经有部门、项目、模板、workspace 上下文，但创建 job 时没有复用。

### Gap 4: 入口差距

**现状**：只能从 Scheduler 面板开始创建。  
**目标**：应该能从 CEO Dashboard、Department 卡片、Project 卡片、Digest、事件流里顺手转成定时任务。

根问题：Scheduler 没有嵌入 CEO 主工作流，只是被挂成一个二级工具页。

### Gap 5: 回看差距

**现状**：看得到最近 jobs，但看不到 job 对经营结果的影响。  
**目标**：CEO 应该能看到“这个 job 最近是否成功、触发了哪些项目、失败是否需要干预”。

根问题：job 结果与 CEO 事件流、项目流、部门流没有形成闭环。

### Gap 6: 对话能力差距

**现状**：CEO 命令链路本质仍是 one-shot 决策，不擅长多轮澄清和工具调用。  
**目标**：CEO 应该能对 schedule 需求做最小澄清，例如“是每天工作日还是每天自然日？”

根问题：当前 CEO 架构更擅长“立即 dispatch”，不擅长“逐步构建计划对象”。

---

## 4. 根因判断

这次问题的根因，不是单点 bug，而是两套架构长期分层不一致：

1. **Scheduler 被实现成运行时基础设施。**
2. **CEO 被实现成一次性决策和派发器。**
3. **两者之间没有一个“经营意图 → 调度对象”的翻译层。**

因此今天的行为就非常自然：

1. 系统确实能创建 cron。
2. 但 CEO 不会创建 cron。
3. 最终只剩用户自己去填底层参数。

这也是为什么你会觉得“太傻了”——因为产品在让用户替系统做对象建模。

---

## 5. 代码和文档是否已经意识到这个问题

答案是：**是，系统其实已经在文档层承认了这个缺口，但实现没有跟上。**

最直接的证据在 [delivery/ceo-memo-context-and-scheduler.md](delivery/ceo-memo-context-and-scheduler.md)：

1. 它明确写了“当前缺的不是定时器本身，而是三层闭环”。
2. 它把“把 Scheduler 抬到 CEO 主视角”列为 P0。
3. 它把“加入从 CEO 自然语言命令直接创建 scheduler job 的能力”列为第三阶段目标。

也就是说，问题已经被识别过，但当前仓库实现仍停留在“基础能力可用、CEO 原生能力缺失”的阶段。

---

## 6. 当前最合理的目标状态

如果按产品正确方向表述，CEO 的 cron 能力应该长成这样：

1. CEO 说一句自然语言，例如“每天工作日上午 9 点让市场部生成 SEO 日报”。
2. 系统自动解析部门、workspace、动作类型、触发周期。
3. 系统优先套用业务模板，而不是直接暴露底层字段。
4. 只有在存在歧义时，再做一轮极小确认。
5. 最终生成标准 `ScheduledJob`，继续复用现有 scheduler.ts 和 `/api/scheduler/jobs`。
6. 创建结果进入 CEO 的事件流、审计流和项目流。

换句话说，真正需要新建的不是另一个 Scheduler，而是：

1. **CEO 的 schedule intent 模型**
2. **CEO 到 scheduler 的创建动作**
3. **几个高频经营模板**
4. **调度结果回流 CEO 视图的闭环**

---

## 7. 结论

当前系统的真实阶段可以定义为：

**Scheduler-infra ready, CEO-native scheduling missing.**

更具体一点：

1. 你已经有了 job store、cron parser、trigger loop、API 和 CRUD UI。
2. 你还没有把“创建 cron”升级成 CEO 的原生动作能力。
3. 所以现在用户仍然在替 CEO 做底层配置，这就是产品体验的根本断层。

下一步如果要做，不应该优先继续打磨那个底层表单，而应该先把“CEO 自然语言创建 schedule”打通成一条最小主链路。