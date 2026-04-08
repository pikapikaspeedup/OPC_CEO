# 执行目标机制梳理与架构草案

日期：2026-04-08  
状态：持续讨论稿 / 已入库  
范围：Template / Workflow / Project / Scheduler / CEO / MCP

## 一页结论

当前系统里，真正进入 Gateway 执行面的只有 Template。

更准确地说：

1. `Template` 是执行蓝图，定义 pipeline / graphPipeline，再被解析成 stage，最终产出 run。
2. `Workflow` 现在不是独立执行器，而是规则 / 提示词资产。只有被 template role 引用时，才会间接进入 prompt 构造链。
3. `Project` 是容器和治理对象，不是执行器；`adhoc` 只是项目类型，不等于“单角色直接执行”。
4. `DepartmentSkill.workflowRef` 当前没有接入真实执行链，不能替代 `templateId` 去启动 run。
5. 因此，对“没有 template、但有本地或全局 workflow 的部门”，当前最准确的系统描述不是“也能自动执行”，而是“可以合法创建项目，但不会自动出 run”。
6. 当前所谓“在同一个对话中完成任务”，本质上也不是 Template 之上的新层级，而是 Template 运行时里的 conversation reuse 策略。

这意味着后续架构不该继续争论“templateId 要不要必填”，而应该明确区分三种执行目标：

1. `project-only`：只创建项目，不自动执行。
2. `template`：创建项目后按现有 template 执行链产出 run。
3. `prompt-mode`：不走固定 template，而是靠 prompt + playbook + skill 提示来驱动执行。

如果未来再新增真正独立的可执行编排，它更适合叫 `execution flow` 或 `automation flow`，而不是继续复用今天这个已经混杂了 prompt 资产含义的 workflow 术语。

一句话总结：

> 当前系统是 template-first execution，workflow-aware assets，project-only governance。

---

## 1. 当前机制真实是什么

### 1.1 Template 是唯一已打通的执行目标

当前 run 的统一入口是 [src/lib/agents/dispatch-service.ts](../../src/lib/agents/dispatch-service.ts)。

它的真实语义是：

1. 接收 `templateId` 或 `pipelineId`
2. 解析为 `stageId`
3. 校验 stage contract
4. 调用 `dispatchRun()` 启动 run
5. 把 run 挂到 project 上，并初始化 pipelineState

关键代码依据：

1. [src/lib/agents/dispatch-service.ts](../../src/lib/agents/dispatch-service.ts)
2. [src/lib/agents/group-runtime.ts](../../src/lib/agents/group-runtime.ts)
3. [src/lib/agents/stage-resolver.ts](../../src/lib/agents/stage-resolver.ts)
4. [src/lib/agents/project-registry.ts](../../src/lib/agents/project-registry.ts)

所以当前想直接产出 run，执行层面仍然是明确的 `templateId -> stageId -> run` 模型。

### 1.2 Workflow 目前是资产层，不是执行层

当前 workflow 有两条链，但都不是独立执行器：

1. `template role -> workflow markdown -> prompt builder`
2. `IDE / workspace / global workflow 资产 -> 列表 / 编辑 / slash workflow`

第一条链里，workflow 的作用是被 template role 引用后，作为 markdown 文本拼进 prompt。它是 prompt 资产，不是调度目标。

关键代码依据：

1. [src/lib/agents/asset-loader.ts](../../src/lib/agents/asset-loader.ts)
2. [src/lib/agents/prompt-builder.ts](../../src/lib/agents/prompt-builder.ts)
3. [src/lib/agents/group-runtime.ts](../../src/lib/agents/group-runtime.ts)

第二条链里，workflow 会通过 API 被列出和编辑，但当前这套能力更多是“资产管理”，不是“Gateway 执行”。

关键代码依据：

1. [src/app/api/workflows/route.ts](../../src/app/api/workflows/route.ts)
2. [src/app/api/workflows/[name]/route.ts](../../src/app/api/workflows/[name]/route.ts)

