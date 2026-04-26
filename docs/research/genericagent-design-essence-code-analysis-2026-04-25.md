# GenericAgent 代码级设计精髓分析

**日期**: 2026-04-25  
**性质**: 友商代码研究 / 架构吸收文档  
**研究对象**: <https://github.com/lsdefine/GenericAgent>  
**本次阅读方式**: 重新浅克隆最新代码到临时目录，只读分析，不运行其 Agent。  
**目标**: 从代码结构中提炼 GenericAgent 的真实设计精髓，并映射到 OPC / AI CEO 系统的长期演进。

---

## 1. 一句话结论

GenericAgent 的核心不是“代码少”，而是：

> 用极小执行内核把 LLM 接到真实电脑，再用严格的记忆分层和 SOP/Skill 结晶机制，把能力增长转移到资产层，而不是让核心代码持续膨胀。

它真正值得学习的是四个点：

1. **Seed Kernel**：核心 loop 极小，主要负责模型调用、工具派发、下一轮 prompt 组装和退出判断。
2. **Protocol as Runtime Contract**：`<summary>`、`<tool_use>`、working memory、danger prompt 都是代码强制参与的执行协议，不只是 prompt 文案。
3. **Memory as Growth Layer**：长期能力不是写进核心代码，而是沉淀到 L1/L2/L3/L4、SOP、脚本和 skill 检索。
4. **Autonomy with Friction**：自主执行有轮次、冷却、报告文件、ask_user、计划模式、验证模式等摩擦，不是无限循环。

---

## 2. 代码全景

本次重点阅读的核心文件：

| 文件 | 行数级别 | 责任 |
|---|---:|---|
| `agent_loop.py` | 118 | 最小 Agent loop、工具派发、turn 控制 |
| `ga.py` | 558 | 物理工具实现、working memory、长期记忆入口、turn end guardrails |
| `llmcore.py` | 997 | LLM 适配、工具协议注入、summary 协议、token 压缩、fallback |
| `agentmain.py` | 266 | 启动、任务队列、session 管理、reflect 模式 |
| `reflect/scheduler.py` | 131 | 文件型 scheduler、冷却、报告路径、L4 归档触发 |
| `memory/memory_management_sop.md` | 89 | L0 记忆治理规则 |
| `memory/plan_sop.md` | 262 | 长任务 plan / verify / subagent 流程 |
| `memory/subagent.md` | 61 | 子 Agent 文件 IO 协议 |
| `memory/L4_raw_sessions/compress_session.py` | 252 | 原始会话压缩与历史归档 |
| `memory/skill_search/` | 约 200+ | 外部 skill 检索客户端 |

关键事实：

1. 它的“核心执行代码”确实很小，但不是没有复杂度。
2. 复杂度被转移到了 `memory/*.md`、SOP、脚本、skill 检索、外部浏览器桥接和模型协议里。
3. 这是一种“代码内核小、资产系统增长”的架构选择。

---

## 3. Kernel 精髓：Agent Loop 极小，但合同很强

参考代码：

1. <https://github.com/lsdefine/GenericAgent/blob/main/agent_loop.py>
2. <https://github.com/lsdefine/GenericAgent/blob/main/ga.py>

### 3.1 `StepOutcome` 是核心控制合同

`agent_loop.py` 里真正的 loop 只关心一个对象：

```text
StepOutcome {
  data
  next_prompt
  should_exit
}
```

它的含义非常关键：

1. `data`：工具结果，作为下一轮的事实输入。
2. `next_prompt`：工具或 handler 决定下一轮模型应该看到什么。
3. `should_exit`：工具可以主动终止任务，例如 `ask_user`。

这让 loop 本身不懂浏览器、不懂文件、不懂记忆、不懂调度。所有能力都挂在 handler 上。

### 3.2 Loop 只做五件事

`agent_runner_loop` 的实际职责很窄：

1. 给模型发 system + user。
2. 解析模型返回的 tool calls。
3. 调用 `handler.dispatch()`。
4. 收集 tool result 和 next prompt。
5. 调用 `turn_end_callback()` 注入下一轮约束。

这说明它不是“多模块业务编排器”，而是一个稳定的执行泵。

对 OPC 的启发：

> 我们的 AI CEO Kernel 也应该是一个小执行泵，不应该把部门、日报、Provider、UI 状态、审批、知识逻辑全部塞进同一个大服务。

