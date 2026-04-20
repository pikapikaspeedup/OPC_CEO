# Multi-Agent 系统全景对比分析

**日期**: 2026-04-19  
**分析范围**: 10 份源码级深度研究文档，覆盖 9 个独立系统  
**分析目的**: 为 Antigravity 多 Agent 系统演进提供横向参照系

---

## 一、系统概览与定位分谱

| 系统 | 语言 | 定位 | 架构范式 | 核心代码量 |
|:-----|:-----|:-----|:---------|:----------|
| **Antigravity (AG)** | TypeScript | IDE 增强型编排平台 | 显式 DAG + 中央治理 | ~8000+ 行编排层 |
| **Claude Code** | TypeScript | AI 编程助手 | LLM-Driven Tool Delegation + Teams | ~3800 行核心 |
| **Copilot SDK** | TypeScript | IDE 集成框架 | Parent-Subagent 委托 | SDK 壳层（核心闭源） |
| **Golutra** | Rust + Vue 3 | 终端编排 IDE | Terminal-Centric Orchestration | ~25,000 行全栈 |
| **Hermes Agent** | Python | 通用 Agent 框架 | LLM-Driven Delegation | ~1,200 行核心 |
| **LangChain/LangGraph** | Python | Agent 编排框架 | StateGraph 状态图驱动 | 框架级 |
| **OpenAI Agents** | Python | Agent SDK | Handoff + Agent-as-Tool | SDK 级 |
| **Pi-Mono** | TypeScript | Coding Agent | Extension-Driven 进程委托 | 扩展级 |
| **Rowboat (Web)** | TypeScript | 多 Agent Dashboard | Handoff Workflow | ~2,400 行 |
| **Rowboat (Desktop)** | TypeScript | 桌面 Agent | Agent-as-Tool Subflow | ~1,400 行 |

### 1.1 三大范式阵营

```
┌────────────────────────────────────────────────────────────────┐
│                    Multi-Agent 架构范式谱系                      │
├────────────────┬───────────────────┬───────────────────────────┤
│ 显式编排派      │ LLM 自主决策派     │ 终端/进程编排派            │
│ (Deterministic) │ (LLM-Driven)      │ (Process-Centric)         │
├────────────────┼───────────────────┼───────────────────────────┤
│ AG (DAG+治理)  │ Hermes (委托)      │ Golutra (PTY 编排)        │
│ LangGraph (图) │ Claude Code (Tool) │ Pi-Mono (OS 进程沙箱)     │
│                │ OpenAI Agents (HO) │                           │
│                │ Copilot SDK (委托) │                           │
│                │ Rowboat (Handoff)  │                           │
└────────────────┴───────────────────┴───────────────────────────┘
```

> **核心洞察**：显式编排派（AG、LangGraph）用更高的前期定义成本换取了执行确定性；LLM 自主决策派用简洁性换取灵活性但承担了不可控风险；终端编排派完全不介入 LLM 推理，是纯粹的"赛博监工"。

---

## 二、并行与串行能力矩阵

| 系统 | Agent 级并行 | Tool 级并行 | 并行机制 | 并发控制 | 串行保证 |
|:-----|:------------|:-----------|:---------|:---------|:---------|
| **AG** | ✅ Fan-Out/Join | ❌ | 声明式 maxConcurrency | 静态切片 + 队列 | Review Loop + DAG 拓扑 |
| **Claude Code** | ✅ Background Agent | ✅ | run_in_background + Fork | 无显式上限 | 同步 await 阻塞 |
| **Copilot SDK** | ❌ | ❌ | 无显式并行 | Queueing FIFO | 任务队列串行 |
| **Golutra** | ✅ PTY 进程级 | ✅ 语义线程 | 独立 PTY 天然并行 | dispatchChains 串行化 | Promise Chain + dispatch_queue |
| **Hermes** | ✅ Batch 模式 | ✅ ThreadPool(8) | ThreadPoolExecutor | max_concurrent=3 | clarify/路径重叠降级 |
| **LangGraph** | ✅ Fan-out + Send | ✅ Multi-Action | 拓扑分发 + Map-Reduce | Reducer 合并状态 | 图步进串行 |
| **OpenAI Agents** | ❌ 宏观串行 | ✅ asyncio.gather | Agent-as-Tool 并发调用 | 无显式限制 | Handoff 互斥单线 |
| **Pi-Mono** | ✅ Parallel(4) | ✅ | OS spawn + Promise 池 | MAX_CONCURRENCY=4 | Chain 模式同步阻塞 |
| **Rowboat Web** | ❌ | SDK 内部 | 无 | turnLoop=25 | Pipeline 按序推进 |
| **Rowboat Desktop** | ❌ | ❌ 逐一处理 | 无 | 无 | while(true) 单步 |

### 关键发现

