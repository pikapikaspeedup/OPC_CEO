# Conversation / Run / Project 运行时模型梳理（2026-04-17）

## 目标

澄清当前系统里这些对象的关系：

- `Conversation`
- `Run`
- `Project`
- `Pipeline`
- `Role`
- `Session`

并明确：

- 当前实现里它们各自是什么
- 它们之间是一对一还是一对多
- 当前日志 / 追踪为什么会让人感觉“不完整”

## 一句话结论

### 从抽象层级看

1. `Conversation` 是最底层的“AI 会话 / provider 会话”
2. `Run` 是一次标准化执行尝试
3. `Project` 是面向业务的结果容器
4. `Pipeline` 是 Project 内部的执行编排结构

所以：

- `Conversation` 是“AI 怎么做”
- `Run` 是“系统记的一次执行”
- `Project` 是“用户看到的一件事”

## 当前真实关系

### 1. Project

定义位置：

- `src/lib/agents/project-types.ts`
- `src/lib/types.ts`

当前含义：

- 一个用户可见的业务对象
- 有名字、目标、状态、工作区
- 聚合若干 `runIds`
- 可选地携带 `pipelineState`

关键点：

- `adhoc project` 可以没有 pipeline
- 这类项目仍然可以有 prompt run

关系：

- `Project 1 -> N Runs`
- `Project 0/1 -> 1 PipelineState`
- `Project 0/1 -> N Child Projects`

### 2. PipelineState

定义位置：

- `src/lib/agents/project-types.ts`
- `src/lib/types.ts`

当前含义：

- Project 内部的执行结构
- 包含 stages、activeStageIds、整体 pipeline status

关系：

- `PipelineState 1 -> N Stages`
- `Stage 当前只指向一个最新 runId`

注意：

- 这不代表一个 stage 历史上只有一个 run
- 重试后旧 run 仍在 `project.runIds`
- 但 `stage.runId` 只保留当前/最新那条

### 3. Run

定义位置：

- `src/lib/agents/group-types.ts`
- `src/lib/types.ts`

当前含义：

- 一次标准化执行尝试
- 是系统级“最重要的执行记录单位”

它记录：

- prompt
- model
- provider
- result
- resultEnvelope
- artifactDir
- sessionProvenance
- childConversationId / activeConversationId
- roles
- supervisorConversationId

关系：

- `Run N -> 1 Project`（可选）
- `Run 0/1 -> 1 current provider session handle`
- `Run 0/N -> N role conversations`
- `Run 0/1 -> 1 supervisor conversation`
- `Run 1 -> N artifacts`

### 4. Conversation

定义位置：

- `src/lib/types.ts`
- `src/app/api/conversations/*`

当前含义：

- provider / IDE 侧的真实会话对象
- 对 `antigravity` 来说通常就是 `cascadeId`
- 对 `native-codex` / `codex` 当前更像“session transcript source”

它不是业务对象，而是交互轨迹对象。

关系：

- `Conversation` 不等于 `Project`
- `Conversation` 也不等于 `Run`
- 它只是 run 底下的一种执行载体

### 5. Session / Handle

定义位置：

- `SessionProvenance`
- `src/lib/backends/run-session-hooks.ts`

当前含义：

- run 当前或最后一次绑定的 provider session handle
- 例如：
  - `cascadeId`
  - `codex threadId`
  - `native-codex-{runId}`

这是真正串起 provider 会话的“最低层键”。

## 最重要的基数关系

### 情况 A：简单 prompt-only 项目

关系通常是：

- `Project 1`
- `Run 1`
- `Conversation 1`

但这只是最简单情况。

### 情况 B：同一个 run 多次在同一个 conversation 里继续

比如：

- nudge
- append
- 同一 handle 继续发消息

关系是：

- `Project 1`
- `Run 1`
- `Conversation 1`
- `Messages N`

也就是：

- 一个 run 可以在同一个 conversation 里经历多轮交互

### 情况 C：同一个 run 内部出现多个 conversation

典型场景：

- 多 role 执行
- review loop
- supervisor diagnosis

关系是：

- `Project 1`
- `Run 1`
- `Role Conversations N`
- `Supervisor Conversation 0/1`

也就是：

- `Run 1 -> Conversations N`

### 情况 D：一个 Project 下面多个 runs

典型场景：

- prompt-only 项目多次重跑
- pipeline 多 stage
- stage retry

关系是：

- `Project 1 -> Runs N`
- 每个 run 再各自挂若干 conversation

## 为什么你会觉得“历史不完整”

因为当前系统把“运行轨迹”拆散存了。

### 现在分散在哪

1. `Project`
   - 记业务对象
2. `Run`
   - 记执行摘要和结果
3. `Conversation`
   - 主要在 antigravity conversation store
