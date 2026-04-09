## 任务：把 Plan B 收成代码级实施计划

**状态**: ✅ 已完成
**日期**: 2026-04-10

### 概要
在用户明确“先考虑 Plan B 的落地”之后，继续从设计文档回到真实代码接缝，把 Task B 不再停留在概念边界，而是直接拆成代码级实施计划。重点梳理了 `group-runtime.ts` evaluate 分支中残留的 Native transport 泄漏点，以及这些能力应如何落到 backend / transport adapter 扩展层。

### 本次结论
1. **Task B 当前最重的真实泄漏点集中在 evaluate 分支**
  - `grpc.getTrajectorySteps`
  - `grpc.updateConversationAnnotations`
  - `discoverLanguageServers`
  - `getApiKey`
  - `getOwnerConnection`
2. **最稳的落点不是继续污染通用 `AgentBackend` 主接口，而是新增 optional backend extension**
  - diagnostics extension
  - session metadata writer extension
3. **最稳的实施顺序是 4 个阶段**
  - Phase 1: 抽 recent steps 读取
  - Phase 2: 抽 annotation 写回
  - Phase 3: 收 resolver 下沉
  - Phase 4: 补异常矩阵
4. **Task B 当前不应该顺手扩到执行器接入、MemoryHooks 真注入、Codex append/streaming 等后续能力**

### 本次新增文档
1. `docs/design/task-b-implementation-plan-2026-04-10.md`

### 说明
1. 本次为实施计划与本地文档沉淀，没有修改运行时代码。
2. 文档已经把 Task B 从“结构级下沉”进一步拆成可直接开工的文件级改造顺序和验收标准。

## 任务：澄清“代码合入 Claude Code 后是否还会形成绑定”

**状态**: ✅ 已完成
**日期**: 2026-04-10

### 概要
在补齐代码级集成复用矩阵后，用户继续追问：如果最终选择 Claude Code，而且代码都直接合进 Antigravity 仓库里，是否还会被它绑定。针对这个问题，又补了一轮更精确的架构澄清，核心是把“外部依赖解除”和“运行时合同 ownership”拆开。

### 本次结论
1. **代码合入只解决外部依赖问题，不自动解决架构绑定问题**
2. **如果 Antigravity 开始围着 Claude Code 的 session、tool permission、workspace、event shape 去组织自身 runtime，仍然会形成源码级绑定**
3. **只有在 Claude Code 只是内部执行内核，而 execution contract 仍由 Antigravity 自己持有时，才算真正解除绑定**
4. **判断标准很简单**
  - 如果未来替掉 Claude Code，`Project / Run / Stage`、artifact、intervention、scheduler 这些平台语义不需要重写，那就没有被它绑死

### 同步更新的文档
1. `docs/design/embedded-executor-code-integration-matrix.md`

## 任务：补齐 Claude Code 与 craft 的代码级集成复用矩阵

**状态**: ✅ 已完成
**日期**: 2026-04-10

### 概要
围绕用户最新澄清的真实目标，继续把讨论从“产品对产品对接”切到“直接把 Claude Code 或 craft 的代码集成到 Antigravity 项目里”。本轮补了一份并排复用矩阵，明确回答：各层大概能复用多少、多少必须自己开发、哪些模块值得搬、哪些层不建议直接吃进来。

### 本次结论
1. **Claude Code 更像高复用执行内核**
  - provider adapters、query loop、tool orchestration 复用价值更高
  - 更适合先做默认强执行底座
2. **craft 更像高复用 execution substrate 参考实现**
  - backend / event 归一化、permissions、pre-tool middleware、session-tools 更值得借
  - 不适合直接把 session/control shell 与产品壳整体搬进来
3. **不管选谁，平台层核心都必须自研并持有**
  - Project / Run / Stage 真相源
  - artifact / result contract
  - intervention semantics
  - scheduler / CEO / approval / governance 接线
4. **如果先选一个默认底座，短期优先 Claude Code；如果看长期 runtime 标准化，方向更接近 craft-style substrate**

### 本次新增文档
1. `docs/design/embedded-executor-code-integration-matrix.md`

### 说明
1. 本次为研究结论与本地文档沉淀，没有修改运行时代码。
2. 文档已明确区分“代码复用比例”和“平台必须自己开发的部分”，便于后续直接进入默认底座选型与 PoC 设计。

## 任务：澄清“选一个外部执行器”和“把合同交给外部执行器”的区别

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
用户进一步追问：既然 Claude Code 或 craft 本身就是开源、成熟、且支持很多 API，为什么不能直接选其中一个作为新的执行底座。针对这个问题，继续补了一轮更直接的架构澄清，核心是把“默认执行底座”和“execution contract 所有者”这两个概念拆开。

### 本次结论
1. **完全可以选一个外部系统作为默认执行底座**
  - 比如优先选择 Claude Code，或者未来优先选择 craft-style runtime
2. **真正不该交出去的是 execution contract 的定义权**
  - session 模型
  - append / attach / cancel / terminal semantics
  - artifact / result / changedFiles 回传合同
  - routing policy
3. **开源、大厂、支持很多 API，不等于不会形成新的绑定**
  - 绑定的根因不是源码闭不闭，而是平台是否被迫去适配外部产品的运行时合同
4. **因此更稳的路线是“选一个默认 substrate，但合同仍由 Antigravity Platform 自己拥有”**

### 同步更新的文档
1. `docs/design/native-executor-replacement-feasibility.md`

## 任务：按“完全平替 Native Executor”口径重判外部执行器路线

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
在上一轮“开放式 API 与通用执行器策略”研究之后，用户进一步把标准收紧为：不是只要多一个可选 executor，而是要判断“是否存在可以真正平替当前 Antigravity Native Executor 的方案”，而且 Template、定时任务、Prompt、干预链路这些现有产品能力都要继续成立。基于这个更严格的口径，补了一份专门的判定文档。

### 本次结论
1. **当前没有现成的 raw drop-in replacement**
  - 无论是 Claude Code 还是 craft，都不是今天就能无痛直接平替 Native Executor 的现成成品
2. **Template 和 Scheduler 不是核心 blocker**
  - 它们本质属于 control plane 语义
  - 外部执行器不需要自己原生理解模板或定时任务，只需要承接被平台逐 stage 派发后的 execution contract
3. **真正的 blocker 在 execution contract**
  - session lifecycle
  - append / attach / cancel / evaluate 这类 intervention contract
  - artifact / result / changedFiles / terminal semantics
4. **真正能解除绑定的方案不是“换一个产品壳”，而是“平台自有 Standard Execution Runtime Contract”**
  - Native Executor、Claude Code、Direct Open API backend、未来 craft-style runtime 都应该只是这个合同后面的 adapter
5. **Claude Code 更适合第一代可落地 adapter，craft 更适合长期 execution shell 方向参考**

### 本次新增文档
1. `docs/design/native-executor-replacement-feasibility.md`

### 说明
1. 本次为研究结论与本地文档沉淀，没有修改运行时代码。
2. 这份新文档专门回答“能否完全平替 Native Executor”这个更严格的问题，避免继续把“可选 executor”与“解除平台绑定”混成一件事。

## 任务：明确开放式 API 下的通用执行器路线

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
围绕“未来如果要使用开放式 API，Craft 或 Claude Code 能否成为受 Antigravity Platform 完整调度的通用执行器，以及写代码任务是否应该默认派给 Claude Code”这个问题，补了一份新的策略文档，把执行器选择、任务路由、Task B 关系与阶段性建议收成一个统一判断。

### 本次结论
1. **Craft 和 Claude Code 都可以被调度系统控制**
  - 前提是它们被放在 execution plane
  - 不替代 `Project / Run / Stage` 这层 control plane 真相源
2. **Claude Code 更适合短期先接成强 coding executor**
  - 更适合单 stage、prompt-first、真实 workspace 内写代码的任务
  - 不适合直接当长期通用 execution substrate
3. **craft 更适合作为长期 execution shell 方向**
  - 更值得借 backend / session / event / capability 的分层思路
  - 不适合直接作为平台基座
4. **写代码任务不应无差别全部派给 Claude Code**
  - 更稳的路线是 Native Executor / Claude Code / Direct Open API backend 三路并存，由 Platform 按任务类型做路由

### 本次新增文档
1. `docs/design/open-api-universal-executor-strategy.md`

### 说明
1. 本次为研究结论与本地文档沉淀，没有修改运行时代码。
2. 文档已把“什么叫完整调度”“Claude Code 与 craft 分别应该放在哪一层”“写代码任务的合理路由策略”三个问题收口到一页，便于后续直接决定 PoC 顺序。

## 任务：按控制层 / 执行层新概念重写 craft 可行性研究文档

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
根据最新概念对齐，重写了 `antigravity-vs-craft-feasibility-study.md`，去掉了旧版里大量“整个平台对整个平台”的泛比较与冗长计划，改为聚焦一个更准确的问题：craft 在控制层 / 执行层新框架下，是否适合作为 Antigravity 的下层 execution shell。

### 本次重写后的核心结论
1. **不建议把 Antigravity 平台直接建立在 craft 之上**
2. **建议保留 Antigravity 作为控制层 / 平台主系统**
3. **craft 可以作为下层 execution shell 的参考对象，甚至未来可作为一个可选执行器接入**
4. **真正值得复用的是 backend / session / event / capability 抽象，不是整个产品壳**

### 本次更新的文档
1. `docs/internals/antigravity-vs-craft-feasibility-study.md`
  - 已按新的控制层 / 执行层框架重写并精简

## 任务：对齐 Antigravity 的控制层与执行层概念

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
针对“Antigravity 到底是决策层还是执行层”这个概念混乱点，补了一份专门的对齐文档，不再继续把平台、原生执行器、以及历史上的 CLI/IDE 能力混用成一个词。

### 本次对齐出的关键结论
1. **Antigravity 应被定义成整个平台，而不是单独某一层**
2. **控制层负责**
  - Project / Run / Stage
  - review-loop / governance / scheduler / CEO / approval / artifact 真相源
3. **执行层负责**
  - 在 workspace 内实际执行任务
  - provider / backend / session / transport / 权限控制
4. **Google Antigravity language server 只是当前默认原生执行器**
  - 它属于执行层成员
  - 不应再等同成整个平台
5. **Claude Code / craft / 第三方 API backend 都应被理解成执行层候选，而不是控制层替代品**

### 本次新增文档
1. `docs/design/control-plane-vs-execution-plane-alignment.md`

### 说明
1. 本次为概念对齐与本地文档沉淀，没有修改运行时代码。
2. 这份文档的目的，是给后续第三方执行器接入、Task B、Workspace 语义和 OPC 路线一个统一术语底座。

## 任务：研究顶层调用 Craft / Claude Code 作为第三方执行器的可行性

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
围绕“如果要支持第三方 API，能否不重做顶层，而是让 Antigravity 顶层去调用 Craft 或 Claude Code 这种 workspace-based agent shell”这个问题，补充了一轮更贴近工程落地的研究。重点不再是“谁替代谁”，而是“谁更适合做下层受控执行器”。

### 本次研究的关键结论
1. **这比‘整体迁基座’更合理**
  - Antigravity 顶层保留 `Project / Run / Stage / governance`
  - Craft 或 Claude Code 只承担下层 workspace executor
2. **Claude Code 当前这份逆向仓库确实支持第三方 provider**
  - 已明确支持 OpenAI、Gemini、Grok 等兼容层
  - 但更现实的调用面是 CLI / server，而不是成熟 SDK
3. **craft 更像长期通用 execution shell**
  - backend / session / event 壳更干净
  - 更适合作为多 provider runtime 参考或未来下层执行壳
4. **最稳路线不是二选一，而是分阶段**
  - 短期：先接 Claude Code 形成可用 executor
  - 长期：再朝 craft-style execution shell 收口

### 同步更新的文档
1. `docs/internals/antigravity-vs-craft-feasibility-study.md`
  - 新增了“顶层调用下层执行器支持第三方 API”的专门章节

## 任务：重新 review AgentBackend 事件架构完成态

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
根据用户要求，对当前 AgentBackend / AgentSession / session-consumer 事件架构迁移重新做了一轮 review，不再只问“有没有迁到新主链”，而是进一步审视：当前边界到底是否已经稳定、哪些借鉴 craft 的地方是对的、以及什么才算真正的高质量完成态。

### 产出
1. 新增 review 文档：`docs/design/agent-backend-event-rereview-2026-04-09.md`

### 本次 review 的关键结论
1. **主链迁移方向正确，且不是文档先行**
  - Prompt、legacy-single、multi-role isolated 确实已经进入 event session 主链
2. **当前仍是 NEEDS_REVISION，不是因为功能没迁完，而是因为合同和边界还没完全收口**
3. **3 个主要问题需要优先修**
  - attach / cancel 恢复态仍依赖瞬时 provider 解析，而不是持久化 provenance
  - cancel 合同在类型、consumer、文档之间没有完全写死
  - review-loop author 完成判定存在文件落盘时序竞争
4. **对 craft 的借鉴总体方向是对的**
  - 借的是 backend / session / event 分层
  - 不应该继续借过头，把 Antigravity 扭成 session-first 产品壳
5. **真正好的完成态仍差 6 条硬条件**
  - 包括 transport 泄漏清理、provider provenance 持久化、cancel 合同写死、异常矩阵齐全、完成判定稳定化、以及至少一个新 backend 的 seam 验证

### 说明
1. 本轮为 review 与本地文档沉淀，没有修改运行时代码。
2. 本轮结论明确建议：下一步优先修合同与异常矩阵，而不是继续扩大抽象面。

## 任务：补充 Claude Code 作为被调度执行器的定位说明

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
根据用户澄清，继续完善 Provider / Task B 独立文档，明确区分了两个容易混淆的问题：

1. Claude Code 能不能替代 Antigravity 的 `Project / Run`
2. Claude Code 能不能作为一个被当前调度系统控制的底层执行器

### 本次补充的关键结论
1. **Claude Code 可以被当前调度系统控制**
  - 前提是把它包装成新的 `AgentBackend` 或 provider leaf executor
  - 调度系统继续负责 `Project / Run / Stage / scheduler / approval`
2. **Claude Code 不会天然继承 Google Antigravity language server 的 transport 能力**
  - 它可以共享逻辑 Workspace
  - 但不天然具备 trajectory、owner routing、annotation 等 IDE transport 能力
3. **第三方兼容取决于接入的 Claude Code 内核版本**
  - 若内核只支持 Claude / Anthropic 规格 API，则只能提供 Claude-family executor
  - 若使用当前逆向仓库里的多 provider 版本，则有机会同时承担第三方兼容执行器角色

### 同步更新的文档
1. `docs/design/provider-integration-and-task-b-plan.md`
  - 新增了“Claude Code 来实际编辑代码，能否被调度系统控制”的专门章节

## 任务：补充“文件夹边界”与 Project/Run 真相源的差异说明

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
继续完善 Provider / Task B 独立文档，专门补上一个高频误区：为什么即使 Claude Code / Corecode 这类执行器同样是“按文件夹工作”，也不能直接替代 Antigravity 的 `Project / Run`。

### 本次补充的关键结论
1. **文件夹 / workspace 只定义空间边界**
  - 回答的是代码在哪、cwd 在哪、工具能改哪棵目录树
2. **Project / Run 定义的是时间和治理边界**
  - 回答的是任务容器、阶段推进、上游输入、reviewOutcome、恢复、审批、调度回流这些系统语义
3. **Claude Code / Corecode 可替代的是执行器层**
  - 也就是 provider leaf executor 或 AgentBackend session
  - 不能天然替代 `project-registry`、`run-registry`、`pipelineState` 这些真相源对象

### 同步更新的文档
1. `docs/design/provider-integration-and-task-b-plan.md`
  - 新增了“为什么文件夹单位不能替代 Project / Run”的专门章节

## 任务：补充 Workspace 分层与 Claude Code 执行器定位说明

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
继续完善刚新增的 Provider / Task B 独立文档，补上两个此前容易反复混淆的问题：

1. 当不再依赖 Antigravity IDE 能力，而改用 OpenAI / Claude API / 第三方 Key 时，Workspace 理念应如何继续成立
2. Claude Code 逆向源码是否可以直接当作通用执行器使用

### 本次补充的关键结论
1. **Workspace 需要拆成两层理解**
  - 逻辑 Workspace：仓库根、cwd、artifact、Project / Run / Stage、rules / memory / policy
  - 执行能力 Workspace：language server、trajectory、owner routing、annotation、IDE file edit 等 Antigravity 专有能力
2. **第三方 Key 依然可以支撑 Workspace 理念**
  - 只是它们支撑的是“逻辑 Workspace”
  - 不一定具备 Antigravity Provider 那种 IDE-enhanced 能力包
3. **Claude Code 可以当叶子执行器，但不该当系统基座**
  - 适合接在 Provider / AgentBackend 层
  - 不适合替代 Project / Run / Stage / governance / scheduler 这些上层系统语义

### 同步更新的文档
1. `docs/design/provider-integration-and-task-b-plan.md`
  - 新增了 Workspace 双层语义
  - 新增了 Claude Code 作为执行器的定位和接入顺序

## 任务：补独立文档说明 Provider 接入预期与 Task B 完成态

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
基于用户反馈，单独新增了一份文档，用来说明“事件框架迁移到底意味着什么”、“未来 OpenAI 等独立后端应该接在哪一层”，以及“Task B 做完以后系统应该处于什么状态”。不再把这些总览问题继续塞在 event gap checklist 里。

### 本次新增文档
1. `docs/design/provider-integration-and-task-b-plan.md`

### 文档包含的核心结论
1. 任务 A 已经解决“功能入口统一到 Event session 主链”
2. Task B 的本体是“把残留在 orchestration 层里的 RPC / gRPC / owner / language-server 解析继续压到底层”
3. 未来 OpenAI / Claude API / 自定义后端应该接在 Provider / AgentBackend 层，而不是直接接 `group-runtime.ts`
4. Task B 做完后的预期不是新增功能，而是让 `group-runtime` 只保留业务编排语义，不再理解 Antigravity transport 细节

## 任务：整理 Plan B / Task B 的实际实施边界

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
重新整理了 AgentBackend 迁移后的 Plan B，明确这一步不再是“继续迁功能入口”，而是 `任务 B：transport 下沉与 group-runtime 净化`。已把现有设计文档中的概念表述收成更可执行的实施分组，便于后续直接按组推进。

### 本次整理出的结论
1. **任务 A 已完成**
  - shared / nudge / restart-role / evaluate / cancel fallback 这些功能级旧入口已经全部迁完
2. **Plan B 就是 Task B**
  - 本质是把残留在 `group-runtime.ts` 里的 RPC / gRPC / owner / language-server 解析继续压到底层 backend 或 transport adapter
3. **Task B 应拆成 4 组**
  - 会话诊断读取下沉：`grpc.getTrajectorySteps`
  - 会话元数据写回下沉：`grpc.updateConversationAnnotations`
  - owner / apiKey / language server 解析下沉：`getOwnerConnection()` / `getApiKey()` / `discoverLanguageServers()`
  - attached-session 异常矩阵补齐
4. **Task B 当前不该扩张到其它方向**
  - 不继续做新功能入口
  - 不先扩 Codex append / streaming text
  - 不把 MemoryHooks 真正接到 prompt 拼装

### 同步更新的文档
1. `docs/design/agent-backend-event-architecture-gap-checklist.md`
  - 新增了 Task B 的实际实施边界、实施分组、以及不应顺手扩张的范围

## 任务：重跑此前未成功的关键回归测试

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
针对此前一度不稳定、且直接关联 `prompt-builder` 决策提取与 AgentBackend 运行时迁移的关键测试组，重新执行了一次集中回归，确认当前代码在本地已经稳定通过，不再存在可复现的自动化失败。

### 本次验证范围
1. `src/lib/agents/prompt-builder.test.ts`
2. `src/lib/agents/group-runtime.test.ts`
3. `src/lib/agents/group-runtime.multi-role.test.ts`
4. `src/lib/backends/builtin-backends.test.ts`

