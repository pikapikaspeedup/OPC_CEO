# CEO Agent 原生化与统一会话引擎设计审阅报告

## 审阅范围

- 设计文档：`docs/design/ceo-native-conversation-design.md`
- 核对源码：
  - `src/lib/agents/ceo-agent.ts`
  - `src/lib/agents/llm-oneshot.ts`
  - `src/lib/agents/dispatch-service.ts`
  - `src/lib/agents/department-memory.ts`
  - `src/lib/agents/department-sync.ts`
  - `src/lib/providers/types.ts`
- 补充交叉核对：`src/lib/providers/index.ts`、`src/lib/providers/ai-config.ts`、`src/lib/providers/antigravity-executor.ts`、`src/lib/providers/codex-executor.ts`、`src/app/api/projects/route.ts`、`src/app/api/agent-runs/route.ts`、`src/app/api/conversations/route.ts`、`src/app/api/conversations/[id]/send/route.ts`

## 总体结论

- **结论：有条件通过。**
- 设计方向是对的：它抓住了当前 CEO Agent 的真实瓶颈——`oneshot + 重型 prompt push + Node 后处理封闭`，并且试图把 CEO 交互迁移到统一会话层。
- 但当前文档把若干“已有能力”和“待补能力”写得过于接近，尤其是 **无 IDE 路径、流式 ChatStep 抽象、标准 API 对 CEO 后处理的完全替代** 三处，需要在设计上收口，否则后续实现很容易出现“文档说能做，代码层没有承接点”的落差。

---

## 一、现状准确性

### 通过项

- `docs/design/ceo-native-conversation-design.md` 对当前 CEO 命令主链路的描述基本准确：`/api/ceo/command` 加载部门后进入 `processCEOCommand()`，先走状态/干预快路径，再走 LLM 决策路径，这和 `src/app/api/ceo/command/route.ts`、`src/lib/agents/ceo-agent.ts` 一致。
- 文档对 `llm-oneshot.ts` 的定位准确：它本质上是“发 prompt，取最终文本”，当前没有统一的多轮会话状态抽象，也没有对外暴露的流式事件接口；这与 `src/lib/agents/llm-oneshot.ts` 的同步返回字符串形态一致。
- 文档对 `ceo-agent.ts` 的定位准确：项目创建、派发、负载检查、`ceoDecision` 持久化都在 Node.js 后处理层完成，LLM 只负责返回结构化 JSON；这与 `processDispatchDecision()`、`processMultiDispatchDecision()` 等实现一致。
- 文档对原生会话链路“强依赖 IDE gRPC”的判断准确：当前 `/api/conversations` 与 `/api/conversations/[id]/send` 都是围绕 Language Server owner map 和 `grpc.sendMessage()` 建立的。
- 文档对 Group Elimination 依赖关系的大方向准确：`dispatch-service.ts` 已经以内核方式接受 `templateId + stageId/pipelineStageId/pipelineStageIndex`，外部派发路径确实已经 stage-centric。

### 风险项

- 文档把“CEO Workspace 初始化”描述成全新能力，但当前 `src/lib/agents/llm-oneshot.ts` 已经存在 `getCEOWorkspacePath()`，会创建 `~/.gemini/antigravity/ceo-workspace/`。如果再新建 `ceo-environment.ts` 而不重构归口，容易形成 **双入口、双 owner**。
- 文档把“部门记忆基础设施已就位”说得略满。`src/lib/agents/department-memory.ts` 当前提供的是 **组织级/部门级 Markdown 读写与 run 完成后的简单提取**，并没有真正实现“会话级记忆管理器”或“按任务检索相关记忆”的能力。
- 文档把 `department-sync.ts` 描述为部门规则同步模块是准确的，但如果读者据此推断它也负责“动态加载记忆”，会产生误解。当前它只是同步 `.department/rules/`、`.department/workflows/`，对 memory 的处理仅限于为单文件 IDE 追加“去读哪些 memory 文件”的提示。
- 文档中“确保 `/api/projects` POST + `/api/agent-runs` POST 的组合能覆盖 CEO 的所有调度操作”这一句，按现状并不完全成立：`src/app/api/projects/route.ts` 只负责裸项目创建，不负责负载检查、不负责 `ceoDecision`、也不负责建议项持久化。
- 设计文档中若让审阅者理解为“当前 Provider 层已经能无缝扩展到 OpenAI/Claude API”，会高估现状。`src/lib/providers/types.ts` 的 `ProviderId` 虽然包含 `'claude-api' | 'openai-api' | 'custom'`，但 `src/lib/providers/index.ts` 的 `getExecutor()` 目前只支持 `antigravity` 和 `codex`。

