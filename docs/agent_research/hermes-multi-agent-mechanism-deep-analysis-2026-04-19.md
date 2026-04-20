# Hermes-Agent Multi-Agent 机制深度分析

> **分析对象**: [hermes-agent](file:///Users/darrel/Documents/hermes-agent)
> **日期**: 2026-04-19
> **分析范围**: delegate_tool.py (1144行), run_agent.py (11651行), toolsets.py (703行), model_tools.py (563行), batch_runner.py (1291行)

---

## 一、Multi-Agent 机制总览

### 1.1 架构模型：Parent-Child Delegation（父子委托模型）

Hermes-Agent 的 Multi-Agent 机制采用的是 **LLM-Driven Delegation**（LLM 驱动的委托模型），核心特点：

- **不是预定义 DAG**：没有显式的工作流编排图，agent 由 LLM 在运行时自主决定是否要 spawn subagent
- **不是 Swarm**：不是对等 agent 之间自由通讯，而是严格的 parent→child 单向委托
- **核心工具**：`delegate_task` 是唯一的 Multi-Agent 入口，作为一个普通 tool 注册在 tool registry 中

### 1.2 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `AIAgent` | `run_agent.py` | 统一的 agent 实体，parent 和 child 用同一个类 |
| `delegate_task()` | `tools/delegate_tool.py` | 委托入口：构建 child、分发执行、收集结果 |
| `_build_child_agent()` | `tools/delegate_tool.py` | child agent 工厂：继承 parent 凭证+配置，但隔离上下文 |
| `_run_single_child()` | `tools/delegate_tool.py` | child 运行器：心跳、凭证租赁、结果收集 |
| `IterationBudget` | `run_agent.py` | 线程安全迭代计数器，parent/child 各自独立 |
| `_should_parallelize_tool_batch()` | `run_agent.py` | tool-call 级别的并行安全检测 |

### 1.3 调用链路

```
User Message
  → AIAgent.run_conversation()
    → LLM API call → response.tool_calls
      → tool_calls 中包含 delegate_task
        → delegate_task()
          → _build_child_agent() × N (主线程构建)
          → 单任务: 直接运行 _run_single_child()
          → 多任务: ThreadPoolExecutor 并行运行
            → child.run_conversation() (每个 child 独立完整的 agent loop)
          → 收集结果 JSON → 返回给 parent 的上下文
```

---

## 二、并行与串行处理机制

### 2.1 两层并行体系

Hermes 的并行发生在**两个不同层级**：

#### 层级 1：Tool-Call 级并行（同一 agent 内）

当 LLM 在单个 turn 中返回多个 tool_calls 时，系统会判断是否可以并行执行：

```python
# run_agent.py L267-308
_PARALLEL_SAFE_TOOLS = frozenset({
    "read_file", "search_files", "web_search", "web_extract",
    "session_search", "vision_analyze", ...
})
_NEVER_PARALLEL_TOOLS = frozenset({"clarify"})
_PATH_SCOPED_TOOLS = frozenset({"read_file", "write_file", "patch"})
```

**并行条件**（全部满足才并行）：
1. batch 中有 2+ tool calls
2. 没有 `_NEVER_PARALLEL_TOOLS`（如 `clarify`）
3. 所有 tool 要么属于 `_PARALLEL_SAFE_TOOLS`，要么属于 `_PATH_SCOPED_TOOLS` 且路径不重叠
4. 路径重叠检测使用 `_paths_overlap()` 做前缀匹配

**并行执行器**：`ThreadPoolExecutor`，最大 `_MAX_TOOL_WORKERS = 8`

#### 层级 2：Subagent 级并行（delegate_task batch 模式）

`delegate_task` 支持两种模式：
- **Single**：`goal` 参数 → 单任务，直接运行（无线程池开销）
- **Batch**：`tasks` 数组 → `ThreadPoolExecutor` 并行运行

```python
# delegate_tool.py L731-741
if n_tasks == 1:
    result = _run_single_child(0, _t["goal"], child, parent_agent)
else:
    with ThreadPoolExecutor(max_workers=max_children) as executor:
        # 并行执行
```

### 2.2 串行约束

以下场景**强制串行**：

| 场景 | 机制 | 代码位置 |
|------|------|----------|
| 包含 `clarify` 的 tool batch | `_NEVER_PARALLEL_TOOLS` 检测 | run_agent.py L273 |
| 写同一文件的多个操作 | `_paths_overlap()` 检测 | run_agent.py L296-302 |
| 无法解析 args 的 tool | JSON parse 失败 fallback | run_agent.py L280-287 |
| 单个 delegate_task | 直接调用无线程池 | delegate_tool.py L731-734 |
| Agent 主循环 | 同步 while loop，每次 API call 串行 | run_agent.py L8646 |

### 2.3 并发控制参数

| 参数 | 默认值 | 配置方式 | 作用 |
|------|--------|----------|------|
| `max_concurrent_children` | 3 | `config.yaml: delegation.max_concurrent_children` / `DELEGATION_MAX_CONCURRENT_CHILDREN` | subagent 并发上限 |
| `_MAX_TOOL_WORKERS` | 8 | 硬编码 | tool-call 并行线程上限 |
| `MAX_DEPTH` | 2 | 硬编码 | 委托深度限制(parent→child→❌) |

---

## 三、Agent 约束体系：强约束 vs 弱约束

### 3.1 强约束（代码层面硬性限制，无法绕过）

| 约束类别 | 具体内容 | 实现方式 |
|----------|----------|----------|
| **工具黑名单** | `delegate_task`, `clarify`, `memory`, `send_message`, `execute_code` 对 child 禁用 | `DELEGATE_BLOCKED_TOOLS` frozenset + `_strip_blocked_tools()` |
| **工具白名单交集** | child toolset ⊆ parent toolset（不能越权） | `_build_child_agent()` L284: `[t for t in toolsets if t in parent_toolsets]` |
| **递归深度限制** | parent(0)→child(1)→grandchild 被拒(2) | `MAX_DEPTH = 2`，`delegate_task()` L646-653 检查 |
| **并发数硬上限** | batch tasks > max_children 时直接返回错误 | `delegate_task()` L672-680 |
| **delegate_task call 截断** | LLM 生成多个 delegate_task call 时截断 | `_cap_delegate_task_calls()` L3647-3675 |
| **迭代预算** | 每个 child 独立 `IterationBudget`，默认 50 次 | `delegation.max_iterations` 配置 |
| **上下文完全隔离** | child 不继承 parent 对话历史 | `_build_child_system_prompt()` 只包含 goal+context |
| **用户交互禁止** | child 无法调用 `clarify`（callback=None） | `_build_child_agent()` L367: `clarify_callback=None` |
| **内存隔离** | child 跳过 MEMORY.md 和 context files | `skip_memory=True, skip_context_files=True` |

### 3.2 弱约束（Prompt 层面，依赖 LLM 遵守）

| 约束类别 | 具体内容 | 实现方式 |
|----------|----------|----------|
| **任务聚焦** | "You are a focused subagent working on a specific delegated task" | system prompt 文本 |
| **输出格式** | 要求返回 what/found/files/issues 四段总结 | system prompt 文本 |
| **工作空间路径** | 注入 WORKSPACE PATH 提示 | `_resolve_workspace_hint()` |
| **简洁性** | "Be thorough but concise" | system prompt 文本 |
| **工具选择建议** | schema description 中的使用指导 | `DELEGATE_TASK_SCHEMA` |
| **Parent 委托决策** | LLM 自行决定何时 delegate | schema 中的 WHEN TO USE / WHEN NOT TO USE |

### 3.3 约束继承关系

```
Parent Agent
  ├── model/provider/api_key → 可被 delegation config 覆盖
  ├── toolsets → child ⊆ parent（交集）
  ├── reasoning_config → 可被 delegation.reasoning_effort 覆盖
  ├── platform → 直接继承
  ├── credential_pool → 共享（同 provider）或独立加载
  ├── session_db → 共享引用（parent_session_id 记录关系）
  └── conversation_history → ❌ 不继承（完全隔离）
```

---

## 四、过程与结果检视机制

### 4.1 检视层级总览

Hermes 的检视机制是 **分层、回调驱动** 的，没有独立的 "审查引擎" 或 "supervisor agent"：

```
Layer 1: 心跳 (Heartbeat)
  ↓
Layer 2: Progress Callback (工具进度回调)
  ↓
Layer 3: Interrupt Propagation (中断传播)
  ↓
Layer 4: Result Collection & Trace (结果收集+工具追踪)
  ↓
Layer 5: Memory Notification (记忆通知)
  ↓
Layer 6: Parent LLM Review (父 LLM 审查结果)
```

### 4.2 各层详解

#### Layer 1: 心跳机制

```python
# delegate_tool.py L437-466
def _heartbeat_loop():
    while not _heartbeat_stop.wait(_HEARTBEAT_INTERVAL):  # 30秒
        parent_agent._touch_activity(desc)  # 更新 parent 活跃时间
```

- **目的**：防止 gateway 因 parent 看起来"无活动"而杀掉 agent
- **频率**：30 秒
- **内容**：汇报 child 当前在做什么（tool 名称 + iteration 进度）

#### Layer 2: 工具进度回调

```python
# delegate_tool.py L158-235
def _build_child_progress_callback(task_index, parent_agent, task_count):
    # CLI: 在 parent spinner 上方打印 tree-view
    # Gateway: batch tool names 后 relay 给 parent callback
```

两条显示路径：
- **CLI**：tree-view 行（`├─ 🔍 web_search "query"`）打印在 spinner 上方
- **Gateway**：batch 5 个 tool name 后 relay 给 parent 的 `tool_progress_callback`

#### Layer 3: 中断传播

```python
# run_agent.py L3103-3148
def interrupt(self, message=None):
    self._interrupt_requested = True
    # 传播到所有活跃的 child agent
    with self._active_children_lock:
        children_copy = list(self._active_children)
    for child in children_copy:
        child.interrupt(message)
```

- parent 收到中断 → 递归传播到所有 child
- child 在下一次 loop iteration / tool execution 检查点退出
- 并行 batch 中未完成的 child 标记为 `interrupted`

#### Layer 4: 结果收集

每个 child 返回结构化结果：

```python
{
    "task_index": int,
    "status": "completed" | "failed" | "interrupted" | "error",
    "summary": str,           # child 的最终回答
    "api_calls": int,
    "duration_seconds": float,
    "exit_reason": "completed" | "max_iterations" | "interrupted",
    "tokens": {"input": int, "output": int},
    "tool_trace": [            # 工具调用追踪
        {"tool": str, "args_bytes": int, "result_bytes": int, "status": "ok"|"error"}
    ]
}
```

#### Layer 5: 记忆通知

```python
# delegate_tool.py L836-846
parent_agent._memory_manager.on_delegation(
    task=_task_goal,
    result=entry.get("summary", ""),
    child_session_id=...,
)
```

#### Layer 6: Parent LLM 审查

**这是最关键的一层**：delegate_task 的返回值（JSON）被注入 parent 的上下文，由 **parent 的 LLM 自行判断**：
- 结果是否满意
- 是否需要重新 delegate
- 是否需要补充额外操作

> **关键点**：Hermes 没有独立的 reviewer/supervisor agent，审查完全由 parent LLM 完成。

### 4.3 检视盲区

| 盲区 | 说明 |
|------|------|
| **无实时工具拦截** | child 执行危险命令时，parent 无法中途介入（只能事后看结果） |
| **无 child 输出流** | parent 看不到 child 的中间推理过程（只看最终 summary） |
| **无自动重试** | child 失败后，是否重试完全由 parent LLM 判断 |
| **无跨 child 协调** | 并行 child 之间无通信机制 |

---

## 五、系统设计优缺点

### 5.1 优点

#### ★★★★★ 简洁优雅

整个 Multi-Agent 系统的核心代码只在 `delegate_tool.py`（1144行）中，没有复杂的编排层、状态机、或中间件。Agent 实体统一（`AIAgent`），parent 和 child 共用同一套代码。

#### ★★★★★ 上下文隔离

Child 完全不继承 parent 对话历史，只接收 goal + context。这意味着：
- child 的 token 窗口不会被 parent 累积的大量历史占满
- child 的中间推理不会污染 parent 的上下文
- parent 只看到精炼的 summary

#### ★★★★☆ 灵活的并行

两层并行体系：
- Tool-call 级：自动检测安全性（路径不重叠的文件操作可并行）
- Subagent 级：batch 模式支持多任务并行

#### ★★★★☆ 凭证管理

- 同 provider → 共享 credential_pool（避免 rate limit）
- 不同 provider → 独立加载 pool
- 支持 per-child credential lease（租赁制，用完释放）

#### ★★★★☆ 资源生命周期管理

```python
# delegate_tool.py L617-621 (finally block)
if hasattr(child, 'close'):
    child.close()  # 清理 terminal sandbox, browser daemon, bg processes
```

每个 child 完成后自动清理：terminal sandbox、browser session、background processes、httpx clients。

#### ★★★★☆ 可配置性

| 配置项 | 说明 |
|--------|------|
| `delegation.model` | child 使用不同模型 |
| `delegation.provider` | child 使用不同 provider |
| `delegation.max_iterations` | child 迭代上限 |
| `delegation.max_concurrent_children` | 并发上限 |
| `delegation.reasoning_effort` | child 推理强度 |
| `delegation.base_url` / `api_key` | 直接指定端点 |

### 5.2 缺点

#### ★★☆☆☆ 无 Agent 间通信

并行执行的 child agents 之间**完全没有通信机制**。如果 Task A 发现了一个关键信息而 Task B 也需要，没有任何方式在运行时共享。每个 child 只能通过 parent 间接沟通。

#### ★★☆☆☆ 无结构化审查

没有独立的 reviewer agent 或审查引擎。child 的输出质量完全依赖：
1. Parent LLM 的判断力
2. Schema description 中的弱提示

与 AG 系统的 7 层纵深检视（心跳→Supervisor→审查引擎→Scope Audit→Journal→Checkpoint→Intervention）形成鲜明对比。

#### ★★☆☆☆ 递归深度限制

`MAX_DEPTH = 2` 硬编码，意味着只能 parent→child，没有 grandchild。这限制了复杂任务的分解深度。虽然从安全角度合理，但无法处理需要层层分解的超复杂任务。

#### ★★★☆☆ 静态并发上限

`max_concurrent_children` 是静态值（默认 3），没有根据负载/资源动态调节的能力。无弹性调度。

#### ★★★☆☆ 进程内全局状态污染风险

```python
# model_tools.py L159
_last_resolved_tool_names: List[str] = []  # 进程全局！
```

`_last_resolved_tool_names` 是进程全局变量，child 构建时会覆盖。虽然有 save/restore 机制（`_delegate_saved_tool_names`），但在并行场景下仍存在短暂的竞态窗口。

#### ★★☆☆☆ 无文件隔离

Parent 和所有 children 共享同一个文件系统。如果两个 parallel children 操作同一个文件，会产生竞态。系统没有任何文件锁或 workspace isolation（除非使用 Docker/Modal terminal）。

#### ★★★☆☆ Token 效率

每个 child 需要：
- 独立的 system prompt（包含 goal + context + workspace hints）
- 独立的 tool schema（完整的 tool definitions）
- 完整的 agent loop（API call、tool execution、summary generation）

对于简单任务，delegate overhead 可能超过任务本身。

---

## 六、与 AG Multi-Agent 系统的对比

| 维度 | Hermes-Agent | AG (Antigravity) |
|------|-------------|-----------------|
| **编排模型** | LLM-Driven Delegation | 显式 DAG + 中央治理 |
| **Agent 定义** | 运行时动态（同一个 AIAgent 类） | 静态 Role 定义（Author/Reviewer/Worker） |
| **并行机制** | ThreadPoolExecutor + batch | Fan-Out Controller + maxConcurrency |
| **串行机制** | 单 agent loop（while loop） | Review Loop（Author↔Reviewer 循环） |
| **通信** | 无直接通信，仅通过 parent 中转 | Shared Conversation（V5.5） |
| **强约束** | 工具黑名单 + 深度限制 + 迭代预算 | Source Contract + Resource Quota + Token Quota + Review Policy + Timeout |
| **审查机制** | Parent LLM 自行判断 | 7 层纵深（Supervisor→审查引擎→Scope Audit→Journal→Checkpoint→Intervention） |
| **故障恢复** | 无 checkpoint | Checkpoint Manager + 断点续跑 |
| **可观测性** | 心跳 + progress callback + tool trace | Execution Journal + Step-level 回放 |
| **可预测性** | ★★★（LLM 决策不确定性） | ★★★★★（DAG 确定性） |
| **灵活性** | ★★★★★（任何场景即兴委托） | ★★★（需预定义 workflow） |
| **Token 效率** | ★★★（per-child 完整 loop） | ★★（~6.9× vs CC） |
| **复杂度** | ★★（~1200 行核心代码） | ★★★★★（数千行编排层） |

---

## 七、关键异常处理：防偷懒与进度一致性

在大型任务分解中，Hermes-Agent 对核心异常场景的处理机制高度依赖于大模型本身的智力，而非严密的工程约束。

### 7.1 防止“偷懒结束任务”（防敷衍/早退）

Hermes-Agent **没有设立独立的 Reviewer（审查员）**，它主要依靠父级兜底和预算隔离来防止子任务敷衍：

1. **父级 LLM 绝对审查权 (Parent's Ultimate Authority)**：子 Agent 跑完后，只能通过 JSON 返回包含执行轨迹和输出的 `summary`。父 Agent 收到后，如果在自己的 `while` 循环中发现子 Agent 偷懒、没拿到核心代码，父 Agent 会亲自下场补救，或重新委派。
2. **预算与上下文的硬隔离 (Isolated Budget & Context)**：子 Agent 被分配独立的 `IterationBudget`（默认 50 次），且**不继承**父 Agent 几十轮的聊天历史（`skip_memory=True`）。干净的上下文强制其目光只聚焦在当前分配的 `goal` 上。
3. **强制结构化汇报 (Structured Reporting Prompt)**：系统对子 Agent 注入硬性汇报要求，必须返回工具使用踪迹（Tool Trace）和详细发现，逼迫模型不能只回一句“我搞定了”。

**致命软肋（阿喀琉斯之踵）**：如果**父模型自身偷懒**（产生幻觉，认为子 Agent 做的很完美），整个任务防线就会彻底崩塌。系统没有任何强制的防御代码去 assert（断言）“代码是否实际修改”。由于缺乏 AG 系统的结构化 Review 环，此时系统只能将“半成品”丢给用户，**把人类用户当做终极的 Reviewer** 来进行 PUA 纠错。

### 7.2 防止“任务进度不一致”（防并发混乱/状态冲突）

在多 Agent 并发完成任务时，Hermes-Agent 通过**“绝对的互不干涉”**与**“硬阻塞同步”**来确保进度一致：

1. **绝对隔离与星型拓扑 (Star Topology)**：并发的多个子 Agent 之间**绝对禁止通信**，彻底消灭了“A 等 B 的变量”、“A 覆盖了 B 的状态”这种进度不一致的分布式难题。
2. **Fan-Out / Join 强制阻塞 (Strict Thread Join)**：父 Agent 派发并发任务后，会进入 `concurrent.futures.wait` 阻塞状态。必须等到所有子 Agent 的进度全部 100% 完结并交出 `summary` 时，父 Agent 才会醒来，进行一致性合并。
3. **文件读写锁与并发降级 (Parallel-Safe Tool Downgrade)**：`_should_parallelize_tool_batch` 会检测 `write_file` 或 `patch` 操作。一旦通过 `_paths_overlap()` 发现两个并行任务可能操作同一个文件，系统会强制取消并行，**降级为串行执行**，从物理层面阻止进度互相覆盖。

---

## 八、关键源码引用

| 文件 | 行号 | 内容 |
|------|------|------|
| [delegate_tool.py](file:///Users/darrel/Documents/hermes-agent/tools/delegate_tool.py#L32-L38) | L32-38 | `DELEGATE_BLOCKED_TOOLS` 工具黑名单 |
| [delegate_tool.py](file:///Users/darrel/Documents/hermes-agent/tools/delegate_tool.py#L53) | L53 | `MAX_DEPTH = 2` 深度限制 |
| [delegate_tool.py](file:///Users/darrel/Documents/hermes-agent/tools/delegate_tool.py#L238-L397) | L238-397 | `_build_child_agent()` 完整的 child 构建逻辑 |
| [delegate_tool.py](file:///Users/darrel/Documents/hermes-agent/tools/delegate_tool.py#L623-L853) | L623-853 | `delegate_task()` 主入口 |
| [run_agent.py](file:///Users/darrel/Documents/hermes-agent/run_agent.py#L267-L308) | L267-308 | `_should_parallelize_tool_batch()` 并行安全检测 |
| [run_agent.py](file:///Users/darrel/Documents/hermes-agent/run_agent.py#L3103-L3148) | L3103-3148 | `interrupt()` 中断传播 |
| [run_agent.py](file:///Users/darrel/Documents/hermes-agent/run_agent.py#L3647-L3675) | L3647-3675 | `_cap_delegate_task_calls()` 截断多余委托 |
| [run_agent.py](file:///Users/darrel/Documents/hermes-agent/run_agent.py#L7350-L7371) | L7350-7371 | `_execute_tool_calls()` 串行/并行分发 |
| [run_agent.py](file:///Users/darrel/Documents/hermes-agent/run_agent.py#L7485-L7750) | L7485-7750 | `_execute_tool_calls_concurrent()` 并行执行器 |
| [run_agent.py](file:///Users/darrel/Documents/hermes-agent/run_agent.py#L8646) | L8646 | 主 agent loop while 条件 |
| [toolsets.py](file:///Users/darrel/Documents/hermes-agent/toolsets.py#L31-L63) | L31-63 | `_HERMES_CORE_TOOLS` 核心工具列表 |

---

## 九、结论

Hermes-Agent 的 Multi-Agent 机制是一个**极简但实用**的设计：

1. **核心理念**：把 subagent delegation 当作一个普通 tool，让 LLM 自主决定何时使用
2. **最大优势**：简洁（~1200 行代码）、灵活（运行时动态委托）、上下文隔离干净
3. **最大短板**：无结构化审查、无 agent 间通信、无文件隔离、无 checkpoint
4. **工程与 AI 的贡献比**：**20% 工程约束 / 80% AI 能力依赖**。系统放弃了厚重的状态机与验证流水线，防偷懒与防冲突的核心实际上全权交给了顶级大模型（如 Claude 3.5 Sonnet）自身的逻辑严密性。如果模型犯傻，系统防线就会被直接穿透，最终由用户充当“兜底的 Reviewer”来进行纠错。
5. **适用场景**：适合"一个主 agent + 几个独立 worker"的场景，不适合需要多 agent 紧密协作的复杂工作流
6. **设计哲学**：信任 LLM 的判断力，用最少的代码提供最大的灵活性；与 AG 的"显式编排+深度治理"形成两种截然不同的设计范式