### 验证证据
1. **关键回归测试重跑通过**
  - 执行：`npm test -- src/lib/agents/prompt-builder.test.ts src/lib/agents/group-runtime.test.ts src/lib/agents/group-runtime.multi-role.test.ts src/lib/backends/builtin-backends.test.ts`
  - 结果：`4` 个测试文件通过，`54` 个测试全部通过，`0` 失败。

### 结论
1. `prompt-builder` 中的 review decision 提取逻辑当前测试通过。
2. `group-runtime` 的 intervention / cancel / attached session 路径当前测试通过。
3. multi-role 迁移路径与 backend attach/parity 路径当前测试通过。

## 任务：对前端仪表盘 UX 审计进行对立性评审 (Run: 609294b3 - Critic Round 1)

**状态**: 🟡 等待修订 (REVISE)
**日期**: 2026-04-09

### 概要
作为首席 UX 评论员，对 Run 609294b3 的审计报告进行了对抗性审查。独立验证了原生 `prompt()` 拦截、冗余 API 调用以及中英混杂的交互缺陷。指出了审计中遗漏的 `AuditLogWidget` 数据过时 Bug (Missing Poll Dependency) 以及路径输入路径摩擦问题。已要求 Review Author 针对 580px 侧边栏环境细化 Bento 布局方案。

### 本次完成的关键改动
1. **源码深度验证**: 走访 `src/components/ceo-dashboard.tsx` 和 `src/components/audit-log-widget.tsx`，证实了审计结论并发现组件间数据同步缺陷。
2. **对抗性评审**: 对 Bento 布局和 Activity Hook 提案提出了针对性质疑，要求解决侧边栏适配与响应式细节问题。
3. **输出评审决策**: 在 `/demolong/runs/609294b3-969e-499a-8a8b-e6a349f65e58/review/` 下生成了 `review-round-1.md` 和 `result-round-1.json`。

---

## 任务：简短评审前端仪表盘交互体验 (Run: 609294b3 - Review Author)

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
针对 Antigravity 仪表盘（CEO Dashboard）完成了简短的启发式评估（控制在300字以内）。识别了包括原生 `prompt()` 阻塞、冗余/静态审计流以及 "Zombie Localization"（中英混杂）在内的 3 个核心可用性问题。产出了针对性的改进建议（Contextual Popover、Bento 布局、共享 Activity Hook）。

### 本次完成的关键改动
1. **完成简短 UX 审计**: 深度分析了 `src/components/ceo-dashboard.tsx` 与 `src/components/audit-log-widget.tsx` 的交互性能与冗余度。
2. **生成评审报告**: 在 `/demolong/runs/609294b3-969e-499a-8a8b-e6a349f65e58/specs/` 下输出了 `audit-report.md`, `interaction-proposals.md`, `priority-matrix.md`。
3. **交付结果**: 完成了强制性的 `result.json`，标记任务圆满结束。

---

## 任务：对前端仪表盘 UX 审计进行对立性评审 (Run: 0980b7e4 - Critic Round 1)

**状态**: 🟡 等待修订 (REVISE)
**日期**: 2026-04-09

### 概要
作为首席 UX 评论员，对 Run 0980b7e4 的审计报告进行了对抗性审查。独立验证了原生 `prompt()` 拦截、审计日志数据静态化以及中英混杂的交互缺陷。额外指出了审计中遗漏的组件间冗余 API 调用问题，并要求 Review Author 针对 580px 窄侧边栏环境重新设计 Bento 布局提案。

### 本次完成的关键改动
1. **源码深度验证**: 走访 `src/components/ceo-dashboard.tsx` 和 `src/components/audit-log-widget.tsx`，证实了审计结论并发现数据同步架构缺陷。
2. **对抗性评审**: 对 Bento 布局和轮询提案提出了针对性质疑，要求解决侧边栏适配与冗余请求问题。
3. **输出评审决策**: 在 `/demolong/runs/0980b7e4-a906-4b8a-a393-f33b9652524e/review/` 下生成了 `review-round-1.md` 和 `result-round-1.json`。

---

## 任务：简短评审前端仪表盘交互体验 (Run: 0980b7e4)

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
针对 Antigravity 仪表盘（CEO Dashboard）完成了简短的启发式评估（控制在300字以内）。识别了包括原生 `prompt()` 阻塞、审计日志数据滞后以及垂直堆叠疲劳在内的 3 个核心可用性问题。产出了针对性的改进建议（组件化弹窗、审计流轮询、便当盒布局设计）。

### 本次完成的关键改动
1. **完成简短 UX 审计**: 深度分析了 `src/components/ceo-dashboard.tsx` 与 `src/components/audit-log-widget.tsx` 的交互性能。
2. **生成评审报告**: 在 `/demolong/runs/0980b7e4-a906-4b8a-a393-f33b9652524e/specs/` 下输出了 `audit-report.md`, `interaction-proposals.md`, `priority-matrix.md`。
3. **交付结果**: 完成了强制性的 `result.json`，标记任务圆满结束。

---

## 任务：对前端仪表盘 UX 审计进行对立性评审 (Run: 6c86f4f1 - Critic Round 1)


**状态**: 🟡 等待修订 (REVISE)
**日期**: 2026-04-09

### 概要
作为首席 UX 评论员，对 Run 6c86f4f1 的审计报告进行了对抗性审查. 独立验证了原生 `prompt()` 拦截和垂直堆叠疲劳问题，并指出了审计严重遗漏的 `AuditLogWidget` 数据过时 Bug（Missing Poll Dependency）以及 "Zombie Localization"（混合语言）问题.

### 本次完成的关键改动
1. **源码深度验证**: 走访 `src/components/ceo-dashboard.tsx` 和 `src/components/audit-log-widget.tsx`，发现了审计漏掉的组件内部数据同步缺陷.
2. **对抗性评审**: 对 Bento 布局提案提出了针对性质疑，由于组件高度差异巨大，要求细化布局策略以防视觉空洞.
3. **输出评审决策**: 在 `/demolong/runs/6c86f4f1-1496-4c68-b66c-edf0bdd2f879/review/` 下生成了 `review-round-1.md` 和 `result-round-1.json`.

---

## 任务：简短评审前端仪表盘交互体验 (Run: 6c86f4f1 - Review Author)

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
针对 Antigravity 仪表盘（CEO Dashboard）完成了简短的启发式评估（控制在300字以内）。识别了包括原生 `prompt()` 阻塞、垂直堆叠疲劳以及数据刷新跳变在内的 3 个核心可用性问题。产出了针对性的改进建议（自定义 Dialog、便当盒布局、Framer Motion 平滑过渡）。

### 本次完成的关键改动
1. **完成简短 UX 审计**: 深度分析了 `src/components/ceo-dashboard.tsx` 的交互性能。
2. **生成评审报告**: 在 `/demolong/runs/6c86f4f1-1496-4c68-b66c-edf0bdd2f879/specs/` 下输出了 `audit-report.md`, `interaction-proposals.md`, `priority-matrix.md`。
3. **交付结果**: 完成了强制性的 `result.json`，标记任务圆满结束。

---

## 任务：对前端仪表盘 UX 审计进行对立性评审 (Run: 246eb35a - Critic Round 1)


**状态**: 🟡 等待修订 (REVISE)
**日期**: 2026-04-09

### 概要
作为首席 UX 评论员，对 Run 246eb35a 的审计报告进行了对抗性审查。独立验证了原生 `prompt()` 拦截、垂直堆叠疲劳以及静默刷新等核心缺陷。指出了审计中遗漏的审计日志组件不更新（Stale Data）以及混合语言本地化（Zombie Localization）问题。已要求 Review Author 针对 580px 侧边栏宽度优化布局提案并细化变更反馈机制。

### 本次完成的关键改动
1. **源码深度验证**: 走访 `src/components/ceo-dashboard.tsx` 和 `src/components/audit-log-widget.tsx`，发现了审计漏掉的数据同步 Bug。
2. **对抗性评审**: 对 Bento 布局和 Framer Motion 提案提出了针对性质疑，要求适配高长宽比侧边栏场景。
3. **输出评审决策**: 在 `/demolong/runs/246eb35a-d07e-4f93-b6a4-e1234c4006fe/review/` 下生成了 `review-round-1.md` 和 `result-round-1.json`。

---

## 任务：对前端仪表盘 UX 审计进行对立性评审 (Run: 345bb0d5 - Critic Round 1)

**状态**: 🟡 等待修订 (REVISE)
**日期**: 2026-04-09

### 概要
作为首席 UX 评论员，对 Run 345bb0d5 的审计报告进行了对抗性审查。验证了 `window.prompt()` 和垂直堆叠布局的真实性，但指出审计提案在处理错误反馈、战略信号优先级（HUD 化）以及列表刷新动效方面深度不足。已要求 Review Author 进行修订。

### 本次完成的关键改动
1. **源码验证**: 实地走访 `src/components/ceo-dashboard.tsx`，证实了原生对话框和堆叠容器问题。
2. **深度评审**: 指出了对 CEO 视觉下钻与全局掌控平衡点的遗漏。
3. **输出评审报告**: 在 `/demolong/runs/345bb0d5-f819-41e0-a17c-5e633d65af55/review/` 下生成了 `review-round-1.md` 和 `result-round-1.json`。

---

## 任务：简短评审前端仪表盘交互体验 (Run: 345bb0d5 - Review Author)


**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
针对 Antigravity 仪表盘（CEO Dashboard）完成了简短的启发式评估（控制在300字以内）。识别了侵入式对话、纵向堆叠疲劳及刷新跳变 3 个核心可用性问题。产出了针对性的改进方案（UI Modal, Bento 布局, 状态平滑过渡）。

### 本次完成的关键改动
1. **完成简短 UX 审计**: 深度分析了 `src/components/ceo-dashboard.tsx` 的交互性能。
2. **生成评审报告**: 在 `/demolong/runs/345bb0d5-f819-41e0-a17c-5e633d65af55/specs/` 下输出了 `audit-report.md`, `interaction-proposals.md`, `priority-matrix.md`。
3. **交付结果**: 完成了强制性的 `result.json`，标记任务圆满结束。

---

## 任务：对前端仪表盘 UX 审计进行对立性评审 (Run: c32b6b4a - Critic Round 1)


**状态**: 🟡 等待修订 (REVISE)
**日期**: 2026-04-09

### 概要
作为首席 UX 评论员，对仪表盘审计报告进行了对抗性审查。验证了原生 `prompt()` 和布局堆叠问题，但指出审计提案在处理内容溢出、数据一致性以及反馈链路方面存在严重不足。已要求 Review Author 进行修订。

### 本次完成的关键改动
1. **源码验证**: 通过 `src/components/ceo-dashboard.tsx` 证实了审计中的关键发现。
2. **深度评审**: 识别了审计未覆盖的状态管理碎片化和路径输入摩擦问题。
3. **输出评审报告**: 生成了 `review-round-1.md` 和决策文件，决策为 `REVISE`。

---

## 任务：简短评审前端仪表盘交互体验 (Run: c32b6b4a)


**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
针对 Antigravity 仪表盘（CEO Dashboard）完成了简短的启发式评估。识别了包括信息滚动疲劳、原生 `prompt()` 越权交互以及状态刷新生硬在内的 3 个核心可用性问题。产出了针对性的改进建议（Bento 布局、模态框替换、动效增强）。

### 本次完成的关键改动
1. **完成 UX 审计**: 分析了 `src/app/page.tsx` 与 `src/components/ceo-dashboard.tsx`。
2. **提交评审报告**: 在 `/demolong/runs/c32b6b4a-a817-46f6-abf6-fbb42f7213e9/specs/` 下输出了 `audit-report.md`, `interaction-proposals.md`, `priority-matrix.md` 和 `result.json`。
3. **改进建议**: 提出了便当盒布局 (Bento Grid)、行内快速添加弹窗以及基于 Framer Motion 的轮询平滑过渡。

---

## 任务：简短评审前端仪表盘交互体验 (Brief UX Review)


**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
针对 Antigravity 前端仪表盘完成了简短的启发式评估（控制在300字以内），生成了3项核心优化建议（过渡加载、移动端适配、微动效状态反馈）。

### 本次完成的关键改动
1. **完成简短 UX 审计**: 在不修改代码的情况下分析了仪表盘 `page.tsx`。
2. **提交评审报告**: 在指定 run artifact 下输出了 `audit-report.md`, `interaction-proposals.md`, `priority-matrix.md` 和 `result.json`，产出符合流水线要求。

---

## 任务：评审前端仪表盘交互体验 (UX Review)

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
对 Antigravity 前端仪表盘（CEO Dashboard）进行了启发式评估，识别了可用性问题并提出了改进建议。

### 本次完成的关键改动
1. **完成 UX 审计**: 识别了包括原生 `prompt()` 拦截流、信息过载和视觉噪音在内的核心问题。
2. **提交评审报告**: 在 `/demolong/runs/a61b8557-b222-4ff7-842f-bfd18b79768d/` 下生成了 `audit-report.md`, `interaction-proposals.md`, `priority-matrix.md` 和 `result.json`。
3. **改进建议**: 提出了替换原生输入框、引入标签页导航以及优化状态指示器动画的方案。

---

## 任务：测试基础编码模板 (Basic Coding Template)


**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
在工作区根目录创建 `coding-test.md` 文件，验证基础编码模板的自动化执行能力。

### 本次完成的关键改动
1. **创建 `coding-test.md`**: 内容为 "Hello from coding-basic-template"。

---

## 任务：测试 Prompt Mode 执行

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
在工作区根目录创建 `hello.md` 文件，验证 Prompt Mode 执行能力。

### 本次完成的关键改动
1. **创建 `hello.md`**: 内容为 "Hello World from Prompt Mode"。

---

## 任务：把 PromptExecutor 接到 AgentBackend

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
开始执行第一条真实接入链路：让 Prompt Mode 不再直接依赖 `TaskExecutor + watcher + activePromptRuns`，而是改走新的 `AgentBackend -> AgentSession -> session-consumer -> run-registry` 链路。当前这条链已经落地并通过回归测试与生产构建验证。

### 本次完成的关键改动
1. **新增 `src/lib/backends/builtin-backends.ts`**：补齐第一批可运行的内建 backend 实现
  - `AntigravityAgentBackend`
  - `CodexAgentBackend`
  - `ensureBuiltInAgentBackends()`
2. **`prompt-executor.ts` 重构为 backend 驱动**
  - 保留 run 创建、artifact 目录、Prompt 组装、finalization 语义
  - 删除本地 `activePromptRuns` Map
  - 删除直接调用 `watchConversation()` 的逻辑
  - 改为：`getAgentBackend()` → `start()` → `registerAgentSession()` → `consumeAgentSession()`
3. **`cancelPromptRun()` 改走 session-registry**
  - 改为查询 `getAgentSession(runId)`
  - 通过 `markAgentSessionCancelRequested()` + `session.cancel()` 处理取消
  - 保留 Prompt Run 立即标记为 `cancelled` 的外部行为
4. **`backends/index.ts`**：新增内建 backend 导出，供 PromptExecutor 接入使用
5. **更新 `prompt-executor.test.ts`**
  - 兼容新的异步事件消费链路
  - 保留原有 4 条关键行为覆盖：codex 完成、antigravity watcher 完成、dispatch 失败、cancel 后忽略晚到 completion

### 当前效果
Prompt Mode 现在已经具备完整的新链路：
1. PromptExecutor 只负责 Prompt 语义和 artifact/finalization
2. Provider-specific 生命周期下沉到 AgentBackend / AgentSession
3. 事件消费统一走 session-consumer
4. 取消路径统一走 session-registry

### 验证证据
1. **相关护栏测试通过**
  - 执行：`npm test -- src/lib/agents/prompt-executor.test.ts src/lib/agents/group-runtime.test.ts src/lib/agents/run-registry.test.ts src/lib/agents/watch-conversation.test.ts src/lib/backends/registry.test.ts src/lib/backends/session-registry.test.ts src/lib/backends/session-consumer.test.ts`
  - 结果：`7` 个测试文件全部通过，`23` 个测试全部通过，`0` 失败。
2. **生产构建通过**
  - 执行：`npm run build`
  - 结果：Next.js 生产构建完成，PromptExecutor 接入后的整体项目编译通过。

## 任务：继续补 Phase 1 Session Consumer 骨架

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
在 `AgentBackend` 类型、backend 注册表和 session 注册表落地后，继续把统一事件消费层的第一版骨架补出来，先解决“如何按序消费 `AgentEvent`、如何在 local cancel 后忽略晚到 completion、如何在 terminal 后停止继续处理”这三件最核心的事。

### 本次完成的关键改动
1. **新增 `src/lib/backends/session-consumer.ts`**：提供 `consumeAgentSession()`
   - 支持 `started / live_state / completed / failed / cancelled` 五类事件回调
   - 在 terminal 事件到达后自动标记 `terminalSeen`
   - 默认 terminal 后自动从 session registry 释放
   - 若 session 已经 `cancelRequested`，会忽略晚到的 `completed` 事件
2. **`src/lib/backends/index.ts`**：新增 `session-consumer` 类型与函数导出
3. **新增 `src/lib/backends/session-consumer.test.ts`**：覆盖 3 个关键行为
   - 按顺序消费 started/live_state/completed 并在 terminal 后释放 session
   - local cancel 后抑制晚到 completion
   - `terminalSeen` 已置位时忽略后续全部事件

### 验证证据
1. **backends 骨架测试通过**
  - 执行：`npm test -- src/lib/backends/registry.test.ts src/lib/backends/session-registry.test.ts src/lib/backends/session-consumer.test.ts`
  - 结果：`3` 个测试文件全部通过，`10` 个测试全部通过，`0` 失败。
2. **生产构建通过**
  - 执行：`npm run build`
  - 结果：Next.js 生产构建完成，新增 `session-consumer` 骨架与导出均编译通过。

## 任务：开始 Phase 1 AgentBackend 最小骨架实现

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
在详细技术设计和 Phase 0 characterization tests 完成后，开始落第一批真正的 AgentBackend 代码骨架。这一轮刻意不把新抽象接进现有运行时，只先建立独立可编译、可测试的 `backends/` 基础层：类型合同、backend 注册表、活跃 session 注册表，以及对应的单元测试。

### 本次完成的关键改动
1. **新增 `src/lib/backends/types.ts`**：定义 Phase 1 的基础合同
  - `BackendRunConfig`
  - `AgentBackendCapabilities`
  - `BackendRunError`
  - `AgentEvent` 联合类型
  - `AgentSession`
  - `AgentBackend`
2. **新增 `src/lib/backends/registry.ts`**：提供 HMR 安全的 backend 注册表
  - `registerAgentBackend()`
  - `getAgentBackend()`
  - `hasAgentBackend()`
  - `listAgentBackends()`
  - `clearAgentBackends()`
3. **新增 `src/lib/backends/session-registry.ts`**：提供进程内活跃 session 索引
  - `registerAgentSession()`
  - `getAgentSession()`
  - `markAgentSessionCancelRequested()`
  - `markAgentSessionTerminalSeen()`
  - `removeAgentSession()`
  - `clearAgentSessions()`
4. **新增 `src/lib/backends/index.ts`**：统一导出骨架层接口与注册表 API
5. **新增两组单测**
  - `src/lib/backends/registry.test.ts`
  - `src/lib/backends/session-registry.test.ts`

### 设计边界
- 本轮没有把 `AgentBackend` 接到 `prompt-executor.ts` 或 `group-runtime.ts`。
- 目标是先把合同和注册表立起来，为后续 Prompt Mode 接入做准备，避免在抽象尚未稳定时半接入现有运行时。

### 验证证据
1. **骨架单测通过**
  - 执行：`npm test -- src/lib/backends/registry.test.ts src/lib/backends/session-registry.test.ts`
  - 结果：`2` 个测试文件全部通过，`7` 个测试全部通过，`0` 失败。
2. **生产构建通过**
  - 执行：`npm run build`
  - 结果：Next.js 生产构建完成，新增 `backends/` 目录与此前 runtime 调整均编译通过。