### 建议修改项

- 把 Phase 1 改写为：**抽取并升级现有 CEO workspace 初始化逻辑**，而不是默认从零新建。
- 在现状说明里明确区分三件事：
  - **memory persistence 已有**
  - **memory retrieval / context assembly 待补**
  - **session memory 未落地**
- 把“标准 API 已足够覆盖 CEO 行为”改为“标准 API 已能覆盖底层资源操作，但 CEO 审批、负载校验、审计落库仍需要受控编排层”。

---

## 二、方案可行性

### 通过项

- Phase 1 可行性高：`syncRulesToAllIDEs()`、`initDepartmentMemory()`、现有 CEO workspace 路径能力已经具备，补一个统一初始化入口即可落地。
- Phase 2 可行性中高：`ceo-agent.ts` 内部后处理逻辑已经相对集中，`processDispatchDecision()`、`processMultiDispatchDecision()` 可被抽成共享 service，而不是只能被 `/api/ceo/command` 间接调用。
- 用“薄中间件”代替“重造一套 Language Server”是正确方向。当前已有 Provider 解析能力（`resolveProvider()`）、会话入口、规则/记忆文件系统，因此构建统一门面是顺势而为，而不是逆势重写。
- 前端复用 Chat 风格体验也是可行方向，只要后端先给出统一的 `ChatStep` 协议和 session API，UI 层并不需要知道底层是 gRPC 还是其他 provider。

### 风险项

- `TaskExecutor` 现状不足以直接支撑文档里的 `sendChatMessage(session, userText) → AsyncGenerator<ChatStep>`。当前 `src/lib/providers/types.ts` 只有 `executeTask()` / `appendMessage()` / `cancel()`，**没有会话生命周期、没有 history 读写、没有流式事件接口**。
- 当前 provider 能力矩阵与文档目标有明显落差：
  - `AntigravityExecutor` 有 streaming / step watch 能力，但本身 `executeTask()` 在 Phase 1 里仍是“立即返回 handle，内容为空”。
  - `CodexExecutor` 支持多轮，但 `supportsStreaming=false`、`supportsStepWatch=false`、`supportsCancel=false`，很难直接复刻原生 Chat 体验。
- 文档里的“无 IDE → 调第三方 API + 自管 history”在概念上可行，但 **在当前代码基座上还没有承接接口**。继续沿用 `TaskExecutor` 会把“单次任务执行”和“长会话管理”这两个职责硬塞到一个接口里。
- 当前 `callLLMOneshot()` 的 provider 分支本质上仍是“一次性调用”。它可以为对话引擎提供临时 fallback，但不能直接演进为统一会话运行时。
- 如果 CEO 在对话中直接学会 `curl /api/projects` 与 `curl /api/agent-runs`，那“操作成功”和“CEO 决策审计”会分离：底层资源创建成功，不代表系统级治理语义完整落库。

### 建议修改项

- 不要直接让 `chat-runtime.ts` 依赖现有 `TaskExecutor` 作为最终抽象；建议新增一层会话接口，例如：
  - `startSession()`
  - `sendMessage()`
  - `streamEvents()`
  - `loadHistory()`
  - `closeSession()`
- 把 Provider 支持矩阵写进设计文档：
  - `antigravity`：完整模式
  - `codex`：降级模式（多轮、非流式、无 step）
  - `openai-api/claude-api/custom`：预留，当前未实现
