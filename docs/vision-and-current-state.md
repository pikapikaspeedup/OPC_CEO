# 我的现状与愿景

> 一份写给自己的清单：我现在站在哪里、我要去哪里、为什么我相信这条路、以及我不会做的事。
> 整理自 `docs/` 下的产品演进、OPC 设计、长期路线图、迁移计划等核心文档。

---

## Part 1：现状——我已经走到哪里

### 1.1 我在做的这件事是什么

我在做 Antigravity。它最初是一个让 Antigravity IDE "走出桌面"的 CLI Gateway，但走到今天，它已经不是一个工具了——它是我对一种新工作方式的下注：

> 让一个人，凭借一支由 AI 部门组成的虚拟公司，长期、稳定、可治理地运营多个真实项目。

OPC（One Person Company）不仅是产品形态，也是我自己的工作方式。我把自己当作 CEO，把代码、文档、自动化任务、定时巡检都视为某个"AI 部门"应当承担的职责。这件事的最终形态是一面镜子：**当我能让 Antigravity 替我开一家公司时，它就成立了。**

### 1.2 我已经攻下的高地

按照产品演进文档的 Phase 划分，已经稳定落地或可生产运行的能力如下。

**Phase 1：Antigravity Gateway CLI（已完成）。** 通过 `ps` + `lsof` 自动发现 Language Server 实例、gRPC-Web Connect 编解码桥接、REST API + WebSocket 实时流、Web UI 远程访问。我已经不再被困在 IDE 里。

**Phase 2：Multi-Agent Workflow（已完成）。** 4 阶段 Pipeline（产品定义 → 架构设计 → 自治开发 → 审查交付）、Group Runtime 编排器（支持 review-loop、delivery-single-pass、legacy-single）、Author–Reviewer 对抗审查循环、Scope Governor 写入范围审计、Work Package 结构化产物传递、Supervisor 监督看护（3 min 无进度检测）。从"AI 帮我写代码"升级为"AI 按工程化交付"。

**Phase 3：OPC 架构（已完成）。** Orchestrator + Pipeline + Controller 的三层解耦：Orchestrator 负责项目级编排与跨阶段协调；Pipeline 提供模板系统和数据契约校验；Controller 承担 stage runtime、supervisor loop、watch + merger。同时落地了项目容器（DAG 跨 stage 状态）、Pipeline 模板（JSON 声明式 + 可视化编辑）、Knowledge Items + Artifacts、多端接入（微信、Obsidian 插件、MCP Server）、中英双语 276 条 i18n 消息、CEO Office 模式雏形、定时调度器。

**Phase 4：开放 Provider 体系（进行中，已在生产）。** `TaskExecutor` 接口 + 4 级解析优先级把所有 AI 交互收到统一抽象层。已上线 `antigravity`（gRPC → Language Server）、`codex`（MCP → Codex CLI）、`claude-code`（CLI → stream-json）、`claude-api`（自研内存级 ClaudeEngine 直连 Anthropic API）四条 Provider 路径，预留 `openai-api`、`custom`。其中 ClaudeEngine 是关键自研突破——8 层架构、215 条测试覆盖、零外部 SDK 依赖（原生 fetch 实现 SSE）、进程内直接调用、完整 JSON-RPC MCP 客户端、流式 API + 自动重试。

**M1–M8 ClaudeEngine 迁移和 Agent Pipeline 接入已经完成**，当前在做 Post-Migration Roadmap 中的 Phase A（Provider 选择器、API Key 管理、Quick Task Provider 联动）。

### 1.3 我已经积累的资产

技术资产：稳定的 Bridge 层（discovery / gateway / grpc）、稳定的 Group Runtime、稳定的 Review Engine、Scope Governor、Resource Policy、Checkpoint / Journal、`.agents/assets/templates` 模板体系。这些是接下来一切上层建筑的承重墙。

概念资产：OPC 三层架构、CEO Layer / Department Layer / Execution Layer 的语言、Skill = Workflow + metadata 的封装方式、四种执行场景（Ad-hoc / Coordinated / Strategic / Reactive）、SimCity 三层缩放交互范式、CompanyContext 作为 AI CEO 的"眼睛"。这是一套被 18 轮正反辩论沉淀过的设计语言，比代码更难复制。

文档资产：`docs/` 下从产品演进、长期路线图、OPC 设计、各 Provider 迁移、SQLite 存储、调度器机制到 CDP 反向工程、masfactory 集成对比……几十份带日期的设计稿和复盘。这是项目的"组织记忆"。

### 1.4 我看清楚的差距

诚实地写下来——这些是我目前真正的痛点，也是接下来的发力点。