## 任务：补 Phase 0 第二批 group-runtime characterization tests

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
在第一批 PromptExecutor / RunRegistry / watcher 基线测试落地后，继续补齐 `group-runtime` 的关键行为基线，覆盖 template legacy-single 的派发路径和两条 cancel 路径。为让这批测试在当前 Vitest 环境下可执行，同时把 `group-runtime.ts` 里阻碍测试的 `token-quota` / `approval handler` / `project-registry` 动态 `require()` 收敛为静态 import。

### 本次完成的关键改动
1. **新增 `group-runtime.test.ts`**：覆盖 3 个关键行为
   - `dispatchRun()` 在 `legacy-single` 模式下会创建 child conversation、发送 workflow prompt、启动 watcher
   - `cancelRun()` 在无 active cascade 时会本地把 project stage 标成 `cancelled`
   - `cancelRun()` 在存在 owner connection 时会调用 `grpc.cancelCascade()` 并同步 project stage
2. **`group-runtime.ts`**：将以下依赖从动态 `require()` 调整为静态 import，降低运行时分叉并使测试可控
   - `../approval/token-quota`
   - `../approval/handler`
   - `./project-registry`
3. **`group-runtime.ts`**：在下游自动触发逻辑中补 `pipelineState` 局部变量，修复静态 import 后暴露出的 TypeScript 收窄问题，确保生产构建继续通过。

### 验证证据
1. **Phase 0 基线测试通过**
  - 执行：`npm test -- src/lib/agents/group-runtime.test.ts src/lib/agents/prompt-executor.test.ts src/lib/agents/run-registry.test.ts src/lib/agents/watch-conversation.test.ts`
  - 结果：`4` 个测试文件全部通过，`13` 个测试全部通过，`0` 失败。
2. **生产构建通过**
  - 执行：`npm run build`
  - 结果：Next.js 生产构建完成，相关 API 和运行时代码编译通过。

## 任务：补 Phase 0 第一批 characterization tests

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
开始执行 AgentBackend 迁移前的 Phase 0 测试基线工作，先把最稳定、最关键的底层运行时不变量锁成测试：PromptExecutor 的 prompt-only 启动语义、RunRegistry 的 pipelineStageId 推导规则，以及 watcher 的 stream/heartbeat 生命周期行为。

### 本次完成的关键改动
1. **`prompt-executor.test.ts`**：新增显式断言，锁定 Prompt Run 不会传入 `templateId` / `pipelineStageId`，避免后续重构时把 Prompt Mode 重新污染成 template-first 运行态。
2. **新增 `run-registry.test.ts`**：覆盖 `createRun()` 的两条关键分支
  - 无 `templateId` 的 Prompt Run 不推导 `pipelineStageId`
  - 有 `templateId` 的 Template Run 自动把 `stageId` 记为 `pipelineStageId`
  - `updateRun()` 在 terminal / non-terminal 间切换时正确设置和清除 `finishedAt`
3. **新增 `watch-conversation.test.ts`**：覆盖 watcher 的 3 个关键行为
  - stream update 正常推动 stepCount / idle 状态切换
  - 错误步骤会把 run 视为 inactive
  - 当 stream 静默且提供 `apiKey` 时，heartbeat poll 会继续推进状态

### 说明
- 原计划一度尝试直接给 `group-runtime.ts` 补纯单元 characterization tests，但其内部仍大量使用运行时 `require()` 加载 `project-registry` / `token-quota` 等模块，这条路径在当前 Vitest ESM 环境下不适合作为第一批稳定基线。
- 因此本轮先锁更底层、对后续 AgentBackend 抽象更关键的行为边界；`group-runtime` 的基线建议放到下一批，用更接近集成层的测试方式处理。

### 验证证据
1. **第一批基线测试通过**
  - 执行：`npm test -- src/lib/agents/prompt-executor.test.ts src/lib/agents/run-registry.test.ts src/lib/agents/watch-conversation.test.ts`
  - 结果：`3` 个测试文件全部通过，`10` 个测试全部通过，`0` 失败。

## 任务：完成 AgentBackend 统一抽象详细技术设计文档

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
在此前 RFC 级别方案的基础上，继续把 AgentBackend 统一抽象推进到可落地的详细技术设计层，补齐精确接口签名、事件模型、状态机、错误分类、迁移阶段、测试矩阵以及与当前 `TaskExecutor` / `group-runtime` / `prompt-executor` 的真实对接边界。

### 关键结论
1. **当前 `TaskExecutor` 不是最终 runtime 合同，而只是 provider leaf adapter**：`CodexExecutor` 返回最终结果，`AntigravityExecutor` 只返回已派发 handle，这种语义分裂决定了上层必须再引入统一 session lifecycle 抽象。
2. **详细设计正式把 RFC 中的 `run(config): AsyncIterable<AgentEvent>` 细化为 `start(config): Promise<AgentSession>`**：这是为了显式支持“先拿 handle、再监听事件、同时允许 cancel/append”。
3. **`AgentBackend` 必须只负责单次 backend session 生命周期，不负责 template orchestration**：`group-runtime` 继续掌管 source contract、review-loop、pipeline 推进，避免过早抽象把厚编排层抽坏。
4. **最稳的迁移顺序是：先补 characterization tests → 先迁 Prompt Mode → 再抽公共 session consumer/finalization → 最后迁 Template runtime → 再接 MemoryHooks。**
5. **`RunRegistry` 继续是真相源，新增 session registry 只做进程内活跃会话索引。**

### 产出
- 新增设计文档：`docs/design/agent-backend-abstraction-detailed-design.md`

### 说明
- 本次为详细技术设计入库，没有修改运行时代码。
- 文档中已经明确写死第一阶段应统一哪些能力、哪些能力不能提前抽，以及 Antigravity/Codex 两条路径各自的 session 生命周期差异。

## 任务：CEO 指令 LLM 自然语言解析

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
用 `callLLMOneshot()` 替代正则硬编码来解析 CEO 自然语言指令，支持"下午3点""每月1号""周一和周五"等正则无法处理的表述。

### 架构变更
- `processCEOCommand()` 重构为 **LLM-first + 正则 fallback** 双路径
- 新增 `parseCEOCommandWithLLM()` — 构建结构化 prompt 发送给 LLM，返回严格 JSON
- 新增 `executeLLMParsedCommand()` — 处理 LLM 返回的结构化结果
- 新增 `buildActionDraftFromLLM()` — 从 LLM 结果构建 action draft
- 新增 `createScheduledJobFromDraft()` — LLM/正则共享的 job 创建函数
- 新增 `processWithRegex()` — 原正则逻辑提取为独立函数
- LLM 调用15秒超时保护，超时自动 fallback 到正则

### LLM Prompt 设计
- 包含可用部门列表（名称/类型/URI/模板）
- 包含可用项目列表（名称/ID/状态）
- 包含可用模板列表（ID/标题）
- 明确的时间解析规则（中文时段 → 24小时制）
- 明确的 cron 表达式生成规则
- 内置 cron 校验（`validateCron`），LLM 生成无效 cron 时自动 fallback

### 正则解析的已知限制（对比 LLM 优势）
| 场景 | 正则结果 | LLM 期望 |
|------|---------|----------|
| "下午3点" | 03:00 ❌ | 15:00 ✅ |
| "每月1号" | 失败 ❌ | `0 9 1 * *` ✅ |
| "周一和周五" | 只取周一 ❌ | `0 9 * * 1,5` ✅ |
| "每两周" | 失败 ❌ | interval 14天 ✅ |

### 测试证据
- 25 个测试全绿（含 LLM 解析专项测试 3 个）
- 生产构建通过
- Smoke test 确认 fallback 路径正常（LLM 不可用时正则兜底）

---

## 任务：CEO Dashboard 即时 Prompt Mode 指令卡片

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
升级 CEO Dashboard 的"用一句话创建定时任务"卡片为"CEO 指令中心"，支持即时 Prompt Mode 执行 + 定时任务创建双路径。

### 本次完成的关键改动
1. **`ceo-scheduler-command-card.tsx`**：
   - 标题从"用一句话创建定时任务"改为"CEO 指令中心"
   - 描述文案更新，说明支持即时执行和定时任务
   - Preset 新增即时 Prompt Mode 示例（"让XX部门分析最近一周的关键信号"）
   - 提交按钮从"由 CEO 创建"改为"CEO 下令"，图标从 CalendarClock 改为 Zap
   - 结果展示：`dispatch_prompt` 返回时显示橙色"⚡ Prompt Run"徽章 + runId
   - 新增 `onRunDispatched` 回调 prop
   - 支持提示栏更新为"即时执行 / 每日 / 工作日 / 每周 / 明天 / 每隔 N 小时"
2. **`api.ts`**：`CEOCommandResult` action 联合类型新增 `'dispatch_prompt'`

### 新增 / 更新的核心文件
- `src/components/ceo-scheduler-command-card.tsx`
- `src/lib/api.ts`

### 验证证据
1. 26 个测试全绿 + 生产构建通过
2. 静态类型检查零错误

## 任务：补 Prompt Run 前端展示入口 + 项目详情集成 + 接口文档

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
在 PromptExecutor 运行时和 CEO/Scheduler 触发链路已落地的基础上，完成三方面收口：
1. 前端展示：Run 列表、Run 详情、项目详情三入口正确识别和展示 Prompt Run
2. API 文档：gateway-api、mcp-server、ceo-scheduler-guide 全部更新
3. CEO Workflow playbook：新增即时 Prompt Mode 和定时 dispatch-prompt 两个工作流模板

### 本次完成的关键改动
1. **`agent-runs-panel.tsx`**：RunItem 组件新增橙色 "Prompt" badge
2. **`agent-run-detail.tsx`**：Run 详情页新增 "Prompt" StatusChip，禁用 nudge/retry/restart_role 干预按钮
3. **`stage-detail-panel.tsx`**：Pipeline stage 详情新增 "Prompt" StatusChip，禁用 restart_role
4. **`project-workbench.tsx`**：Pipeline 视图下方新增"Standalone Prompt Runs"区域，展示不属于任何 stage 的 prompt run
5. **`prompt-runs-section.tsx`**（新增）：独立 Prompt Runs 展示组件，橙色主题，显示状态/时间/摘要，支持取消
6. **`agent-runs/route.ts` GET**：新增 `executorKind` query param 过滤
7. **`run-registry.ts`**：`listRuns` 支持 `executorKind` 过滤

### 新增 / 更新的核心文件
- `src/components/agent-runs-panel.tsx`
- `src/components/agent-run-detail.tsx`
- `src/components/stage-detail-panel.tsx`
- `src/components/project-workbench.tsx`
- `src/components/prompt-runs-section.tsx` (新增)
- `src/app/api/agent-runs/route.ts`
- `src/lib/agents/run-registry.ts`

### 验证证据
1. 26 个测试全绿 + 生产构建通过
2. 静态类型检查零错误

## 任务：Scheduler dispatch-prompt + CEO 自然语言→Prompt Mode（定时+即时）

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
在 PromptExecutor 运行时已落地的基础上，补齐三条上游触发链路：
1. Scheduler 新增 `dispatch-prompt` action kind，定时任务可以直接触发 Prompt Mode 执行
2. CEO 自然语言指令在无法唯一匹配 template 但检测到执行意图时，定时任务自动产出 `dispatch-prompt` 而非降级为只创建项目
3. CEO 即时指令（非定时场景）检测到执行意图并匹配到部门时，直接发起 Prompt Mode 执行

### 本次完成的关键改动
1. **`scheduler-types.ts`**：`ScheduledAction` 联合类型新增 `dispatch-prompt` 分支
2. **`scheduler.ts`**：`normalizeScheduledJobDefinition` 新增 `dispatch-prompt` 校验；`triggerAction` 新增 `dispatch-prompt` 分支调用 `executePrompt()`
3. **`ceo-agent.ts`**：
   - `CEOCommandResult` 新增 `dispatch_prompt` action 和 `runId` 字段
   - `SchedulerActionDraft` 新增 `dispatch-prompt` 分支
   - 定时任务：`deriveActionDraft` 在无唯一 template 但有执行意图时产出 `dispatch-prompt`
   - 即时指令：新增 `tryImmediatePromptDispatch()` 函数，在非定时意图分支检测执行意图+匹配部门后直接调 `executePrompt()`
   - `processCEOCommand` 组装和返回消息支持 `dispatch-prompt`
4. **`mcp/server.ts`**：create/update scheduler job 的 MCP 工具 schema 扩展 `dispatch-prompt`

### 新增 / 更新的核心文件
- `src/lib/agents/scheduler-types.ts`
- `src/lib/agents/scheduler.ts`
- `src/lib/agents/ceo-agent.ts`
- `src/mcp/server.ts`
- `src/lib/agents/scheduler.test.ts`
- `src/lib/agents/ceo-agent.test.ts`

### 验证证据
1. **单元测试通过**：4 个文件 26 个测试全绿，覆盖：dispatch-prompt 定时触发、CEO 定时无唯一 template 走 prompt、CEO 即时执行匹配部门走 prompt、即时执行无部门匹配回退、executePrompt 失败处理
2. **生产构建通过**

## 任务：CEO 原生定时调度能力闭环落地

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
围绕“CEO 应该能直接创建 cron / schedule，而不是逼用户去填底层表单”这一目标，完成了一次从后端能力、CEO Workflow、MCP 工具、Web UI 到结果回流的端到端收口。当前系统已经不再只有一个技术向的 Scheduler Panel，而是具备了 CEO 原生的自然语言调度主链路。

### 本次完成的关键改动
1. **补齐缺失的 CEO 调度后端**：新增 `src/lib/agents/ceo-agent.ts`，让 `POST /api/ceo/command` 真正可用，并支持自然语言解析为 Scheduler Job。
2. **建立自然语言调度主链路**：支持从中文指令中解析 `cron / interval / once`，并自动映射为三种动作模板：`create-project`、`health-check`、`dispatch-pipeline`。
3. **修复 Scheduler 契约缺口**：`src/lib/agents/scheduler-types.ts` 补充 `create-project` action 类型，同时增加 `createdBy`、`intentSummary` 等元数据字段。
4. **补齐 Scheduler 审计闭环**：`src/lib/agents/ops-audit.ts` 和 `src/lib/agents/scheduler.ts` 新增 `scheduler:created / updated / deleted / triggered / failed` 事件写入，且能带回 `projectId`。
5. **补齐 CEO 结果回看链路**：`src/lib/ceo-events.ts` 现在会把 scheduler 审计事件转成 CEO 事件；`src/app/page.tsx` 头部通知和 `src/components/ceo-dashboard.tsx` 仪表盘已能显示调度结果。
6. **补 CEO 原生 UI 入口**：新增 `src/components/ceo-scheduler-command-card.tsx`，在 CEO Dashboard 中提供“用一句话创建定时任务”的原生入口。
7. **修复 Operations 主舞台入口断层**：`src/app/page.tsx` 的 operations 区域已经直接挂载 `SchedulerPanel`，不再只有侧边栏隐藏入口。
8. **补齐 MCP 写能力**：`src/mcp/server.ts` 新增 `antigravity_create_scheduler_job`、`antigravity_update_scheduler_job`、`antigravity_trigger_scheduler_job`、`antigravity_delete_scheduler_job`。
9. **优化 CEO Workflow**：更新 `src/lib/agents/ceo-environment.ts` 与真实 CEO 工作区 `~/.gemini/antigravity/ceo-workspace/.agents/workflows/ceo-playbook.md`，加入 scheduler 分支，并修正旧的 `groupId` 口径为 `templateId + stageId`；新增 `ceo-scheduler-playbook.md`。
10. **补齐接口与使用文档**：新增 `docs/guide/ceo-scheduler-guide.md`，并更新 `docs/guide/mcp-server.md`、`docs/guide/agent-user-guide.md`。
11. **收口对外语义**：把 Web UI、API 返回消息、CEO Workflow 和外部文档中的 create-project 示例统一改成“定时创建任务项目 / Ad-hoc Project”，不再让用户误以为 scheduler 触发时会直接产出日报正文；同时把 `docs/guide/gateway-api.md`、`docs/guide/cli-api-reference.md` 与当前 `/api/ceo/command` 真实行为对齐，并在 `docs/design/ceo-cron-capability-gap-analysis.md` 顶部补上“实现前快照”说明。
12. **补齐 create-project auto-run 主链路**：`create-project` job 现在可以持久化 `templateId`，scheduler 触发时统一复用 `executeDispatch()`；CEO 自然语言创建会在建 job 时优先解析显式模板、部门模板和任务语义，必要时回退到全局合适模板，并把最终选中的 template 写入 `opcAction.templateId`。若无法唯一确定模板，则明确降级为“只创建项目、不直接启动 run”。

### 新增 / 更新的核心文件
- `src/lib/agents/ceo-agent.ts`
- `src/components/ceo-scheduler-command-card.tsx`
- `src/lib/agents/scheduler.ts`
- `src/lib/agents/scheduler-types.ts`
- `src/lib/agents/ops-audit.ts`
- `src/lib/ceo-events.ts`
- `src/mcp/server.ts`
- `src/lib/agents/ceo-environment.ts`
- `docs/guide/ceo-scheduler-guide.md`
- `docs/guide/mcp-server.md`
- `docs/guide/agent-user-guide.md`
- `~/.gemini/antigravity/ceo-workspace/.agents/workflows/ceo-playbook.md`
- `~/.gemini/antigravity/ceo-workspace/.agents/workflows/ceo-scheduler-playbook.md`

### 验证证据
1. **单元测试通过**
  - 执行：`npm test -- src/lib/agents/scheduler.test.ts src/lib/agents/ceo-agent.test.ts src/lib/ceo-events.test.ts`
  - 结果：`3` 个测试文件全部通过，`14` 个测试全部通过，`0` 失败。
2. **生产构建通过**
  - 执行：`npm run build`
  - 结果：Next.js 生产构建完成，所有相关 API 路由与页面编译成功。
3. **真实接口 smoke test 通过**
  - 调用：`POST /api/ceo/command`
  - 指令：`明天上午 9 点让超级 IT 研发部创建一个 ad-hoc 项目，目标是 smoke test`
  - 返回：成功创建 `jobId = 38d088ad-37f0-4c13-be62-966d7a4be32b`，`nextRunAt = 2026-04-09T07:00:00.000Z`
  - 进一步验证：`GET /api/scheduler/jobs` 能查到该 job，随后已通过 `DELETE /api/scheduler/jobs/:id` 清理，避免残留脏数据。
4. **Scheduler 契约回归 smoke test 通过**
  - 验证 1：通过 `POST /api/scheduler/jobs` 创建 `create-project` job，再 `PATCH` 更新成 `health-check`，返回结果中 `opcAction` 与 `departmentWorkspaceUri` 已被正确清空。
  - 验证 2：对 `PATCH /api/scheduler/jobs/:id` 发送非法 JSON，请求返回 `400` 与 `{"error":"Invalid JSON body"}`，不再把坏请求吞成空更新。
5. **Auto-run 单测通过**
  - 执行：`npm test -- src/lib/agents/scheduler.test.ts src/lib/agents/ceo-agent.test.ts`
  - 结果：`2` 个测试文件全部通过，`12` 个测试全部通过，覆盖了 create-project 自动派发、仅创建项目降级路径，以及 CEO 创建时的模板选择回退。
6. **真实 API smoke test 通过（安全路径，不触发真实 run）**
  - 调用：`POST /api/ceo/command`
  - 指令：`明天上午 9 点让超级 IT 研发部创建一个日报任务项目，目标是汇总当前进行中的项目与风险 smoke-<timestamp>`
  - 返回：成功创建 `jobId = b0cd76f4-023f-4f22-9a2f-8e938f388cab`，响应消息已明确写出将派发模板 `Universal Batch Research (Fan-out)`。
  - 进一步验证：`GET /api/scheduler/jobs` 查得该 job 的 `opcAction.templateId = universal-batch-template`，随后已通过 `DELETE /api/scheduler/jobs/:id` 清理。

### 结果判断
本轮已把此前文档中定义的核心缺口真正打通：