### 3.3 工具派发是命名约定，不是复杂注册中心

`BaseHandler.dispatch()` 通过 `do_${tool_name}` 找方法。

优点：

1. 极少样板代码。
2. 工具 schema 和实现天然对应。
3. 添加工具成本低。

缺点：

1. 权限边界弱。
2. 缺少类型检查。
3. 工具能力治理靠约定。

对 OPC 的启发：

我们不能照搬这种弱类型派发，但可以学习它的边界：Kernel 只知道 `ToolResult -> NextPrompt`，工具本身应放到 provider / capability 层。

---

## 4. 模型协议精髓：Prompt 不是文案，是运行时协议

参考代码：

1. <https://github.com/lsdefine/GenericAgent/blob/main/llmcore.py>
2. <https://github.com/lsdefine/GenericAgent/blob/main/assets/tools_schema.json>

### 4.1 `<summary>` 是工作记忆的最小原子

`llmcore.py` 在工具协议里强制要求每轮输出：

```text
<summary>上次结果新信息 + 本次意图</summary>
```

`ga.py` 的 `turn_end_callback()` 会把 summary 提取出来，写入 `history_info`：

```text
[Agent] summary
```

然后 `_get_anchor_prompt()` 每轮把最近历史注入：

```text
### [WORKING MEMORY]
<history>...</history>
Current turn: N
<key_info>...</key_info>
```

设计精髓：

1. 它不依赖模型“自己记得刚才做了什么”。
2. 它要求模型每轮用非常短的物理快照交账。
3. 它把长上下文压缩为可连续注入的工作记忆。
4. 它把 token 成本控制在每轮可接受范围。

对 OPC 的启发：

我们需要 `RunCapsule` / `WorkingCheckpoint`，但不能只存最终 summary。每个关键执行轮次都应该有极短、结构化、可追溯的物理快照。

### 4.2 Tool Schema 缓存是上下文密度优化

`ToolClient._prepare_tool_instruction()` 如果发现工具 schema 未变化，不再重复塞完整 schema，而是提示：

```text
工具库状态：持续有效，可正常调用。调用协议沿用。
```

设计精髓：

1. 工具协议和工具列表很占 token。
2. 模型只需要在 schema 变化时重新看到完整 schema。
3. 固定工具集适合做“协议缓存”。

对 OPC 的启发：

我们的 workflow / skill / department context 不能每次全量注入。需要：

1. L1 索引短注入。
2. 命中后再展开具体 workflow / skill。
3. Provider / tools schema 可以做稳定缓存。

### 4.3 兼容多模型靠 adapter，不污染 loop

`llmcore.py` 里有：

1. `ClaudeSession`
2. `LLMSession`
3. `NativeClaudeSession`
4. `NativeOAISession`
5. `MixinSession`
6. `ToolClient`
7. `NativeToolClient`

Agent loop 不关心具体模型协议。模型差异在 adapter 层解决：

1. Claude message 格式。
2. OpenAI-compatible SSE。
3. Responses API。
4. Native tool call。
5. 文本 `<tool_use>` fallback。
6. 多 session fallback。

对 OPC 的启发：

我们现在 Antigravity IDE、Codex Native、Codex CLI、第三方 OpenAI-compatible Provider 的关系也应该如此：Provider adapter 解决协议差异，CEO Kernel 不应该知道太多 provider 特例。

---

## 5. 工具层精髓：少数原子工具覆盖真实世界

参考代码：

1. <https://github.com/lsdefine/GenericAgent/blob/main/ga.py>
2. <https://github.com/lsdefine/GenericAgent/blob/main/TMWebDriver.py>
3. <https://github.com/lsdefine/GenericAgent/blob/main/simphtml.py>

### 5.1 工具少，但半径大

主要工具：

1. `code_run`
2. `file_read`
3. `file_patch`
4. `file_write`
5. `web_scan`
6. `web_execute_js`
7. `update_working_checkpoint`
8. `ask_user`
9. `start_long_term_update`

这不是传统平台喜欢做的几十上百个业务 API，而是很少的物理工具。

设计精髓：

