# Antigravity「DAG 优先」倾向与「Workflow 优先」收口评估

**日期**: 2026-04-19  
**背景**: 围绕“成熟任务是否被过度拉入 DAG / 多 Agent / 重治理框架”做一次面向当前代码与既有研究文档的收口分析。

---

## 一、先说结论

你的判断基本是对的。

Antigravity 当前不是“不能做轻流程”，而是**整体架构叙事、资产模型和主路径心智都更偏向 DAG / Group Runtime / Project Orchestration**，于是会给人一种：

> 任何稍微正式一点的任务，都应该先被建模成 pipeline、group、review-loop、fan-out/join。

这在复杂软件交付、多人协同、需要审计回放的场景里是对的；但对“AI 生成日报”这种**目标稳定、步骤稳定、验收稳定、并发价值低**的成熟任务来说，确实显得偏重。

更准确地说，当前问题不是“有 DAG”，而是：

1. **DAG 的存在感太强**
2. **轻执行通道的产品语义太弱**
3. **Template / Group / Stage 这套建模默认把复杂性抬高了**

所以用户感知会变成：**DAG 不是备选项，而像是默认答案。**

---

## 二、为什么会让人感觉“DAG 优先”

### 1. Antigravity 的底层哲学本来就是治理优先

现有深度分析已经把 AG 定义为：

- 显式 DAG 编排
- 中央治理框架
- 约束、审查、日志、恢复优先

这不是错配，而是架构本意。

参考现有研究：

- `docs/agent_research/Antigravity Anti-multi-agent-mechanism-deep-analysis-2026-04-19.md`
  - 明确把 AG 定义为“显式 DAG 编排 + 中央治理”
  - 同时指出其核心优势是可预测性、故障恢复、可观测性
  - 也明确指出其主要代价是 Token 效率、灵活性、隔离成本

换句话说，AG 的默认设计出发点一直是：

> 先假设任务是“项目交付”，再思考如何让 AI 在这个交付系统里可控地运行。

这天然会把系统推向重 orchestration。

### 2. Template → Group → Stage 的抽象会放大复杂任务心智

当前资产结构不是直接围绕“一个成熟 workflow 如何执行”展开，而是围绕：

- Template
- Group
- Pipeline / Graph
- ExecutionMode
- Source Contract

来组织。

这套抽象在复杂项目里成立，但它把“成熟单任务”也放进了同一套框架里。

从 `docs/template-vs-group-analysis.md` 可以看出，当前设计里：

- Template 管流程
- Group 管执行模式与角色
- Stage 只是引用 Group

这会导致一个副作用：

> 系统更擅长表达“多阶段工程项目”，不擅长表达“单任务成熟流程”。

### 3. UI / 控制面也在强化这种印象

当前系统大量围绕这些概念组织观察与控制：

- Project
- Pipeline DAG
- Stage
- Review Outcome
- Fan-out / Join
- Supervisor
- Checkpoint

这对复杂任务非常有价值，但对日报、摘要、例行巡检这类任务来说，用户真正关心的往往不是 DAG，而是：

1. 命中了哪个 workflow
2. 跑没跑完
3. 结果产物对不对
4. 失败时能不能快速重跑 / 诊断

如果系统默认展示的是“项目治理视角”，用户自然会觉得框架过重。

---

## 三、但也要说清：系统里其实已经有“轻路径”

这点很关键。

当前代码并不是只有 DAG 这一条路。`src/lib/agents/prompt-executor.ts` 已经实现了一条相对轻量的执行通道。

它的特点是：

1. 明确写着“without a fixed pipeline template”
2. 只创建一个 `prompt-mode` run
3. 仍然保留 workflow preflight / finalize、artifact、run history、evaluate
4. 不要求 fan-out / join / review-loop / graph compile

这其实已经非常接近你说的那种：

> “成熟 workflow 任务，不需要复杂 DAG，只要简单执行与监督收敛。”

也就是说，**技术上已经有雏形，产品上还没有把它扶正成一等公民。**

---

## 四、日报为什么就是“轻 workflow”而不是“重 DAG”

以日报生成为例，它通常具备下面这些特征：

