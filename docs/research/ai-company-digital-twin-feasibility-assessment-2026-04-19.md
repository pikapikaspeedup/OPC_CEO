# Antigravity 是否足以承载「AI 公司 + 数字孪生 CEO」愿景评估

**日期**: 2026-04-19  
**目标问题**: 当前以 DAG / workflow / scheduler / department 为核心的 Antigravity 体系，是否足以支撑一个“AI 公司”形态：

- AI CEO = 用户的数字分身 / 数字孪生
- 部门 = 用户要持续推进的不同业务方向
- CEO 负责派发与调度
- 同时支持 DAG、workflow、一次性任务、定时任务
- 有部门级 OKR、部门级自我迭代、Skill / workflow 级别自我迭代、CEO 自我迭代
- CEO 能主动找人（IM / 通知）

---

## 一、结论

**不能只靠当前 DAG 这一套直接满足最终愿景。**

更准确地说：

1. **当前 DAG / workflow / scheduler 已经足够做“执行平面（execution plane）”的核心引擎**
2. **但它还不足以单独构成“AI 公司操作系统”**
3. **你的最终愿景需要至少四个平面共同成立，而当前 DAG 主要只覆盖了其中一个半**

我会给一个直接判断：

> **如果你的问题是“当前 DAG 体系能不能做 AI 公司里的任务执行和治理骨架？”**
>
> 可以，甚至已经比较强。
>
> **如果你的问题是“当前 DAG 体系能不能直接支撑数字孪生 CEO + 部门自治 + OKR 闭环 + 自我迭代 + 主动触达？”**
>
> 还不行。当前只到“强执行引擎 + 部分管理壳层”，离“AI 公司”还差几个关键闭环。

---

## 二、先把愿景拆开

你的目标其实不是一个单一系统，而是四层叠加：

### 1. 执行平面（Execution Plane）

负责：

- 跑 DAG
- 跑 workflow
- 跑 prompt 模式
- 跑一次性任务 / 定时任务
- 做 review / gate / intervention / checkpoint / audit

### 2. 管理平面（Management Plane）

负责：

- CEO 的身份与治理策略
- 部门配置、部门职责、部门技能
- 目标管理（OKR）
- 资源约束（Token / Provider / 权限）
- 组织级事件、审批、经营看板

### 3. 学习平面（Learning Plane）

负责：

- 部门从 run 中沉淀知识
- Skill / workflow 被识别为可复用资产
- CEO 根据历史修正派发策略
- 部门根据完成情况更新自己的操作规范

### 4. 沟通平面（Communication Plane）

负责：

- CEO 找你
- 部门找 CEO
- 审批 / 告警 / 周报 / 申请报告 / 结果回执
- 会话 / Inbox / 外部 IM / Webhook

现在最大的结构问题不是 DAG 本身，而是：

> **你现在有一个很强的执行平面雏形，但管理、学习、沟通三个平面都还没闭环。**

---

## 三、当前 DAG 体系已经能满足哪些部分

## 1. 任务执行骨架：可以

这一块其实是当前系统最强的部分。

从现有代码和文档看，你已经具备：

- 显式 DAG 编排
- review-loop
- fan-out / join
- gate 审批
- checkpoint / journal / intervention
- prompt-mode 轻执行
- scheduler 定时任务

参考：

- `docs/agent_research/Antigravity Anti-multi-agent-mechanism-deep-analysis-2026-04-19.md`
- `src/lib/agents/scheduler.ts`
- `src/lib/agents/prompt-executor.ts`

这意味着下面这些能力你已经基本具备：

- 一次性复杂任务：能做
- 多部门多阶段串并联：能做
- 固定 workflow：能做
- 定时任务：能做
- 审批 / 卡点 / 续跑基础：部分能做

### 为什么说这块已经够强

`scheduler.ts` 已经支持：

- `once`
- `interval`
- `cron`

也支持多种 action：

- `dispatch-pipeline`
- `dispatch-prompt`
- `create-project`
- `health-check`

这说明在“时间触发 + 任务触发 + DAG / workflow 执行”这一层，骨架已经成立。

而 `prompt-executor.ts` 也说明你已经有：

- 无固定 pipeline template 的 prompt-mode
- workflow preflight / finalize
- 单 run evaluate

这对于“成熟 workflow”和“轻任务”非常关键。

### 结论

**如果只看执行引擎，当前 DAG 这套不是问题，反而是强项。**

---

## 2. 部门作为任务归属单元：基本可以

这一层已经有雏形，而且方向是对的。