1. `code_run` 让 Agent 可以临时生成脚本解决新问题。
2. `file_read/file_patch/file_write` 让 Agent 控制文件系统。
3. `web_scan/web_execute_js` 让 Agent 控制真实浏览器。
4. 记忆工具让 Agent 把探索结果固化。
5. `ask_user` 把人类确认做成工具，而不是外部异常。

对 OPC 的启发：

我们不应该为每个业务场景硬编码一个 API。应保留少量强能力底座，然后让 workflow / skill / tool script 在资产层增长。

### 5.2 `file_patch` 的唯一匹配是低成本安全机制

`file_patch` 要求 `old_content` 唯一匹配，否则失败。

这看似简陋，但很关键：

1. 防止模型模糊改错。
2. 强迫修改前 `file_read`。
3. 把失败半径限制在一个文本块。

对 OPC 的启发：

AI 自我改代码时，不能默认大范围 rewrite。应优先：

1. 小块 patch。
2. 唯一上下文。
3. 修改前读取。
4. 修改后测试。
5. 高风险变更走审批。

### 5.3 Web 能力是“真实浏览器 + 简化 DOM”

`TMWebDriver.py` 和 `simphtml.py` 的设计不是开一个无状态 headless browser，而是连接真实浏览器 session，并把 DOM 压缩成模型可读形态。

设计精髓：

1. 保留登录态。
2. 不让模型直接看完整 DOM 噪声。
3. 用 JS 执行完成精确操作。
4. `web_scan` 做感知，`web_execute_js` 做行动。

对 OPC 的启发：

我们后续如果做桌面/Tauri/浏览器自动化，也要分成：

1. perception snapshot。
2. precise action。
3. evidence capture。
4. result verification。

---

## 6. 记忆系统精髓：增长靠晋升，不靠堆历史

参考代码：

1. <https://github.com/lsdefine/GenericAgent/blob/main/memory/memory_management_sop.md>
2. <https://github.com/lsdefine/GenericAgent/blob/main/memory/L4_raw_sessions/compress_session.py>
3. <https://github.com/lsdefine/GenericAgent/blob/main/ga.py>

### 6.1 L0/L1/L2/L3/L4 的职责非常清楚

GenericAgent 的记忆分层：

| 层级 | 作用 | 本质 |
|---|---|---|
| L0 | 记忆治理 SOP | 写记忆的宪法 |
| L1 | Insight Index | 极简导航索引 |
| L2 | Global Facts | 稳定事实库 |
| L3 | SOP / scripts | 可复用过程和工具 |
| L4 | Raw Session Archive | 历史会话归档 |

它最重要的规则：

1. `No Execution, No Memory`
2. 禁止存易变状态。
3. L1 只放最小充分指针。
4. L3 只放未来复用成本高的 SOP / script。
5. 写记忆前先读 L0。

设计精髓：

> 记忆不是“越多越好”，而是要经过晋升、压缩、索引和治理。

对 OPC 的启发：

我们现在的 Department Memory、KnowledgeAsset、Run archive 必须统一成类似的晋升体系，否则会变成噪声仓库。

### 6.2 `start_long_term_update` 是一个事务入口

`start_long_term_update` 不直接把当前内容写进去，而是开启一个“记忆提炼过程”：

1. 读取记忆治理 SOP。
2. 注入当前 global memory。
3. 要求提取行动验证成功、长期有效的信息。
4. 明确禁止临时变量、未验证信息、通用常识。
5. 要求最小局部修改。

设计精髓：

> 长期记忆写入不是普通 append，而是受 SOP 约束的 transaction。

对 OPC 的启发：

我们的 Knowledge / Memory 写入也应该是：

```text
run evidence -> candidate memory -> policy check -> merge/dedup/conflict -> publish
```

而不是 run 完成后直接追加 markdown。

### 6.3 L4 归档让“原始历史”不污染工作上下文

`compress_session.py` 会处理 `temp/model_responses` 下的原始 prompt/response 日志：

1. 压缩原始会话。
2. 提取 `<history>`。
3. 写入 `all_histories.txt`。
4. 按月 zip 归档。
5. 跳过最近 2 小时仍活跃的日志。

设计精髓：

1. 原始历史必须保留，但不能每次都进上下文。
2. 可检索历史和活跃 working memory 是两种东西。
3. 会话归档是长期反思的原料，不是每轮 prompt 的负担。

对 OPC 的启发：