1. CEO 现在**可以原生创建定时任务**。
2. Scheduler 不再只是“系统能跑”的 infra，而是有了 **CEO 可用的自然语言入口**。
3. 调度结果已经能回流到 **CEO Dashboard / Header Event Flow / 审计链路**。
4. MCP 与 Workflow 现在都具备了与 Web UI 一致的调度能力和接口文档。

## 任务：梳理 Template / Workflow / Project-only 执行机制与目标架构

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
围绕“不是所有部门都应该依赖复杂 template，部分部门可能以 workflow 为主”的问题，对当前 Antigravity 的执行机制重新做了一次结构化梳理，并把结论写入本地设计文档，避免后续继续把 Template、Workflow、Project、Ad-hoc 混成同一个概念讨论。

### 关键结论
1. **Template 仍是当前唯一真正进入 Gateway 执行面的执行蓝图**：run 的真实主链仍然是 `templateId -> stageId -> run`，统一入口仍是 `executeDispatch()`。
2. **Workflow 当前是资产层，不是执行层**：它现在要么作为 template role 引用的 markdown prompt 资产存在，要么作为 IDE/workspace/global workflow 资产被列出和编辑，还没有 workflow executor。
3. **Project / adhoc 不是执行器**：`createProject()` 只创建容器；`adhoc` 只是项目类型，不代表单角色直接执行模式。
4. **对没有 template 但有 workflow 的部门，当前最准确的系统描述是 project-only**：可以创建项目，但不会因为“存在 workflow 文件”就自动产出 run。
5. **后续最稳的方向不是继续讨论 templateId 是否必填，而是引入 ExecutionTarget / ExecutionIntent**：明确拆分 `project-only`、`template`、`workflow` 三种后续执行目标。

### 产出
- 新增设计文档：`docs/design/execution-target-architecture.md`

### 说明
- 本次为机制梳理与架构思考入库，没有修改运行时代码。
- 文档中已明确写出当前不存在但容易被误以为存在的能力，包括 `workflow-only dispatch`、`DepartmentSkill.workflowRef` 驱动执行、以及 `adhoc = 单角色执行器`。
- 当前建议也已写入文档：在 workflow executor 真正落地前，产品层应明确承认 `project-only` 是合法目标，而不是继续依赖更多 template fallback。

## 任务：补充 WorkflowExecutor 如何复用 Run 框架的设计思考

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
继续围绕“如果独立做 WorkflowExecutor，如何跟踪、上报以及查看工作结果”这个关键问题，对现有 RunRegistry、artifact、audit、CEO 事件与项目详情链路做了一次结构化对齐，并把结论补回执行目标设计文档，避免后续把 WorkflowExecutor 误做成又一套孤立运行时。

### 关键结论
1. **最稳的方案不是另起 workflow-run，而是继续复用 Run 作为统一运行态对象**：Project 继续做容器，WorkflowExecutor 只作为新的 executorKind 存在。
2. **真正值得复用的是 run 外壳，不是 template/stage 专属调度层**：RunRegistry、artifactDir、ResultEnvelope 思路、Ops Audit、项目与 run 的关联都可直接复用；`executeDispatch()`、pipelineState、source contract 这些 template 强绑定层必须解耦。
3. **查看结果的主路径应该继续围绕 run，而不是 workflow 文档或 Deliverables 面板**：项目详情应新增 run-linked workflow 视图，artifact 目录仍是结果真相源。
4. **如果未来落地 WorkflowExecutor，最小字段补充应集中在 executionTarget / executorKind，而不是伪造 templateId**。

### 产出
- 更新设计文档：`docs/design/execution-target-architecture.md`

### 说明
- 本次仍为架构思考入库，没有修改运行时代码。
- 文档中已新增关于 WorkflowExecutor 的状态真相、审计上报、项目详情展示和结果落点的章节，方便后续继续讨论是否正式引入 workflow 执行层。

## 任务：澄清 workflow 术语与 prompt 资产边界

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
继续围绕“当前所谓 workflow 是否其实只是 prompt 资产”这个关键命名问题，对执行目标设计文档补充了一层术语澄清，避免后续把 markdown playbook、可执行 template 和未来可能存在的独立 workflow 编排继续混叫成一个词。

### 关键结论
1. **如果当前 markdown workflow 的本质只是 prompt / playbook，继续直接叫 workflow 会持续制造误解**。
2. **当前仓库最稳的术语边界应该是：Template/Pipeline = 可执行编排；Workflow markdown = Playbook / Prompt Asset；Skill = 能力单元**。
3. **如果未来真要引入独立的 workflow executor，最好用新的词，例如 Execution Flow / Automation Flow，而不是直接继承今天已经被 prompt 资产污染的 workflow 概念**。

### 产出
- 更新设计文档：`docs/design/execution-target-architecture.md`

### 说明
- 本次仍为设计讨论入库，没有修改运行时代码。
- 文档里已补充“术语本身也在制造误解”的章节，方便后续继续决定是否要在文档/API/字段名层面逐步去 workflow 化。

## 任务：澄清 Template Mode / Prompt Mode / 同对话执行的层级关系

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
继续围绕“非固定模板任务更应该理解成 Prompt Mode，而不是 Workflow Mode”这个问题，对执行目标设计文档做了进一步收口，明确补上了 Template Mode、Prompt Mode 与 shared conversation 的层级关系，避免后续把“同一个对话执行”误判成 Template 之上的新模式。

### 关键结论
1. **当前所谓同对话执行，不是新的上层执行模式，而是 Template 运行时里的 conversation reuse 策略**。
2. **如果任务不是固定 Template，而是 prompt 主导、再辅以 playbook / skill 提示，那么更稳的名字就是 Prompt Mode**。
3. **未来若真要引入独立可执行编排，应单独命名为 Execution Flow / Automation Flow，而不应继续复用今天已被 prompt 资产污染的 workflow 概念**。

### 产出
- 更新设计文档：`docs/design/execution-target-architecture.md`

### 说明
- 本次仍为概念梳理入库，没有修改运行时代码。
- 文档中 ExecutionTarget 的建议已同步从 `workflow` 收口为 `prompt`，并新增了“同对话执行是 Template runtime 子模式”的说明。

## 任务：整理 Prompt Mode / Template Mode 执行术语表

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
把这一轮讨论中已经反复出现的术语边界进一步独立成一页 glossary，专门用来澄清 Template、Prompt Mode、Playbook、Skill、Shared Conversation 和未来 Execution Flow 的关系，避免主设计文档既要讲机制又要兼做词典。

### 关键结论
1. **Template / Pipeline 应只保留给固定可执行编排**。
2. **非固定模板任务应优先叫 Prompt Mode，而不是 Workflow Mode**。
3. **当前 markdown workflow 文件在产品语义上更接近 Playbook / Prompt Asset**。
4. **Shared Conversation 只是运行时策略，不是新的产品模式**。
5. **如果未来真有独立自动化编排，应使用 Execution Flow / Automation Flow 之类的新术语，而不是继续复用 workflow。**

### 产出
- 新增设计文档：`docs/design/execution-terminology-glossary.md`

### 说明
- 本次仍为术语收口入库，没有修改运行时代码。
- 后续如果要逐步去 workflow 化，这份 glossary 可以直接作为文档、API 和字段命名迁移的参照基线。

## 任务：编写 PromptExecutor 最小接口草案

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
把 Prompt Mode 从概念讨论进一步推进到接口层，整理出一份最小 PromptExecutor 合同草案，重点说明它如何复用现有 `POST /api/agent-runs`、Run、Artifact 与 Project 体系，而不是再起一套平行运行时。

### 关键结论
1. **最稳的接口方向是让 `agent-runs` 成为真正的统一执行入口，再通过 `executionTarget.kind` 分流到 TemplateExecutor 或 PromptExecutor**。
2. **Prompt Mode 的最小字段应集中在 `executionTarget`、`executorKind`、`triggerContext` 上，而不是继续扩散 template-first 字段。**
3. **Scheduler 若未来支持 Prompt Mode，最清晰的 action 语义应是新增 `dispatch-prompt`，而不是复用 `dispatch-pipeline`。**
4. **Prompt Mode 不应为了兼容展示链路伪造 templateId；应让 envelope / manifest 逐步承认 executionTarget 才是一等来源。**

### 产出
- 新增设计文档：`docs/design/prompt-executor-minimal-contract.md`

### 说明
- 本次仍为接口草案入库，没有修改运行时代码。
- 文档已包含最小请求体、route 分流策略、Run 字段补充建议，以及对 scheduler / CEO / 前端 API 的最小接入建议。

## 任务：实现 PromptExecutor 最小可运行版本

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
把此前 PromptExecutor 接口草案推进到真实可运行代码。新增 `prompt-executor.ts` 实现最小 Prompt Mode 执行链路，让 `POST /api/agent-runs` 成为统一执行入口，通过 `executionTarget.kind` 分流到 TemplateExecutor 或 PromptExecutor，同时保持完整的 template-first 向后兼容。

### 本次完成的关键改动

1. **新增 `src/lib/agents/prompt-executor.ts`**：PromptExecutor 运行时核心，支持两种 provider 路径：
   - **Antigravity（gRPC watcher）路径**：通过 `executeTask` 获得 cascadeId 后，启动 `watchConversation` 进行实时追踪，idle/error 后自动 finalize
   - **同步 provider（codex 等）路径**：后台异步 `executeTask`，完成后自动 finalize，取消后忽略晚到结果
2. **扩展 `src/lib/agents/group-types.ts`**：新增 `ExecutionTarget`（template / prompt / project-only 联合类型）、`ExecutorKind`、`TriggerContext`；`TaskEnvelope`、`ResultEnvelope`、`ArtifactManifest` 的 `templateId` 改为可选，新增 `executionTarget` 字段
3. **扩展 `src/lib/agents/run-registry.ts`**：`createRun` 接受 `executorKind`、`executionTarget`、`triggerContext`；`pipelineStageId` 只在有 `templateId` 时回填，避免 prompt run 污染项目 pipeline 状态
4. **扩展 `src/lib/agents/run-artifacts.ts`**：`scanArtifactManifest` 和 `buildResultEnvelope` 支持可选 `executionTarget`
5. **修改 `src/app/api/agent-runs/route.ts`**：route 分流逻辑——先检查 `executionTarget.kind`，`prompt` 走 PromptExecutor，`template` 或 legacy 顶层 `templateId` 走 `executeDispatch()`，其他 kind 返回 400
6. **修改 `src/app/api/agent-runs/[id]/route.ts` 和 `[id]/intervene/route.ts`**：DELETE 和 cancel 操作按 `executorKind` 分流到 `cancelPromptRun()` 或 `cancelRun()`；prompt run 只允许 cancel，不支持 nudge/retry 等干预
7. **扩展 `src/lib/api.ts`**：新增 `createPromptRun()` 前端包装方法
8. **扩展 `src/lib/types.ts`**：新增前端侧的 `ExecutionTargetFE`、`ExecutorKindFE`、`TriggerContextFE` 类型，`AgentRun` / `TaskEnvelopeFE` / `ResultEnvelopeFE` / `ArtifactManifestFE` 同步扩展

### 新增 / 更新的核心文件
- `src/lib/agents/prompt-executor.ts` (新增)
- `src/lib/agents/group-types.ts`
- `src/lib/agents/run-registry.ts`
- `src/lib/agents/run-artifacts.ts`
- `src/app/api/agent-runs/route.ts`
- `src/app/api/agent-runs/[id]/route.ts`
- `src/app/api/agent-runs/[id]/intervene/route.ts`
- `src/lib/api.ts`
- `src/lib/types.ts`
- `src/app/api/agent-runs/route.test.ts` (新增)
- `src/lib/agents/prompt-executor.test.ts` (新增)

### 验证证据
1. **单元测试通过**
   - 执行：`npm test -- src/app/api/agent-runs/route.test.ts src/lib/agents/prompt-executor.test.ts src/lib/agents/run-artifacts.test.ts src/lib/agents/scheduler.test.ts`
   - 结果：4 个测试文件全部通过，41 个测试全部通过，0 失败
   - 覆盖点：legacy template 兼容、prompt 分流、显式 template executionTarget、unsupported kind 拒绝、同步 provider 完整生命周期、watcher 路径完整生命周期、取消后晚到结果保护、Antigravity dispatch 失败收口
2. **生产构建通过**
   - 执行：`npm run build`
   - 结果：Next.js 生产构建完成，所有 API 路由编译成功
3. **独立代码审查**
   - 第一轮审查发现 3 个 MAJOR 问题：watcher 未透传 apiKey（heartbeat 失效）、Antigravity 分支失败/取消收口缺失、template executionTarget 未真正打通
   - 三个问题均已修复并通过回归测试和重新构建验证

### 审查修复明细
1. **watcher apiKey 透传**：`startPromptWatch` 的连接类型从 `{ port, csrf }` 扩展为 `{ port, csrf, apiKey? }`，并把 apiKey 传给 `watchConversation` 的第五参数，恢复 heartbeat 兜底轮询
2. **Antigravity 失败收口**：executeTask 的 await 用 try/catch 包裹，抛错时回写 `status: 'failed'` 并清理 activePromptRuns；await 返回后在写回 running 之前重新检查 run 是否已进入终态
3. **template executionTarget 打通**：route 在调用 `executeDispatch` 时，`templateId` 和 `stageId` 优先从 `executionTarget` 取值，保证 `{ executionTarget: { kind: 'template', templateId, stageId } }` 格式的请求能正确分流

### 剩余风险
- PromptExecutor 当前没有 UI 展示入口，prompt run 结果只能通过 API 或项目详情查看
- Scheduler 尚未支持 `dispatch-prompt` action kind，prompt run 只能通过 API / CEO 手动触发
- prompt run 的 intervene（nudge/retry）当前直接返回 400，未来可能需要按需放开

## 任务：制定 Antigravity 长期演进大节点路线图

**状态**: ✅ 已完成
**日期**: 2026-04-07

### 概要
基于当前仓库真实实现、前一轮与 craft-agents 的架构比较，以及用户进一步明确的“虚拟公司”产品愿景，整理出一份未来 6-18 个月的长期演进路线图，不再停留在“下一步做哪个功能”，而是明确主线顺序、阶段边界和不该做的事。

### 关键结论
1. **Antigravity 的主线应该是 AI 软件组织系统，而不是通用 coding shell**：长期路线应围绕 CEO、Department、Project/Run/Stage、规则、记忆、OKR、Scheduler 这些组织对象展开，而不是继续拿 shell 成熟度做唯一目标。
2. **正确顺序是“执行底座 → 治理内核 → CEO 经营台 → 部门操作系统 → OKR/记忆闭环 → 自治运营”**：节点顺序不能反，否则会得到一个看起来像公司的 UI，但底层仍然松散。
3. **最优先的根问题仍然是执行后端契约没有完全收口**：现阶段不应先扩 provider 或继续堆前端，而应先补统一的 execution backend / event / capability 抽象。
4. **短期两周内最值得做的是三份蓝图，而不是直接散着开发**：执行后端契约蓝图、治理状态机蓝图、CEO 经营台信息架构。

### 产出
- 新增设计文档：`docs/design/antigravity-long-term-evolution-roadmap.md`

### 说明
- 本次为架构规划与产品路线设计，没有修改业务代码。
- 本次路线图明确延续此前结论：**不建议直接基于 craft 重构 Antigravity**，只建议借鉴其 backend/event/capability 抽象思路。
- 已进一步补充一条关键实施原则：**不要先做空中抽象，也不要继续带着耦合堆功能；应先打通一条最小主链路，再围绕真实链路抽象边界。**
- 已继续补充三个当前高风险能力的优先级：**Department Memory 先于 Scheduler，Scheduler 先于 Self-Evolution**；自治只能先从“生成改进建议并走审批”开始，不能直接自改系统。

## 任务：补充 Antigravity 与 craft 的成熟度评分矩阵

**状态**: ✅ 已完成
**日期**: 2026-04-07

### 概要
在上一轮“是否直接基于 craft 继续开发”的可行性结论基础上，继续补充了一份更硬的成熟度评分矩阵，避免只凭直觉觉得 “craft 更完整，所以 Antigravity 没价值”。这次把比较拆成两个战场：
1. **通用 coding agent shell**
2. **AI 软件组织 / 治理平台**

### 关键结论
1. **如果按通用 coding agent shell 比，craft 目前更成熟**：workspace/session 一致性、backend/provider 抽象、多 provider 覆盖、session 持久化等层面，craft 的收口度明显更高。
2. **如果按 AI 软件组织 / 治理平台比，Antigravity 反而更成熟**：`Project / Run / Stage` 编排、交付治理、CEO / Department / Approval 模型、多阶段交付流，都是 Antigravity 已经成型而 craft 基本不解决的层。
3. **Antigravity 当前不是“没价值”，而是“价值点已经出现，但底层执行抽象还没完全收口”**：真正的短板是 provider/runtime 中层还不够干净，不是产品方向本身没价值。
4. **最危险的误判是拿错标尺**：如果用 craft 擅长的 session shell 标尺去衡量 Antigravity，会低估它在组织编排与治理层的独特价值。

### 产出
- 更新研究文档：`docs/internals/antigravity-vs-craft-feasibility-study.md`

### 说明
- 本次没有新增代码改动，属于前一份研究文档的深化补充。
- 成熟度分值是基于当前源码结构与主链路收口情况给出的工程判断，不是市场判断或情绪判断。

## 任务：评估 Antigravity 是否应直接基于 craft-agents 继续开发

**状态**: ✅ 已完成
**日期**: 2026-04-07

### 概要
围绕用户提出的核心问题，基于当前 Antigravity 与 craft-agents-oss 两个仓库的真实源码，对“是否可以直接基于 craft 继续开发”做了系统梳理。重点核对了 workspace 模型、conversation/session 模型、provider 抽象、多 Agent 编排层、产品形态与集成成本，避免只凭 README 或表面功能相似度下结论。

### 关键结论
1. **不建议直接以 craft 作为 Antigravity 的开发基座**：两边都看起来有 workspace、会话、provider，但它们所在层次不同。craft 的中心是 `workspace + session + backend + event`，Antigravity 的中心是 `project + stage + run + governance`。
2. **两边的 workspace 含义不一样**：Antigravity 的 workspace 更像被外部 IDE / language_server 驱动的执行目标；craft 的 workspace 更像应用自己管理的工作容器。
3. **两边的会话对象也不是同构的**：Antigravity 的 `cascadeId/codex thread` 只是 transport handle，真正的一等业务对象是 `runId/projectId/pipelineState`；craft 的 session 则本身就是产品核心对象。
4. **最值得借鉴的是 backend/event 抽象思路，而不是 craft 整体产品壳**：包括 capability-driven backend、统一事件模型、session/backend 分层方式；不建议整体搬运 craft 的 workspace/session/UI 层。
5. **更现实的路线是“Antigravity 为主系统，craft 只做局部参考或叶子执行器”**：先继续把 Antigravity 自己的 provider/runtime 边界收口，再考虑增加实验性 backend，而不是整体迁到 craft。

### 产出
- 新增研究文档：`docs/internals/antigravity-vs-craft-feasibility-study.md`

### 验证依据
- Antigravity 架构与运行时：`ARCHITECTURE.md`
- Antigravity dispatch/runtime：`src/lib/agents/dispatch-service.ts`、`src/lib/agents/group-runtime.ts`
- Antigravity provider：`src/lib/providers/ai-config.ts`、`src/lib/providers/index.ts`、`src/lib/providers/types.ts`
- Antigravity conversation/workspace：`src/app/api/conversations/route.ts`、`src/app/api/conversations/[id]/send/route.ts`、`src/app/api/workspaces/launch/route.ts`
- Antigravity orchestration state：`src/lib/agents/project-registry.ts`、`src/lib/agents/run-registry.ts`
- craft backend/provider：`craft-agents-oss/packages/shared/src/agent/backend/factory.ts`、`craft-agents-oss/packages/shared/src/agent/backend/types.ts`
- craft workspace/session：`craft-agents-oss/packages/shared/src/workspaces/storage.ts`、`craft-agents-oss/packages/shared/src/sessions/storage.ts`
- craft session orchestration：`craft-agents-oss/packages/server-core/src/sessions/SessionManager.ts`