因此，当前最准确的说法不是“系统支持 workflow 执行”，而是：

> 系统支持 workflow 资产存在、被管理、被引用，但还没有 workflow target executor。

### 1.3 Project 是容器，不是执行器

`createProject()` 的职责很明确：创建项目记录、目录和元数据。

它不会自动创建 run，也不会自动进入 pipelineState，除非后面真的发生了一次 dispatch。

关键代码依据：

1. [src/lib/agents/project-registry.ts](../../src/lib/agents/project-registry.ts)
2. [src/app/api/projects/route.ts](../../src/app/api/projects/route.ts)

这点非常重要，因为它直接解释了为什么当前 scheduler 的 `create-project` 在没有 template 时只能创建项目，而不会继续执行。

### 1.4 `adhoc` 不是单角色执行器语义

当前 `adhoc` 只是 `projectType` 的一个值。

它表达的是“临时项目类型”，而不是：

1. 单角色执行器
2. 不需要 template 的 run 模式
3. 一次性轻执行后端

关键定义在：

1. [src/lib/agents/project-types.ts](../../src/lib/agents/project-types.ts)
2. [src/lib/types.ts](../../src/lib/types.ts)

所以今天如果说“有一个 adhoc 好像是只执行任务，单角色”，从代码真实含义上看，这个认知是不准确的。当前更接近的事实是：

> 有些单阶段 template 可以实现单角色执行，但 `adhoc` 本身不提供这个能力。

### 1.5 `DepartmentSkill.workflowRef` 还没有接进执行链

`DepartmentSkill` 结构里虽然有 `workflowRef`，但当前全仓基本只有类型定义和测试夹具，没有真实 runtime usage。

关键代码依据：

1. [src/lib/types.ts](../../src/lib/types.ts)
2. [src/lib/skill-utils.test.ts](../../src/lib/skill-utils.test.ts)

因此，当前不能把部门 skill 上的 workflowRef 理解成“这个部门已经有 workflow executor”。

### 1.6 “同一个对话里执行”不是 Template 的上层，而是它的运行时子模式

你提到的“Template 还有另外一种执行，在同一个对话中完成任务”，当前代码里确实有对应能力，但它的层级要讲清楚。

当前更准确的关系是：

1. `Template` 决定业务编排结构
2. `executionMode` 决定它是单角色还是 review-loop / delivery-single-pass
3. `conversationMode` 决定多轮 / 多角色执行时，是复用同一个对话，还是拆成隔离对话

也就是说：

> “同一个对话里执行”不是和 Template 平级的新模式，而是 Template 运行时内部的一种对话复用策略。

当前代码里能看到两层相关能力：

1. `legacy-single` 单角色路径
2. `shared / isolated conversation` 复用或隔离对话

但这两层都仍然发生在 template/stage 已经确定之后。

所以它们和 Template 的关系不是“另一种替代 Template 的执行模式”，而是：

> Template 之下的 runtime strategy。

---

## 2. 当前系统实际支持什么，不支持什么

| 场景 | 当前是否支持 | 真实语义 |
|:---|:---|:---|
| 创建一个 project，不带 template | 支持 | 只创建容器，不自动出 run |
| 用 template 直接启动 run | 支持 | 走 `executeDispatch()` |
| scheduler 创建 project 后自动按 template 执行 | 支持 | 前提是创建时已经确定 `opcAction.templateId` |
| scheduler 创建 project 后按 workflow 执行 | 不支持 | 当前没有独立 execution flow executor |
| CEO 根据 workflow 直接周期执行某部门 | 不支持 | 当前只能 project-only 或 template-based |
| 部门只要有本地 workflow 就能自动被派发 | 不支持 | workflow 当前仍是资产层 |
| `adhoc` 自动代表单角色执行 | 不支持 | `adhoc` 仅是 projectType |
| 同对话执行 = 新的上层执行模式 | 不支持这种理解 | 当前只是 template runtime 的 conversation reuse |

---

## 3. 对 AI 资讯部门这类场景的当前正确描述

