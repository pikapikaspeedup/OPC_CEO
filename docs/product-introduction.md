# Antigravity 产品介绍：初心与目标

> 本文基于 `docs/design/product-evolution.md`、`docs/internals/opc-one-person-company.md`、`docs/design/antigravity-long-term-evolution-roadmap.md` 等核心设计文档汇编而成，用于回答一个根本问题：**Antigravity 究竟是什么、为什么存在、要走到哪里去？**

---

## 一、一句话定位

Antigravity 不是又一个会聊天、会调工具的 IDE Coding Agent，而是一个**可运营的 AI 软件组织系统**——一个由 CEO、部门、员工、规则、记忆、技能、计划和例行节奏共同构成的 AI 组织，能够围绕真实项目长期运转。

这是项目唯一的"北极星"，也是判断所有功能取舍的最终标尺。

---

## 二、产品初心：从"工具"到"组织"的三次跃迁

Antigravity 的初心并不是一开始就如此宏大，它是在持续演进中被不断收敛、不断逼近的。回看其历程，可以清晰看到三次心智跃迁。

**第一次跃迁——让 Antigravity 走出桌面 IDE。**
最早的 Phase 1（2024 Q3）只是一个 CLI Gateway：通过 `ps` + `lsof` 自动发现本地的 Language Server 实例，把 gRPC 桥接成 REST API + WebSocket，让 Antigravity 能脱离 IDE 在 Web 端被远程调用。这一阶段的关键词是**可达性**，目标是把一个原本被困在桌面应用里的能力拿出来。

**第二次跃迁——从"对话式开发"到"工程化交付"。**
Phase 2（2024 Q4 – 2025 Q1）引入了 4 阶段 Pipeline（产品定义 → 架构设计 → 自治开发 → 审查交付）、Group Runtime 编排器、Author–Reviewer 对抗审查循环、Scope Governor 写入范围审计、Supervisor 监督看护。一个孤立的"AI 帮我写代码"被升级为带流水线、带审查、带兜底的**多 Agent 协作工程**。关键词从可达性变成**可信交付**。

**第三次跃迁——从"多 Agent 工作流"到"虚拟公司操作系统"（OPC）。**
当 Multi-Agent Workflow 在 Phase 3（2025 Q2 – Q4）演进成 OPC（Orchestrator + Pipeline + Controller）三层架构后，团队意识到：真正难的不是"多个 Agent 一起干活"，而是让这些 Agent 像一家公司一样有部门、有制度、有记忆、有节奏地长期运转。这是 Antigravity 的真正初心被定型的时刻——它要成为**一人公司（One Person Company, OPC）**：一个人类 CEO + 一支 AI 团队，自治运营多种业务。

文档里有一组贯穿全篇的对应关系，可以最直接地说明这件事：

| 现实公司对象 | Antigravity 对应对象 |
|:--|:--|
| 公司 CEO | CEO Office / CEO Agent |
| 部门 | Workspace + Department Config |
| 员工 | Workflow / Role / Stage Executor |
| 制度 | Template / Rules / Approval Policy |
| 知识沉淀 | Department Memory / Org Memory |
| 例会与汇报 | Scheduler / Digest / Approval / Intervention |
| 项目推进 | Project / Run / Stage Runtime |

**初心一句话**：把"开一家公司"这件事，浓缩进一个一个人就能驾驭的软件系统。

---

## 三、核心范式：SimCity 而非 RPG

OPC 设计文档里有一个非常关键的隐喻——CEO 控制面板应当像 SimCity，而不是 RPG。这句话定义了产品的交互哲学：

| 维度 | RPG 式（避免） | SimCity 式（追求） |
|:--|:--|:--|
| 操控粒度 | 指挥每个任务 | 规划区域，城市自己跑 |
| 界面 | 任务板 + 队列 + 多个对话 | 一张俯瞰图 + 事件浮窗 |
| 管理方式 | 微观管理 | 宏观治理 |
| CEO 角色 | 将军 | 市长 |

由此衍生出"三层缩放"作为唯一的 CEO 工作面架构：第一层俯瞰（部门区块 + 事件流 + 一句话输入框），第二层放大（点击部门看其内部项目和进度），第三层细节（点击项目进入 Pipeline / Stage）。CEO 日常只看第一层，系统通过事件流主动浮上来需要决策的事项；只在确实需要拍板时才下钻。

这也直接决定了 AI CEO 的角色定位：**它是路由器，不是执行者**。CEO 不懂怎么做事，只知道事该交给哪个部门——扫描部门 Skills、考虑部门负载、推荐执行模式与 Playbook、生成派发事件。具体怎么做，由部门内部按既有 Workflow / Pipeline 自治完成。

---

## 四、产品目标：六大长期演进节点

