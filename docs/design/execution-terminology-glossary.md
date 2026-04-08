# 执行术语表：Prompt Mode / Template Mode / Playbook / Skill

日期：2026-04-08  
状态：持续讨论稿 / 已入库  
范围：产品语义、架构命名、后续文档/API/字段收口

## 一页结论

当前 Antigravity 最需要的不是再造更多名字，而是把已经混在一起的几个词拆开。

最稳的边界是：

1. `Template / Pipeline` = 真正可执行的固定编排
2. `Prompt Mode` = 不走固定 Template，由 prompt 主导执行
3. `Playbook / Prompt Asset` = 提示词资产、操作手册、方法模板
4. `Skill` = 可复用能力单元
5. `Shared Conversation` = 运行时对话复用策略，不是产品模式
6. `Execution Flow / Automation Flow` = 未来若引入真正独立可执行编排时再使用的新术语

当前最应该避免的一句话是：

> 把所有 markdown workflow、同对话执行、非模板任务都统称成 workflow。

---

## 1. 术语总表

| 术语 | 应该指什么 | 当前是否已存在 | 不应该再指什么 |
|:---|:---|:---|:---|
| Template / Pipeline | 固定可执行编排，能解析为 stage 并启动 run | 是 | prompt 资产、操作手册 |
| Stage | Template 内的执行单元 | 是 | 泛指任何任务步骤 |
| Run | 一次具体执行实例 | 是 | 仅限 template 任务 |
| Project | 容器与治理对象 | 是 | 执行器本身 |
| Project-only | 只创建项目、不自动执行 | 语义上已存在 | 失败兜底或半执行状态 |
| Prompt Mode | 不走固定 template，由 prompt 主导执行 | 设计中 | markdown workflow 目录本身 |
| Playbook / Prompt Asset | 提示词资产、方法模板、角色说明 | 语义上已存在 | 真正的可执行编排 |
| Skill | 能力单元、能力提示 | 是 | Project、Template 或 Run |
| Shared Conversation | 同对话复用策略 | 是 | 独立产品模式 |
| Execution Flow / Automation Flow | 未来真正独立的可执行自动化编排 | 否 | 当前 markdown workflow |
| Workflow | 当前是历史混用词 | 是 | 新文档里的精确定义术语 |

---

## 2. 每个词的推荐解释

### 2.1 Template / Pipeline

推荐解释：

> 一个固定、可执行、可追踪、可复盘的编排模板。

它应当具备：

1. 明确入口
2. 明确 stage 结构
3. 明确 run 跟踪
4. 明确结果回流

产品上凡是会真正触发固定编排的，都应优先使用 Template / Pipeline 术语。

### 2.2 Prompt Mode

推荐解释：

> 一个不依赖固定 Template 的执行模式，由业务 prompt 主导，并辅以 playbook / skill 提示来帮助 AI 完成任务。

它不是“弱化版 workflow”，也不是“没选中 template 的临时退路”。

它应该是一种正式模式，用来承接：

1. 非固定模板任务
2. 临时探索性任务
3. 依赖 prompt 判断是否调用 playbook 或 skill 的任务

### 2.3 Playbook / Prompt Asset

推荐解释：

> 用来指导 agent 如何思考和行动的提示词资产。

它更像：

1. 操作手册
2. 工作方法模板
3. 角色说明
4. prompt 片段资产

它不应该被误说成：

1. 真正的执行编排
2. 独立运行时
3. 自动化工作流引擎

### 2.4 Skill

推荐解释：

> 一种能力提示或能力封装，用来帮助 Prompt Mode 或 Template 内部角色做正确的动作。

Skill 和 Playbook 的关系更像：

1. Skill 是能力标签 / 能力入口
2. Playbook 是能力说明 / 执行方法

它们都不应直接等同于 Template。

### 2.5 Shared Conversation

推荐解释：

> 在运行时选择复用同一个对话，而不是拆分成隔离子对话的策略。

它属于 runtime strategy，而不是产品层模式。

所以“同一个对话里完成任务”这句话，从层级上应该挂在：

1. Template Mode 的运行时子策略
2. 未来 Prompt Mode 的运行时子策略

而不是挂成和 Template / Prompt Mode 平级的新概念。

### 2.6 Execution Flow / Automation Flow

推荐解释：

> 如果未来真的要引入独立的自动化编排层，这个层才应该使用新的术语，而不是继续借 workflow 这个已被污染的旧词。

也就是说，它是未来概念，不是当前 markdown workflow 的改名。

---

## 3. 当前最容易说错的话

下面这些说法后续应尽量避免：

1. “workflow 就是可执行流程”
2. “同对话执行是另一种 template”
3. “adhoc 就是单角色执行器”
4. “没有 template 时就自动走 workflow”
5. “playbook 和 template 差不多”

---

## 4. 推荐的产品表述

### 4.1 推荐说法

1. “按模板执行”
2. “按 Prompt Mode 执行”
3. “创建任务项目，不自动执行”
4. “该任务附带 playbook 提示”
5. “该任务建议使用某个 skill”

### 4.2 不推荐说法

1. “走 workflow”
2. “这个 workflow 会自己执行”
3. “这是一种同对话 workflow”
4. “adhoc 会自动单角色执行”

---

## 5. 对当前代码与文档的最小收口建议

短期不需要立刻改代码目录，可以先改解释层。

### 5.1 文档层

建议在后续文档中优先使用：

1. Template / Pipeline
2. Prompt Mode
3. Playbook / Prompt Asset
4. Skill

尽量避免把 workflow 当成新读者需要理解的核心名词。

### 5.2 字段层

后续如果动字段，我建议优先考虑：

1. `workflowRef` -> `playbookRef` 或 `promptAssetRef`
2. `ExecutionTarget.kind = 'prompt'`，而不是 `'workflow'`
3. 保留兼容，但在新接口和新文档里逐步去 workflow 化

### 5.3 API / 目录层

不建议立刻重命名目录，但可以逐步建立语义过渡：

1. `api/workflows` 保留兼容
2. 新文档解释为 playbook assets
3. 如果未来需要，再增加 `api/playbooks` 作为更准确的语义入口

---

## 6. 当前建议

如果只给一句当前最稳的命名建议，我会这样写：

> 固定可执行结构叫 Template；非固定任务叫 Prompt Mode；markdown workflow 文件在当前语义下更应该叫 Playbook 或 Prompt Asset；同对话执行只是 runtime 策略，不是独立模式。

这套术语边界更稳，也更不容易在后续架构和产品文档里继续制造误解。