我们的 run/journal/conversation 也应该分层：

1. 活跃 run capsule。
2. 可召回 knowledge。
3. 原始 archive。
4. 审计日志。

不要把原始 run 直接当“记忆”注入。

---

## 7. 自主循环精髓：调度只触发，不接管

参考代码：

1. <https://github.com/lsdefine/GenericAgent/blob/main/reflect/scheduler.py>
2. <https://github.com/lsdefine/GenericAgent/blob/main/reflect/autonomous.py>
3. <https://github.com/lsdefine/GenericAgent/blob/main/memory/scheduled_task_sop.md>

### 7.1 Scheduler 的输出是 prompt，不是业务执行

`scheduler.py` 做的事情非常少：

1. 文件锁防重复启动。
2. 每 120 秒扫描任务 JSON。
3. 判断 enabled、schedule、weekday、max_delay、cooldown。
4. 生成报告路径。
5. 返回一段 prompt 给 Agent 执行。

它不直接执行业务，不关心任务细节。

设计精髓：

> Scheduler 是 trigger，不是 worker brain。

对 OPC 的启发：

我们的 scheduler 不应该包含日报、部门、知识沉淀等业务逻辑。它应该只负责触发、预算、幂等、结果路径和状态。

### 7.2 幂等靠报告文件

GenericAgent 用 `sche_tasks/done/{timestamp}_{taskId}.md` 作为执行报告和冷却依据。

优点：

1. 简单。
2. 人类可读。
3. 调度和任务结果天然关联。

缺点：

1. 查询能力弱。
2. 多任务治理弱。
3. 不适合复杂平台。

对 OPC 的启发：

我们不能照搬文件调度，但应该保留这个思想：

```text
每个 scheduled run 必须有明确 result artifact / report path / run id
```

否则 scheduler 只会制造后台噪音。

### 7.3 自主行动有“离开 30 分钟”触发，但不无限扩张

`reflect/autonomous.py` 每 1800 秒给 Agent 一个自主任务 prompt。真正约束写在 `autonomous_operation_sop.md`：

1. 有 TODO 只取一条。
2. 无 TODO 先规划，下次执行。
3. ≤30 回合。
4. 低副作用可自主，高风险写报告待审。
5. 收尾必须写报告、完成任务、更新 TODO。

设计精髓：

> 自主不是连续狂跑，而是小批次、可审查、可中断、可沉淀。

对 OPC 的启发：

AI CEO 自运营应该是 agenda batch，不是无限 loop。

---

## 8. Plan / Subagent 精髓：复杂任务流程资产化

参考代码：

1. <https://github.com/lsdefine/GenericAgent/blob/main/memory/plan_sop.md>
2. <https://github.com/lsdefine/GenericAgent/blob/main/memory/subagent.md>

### 8.1 Plan Mode 不是代码功能，是 SOP 驱动的执行模式

`plan_sop.md` 定义了完整长任务流程：

1. 创建计划目录。
2. 探索态。
3. 写 plan.md。
4. 用户确认。
5. 按 `[ ]` 项逐步执行。
6. 强制验证 subagent。
7. 失败修复循环。

代码层只有少量支持：

1. `enter_plan_mode()`
2. `max_turns = 100`
3. 每 5 轮提示读 plan。
4. `no_tool` 拦截未验证就声称完成。

设计精髓：

> 复杂行为不一定要写成复杂代码，可以写成强 SOP + 小钩子。

对 OPC 的启发：

我们的复杂部门工作流可以先资产化为 workflow/SOP，再逐步固化为强类型 DAG。不要一开始就把所有复杂流程硬编码。

### 8.2 Subagent 是文件 IO 协议，不是分布式平台

`subagent.md` 定义：

1. `temp/{task_name}/input.txt`
2. `output.txt`
3. `reply.txt`
4. `_stop`
5. `_keyinfo`
6. `_intervene`

设计精髓：

1. 子 Agent 独立上下文。
2. 主 Agent 可监察和纠偏。
3. 共享文件系统降低通信复杂度。
4. Map-reduce 只用于同构独立任务，不滥用。

对 OPC 的启发：

我们的多部门/多 Agent 协作也应该避免过度复杂：

1. 子任务要有独立上下文和明确产物。
2. 主控只收摘要和证据。
3. 不要让所有 Agent 共享同一个巨型上下文。

