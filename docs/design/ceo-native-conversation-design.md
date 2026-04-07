# 架构设计文档：CEO Agent 原生化与统一会话引擎

> **文档目的**：本文档是一份自包含的架构设计提案，供外部 AI 或人类审阅者理解完整背景后进行评审。
> **项目**：Antigravity Mobility CLI（一个 Multi-Agent 协作平台，提供 Web UI + CLI + IDE 集成）
> **日期**：2026-04-06
> **前置依赖**：本提案发生在系统刚完成 "Group Elimination" 大重构之后（`groupId` → `templateId + stageId`）

---

## 一、系统背景

Antigravity Mobility CLI 是一个 Multi-Agent 协作平台，核心能力是：
1. **部门化管理**：每个 Workspace 目录代表一个"部门"，拥有独立的 `.department/config.json`（配置）、`.department/rules/`（行为规则）、`.department/memory/`（知识沉淀）
2. **模板驱动 Pipeline**：通过 Template（定义 stages、roles、review policy）来编排多阶段、多角色的 AI 任务链
3. **Provider 抽象**：系统有 `TaskExecutor` 接口，目前实现了 `AntigravityExecutor`（通过 IDE gRPC）和 `CodexExecutor`，未来会扩展到 `OpenAI-API`、`Claude-API` 等
4. **CEO Agent**：系统中的"总指挥"，由用户下达自然语言指令，AI 自动决策：选择部门、选择模板、创建项目、派发 Run

### 现有的部门基础设施（已就位，非本次新建）

| 模块 | 文件 | 功能 |
|:-----|:-----|:-----|
| 部门规则同步 | `src/lib/agents/department-sync.ts` | 读取 `.department/rules/*.md` 和 `.department/workflows/*.md`，自动同步到 IDE 的规则目录（`.agent/rules/`、`.cursorrules`、`CLAUDE.md` 等） |
| 部门记忆 | `src/lib/agents/department-memory.ts` | 三层记忆架构：组织级 `~/.gemini/antigravity/memory/` + 部门级 `workspace/.department/memory/` + 会话级（内存）|
| Provider 选择 | `src/lib/providers/ai-config.ts` | 按 Layer/Scene/Department 维度解析出应该使用哪个 Provider 和 Model |

---

## 二、问题陈述

### 2.1 当前 CEO Agent 的工作方式（现有代码分析）

**调用链**：
```
用户在 GlobalCommandBar 输入 → api.ceoCommand(text)
→ POST /api/ceo/command/route.ts
→ loadDepartments()  [读取所有 workspace 的 .department/config.json]
→ processCEOCommand(command, departments)  [ceo-agent.ts, 808行]
  ├─ 快速路径：状态查询（关键词匹配 → 直接返回统计数据）
  ├─ 快速路径：干预意图（取消/暂停/重试 → 直接操作 Run/Project）
  └─ LLM 决策路径：
     ├─ buildCompanyContext()  [ceo-prompts.ts: 遍历所有部门+模板，构建超长上下文]
     ├─ buildCEOSystemPrompt()  [拼装系统指令，要求 LLM 输出结构化 JSON]
     ├─ callLLMOneshot(prompt)  [llm-oneshot.ts: 创建临时 Cascade → 轮询取文本]
     └─ 解析 JSON → processDispatchDecision() / processMultiDispatchDecision()
        ├─ ceoCreateProject()  [创建项目]
        ├─ executeDispatch()   [dispatch-service.ts: 解析 template→stage→派发 Run]
        └─ updateProject()     [持久化 ceoDecision 到项目记录]
→ 返回 CEOCommandResult → 前端 Toast 展示
```

**关键特征**：
- `llm-oneshot.ts`（131行）本质是"发 prompt 拿 string"的单次管道，**无多轮对话、无流式、无工具调用**
- `ceo-prompts.ts`（265行）在每次调用时**主动拼装全部系统状态**（所有部门、所有模板、所有项目统计）塞进 prompt 的 push 模式
- `ceo-agent.ts`（808行）在 Node.js 层做所有后处理（项目创建、run 派发、决策持久化），LLM 只负责输出 JSON
- 前端体验是"输入→后台闭门处理→Toast 弹一句话"，**无对话历史、无思考过程展示**