4. `SessionProvenance`
   - 记 provider handle
5. `execution-journal.jsonl`
   - 只记 control-flow 事件
6. `artifactDir`
   - 记结果文件、草稿、verification 文件

### 当前缺口

`execution-journal.jsonl` 现在只记录：

- `node:activated`
- `node:completed`
- `gate:decided`
- `checkpoint:*`

它**不记录**：

- user / assistant messages
- provider tool calls
- stream deltas
- workflow hook preflight/finalize 动作

所以当前不是“完全没跟踪 session”，而是：

- `session handle` 跟踪了
- `完整统一会话日志` 没有

## 对话 Session 现在有没有跟踪？

### 有，但只跟踪了一半

当前已经跟踪：

- `sessionProvenance.handle`
- `backendId`
- `childConversationId`
- `activeConversationId`
- `role.childConversationId`
- `supervisorConversationId`

所以：

- Session 本身不是没跟踪

### 没做好的部分

没有把这些 session 里的内容统一沉淀成：

- 一个 run-level 的完整 `jsonl`

导致你很难从一个地方完整回放：

1. 前置脚本做了什么
2. AI 说了什么
3. tool calls 做了什么
4. 后置验证做了什么

## 当前最合理的心智模型

### 业务层

- `Project` = 一件事

### 执行层

- `Run` = 这件事的一次执行尝试

### 会话层

- `Conversation` = AI 在某个 provider 里的具体交互轨迹

### 编排层

- `Pipeline` = 多个 runs / stages 的组织方式

## 当前系统的正确关系图

```text
Project
  ├─ runIds[]
  ├─ pipelineState? 
  │    ├─ stages[]
  │    │    └─ stage.runId (latest/current)
  │    └─ activeStageIds[]
  └─ child projects?

Run
  ├─ result / envelopes / artifacts
  ├─ sessionProvenance.handle
  ├─ childConversationId?
  ├─ activeConversationId?
  ├─ roles[] -> role.childConversationId?
  └─ supervisorConversationId?

Conversation
  └─ provider-native message/step history
```

## 直接和部门 Conversation 时，属于什么对象？

### 结论

默认情况下：

- 它首先属于一个 `Department Workspace Conversation`

而**不属于 run**。

也就是说：

- 用户直接在某个部门工作区里和 AI 聊天
- 本质上先是在那个 workspace 上创建了一个普通 `conversation`
- 这个 conversation 只是“交流上下文”
- 还不是“执行尝试”

### 什么时候它会变成 run？

只有当这段对话触发了明确执行动作时，才会衍生出：

- `Project`
- `Run`

这时关系会变成：

- `Conversation (parent / source context)`
  → `Project`
  → `Run`
  → `Conversation(s) for execution`

### 当前代码里的关系

#### 1. 用户直接聊天

对应入口：

- `POST /api/conversations`

本质：

- 在指定 workspace 上创建一条普通 conversation
- 如果 workspace 就是某个部门工作区，那它就是“部门对话”

这时候：

- 只有 `Conversation`
- 还没有 `Run`
- 也不一定有 `Project`

#### 2. 从聊天进入执行

当系统开始派发真正执行时，会进入：

- `dispatchRun(...)`
- `executePrompt(...)`
- 或 CEO command 的 `create_project + run`

这时 conversation 会通过：

- `parentConversationId`

挂到 run 上。

所以：

- 原始部门 conversation = 上游上下文
- run = 执行尝试
- run 内部可能再生成新的 child conversation

### 所以它们的关系不是“谁替代谁”

而是：

1. 用户和部门先聊天
   - `Conversation`
2. 聊着聊着决定执行一件事
   - 创建 `Project / Run`
3. run 再去驱动一个或多个执行 conversation

### 一句话模型

- **部门 direct conversation** = “上下文会话”
- **run** = “执行实例”

前者可以存在而不产生 run。  
后者通常会引用前者，但不等于前者。

## 你要的目标模型

如果按你说的“对话内容本来就要存在 jsonl 中”，那最终应该是：

- 每个 run 有一份统一的 `run-history.jsonl`

里面同时记录：

1. provider session start
2. user / assistant messages
3. tool calls / tool results
4. workflow hook actions
5. verification / reporting
6. final result summary

这样：

- pipeline 的多个 conversations
- prompt 的一个 conversation
- 同一 conversation 内的多轮 append

都能统一映射回：

- `Run 级别完整历史`

## 结论

当前系统里：

- `Project` 是业务容器
- `Run` 是标准化执行记录
- `Conversation` 是 provider 会话载体

真正的问题不是“没 session”，而是：

- 没有把多个 session / 对话 / hook 动作收束成统一的 run-level 历史日志

这就是为什么你现在觉得“信息是散的、对话是不完整的、过程回放不像一个完整 agent 运行”。