你提出的场景非常关键：

> 某些部门没有复杂 template，但有本地 workflow 或全局 workflow；CEO 派一次性任务或周期任务时，也应该允许没有 templateId。

这个需求从产品上是合理的，但要注意“合理”不等于“当前已实现”。

当前最准确的系统描述是：

1. 这类部门可以合法接收 `project-only` 任务。
2. CEO 或 scheduler 可以创建任务项目，不必强制要求 template。
3. 但如果你要求“系统立即自动执行”，当前执行后端仍然没有 workflow target，因此做不到真正 workflow-based auto-run。
4. 这些 workflow 当前更像部门内部操作手册、slash workflow 资产或 prompt 资产，而不是 Gateway 可调度目标。

换句话说，当前系统里“没有 template 但有 workflow 的部门”最合理的产品语义应该是：

> 可以创建项目并把工作流上下文挂给部门使用，但不能宣称系统已经具备 workflow executor。

---

## 4. 当前设计为什么会让人误解

之所以容易误解，主要有三层原因：

1. 系统里确实存在大量 workflow 文件，让人自然以为“既然有 workflow，就能被执行”。
2. `DepartmentSkill.workflowRef` 这个字段名很像已经接入 runtime，但实际没有。
3. `adhoc` 容易被误读成“一次性轻量执行模式”，但实际上它只是项目分类。

这三层混在一起后，就很容易得出一个看似合理但当前不成立的结论：

> 没有 template 的部门，只要配置了 workflow，也应该能被 CEO 或 scheduler 自动跑起来。

这正是后续架构必须主动拆开的地方。

### 4.1 术语本身也在制造误解

这里还有一个更底层的问题：

> 如果当前所谓的 workflow，本质上只是一个 prompt 资产，里面再去调用 skill 或别的流程，那继续直接叫 workflow，本身就会误导。

我认为这是成立的。

因为“workflow”这个词天然会让人联想到：

1. 有明确入口
2. 有执行状态
3. 有结果输出
4. 有可追踪的生命周期

但当前仓库里的很多 workflow markdown，其真实角色更接近：

1. playbook
2. prompt asset
3. 操作手册
4. 角色说明或工作方法模板

也就是说，它更像“指导 agent 怎么做”，而不是“系统会自动执行的一条编排流水线”。

### 4.2 术语建议：把 prompt 资产、执行编排、Prompt Mode 彻底分开

我建议后续至少在设计层先把术语拆开：

1. **Template / Pipeline**
   - 继续保留给当前真正可执行的 pipeline / graphPipeline

2. **Playbook / Prompt Asset**
   - 用于指代当前这些 markdown workflow 文件
   - 它们的本质是 prompt 资产、角色操作手册、工作方法模板

3. **Skill**
   - 表示可复用能力单元
   - 可以引用 playbook，也可以被 playbook 调用

4. **Execution Flow / Automation Flow**
   - 预留给未来真正独立的可执行 workflow 编排
   - 不建议继续和当前 markdown workflow 共用同一个术语

5. **Prompt Mode**
   - 用于描述“不走固定 Template，而是由 prompt 主导，并辅以 playbook / skill 提示”的执行方式
   - 它应该被视作和 Template Mode 平级的产品模式，而不是 workflow 的别名

换句话说，我更建议未来的表达是：

1. 当前 `.agents/workflows/*.md` 从产品语义上看更接近 playbook
2. 当前真正的执行编排仍然是 template / pipeline
3. 非固定模板任务更适合被称为 Prompt Mode，而不是 Workflow Mode
4. 如果未来新增真正的 workflow executor，最好用 execution flow、automation flow 或别的独立名字，而不是直接继承今天这个 workflow 词

### 4.3 一个更稳的命名策略

如果后续不想立刻动代码和目录，可以先分两层处理：

#### 文档与产品语义层

先明确写清：

1. `workflow markdown asset`
2. `playbook`
3. `executable template`

也就是承认历史目录名叫 workflow，但产品解释里不要再把它当成“天然可执行 workflow”。