`DepartmentConfig` 当前已经有：

- `name`
- `type`
- `description`
- `templateIds`
- `skills`
- `okr`
- `provider`
- `tokenQuota`

说明“部门”已经不是 UI 装饰，而是实际配置边界。

这使得你能做：

- 按部门派发任务
- 按部门绑定 provider
- 按部门挂 skills / workflows
- 按部门做配额和角色化人设

这正是“AI 公司”里部门作为工作单元的必要基础。

### 但这里有个限制

当前的部门更多还是：

> 一个带配置的工作区

而不是：

> 一个持续存在、能基于 OKR 自治、能长期规划的 Agent 组织单元

所以这层只能说“基础模型对了”，还不是“自治系统已成立”。

---

## 3. CEO 做任务派发：可以，但还只是调度器，不是数字孪生

现在的 CEO 已经能做：

- 读取部门配置
- 用 LLM 解析命令
- 创建项目
- 即时派发 prompt / template
- 创建定时任务

而且现在还是 playbook-driven parser，而不是纯 hardcode parser。

这说明：

- 它已经不是简单 if/else 路由器
- 但它也还不是“持续存在的 CEO 智能体”

### 当前更像什么

当前 `ceo-agent.ts` 更像：

> 一个带 playbook 的 LLM 命令路由器 / 调度入口

它的职责是：

- 收到一条 CEO 指令
- 解析结构化 intent
- 选择立即执行、创建项目、创建调度任务，或者 `report_to_human`

### 它不像什么

它不像：

- 有长期人格记忆的 CEO
- 会持续监控组织状态的 CEO
- 会主动重写自己策略的 CEO
- 会根据 OKR 和历史行为长期修正决策风格的 CEO

所以：

**CEO 调度入口已经有了，但“数字孪生 CEO”远未闭环。**

---

## 四、哪些关键目标，当前 DAG 体系还不能满足

## 1. AI CEO = 数字分身 / 数字孪生：当前还不够

这件事不是靠 DAG 解决的，而是靠：

- 长期身份记忆
- 持续偏好与决策风格
- 经营状态感知
- 主动行为能力
- 长期反馈修正

当前 CEO 相关能力存在两个根本限制：

### 限制 A：CEO 仍然偏 stateless request handler

当前 `/api/ceo/command` 的工作方式本质上还是：

- 收请求
- 读部门
- 调 `processCEOCommand`
- 返回结果

这更像：

- command endpoint

而不是：

- 持续驻留的 CEO actor

### 限制 B：CEO 的长期记忆和自我修正体系不完整

虽然系统已经有 CEO workspace、playbook、conversation 与 dashboard 视图，
但还没有形成：

- CEO 自己的长期经营记忆
- CEO 的策略学习
- CEO 的偏好演化
- CEO 基于历史任务成败做派发纠偏

换句话说，**当前 CEO 更像“你的智能调度代理”，不是“你的数字孪生 CEO”。**

---

## 2. OKR 现在是数据字段，不是闭环系统

这是一个硬缺口。

当前 `DepartmentOKR` 类型已经存在，UI 也能编辑展示。
但我没有找到任何后端闭环逻辑会在 run 完成后自动：

- 更新 key result 的 `current`
- 评估任务是否推动了 OKR
- 用 OKR 约束 dispatch
- 围绕 OKR 生成经营动作

目前部门接口本质仍然是：

- GET 读取 `.department/config.json`
- PUT 覆盖写回 `.department/config.json`

这说明 OKR 当前是：

> 配置模型 / 展示模型

而不是：

> 驱动调度与资源分配的控制系统

### 这意味着什么

你想要的：

- 部门级 OKR
- OKR 级联到任务
- 完成后自动更新 KR
- 偏离目标时触发调整

当前都还没有闭环。

所以从“AI 公司”角度说，**OKR 还没有真正进入 runtime。**

---

## 3. 部门级自我迭代：只有局部能力，没有自治闭环

当前系统已经有两件相关的基础能力：

### 已有能力 A：运行结果自动记忆沉淀

`finalization.ts` 会在部分 run 完成后调用 `extractAndPersistMemory(...)`。

这说明系统已经开始做：

- 从执行结果中抽出经验
- 写入部门记忆

### 已有能力 B：记忆可以桥接到执行层

`department-memory-bridge.ts` 已经把：

- 部门共享记忆
- provider-specific 记忆
- organization memory

注入到 `memoryContext`，并通过 backend 在 run 前使用。

这比旧设计文档里“memory hook 空架子”的状态已经前进了一步。