---

## 9. Skill 精髓：技能是可检索资产，不是核心扩展点

参考代码：

1. <https://github.com/lsdefine/GenericAgent/blob/main/memory/skill_search/SKILL.md>
2. <https://github.com/lsdefine/GenericAgent/blob/main/memory/skill_search/skill_search/engine.py>

GenericAgent 的 skill search 有几个重要字段：

1. `one_line_summary`
2. `category`
3. `tags`
4. `autonomous_safe`
5. `blast_radius`
6. `requires_credentials`
7. `data_exposure`
8. `effect_scope`
9. `estimated_tokens`

设计精髓：

> Skill 不只是“会做什么”，还要描述是否适合自主执行、风险半径、凭证要求、数据暴露和 token 成本。

对 OPC 的启发：

我们的 workflow / skill metadata 需要补齐运行治理字段：

1. autonomous safety。
2. blast radius。
3. required permissions。
4. expected token budget。
5. evidence requirement。
6. approval requirement。

否则 skill 越多，系统越危险。

---

## 10. 设计精髓总表

| 精髓 | 代码体现 | 为什么有效 | OPC 应如何吸收 |
|---|---|---|---|
| Seed Kernel | `agent_loop.py` 只做 loop/dispatch | 核心稳定、AI 可读 | 抽出 AI CEO Kernel，不塞业务细节 |
| Protocol as Contract | `<summary>`、`<tool_use>`、turn callback | 模型行为可被运行时纠偏 | 给 CEO/部门任务建立 RunCapsule 协议 |
| Working Memory | `_get_anchor_prompt()` 每轮注入 | 长任务不丢上下文 | 增加 WorkingCheckpoint |
| Action-Verified Memory | `memory_management_sop.md` | 防止记忆污染 | Knowledge 写入必须有 evidence |
| Minimal Pointer | L1 insight 只做索引 | 降低 token 噪声 | Knowledge / workflow 先索引，命中再展开 |
| SOP Growth | `memory/*.md` + scripts | 能力增长不膨胀核心 | Workflow/Skill/SOP 作为 Growth Layer |
| Scheduler as Trigger | `scheduler.py` 返回 prompt | 调度不侵入业务 | Scheduler 只做触发/预算/幂等 |
| Bounded Autonomy | max_turns、cooldown、ask_user、reports | 防失控 | Budget / Circuit Breaker / Approval |
| Raw Archive | L4 session archive | 保留历史但不污染上下文 | Run archive 和 active memory 分层 |
| Tool Scarcity | 9 个高杠杆工具 | 新任务可探索 | 少量 capability + 多资产 |

---

## 11. 它的不足和不能照搬之处

### 11.1 权限安全不足

`code_run` 和文件工具给了很大权限。对个人本地 Agent 可接受，对 OPC 平台不能直接照搬。

我们需要：

1. 权限分级。
2. workspace sandbox。
3. 高风险操作审批。
4. tool script dry-run。
5. 审计日志。

### 11.2 文件型状态不适合复杂平台

GenericAgent 用大量本地文件做状态和结果。简单、AI 友好，但在我们的系统中会遇到：

1. 查询弱。
2. 并发弱。
3. UI 同步弱。
4. 审计和过滤弱。

我们应该保留“文件镜像可读”，但主存储仍应是 SQLite / API contract。

### 11.3 记忆质量靠 prompt 纪律

它用 SOP 强约束记忆，但没有强类型 memory promotion pipeline。长期运行后仍可能污染。

我们需要把记忆晋升做成代码合同：

1. candidate。
2. evidence。
3. category。
4. volatility。
5. conflict detection。
6. approval / publish。

### 11.4 Scheduler 简单，不适合组织级调度

GenericAgent 的 scheduler 适合个人任务，不适合我们的 CEO / Department / Provider / Approval / Notification 体系。

我们应学习它的：

1. 端口锁。
2. 冷却。
3. 延迟窗口。
4. 报告路径。
5. 触发与执行分离。

不要照搬文件轮询作为主架构。

---

## 12. 对 OPC 的落地建议

### 12.1 新增 `Company Kernel` 边界

建议建立一个明确的内核边界：

```text
src/lib/company-kernel/
  loop.ts
  signal.ts
  agenda.ts
  dispatch.ts
  run-capsule.ts
  memory-promotion.ts
  crystallizer.ts
  budget.ts
```