#### 长期重命名层

如果后续真要收口术语，我建议优先考虑：

1. `workflowRef` -> `playbookRef` 或 `promptAssetRef`
2. `api/workflows` -> 保留兼容，同时逐步引入 `api/playbooks`
3. `.agents/workflows/` -> 可继续保留目录兼容，但文档层明确它的真实语义是 playbook assets

### 4.4 当前我的判断

所以直接回答这个问题：

> 如果它本质上只是 prompt，继续直接叫 workflow，我认为确实不好，会持续制造误解。

更稳的策略是：

1. 现在就把当前这类 markdown workflow 解释为 playbook / prompt asset
2. 把真正可执行的东西继续叫 template / pipeline
3. 如果未来要做独立执行编排，再给它一个新的术语，而不要复用 workflow 这个已经被 prompt 资产占用并污染的名字
4. 对当前这种“Prompt 里提醒 AI 使用 playbook 或 skill”的任务，更稳的命名就是 Prompt Mode

---

## 5. 推荐的目标架构

### 5.1 不要继续纠结 templateId 是否必填

真正该建模的是“后续执行目标是什么”，而不是“templateId 填不填”。

推荐引入一个新的抽象：`ExecutionIntent` 或 `ExecutionTarget`。

建议最少包含：

```ts
type ExecutionTarget =
  | { kind: 'project-only' }
  | { kind: 'template'; templateId: string; stageId?: string }
   | { kind: 'prompt'; promptAssetRefs?: string[]; skillHints?: string[] };
```

这样做的价值是把三种本质不同的行为拆开：

1. `project-only`：只创建项目
2. `template`：走现有 dispatch-service
3. `prompt`：由 prompt 主导，辅以 playbook / skill 提示

### 5.2 三种 executor 应该分层，而不是硬塞进 executeDispatch

我建议的最稳结构是：

1. `TemplateExecutor`
   - 直接复用当前 [src/lib/agents/dispatch-service.ts](../../src/lib/agents/dispatch-service.ts)
   - 保持 template-stage-run 语义不变

2. `PromptExecutor`
   - 新增独立执行器
   - 输入是业务 prompt，以及可选的 playbook / skill 提示
   - 它产生的运行态应继续复用 Run，但不要伪装成 fake template

3. `ProjectOnlyExecutor`
   - 只负责 createProject
   - 不初始化 pipelineState
   - 不创建 run

### 5.3 Scheduler / CEO / MCP 应统一产出 ExecutionIntent

后续最稳的方向不是让每个入口自己拼私有 action 结构，而是统一收口到一层 intent：

1. CEO 自然语言创建
2. MCP create scheduler job
3. Web Scheduler Panel
4. 未来的 workflow-first 部门配置

这些入口都应该先落到统一的 `ExecutionIntent`，再交给 executor registry 选择具体执行器。

### 5.4 DepartmentConfig 不应直接等于 runtime payload

部门配置里的 `templateIds`、未来的 `workflowRefs`，更适合作为：

1. 能力目录
2. 默认偏好
3. 候选范围

而不应该直接被当成最终运行态 payload。

也就是说，部门配置是“部门会什么”，不是“这次一定怎么跑”。

### 5.5 如果独立做 PromptExecutor，最稳的是继续复用 Run

这里最容易走偏的一点是：

> 既然非模板任务不该伪装成 template，那是不是应该直接另起一套 prompt-run？

我认为当前最稳的答案是否定的。

原因不是“Run 这个名字听起来像 template 时代的遗留”，而是 Run 这层已经具备了系统最成熟的公共运行态骨架：

1. 状态持久化与恢复
2. runId / projectId 关联
3. live state 与运行时观察
4. artifactDir 与结果文件落盘
5. sourceRunIds 这类上下游关联
6. 与项目详情、审计、CEO 事件的现成回流关系

所以更稳的方向是：

1. 保留 `Project` 作为容器
2. 保留 `Run` 作为统一运行态对象
3. 新增 `PromptExecutor`
4. 让 Prompt Mode 执行也产出 run