### 1. 目标稳定

不是开放式问题求解，而是固定目标：

- 汇总今天
- 提炼重点
- 输出特定格式

### 2. 步骤稳定

通常是一个成熟的顺序链：

1. 读取上下文
2. 整理素材
3. 生成日报
4. 做简单校验
5. 输出结果

这本质上更像一个**单演员 workflow**，而不是多节点协作图。

### 3. 并行收益低

日报不是拆 8 个子问题并发做再汇总就一定更好。
很多时候并发只会增加：

- 上下文分裂
- 汇总成本
- token 消耗
- 结果不一致风险

### 4. 监督方式应该轻，而不是多层治理

日报最合适的监督一般是：

- 输入准备是否完成
- 输出格式是否符合要求
- 是否命中了既定 workflow
- 是否存在空内容 / 结构缺项 / 日期错误

这更像：

- preflight
- finalize
- schema / checklist verification
- 失败诊断 + retry

而不是：

- 多轮 review-loop
- 多角色串审
- project checkpoint
- fan-out / join

除非日报本身被升级成了真正的复杂情报生产链。

---

## 五、现有代码与文档已经支持这个判断

### 1. AG 的主框架确实偏重治理与 DAG

从已有研究可确认：

- `docs/agent_research/Antigravity Anti-multi-agent-mechanism-deep-analysis-2026-04-19.md`
  - 系统分层明确包含 `Dispatch Service`、`Group Runtime`、`Fan-Out Controller`、`DAG Pipeline`、治理层
  - review-loop、fan-out/join、checkpoint、journal、supervisor 都是主框架里的强存在组件

这说明“你感觉它重”，不是错觉，是结构事实。

### 2. 轻通道已存在，但定位不够清晰

`src/lib/agents/prompt-executor.ts` 已经说明：

- prompt 模式就是“without a fixed pipeline template”
- 可以解析 `resolvedWorkflowRef`
- 可以做 `workflow.preflight` / `workflow.finalize`
- 可以产出 `task-envelope`、`result-envelope`、artifact manifest
- 还能做单 run 的 `evaluate`

这说明系统并不缺“轻执行引擎原型”，缺的是：

- 清晰分层
- 默认路由策略
- UI 呈现语义

### 3. 日报场景其实已经更接近 prompt/workflow，而不是 DAG

现有日报 runbook 也能证明这一点。

`docs/research/native-codex-daily-digest-cli-runbook-2026-04-17.md` 写得很清楚，核心验收点是：

- `resolvedWorkflowRef = /ai_digest`
- run 完成
- project 完成
- 结果文件写出

这里真正关键的是 workflow 命中与结果落盘，而不是 DAG 本身。

也就是说，**系统已经在实践中把日报当作 workflow 任务用了，但在总体框架话语里仍然被包裹在 project / run / pipeline 体系之下。**

---

## 六、我对这个问题的核心判断

### 判断 1：DAG 不该消失，但必须降级为“复杂任务专用”

DAG 的价值非常真实，尤其适用于：

- 多阶段依赖明确
- 多角色协同明确
- 需要并行拆分
- 需要人工干预 / 恢复 / 回放
- 需要强审计和强契约

这些场景里，AG 的优势反而很突出。

但 DAG 不应该继续承担“成熟单任务工作流”的默认建模方式。

### 判断 2：对成熟任务，最优解不是“去 DAG”，而是“明确轻执行层”

真正应该做的不是把 DAG 删除，而是明确区分三种执行档位：

1. **Microflow / Workflow Run**
   - 单任务
   - 单 actor
   - 可附带 workflow hooks
   - 轻校验、轻诊断、轻重试

2. **Review Flow**
   - 单主执行者 + reviewer
   - 有质量门控，但不需要完整 DAG
   - 适合高价值文档、方案、PR 评审

3. **DAG Orchestration**
   - 多阶段依赖
   - fan-out / join
   - 多角色协作
   - checkpoint / intervention / audit 重治理

现在的问题是，这三种东西在用户侧还没有被充分拉开。

### 判断 3：现在确实有一点“把项目框架误当成任务执行器”