### 2.2 对比：系统中已有的原生会话能力

系统同时拥有一条完整的会话链路：
```
Chat 组件 (chat.tsx, 524行) → /api/conversations/[id]/send
→ grpc.sendMessage() → IDE Language Server
→ 流式返回 Cortex Steps → Chat UI 渲染（打字机效果、工具调用展示、附件等）
```

**这条链路的问题**：完全依赖 Antigravity IDE 的 Language Server（gRPC），没有 IDE 就无法工作。

### 2.3 对比：Workflow 驱动模式（team-dispatch）

系统还有一种"Workflow 驱动"模式，以 `~/.gemini/antigravity/global_workflows/team-dispatch.md` 为例：
- 该 Workflow 是一份 Markdown 文档，里面写的是 **`curl -X POST http://localhost:3000/api/agent-runs`** 命令
- 执行此 Workflow 的 AI（比如 Gemini Copilot）**直接读文档、理解意图、执行 HTTP 调用**
- **不走 MCP，不走任何特殊协议，就是 AI 自主执行 curl**

### 2.4 核心矛盾总结

| 链路 | 决策+调度能力 | 对话体验 | Provider 独立性 |
|:-----|:------------|:--------|:--------------|
| CEO Agent (llm-oneshot) | ✅ 强（8种决策类型） | ❌ 无（Toast 模式）| ⚠️ 已接入 Provider 但仅限单次 |
| 原生 Chat (chat.tsx) | ⚠️ 依赖 IDE 工具 | ✅ 极佳 | ❌ 绑死 IDE gRPC |
| Workflow (team-dispatch) | ✅ 通过 curl 调 API | 取决于宿主 | ✅ 完全独立 |

**目标**：让 CEO 得到原生 Chat 级别的对话体验，保留决策+调度能力，且不绑死在任何特定 IDE 或工具协议上。

---

## 三、设计演进过程（关键讨论节点）

### 3.1 最初想法：建一个 `chat-runtime.ts`
最初考虑在后端独立实现一个"对话引擎"，自行管理 history、轮询 LLM、解析工具调用。
**问题**：等于在 Node.js 中重新造一个低配版的 Language Server，且会丢失前端 `chat.tsx` 已有的打字机效果、Cortex Step 渲染等精美 UI。

### 3.2 第二想法：全盘复用原生 Conversation
直接让 CEO 的交互走 `/api/conversations` → `grpc.sendMessage`，CEO 变成一个在 `ceo-workspace` 中的普通 Cascade 会话。
**问题**：完全绑死 IDE gRPC。用户说"如果我一开始就没有 Antigravity IDE 呢？"——这条路直接断了。

### 3.3 第三想法：用 MCP Tools 让模型自主查询和派发
让 CEO 大模型在会话中通过调用 `antigravity_list_projects`、`antigravity_dispatch_pipeline` 等 MCP 工具来获取状态和执行操作。
**问题**：用户指出 `team-dispatch` 根本不用 MCP，而是直接 curl 调本地 API。这证明"用什么工具"不是架构层面应该绑死的，而是由 Workflow/Rules 文档来教导的。

### 3.4 关键洞察：部门记忆和动态加载不冲突
用户问"之前设计的 Department Memory 和动态加载会冲突吗？"
分析后发现：**完全互补**。
- **冷层（Static Identity）**：使命、规则 → 写在 `.department/rules/` → 通过 `department-sync.ts` 同步到各 IDE
- **温层（Knowledge）**：历史决策 → 写在 `.department/memory/` → 已有 `department-memory.ts` 管理
- **热层（Live State）**：当前项目大盘 → AI 自行在会话中查询（pull 模式，非 push 注入）

### 3.5 最终共识：动静三层分离 + 薄中间件

不造重型引擎，而是建一个**薄中间件** (`chat-runtime.ts`)，其唯一职责是：
1. 从 `.department/rules` + `.department/memory` 构建冷+温层 systemContext
2. 根据当前 Provider 选择执行路径（有 IDE → 透传 gRPC；无 IDE → 调第三方 API + 自管 history）
3. 流式返回统一格式的 ChatStep，供前端消费

---

## 四、最终方案