### 说明
- 本次为架构研究与本地文档写作，没有修改 craft-agents-oss 源码。
- 中途尝试调用研究子代理，但遇到网络切换错误，最终改为主代理直接完成源码对比。
- 待下一步如果需要落地 PoC，建议优先验证“实验性 backend 能否接入 Antigravity 单 stage 执行”，而不是直接迁移产品层。

## 任务：Grok CLI (`~/bin/grok`) 稳定性修复

**状态**: ✅ 已完成
**日期**: 2026-04-07

### 概要
修复基于 bb-browser 的 Grok CLI 中多个导致超时的稳定性问题。CLI 现已能可靠地完成所有核心功能：问答、模型切换、继续对话、管道输入、历史查看/恢复、文件输出。

### 修复的问题
1. **Stale ref 问题**：grok.com 使用 Radix UI，DOM 频繁重渲染导致 `bb-browser click <ref>` 失败。新增 `clickRef()` 辅助函数，自动重试3次（每次取新 snapshot + 新 ref）。
2. **编辑器残留文本**：`sendMessage` 之前没有清空编辑器，导致新消息追加到旧文本后。现在发送前先执行 `selectAll → delete → insertText`。
3. **自动补全干扰**：grok.com 的自动补全建议会修改输入内容。现在插入文本后按 Escape 关闭建议，并验证内容长度。
4. **Cookie banner 遮挡**：模型切换后可能触发 cookie consent / 偏好中心弹窗，遮挡编辑器和提交按钮。新增 `dismissOverlays()` 独立函数，在发送消息前和模型切换后都会调用。
5. **`bbEval` shell 注入问题**：原来用 `execSync` 拼接字符串导致 `a[href]` 等选择器被 shell 解释。改用 `spawnSync` 传数组参数绕过 shell。

### 验证结果
全部 7 项功能测试通过：Expert/Fast/Heavy 模型问答、继续对话、管道输入、历史记录、关键词恢复、文件输出。

---

## 任务：补齐 CEO Playbook 状态查阅与干预 curl 指南

**状态**: ✅ 已完成
**日期**: 2026-04-07

### 概要
遵照指令要求，对 `src/lib/agents/ceo-environment.ts` 和系统内真实工作区的 `ceo-playbook.md` 中的 `Step 0: 快速通道` 进行了重写。明确加入了通过纯 Restful API（基于 `curl`）执行项目状态查询（`antigravity_list_projects`）和执行干预（`antigravity_intervene_run`）的实际代码范例，防止 MCP 未启用时 CEO Agent 不知所措。

### 改动
1. **`src/lib/agents/ceo-environment.ts`**：
   - 丰富了「A. 状态查询」的 `curl` 示例，指示读取 `/api/projects` 接口
   - 丰富了「B. 干预操作」的 `curl` 示例，指示发送 action 到 `/api/agent-runs/<runId>/intervene`
2. **`~/.gemini/antigravity/ceo-workspace/.agents/workflows/ceo-playbook.md`**：同步更新一致。

---

## 任务：CEO 管理中心 — 右侧面板升级为多 Tab 管理视角

**状态**: ✅ 已完成
**日期**: 2026-04-07

### 概要
将 CEO Office 右侧面板从原来仅有 Persona/Playbook 两个文本编辑 Tab 的「配置面板」，升级为包含 **仪表盘、模板工坊、项目速览、配置** 四个 Tab 的「CEO 管理中心」。CEO 在左侧进行对话的同时，可在右侧快速切换管理视角，无需离开 CEO 面板。

### 改动
1. **`src/components/ceo-office-settings.tsx`**：
   - 新增 `CeoOfficeSettingsProps` 接口，接收 `workspaces`、`projects`、`departments`、`templates` 等管理数据
   - 顶级 Tabs 改为 4 个：「仪表盘」（嵌入 `CEODashboard`）、「模板」（嵌入 `TemplateBrowser`）、「项目」（项目运行态卡片速览 + 进度条）、「配置」（原 Persona/Playbook 被收纳为二级 Tab）
   - 项目 Tab 包含 4 格统计（进行中/已完成/失败/暂停）+ 按状态分组的项目卡片列表，点击可跳转到 OPC 项目详情

2. **`src/app/page.tsx`**：
   - `<CeoOfficeSettings />` 调用处新增 props 透传：`workspaces`、`projects`、`departments`、`templates`、`onDepartmentSaved`、`onNavigateToProject`、`onOpenScheduler`、`onRefresh`

3. **`src/components/projects-panel.tsx`**：
   - 移除 `CEODashboard` 组件嵌入（空态 + 列表态两处）
   - 移除 `TemplateBrowser` 组件及模板工坊 toggle（`browseView` 状态 + 切换按钮）
   - 清理未使用的 imports：`TemplateBrowser`、`CEODashboard`、`Layers` icon、`browseView` state
   - OPC 面板现在只聚焦项目列表和项目详情

### 验证
- TypeScript 编译：三个文件零错误

---

## 任务：CEO Chat Window 专属会话入口与配置门户

**状态**: ✅ 已完成
**日期**: 2026-04-07

### 概要
彻底移除了前端历史遗留的 CEO "顶部指令栏" (`api.ceoCommand`) 的同步阻塞式调用模式，在 UI 的侧边栏重构出了全新的 **CEO Office 专属房间**。该入口不仅复用了底层的 Conversation 并发与历史记录机制，更创新性地增加了纯原生的「配置大屏」，可以允许用户边聊天边修改 CEO 的记忆和派发管线逻辑。

### 预期改动
1. **清理遗留系统**：移除了 `src/components/ceo-dashboard.tsx` 以及 `projects-panel.tsx` 中涉及快捷指令框的所有代码和冗余状态。
2. **新增配置侧边栏**：开发了全新的 `src/components/ceo-office-settings.tsx`，与底层的 `src/app/api/ceo/setup/route.ts` API 进行双工通讯，实时渲染并高频热更新位于 `~/.gemini/antigravity/ceo-workspace/` 内部的 `department-identity.md` (Persona) 和 `ceo-playbook.md` (Playbook) 文件。
3. **集成进布局逻辑**：拓展 `SidebarSection` 类型，新增了 `ceo` 枚举。利用已有的 `page.tsx` Chat WebSocket 机制，只要用户从左侧导航栏点击「👔 CEO Office」，系统即可使用原有的 `handleSelect(ceoConv.id)` 机制自动吸附并载入该 Workspace 的活跃回话；在页面布局上采用了纯左右两栏（左边流式会话界面、右手边配置大屏界面）分离模式，彻底贯彻了 CEO "开箱即用 + 配置驱动"的产品哲学。

### 验证
- ✅ 编译通过，Sidebar / page.tsx 中对新模块的路由与 React Hooks 生命周期已完美对接。
- ✅ 取消历史的 `api.ceoCommand` 调用使得之前 404 的问题从源头上被瓦解。

---

## 任务：CEO 原生化：实现跨 Provider 的统一会话底层支持

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
开始实施“CEO 原生化：极简落地架构”设计。不新增复杂的专属中间件，而是将系统底层的 Conversation Router (`src/app/api/conversations/[id]/send/route.ts`) 升级为跨 Provider 支持（解耦 IDE gRPC 强依赖）。然后通过建立原生的 CEO Workspace 资产，使 CEO Agent 成为一个标准的 Department，并利用通用的会话链路通过 MCP 工具调度系统。

### 预期改动
1. **CEO 工作区搭建**：剥离旧的硬编码环境搭建逻辑，在 `src/lib/agents/ceo-environment.ts` 集中创建 `.department` 控制文件以及制定人设 (`ceo-mission.md`) 和操作流 (`ceo-playbook.md`)。
2. **底层路由修改**：修改 `conversations/[id]/send` 接口以侦测 provider，支持 `codex` 的子进程通讯以彻底根除 IDE 依赖死穴。
3. **前端接驳与收口**：调整现有 UI 可选择连入 CEO 空间，同时弃用 `ceo-prompts.ts` 的命令构建器。
4. **根除 IDE 上下文污染 (IDE Context Poisoning)**：此前曾尝试用 `grpc.addTrackedWorkspace` 把 CEO 工作区附加到现存任意活动的 IDE Server (例如 `fishairss`) 上，或使用离线的 `codex` 原生提供绕行方案。但这偏离了“标准的 Conversation 新建链路”。
5. **恢复原生 Workspace 处理逻辑**：已移除所有对 CEO 工作区的特殊硬编码与强制 Codex/追踪截断逻辑。在 `src/app/page.tsx` 中新增调度，当通过 Command Bar 呼叫 CEO 且对应系统不在运行中时（`workspace_not_running`），则**使用标准架构一样的 `/api/workspaces/launch` 触发**。这将原生启动 `antigravity --new-window` 拉起 CEO 项目专用的 IDE 窗口。
6. **实现完美上下文隔离**：通过上述改动，CEO 工作区不仅完美继承了原始界面的新建 Conversation 逻辑，同时因为开辟了独立的 IDE 工作区后端，也天然隔绝了跟其它活动窗口产生交叉污染的可能，实现了符合用户预期的完美上下文隔离。

---

## 任务：审阅 CEO 原生化与统一会话引擎设计

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
按要求对 `docs/design/ceo-native-conversation-design.md` 做了架构审阅，并结合真实实现逐项核对以下源码：
- `src/lib/agents/ceo-agent.ts`
- `src/lib/agents/llm-oneshot.ts`
- `src/lib/agents/dispatch-service.ts`
- `src/lib/agents/department-memory.ts`
- `src/lib/agents/department-sync.ts`
- `src/lib/providers/types.ts`

本次输出结论为：**设计方向正确，但需要在“现状边界、无 IDE 路径、受控治理层、会话抽象”四个方面收口后再进入实施。**

### 产出
- 新增审阅报告：`docs/design/ceo-design-review.md`
- 报告覆盖五个维度：
  - 现状准确性
  - 方案可行性
  - Group Elimination 兼容性
  - 架构完整性
  - 三个决策点推荐（A/B/C）

### 关键结论
- 当前 `ceo-agent.ts` / `llm-oneshot.ts` / `dispatch-service.ts` 的主链路与设计文档描述大体一致。
- `ceo-workspace` 初始化能力已经以 `getCEOWorkspacePath()` 形式存在，Phase 1 不应重复造轮子。
- `department-memory.ts` 目前是 Markdown 持久化与 run 完成后的简易提取，不等于完整的会话记忆系统。
- `TaskExecutor` 当前不足以直接承载 `chat-runtime.ts` 所需的会话生命周期与流式 `ChatStep` 抽象。
- 推荐采用：
  - 决策边界：**C 混合模式**
  - 无 IDE 优先级：**C 分层落地**
  - 前端形态：**C 混合入口**

### 验证
- 静态核对：逐文件比对设计文档与实现，确认 CEO 路径、Provider 能力、dispatch 契约、memory/rules 能力边界。
- 输出校验：确认审阅报告文件已写入并包含要求的四类结构（通过项、风险项、建议修改项、三个决策点推荐）。
- 仓库检查：执行 `git diff --check`，结果：**通过**。
- 相关单测：执行 `node node_modules/vitest/vitest.mjs run --config vitest.review.config.mts src/lib/providers/providers.test.ts src/lib/providers/ai-config.test.ts`，结果：**2 个测试文件通过，26 个测试通过，0 失败**。
- 说明：仓库默认 `npm test -- ...` 会因现有 `vitest.config.ts` / Vite ESM 加载问题报 `ERR_REQUIRE_ESM`；本次未修复该无关问题，改用临时 ESM config 完成只读验证。

## Git Version Checkpoint: Phase 6 & Core Architecture Align

**状态**: ✅ 已完成
**日期**: $(date +%Y-%m-%d)

### 概要
按用户要求（"帮我 git 下版本，先 git 但是 不推"），对近期完成的所有开发工作进行统一的版本控制提交（Commit）。近期工作总结包括：
- Phase 6: CEO Agent LLM 决策引擎升级，改用 AI 替代硬编码规则引擎
- 架构调整：统一派发路径 `executeDispatch`，建立稳定的 CEO 和团队指派流程闭环
- OPC 组织治理和决策层重写，支持智能选择模板与组群
- 文档全面同步（Architecture, User Guide, API references 覆盖 Provider, Security, Scheduler 等）
- 界面 UI 调整与 BUG 修复（如：NativeSelect, QuickTaskInput, 路由恢复等）

### 执行动作
- 将工作区所有相关修改的文件添加至 Git 追踪（`git add .`）
- 进行了本地 commit 提交。根据要求，当前版本**尚未推送到远端服务器** (`git commit -m ...`)
# Project Progress

> 项目进度跟踪文档，每次任务完成后更新。

---

## 任务：完成 legacy-single AgentBackend 迁移与 watcher parity 收口

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
在 PromptExecutor 已经接入 `AgentBackend -> AgentSession -> session-consumer` 之后，继续把 template runtime 中最关键的单会话残留路径也收口到同一抽象，并补回 reviewer 指出的关键 watcher parity：`autoApprove`、文件轮询兜底完成、断线重连、owner 路由 cancel/append。同步落了默认 run hooks 与 MemoryHooks 骨架，并把相关行为全部锁成专项测试。

### 本次完成的关键改动
1. **新增默认 run hooks 与 MemoryHooks 骨架**
  - 新增 `src/lib/backends/run-session-hooks.ts`
  - 新增 `src/lib/backends/memory-hooks.ts`
  - `src/lib/backends/index.ts` 补充统一导出
2. **`prompt-executor.ts` 复用统一 hooks**
  - 接入 `applyBeforeRunMemoryHooks()`
  - 改用 `createRunSessionHooks()` 统一 started/live_state/failed/cancelled 的默认写回
  - 保留 Prompt finalization 的专属收口
3. **`group-runtime.ts` 的 `legacy-single` 正式接入 AgentBackend**
  - `legacy-single` 不再直接调用 `createAndDispatchChild() + startWatching()`
  - 改为 `getAgentBackend() -> start() -> registerAgentSession() -> consumeAgentSession()`
  - template run 创建时补齐 `executorKind: 'template'` 与 `executionTarget`
  - `cancelRun()` 优先走 session-registry
  - `nudge` 在命中活跃 session 时优先走 `session.append()`
4. **`builtin-backends.ts` 恢复并强化 Antigravity watcher parity**
  - `append/cancel` 改为按 owner connection 路由，不再退回“首个 server”
  - 恢复 `autoApprove` 逻辑（基于 `metadata.autoApprove`）
  - 恢复 artifact 文件轮询兜底完成
  - 恢复 watch stream 断线后的 owner map 刷新与重连
  - Codex backend 不再错误暴露 session append 能力
5. **测试补齐并更新**
  - `src/lib/agents/group-runtime.test.ts` 重写为 session 化 characterization tests
  - `src/lib/backends/builtin-backends.test.ts` 扩展到 9 条，覆盖 owner 路由、autoApprove、文件轮询兜底、断线重连
  - 新增 `src/lib/backends/memory-hooks.test.ts`
  - `src/lib/agents/prompt-executor.test.ts` 同步清理全局 MemoryHooks 注册表

### 当前效果
1. PromptExecutor 与 template `legacy-single` 已统一进入同一条 session runtime 主链。
2. 单会话 run 的 started/live_state/terminal 写回已经有可复用的默认 hooks。
3. Antigravity 单会话路径保留了旧 watcher 的关键运行语义，没有因为抽象迁移而行为缩水。
4. Codex 的 session 能力边界被重新锁清：可本地取消，但不暴露 session append。

### 验证证据
1. **builtin-backends parity 专项测试通过**
  - 执行：`npm test -- src/lib/backends/builtin-backends.test.ts`
  - 结果：`1` 个测试文件通过，`9` 个测试全部通过，`0` 失败。
2. **核心迁移测试通过**
  - 执行：`npm test -- src/lib/agents/prompt-executor.test.ts src/lib/agents/group-runtime.test.ts src/lib/backends/builtin-backends.test.ts src/lib/backends/memory-hooks.test.ts src/lib/backends/registry.test.ts src/lib/backends/session-registry.test.ts src/lib/backends/session-consumer.test.ts`
  - 结果：`7` 个测试文件通过，`30` 个测试全部通过，`0` 失败。
3. **扩展护栏测试通过**
  - 执行：`npm test -- src/lib/agents/prompt-executor.test.ts src/lib/agents/group-runtime.test.ts src/lib/agents/run-registry.test.ts src/lib/agents/watch-conversation.test.ts src/lib/backends/builtin-backends.test.ts src/lib/backends/memory-hooks.test.ts src/lib/backends/registry.test.ts src/lib/backends/session-registry.test.ts src/lib/backends/session-consumer.test.ts`
  - 结果：`9` 个测试文件通过，`36` 个测试全部通过，`0` 失败。
4. **生产构建通过**
  - 执行：`npm run build`
  - 结果：Next.js 生产构建完成。
5. **独立代码审查通过**
  - `Code-Review-subagent` 最终结论：`APPROVED`
  - 结论：本轮 5 条验收标准全部通过，无阻塞问题。

### 当前剩余的非阻塞项
1. Codex session handle 仍是合成值，若后续要开放真实多轮 reply，需要再与真实 thread handle 对齐。
2. MemoryHooks 目前已具备生命周期骨架，但尚未把 memoryContext 真正注入到底层执行提示中。

## 任务：完成 multi-role AgentBackend 迁移与 shared fallback 护栏收口

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
继续把 template runtime 中剩余的 multi-role 执行路径迁到统一的 `AgentBackend -> AgentSession -> session-consumer` 主链。本轮完成了 `delivery-single-pass` 与 `review-loop` isolated 路径迁移，同时明确保留 shared conversation 的旧 gRPC fallback，并补齐 runtime 级 characterization tests 来锁住 shared fallback、delivery/review 的非完成态传播，以及 codex nudge 边界。

### 本次完成的关键改动
1. **`group-runtime.ts` 新增统一的角色级 session 执行 helper**
  - 新增 `executeRoleViaAgentSession()`
  - 新增 `RoleSessionExecutionOptions` / `RoleSessionExecutionResult`
  - 新增 `updateRoleProgressByConversation()` 与角色级结果归一化逻辑
2. **`delivery-single-pass` 正式迁到 AgentBackend 主链**
  - `executeDeliverySinglePass()` 不再直接 `createAndDispatchChild() + watchUntilComplete()`
  - 改为通过角色级 session helper 执行单角色 delivery
  - 保留 supervisor 启动、artifact/finalization、pipeline auto-trigger 语义
3. **`review-loop` isolated 路径正式迁到 AgentBackend 主链**
  - isolated author / reviewer 角色改走 `executeRoleViaAgentSession()`
  - 保留 round/role progress、decision extraction、policy override、revise loop 语义
  - shared conversation 复用作者对话的分支显式保留旧 `grpc.sendMessage + watchUntilComplete()` fallback，不强行混进 session 主链
4. **multi-role 非完成态传播收口**
  - `terminalKind !== completed` 时显式走 `propagateTermination()`
  - `completed` 但 `result.status !== completed` 时也显式终止，不再误继续提取 decision 或 finalize success
5. **测试补齐并加固**
  - 新增 `src/lib/agents/group-runtime.multi-role.test.ts`
  - 覆盖 delivery happy path
  - 覆盖 review-loop isolated 的 revise -> approved 双轮路径
  - 覆盖 shared conversation 旧 fallback 的 runtime 路径
  - 覆盖 delivery failed / blocked 终态传播
  - 覆盖 review-loop failed / blocked 终态传播
  - 覆盖 codex session 不支持 nudge append 的边界

### 当前效果
1. Prompt、legacy-single、delivery-single-pass、review-loop isolated 四条执行主链已经统一进入 AgentBackend/session 模型。
2. shared conversation 仍保留为显式旧 fallback，而不是被新抽象误吞掉。
3. multi-role runtime 在 failed / blocked 等非完成终态下已经会及时停止链路并传播终态，不会继续错误 finalize。
4. multi-role 迁移后的关键行为现在有 runtime 级测试证据，而不只是静态代码判断。

### 验证证据
1. **multi-role 专项测试通过**
  - 执行：`npm test -- src/lib/agents/group-runtime.multi-role.test.ts`
  - 结果：`1` 个测试文件通过，`8` 个测试全部通过，`0` 失败。