不要把 workflow 包成 fake template，也不要立刻另起 `workflow-run`。

### 5.6 哪些层值得复用，哪些层必须解耦

#### 应直接复用的层

1. RunRegistry：状态持久化、恢复、中断恢复后的终态处理
2. artifactDir 体系：每次执行都能落到独立结果目录
3. ResultEnvelope / ArtifactManifest 思路：让结果查看始终围绕 run，而不是散落在 workflow 文档里
4. Ops Audit：组织级时间线与审计查询
5. Project 与 run 的关联：项目详情天然能承载 workflow 执行结果

#### 必须解耦的层

1. `executeDispatch()` 本身
2. stage/source contract
3. pipelineState 初始化和 stage 跟踪
4. Project Workbench 中强 pipeline 假设的部分
5. Deliverables 作为主结果来源的假设

也就是说，WorkflowExecutor 最合理的关系不是“复用整个 template pipeline”，而是：

> 复用 run 外壳，绕开 template/stage 专属调度层。

### 5.7 最小字段与类型调整建议

如果后续真做 WorkflowExecutor，我建议最小化调整，而不是一次性重做运行时模型。

最小可行字段大致可以是：

```ts
type ExecutionTarget =
  | { kind: 'template'; templateId: string; stageId?: string }
   | { kind: 'prompt'; promptAssetRefs?: string[]; skillHints?: string[] }
  | { kind: 'project-only' };

type ExecutorKind = 'template' | 'prompt';
```

在 Run 上新增的重点不是再复制一份 template 字段，而是补充：

1. `executorKind`
2. `executionTarget`
3. 可选的 `triggerContext`，例如 schedulerJobId、createdBy、intentSummary

同时要把目前过于 template-first 的结果类型放松：

1. `TaskEnvelope`
2. `ResultEnvelope`
3. `ArtifactManifest`

这些对象现在仍然天然假设 templateId 存在。后续更稳的做法不是让 workflow 去伪造一个 templateId，而是让这些类型承认 executionTarget 才是一等来源。

### 5.8 PromptExecutor 的状态、上报与结果查看路径

这是独立 PromptExecutor 最关键的产品问题。

如果不提前设计清楚，后面一定会出现“能跑了，但不知道去哪看”的半成品。

我建议把真相源明确成三层：

#### 第一真相：Run 状态

用户想知道“它现在在干嘛”，第一入口应该仍然是 run 状态：

1. queued
2. starting
3. running
4. completed / blocked / failed / cancelled / timeout

这意味着 PromptExecutor 不该自己维护一套平行状态机，而应该复用当前 RunRegistry 的状态模型。

#### 第二真相：artifact 目录里的结果文件

用户想知道“它做完了什么”，第一结果源不应该是 Deliverables，而应该还是 run 对应的 artifact 目录。

建议继续沿用：

1. result-envelope.json
2. artifacts.manifest.json
3. prompt executor 自己的产物目录，例如 notes、research、delivery 等

这条原则很重要，因为 Deliverables 当前更像补充索引层，而不是稳定持久化主真相。

#### 第三真相：组织级审计与 CEO 汇总

用户想知道“这个 workflow 任务在组织层发生了什么”，则应该看：

1. Ops Audit 事件
2. CEO Event 汇总
3. 项目列表 / 项目更新时间 / 项目状态变化

换句话说，PromptExecutor 不能只会产出文件，还必须能发出组织级事件。

### 5.9 面向产品的结果查看方式

从产品路径看，我建议未来 workflow 执行遵循下面这条查看链：

1. 打开项目详情
2. 如果该项目是 workflow 执行项目，默认展示 latest run 摘要
3. 再进入 run detail，看 summary、trace、conversation、artifacts

这意味着项目详情不能继续用“没有 pipelineState = 待派发空项目”这个老假设去兜底。

对 workflow 项目而言，更合理的判断应该是：