AG 擅长的是项目治理框架。

但日报、情报摘要、固定巡检这类任务，本质更像：

- Job Runner
- Workflow Runner
- Prompt App with hooks

如果把它们全部塞进“项目编排系统”的表达里，系统就会显得用大炮打蚊子。

---

## 七、我建议的方向

## 方向 A：让 Workflow Run 成为一等公民，而不是 DAG 的简化版

建议在概念层面正式立一个独立档位：

- `executionProfile: "workflow-run"`

它的语义应该非常明确：

- 单 run
- 单主 agent
- 允许 workflow preflight / finalize
- 允许 evaluate / retry
- 允许简单 guardrails
- 不进入 DAG 编辑器心智
- 默认不展示 pipeline / group / stage

一句话：

> 它不是“小一点的 DAG”，而是完全不同的执行产品。

## 方向 B：把 DAG 变成“显式升级选项”

不要再让简单任务默认落到 project orchestration 语义里。

更好的路由应该是：

- 能被单 workflow 吞掉的任务，先走 workflow-run
- 只有在满足复杂性条件时，才升级到 review-flow 或 DAG

可用的升级信号包括：

- 需要两个以上不同角色
- 明确存在上游/下游依赖
- 需要并发拆包
- 需要阶段级人工批准
- 需要 checkpoint / replay / join

## 方向 C：把监督收敛压缩成“轻监督四件套”

对成熟 workflow，不需要 7 层治理。

更合适的是一个轻监督闭环：

1. preflight
2. runtime heartbeat
3. finalize verification
4. evaluate / retry

这套已经比多数系统强很多，而且对日报足够了。

## 方向 D：UI 上默认展示“结果视角”，不是“编排视角”

对 workflow-run，用户默认应该看到：

- 命中的 workflow
- 输入时间范围 / 主题
- 结果摘要
- 产物列表
- 验证状态
- 失败诊断
- 一键重跑

而不是先看到：

- DAG
- stage
- group
- checkpoint

这些可以在“高级控制”里折叠。

---

## 八、对你这句话的直接回应

> “AI 产生日报如果已经是一个成熟的 workflow，他完全不需要复杂的 DAG 了，这种时候整体任务的执行与监督收敛应该更加简单一些的。”

我认同，而且我会再往前推一步：

**成熟 workflow 不只是“不需要复杂 DAG”，它甚至不应该先被用户理解为 DAG 问题。**

它应该先被理解为：

- 一个可重复执行的工作流资产
- 一个带 preflight/finalize 的单任务执行器
- 一个结果导向的轻监督系统

只有当这个工作流开始出现：

- 多角色分工
- 高失败成本
- 大量并行拆解
- 中间产物依赖复杂

才应该升级成 review-loop 或 DAG orchestration。

---

## 九、最终结论

Antigravity 不是“做错了 DAG”，而是**还没有把任务复杂度分层做透**。

当前更像是：

- 底层已经有轻执行原型
- 上层框架、资产模型和产品表达仍然由 DAG / 项目治理主导

所以你会产生非常准确的感受：

> 现在似乎是 DAG 优先了。

我的结论是：

1. **这个感受成立**
2. **对成熟 workflow，这确实偏重**
3. **正确方向不是删 DAG，而是把 DAG 从默认答案降级成高级编排层**
4. **日报、摘要、固定巡检这类任务，应该优先走 workflow-run / prompt-executor 这类轻执行通道**

---

## 十、建议的后续收口动作

如果后面要把这件事真正落地，我建议按这个顺序：

1. 明确三档执行模型
   - workflow-run
   - review-flow
   - DAG orchestration

2. 给 workflow 资产补显式元数据
   - `executionProfile`
   - `verificationProfile`
   - `showProjectDAG`
   - `supportsEvaluate`

3. 调整 CEO / dispatch 默认路由
   - 能命中成熟 workflow 的，先不升 DAG

4. 调整前端默认展示
   - workflow-run 默认看结果、产物、验证
   - DAG 视图改成高级信息

5. 最后再处理 Template / Group / Stage 的结构重心
   - 避免继续把“单任务 workflow”塞进重 group/pipeline 语义