职责：

1. 不关心 UI。
2. 不关心具体 provider 实现。
3. 不关心具体日报业务。
4. 只处理信号、任务、证据、记忆、结晶、预算。

### 12.2 先做 RunCapsule

这是最应该从 GenericAgent 学到手的机制。

OPC 需要：

```ts
interface RunCapsule {
  runId: string;
  goal: string;
  physicalSummary: string[];
  verifiedFacts: string[];
  keyConstraints: string[];
  blockers: string[];
  artifacts: EvidenceRef[];
  reusableSteps: string[];
  nextAction?: string;
}
```

它对应 GenericAgent 的：

1. `<summary>`
2. `history_info`
3. `key_info`
4. `related_sop`
5. L4 archive

### 12.3 改造 Memory / Knowledge

当前我们的 KnowledgeAsset 已有 category/status/confidence/source，但还不够。

需要补：

1. evidence refs。
2. volatility。
3. promotion level。
4. conflict group。
5. usage source。
6. last verified at。

核心规则：

```text
未经 run/artifact/user feedback/API result 验证，不进入长期记忆。
```

### 12.4 改造 Evolution Proposal 为 Crystallizer

当前 proposal 生成仍偏模板化。应改成：

```text
RunCapsule.reusableSteps
+ successful artifacts
+ repeated prompt clusters
+ prior failures
=> SOP / Workflow / Skill / Script proposal
```

proposal 内容必须包含：

1. 来源 run。
2. 复用场景。
3. 真实执行步骤。
4. 证据。
5. 风险半径。
6. token / 时间收益预估。

### 12.5 Scheduler 接入 Budget

Scheduler 不能只看时间，还要看：

1. department budget。
2. concurrent runs。
3. cooldown。
4. failure circuit breaker。
5. high-risk approval gate。

GenericAgent 的 cooldown/report path 机制应该升级成我们的：

```text
Scheduled Trigger
-> Budget Check
-> RunCapsule created
-> Dispatch
-> Evidence / Report
-> Memory Promotion
```

### 12.6 UI 上少讲概念，多展示状态

GenericAgent 的能力大多藏在协议和资产里，不靠 UI 解释。

我们 CEO Office 也应该这样：

1. 展示 agenda。
2. 展示运行中 capsule。
3. 展示新增能力。
4. 展示被拦截风险。
5. 展示待审批 proposal。

不要在用户界面堆“这是配置中心、这是能力中心”的说明性文案。

---

## 13. 最重要的学习原则

### 13.1 不要学表面的小代码量

GenericAgent 小，不代表我们要把所有代码砍到 4000 行。

真正要学的是：

1. 核心代码小。
2. 资产层可增长。
3. 记忆有治理。
4. 自主有边界。
5. 上下文密度优先。

### 13.2 不要把所有流程做成 TypeScript 业务逻辑

很多流程可以先成为：

1. SOP。
2. Workflow。
3. Skill。
4. Tool script。
5. Policy document。

只有当它稳定、高频、需要强约束时，再固化为代码。

### 13.3 不要让 AI 自增长直接等于自改代码

GenericAgent 的自增长主要发生在 memory/SOP/skill/script，而不是频繁改核心源码。

OPC 也应该如此：

```text
优先增长资产
其次增长工具脚本
最后才提出核心代码改造 proposal
```

核心代码自改必须走测试、审批、回滚。

---

## 14. 后续建议

建议下一阶段不是继续泛化讨论，而是按代码落地顺序推进：

1. **Kernel Boundary Audit**：梳理现有 CEO / Scheduler / Knowledge / Evolution 的边界。
2. **RunCapsule v1**：把 GenericAgent 的 working memory 思想落到我们 run 生命周期。
3. **Memory Promotion v1**：把 `No Execution, No Memory` 变成代码规则。
4. **Crystallizer v1**：让 evolution proposal 从真实 run path 生成。
5. **Budget / Circuit Breaker**：让自运营先可控，再扩大。

最终目标：

```text
小内核负责循环和治理
资产层负责能力增长
记忆层负责经验晋升
预算层负责防失控
审批层负责高风险发布
UI 只展示经营状态和关键动作
```

这才是 GenericAgent 真正值得我们学到手的设计精髓。