### 但为什么还不能叫“部门自治迭代”

因为当前还缺：

1. **自动提炼质量不高**
   - 当前提取仍偏简化，不是稳定的 LLM 级知识归纳体系
2. **没有反向作用到调度策略**
   - 记忆被注入了，但不等于部门会主动调整流程
3. **没有目标层闭环**
   - 记忆没有和 OKR、资源、任务成功率形成联动
4. **没有部门级 planner**
   - 部门不会定期主动问自己“要不要改规则 / workflow / skill”

所以当前更像：

> 有记忆沉淀

而不是：

> 有自我迭代

---

## 4. Skill / workflow 自我迭代：有提示，没有闭环

这一点也很关键。

当前 `department-execution-resolver.ts` 里已经出现了一个很有价值的信号：

- 当 prompt mode 没命中现成 workflow，只能靠 skill 或裸 prompt 完成时
- 系统会生成 `workflowSuggestion.shouldCreateWorkflow = true`

这说明你们已经意识到：

> 反复出现的任务模式，应该被提升为 workflow 资产。

### 但它还停在哪

目前它更像：

- 建议信号
- 分析信号
- 提醒 UI / 人类“这里可以沉淀 workflow”

而不是：

- 自动生成 workflow 草案
- 自动跑回归验证
- 自动进入审批
- 自动替换旧 skill / old workflow

这意味着：

**Skill / workflow 自我迭代还停留在“发现机会”，没有进入“受控进化闭环”。**

---

## 5. CEO 自我迭代：目前几乎没有闭环

你想要的 CEO 自我迭代，实际上至少要包括：

1. CEO 对自己派发结果有复盘
2. CEO 对部门能力模型有修正
3. CEO 对 workflow 选择有策略更新
4. CEO 对沟通风格、节奏、关注点有持续拟合

而当前 CEO 的主要输入仍然是：

- playbook
- 当前命令
- 当前部门配置

它还没有形成：

- 经营日志 → CEO 策略更新
- 成功 / 失败模式 → 调度策略修正
- 用户反馈 → CEO 人格拟合

所以这一层离“数字孪生”还有明显距离。

---

## 6. CEO 主动找你（IM 等）：只有通知骨架，还不是通用外呼系统

当前系统确实已经有外部通知方向的骨架：

- `WebChannel`
- `IMChannel`
- `WebhookChannel`

也有：

- approval 链接
- 一键 approve/reject
- webhook 分发

### 但当前主要还是审批导向

`IMChannel` 现在聚焦的是：

- CEO 审批请求通知

而不是：

- CEO 主动晨报
- CEO 主动复盘
- CEO 主动催办
- CEO 主动经营汇报

更关键的是，`approval/dispatcher.ts` 里的 follow-up callback 现在仍然是 placeholder：

- 反馈通知 placeholder
- callback 执行 placeholder
- `resume_run` / `notify_agent` / `update_quota` 还没有真正闭环执行

这说明现在的主动外呼能力仍然主要停留在：

> “发一个审批通知”

还不是：

> “CEO 有通用主动外联能力，并且外联后能真正驱动系统状态变化”

---

## 7. 多机 AI 公司：当前还不行

如果你的 AI 公司愿景包含：

- 总部 / 分支机构
- 多电脑 / 多服务器上的部门
- CEO 统一调度

那当前也还不够。

虽然已有 Cloudflare Tunnel、Gateway、workspace 注册这些基础设施方向，
但多机协同、分布式记忆、统一组织视图仍然是规划态，不是闭环态。

---

## 五、所以当前 DAG 体系到底覆盖了你愿景的多少

我会给一个非常直接的分层判断：

## 1. 作为“执行内核”覆盖度很高：70-80%

当前 DAG / workflow / prompt-mode / scheduler / approval / checkpoint / intervention 这一整层，
已经足够支撑：

- 复杂任务执行
- 轻 workflow 执行
- 定时任务
- 多阶段任务治理
- 任务审计和恢复

这部分不用推翻。

## 2. 作为“AI 公司操作系统”覆盖度只有 35-45%

因为你缺的不是“再多几个 DAG 节点”，而是：

- 持续存在的 CEO actor
- OKR runtime
- 组织级与部门级学习闭环
- Skill / workflow 演化管道
- 通用主动通知与续跑闭环
- 多机组织注册与统一调度

所以如果把整个愿景看成 100 分：

- 执行内核：高分
- 组织操作系统：中低分

---

## 六、我对架构方向的建议