- 把“无 IDE 路径”拆成两个层级：
  - **V1**：最小可用的非流式 / 弱流式会话
  - **V2**：真正的流式 ChatStep 对齐

---

## 三、Group Elimination 兼容性

### 通过项

- 设计文档已明确把新 CEO 规则、任务派发、MCP 输入契约统一到 `templateId + stageId`，这与 `src/lib/agents/dispatch-service.ts` 的 stage-centric 实现方向一致。
- `executeDispatch()` 已经是当前单一派发真相源：它接受 `templateId/pipelineId`，解析出 `stageId/pipelineStageId/pipelineStageIndex`，并统一完成 run 派发、项目关联、pipeline state 初始化。
- `/api/agent-runs` 已把 stage 相关字段完整透传到 `executeDispatch()`；从架构上看，CEO Chat 未来改走标准 API，不会与 Group Elimination 终态冲突。

### 风险项

- 现有 `ceo-agent.ts` 的 LLM 决策结构仍只有 `templateId`，没有 `stageId`。这对“默认首阶段”模板没问题，但对 graph pipeline、多入口模板或继续派发生命令来说，语义可能不够稳定。
- `executeDispatch()` 虽然支持自动推导阶段，但推导逻辑依赖模板结构与 `sourceRunIds`。如果未来 CEO 直接走“AI 自主调用 API”，文档必须说明 **什么时候可以省略 `stageId`，什么时候必须显式传**。
- `ceoCreateProject()` 目前创建项目时会把 `templateId` 留空；也就是说，项目记录与具体调度模板的绑定，当前主要依赖后续 `ceoDecision` 和 pipeline state。若未来绕过这层后处理，审计链会变弱。
- 设计文档虽然强调 Group Elimination 已完成，但没有正面说明一个现实：内部文件名与若干实现仍保留 `group-runtime.ts` 等 legacy 命名。若不加注释，外部读者可能误判系统仍以 group 为中心。

### 建议修改项

- 在设计文档中新增一条 **“默认入口阶段契约”**：
  - 线性模板首次派发可省略 `stageId`
  - graph pipeline、多入口模板、续跑/分支派发必须显式提供 `stageId`
- 给 CEO 对话模式补一层共享 service，用来统一补齐：`templateId`、`stageId`、`ceoDecision`、项目审计记录，避免纯 API 直连造成治理信息丢失。
- 在文档中显式声明：`group-runtime.ts` 仅为历史文件名，外部契约一律按 stage-centric 理解。

---

## 四、架构完整性

### 通过项

- “冷层规则 / 温层记忆 / 热层实时状态”三层分离是这份设计里最好的部分，能有效避免当前 `ceo-prompts.ts` 的全量 push 注入膨胀。
- “薄中间件”思路正确，能保留现有 UI 投资，同时给无 IDE 路径留出可演进空间。
- 保留 `/api/ceo/command` 作为兼容入口也是合理的迁移策略，能控制切换风险。

### 风险项

- 文档缺少 **会话域模型**：没有定义 CEO chat session 的标识、workspace 绑定、provider 绑定、项目关联、生命周期状态。
- 文档缺少 **历史存储策略**：消息存哪里、怎样回放、怎样裁剪、怎样跨 provider 迁移，都没有写。
- 文档缺少 **统一 `ChatStep` 协议**：Antigravity 的 step、Codex 的同步文本、未来 API provider 的 token stream，怎样归一化成前端可消费对象，当前没有契约。
- 文档缺少 **动作治理模型**：对话中的查询、项目创建、派发、取消、重试、批量操作，哪些要确认、哪些要落审计、哪些要幂等保护，没有定义。
- 文档缺少 **错误处理与可观测性设计**：超时、半失败、provider 切换、IDE 中途断连、重放恢复、用户刷新页面后的 session 恢复都没有覆盖。
- 文档缺少 **memory 注入策略**：读取哪些 memory 文件、按什么优先级拼装、最大注入规模、是否做检索或摘要，未定义。
- 文档缺少 **前后端 API 契约**：前端如何创建 CEO Chat session、如何发送消息、如何订阅 step、如何恢复历史，没有明确接口草案。