围绕"AI 软件组织系统"这一北极星，路线图给出了未来 6–18 个月的 6 个主线节点，顺序严格不可颠倒：

**节点 1：执行底座收口（0–6 周）。** 把 Stage Runtime 建立在统一的事件化 backend 契约（`ExecutionBackend` / `AgentSessionBackend`）上，让单个 stage 可以在不同 executor 上运行，Run 状态不再绑死任何一种 transport 细节。这是地基。

**节点 2：治理内核闭环（4–10 周）。** 让审批、配额、规则、人工 gate、异常干预、计划任务真正能驱动运行时状态迁移，而不是停留在通知或日志层。CEO 的批准、拒绝、调额都要能改变 run/project 流程，并落入审计账本。这是安全护城河。

**节点 3：CEO 经营台（2–4 个月）。** 把 CEO Office 从"聊天 + 配置 + 若干分散面板"升级为单屏经营台：一句话派活、待决策队列、审批队列、运行态监控、快速干预、风险提醒、近况汇总，统一在一个工作面里完成。

**节点 4：部门操作系统（3–6 个月）。** 让 Department 从一个 workspace 升级为拥有身份、规章、技能、记忆、预算和节奏的一等经营单元，统一 `.department/` 资产协议，给每个部门可视化的经营面（投入、产出、积压、风险、知识沉淀）。

**节点 5：OKR 与记忆闭环（4–8 个月）。** 让组织从"会执行"升级为"会学习、会复盘、会追目标"。OKR 从静态配置变为可计算的经营目标；项目产出可映射 KR 进展；memory 从 Markdown 归档升级为可提炼、可检索、可引用的组织知识；scheduler 围绕目标触发例行节奏，而不只是 cron 触发器。

**节点 6：自治运营与开放执行生态（6–18 个月）。** CEO 从"亲自盯执行"升级为"围绕目标做异常管理"，建立经营例外机制（默认自治、异常升级）、跨部门协同与资源竞争治理；同时在统一的 ExecutionBackend 契约和治理层之下，开放外部 agent / backend 成为部门的执行供应商。

文档同时反复强调：**顺序不能反**。如果先做自治、先做炫酷 UI、先扩 provider，看起来像公司，实际上只会是多个对话框、多个页面和多个 provider 的拼接物。

---

## 五、与之配套的执行架构现状

虽然北极星指向"虚拟公司"，但底层执行能力是这一愿景能否站稳的前提。当前 Phase 4（2026 Q1–Q2）已经初步落地了开放 Provider 体系：

统一的 `TaskExecutor` 接口配合 4 级解析优先级，所有 AI 交互都通过抽象层路由。已实现的 Provider 包括 `antigravity`（gRPC → Language Server）、`codex`（MCP → Codex CLI）、`claude-code`（CLI → stream-json）、`claude-api`（自研内存级 ClaudeEngine 直连 Anthropic API），并预留了 `openai-api`、`custom` 等扩展位。

其中自研的 ClaudeEngine 是关键突破——8 层架构、215 条测试覆盖，无外部 SDK 依赖（用原生 fetch 实现 SSE）、进程内直接调用、完整 JSON-RPC MCP 客户端、流式 API + 自动重试。它让 Antigravity 不再被任何单一 Provider 锁定。

未来 Phase 5+ 将在此基础上做智能 Provider 路由、自动降级、混合执行、费用优化等"运营级"能力，对应的也正是节点 6 中"开放执行生态"的位置。

---

## 六、四条战略边界（不变量）

为了让产品不被发散的需求稀释，文档反复划出了四条不能跨越的边界：

第一，不直接把 Antigravity 建立在 craft 等外部 shell 之上；第二，不优先做一个更像 IDE 的通用 agent shell；第三，不在执行内核统一之前继续横向扩 provider 和炫 UI；第四，不让 CEO 的写操作绕开治理与审计主链路。

与之对应的，是五条贯穿所有 Phase 的设计原则：渐进式开放（每个 Phase 扩一个维度，不破坏已有功能）、接口抽象（`TaskExecutor` / `AgentBackend` 隔离实现细节）、配置驱动（4 级优先级解析，组织/部门/Layer/Scene 灵活覆盖）、测试覆盖（每个新模块 TDD 先行）、开放标准（MCP / JSON-RPC / SSE 优先，避免私有协议）。

---

## 七、一句话总结

如果只能用一句话回答"Antigravity 的初心和目标是什么"，那就是：

> **它要让一个人，凭借一支由 AI 部门组成的虚拟公司，长期、稳定、可治理地运营多个真实项目；为此先把执行底座和治理中枢做硬，再把 CEO、部门、记忆、OKR 和例行机制做成一个真正能长期运营的 AI 组织系统。**

它不与"另一个 coding agent"竞争，而是在一个完全不同的赛道上——把 AI 协作从"工具调用"推进到"组织运营"。