1. **真正支持 Agent 级并行的只有 6 家**：AG、Claude Code、Golutra、Hermes、Pi-Mono、LangGraph
2. **Copilot SDK 和 Rowboat 完全无并行**，这在大型任务分解中是重大瓶颈
3. **AG 的并行是声明式的**（Template JSON 定义），Hermes/Claude Code 的并行是运行时动态的
4. **Golutra 的并行最独特**：不是 LLM 层面的并行，而是操作系统进程级天然并行

---

## 三、约束体系深度对比

### 3.1 强约束覆盖度

| 约束维度 | AG | CC | Copilot | Golutra | Hermes | LangGraph | OAI | Pi-Mono | Rowboat |
|:---------|:--:|:--:|:-------:|:-------:|:------:|:---------:|:---:|:-------:|:-------:|
| **工具白/黑名单** | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌/✅ |
| **文件系统隔离** | ❌ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ | ✅ | ❌ |
| **数据契约校验** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **资源配额** | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| **递归/深度限制** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅/❌ |
| **实时工具拦截** | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅桌面 |
| **执行超时** | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **强约束占比** | ~65% | ~60% | ~65% | ~65% | ~60% | ~70% | ~55% | ~55% | 55-70% |

### 3.2 约束哲学三种流派

- **"治理优先"派**（AG、LangGraph）：编译期校验 + 审查引擎 + Quota + Journal + Checkpoint，层层设防
- **"平衡派"**（Claude Code、Copilot SDK）：工具隔离 + YOLO/Nudge 审查 + 权限门控
- **"信任 LLM"派**（Hermes、Pi-Mono）：最低限度黑名单 + Budget，其余全交给模型

> **AG 在约束纵深上是行业最深的**，拥有编译期 Contract → 运行时 Quota → 审查引擎 → Scope Audit → Journal → Checkpoint → Intervention 七层。但缺少实时工具拦截和文件隔离。

---

## 四、检视与监控体系对比

| 系统 | 检视层数 | 心跳 | AI Supervisor | 结构化审查 | Checkpoint | HITL | 审计日志 |
|:-----|:--------|:-----|:-------------|:----------|:-----------|:-----|:---------|
| **AG** | **7 层** | ✅ 30s | ✅ 3min | ✅ ReviewEngine | ✅ 10个 | ✅ 6种 | ✅ JSONL |
| **Claude Code** | 4 层 | ❌ | ❌ | ✅ YOLO | ❌ | ❌ | ❌ |
| **Copilot SDK** | 4 层 | ❌ | ❌ | ❌ | ❌ | ✅ 4维 | ✅ |
| **Golutra** | **7 层** | ✅ | ❌ | ❌ | ❌ | ✅ DND | ✅ |
| **Hermes** | 6 层 | ✅ 30s | ❌ | ❌ | ❌ | ❌ | ✅ |
| **LangGraph** | 5 层 | ❌ | ❌ | ✅ Reviewer | ✅ | ✅ | ✅ |
| **OpenAI Agents** | 4 层 | ❌ | ❌ | ✅ Guardrails | ✅ RunState | ✅ | ✅ |
| **Pi-Mono** | 3 层 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Rowboat Web** | 4 层 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Rowboat Desktop** | 6 层 | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

> AG 和 Golutra 并列检视层数最多（7 层），但 AG 的检视更偏"语义级"（AI Supervisor 判断是否在做有效工作），Golutra 更偏"信号级"（PTY 输出活动检测）。

---

## 五、防偷懒机制对比

| 系统 | 防偷懒策略 | 强度 | 机制 |
|:-----|:---------|:-----|:-----|
| **AG** | Review Loop + AI Supervisor | ★★★★★ | Author↔Reviewer 循环 + 规则引擎覆盖 |
| **Claude Code** | YOLO Classifier + Summary | ★★★★ | 独立模型审查 + 后台进度摘要 |
| **Copilot SDK** | **Nudge 催促** | ★★★★★ | 未调 task_complete 时自动催促 |
| **Golutra** | Working 状态监控 | ★★☆ | 只知道"有输出"vs"没输出" |
| **Hermes** | Parent LLM 自行判断 | ★★☆ | 父模型偷懒则全线崩溃 |
| **LangGraph** | 状态标记 + Checker Node | ★★★★ | remaining_tasks 未清空拒绝 FINISH |
| **OpenAI Agents** | output_type + Guardrails | ★★★★ | 拒绝自然语言草率结案 |
| **Pi-Mono** | **零防偷懒** | ★☆☆ | exit(0) 即成功 |
| **Rowboat** | controlType 强制回退 | ★★★ | 内部 Agent 必须交还控制权 |

**防偷懒三流派**：
1. **工程硬防**（AG ReviewEngine、Copilot Nudge、LangGraph Checker）：代码强制校验
2. **AI 对抗审查**（Claude Code YOLO、AG Supervisor）：另一个 LLM 审查
3. **甩锅给父模型**（Hermes、Pi-Mono）：完全依赖 parent LLM，最薄弱

---

## 六、工程效果 vs AI 能力贡献度