### 建议修改项

- 在设计文档中补充 `CEOConversationSession` 草案，至少包含：
  - `sessionId`
  - `workspace`
  - `provider`
  - `mode`（ide-native / provider-api / degraded）
  - `linkedProjectIds`
  - `createdAt / updatedAt`
- 补充统一 `ChatStep` 协议，至少区分：
  - `message`
  - `tool-call`
  - `tool-result`
  - `status`
  - `error`
  - `final`
- 把“CEO 会话中的写操作”统一收口到受控 action service，而不是散落为模型自己学会的 curl 片段。
- 为无 IDE 路径定义降级策略：
  - 无流式时使用 chunked transcript 或轮询更新
  - 无 step 数据时展示 message-only timeline
  - 无 cancel 时前端显式展示能力差异
- 补一节“上下文装配策略”，明确 rules、memory、live query 三者如何协同，避免另一轮 prompt 膨胀。

---

## 五、三个决策点推荐（A/B/C 选项）

### 决策点 1：CEO 在对话中的行动权限边界

- **选项 A：全自主** —— CEO 在 Chat 中直接通过 API / curl 完成全部操作，后端不加额外治理层。
- **选项 B：全受控** —— 所有查询与写操作都必须走 `ceo-agent.ts` 侧的后处理/校验层。
- **选项 C：混合模式** —— 查询类操作自主，创建/派发/取消/重试等写操作走受控 action service。
- **推荐：C**
- **原因**：当前系统最有价值的治理资产正是负载检查、`ceoDecision` 持久化、项目级审计。全部放开会丢治理，全部收死又会削弱对话模式的自然性。混合模式最符合现状与目标的平衡点。

### 决策点 2：`chat-runtime.ts` 的“无 IDE”路径优先级

- **选项 A：一次到位** —— Phase 3 直接实现 IDE 与无 IDE 的完整双路径，且都提供流式体验。
- **选项 B：IDE 优先** —— Phase 3 只做 IDE 原生路径，无 IDE 留到后续 provider 扩展。
- **选项 C：分层落地** —— Phase 3 先落统一 session / step 抽象；IDE 路径完整上线；无 IDE 路径先给 Codex 级降级模式，真正的 API-provider 流式留到下一阶段。
- **推荐：C**
- **原因**：这是当前代码基座下最稳的路线。直接上 A 会被 `TaskExecutor` 抽象能力不足卡住；只选 B 又会让“Provider 独立”目标继续悬空。C 可以先把架构骨架搭对，再让 provider 能力逐步补齐。

### 决策点 3：前端体验形态

- **选项 A：嵌入式面板** —— 在现有 Dashboard 中展开 CEO Chat。
- **选项 B：独立路由** —— 进入单独页面承载 CEO Chat。
- **选项 C：混合入口** —— 默认从 Dashboard 面板进入，同时提供独立深链页面复用同一 session store。
- **推荐：C**
- **原因**：CEO 对话既有“快速问一句”的轻量场景，也有“长链路协同调度”的重度场景。混合入口既保留当前 Dashboard 操作连续性，也给后续历史回放、分享链接、长会话恢复留足空间。

---

## 最终建议

- 这份设计**建议继续推进**，但应在立项前先补齐三处关键修订：
  1. 明确“已有能力”与“待建能力”的边界，尤其是 memory retrieval、无 IDE streaming、标准 API 治理补层。
  2. 把 `chat-runtime.ts` 的底层抽象从“任务执行接口”升级为“会话接口”。
  3. 把 CEO 写操作统一收敛到受控 action service，避免对话模式绕开治理与审计。
- 如果上述修订完成，本方案会是一次 **高价值、低破坏、与 Group Elimination 兼容** 的正确演进。