## 方向 1：不要把 DAG 当作“AI 公司”的总架构

DAG 应该是：

- Execution Plane 的一个核心子系统

而不是：

- 整个 AI 公司模型本身

也就是说，你的最终系统应该是：

### A. CEO / Organization Plane

负责：

- CEO 数字分身
- 组织状态
- OKR
- 经营事件
- 审批
- 决策策略

### B. Department Plane

负责：

- 部门 identity
- 部门 provider / quota / memory / skills / workflows
- 部门自治规则

### C. Execution Plane

负责：

- workflow-run
- review-flow
- DAG orchestration
- scheduler
- intervention

### D. Learning Plane

负责：

- run → memory
- memory → policy / skill / workflow proposal
- proposal → evaluation / approval / rollout

### E. Communication Plane

负责：

- CEO Office
- approvals
- IM / webhook / inbox / digest

---

## 方向 2：让 CEO 变成常驻 actor，而不是只保留 command parser

你最终要的是“数字孪生 CEO”，所以应该新增一个长期存在的 CEO runtime 概念：

- 持有长期 memory / profile / strategy
- 消费组织事件
- 周期性复盘
- 主动发起任务
- 主动联系你
- 跟踪部门状态

当前 `/api/ceo/command` 继续保留，但它应该只是：

- CEO 的一个入口

而不是：

- CEO 本体

---

## 方向 3：把 OKR 变成真正的 runtime contract

建议后续不要把 OKR 只放在 `.department/config.json` 里展示。

要让 OKR 真正进入 runtime：

1. Dispatch 前判断任务是否符合部门目标
2. Run 完成后尝试映射 KR 进度变化
3. 部门 digest 输出 OKR delta
4. CEO 看板基于 KR 偏差发起干预
5. 部门资源申请与 OKR 绑定

如果没有这一步，AI 公司会一直停留在“任务工厂”，上不去“经营系统”。

---

## 方向 4：把 workflow / skill 自我迭代做成受控流水线

现在已有 `workflowSuggestion` 信号，这很好。

下一步不应该直接自动覆盖资产，而应该做成：

1. 发现可沉淀模式
2. 生成 workflow / skill 草案
3. 用历史任务回放测试
4. 交 CEO 或部门负责人审批
5. 发布为 canonical asset
6. 观察发布后的成功率

这样你才能拥有真正可控的“自我迭代”。

---

## 方向 5：把通知系统从“审批通知”升级为“经营外呼总线”

现在的 channel 体系可以保留，但需要扩展用途：

- 审批通知
- CEO 日报
- CEO 周报
- 部门异常告警
- 资源申请结果
- 任务完成回执
- CEO 主动提问 / 提醒

而且“发消息”之外，要真正接通：

- callback
- resume
- notify_agent
- update_quota

否则就是“有外呼，没有闭环动作”。

---

## 七、对你问题的最终回答

> “你看看我当前的 DAG 这一套是不是能满足？”

我的直接回答是：

**不能单独满足，但它已经是你最终系统里最重要的一块底盘。**

更具体地说：

1. **能满足的部分**
   - DAG / workflow / prompt / scheduler / review / gate / audit / checkpoint
   - 也就是“AI 公司里的执行与治理内核”

2. **不能满足的部分**
   - 数字孪生 CEO
   - OKR 闭环
   - 部门自治与自我迭代闭环
   - workflow / skill 自进化闭环
   - CEO 主动找你且能驱动系统状态变化
   - 多机组织级统一运营

3. **正确的定位**
   - 当前 DAG 体系应该降级为 `Execution Plane`
   - 然后在它上面补：
     - `Organization / CEO Plane`
     - `Learning Plane`
     - `Communication Plane`

一句话总结：

> **你现在有一台很强的“AI 公司执行发动机”，但还没有完整的“AI 公司操作系统”。**

---

## 八、建议的下一阶段优先级

如果你接下来真要往这个终局推进，我建议优先顺序是：

1. **明确四平面架构**
   - Execution / Management / Learning / Communication

2. **先把 CEO 从 parser 升级成 actor**
   - 持久状态
   - 事件消费
   - 主动行为

3. **把 OKR 真正接入 runtime**
   - dispatch / digest / review / quota

4. **把 workflow-run / review-flow / DAG-orchestration 三档执行模型明确化**
   - 避免所有东西都被扔进 DAG

5. **补齐学习闭环**
   - run → memory → proposal → evaluation → rollout

6. **最后扩展主动外呼与多机协同**
   - IM / webhook / callback / distributed branch model