| 系统 | 工程% | AI% | 定位 |
|:-----|:------|:----|:-----|
| **Golutra** | **70-75%** | 25-30% | 纯工程系统，不调用任何 LLM API |
| **AG** | **70%** | 30% | DAG+Contract+Quota+Journal = 重工程治理 |
| **LangGraph** | **65%** | 35% | 图论约束 + Schema + Checkpoint |
| **Claude Code** | **55%** | 45% | Fork+Worktree+YOLO 工程贡献大 |
| **Copilot SDK** | **55%** | 45% | 隔离+流控+Nudge 工程成熟 |
| **Rowboat Desktop** | 45% | **55%** | 权限系统好但调度靠 LLM |
| **Rowboat Web** | 40% | **60%** | Agent 切换决策 80% 靠 LLM |
| **OpenAI Agents** | 40% | **60%** | 路由全托付 Function Calling |
| **Pi-Mono** | 40% | **60%** | 沙箱好但语义校验零 |
| **Hermes** | **20%** | **80%** | ~1200 行代码，极简极信任 LLM |

> 工程占比越高（AG、LangGraph），可预测性越强但灵活性降低。Hermes 是极端信任 LLM 的代表。

---

## 七、Agent 间通信能力

所有系统的**共同短板**：

| 系统 | 通信机制 | 实时性 |
|:-----|:---------|:------|
| **AG** | 文件产物传递（单向异步） | ❌ |
| **Claude Code** | outputFile 轮询 + Summary | 低 |
| **Golutra** | Chat Channel @mention | 中 |
| **Hermes** | 仅通过 Parent 中转 | ❌ |
| **LangGraph** | **共享 State 字典** | **✅** |
| **OpenAI Agents** | Handoff 上下文继承 | 中 |
| **Pi-Mono** | 无 | ❌ |

> **只有 LangGraph 通过共享 State 实现了真正的 Agent 间状态共享。**

---

## 八、各系统"杀手锏"

| 系统 | 独门绝技 |
|:-----|:---------|
| **AG** | 7 层治理纵深 + AI 流程自生成 + Checkpoint 恢复 |
| **Claude Code** | Git Worktree 物理隔离 + YOLO 安全分类器 |
| **Copilot SDK** | Nudge 催促 + 4 维 HITL（权限/求助/UI/纠偏） |
| **Golutra** | 零侵入 CLI 编排 + 工业级 PTY 引擎 |
| **Hermes** | 极简 ~1200 行 + Skill 自学习闭环 |
| **LangGraph** | Time-travel 状态回溯 + LangSmith 可观测 |
| **OpenAI Agents** | Handoff 心智模型 + RunState 序列化恢复 |
| **Pi-Mono** | OS 进程级物理隔离 + TUI 流式更新 |
| **Rowboat** | Markdown 即 Agent + 双系统适配 |

---

## 九、对 Antigravity 的战略启示

### 9.1 AG 的差距维度

| 差距维度 | 领先者 | AG 现状 | 差距 |
|:---------|:-------|:--------|:-----|
| Token 效率 | Claude Code (Fork 缓存) | 每 Role 全新子对话 ~6.9× | 严重 |
| 文件隔离 | Claude Code (worktree) | 共享工作区 + 事后审计 | 中等 |
| 实时工具拦截 | Claude Code (PreToolUse) | 无代码层工具白名单 | 中等 |
| 防偷懒催促 | Copilot SDK (Nudge) | 依赖 Review Loop | 轻微 |
| Agent 间通信 | LangGraph (共享 State) | 仅文件产物传递 | 中等 |

### 9.2 建议优先级

**P0 — 快速见效**：共享对话全面推广、Nudge 防偷懒、工具白名单

**P1 — 中期投资**：Git Worktree 并行隔离、实时 WriteScope 拦截、Pull-based 弹性调度

**P2 — 长期壁垒**：Agent 间共享状态通道、Skill 自学习、长驻 Actor 模式

---

## 十、总结

**没有最好的 Multi-Agent 架构，只有最适合场景的选择。**

- **AG**：用更高 Token 成本换更强治理 → 适合**可重复工程交付**
- **Claude Code**：用复杂度换安全隔离 → 适合**破坏性重构**
- **Copilot SDK**：用闭源换 HITL 体验 → 适合**IDE 深度集成**
- **Golutra**：用零侵入换灵活性 → 适合**异构 CLI 编排**
- **Hermes**：用防线薄换极简 → 适合**探索型单任务**
- **LangGraph**：用学习门槛换可控性 → 适合**复杂有状态工作流**
- **OpenAI Agents**：用模型依赖换优雅 → 适合**快速原型**
- **Pi-Mono**：用零防偷懒换纯净隔离 → 适合**隔离型编码**
- **Rowboat**：用双系统冗余换覆盖面 → 适合**对话式 Agent 产品**

> **AG 的核心护城河——7 层治理纵深——在行业中无出其右，这是其他系统无法后补的架构级优势。**