**第一，执行底座没有完全收口。** `group-runtime.ts` 仍然知道太多 transport 细节，`TaskExecutor` 还更像一次性任务调用而不是会话/执行 backend，`Run` / `Conversation` / `ExecutorHandle` 之间还没完全解耦，新接第三方执行后端时系统会隐式假设 watch / cancel / stream 能力一致。在执行抽象之上做更多 provider，只会让耦合固化。

**第二，治理还停在通知层。** Approval、Quota、Gate、Intervene 目前更像消息中心，而不是真正的运行时控制层。CEO 的批准/拒绝还不能可靠地驱动 run/project 状态迁移；超额、越权、缺审批的场景也还做不到事前阻断。

**第三，Department 还不是一等经营单元。** 现在的 Workspace 更像"一个目录 + 一堆手工文件"，缺少标准的 `.department/` 资产协议。Rules、Skills、Memory、Scheduler、Quota 的 owner 关系不清，部门之间无法做到稳定可比、可初始化、可替换。

**第四，记忆没做硬。** 现有 Journal 是事件流，但没有提炼、检索、引用的能力。部门"每次重新开始"，CEO 看不到"组织在学习"。这是后续 Scheduler 和自主演进都要依赖的输入。

**第五，Scheduler 只是 cron 触发器。** 还不是"经营节奏系统"——没有日报、周报、巡检、复盘的固定节拍，也无法把例外项自动升级为 CEO 决策。

**第六，自主演进缺位。** 系统还不能从重复问题中提炼改进建议、生成流程优化提案、走 CEO 审批后由受控任务执行。这是最后一块拼图，但它必须依赖前五块都已坐稳。

**第七，可观测性弱。** Token 消耗、费用追踪、Provider 对比、流式文本展示、审计日志增强都还在 Post-Migration Roadmap 的 Phase C 待办里。

---

## Part 2：愿景——我要走到哪里

### 2.1 北极星

只有一个：

> **让一个由 CEO、部门、员工、规则、记忆、技能、计划和例行节奏组成的 AI 组织，能够围绕真实项目长期运转。**

这一句话决定了所有取舍。我不在"又一个 IDE Coding Agent"赛道上，那条赛道里有 Cursor、Windsurf、Claude Code，再多一个不会改变格局。我在的赛道是把 AI 协作从"工具调用"推进到"组织运营"。

### 2.2 现实公司 → Antigravity 对象映射

我希望任何一个见过真实公司运转的人，都能在 Antigravity 里找到对应的概念抓手：

| 现实公司对象 | Antigravity 对应对象 |
|:--|:--|
| 公司 CEO | CEO Office / CEO Agent |
| 部门 | Workspace + Department Config |
| 员工 | Workflow / Role / Stage Executor |
| 制度 | Template / Rules / Approval Policy |
| 知识沉淀 | Department Memory / Org Memory |
| 例会与汇报 | Scheduler / Digest / Approval / Intervention |
| 项目推进 | Project / Run / Stage Runtime |

这不是隐喻，而是工程契约——每一行右边的对象都对应到具体的代码模块、状态机和数据结构。

### 2.3 终局画面：当一切建成后

画一张五年后的图，让自己有方向感。

清晨我打开 Antigravity，看到的是公司大楼俯瞰图——产研部、调研部、运营部三个区块，颜色显示各自的健康度和忙碌度。事件流里浮上来一条 ⚠️：产研部"支付模块"超时两天，附带一个"暂置 / 介入"按钮。我点暂置，因为我知道 Codex 那边在排队。下方一条 🔔：调研部完成了昨晚我让它做的"竞品周报 v17"，附带 evidence 钻取链接。我点开扫一眼，关掉。

输入框里我打一句"下个季度 OKR 调一下，把'付费转化率'从 12% 推到 18%"。AI CEO 自动判断这是战略决策，把任务派给运营部 + 产研部，生成一条新的 Coordinated 项目；运营部读取自己的部门记忆——上一次拉付费转化时哪些动作有效、哪些失败了——自动加进 Playbook。我什么都没干，只是讲了一句话。

每周一早上，我看到一份自动生成的 CEO 周报：上周完成 23 项任务、4 项被卡、2 项需要我决策、3 项部门主动提议的流程优化（已经走完审批可以直接接入）、组织学习速率指标 +6%。这一切都不是手写的，都是从 WorkLog → DailyDigest → 例行复盘的链路里自动提炼出来的。

公司在跑，我在掌舵。

### 2.4 交互哲学：SimCity 而非 RPG

这是最重要的不变量之一。