### Phase 1：CEO Workspace 初始化

**新建** `src/lib/agents/ceo-environment.ts`
- 创建 `~/.gemini/antigravity/ceo-workspace/`
- 写入 `.department/rules/ceo-mission.md`：CEO 的静态身份与行为规则。不写死任何状态数据。告诉 AI 可以通过 HTTP API（`/api/projects`、`/api/agent-runs`）或 MCP 工具获取实时数据。参数体统一使用 `templateId + stageId`（与 Group Elimination 终态对齐）
- 调用已有的 `syncRulesToAllIDEs()` 和 `initDepartmentMemory()`

### Phase 2：CEO 后处理逻辑解耦

**修改** `src/lib/agents/ceo-agent.ts`
- 把 `processDispatchDecision()` 等后处理逻辑从"只能被 `/api/ceo/command` 调用"的封闭结构中抽出
- 确保 `/api/projects` POST + `/api/agent-runs` POST 的组合能覆盖 CEO 的所有调度操作
- 这样，未来在对话模式中，AI 可以通过调用这些标准 API（而非需要解析 JSON 的 oneshot 模式）来完成同样的操作

### Phase 3：`chat-runtime.ts` 薄中间件

**新建** `src/lib/agents/chat-runtime.ts`
- 接口：`sendChatMessage(session, userText) → AsyncGenerator<ChatStep>`
- 内部：
  - 从 workspace 的 `.department/rules` + `.department/memory` 构建 systemContext
  - 如果检测到 IDE Language Server 可用 → 走 `grpc.sendMessage`（享受原生工具调用、流式）
  - 如果无 IDE → 通过 `resolveProvider()` 获取当前的 API Provider → 调用其 streaming 接口 + 自行管理 message history
- 流式输出统一格式的 `ChatStep`（前端 `chat.tsx` 可直接消费）

### Phase 4：前端对接

**修改** `src/components/ceo-dashboard.tsx` 或 `src/app/page.tsx`
- 在 CEO Dashboard 中增加"对话模式"入口
- 用户在 GlobalCommandBar 提交命令时，可选择跳转到 CEO Chat 面板
- Chat 面板使用 `chat-runtime` 接口而非直接绑定 gRPC

---

## 五、与近期 Group Elimination 重构的关系

**依赖（Dependency）**：
- `ceo-mission.md` 中的 API 使用指南必须使用 `templateId + stageId`
- `ceo-prompts.ts` 中的模板摘要已从 `groupSummaries` 改为 `stageSummaries`（已完成）
- `dispatch-service.ts` 入参已切为 `stageId`（已完成）
- MCP 工具 `antigravity_dispatch_pipeline` 的 inputSchema 已使用 `stageId`（已完成）

**清理（Clean-up）**：
- Phase 3 完成后，`ceo-prompts.ts` 中的 `buildCEOSystemPrompt()`（每次拼装全部部门+模板的重型函数）可大幅精简
- `llm-oneshot.ts` 可降级为仅服务于 Pipeline Generation 等无状态场景

**无破坏（No Breaking）**：
- 所有现有的 `dispatch-service.ts`、`group-runtime.ts`、`project-registry.ts` 保持原样
- `/api/ceo/command` 保留作为短平快兼容入口

---

## 六、待审阅的决策点

> [!IMPORTANT]
> **1. CEO 在对话中的行动权限边界**
> - **选项 A：全自主** —— CEO 在 Chat 中通过 API/curl 自行完成全部操作（如 team-dispatch 模式），Node.js 不做额外校验
> - **选项 B：受控调度** —— CEO 的创建/派发操作仍经过 `ceo-agent.ts` 的后处理层（负载检查、ceoDecision 持久化）
> - **选项 C：混合模式** —— 查询操作自主，创建/派发操作走校验层
>
> **2. `chat-runtime.ts` 的 "无 IDE" 路径实现优先级**
> - 是 Phase 3 就实现完整的双路径（有IDE + 无IDE），还是先只实现有 IDE 路径，无 IDE 留为后续 Provider 扩展？
>
> **3. 前端体验形态**
> - CEO Chat 是嵌入式面板（推荐：在现有 Dashboard 内展开），还是独立路由页面？