2. **完整迁移测试集通过**
  - 执行：`npm test -- src/lib/agents/prompt-executor.test.ts src/lib/agents/group-runtime.test.ts src/lib/agents/group-runtime.multi-role.test.ts src/lib/agents/run-registry.test.ts src/lib/agents/watch-conversation.test.ts src/lib/backends/builtin-backends.test.ts src/lib/backends/memory-hooks.test.ts src/lib/backends/registry.test.ts src/lib/backends/session-registry.test.ts src/lib/backends/session-consumer.test.ts`
  - 结果：`10` 个测试文件通过，`45` 个测试全部通过，`0` 失败。
3. **生产构建通过**
  - 执行：`npm run build`
  - 结果：Next.js 生产构建完成。
4. **独立代码审查通过**
  - `Code-Review-subagent` 最终结论：`APPROVED`
  - 结论：delivery-single-pass、review-loop isolated、shared fallback、non-completed terminal propagation 均已满足验收标准，无阻塞问题。

### 当前剩余的非阻塞项
1. multi-role runtime 目前显式锁住了 failed / blocked 终态；cancelled / timeout 仍主要依赖共享传播分支，后续可继续补两条 runtime 级 characterization tests。
2. multi-role 路径还没有像 prompt / legacy-single 一样完全复用 `run-session-hooks.ts` 的 afterRun MemoryHooks 桥，后续若要让 MemoryHooks 真正统一生效，需要继续收口这一层。

## 任务：整理 AgentBackend 事件架构剩余缺口清单

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
围绕“整个运行时换成新的 event 架构后，还剩哪些没有完成”这个问题，对当前 Prompt、legacy-single、multi-role、shared conversation、intervention、MemoryHooks 和 session 基础设施做了一次结构化收口，并把结果写成仓库内本地文档，避免后续继续用口头状态判断“到底是不是已经全部迁完”。

### 产出
1. 新增文档：`docs/design/agent-backend-event-architecture-gap-checklist.md`

### 关键结论
1. **主 dispatch path 已基本迁完**：Prompt、legacy-single、delivery-single-pass、review-loop isolated 都已经进入 AgentBackend / AgentSession / session-consumer 主链。
2. **真正未完成的是边缘路径和生命周期收口**：shared conversation 仍是旧 fallback；nudge / restart_role / evaluate 仍有旧 transport；multi-role 还未完全复用 run-session-hooks；MemoryHooks 仍只是骨架。
3. **下一步最稳的顺序不是继续扩主链，而是先收 intervention 和 hooks**：先迁 nudge / restart_role / evaluate，再统一 multi-role hooks，再决定 shared conversation 是否继续 session 化。

### 说明
1. 本次为结构化本地文档沉淀，没有新增运行时代码。
2. 文档中已经把“已完成主链”“明确未迁移路径”“半接通能力”“测试矩阵缺口”“推荐迁移顺序”五部分分开，便于后续直接按阶段推进。

## 任务：澄清事件架构迁移收尾与 transport 下沉的任务边界

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
针对“把剩余旧路径也迁完”和“把 grpc 等 transport 从 group-runtime 抽到底层”这两件事是否属于同一任务，继续对事件架构缺口清单做了一次边界澄清，避免后续把功能迁移收尾和结构净化混成一个阶段，导致优先级和验收口径反复摇摆。

### 关键结论
1. **把剩余旧路径迁完** 属于当前 AgentBackend / AgentSession 迁移任务的收尾，不应再被视为“可选尾巴”。
2. **把 grpc / owner / trajectory 等 transport 细节从 group-runtime 下沉到底层** 是相关但独立的第二任务，更准确的目标层应是 backend / transport adapter，而不是笼统说成 Provider。
3. **正确顺序是先功能收尾，再结构净化**：先让 shared fallback、nudge fallback、restart_role、evaluate 不再作为旧入口残留；再继续把 transport 细节从 orchestration 层抽走。

### 产出
1. 更新文档：`docs/design/agent-backend-event-architecture-gap-checklist.md`

### 说明
1. 本次为任务边界澄清与本地文档更新，没有新增运行时代码。
2. 文档中已新增“任务边界澄清”章节，明确区分 `任务 A：现有功能全部迁完` 与 `任务 B：transport 下沉与 group-runtime 净化`。

## 任务：完成剩余功能级旧入口迁移并收掉 cancel fallback 残留

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
继续完成此前定义的 `任务 A：现有功能全部迁完，不留旧入口`。本轮把 shared conversation、nudge、restart-role、evaluate 和 unattached cancel 的最后功能级残留全部换到统一的 AgentBackend / AgentSession 主链，并清掉 `group-runtime.ts` 中最后一条直接 `grpc.cancelCascade()` 执行入口。

### 本次完成的关键改动
1. **shared conversation 不再保留旧执行入口**
  - 复用作者对话改为 `executeAttachedRoleViaAgentSession()`
  - 底层通过 attach 既有 handle 的 AgentSession + append 完成
2. **`interveneRun('nudge')` 完成彻底 session 化**
  - 除活跃 session 直接 append 外，旧的 grpc nudge fallback 已改为 attached session 路径
3. **`interveneRun('restart_role')` 完成彻底 session 化**
  - 不再重新走 `createAndDispatchChild` / watcher 旧链路
  - 改为正常新建 AgentSession，并在 session ready 后清理旧 handle
4. **`interveneRun('evaluate')` 完成执行链路 session 化**
  - evaluate 不再手工 `startCascade + sendMessage + polling completion`
  - 改为一次性 supervisor AgentSession
  - 当前只保留 recent steps 的读取和 annotation 写回，作为 Task B 的结构残留
5. **`cancelRun()` 收掉最后一个功能级 transport fallback**
  - 在无活跃 session 但已有 handle 的场景下，改为 backend attach + session.cancel
  - `group-runtime.ts` 不再直接调用 `grpc.cancelCascade()` 作为功能入口
6. **补 attach 合同与测试护栏**
  - `CodexAgentBackend` 增加轻量 attach 支持，满足 cancel 场景
  - `group-runtime.test.ts` 扩展 intervention / cancel characterization tests
  - `builtin-backends.test.ts` 扩展 attach 测试到 Antigravity + Codex

### 当前效果
1. `group-runtime.ts` 中已经没有 `createAndDispatchChild`、`watchUntilComplete`、`grpc.startCascade`、`grpc.sendMessage`、`grpc.cancelCascade` 这些旧执行入口。
2. 当前“现有功能是否还在走旧入口”这个问题，答案已经是否。
3. 剩余未做的是 `任务 B：transport 下沉与 group-runtime 净化`，不再是功能迁移未完成。

### 验证证据
1. **关键 attach / cancel 护栏测试通过**
  - 执行：`npm test -- src/lib/agents/group-runtime.test.ts src/lib/backends/builtin-backends.test.ts`
  - 结果：`2` 个测试文件通过，`20` 个测试全部通过，`0` 失败。
2. **完整迁移测试集通过**
  - 执行：`npm test -- src/lib/agents/prompt-executor.test.ts src/lib/agents/group-runtime.test.ts src/lib/agents/group-runtime.multi-role.test.ts src/lib/agents/run-registry.test.ts src/lib/agents/watch-conversation.test.ts src/lib/backends/builtin-backends.test.ts src/lib/backends/memory-hooks.test.ts src/lib/backends/registry.test.ts src/lib/backends/session-registry.test.ts src/lib/backends/session-consumer.test.ts`
  - 结果：`10` 个测试文件通过，`50` 个测试全部通过，`0` 失败。
3. **生产构建通过**
  - 执行：`rm -rf .next && npm run build`
  - 结果：Next.js 生产构建完成。

### 当前剩余的非阻塞项
1. `group-runtime.ts` 仍直接读取 `grpc.getTrajectorySteps()` 和 `grpc.updateConversationAnnotations()`，这属于 Task B 的 transport 下沉，不再属于功能级旧入口残留。

## 任务：统一 multi-role afterRun MemoryHooks 生命周期

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
此前 prompt / legacy-single 路径通过 `createRunSessionHooks` 自动在 terminal event 后调用 `applyAfterRunMemoryHooks()`，但 multi-role 的 `consumeTrackedRoleAgentSession()` 是手写 sessionHooks，不调用 afterRun memory hooks。这导致 MemoryHooks 的 `afterRun` 生命周期在 multi-role 路径上断开，后续若要让记忆系统真实生效，multi-role 的执行结果不会进 memory 链。

### 本次完成的关键改动
1. **`consumeTrackedRoleAgentSession` 补齐 afterRun 调用**
  - 在 completed / failed / cancelled 三个 terminal event 分支中，统一调用 `applyAfterRunMemoryHooks()`
  - 通过 `buildRoleBackendConfig` 构建与 beforeRun 对称的 backendConfig，传入 afterRun hooks
  - 新增 `applyAfterRunMemoryHooks` import
2. **测试护栏**
  - 在 `group-runtime.multi-role.test.ts` 中新增 `calls afterRun memory hooks for each completed role session in review-loop` 用例
  - 注册一个 spy memory hook，验证 review-loop 中 author + reviewer 两个角色各触发一次 afterRun
  - 9/9 multi-role 测试通过

### 验证证据
1. **multi-role 专项测试通过**
  - 执行：`npm test -- src/lib/agents/group-runtime.multi-role.test.ts`
  - 结果：9 个测试全部通过，0 失败
2. **完整迁移测试集通过**
  - 执行：`npm test -- src/lib/agents/prompt-executor.test.ts src/lib/agents/group-runtime.test.ts src/lib/agents/group-runtime.multi-role.test.ts src/lib/agents/run-registry.test.ts src/lib/agents/watch-conversation.test.ts src/lib/backends/builtin-backends.test.ts src/lib/backends/memory-hooks.test.ts src/lib/backends/registry.test.ts src/lib/backends/session-registry.test.ts src/lib/backends/session-consumer.test.ts`
  - 结果：10 个测试文件通过，51 个测试全部通过，0 失败

### 当前效果
- prompt / legacy-single / multi-role 三条路径的 afterRun MemoryHooks 生命周期已经统一
- MemoryHooks 本身仍是骨架（memoryContext 还没有真正进入执行提示），但生命周期管道已经打通

## 任务：分析 CEO 原生创建 cron 能力的现状与差距

**状态**: ✅ 已完成
**日期**: 2026-04-08

### 概要
围绕“CEO 应该具备创建 cron 的能力，而不是依赖用户直接配置”这个问题，对当前仓库的前端交互、Scheduler 后端、CEO Command 链路、MCP 工具层和既有设计文档做了交叉分析，目标是判断：问题到底是没有 scheduler，还是 scheduler 没有被产品化成 CEO 能力。

### 关键结论
1. **Scheduler 基础设施已经完整**：`src/lib/agents/scheduler.ts` 与 `/api/scheduler/jobs*` 已具备 create/list/update/delete/trigger 主链路，不是“没有 cron 能力”。
2. **当前真正缺的是 CEO 原生能力层**：CEO Dashboard 只能查看最近 jobs 并跳转到 Scheduler 面板，没有直接创建动作；CEO Command / MCP 也没有 create scheduler job 的能力。
3. **当前创建交互仍是技术参数表单**：`src/components/scheduler-panel.tsx` 直接要求用户填写 `Cron Expression`、`Workspace`、`Prompt`、`Department Workspace URI`、`Task Goal` 等底层字段，说明产品仍在让用户替系统做对象建模。
4. **问题已经在文档中被识别，但实现没有跟上**：`delivery/ceo-memo-context-and-scheduler.md` 已明确提出“把 Scheduler 抬到 CEO 主视角”和“从 CEO 自然语言命令直接创建 scheduler job”的方向，但仓库实现尚未落地。
5. **根问题是架构分层断开**：Scheduler 被实现成运行时基础设施，CEO 被实现成 one-shot 决策派发器，中间缺少“经营意图 → 调度对象”的翻译层。

### 产出
- 新增分析文档：`docs/design/ceo-cron-capability-gap-analysis.md`

### 验证依据
- 前端入口与表单：`src/components/ceo-dashboard.tsx`、`src/components/ceo-office-settings.tsx`、`src/components/scheduler-panel.tsx`
- 后端调度：`src/lib/agents/scheduler.ts`、`src/lib/agents/scheduler-types.ts`
- API：`src/app/api/scheduler/jobs/route.ts`、`src/app/api/scheduler/jobs/[id]/route.ts`、`src/app/api/scheduler/jobs/[id]/trigger/route.ts`
- CEO 与事件流：`src/app/api/ceo/command/route.ts`、`src/lib/ceo-events.ts`
- MCP 与设计文档：`src/mcp/server.ts`、`delivery/ceo-memo-context-and-scheduler.md`、`docs/design/ceo-native-conversation-design.md`

### 说明
- 本次为只读分析与本地文档沉淀，没有修改业务代码。
- 分析结论已经收口为一句话：**现在的 Scheduler 是“系统能跑”，不是“CEO 能用”。**

## 任务：补充 craft-agents 中 PiAgent 与 provider 路由研究文档

**状态**: ✅ 已完成
**日期**: 2026-04-07

### 概要
在上一轮静态源码分析的基础上，继续把用户最关心的歧义点彻底收口：
1. **非 Anthropic API 是否会经过 Claude Agent SDK**
2. **PiAgent 是否是在把第三方 provider 的响应“翻译成 Claude 风格”**
3. **PiAgent 在 Craft 架构中的真实职责是什么**

### 关键结论
1. **非 Anthropic API 当前基本走 PiAgent，而不是 ClaudeAgent**：`providerType = anthropic` 才会落到 ClaudeAgent；`pi` 与 `pi_compat` 都会映射到 PiAgent。
2. **PiAgent 不是在 Craft 层把所有 provider 的原始响应转换成 Anthropic message 协议**：它更准确的职责是把 Pi SDK / `pi-agent-server` 的事件流适配到 Craft 自己统一的 `AgentEvent`。
3. **“Claude 风格”只在局部 UI 兼容层成立**：`PiEventAdapter` 的确会把部分工具字段整理成接近 Claude Code 展示层的形状，但这不等于整个底层协议都被转成 Claude API。
4. **README 与当前实现存在一处值得警惕的偏差**：README 里对 third-party endpoints 的描述更像“继续走 Claude backend”，但当前代码实际会把 custom endpoint / `baseUrl` 路由到 `pi_compat`，最终进入 PiAgent。

### 产出
- 新增研究文档：`docs/internals/craft-agents-provider-routing-and-pi-agent-study.md`

### 验证依据
- 双 backend 与 provider 分流：`craft-agents-oss/packages/shared/src/agent/backend/factory.ts`
- Claude backend：`craft-agents-oss/packages/shared/src/agent/claude-agent.ts`
- Pi backend：`craft-agents-oss/packages/shared/src/agent/pi-agent.ts`
- Pi 子进程与真实 provider session：`craft-agents-oss/packages/pi-agent-server/src/index.ts`
- 事件适配：`craft-agents-oss/packages/shared/src/agent/backend/pi/event-adapter.ts`、`craft-agents-oss/packages/shared/src/agent/backend/claude/event-adapter.ts`
- 连接保存与 compat 路由：`craft-agents-oss/packages/server-core/src/handlers/rpc/llm-connections.ts`
- README 对照：`craft-agents-oss/README.md`

### 说明
- 本次为本地研究文档写作，没有修改 craft-agents-oss 源码。
- 未运行测试；结论基于静态源码交叉核对与研究子代理结果复核。

### 追加更新
- 根据后续指示，已继续补充“完整时序图”到 `docs/internals/craft-agents-provider-routing-and-pi-agent-study.md`
- 时序图覆盖四段：连接创建、session 创建与 backend 选择、Claude 路径、Pi 路径与统一事件落盘
- 已继续补充 `PiEventAdapter` 的事件映射表与字段重写表，单独拆开“事件统一”和“Claude 风格兼容”两个层次，避免把 UI 兼容误解为底层协议转换
- 已继续补充 `Claude SDK` 路径与 `Pi SDK` 路径的对比节，从协议控制权、认证方式、事件适配复杂度和产品定位四个维度解释为什么两条链路并存
- 已继续补充 `ClaudeEventAdapter` 与 `PiEventAdapter` 的对照节，明确“Claude 更偏原生 message 直译，Pi 更偏兼容 runtime 归一化”

## 任务：分析 craft-agents 的 Claude SDK / 第三方 API / Workspace 架构

**状态**: ✅ 已完成
**日期**: 2026-04-07

### 概要
对 workspace 中的 craft-agents-oss 仓库进行了静态源码分析，重点核对三件事：
1. 它如何一边接入 Claude Agent SDK，一边兼容第三方模型与第三方 API。
2. 第三方兼容是否真的完全走 Claude backend，还是通过独立 provider backend 分流。
3. 它的 workspace 是否本质上以文件夹为根，接近 IDE / Obsidian 风格。

### 关键结论
1. **不是“用一个 SDK 兼容全部”**：craft-agents 的核心做法是双后端架构，`ClaudeAgent` 负责 Anthropic / Claude 路径，`PiAgent` 负责 Google、OpenAI/Codex、GitHub Copilot 以及兼容端点路径。
2. **Provider 抽象是关键**：`providerType` 决定使用哪个 backend，`anthropic -> ClaudeAgent`，`pi / pi_compat -> PiAgent`，从而把 Claude SDK 与其他 provider 解耦。
3. **第三方兼容存在“文档与实现不完全一致”**：README 说明第三方 endpoint 可通过 Claude backend，但当前连接保存逻辑中，只要配置 custom endpoint / baseUrl，通常会被归一到 `pi_compat`，也就是实际转到 Pi backend。
4. **Workspace 本质上是按文件夹组织**：服务端明确是“Obsidian-style: folder IS the workspace”；session 数据也直接存放在 `{workspaceRootPath}/sessions/{id}` 下。
5. **同时还有全局注册层**：`~/.craft-agent/config.json` 负责登记 workspace 列表与激活状态，`~/.craft-agent/workspaces/{id}` 还承载部分补充性 workspace 数据（如 conversation / plan），但不是主工作目录本体。

### 验证依据
- 文档与说明：`craft-agents-oss/README.md`
- CLI 连接与 workspace 引导：`craft-agents-oss/apps/cli/src/index.ts`
- Backend 工厂与 provider 解析：`craft-agents-oss/packages/shared/src/agent/backend/factory.ts`
- Claude backend：`craft-agents-oss/packages/shared/src/agent/claude-agent.ts`
- Pi backend：`craft-agents-oss/packages/shared/src/agent/pi-agent.ts`
- Pi 子进程服务：`craft-agents-oss/packages/pi-agent-server/src/index.ts`
- LLM connection 配置与 auth env 解析：`craft-agents-oss/packages/shared/src/config/llm-connections.ts`
- workspace / session 存储：`craft-agents-oss/packages/shared/src/workspaces/storage.ts`、`craft-agents-oss/packages/shared/src/sessions/storage.ts`

### 说明
- 本次为静态代码审阅，没有修改 craft-agents-oss 业务代码。
- 未运行集成测试；结论基于 README、CLI、server-core、shared agent/backend 与 storage 代码交叉核对。

## 任务：分析 React 前端 OPC CEO 页面用户旅程关键差距

**状态**: ✅ 已完成
**日期**: 2026-04-07

### 概要
对当前 React 前端中的 CEO Office / OPC 相关页面做了静态旅程审查，交叉核对了真实入口、通知机制、项目工作台、CEO 决策面板以及历史设计文档。结论是：当前 CEO 旅程已经具备基础聊天、项目查看和配置能力，但仍存在 5 个会直接影响决策效率的关键差距，且其中一部分与旧文档“已全部修复”的表述不再一致。