| 维度 | RPG 式（避免） | SimCity 式（追求） |
|:--|:--|:--|
| 操控粒度 | 指挥每个任务 | 规划区域，城市自己跑 |
| 界面 | 任务板 + 队列 + 多个对话 | 一张俯瞰图 + 事件浮窗 |
| 管理方式 | 微观管理 | 宏观治理 |
| CEO 角色 | 将军 | 市长 |

CEO 控制面板有且只有"三层缩放"架构：第一层俯瞰（部门区块 + 事件流 + 一句话输入框），第二层放大（点击部门看其内部项目和进度），第三层细节（点击项目进入 Pipeline / Stage）。CEO 日常只看第一层，系统通过事件流主动浮上来需要决策的事项；只在确实需要拍板时才下钻。

AI CEO 的角色定位与之配套——**它是路由器，不是执行者**。它不懂怎么做事，只知道事该交给哪个部门：扫描部门 Skills、考虑部门负载、推荐执行模式与 Playbook、生成派发事件。具体怎么做，由部门内部按既有 Workflow / Pipeline 自治完成。

### 2.5 三大关键能力闭环（按优先级）

愿景往下一层落到能力，最关键的三件事按严格顺序排列。

**第一优先级：Department Memory v1。** Run 完成后可提炼经验、部门执行前可召回相关经验、CEO 可查看部门近期新增知识和失败教训。没有记忆，部门永远只是"每次重新开始"，CEO 的经营台只能看状态不能看学习，后续 Scheduler 和自主演进都没有输入材料。

**第二优先级：Scheduler v1。** 定时读取项目和部门状态、自动生成日报/周报任务、触发需要 CEO 决策或审批的例外项、结果写回 memory 和审计账本。让 Scheduler 从 cron 触发器升级为"经营节奏系统"。

**第三优先级：Self-Evolution v0。** 自动识别重复问题、生成改进建议或流程优化提案、提交给 CEO 审批、审批通过后由受控任务执行——而不是直接自改系统。这一块只能放最后做，且早期只允许"提建议"，不允许"自改"。

如果顺序反过来，我得到的不会是一家智能公司，而是"没有记忆支撑的定时噪音 + 没有治理约束的伪自治"。

---

## Part 3：抵达路径——我怎么从今天走到那里

### 3.1 六个长期演进节点（顺序不可颠倒）

**节点 1：执行底座收口（0–6 周）。** 把 Stage Runtime 建立在统一的事件化 backend 契约上：定义 `ExecutionBackend` / `AgentSessionBackend`、统一事件流（started / step / artifact / blocked / completed / failed / cancelled）、引入 capability matrix（streaming / appendMessage / cancel / watch / tool-calls / artifacts / interactive）、让 Stage Runtime 基于能力降级而非 provider 名字写分支。完成标准是：同一个 stage 能在 antigravity 与 codex 路径上通过统一 lifecycle 落盘，runtime 主逻辑不再依赖任何 transport 细节。

**节点 2：治理内核闭环（4–10 周）。** 把 approval 从"消息通知"升级为"可执行决策"，打通 quota/policy 对 dispatch 和 resume 的硬约束，统一 pause/resume/reject/retry/intervene 的状态机，建立治理审计账本，让 scheduler 带上治理上下文。完成标准是：CEO 的批准/拒绝能真实改变 run/project 流程，超额越权能事前阻断而非事后提醒，每次干预都能追溯理由、执行人、前后状态。

**节点 3：CEO 经营台（2–4 个月）。** 把 CEO Office 从"聊天 + 配置 + 若干分散面板"升级为"单屏经营台"，统一一句话派活、待决策队列、审批队列、运行态监控、快速干预、风险提醒、近况汇总。完成标准是：CEO 不再需要在 Dashboard / Projects / Chat / Approval 之间频繁跳转，一个项目从立项到干预到复盘可以在一个视角里闭环。

**节点 4：部门操作系统（3–6 个月）。** 让每个 Department 拥有 Identity / Rules / Skills / Memory / Provider Policy / Routine / Roster 七项最小经营契约，统一 `.department/` 资产协议，建立部门可视化经营面（投入、产出、积压、风险、知识沉淀）。完成标准是：新建一个部门时系统知道怎样初始化它的规章、技能、记忆和节奏；切换 provider、加技能、调规则、调配额会真实影响部门后续行为。

**节点 5：OKR 与记忆闭环（4–8 个月）。** 把 OKR 从静态配置升级为可计算的经营目标，让项目/阶段产出映射到 KR 进展，让 memory 从 Markdown 归档升级为可提炼、可检索、可引用的组织知识，建立日报/周报/月报与复盘机制，让 scheduler 围绕目标触发 routine。完成标准是：CEO 看到的是目标偏差而不只是项目状态，部门能基于近期失败/成功自动更新记忆与建议。

