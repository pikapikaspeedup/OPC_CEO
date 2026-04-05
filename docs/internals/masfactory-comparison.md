# MASFactory vs Antigravity Gateway — Multi-Agent 机制深度对比

> 基于 [MASFactory](https://github.com/BUPT-GAMMA/MASFactory)（commit 对应 arXiv:2603.06007）源码与本项目 `docs/internals/` 文档的并排研究。
>
> 目标：理解两套系统在 Agent 编排、状态管理、Review 机制、可观测性等维度的本质差异，为后续融合设计提供依据。

---

## 1. 设计哲学

| 维度 | MASFactory | Antigravity Gateway |
|------|-----------|---------------------|
| **核心隐喻** | **图（Graph）**— Node/Edge 有向图 | **Pipeline 流水线**— Stage 串行流水线 |
| **定位** | 框架：用户自己组装 Agent 图 | 产品：固化的工程交付流水线 |
| **控制权** | 用户完全控制拓扑（声明式/命令式/AI生成） | 框架控制 Stage 编排，用户只配置角色和 Review 策略 |
| **执行引擎** | 纯 Python 内存图执行 | Antigravity IDE 内置 LS（Language Server）黑盒执行 |
| **任务粒度** | 单次任务为主，可嵌套 Loop | 面向多轮工程项目，含 Project/Pipeline 持久状态 |

---

## 2. Agent 抽象层

### MASFactory：Agent 是 `Node` 的子类

```python
class Agent(Node):
    instructions: str | list[str]  # system prompt 模板（含 {field} 占位符）
    model: Model                   # 模型适配器
    tools: list[Callable]         # Python 函数工具，自动生成 schema
    memories: list[Memory]        # 记忆后端（向量/历史对话）
    retrievers: list[Retrieval]   # RAG 检索器
    pull_keys / push_keys         # 输入/输出字段声明（类型安全的消息路由）
```

核心执行模式：**Think → Act ReAct 循环**——Agent 持续调用工具直到无工具调用为止，所有状态通过 `_attributes_store` dict 在节点内维护。

### Antigravity：Agent = Workflow `.md` + LS 黑盒

```json
{
  "roles": [{
    "roleId": "dev-worker",
    "workflowFile": "dev-worker.md",   // ~/ 全局路径下的 Markdown system prompt
    "model": "MODEL_PLACEHOLDER_M35",
    "maxRetries": 3
  }]
}
```

Agent 执行完全在 Antigravity LS 进程内进行，Gateway 只负责触发（`StartCascade` + `SendUserCascadeMessage`）和监听结果流（`StreamAgentStateUpdates`）。Gateway 对 Agent 内部 ReAct 细节不可见。

| 维度 | MASFactory | Antigravity |
|------|-----------|-------------|
| 执行位置 | 框架进程内 Python 循环 | IDE LS 进程（黑盒） |
| System prompt | Python 字符串/模板（`{field}` 占位符） | Markdown 文件（`/dev-worker` 风格指令） |
| 工具定义 | Python 函数装饰器，自动抽取 schema | LS 内置工具链（文件读写/终端/MCP 工具） |
| Agent 状态 | `_attributes_store` dict（节点局部） | LS 的 Cascade/Trajectory steps 流 |
| 多轮对话 | `HistoryMemory` + `ContextBlock` | gRPC `StreamAgentStateUpdates` 增量流 |

---

## 3. 编排/控制流

### MASFactory：图拓扑（Graph Topology）

```
Node ←→ Edge ←→ Node
         ↓
    Gate (OPEN/CLOSED)    ← 控制数据流是否通过
         ↓
    AgentSwitch           ← LLM 决定走哪条边（YES/NO 条件评估）
    LogicSwitch           ← 代码函数决定走哪条边（确定性路由）
    Loop (max_iterations) ← 循环直到终止条件或达到最大次数
    VibeGraph             ← AI 从自然语言自动生成图拓扑
    ComposedGraph         ← 可复用的子图模板（NodeTemplate 机制）
```

控制流是**数据驱动**的：Edge 上有 `Gate`（OPEN/CLOSED），节点根据上游消息决定是否激活。支持分支（Switch）、循环（Loop）、嵌套子图。

### Antigravity：流水线（Pipeline Stages）

```
Stage 0 (product-spec)
    ↓ Source Contract 注入上游产物（requireReviewOutcome: ['approved']）
Stage 1 (architecture-advisory)
    ↓ Review Engine 决定是否通过
Stage 2 (autonomous-dev-pilot)
    ↓ 自动触发下一 Stage（tryAutoTriggerNextStage）
```

控制流是**线性 + 审阅门控**的：Stage 只能串行前进，无分支/循环，通过 `blocked` + 用户 `intervene` 实现异常处理，侧重工程交付可追溯性。

| 维度 | MASFactory | Antigravity |
|------|-----------|-------------|
| 控制流结构 | 有向图（含分支/循环/并行） | 线性 Pipeline（串行 Stage） |
| 路由决策者 | LLM（AgentSwitch）或代码（LogicSwitch） | Review Engine（Supervisor Agent 打分） |
| 循环支持 | ✅ `Loop` 组件（max_iterations + 终止函数/prompt） | ❌ 无原生循环（靠 maxRetries 近似，最多 3 轮） |
| 并行执行 | 拓扑上可实现（多个无依赖节点同时触发） | ❌ Stage 严格串行 |
| 动态图生成 | ✅ `VibeGraph`（AI 从自然语言生成图设计 → JSON 缓存 → 编译执行） | ❌ 图拓扑固定在 Template JSON 中 |

---

## 4. 状态/记忆管理

| 维度 | MASFactory | Antigravity |
|------|-----------|-------------|
| 跨节点状态传递 | `pull_keys`/`push_keys` 声明式字段映射（编译态检查） | Source Contract（上游 Run 产物 JSON 注入下游 prompt） |
| 对话历史 | `HistoryMemory`（消息列表，top_k 截断） | LS 内置 Cascade history（LS 自管理，Gateway 不介入） |
| 长期记忆 | `VectorMemory`（嵌入向量检索）+ `HistoryMemory` | `brain/`（Antigravity 专属，Gateway 不可见） |
| RAG | `Retrieval` 适配器（文档检索，`UltraRAG` 集成） | Knowledge library（`/api/knowledge`，Gateway 代理） |
| 运行时状态持久化 | 运行时内存（**无内置持久化**，进程崩溃丢失） | JSON 文件 `agent_runs.json` + `projects.json`（可跨进程恢复） |
| 节点间通信协议 | `Edge.send_message(dict)` 单条消息缓冲（同步） | REST → gRPC → LS，异步流 + WebSocket 推送 |

---

## 5. 工具调用

| 维度 | MASFactory | Antigravity |
|------|-----------|-------------|
| 工具定义 | Python 函数（从类型注解自动生成 schema） | LS 内置工具（文件/终端/MCP），用户不参与 |
| MCP 工具支持 | ✅ `MCPToolAdapter`（连接外部 MCP 服务端） | ✅ LS 内置 MCP 支持 + Gateway 自身暴露为 MCP 服务端 |
| 工具执行位置 | 框架进程内（Python 同步/异步调用，可调试） | LS 进程内（沙盒，Gateway 不可见） |
| 工具审批 | 无内置审批机制 | Auto-Approve 策略（检测 `isBlocking`，自动批准文件操作） |
| Human-in-the-loop | ✅ `Human` 节点（等待用户输入，阻塞图执行） | ✅ `blocked` 状态 + CLI `ag runs intervene` 命令 |

---

## 6. Review / 质检机制

### MASFactory：无内置 Review 层

用户自行在图中构建 Critic/Reviewer 节点和反馈循环：

```python
# ChatDev Lite 中的代码审查环路
code_review = chatdev_lite.create_node(CodeReviewPhase, ...)
chatdev_lite.create_edge(coder, code_review)  # 执行完输出给 reviewer
loop = chatdev_lite.create_node(
    Loop, "review_loop",
    terminate_condition_prompt="Is the code complete and correct?"
)
```

Review 逻辑完全用户自定义，框架不强制任何 Review 协议。

### Antigravity：内置 Review Engine + Supervisor 机制

```
角色执行完成
    ↓
Review Engine 读取 review-policy JSON（Supervisor 的 instructions + 评分标准）
    ↓
启动独立 Supervisor Agent（独立 Cascade，不是主 Agent 的子任务）
    ↓
    ├─ approved  →  标记角色通过，继续下一 Stage
    ├─ revise    →  返回修订意见 → 原角色重试（最多 maxRetries 轮）
    └─ rejected  →  标记 blocked，等待用户 CLI 介入
```

| 维度 | MASFactory | Antigravity |
|------|-----------|-------------|
| Review 机制 | 用户自定义（图中的 Critic 节点） | 内置 Review Engine，Supervisor 策略外置 JSON 配置 |
| Retry 控制 | `Loop(max_iterations=N)` 组件 | `maxRetries` 字段，Supervisor 驱动重试 |
| 拒绝后行为 | 图执行结束（需用户自行处理退出） | `blocked` 状态持久化，等待人工 CLI `intervene` |
| Review 与执行解耦 | ❌ Reviewer 也是普通 Agent 节点 | ✅ Supervisor Agent 完全独立于执行 Agent |
| Review 策略版本管理 | ❌ 无 | ✅ `review-policies/*.json`，可按项目覆盖 |

---

## 7. 外部接入 / 可观测性

| 维度 | MASFactory | Antigravity |
|------|-----------|-------------|
| 外部接入方式 | Python API 直接调用 `graph.invoke()`，无 HTTP 层 | REST API + WebSocket + CLI + MCP Server（stdio JSON-RPC）|
| 实时可观测性 | VS Code Visualizer（WebSocket 实时 Node/Edge 高亮 + 数据） | WebSocket `StreamAgentStateUpdates` + Timeline UI + `log-viewer-panel` |
| 可视化拓扑 | ✅ MASFactory Visualizer（拖拽节点/边，运行时高亮） | ❌ 仅有步骤时间线 UI，无图拓扑可视化 |
| 调试钩子 | ✅ `hook_register()`（节点/边级别，pre/post 钩子） | ✅ `pino` 结构化日志 + API 请求/响应追踪 |
| 多通道接入 | ❌ 无 | ✅ 微信 cc-connect ACP + REST + CLI + MCP |
| 远程隧道 | ❌ | ✅ Cloudflare Tunnel 集成（`/api/tunnel`） |

---

## 8. 语言 / 运行时

| 维度 | MASFactory | Antigravity |
|------|-----------|-------------|
| 语言 | Python 3.10+ | TypeScript (Next.js 16，Node.js) |
| 模型调用 | 通过 `Model` 适配器（OpenAI SDK，可扩展） | 通过 LS gRPC，模型选择在 LS 侧，Gateway 只传 model ID |
| 并发模型 | Python asyncio（图执行异步化） | Node.js 事件循环 + gRPC streaming |
| 依赖外部进程 | 无（纯 Python 进程内） | 强依赖 Antigravity IDE LS 进程（现在可 fallback Codex CLI） |

---

## 9. 核心差异一句话总结

```
MASFactory：                           Antigravity Gateway：
─────────────────────────────────       ───────────────────────────────────
有向图（任意拓扑）                     线性 Pipeline（固定 Stage 顺序）
纯框架（用户构建所有 Agent）            产品（预定义角色 + Review 策略）
Python 进程内执行（可见、可调试）       LS 黑盒执行（只见结果流）
单轮任务 + 可复用 Loop                多项目 + Pipeline 状态持久化
VibeGraph：AI 自动设计图拓扑           手工配置 Template JSON，无动态拓扑
无内置 Review，需自行设计              内置 Supervisor Review Engine
MCP 工具适配器（从框架连接外部工具）   Gateway 自身作为 MCP Server 被外部连接
VS Code 可视化调试器（运行时）         Web UI + Timeline + 微信接入
```

---

## 10. 互补机会与融合方向

见 [masfactory-integration-design.md](./masfactory-integration-design.md)。

---

## 11. 审核调整建议

这份对比文档保留其分析价值，但在实施层面需要加上以下边界：

- MASFactory 适合作为中长期能力参考，不适合作为当前代码库的直接施工图。
- 当前更合理的映射顺序是：
  - Visualizer 思路 → `V4.3`
  - Typed contracts → `V4.4`
  - Graph IR → `V5.0`
  - Graph authoring → `V5.1`
  - Loop / Switch → `V5.2`
  - VibeGraph → `V5.3`
- 不建议直接引入 Python runtime、第二套 Graph Runner、或依赖 agent 内部可见状态的调度方式。
- 在现有 LS / Codex 黑盒执行器前提下，真正应该先补的是 contract、compiler、journal、checkpoint，而不是自由形态图执行。