### 关键差距
1. **全局 CEO 命令入口缺位**：仓库中仍保留 `GlobalCommandBar` / `QuickTaskInput` 组件，但主页面当前没有挂载；实际 Header 仅保留通知和工具按钮，导致“随时一句话派发任务”的旅程在现状中断开。
2. **CEO Office 与 OPC 项目页是割裂的双入口**：CEO 在 CEO Office 右侧仪表盘或项目 Tab 点击项目后，会被直接切换到 OPC 项目页，无法在同一工作面内连续完成“对话 → 监控 → 干预 → 返回对话”。
3. **全局事件感知不完整**：Header 的 `generateCEOEvents(projects, [])` 没有带入 stage 维度，导致顶层事件流主要基于项目状态，缺少 stage/gate 之外的执行态细节；`needs_decision` 也没有成为一级全局事件。
4. **CEO 决策入口埋在项目详情深处**：`ceoDecision` 和 `needs_decision` 的可操作 UI 主要存在于 `projects-panel.tsx` 的详情态，CEO 若停留在 CEO Office 会话页，不会获得统一的待决策工作台。
5. **运行监控闭环不足**：Header 的 Runs Drawer 只展示 active runs，没有把“最近完成 / 最近失败 / 下一步建议”串回 CEO 的监控流；CEO 仍需手动跳项目、跳详情才能形成完整判断。

### 验证
- 静态核对：`src/app/page.tsx`、`src/components/ceo-office-settings.tsx`、`src/components/ceo-dashboard.tsx`、`src/components/projects-panel.tsx`、`src/components/project-workbench.tsx`、`src/components/notification-indicators.tsx`、`src/lib/ceo-events.ts`
- 文档对照：`docs/opc-interaction-design-v2.md`、`docs/user-journey-gaps.md`
- 结论依据：通过源码阅读和关键词回扫确认当前实际挂载关系、导航跳转、事件来源与决策入口分布；本次为前端静态分析，无运行时代码改动

## 任务：创建本地 Git 快照提交（不 push）

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
按用户要求，对当前仓库工作区创建一次**仅本地保存**的 Git 提交快照，便于后续通过 commit hash、`git log`、`git show`、`git checkout <commit>` 或新分支回溯当前版本。

### 范围
- 本次提交覆盖当前仓库内已追踪和新建的代码、文档、模板、测试与脚本改动。
- **不包含仓库外文件**，例如 `~/.gemini/antigravity/global_workflows/`、`~/.gemini/antigravity/skills/` 等 home 目录资产，因为它们不在当前 Git 仓库中。

### 说明
- 当前分支：`main`
- 操作方式：本地 `git add` + `git commit`
- 不执行 `git push`

### 验证
- 提交前确认当前分支与工作区状态
- 提交后通过 `git rev-parse HEAD` / `git log -1 --oneline` 确认 commit 已落地
- 通过 `git status --short --branch` 确认工作区已收敛

## 任务：复核并修正 `ARCHITECTURE.md` 的 stage-centric 说明

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
对 `ARCHITECTURE.md` 按 Group Elimination 终态做了专项复核，并修正文档中少量仍会误导读者的旧口径：
1. **系统全景与模块图收口**：将顶层 `Agent Engine` 明确标注为“Stage Runtime (`group-runtime.ts`)”，避免读者把当前运行时理解成对外 Group 语义。
2. **Provider 层说明收口**：补充说明 `group-runtime.ts` 只是 legacy 文件名，当前承载的是 stage-centric 的 Stage Runtime。
3. **CLI 架构段更新**：将 `dispatch --template` 改为当前真实用法 `dispatch <templateId> [--stage <stageId>]`，并同步更新辅助 CLI 表。
4. **目录结构注释同步**：`src/lib/agents/` 的目录说明从笼统的 `group-runtime + registry + asset-loader + review` 改为 `Stage Runtime (group-runtime.ts) + registry + asset-loader + review`。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `ARCHITECTURE.md` | 修正 Agent Engine / Provider / CLI / 目录结构中的旧口径，统一到 stage-centric 终态 |

### 验证
- 关键字回扫：
  - `rg -n -- '--template|group-runtime|Agent Engine<br/>Stage Runtime|Stage Runtime 角色执行|dispatch <templateId>|stageId|/api/agent-groups|dispatch-group|acceptedSourceGroupIds|group-registry|loadAllGroups' ARCHITECTURE.md`
  - 结果：仅保留合理的 `group-runtime.ts` 文件名引用；CLI 和架构说明已收口到 `templateId + stageId`。
- 旧接口残留检查：
  - `rg -n "agent-groups|dispatch-group|groupId|--template|templateId \\| Pipeline 模板|stageId \\|" ARCHITECTURE.md`
  - 结果：无命中。
- 仓库静态检查：
  - `git diff --check`
  - 结果：通过。

### 结论
- `ARCHITECTURE.md` 现在和当前实现是一致的。
- 文档里仍出现 `group-runtime.ts` 仅表示**文件名仍未重命名**，不再表示对外存在 Group 派发语义。

## 任务：复核 `skills` 目录中的 runtime 契约残留

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
对 `~/.gemini/antigravity/skills/` 做了针对运行时契约的全文复核，重点确认 skill 文档是否仍绑定旧的 Group / Gateway API 语义：
1. **`SKILL.md` 正文无 runtime 契约残留**：没有发现 `groupId`、`templateId`、`stageId`、`/api/agent-runs`、`/api/projects`、`sourceRunIds`、`pipelineStageIndex`、`dispatch-group`、`/api/agent-groups` 等字段或接口说明。
2. **技能目录整体不需要迁移**：当前 skills 更像方法论与执行技能说明，不直接承载 Gateway dispatch / project / run 协议。
3. **唯一命中的 `browser-testing` 不是问题**：它在 `SKILL.md` 中出现的 `http://localhost:3000` 只是本地 Web 应用测试示例 URL，不依赖 Antigravity runtime 或 `templateId + stageId` 契约。
4. **源码和数据文件中的 `dispatch` 命中也不是问题**：例如 `docx/scripts/accept_changes.py` 的 UNO dispatcher、`ui-ux-pro-max` 数据文件中的 `dispatch` 文本，都与 Gateway 调度完全无关。

### 验证
- Skill 文档契约扫描：
  - `rg -n "groupId|templateId|stageId|/api/agent-runs|/api/projects|projectId|runId|sourceRunIds|pipelineStageIndex|acceptedSourceStageIds|acceptedSourceGroupIds|dispatch-group|/api/agent-groups|resume|intervene" ~/.gemini/antigravity/skills/*/SKILL.md`
  - 结果：无命中。
- 泛化运行时关键词扫描：
  - `rg -n "localhost:3000|localhost:3000|file:///|Active Workspace|Project|Supervisor AI|Agent 运行时|dispatch 到" ~/.gemini/antigravity/skills/*/SKILL.md`
  - 结果：仅 `browser-testing/SKILL.md` 命中本地 URL 示例；其余命中不涉及 Gateway 契约。
- 全目录补充扫描：
  - `rg -n "localhost:3000|/api/agent-runs|/api/projects|templateId|stageId|projectId|runId|sourceRunIds|pipelineStageIndex|groupId|dispatch-group|/api/agent-groups|acceptedSourceGroupIds|acceptedSourceStageIds|resume|intervene|dispatch" ~/.gemini/antigravity/skills`
  - 结果：除 `browser-testing` 示例 URL 与非 Gateway 语义的 `dispatch` 文本外，无需要处理的命中。

### 结论
- **当前无需修改的 skills**：`browser-testing`、`frontend-design`、`mcp-builder`、`theme-factory`、`webapp-testing` 等所有现有 skills
- **当前需要继续关注的外部契约文档**：仍然是 `~/.gemini/antigravity/global_workflows/team-dispatch.md`，而不是 `skills/` 目录

## 任务：复核 `global_workflows` 中其余 runtime 绑定 workflow

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
对 `~/.gemini/antigravity/global_workflows/` 做了整目录的 runtime 契约复核，目标是确认除了 `team-dispatch.md` 之外，是否还有其他 workflow 仍直接绑定旧 Gateway / dispatch / run / project 语义：
1. **全目录 API / dispatch 检索完成**：按 `/api/*`、`templateId`、`stageId`、`projectId`、`runId`、`sourceRunIds`、`pipelineStageIndex`、`groupId` 等关键词扫描整个目录。
2. **结论明确**：当前直接绑定 Antigravity runtime 契约的 workflow，只有 `team-dispatch.md`。
3. **其余 workflow 无需修改**：剩下文件要么是通用技能说明，要么只是引用 `~/.gemini/antigravity/skills/.../SKILL.md` 的 skill 入口文案，不直接描述 Gateway API、dispatch payload 或 stage/source contract。
4. **因此本轮没有新增 workflow 改动**：上一轮已修好的 `team-dispatch.md` 仍是唯一需要收口的 runtime-bound workflow。

### 验证
- 运行时协议关键词扫描：
  - `rg -n "localhost:3000|/api/agent-runs|/api/projects|templateId|stageId|projectId|runId|sourceRunIds|pipelineStageIndex|groupId" ~/.gemini/antigravity/global_workflows`
  - 结果：只有 `team-dispatch.md` 命中。
- 运行时耦合语义扫描：
  - `rg -n "antigravity|gateway|Supervisor AI|Active Workspace|file:///|dispatch 到 Agent 运行时|多 Agent" ~/.gemini/antigravity/global_workflows`
  - 结果：除 `team-dispatch.md` 外，其余命中均为 skill 路径引用或通用说明，不包含 Gateway API 契约。
- 仓库静态检查：
  - `git diff --check`
  - 结果：通过。

### 结论
- **需要继续关注的 runtime workflow**：仅 `~/.gemini/antigravity/global_workflows/team-dispatch.md`
- **当前可维持现状的文件**：`frontend-design.md`、`mcp-builder.md`、`theme-factory.md`、`webapp-testing.md` 等其余 global workflows

## 任务：修正 `team-dispatch` workflow 到 `templateId + stageId`

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
对外部 workflow 文件 `~/.gemini/antigravity/global_workflows/team-dispatch.md` 做了终态收口，避免它继续向执行中的 AI 暴露已经失效的 Group 派发语义：
1. **模式说明更新**：将“模式 B — 单组派发”改为“模式 B — 单阶段派发”，明确单点派发现在基于 `templateId + stageId`。
2. **请求体更新**：单阶段派发示例从 `"groupId": "<groupId>"` 改为 `"templateId": "<templateId>"` + `"stageId": "<stageId>"`。
3. **阶段清单对齐真实模板**：表格改为 `Template ID / Stage ID / 用途 / 上游依赖`，并把过时的 `autonomous-dev` 修正为当前真实 stage `autonomous-dev-pilot`。
4. **入口说明收口**：全链模式改为“默认从入口 stage / entry node 启动”，单阶段模式则补充 `sourceContract.acceptedSourceStageIds` 约束说明。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `~/.gemini/antigravity/global_workflows/team-dispatch.md` | 去掉单组 / `groupId` 派发说明，改为 `templateId + stageId` 语义 |

### 测试与验证
- 旧语义残留检查：
  - `rg -n "groupId|单组派发|Group ID|\"groupId\"|acceptedSourceGroupIds|/api/agent-groups|dispatch-group" ~/.gemini/antigravity/global_workflows/team-dispatch.md`
  - 结果：无命中。
- 模板 stage 对齐检查：
  - `jq -r '.id + ": " + (if .pipeline then (.pipeline | map(.stageId) | join(", ")) else (.graphPipeline.nodes | map(.id) | join(", ")) end)' .agents/assets/templates/*.json`
  - 结果：已确认 `development-template-1` / `ux-driven-dev-template` 使用 `autonomous-dev-pilot`，并据此修正 workflow 示例。

### 额外说明
- 本次只修改了外部 workflow 引导文案，没有变更仓库内模板资产；`.agents/assets/templates/*.json` 仍保持此前验证通过的 inline-only / stage-centric 状态。

## 任务：复核 `global_workflows` 与 Template 资产的 Group 残留

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
对用户提到的 `~/.gemini/antigravity/global_workflows/` 与仓库内 `.agents/assets/templates/` 做了针对性复核，重点检查旧 `groupId`、`groups{}`、`dispatch-group`、`acceptedSourceGroupIds` 等残留：
1. **Global workflows 基本干净**：目录内大多数 markdown 只是通用技能说明或任务工作流说明，与当前 `templateId + stageId` 派发契约无关。
2. **唯一需要改的 workflow 是 `team-dispatch.md`**：该文件仍保留“模式 B — 单组派发”、`Group ID` 表头，以及向 `/api/agent-runs` 发送 `"groupId": "<groupId>"` 的旧请求体示例。
3. **`team-dispatch.md` 还有一处内容过时**：单阶段表示例里写了 `autonomous-dev`，但当前真实模板的 stageId 是 `autonomous-dev-pilot`。
4. **Template 资产已对齐终态**：`.agents/assets/templates/*.json` 中未发现 `groups{}`、`groupId`、`acceptedSourceGroupIds`、`dispatch-group` 或 `/api/agent-groups` 残留，仓库模板已是 inline-only / stage-centric。

### 复核结论
- **必须修改**：
  - `~/.gemini/antigravity/global_workflows/team-dispatch.md`
- **当前无需修改**：
  - `.agents/assets/templates/adhoc-universal.json`
  - `.agents/assets/templates/coding-basic-template.json`
  - `.agents/assets/templates/design-review-template.json`
  - `.agents/assets/templates/development-template-1.json`
  - `.agents/assets/templates/graph-smoke-template.json`
  - `.agents/assets/templates/large-project-template.json`
  - `.agents/assets/templates/template-factory.json`
  - `.agents/assets/templates/ux-driven-dev-template.json`
  - `.agents/assets/templates/v4-smoke-branch-template.json`
  - `.agents/assets/templates/v4-smoke-template.json`

### 验证
- 关键词筛查：
  - `rg -n "groupId|group id|groupIds|group-registry|dispatch-group|/api/agent-groups|acceptedSourceGroupIds|Group:" ~/.gemini/antigravity/global_workflows .agents/assets/templates`
  - 结果：只有 `team-dispatch.md` 命中旧 Group 语义。
- 模板残留检查：
  - `rg -n '"groups"|"groupId"|acceptedSourceGroupIds|dispatch-group|/api/agent-groups' .agents/assets/templates`
  - 结果：无命中。
- 模板迁移稳定性：
  - `npx tsx scripts/migrate-inline-templates.ts --check`
  - 结果：10 个模板全部 `unchanged`。

### 额外说明
- 本次是复核，没有直接修改 `~/.gemini/antigravity/global_workflows/team-dispatch.md`。如果需要，可以在下一步把它改成“单阶段派发 / `templateId + stageId`”版本。

## 任务：迁移 CLI 到 `templateId + stageId` 并同步内部说明

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
按最新要求，将 CLI 脚本与对应文档一起从 group-centric 语义迁移到 stage-centric 终态，避免出现“接口已变更，但 CLI 和指南还停留在 `groupId`”的割裂状态：
1. **CLI 派发入口迁移**：`scripts/ag.ts` 的 `dispatch` 改为 `dispatch <templateId> [--stage <stageId>]`，不再接受 `--template` 参数，也不再围绕 `groupId` 组织输入与输出。
2. **CLI 查询与展示收口**：`runs` 新增 `--stage` 过滤，`run` / `project` 输出统一展示 `Stage` 与 stage title，不再打印 `Group:` 或依赖 `groupId` 字段。
3. **CLI 指南同步**：`docs/guide/cli-guide.md` 的命令示例、参数表、返回示例和说明全部改成 `templateId + stageId` 语义。
4. **内部说明同步**：`docs/internals/agent-internals.md` 的 tracing / annotation 示例从 `antigravity.task.groupId` 改为 `antigravity.task.stageId`，并同步更新 runtime / normalizer 相关文件索引说明。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `scripts/ag.ts` | `dispatch` 改为 `dispatch <templateId> [--stage <stageId>]`；`runs` 支持 `--stage`；`run` / `project` 输出改成 Stage |
| `docs/guide/cli-guide.md` | 更新 CLI 示例、参数表、输出示例与说明，去掉 `dispatch <groupId>` / `Group:` |
| `docs/internals/agent-internals.md` | 将 `antigravity.task.groupId` 改为 `antigravity.task.stageId`，并刷新内部模块树说明 |

### 测试与验证
- CLI 帮助输出：
  - `npx tsx scripts/ag.ts help`
  - 结果：通过。帮助文本已显示 `dispatch <templateId>` 与 `--stage <stageId>`。
- 构建验证：
  - `npm run build`
  - 结果：通过。Next.js production build 完成；构建日志中 `RunRegistry` 明确按新规则跳过 legacy run，记录 `skippedLegacy: 30`。
- 静态检查：
  - `git diff --check`
  - 结果：通过。

### 额外说明
- `npm run build` 期间 `ProjectRegistry` 仍会同步 demo 项目状态，因此再次回写了若干 `demolong/projects/*/project.json`。这些是运行态样本数据刷新，不是代码回退。

## 任务：复核文档是否仍有 Group Elimination 残留

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 结论
本轮复核后，文档状态可以分成两类：
1. **主文档已基本对齐**：`docs/design/group-elimination-design.md`、`docs/guide/gateway-api.md`、`docs/guide/cli-api-reference.md`、`docs/guide/agent-user-guide.md`、`docs/guide/mcp-server.md`、`docs/guide/graph-pipeline-guide.md` 已经和当前 stage-centric / inline-only 实现一致。
2. **仍有少量文档残留，但要区分是否应立即修改**：
   - `docs/guide/cli-guide.md` 仍写 `dispatch <groupId>` 与 `Group:` 输出；不过这不是单纯文档落后，因为实际 CLI 脚本 `scripts/ag.ts` 目前也还保留同样的 group-centric 语义。这里应当是“CLI 实现 + 文档”一起迁移，而不是只改文档。
   - `docs/internals/agent-internals.md` 的注解示例仍写 `antigravity.task.groupId`，这份内部说明应更新为 `antigravity.task.stageId`。
   - `docs/template-vs-group-analysis.md`、`docs/user-journey-gaps.md`、`docs/internals/masfactory-integration-design.md` 等仍有大量 `groupId`，但它们属于历史分析 / backlog / 内部设计材料，不属于当前公共契约文档，暂不构成对外误导。

### 复核依据
- 通过全文检索 `groupId`、`dispatch-group`、`/api/agent-groups`、`groupId-only`、`acceptedSourceGroupIds` 等关键字核对 docs 与 `ARCHITECTURE.md`
- 额外核对 `scripts/ag.ts`，确认 CLI 指南中的 group 语义当前仍与脚本实现一致

### 建议
- **需要优先更新**：`docs/internals/agent-internals.md`
- **需要和代码一起更新**：`docs/guide/cli-guide.md` + `scripts/ag.ts`
- **可保留为历史材料**：`docs/template-vs-group-analysis.md`、`docs/user-journey-gaps.md`、legacy / internals 设计文档

---

## 任务：移除旧 run/project 状态 fallback

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
按用户最新决策，彻底放弃 pre-migration run/project 状态的兼容恢复，不再保留 `groupId`-only persisted state 的 best-effort 读取：
1. **运行态 fallback 移除**：`AgentRunState`、`PipelineStageProgress` 移除运行态 `groupId` 字段；`RunRegistry` / `ProjectRegistry` 不再从旧 persisted state 回填或读取 `groupId`，缺少 `stageId` / `pipelineStageId` 的旧 run 直接跳过，缺少 `stageId` 的旧 project stage 直接跳过。
2. **旧路径 fallback 移除**：不再读取 `data/agent_runs.json` / `data/projects.json` 这类 legacy 路径，当前仅认 gateway 的正式持久化路径。
3. **文档边界同步**：设计文档、Gateway API、CLI API、用户指南全部明确 `recover` 仅适用于当前 stage-centric persisted state；旧 `groupId`-only run/project 不再进入恢复流程。
4. **测试夹具收口**：更新 project diagnostics / reconciler / checkpoint / CEO / dag runtime 相关测试夹具，移除运行态 `groupId` 依赖。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `src/lib/agents/group-types.ts` | 删除 `AgentRunState.groupId` 运行态字段 |
| `src/lib/agents/project-types.ts` | 删除 `PipelineStageProgress.groupId`，保留 `title` 作为 stage-centric 展示字段 |
| `src/lib/agents/run-registry.ts` | 移除 legacy path fallback；加载时跳过无 `stageId/pipelineStageId` 的 persisted run |
| `src/lib/agents/project-registry.ts` | 移除 legacy path fallback；加载时跳过缺失 `stageId` 的 persisted project stage |
| `docs/design/group-elimination-design.md` | 改为 v2.1，明确旧 run/project fallback 已移除，仅保留模板加载期兼容 |
| `docs/guide/cli-api-reference.md` / `docs/guide/gateway-api.md` / `docs/guide/agent-user-guide.md` | 补充 `recover` 的迁移边界说明 |
| `src/lib/agents/project-diagnostics.test.ts` / `src/lib/agents/project-reconciler.test.ts` / `src/lib/agents/checkpoint-manager.test.ts` / `src/lib/agents/pipeline/dag-runtime.test.ts` / `src/lib/ceo-events.test.ts` / `src/lib/agents/ceo-agent.test.ts` | 清理运行态 `groupId` 夹具与断言依赖 |