**节点 6：自治运营与开放执行生态（6–18 个月）。** 建立经营例外机制（默认自治，异常升级），跨部门协同与资源竞争治理，在统一 ExecutionBackend 契约和治理层之下接入多个叶子执行后端，允许外部 agent/backend 成为 Department 的执行供应商，建立公司级 dashboard（产能、风险、预算、目标偏差、组织学习速率）。完成标准是：CEO 不必亲自盯每个项目也能掌握经营异常，多 executor 不破坏 Project/Run/Stage 真相源。

### 3.2 接下来两周——只做三件事

长期路线很长，但下一步不该发散。指导方法论是：**先打通一条最小但完整的主链路，再围绕这条主链路做抽象。**

最小主链路定义为：CEO 或标准 dispatch 创建项目 → 单 stage 被成功派发 → run 稳定进入 running / completed / failed → artifact / review / project 状态正确落盘 → CEO 在同一链路里看到结果并做一次干预或复盘。只要这条链路还有断点，就不该急着做全局抽象。

具体三件事：

**任务 A：执行后端契约蓝图。** 输出 `ExecutionBackend` 接口、`ExecutionEvent` 类型集合、capability matrix、Run / Conversation / Handle 边界、Stage Runtime 如何从 transport 细节脱身的设计稿。

**任务 B：治理状态机蓝图。** 输出 approval / quota / gate / intervene / resume 状态迁移、必须落审计账本的事件清单、必须经过 CEO 受控 action service 的写操作清单的设计稿。

**任务 C：CEO 经营台信息架构。** 输出 CEO 单屏区块清单、一级优先级数据、直接可点的操作、需要审批或二次确认的动作的产品蓝图。

### 3.3 配套的可用性补丁（Phase A）

并行处理已经在做的 Post-Migration Roadmap Phase A：扩展 Provider 选择器、Agent Run API 增加 provider 参数、API Key 管理 UI、Quick Task 增加 Provider 选择。让 `claude-api` 立即可用是当前用户感知层面的最高 ROI。

---

## Part 4：边界与原则——我不会做的事

### 4.1 四条战略边界

第一，**不直接把 Antigravity 建立在 craft 等外部 shell 之上。** 借鉴可以，建立不行——把命运交给别人的抽象，意味着永远做配角。

第二，**不优先做一个更像 IDE 的通用 agent shell。** 那是另一条赛道，那条路上我不可能赢，也不该去拼。

第三，**不在执行内核统一前继续横向扩 provider 和炫 UI。** 在没有 capability 降级的情况下强推多 provider 一致行为，只会让耦合固化、未来抽象代价更高。

第四，**不让 CEO 的写操作绕开治理与审计主链路。** CEO 不能直接调底层 API，每个写操作都必须经过 action service、落入审计账本——否则治理就只是装饰。

### 4.2 五条贯穿式设计原则

**渐进式开放**：每个 Phase 扩一个维度，不破坏已有功能。**接口抽象**：`TaskExecutor` / `AgentBackend` 隔离实现细节。**配置驱动**：4 级优先级解析，组织/部门/Layer/Scene 灵活覆盖。**测试覆盖**：每个新模块 TDD 先行，回归零破坏。**开放标准**：MCP / JSON-RPC / SSE 优先，避免私有协议。

### 4.3 当前阶段不做的事

不优先把大量精力投入更多 provider 适配；不优先迁移到底层 shell 或基于 craft 重做；不优先做更重的前端包装、人格包装或场景包装；不做 MCP 编辑器（给 Open 用的，Antigravity 不适配）；不做多租户隔离（当前单用户够用）；不做自定义集成市场（过大）。

这些事情都会让人感觉"功能越来越多"，但不会真正提高 Antigravity 的核心完成度。

---

## Part 5：一句话承诺给自己

> 我不在做"另一个 coding agent"。我在做的是一个可以让一个人开一家公司的系统。  
> 现在我已经把执行抽象、Pipeline、OPC 三层架构、Provider 抽象层和自研 ClaudeEngine 都做出来了——地基已经能承重。  
> 接下来我要按"执行底座 → 治理内核 → CEO 经营台 → 部门操作系统 → OKR 与记忆 → 自治与生态"这个顺序把上层一层一层盖起来，**顺序不能反**。  
> 当这一切建成时，Antigravity 不再是工具，而是我的虚拟公司。

---

*版本：v1.0 · 基于 docs/ 现有材料整理 · 与产品演进文档、OPC 设计文档、长期路线图保持一致。*