1. 有 pipelineState：走 pipeline workbench
2. 没有 pipelineState 但有 runIds：走 run-linked project view
3. 两者都没有：才算 project-only

### 5.10 对用户最关键的三句话答案

如果未来真做独立 PromptExecutor，用户最关心的问题其实可以压缩成三句话：

1. **怎么追踪状态？**
   看 Run 状态，PromptExecutor 复用现有 RunRegistry，不另起一套平行生命周期。

2. **怎么查看它做了什么？**
   打开项目详情，进入 latest run，再看 run detail 里的 summary、trace、conversation 和 artifact manifest。

3. **结果文件在哪里？**
   在对应 run 的 artifact 目录里，以 result-envelope 和 artifact manifest 为主入口，必要时再点开具体产物文件。

### 5.11 关于未来独立 execution flow 的位置

如果未来真的需要“可执行 workflow 编排”这一层，我建议把它放在 Prompt Mode 之后再讨论，而不是现在就把 Prompt Mode 误叫成 workflow。

也就是说，概念顺序更应该是：

1. Template Mode：固定可执行模板
2. Prompt Mode：prompt 主导，playbook / skill 辅助
3. Execution Flow：未来真正独立的可执行自动化编排

这样层级才不会继续混乱。

---

## 6. 对当前产品语义的建议

在 workflow executor 真正落地前，我建议产品层就明确使用下面三条语义：

1. **创建任务项目** 不要求 templateId。
2. **自动启动执行** 才要求明确 execution target。
3. **只有 workflow、没有 template 的部门** 当前默认走 project-only，而不是伪装成已经支持 workflow auto-run。

对用户文案来说，可以明确表达为：

1. “创建任务项目”
2. “创建并按模板自动启动”
3. “创建并按 workflow 自动启动（未来能力）”

这样不会再让用户误以为“有 workflow 文件 = 系统已经有 workflow executor”。

---

## 7. 近期最合理的产品落点

结合当前代码和你的实际需求，我认为近期最合理的策略是：

### 方案 A：project-only 合法化

对于 workflow-first 部门，明确允许：

1. CEO 派一次性任务
2. CEO 派周期任务
3. scheduler 到点只创建项目

不强迫 templateId，不假装自动执行。

### 方案 B：template auto-run 继续保留

对于已经有 template 的部门，继续保留当前 `create-project + opcAction.templateId` 的 auto-run 主链。

### 方案 C：workflow executor 独立规划

不要为了“先跑起来”把 workflow 包成 synthetic template。短期看方便，长期会把 template 和 workflow 的语义边界彻底污染。

---

## 8. 当前不存在但最容易被误以为存在的能力

这部分需要明确写下来，避免后续继续带着错觉讨论：

1. 当前不存在 workflow-only dispatch。
2. 当前不存在 executeWorkflow。
3. 当前不存在 `DepartmentSkill.workflowRef -> runtime dispatch` 的执行链。
4. 当前不存在 “有本地 / 全局 workflow 就能被 scheduler 自动执行” 的能力。
5. 当前不存在 “adhoc = 单角色执行器” 的语义。

---

## 9. 建议的后续讨论顺序

后续如果继续推进，我建议按这个顺序讨论，而不是直接写代码：

1. 是否正式引入 `ExecutionTarget` / `ExecutionIntent`
2. workflow executor 的运行态对象应该复用 run，还是独立出 workflow-run
3. workflow-first 部门的 scheduler 文案和 UI 要怎么表现
4. DepartmentConfig 是否要正式加 `workflowRefs` 或 `defaultExecutionTarget`
5. project-only 与 auto-run 在 CEO / Scheduler / MCP 三个入口如何统一

---

## 10. 当前建议

如果只看当前实现和最近需求，最稳的判断是：

1. **现在不要把没有 template 的 workflow-first 部门硬塞进 template 模型。**
2. **现在就应该在产品语义上承认 project-only 是合法目标。**
3. **未来真正要补的是 workflow executor，而不是更多 template fallback。**

这是当前代码与需求之间最稳、最不容易误伤现有系统的收口方式。