### 测试与验证
- 构建验证：
  - `npm run build`
  - 结果：通过。构建阶段日志确认旧 persisted run 已按新规则跳过，`RunRegistry` 记录 `skippedLegacy: 30`。
- 相关测试：
  - `npx vitest run src/lib/agents/pipeline/dag-runtime.test.ts src/lib/agents/project-diagnostics.test.ts src/lib/agents/project-reconciler.test.ts src/lib/agents/checkpoint-manager.test.ts src/lib/ceo-events.test.ts src/lib/agents/ceo-agent.test.ts`
  - 结果：`6` 个测试文件全部通过，`108` 个测试全部通过。
- 静态检查：
  - `git diff --check`
  - 结果：通过。

### 额外说明
- `npm run build` 期间 `ProjectRegistry` 会继续同步 demo 项目状态，因此再次回写了若干 `demolong/projects/*/project.json`。这些是运行态样本数据更新，不是回退。
- 当前仓库中剩余的 `groupId` 仅用于模板加载期 normalize、模板编辑器兼容类型和历史模板测试，不再参与 run/project 恢复。

---

## 任务：落地 Group Elimination 终态迁移（inline-only / stage-centric）

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
按终态计划完成了 Group Elimination 的端到端收束，公共语义统一切到 `templateId + stageId`，模板持久化改成 inline-only：
1. **数据模型与运行时去 Group**：`TemplateDefinition.groups`、`PipelineStage.groupId`、`GraphPipelineNode.groupId` 不再作为公共 schema；loader 改为 normalize legacy 模板到 stage-inline；dispatch/runtime/sourceContract 全链路改为 `acceptedSourceStageIds` 与 `stageId`。
2. **公共接口与前端切到 stage-centric**：`/api/agent-runs`、scheduler、MCP、模板详情/列表、工作台、Deliverables、Stage Detail 等入口都改成 `templateId + stageId`；`/api/agent-groups` 与 scheduler `dispatch-group` 已删除。
3. **模板资产与 AI 生成链路迁移**：新增 `scripts/migrate-inline-templates.ts`，并将仓库 `.agents/assets/templates/*.json` 全量迁为 inline-only；pipeline generator / generation context / risk assessor / confirm route 全部改成直接生成和保存 stage-inline / node-inline 模板。
4. **文档同步**：更新 `ARCHITECTURE.md`、`docs/guide/gateway-api.md`、`docs/guide/cli-api-reference.md`、`docs/guide/agent-user-guide.md`、`docs/guide/mcp-server.md`、`docs/guide/graph-pipeline-guide.md`。

### 关键修改文件

| 文件 | 变更 |
|:-----|:-----|
| `src/lib/agents/group-types.ts` | 引入 stage-centric core types，运行态以 `stageId` 为主 |
| `src/lib/agents/pipeline/template-normalizer.ts` | 新增模板归一化，将 legacy `groups + groupId` 转为 inline stage/node config |
| `src/lib/agents/stage-resolver.ts` | 新增 template-scoped `stageId` 解析器 |
| `src/lib/agents/asset-loader.ts` | 删除全局 group 展平读取，统一走 normalized template load |
| `src/lib/agents/dispatch-service.ts` / `src/lib/agents/group-runtime.ts` | 派发与 runtime 统一按 `templateId + stageId` 解析、执行、自动触发 |
| `src/lib/agents/pipeline/*.ts` | DAG / graph compiler、IR、runtime、registry 统一消费 inline stage config |
| `src/app/api/agent-runs/route.ts` | POST / GET 去掉 `groupId` 公共入口和过滤，改为 `stageId` |
| `src/app/api/pipelines/[id]/route.ts` / `src/app/api/pipelines/route.ts` | 模板 API 返回 inline stage metadata，不再暴露 `groups{}` |
| `src/components/scheduler-panel.tsx` | 删除 `dispatch-group` UI，仅保留 `dispatch-pipeline` + optional `stageId` |
| `.agents/assets/templates/*.json` | 全量迁移为 inline-only persisted templates |
| `scripts/migrate-inline-templates.ts` | 新增正式模板迁移脚本 |

### 测试与验证
- 构建验证：
  - `npm run build`
  - 结果：通过。Next.js production build 完成，`/api/agent-groups` 路由已不再出现在构建产物中。
- 模板迁移验证：
  - `npx tsx scripts/migrate-inline-templates.ts --check`
  - 结果：10 个 repo 模板全部 `unchanged`，说明 inline-only 迁移结果稳定。
- 相关测试：
  - `npx vitest run src/lib/agents/pipeline/dag-runtime.test.ts src/lib/agents/pipeline/graph-compiler.test.ts src/lib/agents/pipeline-generator.test.ts 'src/app/api/pipelines/[id]/route.test.ts' 'src/app/api/pipelines/generate/[draftId]/confirm/route.test.ts' src/lib/agents/project-diagnostics.test.ts src/lib/agents/project-reconciler.test.ts src/lib/agents/scheduler.test.ts`
  - 结果：`8` 个测试文件全部通过，`149` 个测试全部通过。

---

## 任务：收尾 Group Elimination 文档与前端语义残留

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
继续对 Group Elimination 做收尾，不再停留在“完成度复核”，而是直接把残留的设计文档、前端命名和深层指南示例对齐到当前 stage-centric / inline-only 终态：
1. **设计文档改为终态说明**：`docs/design/group-elimination-design.md` 不再保留审核期的渐进式建议，而是明确记录当前已经生效的架构、兼容边界和剩余收尾项。
2. **前端语义收口**：模板浏览器、项目工作台、Stage/Node 编辑器和 FE 类型从 `Group/Profile` 语义切到 `Stage Config / templateStages`，删除未使用的 `template-group-card.tsx`。
3. **深层指南示例清扫**：`graph-pipeline-guide.md` 与 `agent-user-guide.md` 中关键 JSON 示例和 API 示例改为 inline stage/node execution config，不再用 `groupId` 作为主语义。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `docs/design/group-elimination-design.md` | 重写为 v2.0 终态说明文档，记录已落地能力、兼容边界与剩余收尾项 |
| `docs/guide/graph-pipeline-guide.md` | 将 GraphPipeline 节点示例改为 `executionMode + roles` inline 配置，更新必填字段说明 |
| `docs/guide/agent-user-guide.md` | 将关键 API / graph / fan-out / subgraph / shared conversation 示例改为 `templateId + stageId` / inline stage config |
| `src/lib/types.ts` | 新增 `TemplateStageConfigFE` 作为前端主类型，保留 `TemplateGroupDetailFE` 兼容 alias |
| `src/components/project-workbench.tsx` | `templateGroups` 改为 `templateStages`，Stage 标题解析语义收口 |
| `src/components/projects-panel.tsx` | 调整 `ProjectWorkbench` 入参命名 |
| `src/components/template-browser.tsx` | 将 UI 文案与内部变量从 Group/Profile 改为 Stage Config |
| `src/components/template-stage-editor.tsx` | 编辑面板语义改为 Stage Config |
| `src/components/template-node-editor.tsx` | 编辑面板语义改为 Stage Config |
| `src/components/template-group-card.tsx` | 删除未使用的旧 Group 组件 |
| `docs/PROJECT_PROGRESS.md` | 记录本次收尾修改与验证结果 |

### 验证结果
- 构建验证：
  - `npm run build`
  - 结果：通过。
- 回归测试：
  - `npx vitest run src/lib/agents/pipeline-generator.test.ts 'src/app/api/pipelines/generate/[draftId]/confirm/route.test.ts' 'src/app/api/pipelines/[id]/route.test.ts'`
  - 结果：`3` 个测试文件全部通过，`35` 个测试全部通过。
- 静态残留检查：
  - 对 `docs/design/group-elimination-design.md`、`docs/guide/graph-pipeline-guide.md`、`docs/guide/agent-user-guide.md` 以及模板编辑器相关组件执行 `rg` 检查
  - 结果：文档中的 `groupId` 仅剩迁移说明；代码中的 `groupId` 仅保留 deprecated alias / 兼容读取路径

### 额外说明
- `npm run build` 期间 `ProjectRegistry` 会加载并持久化 demo 项目状态，因此回写了若干 `demolong/projects/*/project.json`。这些是运行态样本数据更新，不是模板或业务逻辑回退。

---

## 任务：复核 Group Elimination 完成度与文档 / AI 生成链路状态

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
针对 `docs/design/group-elimination-design.md`、当前实现代码、相关文档以及自动生成 Pipeline / CEO 生成链路做了交叉复核，结论如下：
1. **实现完成度高于设计文档**：仓库当前代码已经落到 terminal stage-centric 终态，实际完成度超过设计文档 v1.1 中的渐进式建议。
2. **设计文档部分过时**：`group-elimination-design.md` 仍保留“先 deprecated `/api/agent-groups`、不要马上清零 `groupId`”等审核期建议，但代码里这些兼容层已经移除。
3. **主链路已切到 stage-centric，但内部仍有 legacy 兼容层**：`group-runtime.ts`、`dispatch-service.ts`、`run-registry.ts`、`project-registry.ts`、`scheduler-panel.tsx` 等仍保留 `groupId` dual-read / alias，用于旧 run/project 数据 best-effort 读取；模板编辑器与前端类型也还存在 `TemplateGroup*` / `GroupCard` 命名与结构。
4. **相关文档已做主说明更新，但还没有彻底清扫**：架构、Gateway API、CLI API、用户指南、MCP、Graph Pipeline 指南都已补充 stage-centric / inline-only 说明，但深层示例和历史章节里仍残留较多 `groupId` 老例子。
5. **自动生成 Pipeline 已更新**：AI 生成上下文、生成 prompt/schema、风险分析、confirm/save draft 全链路都已切到 inline stage/node config。
6. **CEO 路径已联动更新**：CEO 相关前端入口、模板摘要和派发调用已经改为 `templateId + stageId`，不再依赖 public `groupId` 语义。

### 关键核对点

| 范围 | 结论 | 证据文件 |
|:-----|:-----|:---------|
| 模板与运行时 | 已完成 inline-only + stage-centric | `src/lib/agents/pipeline/template-normalizer.ts`、`src/lib/agents/stage-resolver.ts`、`src/lib/agents/asset-loader.ts`、`src/lib/agents/dispatch-service.ts`、`src/lib/agents/group-runtime.ts` |
| Public API / Scheduler | 已去掉 public `groupId` 与 `dispatch-group` | `src/app/api/agent-runs/route.ts`、`src/components/scheduler-panel.tsx` |
| 模板资产 | 已迁移为 inline-only persisted templates | `.agents/assets/templates/*.json`、`scripts/migrate-inline-templates.ts` |
| AI 生成 Pipeline | 已按 stage/node inline config 更新 | `src/lib/agents/generation-context.ts`、`src/lib/agents/pipeline-generator.ts`、`src/lib/agents/risk-assessor.ts`、`src/app/api/pipelines/generate/[draftId]/confirm/route.ts` |
| CEO 链路 | 已使用 stage-centric 摘要与派发 | `src/lib/agents/ceo-prompts.ts`、`src/components/projects-panel.tsx`、`src/app/page.tsx` |
| 前端 / FE 类型残留 | 仍保留 Group 命名与兼容结构，未彻底收尾 | `src/components/template-browser.tsx`、`src/components/template-group-card.tsx`、`src/components/project-workbench.tsx`、`src/lib/types.ts` |
| 文档同步 | 已做主文档同步，但设计审核文档与深层示例仍落后于实现 | `ARCHITECTURE.md`、`docs/guide/gateway-api.md`、`docs/guide/cli-api-reference.md`、`docs/guide/agent-user-guide.md`、`docs/guide/mcp-server.md`、`docs/guide/graph-pipeline-guide.md` |

### 验证依据
- 构建验证：
  - `npm run build`
  - 结果：通过。
- 模板迁移验证：
  - `npx tsx scripts/migrate-inline-templates.ts --check`
  - 结果：10 个模板全部稳定，无需额外回写。
- 测试验证：
  - `npx vitest run src/lib/agents/pipeline/dag-runtime.test.ts src/lib/agents/pipeline/graph-compiler.test.ts src/lib/agents/pipeline-generator.test.ts 'src/app/api/pipelines/[id]/route.test.ts' 'src/app/api/pipelines/generate/[draftId]/confirm/route.test.ts' src/lib/agents/project-diagnostics.test.ts src/lib/agents/project-reconciler.test.ts src/lib/agents/scheduler.test.ts`
  - 结果：`8` 个测试文件全部通过，`149` 个测试全部通过。

### 结论
- `docs/design/group-elimination-design.md` 现在更像是“审核期的历史计划”，不是仓库当前真实状态的终态说明。
- 对外主链路已经切到 stage-centric，功能上基本完成；但严格按“彻底移除 Group 语义”衡量，还没有完全收尾。
- 相关对外文档已经补充 stage-centric 说明，但深层内容尚未完全完成历史术语清扫。
- 自动生成 Pipeline 和 CEO 驱动的流水线生成 / 确认链路已经同步更新，不再依赖旧的 `groupId/groups{}` 公共语义。

---

## 任务：审核并修订 Group Elimination 设计方案

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
基于当前代码实况，对 `docs/design/group-elimination-design.md` 做了完整审核和重写修订。重点结论：
1. 当前真正需要先消除的是 **全局 Group registry**，而不是第一步就粗暴删除所有 `groupId/groups{}`。
2. 原方案低估了 runtime、DAG/graph、AI 生成链路、API、MCP 和前端模板编辑器的联动影响。
3. 新方案调整为 **“template-scoped resolver → runtime normalized config → API/前端兼容层 → AI 生成改造 → 数据迁移清理”** 的渐进式迁移计划。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `docs/design/group-elimination-design.md` | 按代码审阅结果重写为 v1.1 审核修订版，补齐真实影响面、修正错误假设、改写迁移阶段 |
| `docs/PROJECT_PROGRESS.md` | 记录本次设计审核、文档修订与测试结果 |

### 审阅覆盖
- 核心类型与加载：`pipeline-types.ts`、`group-types.ts`、`group-registry.ts`、`asset-loader.ts`
- 运行时与编排：`dispatch-service.ts`、`group-runtime.ts`、`run-registry.ts`、`project-registry.ts`、`project-diagnostics.ts`、`scheduler.ts`
- DAG / graph / 编译：`dag-runtime.ts`、`graph-compiler.ts`、`dag-compiler.ts`、`graph-pipeline-types.ts`
- AI 生成链路：`pipeline-generator.ts`、`generation-context.ts`、`risk-assessor.ts`、`pipelines/generate/[draftId]/confirm/route.ts`
- API / MCP / 前端：`/api/pipelines*`、`/api/agent-runs`、`src/mcp/server.ts`、`template-browser.tsx`、`project-workbench.tsx`、`stage-detail-panel.tsx`、`scheduler-panel.tsx`

### 测试结果
- 运行命令：
  `npx vitest run src/lib/agents/pipeline/dag-runtime.test.ts src/lib/agents/pipeline/graph-compiler.test.ts src/lib/agents/pipeline-generator.test.ts 'src/app/api/pipelines/[id]/route.test.ts' 'src/app/api/pipelines/generate/[draftId]/confirm/route.test.ts' src/lib/agents/project-diagnostics.test.ts src/lib/agents/project-reconciler.test.ts`
- 结果：`7` 个测试文件全部通过，`146` 个测试全部通过。
- 用时：`453ms`

---

## 任务：计算 1+10 并打印结果

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
编写 Python 脚本计算 1+10 的结果并打印到控制台。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `/tmp/calculate_1_plus_10.py` | 新增脚本文件（临时） |

### 测试结果
- 运行 `python3 -c "print(1 + 10)"` 输出结果为 `11`。
- 脚本验证通过。

---

## Phase 6.1: CEO 决策持久化 + 项目详情展示
... (preserved original content)

---

## Phase 6.2: CEO 面板显示逻辑修复与项目详情布局调整

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
修复了 CEO 决策信息在项目列表中的显示范围，以及 `ProjectWorkbench` 中 Tabs 的排版布局：
1. **CEO 面板显示限制**：将 CEO Decision Card 仅显示在项目展开后的详情区域中，列表态不显示。同时修复了无 Pipeline 状态下 CEO 面板数据为空无法读取的 Bug，引入了根据 `viewProject.ceoDecision` 缓存数据的后备展现。
2. **Tabs 布局修复**：修复了 Base UI 与 Tailwind 冲突导致的横向（并排）挤压问题。将 `data-horizontal` 修改为 `data-[orientation=horizontal]` 使 Tabs 恢复正常的纵向上（Tab Bar）中下（内容）堆叠样式。

### 修改文件
| 文件 | 变更 |
|:-----|:-----|
| `src/components/projects-panel.tsx` | 添加了仅在选中/展开卡片状态下的 CEO Decision Card 构建模块。修复 no-pipeline panel 根据 `ceoDecision` 回调数据显示提案的问题 |
| `src/components/ui/tabs.tsx` | 重写所有 `data-horizontal` 与 `data-vertical` 的选择器为 `data-[orientation=...]`，修复样式不匹配问题 |

---

## Phase 6.3: AI CEO 接入 Provider 架构与全局独立工作区

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
彻底移除了 `callLLMOneshot` 对底层 `grpc` 的硬编码耦合，将其正式接入系统的 `Provider` 抽象层。解决 CEO Agent 模型无法配置、运行时处于 `file:///tmp` 无法累积知识的问题。
1. **全局 CEO 工作区**：在 `~/.gemini/antigravity/ceo-workspace` 创建持久化目录，供 CEO 级大模型查询和记录决策上下文（上帝视角）。
2. **Provider 架构重构**：`llm-oneshot` 目前会自动采用 `executive` 阶层（Layer）读取由于 `codex`, `openai-api` 等设定的外部 Provider。若是原生 provider（`antigravity`）保留异步轮询，外部 provider 启用同步 `executeTask`。

### 修改文件
| 文件 | 变更 |
|:-----|:-----|
| `src/lib/agents/llm-oneshot.ts` | 引入 `resolveProvider` 和 `getExecutor`。增加 `getCEOWorkspacePath` 管理独立空间，支持并根据 Provider 的能力走分发逻辑 |
| `task.md` | 创建与标记 CEO 独立工作区的执行计划清单 |

---

## 任务：简短评审前端仪表盘交互体验 (Run: 246eb35a)

**状态**: ✅ 已完成
**日期**: 2026-04-09

### 概要
作为 Review Author 角色，完成了对 Antigravity CEO 仪表盘的简短启发式评估。识别了包括纵向堆叠疲劳、原生对话框干扰以及轮询数据跳变在内的 3 个核心可用性问题。产出了 Bento 布局、自定义 Dialog 和 Framer Motion 平滑刷新等改进建议。

### 本次完成的关键改动
1. **源码走访**: 深入分析了 `src/components/ceo-dashboard.tsx` 的布局逻辑与 `window.prompt` 交互。
2. **生成评审报告**: 在 `/demolong/runs/246eb35a-d07e-4f93-b6a4-e1234c4006fe/specs/` 下输出了 `audit-report.md`, `interaction-proposals.md`, `priority-matrix.md`。
3. **交付结果**: 提交了符合自动化流水线要求的 `result.json`。

---
