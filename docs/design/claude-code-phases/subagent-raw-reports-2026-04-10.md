傻逼 

第一阶段 

阶段目标和最小闭环
推荐闭环是一个 executionMode = legacy-single 的单角色 coding stage，经由 src/app/api/agent-runs/route.ts -> src/lib/agents/dispatch-service.ts -> src/lib/agents/group-runtime.ts -> backend/session 主链执行，再由 src/lib/agents/run-artifacts.ts 回写 result envelope。
这个闭环只证明 4 件事：Run 仍由 Antigravity 创建；provider 解析能落到 Claude Code；Claude Code 在 workspace 内完成一次 coding 执行；summary 和 changedFiles 能回到平台既有结果合同。
推荐路由口径是先复用 src/lib/providers/ai-config.ts 的 workspace 或 department provider 解析，不在 Phase 1 新增 stage 级 provider 字段。
备选口径是新增一个很薄的 stage.executionBackend 或 providerOverride，但这会扩到模板 schema、stage resolver 和 pipeline 归一化，更适合 Phase 6。
不推荐把 prompt-only 路径当最终 Phase 1 验收，因为 src/lib/agents/prompt-executor.ts 只能证明 adapter 能跑，不能证明 Stage ownership 没被破坏。
预期代码落点
bridge 层：建议在 bridge 目录新增一个与 src/lib/bridge/codex-adapter.ts 同层的 Claude Code adapter 文件。职责只做子进程或内嵌内核调用、超时、stdout/stderr 解析、best-effort cancel。
provider 叶子层：建议在 providers 目录新增一个与 src/lib/providers/codex-executor.ts 同层的 Claude Code executor，并修改 src/lib/providers/index.ts 与 src/lib/providers/types.ts。
backend 层：建议新增 Claude Code backend，并由 src/lib/backends/index.ts 导出。最小改动版可以先并入 src/lib/backends/builtin-backends.ts，但从文件体量看，单独拆文件更稳。
Run 写回层：需要改 src/lib/backends/run-session-hooks.ts、src/lib/agents/group-types.ts、src/lib/agents/run-registry.ts，把 provider provenance 和 generic external handle 落进 Run。
配置层：需要改 src/lib/providers/ai-config.ts 配套测试，以及 src/lib/types.ts 里的 DepartmentConfig provider 联合类型。
runtime 层：尽量不在 src/lib/agents/group-runtime.ts 增加 Claude Code 专用 if/else，只复用现有 getAgentBackend 流程。Task B 当前态已经说明这里不该重新长 transport 分支，见 docs/design/task-b-current-state-2026-04-10.md。
需要新增或修改的接口或数据字段
ProviderId：在 src/lib/providers/types.ts 新增 claude-code。不要复用现有的 claude-api，因为 Claude Code executor 和 raw Claude API backend 不是一层语义。
DepartmentConfig.provider：在 src/lib/types.ts 把 provider 联合从 antigravity | codex 扩到 antigravity | codex | claude-code，这样 workspace 级路由才真正可配置。
AgentRunState：在 src/lib/agents/group-types.ts 新增 providerId、providerSource、externalHandle 三个字段。
providerId 记录真正执行 backend。
providerSource 直接复用 src/lib/providers/types.ts 现有的 scene | department | layer | default 语义，方便 Phase 2 以后恢复态不再重新猜 provider。
externalHandle 记录 Claude Code session 或 thread handle。不要继续把 childConversationId 当成所有外部执行器的唯一真相源。
Run 创建与 started 写回：在 src/lib/agents/run-registry.ts 和 src/lib/backends/run-session-hooks.ts 填充上述字段；Antigravity 可以继续镜像到 childConversationId 和 activeConversationId，Claude Code 只写 externalHandle。
AgentBackend、BackendRunConfig、TaskExecutionResult：Phase 1 不建议改 src/lib/backends/types.ts 和 src/lib/providers/types.ts 的主合同。现有 start -> started/completed/failed 以及 handle/content/changedFiles/status 已够用。
明确三条轴分离：executionTarget 仍是 template 或 prompt；executorKind 仍是 template 或 prompt；providerId 才是 antigravity、codex、claude-code。不要混用这三者，见 src/lib/agents/group-types.ts。
最小测试集合
扩展 src/lib/providers/providers.test.ts。
getExecutor 能返回 Claude Code executor。
capabilities 正确声明为 one-shot 外部执行器能力。
executeTask 成功时能返回 handle、content、changedFiles。
executeTask 失败时能映射成 provider_failed。
扩展 src/lib/providers/ai-config.test.ts。
scene、department、layer 三条路径都能 resolve 到 claude-code。
扩展 src/lib/backends/builtin-backends.test.ts 或在同层新增专项测试。
started -> completed 正常出事件。
local cancel only 语义成立。
changedFiles 不足时可以走 artifact 扫描 fallback，模式可直接参考 src/lib/providers/codex-executor.ts。
扩展 src/lib/agents/run-registry.test.ts。
providerId、providerSource、externalHandle 会被持久化并随 runs.json 恢复。
扩展 src/lib/agents/group-runtime.test.ts。
一个 legacy-single stage 经由 claude-code backend 正常完成。
一个失败路径能正确落成 failed 和 lastError。
扩展 src/app/api/agent-runs/route.test.ts。
template dispatch 在 claude-code provider 下仍走 executeDispatch，不破坏现有 prompt/template 分流。
风险与避免越界项
不要在 Phase 1 接 interactive conversation UI。当前 src/app/api/conversations/route.ts 和 src/app/api/conversations/[id]/send/route.ts 仍带 Codex 专门分支，把 Claude Code 也塞进去会把 executor adapter 和 chat surface 混成一件事。
不要让 Claude Code session 变成 Run 真相源。模型映射基线已经写死在 docs/design/claude-code-model-mapping-2026-04-10.md。
不要在 src/lib/agents/group-runtime.ts 新增 Claude Code transport 细节。Task B 的价值就是把这类东西压到底层。
不要在 Phase 1 做 append、attach、resume、evaluate、tool permission、raw event 标准化。这些都属于后续阶段。
不要把 claude-api 和 claude-code 合成一个 provider 名称，否则后续 raw API backend 和外部执行内核会被混掉。
不要现在就给模板 schema 加大规模 routing 语义，除非你已经确认必须支持“同一 workspace 不同 stage 混跑不同 executor”。
退出条件和验收标准
能从 src/app/api/agent-runs/route.ts 触发一个 template stage，最终在 Run 上看到完整的 status、result、resultEnvelope、artifactManifestPath 回写。
该 Run 明确持久化了 providerId = claude-code、providerSource、externalHandle。
Claude Code 返回的 summary 和 changedFiles 已经被归一化成现有 TaskResult 和 ResultEnvelope 合同，而不是把原始 CLI 输出或原始事件直接塞进 control plane。
一个失败路径也能正常回写 failed 和 lastError，不出现“provider 可调用但 runtime 无法落盘”的半完成状态。
整个闭环不要求改 Project、Run、Stage 的定义，不要求改 scheduler、approval、governance 合同。
验收对象只限单 stage、单 role、coding 任务；review-loop、shared conversation、delivery-single-pass 都不属于 Phase 1 blocker。
对后续 Phase 2-6 的依赖影响
对 Phase 2：如果现在就把 providerId、providerSource、externalHandle 持久化，Phase 2 的 attach 和 resume 就能直接读 Run 自身 provenance，而不是重新 resolveProvider 去猜 backend。
对 Phase 3：如果 Phase 1 只输出 summary、changedFiles、status，Phase 3 才能从容决定要不要吸收 richer events，而不会被迫兼容 Claude 原始 event shape。
对 Phase 4：如果现在明确 Claude Code 是 one-shot 或 local-cancel executor，后面补 append、attach、evaluate 时就不会反向污染平台 intervention 语义。
对 Phase 5：如果 Phase 1 不碰 tool permission 和 raw tool trace，Phase 5 还能把 permission 映射做成可选增强，而不是平台底层前提。
对 Phase 6：如果 Phase 1 先走 workspace 或 department provider 路由，Phase 6 需要再补真正的 task-type 或 stage-level routing policy；如果你现在就引入 stage.executionBackend，Phase 6 会更轻，但当前模板 schema 改动会显著扩大。
总体判断是：最稳的 Phase 1 不是“把 Claude Code 全接进来”，而是“按 Codex 的现有模式，新增一条 bridge adapter + provider leaf + AgentBackend，并用一个 legacy-single coding stage 证明 Run ownership、结果归一化和 provider provenance 三件事已经成立”。这条线最符合 docs/design/claude-code-integration-master-plan-2026-04-10.md、docs/design/claude-code-model-mapping-2026-04-10.md 和 docs/design/task-b-current-state-2026-04-10.md 的共同边界。

如果你要，我可以下一步把这份方案压成“实际开发任务拆分清单”，直接按文件和测试项排优先级。
或者我也可以把“推荐字段变更”单独整理成一页 Phase 1 schema diff 说明。


第二阶段：




Mobility-CLI/src/lib/agents/run-registry.ts#L178](Antigravity-Mobility-CLI/src/lib/agents/run-registry.ts#L178)，而活跃 session registry 明确只是进程内缓存 Antigravity-Mobility-CLI/src/lib/backends/session-registry.ts#L23。现在真正不稳定的点，是恢复态还在按 workspace 重新猜 provider Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts#L557 和 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts#L1193。 不推荐的两条路也很明确。

不要把 childConversationId 继续硬顶成唯一恢复主键。它现在既被用作隐藏执行线程 Antigravity-Mobility-CLI/src/app/api/conversations/route.ts#L62，又被 UI 当成可打开的对话入口 Antigravity-Mobility-CLI/src/components/agent-run-detail.tsx#L272 和 Antigravity-Mobility-CLI/src/components/stage-detail-panel.tsx#L429。
不要再造一个 durable session store。那会破坏“RunRegistry 是真相源、session-registry 只是缓存”的既有设计 Antigravity-Mobility-CLI/docs/design/agent-backend-abstraction-detailed-design.md。
1. 阶段目标

目标不是“把 Claude session 塞进现有 Run 顶层字段”，而是把 Claude session 明确收成 execution thread 层的外部句柄，并由 Run 持有它的 provenance。总纲已经把这一步定义为“external session handle 持久化 + session provenance 持久化 + conversation 映射清晰化” Antigravity-Mobility-CLI/docs/design/claude-code-integration-master-plan-2026-04-10.md#L149。
模型映射的硬边界不能变：Run 拥有外部 Claude session handle，但 Run 不是 Claude session 本身 Antigravity-Mobility-CLI/docs/design/claude-code-model-mapping-2026-04-10.md#L88。
当前代码里的根因，是 AgentRunState 已有 childConversationId、activeConversationId、executorKind、executionTarget、triggerContext，但没有“这个 handle 是由哪个 backend、基于什么路由、用什么 locator 恢复”的持久化对象 Antigravity-Mobility-CLI/src/lib/agents/group-types.ts#L277。
所以 Phase 2 的准确目标应是：让 attach、resume、cancel、evaluate 恢复态优先读 Run 自己的 sessionProvenance，不再在恢复时重新 resolveProvider。
2. 需要持久化的 provenance / handle / 字段

推荐在 Run 上新增一个 canonical 对象“sessionProvenance”，不要继续零散补顶层字段。
必需字段一：backendId。这里应表示“执行后端是谁”，推荐显式区分 Claude Code backend，而不要只塞进现有 providerId。原因是当前 ProviderId 已混合了 antigravity、codex、claude-api、openai-api、custom 等概念 Antigravity-Mobility-CLI/src/lib/providers/types.ts#L116。
必需字段二：handle 和 handleKind。对于 Claude Code，handle 应是 sessionId，handleKind 应写死成类似“claude-session-id”，避免后续把 transcriptPath、bridgeSessionId、remote sessionId 混掉。
必需字段三：workspacePath 和 workspaceUri。恢复态必须回到“创建该 session 时的工作目录”，而不是用当前工作区配置猜。
必需字段四：model 和 resolutionSource。至少要记住当时选中的模型，以及它来自 scene、department、layer 还是 default。这样一旦后续配置漂移，恢复时也能知道“原来是怎么路由的”。
必需字段五：createdVia。建议至少区分 start、attach、fork。否则后续 restart_role / continue / fork-session 产生的新 handle 无法做 lineage 管理。
必需字段六：forkedFromHandle 或 supersedesHandle。Phase 2 不需要完整 lineage 图，但至少要知道“当前 handle 是否替代了旧 handle”，否则 superseded 写回边界很容易回退。现有 review-loop 已经有 superseded 护栏 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.multi-role.test.ts#L681。
Claude 专属强烈建议字段一：transcriptPath。Claude Code 的 resume 不只是 sessionId，它还会把 transcript 文件重新 adopt 回当前会话 claude-code/src/utils/sessionRestore.ts#L409。
Claude 专属强烈建议字段二：projectPath。Claude Code 的跨项目 resume 明确依赖 projectPath，并在不同项目时生成“cd 项目目录再 resume”的路径 claude-code/src/types/logs.ts#L19 和 claude-code/src/utils/crossProjectResume.ts#L30。
Claude 专属可选字段：worktreePath 或 worktreeSession 摘要。Claude Code 的 transcript 里显式持久化了 worktreeSession claude-code/src/types/logs.ts#L149，如果未来接入了 worktree/fork 模式，这个 locator 不能丢。
继续保留但降级为兼容字段：childConversationId、activeConversationId、activeRoleId。它们适合做 UI deep link 或当前运行态索引，不适合再承担恢复真相源。
明确不要持久化：Claude 原始 messages、tool events、permission events、raw step payload。那是 Phase 3 和 Phase 5 的范围，不是 Phase 2。
3. 预期代码落点

Run 类型层：在 Antigravity-Mobility-CLI/src/lib/agents/group-types.ts#L277 上扩展 AgentRunState，加入 sessionProvenance。
运行持久化层：在 Antigravity-Mobility-CLI/src/lib/agents/run-registry.ts#L178 和恢复逻辑 Antigravity-Mobility-CLI/src/lib/agents/run-registry.ts#L68 中把新字段稳定写入 runs.json，并允许老 run 缺字段但不让新 run 缺字段。
Backend 合同层：在 Antigravity-Mobility-CLI/src/lib/backends/types.ts#L34 的 BackendRunConfig 增加 resumeContext 或 sessionProvenance 输入；attach 仍保留在 Antigravity-Mobility-CLI/src/lib/backends/types.ts#L147，但不应再只吃一个裸 handle。
started 写回层：在 Antigravity-Mobility-CLI/src/lib/backends/run-session-hooks.ts#L44 把“started 时绑定 handle”的逻辑扩成“started 时绑定 sessionProvenance + 可选 conversation alias”。
恢复态编排层：把 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts#L551 的 attachExistingRunSession 改成只读 run.sessionProvenance；当前这段在 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts#L557 直接 resolveProvider，是要被 Phase 2 消掉的核心点。
API 恢复入口：项目级恢复 Antigravity-Mobility-CLI/src/app/api/projects/[id]/resume/route.ts#L32 和 run 级 intervene Antigravity-Mobility-CLI/src/app/api/agent-runs/[id]/intervene/route.ts#L12 应共享同一条“attach-from-provenance” helper，而不是一条读 run、一条读 workspace。
session-registry 和 session-consumer 不应变成持久化层。它们继续只做活跃会话索引和事件消费 Antigravity-Mobility-CLI/src/lib/backends/session-registry.ts#L23 和 Antigravity-Mobility-CLI/src/lib/backends/session-consumer.ts#L58。
前端类型层：如果 GET /api/agent-runs 直接透出新字段，需要同步 Antigravity-Mobility-CLI/src/lib/types.ts#L466，否则前后端会出现隐性漂移。
4. attach / resume 恢复态该怎么设计

恢复链应只有三步。先查进程内 active session；命中则直接用 Antigravity-Mobility-CLI/src/lib/backends/session-registry.ts#L37。未命中则读 run.sessionProvenance。仍未命中才进入 legacy fallback，而且 legacy fallback 只对旧 run 兼容，不能成为新 Claude 路径的默认逻辑。
attach 选 backend 时只看 sessionProvenance.backendId，不再看当前 workspace 的 resolveProvider。当前直接按 workspace 重新 resolve 的路径在 nudge、evaluate、restart_role 都还存在 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts#L557 和 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts#L1193。
recover 动作仍然保持“只看 artifact/result，不 attach session”。这条边界已经在 Antigravity-Mobility-CLI/src/app/api/projects/[id]/resume/route.ts#L239 和 Antigravity-Mobility-CLI/src/lib/agents/run-registry.ts#L68 形成了清晰分工，不应混成“recover 顺便 attach”。
nudge、cancel、evaluate 在“无 active session 但有 persisted provenance”的情况下，应先 attach，再执行 append/cancel/inspect。否则 Phase 4 还会继续沿用“重新猜 provider”的不稳定模式。
restart_role 或 fork-session 应总是生成新 external handle，并把旧 handle 标成 superseded。恢复态写回必须只认当前 authoritative handle，不能让旧 handle 重新覆盖 run。
conversation 映射建议采用“双轨”。canonical 真相源是 sessionProvenance.handle；childConversationId 只在存在真实可打开 surface 时做 alias。否则 Claude sessionId 一旦直接塞到 childConversationId，当前 UI 会把它当成可打开的 Web conversation。
恢复态需要明确区分三种状态：live-attached、persisted-detached、expired-or-missing。第三种要显式报错，不允许静默降级到别的 backend。
5. 最小测试集合

持久化回归一：Run 创建、更新、重载后，sessionProvenance 完整 round-trip。这个测试应落在 Antigravity-Mobility-CLI/src/lib/agents/run-registry.test.ts 旁边。
恢复态回归一：session-registry 清空后，cancel 或 nudge 仍能根据 persisted provenance attach 到原 backend，而不是受当前 workspace provider 变化影响。这是 Phase 2 最关键的一条回归。
恢复态回归二：故意在 run 创建后修改 department/provider 配置，再做 attach。预期仍命中原 backend，不命中新配置。
显式失败回归：attach 失败时不能静默本地取消，也不能 silently reroute。现有 antigravity 路径已有护栏 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts#L1063 和 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts#L1083，Claude 路径要补同类用例。
lineage 回归：restart_role 或 fork 后，旧 handle 的晚到事件不能写回当前 run。shared conversation 的 superseded 护栏已经有 precedent Antigravity-Mobility-CLI/src/lib/agents/group-runtime.multi-role.test.ts#L681。
兼容回归：已有 evaluate、timeout、malformed-response、attached timeout、superseded 测试必须继续通过 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts#L887 和 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts#L1132。
Claude locator 回归：如果 transcriptPath 或 worktreePath 已失效，应返回明确的“session expired / locator invalid”，而不是 fallback 到别的 workspace。Claude Code 自己的 worktree 恢复就是显式失败并清除 stale state claude-code/src/utils/sessionRestore.ts#L409。
6. 风险与避免越界项

最大风险是一边说“Claude session 只落在 execution thread 层”，一边又把它当成 Run 的主对象。这个越界会直接违反模型映射文档 Antigravity-Mobility-CLI/docs/design/claude-code-model-mapping-2026-04-10.md#L60。
第二个风险是继续复用 childConversationId 充当所有 backend 的通用主键。它今天带有很强的 Antigravity conversation surface 语义，不适合直接承载 Claude sessionId。
第三个风险是把 Phase 2 扩成“Conversation API 接 Claude Code”。当前 conversation routes 仍明显是 antigravity/codex 取向 Antigravity-Mobility-CLI/src/app/api/conversations/route.ts#L188 和 Antigravity-Mobility-CLI/src/app/api/conversations/[id]/send/route.ts#L13，这不是本阶段该做的事。
第四个风险是把 raw Claude transcript、tool event、permission event 提前塞进 Run。那会直接提前进入 Phase 3 和 Phase 5。
第五个风险是把 durable truth 从 RunRegistry 挪到 session-registry。当前 detailed design 已明确否定这条路 Antigravity-Mobility-CLI/docs/design/agent-backend-abstraction-detailed-design.md。
明确避免越界项：不做事件归一化，不做 permission 映射，不做 Claude 原生 UI 复刻，不做 control-plane 字段扩张，不为 Claude 会话重写 Project / Run / Stage。
7. 退出条件 / 验收标准

新 Claude run 在持久化层里拥有完整的 sessionProvenance，而且 runs.json 重载后仍可恢复。
项目级 resume 和 run 级 intervene 都不再依赖“当前 workspace 再 resolveProvider 一次”来选 attach backend。
在模拟进程重启、session-registry 清空、provider 配置漂移之后，nudge、cancel、evaluate 仍然能命中原 session 或显式报“session expired”，不会命中错误 backend。
recover 动作仍是 artifact-only；restart_role / fork 会生成新 handle，并正确标记 superseded lineage。
Run 仍然是真相源；session-registry 仍然只是缓存；没有引入第二个 durable session store。
Claude session 没有被抬升成 Run 真相源；没有把 Claude raw event 塞进 control plane。
如果 Claude handle 暂时不可打开为 Web conversation，前端不会再因为 childConversationId 非空就展示无效“打开对话”入口。
8. 对后续阶段的依赖影响

对 Phase 3 是硬前置。没有稳定的 sessionProvenance，后续 raw event 到 Step / liveState 的绑定对象就不稳，事件归一化会被迫继续依赖当前 workspace 配置。
对 Phase 4 也是硬前置。append、attach、cancel、evaluate 全都依赖“先找到正确外部 session”，否则 intervention 还会继续在 group-runtime 里长 provider 特判。
对 Phase 5 是低耦合前置。tool trace、permission、artifact 细粒度回传都需要稳定 handle 作为外部 trace anchor。
对上线路由也有直接价值。只有把 backendId、resolutionSource、model、locator 写进 provenance，后面才谈得上 fallback、回滚、灰度和 drift 诊断。
反过来说，如果跳过 Phase 2 直接做 Phase 3/4，最后得到的不会是“Claude Code 接入完成”，而是“恢复态和路由一直依赖瞬时 workspace 配置”的脆弱实现。


第三阶段：
最稳的 Phase 3 方案，是把 Claude Code 接在 QueryEngine/ask 这一层做归一化，而不是往下吃 provider 原始 SSE，也不是只看 CLI 最终文本。原因很直接：上层文档已经写死“Claude event、tool、result 必须先归一化，再进入平台主链”，而 Antigravity 当前最成熟的执行接缝也正是 AgentBackend → AgentSession → session-consumer 这条链。Antigravity-Mobility-CLI/docs/design/claude-code-integration-master-plan-2026-04-10.md Antigravity-Mobility-CLI/docs/design/claude-code-model-mapping-2026-04-10.md Antigravity-Mobility-CLI/docs/design/task-b-current-state-2026-04-10.md Antigravity-Mobility-CLI/src/lib/backends/types.ts Antigravity-Mobility-CLI/src/lib/backends/session-consumer.ts

推荐顺序是：

在 Claude Code 侧以 claude-code/src/QueryEngine.ts 和 claude-code/src/query.ts 暴露出来的 stream_event、assistant/user message、tool_use_summary、result 作为采集边界。
在 Antigravity 侧新增一层 provider-neutral 的运行态 Step 合同，再由 Claude backend 把这些事件压成 Step、liveState、TaskResult。
原始 Claude stream_event 和 message block 只保存在 run artifact 下的调试 trace，不进入 Run 主合同。
备选方案里，直接吃 claude-code/src/services/api/claude.ts 或各 provider streamAdapter 的原始事件太低层，容易把 Anthropic/OpenAI/Gemini 的流式语义直接带进平台；只消费 CLI/SDK 最终 result 又太高层，会丢掉 Step 和 liveState，后面 Phase 4 的 evaluate、attach、resume 会很弱。

映射方案 当前仓库有 liveState 和 result contract，但还没有真正 provider-neutral 的运行态 Step；现有 Step 更偏 CORTEX/IDE 对话 protobuf，前端也硬编码了 CORTEX_STEP_TYPE 语义，所以 Phase 3 不该直接把 Claude 原始块塞给现有 Step UI。Antigravity-Mobility-CLI/src/lib/types.ts Antigravity-Mobility-CLI/src/components/chat.tsx Antigravity-Mobility-CLI/src/components/role-detail-panel.tsx

Step 最小建议字段应是：provider、kind、status、title、preview、toolCategory、toolName、affectedPaths、timestamp、rawRef。这里的 rawRef 只指向 trace，不把 raw event 本身挂进 Run。

需要映射的 Claude event 类别与落点：

stream_request_start、message_start、message_delta、message_stop 这类生命周期事件，只更新 liveState，不必都生成用户可见 Step。liveState 继续复用现有字段：cascadeStatus 只保留 running 或 idle，stepCount 在“生成一个完整 normalized step”时递增，lastStepType 使用 assistant_text、reasoning、tool_call、tool_result、warning 这类平台枚举，staleSince 由 backend 内部计时器维护。
text content block 和最终 assistant message，映射为 Step.kind = assistant_text。它们是 summary 的一号候选来源，但不是 changedFiles 来源。
thinking 和 redacted_thinking，映射为 Step.kind = reasoning，但默认折叠或隐藏；只参与活跃度判断，不进入 result summary，不写进 result envelope。
tool_use、server_tool_use、mcp_tool_use，统一映射为 Step.kind = tool_call。这里再做二级 toolCategory 分类：file_read、file_write、search、command、web、agent_orchestration、planning、external、blocker。只有 file_write 类别进入 changedFiles 候选。
tool_result、mcp_tool_result、code_execution_tool_result、container_upload，统一映射为 Step.kind = tool_result。它们承担“这次工具调用成功/失败/被拒绝/要求用户输入”的判定来源。
tool_use_summary、task_progress、api_retry、system warning，最多映射为 status 或 warning Step；更推荐只做 trace 和简短状态，不把它们升格为平台业务结果。
result.success 和 result.error 系列，才负责最终 TaskResult。成功时 summary 优先级应是 result.result，其次最后一个 assistant_text，再其次最近一次 tool_use_summary；错误时默认 failed，只有最后一次 blocker 类工具明确是 permission 或 user question 未满足时才转 blocked。claude-code/src/entrypoints/sdk/coreSchemas.ts claude-code/src/utils/queryHelpers.ts
需要映射的 Claude tool 类别：

FileEdit、FileWrite、NotebookEdit，归到 file_write，直接从 tool input 提取 affectedPaths，作为高置信 changedFiles。
FileRead、Glob、Grep、LSP，归到 file_read 或 search，只进 Step，不进 changedFiles。
Bash、PowerShell、REPL，归到 command。Phase 3 不要从 shell 输出猜 changedFiles；没有快照对比就宁可少报。
WebFetch、WebSearch、WebBrowser，归到 web。
AgentTool、TaskCreate、TaskGet、TaskUpdate、TaskList、SendMessage、team tools，归到 agent_orchestration，只作为执行轨迹，不映射成平台 Stage。
EnterPlanMode、ExitPlanMode、TodoWrite、Brief、Skill、ToolSearch、TaskOutput，归到 planning，只进 Step。
MCP/resource、cron、workflow、remote trigger、push notification 等，归到 external。
AskUserQuestion 和 permission denial，归到 blocker。它们只能变成 execution-plane blocker，不能映射成平台 approval 或 governance。claude-code/src/tools.ts
落到 result envelope 的规则应是：

status 只来自平台自己的 completed、blocked、failed、cancelled、timeout 五类，不直接暴露 Claude 的 subtype 或 stop_reason。
summary 来自 Claude 最终 success result 或最后一个稳定 assistant_text，不从 thinking 提取。
changedFiles 只取高置信 file_write 路径，shell 和 MCP 写入先不承诺全量准确。
blockers 来自 permission denial、ask user、明确 tool error、result.error 信息。
needsReview Phase 3 默认可为空；除非 Claude trace 里有明确待审文件信号，否则不要猜。
raw Claude event、tool input/output、stop_reason 只进 trace artifact，不进 result envelope。Antigravity-Mobility-CLI/src/lib/agents/run-artifacts.ts Antigravity-Mobility-CLI/src/lib/agents/finalization.ts Antigravity-Mobility-CLI/src/lib/agents/prompt-executor.ts
代码落点与测试 预期代码落点：

主合同和 hook 链仍应沿用 Antigravity-Mobility-CLI/src/lib/backends/types.ts、Antigravity-Mobility-CLI/src/lib/backends/session-consumer.ts、Antigravity-Mobility-CLI/src/lib/backends/run-session-hooks.ts。Phase 3 最值得新增的是“normalized step”字段或并行 trace 载体，不要继续把 unknown[] rawSteps 当主合同。
Claude backend 自己应拆出事件归一化、工具分类、结果归一化、trace 写入几块逻辑，放在 backends 目录，不要塞回 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts。
result 收口继续复用 Antigravity-Mobility-CLI/src/lib/agents/run-artifacts.ts 和 Antigravity-Mobility-CLI/src/lib/agents/finalization.ts；raw trace 应落在 artifactDir 的非 manifest 扫描目录，避免被误当 deliverable。
如果 Phase 3 要让页面看 Step，优先新增 run-step 兼容层，影响面会落到 Antigravity-Mobility-CLI/src/lib/types.ts、Antigravity-Mobility-CLI/src/components/chat.tsx、Antigravity-Mobility-CLI/src/components/role-detail-panel.tsx。不建议直接把 Claude block 映射成假 CORTEX protobuf。
最小测试集合：

事件归一化单测：覆盖 text、thinking、tool_use、tool_result、tool_use_summary、result.success、result.error 的映射。
工具分类单测：至少锁住 file_write、file_read、search、command、web、agent_orchestration、external、blocker 八类。
结果归一化单测：锁 summary 优先级、blocked 与 failed 分流、高置信 changedFiles 提取、thinking 不泄漏到结果。
backend 集成测试：started → live_state → completed 主链，cancel 后忽略晚到 success，timeout/stream idle 路径，raw trace 存在但 result envelope 不受污染。
运行时 finalization 测试：写出 result.json、result-envelope.json、artifacts.manifest.json，风格对齐 Antigravity-Mobility-CLI/src/lib/backends/builtin-backends.test.ts、Antigravity-Mobility-CLI/src/lib/backends/session-consumer.test.ts、Antigravity-Mobility-CLI/src/lib/agents/result-parser.test.ts、Antigravity-Mobility-CLI/src/lib/agents/run-artifacts.test.ts、Antigravity-Mobility-CLI/src/lib/agents/prompt-executor.test.ts、Antigravity-Mobility-CLI/src/lib/agents/finalization.test.ts。
风险、验收与后续依赖 风险与避免越界项：

不要把 Claude session、tool loop、permission flow 抬升成 Run、Stage 或平台 approval。
不要把 thinking 或 raw stop_reason 直接暴露给 control plane。
不要承诺 shell、MCP、外部服务产生的全量 changedFiles；Phase 3 只做高置信路径。
不要为 Claude 扩宽 group-runtime 的特判；继续沿用 Task B 已经收好的 backend seam 和 extension 思路。Antigravity-Mobility-CLI/src/lib/backends/extensions.ts
不要追求完整 Claude Code 产品壳 parity；Phase 3 只做平台合同归一化。
退出条件 / 验收标准：

Claude run 的 liveState 能稳定驱动 stepCount、lastStepType、staleSince，且不要求上层理解 Claude raw event。
Claude run 完成后，平台拿到的是 TaskResult 和 result envelope，而不是 Claude 原始 result subtype。
run artifact 下同时存在 normalized step trace 和 raw trace，但 RunRegistry 与页面不依赖 raw trace 结构。
页面或 run 记录若展示 Step，只消费平台 Step 合同，不出现 Claude 原生 block 名或 stream_event 类型。
更换 Claude 侧 provider stream 实现，不需要改 Antigravity 的 Run、Stage、result 合同。
对后续阶段的依赖影响：

它依赖 Phase 2 已把 external handle 和 provenance 持久化；没有这一层，Phase 3 的 trace 和 terminal result 会挂不到稳定 run 上。
它直接决定 Phase 4 的 attach、resume、evaluate 能不能复用“normalized recent steps + raw trace”，而不是再回头吃 Claude 原始 event。
它会为 Phase 5 的 tool permission、artifact、changedFiles 深化整合留好位置；如果 Phase 3 先偷懒透传 raw event，Phase 5 会被迫做二次迁移。
它对 Phase 6 路由几乎是正向帮助：一旦 result envelope 统一，Claude executor 才能和 Native、Direct Open API backend 做同口径比较。

第四阶段：


Antigravity-Mobility-CLI/docs/design/claude-code-integration-master-plan-2026-04-10.md#L204)、Antigravity-Mobility-CLI/docs/design/claude-code-model-mapping-2026-04-10.md、Antigravity-Mobility-CLI/docs/design/task-b-current-state-2026-04-10.md 和当前 runtime，我建议把 Phase 4 定义成一句话： Claude Code 只提供 session control 和 transcript diagnostics，Antigravity 继续拥有 intervention contract、本地 run 真相源和 evaluate 判定权。

实现取向上，建议先做 embedded-local profile；如果后面明确要求跨进程 durable attach/cancel，再补 remote session profile。不要把 Claude Code CLI 的 --resume 当成第一代主 contract，因为它本质是 startup transcript 恢复，不是稳定的 backend attach API，证据在 claude-code/src/main.tsx、claude-code/src/main.tsx 和 claude-code/src/utils/sessionRestore.ts。

1. append / attach / cancel / evaluate 映射

平台动作	推荐映射	关键约束
append / nudge	活跃会话时走 AgentSession.append() 语义，Antigravity 当前入口就在 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts。Claude Code embedded 模式下，底层应映射到同一 QueryEngine.submitMessage() turn 继续发送，核心入口是 claude-code/src/QueryEngine.ts。如果走 remote session，则映射到 claude-code/src/remote/RemoteSessionManager.ts 和 claude-code/src/utils/teleport/api.ts。	append 只在同一 session 继续对话，不改变 Run/Stage。若 backend 不支持 append，必须显式失败，不能静默降级。
attach / resume	继续使用现有 attach(config, handle) seam，定义在 Antigravity-Mobility-CLI/src/lib/backends/types.ts。但 Claude Code 的 handle 不应只是一串裸字符串，而应配套持久化 provenance。embedded 模式下，attach 实际是 transcript/session 恢复：先 claude-code/src/utils/conversationRecovery.ts 再 claude-code/src/utils/sessionRestore.ts。remote 模式下，attach 才接近真正 sessionId 级重连，入口是 claude-code/src/remote/RemoteSessionManager.ts。	不要把 embedded transcript resume 伪装成 mid-flight provider attach。它更接近“恢复可继续的会话”，不是“重新接回正在跑的 worker”。
cancel	活跃 embedded 会话直接映射到 claude-code/src/QueryEngine.ts 的 interrupt()，并由 claude-code/src/query.ts 和 claude-code/src/query.ts 消费 abort signal。remote 模式下映射到 claude-code/src/remote/RemoteSessionManager.ts 的 interrupt control request。Antigravity 侧继续保留 cancelRequested 与晚到 completion 抑制逻辑，位置在 Antigravity-Mobility-CLI/src/lib/backends/session-consumer.ts。	embedded 模式只对当前进程内活跃 query 提供真实 cancel。对“已退出进程后残留的历史 transcript”不能假装还能 cancel。
evaluate	不映射成“Claude Code 原生 inspect API”，因为我没有找到可直接复用的 native diagnostics endpoint。建议复用 Antigravity 当前 Task B 完成后的模式：Claude Code backend 只提供 diagnostics extension，位置参照 Antigravity-Mobility-CLI/src/lib/backends/extensions.ts。其数据源优先用活跃 engine 的 message buffer，入口是 claude-code/src/QueryEngine.ts；否则回退 transcript/log，入口是 claude-code/src/utils/sessionStorage.ts、claude-code/src/utils/sessionStorage.ts、claude-code/src/utils/conversationRecovery.ts。判定本身继续先交给平台 evaluator，当前 group-runtime 仍硬编码 Antigravity evaluator，见 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts。	evaluate 的本质是“平台用 Claude transcript 做诊断输入”，不是“把评价权交回 Claude executor”。
2. 预期代码落点

Claude Code backend 本体应做成独立 backend 模块，风格直接参考 Antigravity-Mobility-CLI/src/lib/backends/builtin-backends.ts，不要继续把所有逻辑塞回同一个内建文件。
Run 持久化层必须补一个结构化 provenance 字段。当前 Antigravity-Mobility-CLI/src/lib/agents/group-types.ts 只有 childConversationId、activeConversationId、executorKind 和 supervisor 字段，没有 backend provenance；Antigravity-Mobility-CLI/src/lib/agents/run-registry.ts 也没有创建它。Phase 4 应新增 backendSessionRef 或 sessionProvenance，至少包含 backendId、mode、sessionId、transcriptPath/fullPath、worktree/cwd。
恢复态逻辑要从“现猜 provider”改成“先读 run provenance”。当前风险点就在 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts 和 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts。
evaluate 优先复用现有 diagnostics extension，不建议先改 extension contract。只有当 transcript 归一化成 pseudo-steps 明显不够用时，才扩成 “recent diagnostics entries”。
API 层保持平台 verb 不变，只做 capability gate。关键入口是 Antigravity-Mobility-CLI/src/app/api/agent-runs/[id]/intervene/route.ts、Antigravity-Mobility-CLI/src/app/api/projects/[id]/resume/route.ts、Antigravity-Mobility-CLI/src/mcp/server.ts。
不要把 evaluate 建在 claude-code/src/services/sessionTranscript/sessionTranscript.ts 上，这个服务当前还是 stub。
3. 恢复态与异常矩阵要点

场景	期望行为
活跃 embedded 会话仍在进程内	append 可用，cancel 可用，evaluate 读内存态 messages。优先走 session registry，而不是重新 attach。
embedded 会话已结束但 transcript 可恢复	attach/resume 可用，随后允许 append 新一轮消息；这是历史会话恢复，不承诺 mid-flight reattach。
remote sessionId 可重连	attach、append、cancel 都可成立；cancel 走 interrupt，不是本地 abort。
provenance 缺失或失配	attach/cancel/evaluate 明确失败，不允许像现在这样再次 resolveProvider() 猜 backend。这个要求也和 Antigravity-Mobility-CLI/docs/design/agent-backend-event-rereview-2026-04-09.md 一致。
append 或 attach 不支持	显式抛出 capability error，语义对齐现有 attach-not-supported 路径，而不是 silently no-op。
cancel 后晚到 completion	保持 run 为 cancelled，丢弃晚到 completion，继续使用 Antigravity-Mobility-CLI/src/lib/backends/session-consumer.ts 的策略。
evaluate 读到空 transcript、malformed transcript、interrupted turn	产出“诊断不可用 / STUCK 风格”的平台诊断，不让 evaluate 本身炸掉。Task B 当前已经把这类思路锁进矩阵，见 Antigravity-Mobility-CLI/docs/design/task-b-current-state-2026-04-10.md。
shared / attached 会话被 superseded	跟现有 shared attached-session 一样，停止 writeback，不拿旧分支结果覆盖新分支，参考 Antigravity-Mobility-CLI/docs/design/task-b-current-state-2026-04-10.md。
worktree/cwd 与 transcript 所属目录不一致	attach 失败并提示 provenance mismatch，不允许偷偷切目录。Claude Code 恢复本身就会恢复 worktree，见 claude-code/src/utils/sessionRestore.ts。
4. 最小测试集合

活跃会话 append 成功：对齐现有 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts。
unattached attach 后再 append 成功：对齐 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts 和 shared reuse 样式 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.multi-role.test.ts。
attach unsupported 显式失败：对齐 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts。
active cancel 成功并抑制晚到 completed：要覆盖 session registry + consumer 行为，核心合同在 Antigravity-Mobility-CLI/src/lib/backends/session-registry.ts 和 Antigravity-Mobility-CLI/src/lib/backends/session-consumer.ts。
evaluate 成功路径：对齐 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts，但输入换成 Claude transcript diagnostics。
evaluate failed / cancelled / malformed：直接保留三条矩阵样式 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts、Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts、Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts。
attached session timeout / superseded：保留 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts 和 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.multi-role.test.ts。
API capability gate：扩展 Antigravity-Mobility-CLI/src/app/api/agent-runs/[id]/intervene/route.ts 到 Claude Code capability matrix。
如果补 remote profile，再额外加一条：append 命中 claude-code/src/remote/RemoteSessionManager.ts，cancel 命中 claude-code/src/remote/RemoteSessionManager.ts。
5. 风险与避免越界项

不要继续复制当前“恢复态重新猜 provider”的模式。总纲已经要求 provenance-first，见 Antigravity-Mobility-CLI/docs/design/claude-code-integration-master-plan-2026-04-10.md。
不要把 embedded transcript resume 宣称成 provider-native attach。这会让后续 cancel、timeout、superseded 语义全变形。
不要为 Claude Code 新造对外 verb。继续只暴露平台 verb：nudge、attach/resume、cancel、evaluate。现有路由已经是这个口径，见 Antigravity-Mobility-CLI/src/app/api/agent-runs/[id]/intervene/route.ts。
不要把 evaluator ownership 交给 Claude Code。当前平台 evaluator 仍可复用，Claude Code 先只做 diagnostics provider。
不要依赖 CLI subprocess + --resume 作为主干预层。它更像用户入口，不像稳定 backend API。
如果做 remote profile，不要提前把 cloud session auth、policy、filesystem 同步、artifact ownership 一起卷进 Phase 4。那是 Phase 5/6 问题。
6. 退出条件 / 验收标准

Run 已持久化 Claude session provenance，恢复态不再靠 workspace 配置重新猜 backend。
append、attach/resume、cancel、evaluate 都通过 backend session / diagnostics seam 落地，而不是在 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts 里再长 Claude-specific 分支。
Phase 4 最小测试集全部通过，尤其是 malformed / timeout / superseded / unsupported 四类护栏。
API / MCP 仍只暴露平台 contract，不暴露 Claude Code 内部 session/event shape。
evaluate 的输入来自 Claude transcript diagnostics，但评价结论仍写进平台自己的 supervisorReviews，位置在 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts。
用户态结果不要求一比一复刻 Claude Code 原生体验，只要求平台 contract 成立。
7. 对后续阶段的依赖影响

这一步会直接决定 Phase 5 能否稳定接 tool/permission/artifact 深化整合。没有 provenance 和 cancel contract，后面一定会回头返工。
这一步也会影响后续 retry/restart_role 设计。Claude Code 已有 --fork-session 语义，见 claude-code/src/main.tsx；后续更适合把它映射成“forked retry”，而不是在平台层再造一套 session branching 语义。
Phase 6 路由策略会依赖这里的 capability matrix。是否支持 durable attach、是否支持 true cancel、是否只有 transcript-based evaluate，都会影响哪些 stage 能默认路由到 Claude Code。
如果现在把 evaluate 做成 backend diagnostics extension，后面接别的 executor 时也能复用，不会再把 orchestration 层污染回 provider-specific inspect 逻辑。
如果现在跳过 provenance 持久化，后面所有恢复态操作都会继续卡在 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts 这种现猜 provider 的旧模式里。
按你的只读要求，这次没有改仓库，也没有更新 Antigravity-Mobility-CLI/docs/PROJECT_PROGRESS.md。

如果你要我继续细化，我建议下一步只定两件事：

Phase 4 首发是否只做 embedded-local profile，还是一开始就同时带 remote session profile。
evaluate 是否继续复用现有 Antigravity supervisor backend，还是要同步设计 Claude Code 自评版本。


第五阶段：

Antigravity-Mobility-CLI/docs/design/claude-code-integration-master-plan-2026-04-10.md)、Antigravity-Mobility-CLI/docs/design/claude-code-model-mapping-2026-04-10.md、Antigravity-Mobility-CLI/docs/design/task-b-current-state-2026-04-10.md 和当前代码，我建议把 Phase 5 定义成一句话： 在现有 execution seam 上增加“规范化的权限事件、终态变更汇总、可选 trace 产物、审批回调续跑”四个能力，而不是把 Claude Code 的 PermissionContext、附件、文件历史或 REPL 壳直接搬进 Antigravity。

当前最稳的落法，是复用 Task B 已验证的 optional extension 模式。Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts#L1199 和 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts#L1264 已经通过 diagnostics 和 metadata writer 证明这个方向可行，Antigravity-Mobility-CLI/src/lib/backends/builtin-backends.test.ts#L445 也已经把这种扩展边界锁住了。

实现选项

推荐方案是“暂停-审批-续跑”。Claude backend 在运行中发出规范化 permission_request 事件，Antigravity 决定本地放行、拒绝，或升级为 CEO 审批；审批通过后同一 session 继续执行。这条路最符合“深度整合”，但要求把 approval callback 真正接通。
次优方案是“阻塞-审批-重试”。权限命中后直接把 run 转成 blocked，同时创建 tool_access 或 scope_extension 审批；审批后通过 retry 或 restart_role 重新进入执行。这条路改动小，但不是真正的 session 级权限续跑。
不建议的方案是直接嵌入 Claude Code 的权限壳，尤其是 claude-code/src/hooks/toolPermission/PermissionContext.ts 和 claude-code/src/utils/permissions/filesystem.ts。这会把平台反向塑形成 Claude 的产品模型。
1. 整合点

Tool permission 的真正接缝应放在 backend session 边界，而不是 control plane。Claude Code 上游语义在 claude-code/src/Tool.ts、claude-code/src/types/permissions.ts、claude-code/src/utils/permissions/PermissionUpdate.ts；Antigravity 侧最合适的消费面是 Antigravity-Mobility-CLI/src/lib/backends/types.ts、Antigravity-Mobility-CLI/src/lib/backends/session-consumer.ts、Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts。建议只引入一个平台自有的规范化 permission request 对象，字段只保留 tool、target、reason、scope、runId、handle、providerId，不带原始 Claude rule/update 结构。
Artifact 的真相源必须继续留在 Antigravity-Mobility-CLI/src/lib/agents/run-artifacts.ts#L120、Antigravity-Mobility-CLI/src/lib/agents/run-artifacts.ts#L227 和 Antigravity-Mobility-CLI/src/lib/agents/finalization.ts。Claude Code 的 claude-code/src/utils/toolResultStorage.ts 只是“大工具输出持久化”，不是平台 artifact contract；最多只能作为 trace evidence 落进 artifactDir，再由 Antigravity 显式决定是否进入 manifest。
changedFiles 的 canonical 写入点仍然应是 TaskResult.changedFiles 和后续 scope audit 链路，也就是 Antigravity-Mobility-CLI/src/lib/agents/group-types.ts、Antigravity-Mobility-CLI/src/lib/agents/run-artifacts.ts#L86、Antigravity-Mobility-CLI/src/components/agent-run-detail.tsx。不要把 claude-code/src/utils/attachments.ts#L2064 的 changed files attachment 当成平台最终 changedFiles，因为那是“已读文件后续被外部修改”的附件逻辑，不是 run 结果合同。更稳的来源是 Claude 的写工具结果：claude-code/src/tools/FileEditTool/FileEditTool.ts 和 claude-code/src/tools/FileWriteTool/FileWriteTool.ts，再加一个终态 git 或 workspace scan 兜底。
approval 应复用现成框架，而不是重新造一套。现有类型和 UI/API 已具备基础能力：Antigravity-Mobility-CLI/src/lib/approval/types.ts#L19、Antigravity-Mobility-CLI/src/lib/approval/handler.ts、Antigravity-Mobility-CLI/src/app/api/approval/route.ts、Antigravity-Mobility-CLI/src/components/approval-panel.tsx。但当前最大缺口是 Antigravity-Mobility-CLI/src/lib/approval/dispatcher.ts 里的 callback 仍是 placeholder，所以今天它能“记请求、发通知、收响应”，还不能真正“恢复 run”。
2. 预期代码落点

Execution seam 仍应以 Antigravity-Mobility-CLI/src/lib/backends/extensions.ts 为中心扩展，不建议把 AgentBackend 主接口改成大而全。Phase 5 更适合新增两类 optional 能力：权限决策桥接，以及终态变更与 trace 汇总。
如果要支持真正的暂停-审批-续跑，最小核心改动应落在 Antigravity-Mobility-CLI/src/lib/backends/types.ts 和 Antigravity-Mobility-CLI/src/lib/backends/session-consumer.ts：增加一个平台自有的 permission_request 事件，而不是把 Claude 原始 tool event 流直接引入。
Claude backend 本身应与 Antigravity-Mobility-CLI/src/lib/backends/builtin-backends.ts 同层，职责是把 claude-code/src/hooks/toolPermission/PermissionContext.ts、claude-code/src/tools/FileEditTool/FileEditTool.ts、claude-code/src/tools/FileWriteTool/FileWriteTool.ts 这些上游能力翻译成 Antigravity 的 permission event、changedFiles candidates 和 trace evidence。
Orchestration 侧只应在 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.ts 做三件事：接收规范化 permission event、决定是否升级为 ApprovalRequest、在 approval callback 成功后选择 append 或 attach-resume。不要在这里出现 Claude rule、PermissionUpdate、structured_output 等原始对象。
Artifact 与 result 侧继续沿用 Antigravity-Mobility-CLI/src/lib/agents/run-artifacts.ts、Antigravity-Mobility-CLI/src/lib/agents/finalization.ts、Antigravity-Mobility-CLI/src/lib/agents/result-parser.ts。Phase 5 只需要让 Claude backend 在终态提供更稳的 changedFiles 和可选 trace 文件，不要让 backend 写 result-envelope。
Approval 续跑能力应落在 Antigravity-Mobility-CLI/src/lib/approval/dispatcher.ts、Antigravity-Mobility-CLI/src/lib/approval/handler.ts、Antigravity-Mobility-CLI/src/lib/approval/request-store.ts。当前 request store 已持久化 request 和 runId，但没有真正执行 onApproved 或 onRejected。
持久化层还需要补 run provenance。现在 Antigravity-Mobility-CLI/src/lib/backends/session-registry.ts 只在内存里保存 providerId 和 handle，而 Antigravity-Mobility-CLI/src/lib/agents/run-registry.ts 与 Antigravity-Mobility-CLI/src/lib/agents/group-types.ts 没有稳定保存 provider provenance；这对 approval 后重启恢复是硬伤。
3. 最小测试集合

扩展一个 backend 单测，模式对齐 Antigravity-Mobility-CLI/src/lib/backends/builtin-backends.test.ts#L445：验证 Claude backend 会暴露权限桥接和终态 changedFiles 汇总能力。
扩展 Antigravity-Mobility-CLI/src/lib/backends/session-consumer.test.ts：验证 permission_request 事件顺序、拒绝后 late completed 不会误落盘、批准后继续消费终态事件。
扩展 Antigravity-Mobility-CLI/src/lib/agents/run-artifacts.test.ts：验证 observed changedFiles、reported changedFiles、trace artifact 三者不会破坏现有 manifest 和 scope-audit 语义。
增加 approval handler 和 dispatcher 的专项测试，对应 Antigravity-Mobility-CLI/src/lib/approval/handler.ts 与 Antigravity-Mobility-CLI/src/lib/approval/dispatcher.ts：至少锁住 tool_access、scope_extension、resume_run callback 的幂等性与失败回滚。
扩展 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.test.ts：做一个 Claude-routed 单角色端到端用例，覆盖 permission hit、审批通过续跑、审批拒绝转 blocked。
如果 Phase 5 首次落地就要求 review-loop 也支持，再补一个 Antigravity-Mobility-CLI/src/lib/agents/group-runtime.multi-role.test.ts 用例；否则这个可以留到 Phase 5 的第二轮。
4. 风险与避免越界项

最大风险是把 tool permission 直接等同于 CEO approval。模型映射文档已经写死了：permission 先是 execution plane 语义，只有越过治理边界时才升级为 approval。
第二个风险是把 Claude 的内部存储当平台 artifact。尤其是 claude-code/src/utils/toolResultStorage.ts 和 claude-code/src/utils/fileHistory.ts，它们更像 Claude 自己的会话恢复与超大输出机制，不是 Antigravity 的交付合同。
第三个风险是用 read cache 或 attachment 逻辑冒充 changedFiles。真正会影响 scope audit 和 UI 的是 TaskResult.changedFiles，不是附件。
第四个风险是继续膨胀 Antigravity-Mobility-CLI/src/lib/backends/types.ts 主接口。Task B 证明 optional extension 足够好用，Phase 5 不应一次性扩成万能 backend。
第五个风险是 approval 记录能建、按钮能点，但 run 不能恢复。当前 Antigravity-Mobility-CLI/src/lib/approval/dispatcher.ts 就处于这个状态，所以这不是“锦上添花”，而是 Phase 5 能否闭环的 blocker。
第六个风险是把 Claude 原始结构写进 Antigravity-Mobility-CLI/src/lib/agents/group-types.ts 的 TaskResult、ResultEnvelope 或 AgentRunState。这会直接破坏 ownership 边界。
5. 退出条件 / 验收标准

一个走 Claude backend 的 run，遇到写工具或高风险 Bash 时，能够在 Antigravity 内部生成规范化 permission request，而不是暴露 Claude 原始对象。
session-local allow 或 deny 不需要改动 Run、Stage、artifact 合同；只有跨治理边界的请求才创建现有 ApprovalRequest 类型。
CEO 在 Antigravity-Mobility-CLI/src/components/approval-panel.tsx 上批准后，run 能确定性地续跑或确定性地终止，不能停留在“请求已批准但运行时无动作”的半完成态。
终态后仍由 Antigravity-Mobility-CLI/src/lib/agents/finalization.ts 产出 result.json、artifacts.manifest.json、result-envelope.json；Claude backend 不得自写平台 envelope。
changedFiles 能在 Antigravity-Mobility-CLI/src/components/agent-run-detail.tsx 正常显示，并被 Antigravity-Mobility-CLI/src/lib/agents/run-artifacts.ts#L86 的 scope audit 正确消费。
所有最小测试集合通过，并且 raw Claude permission、attachment、tool result shape 不进入持久化 run model。
6. 对后续阶段的依赖影响

Phase 5 依赖 Phase 2 真正落地 provider provenance 持久化。否则 approval 后的 resume 只能依赖内存中的 Antigravity-Mobility-CLI/src/lib/backends/session-registry.ts，进程重启就断。
Phase 5 依赖 Phase 3 的事件与结果归一化已经稳定，否则 permission、tool trace、changedFiles 会被迫直接透传 Claude 原始 shape。
Phase 5 依赖 Phase 4 的 attach、resume、cancel 语义稳定。没有这一步，approval callback 即便能执行，也没有可靠的恢复动作可调用。
对 Phase 6 的影响是双向的。路由策略理论上可以先上线，但如果没有 Phase 5 的权限与审批闭环，Claude Code 只能做“可跑的 executor”，还不能安全成为“可控的默认 executor”。
反过来，Phase 5 一旦把 permission request、approval callback、terminal changedFiles 做成平台自有合同，它会直接成为后续 craft 或 direct API backend 的可复用 execution contract，而不是只服务 Claude。
如果你要继续，我可以下一步把这份研究压成一版可直接落库的 Phase 5 设计文档结构。
也可以继续往下做，把这份方案拆成 file-by-file 的实施清单和测试矩阵。


第六阶段：

integration-master-plan-2026-04-10.md#L258), docs/design/claude-code-model-mapping-2026-04-10.md, docs/design/task-b-current-state-2026-04-10.md 和现有 execution seam，我建议把 Phase 6 定义成“配置驱动的保守默认切换”，不是“让 Claude Code 全面接管 execution plane”。现有代码已经有 provider 解析和 backend/session 主链：src/lib/providers/ai-config.ts, src/lib/agents/prompt-executor.ts, src/lib/agents/group-runtime.ts。真正缺口只有两个：一是 run 级 provider provenance 还没持久化，二是当前配置/UI 只面向 Antigravity/Codex，这决定了上线必须先走小范围、强 pin、可一键回退。 推荐方案

方案 A：两层路由。平台先判定任务属于 native-required、coding-shell 还是 api-light，再复用现有 resolveProvider() 做 scene/department/layer/default 解析。这是最推荐的。
方案 B：直接在模板 stage 上加 preferredExecutor。可做，但会把上线策略塞进模板 schema，第一阶段不值得。
方案 C：百分比动态流量切分。现有仓库没有成熟实验/流量控制面，不建议 Phase 6 首发就做。
1. 路由策略

路由入口继续放在 orchestration 进入 backend 之前，而不是散落到 backend 内部；现有 Prompt Mode 和 template dispatch 都已经在 execution 场景解析 provider，src/lib/agents/prompt-executor.ts 和 src/lib/agents/group-runtime.ts 就是现成接缝。
路由判定建议分三类。native-required：review-loop、shared conversation、evaluate、依赖 trajectory/annotation/owner routing/artifact review 的 stage，默认留在 Native。coding-shell：Prompt Mode、legacy-single、单角色 coding-heavy stage，Phase 6 v1 才允许切到 Claude Code。api-light：纯分析/总结/分类类任务，留给后续 direct API backend，不并入本次 Claude Code 上线。
不建议把 stage 规则硬编码成大量 if/else；更稳的做法是生成自定义 scene key，再走现有解析链。因为 scene 已允许自定义字符串，src/lib/providers/types.ts 和 src/lib/providers/types.ts 已经留了口子。推荐 scene key 形态是 execution.native-required、execution.coding-shell、execution.api-light，再加可选 stage.<templateId>.<stageId> 覆盖。
路由决策必须在 run 创建时冻结，并持久化 resolvedProvider、resolvedModel、routeSource、routeSceneKey、sessionHandle。原因是当前 providerId 只存在于内存 session registry，src/lib/backends/session-registry.ts，而 intervention 路径在 session 不在时会重新 resolveProvider()，src/lib/agents/group-runtime.ts。如果上线期间配置变化，nudge/evaluate/cancel 可能漂到错误 backend。
Claude Code v1 不应该接 review-loop 和 delivery-single-pass 默认流量。仓库里现有 shared conversation、supervisor、authoritative conversation 等语义仍然偏 Antigravity，src/lib/agents/group-runtime.ts 和 src/lib/agents/group-runtime.ts。
2. fallback / rollback 设计

自动 fallback 只允许发生在“未拿到 started 事件 / 未拿到 handle / 未产生外部副作用”之前。典型可 fallback 场景是 Claude Code CLI 不存在、backend 启动失败、auth 缺失、workspace bootstrap 失败、模型配置非法。此时同一个 Run 可以原地退回 Native。
一旦 Claude Code 已经发出 started 或 session handle 已写入 run，就禁止同 Run 自动切 Native。否则会造成双 executor 竞争修改同一 workspace，破坏 artifact 和 changedFiles 语义。这个阶段只能终态失败/超时/取消，然后由平台显式 restart_role 或新建 run。
fallback 判定建议分三档。prestart-retryable：自动切 Native。started-but-no-terminal：进入失败并保留 handle/route 元数据。terminal-but-invalid-result：fail closed，不把异常结果伪装成 completed。
rollback 以配置级回退优先、代码级回退其次。建议准备两个 kill switch：AG_CLAUDE_CODE_ENABLED=0 禁止 backend 注册，AG_FORCE_EXECUTION_PROVIDER=antigravity 强制新 run 走 Native。这样回退只影响新 run，不打断已启动且已 pin 的 Claude 会话。
rollback 期间必须允许已在跑的 Claude 会话自然终结或被手动取消，不能因为切回 Native 就把旧会话 attach 到新 provider。这条约束直接来自 docs/design/claude-code-model-mapping-2026-04-10.md。
run schema 变更必须是 additive。旧代码即使不识别 executionProvider、routeSource 等字段，也不应影响读取历史 run；否则配置回退会变成数据迁移问题。
3. 配置与开关建议

组织级默认继续复用现有 src/lib/providers/ai-config.ts。Phase 6 不需要另起一套 routing config；scene > department > layer > default 这条链已经够用，docs/guide/agent-user-guide.md 也已有说明。
workspace canary 直接复用部门配置。.department/config.json 已有读写 API 和 UI，src/app/api/departments/route.ts 与 src/components/department-setup-dialog.tsx 证明这层是现成的。Phase 6 首批 canary 最适合用 workspace allowlist，而不是全局默认切换。
但部门配置当前 provider 只支持 antigravity | codex，src/lib/types.ts；而 provider 工厂实际也只实现了这两个，src/lib/providers/index.ts。所以 Claude Code 上线前，不要复用 claude-api 或 custom 占位值，应该引入清晰的新 execution provider id，例如 claude-code，避免把“Claude Code executor”和“direct Claude API backend”混成一个概念。
组织级配置建议：
defaultProvider 继续保持 antigravity。
新增 scene override，让 execution.coding-shell 指向 claude-code。
management、evaluate、utility 保持 Native 或 direct API，不并入本轮。
workspace 级配置建议：
canary workspace 用 .department/config.json.provider = claude-code。
非 canary workspace 保持 auto，由组织级默认决定。
环境开关建议：
AG_CLAUDE_CODE_ENABLED：是否注册 Claude backend。
AG_FORCE_EXECUTION_PROVIDER：强制所有新 run 走指定 provider，用于紧急回退。
AG_CLAUDE_CODE_ALLOWLIST：仅允许指定 workspace 或 stage 进入 Claude 路由。
AG_CLAUDE_CODE_FALLBACK_MODE=prestart-only：明确禁止 mid-run 自动切换。
UI 暴露建议：第一阶段不要马上把 Claude Code 放进部门设置 UI 下拉。现有 UI 只有 auto/Antigravity/Codex，src/components/department-setup-dialog.tsx。更稳的顺序是先文件配置和隐藏开关 canary，再做 UI。
4. 最小验证集合

Provider 解析优先级。扩展 src/lib/providers/ai-config.test.ts 覆盖 claude-code 场景 key、自定义 scene、department override、kill switch 强制 Native。
Backend 合同与 session 生命周期。参照 src/lib/backends/builtin-backends.test.ts 补 Claude backend 的 started/completed/failed/cancelled/attach characterization。
Run/session 消费护栏。保留并复用 src/lib/backends/session-consumer.test.ts 和 src/lib/backends/session-registry.test.ts，重点验证 late completion after cancel、terminalSeen 后忽略事件、runId 替换注册。
Prompt Mode 路由。扩展 src/lib/agents/prompt-executor.test.ts 验证 canary workspace 命中 Claude 路由、result envelope 正常落盘、dispatch prestart failure 自动回退 Native。
Template legacy-single 路由。扩展 src/lib/agents/group-runtime.test.ts 覆盖 dispatch、cancel、restart_role、nudge 在 provider pin 下不会因配置变化而改 backend。
回退 smoke。增加一组配置切换测试：run A 以 Claude 启动后把全局 provider 改回 Native，确认 run A 仍走原 backend，新 run B 走 Native。
一条真实 E2E canary。选一个 Prompt Mode workspace 和一个 legacy-single coding stage，记录路由决策、session handle、result envelope、changedFiles、人工 kill switch 回退后的行为。
5. 风险与避免越界项

最大风险不是 Claude Code 本身，而是“路由配置变更后 intervention 漂移到另一 backend”。当前代码已经存在重新 resolve provider 的路径，src/lib/agents/group-runtime.ts，所以持久化 provenance 是 Phase 6 前置，不是优化项。
第二个风险是 handle 绑定仍偏 Antigravity。当前 run session hooks 默认只把 antigravity provider 的 handle 绑定到 childConversationId/activeConversationId，src/lib/backends/run-session-hooks.ts。如果 Claude Code 也需要 attach/nudge/evaluate，就不能在上线时继续把 handle 当“非持久”处理。
第三个风险是配置面不一致。类型层已经预留 claude-api/openai-api/custom，src/lib/providers/types.ts，但工厂层没有实现，src/lib/providers/index.ts。Phase 6 不要把这些占位 id 当作已可路由目标。
第四个风险是把 Phase 6 顺手做成“Claude Code parity 工程”。不要在这一阶段追 full tool permission 映射、review-loop parity、shared conversation parity、完整 event 透传；总纲已经把这些放在更后阶段，docs/design/claude-code-integration-master-plan-2026-04-10.md。
第五个风险是把 rollout 做成新的 control plane。组织级 ai-config 和部门级 provider override 已经足够，src/lib/providers/ai-config.ts 和 src/app/api/departments/route.ts 说明现在完全可以先用现成配置面，不要新增一套“路由后台”。
6. 退出条件 / 验收标准

可以接受“Claude Code 是默认强 coding executor”，但只限 Prompt Mode 与 legacy-single coding-heavy stage；review-loop、evaluate、shared conversation 仍默认 Native。
每个新 run 都能看到稳定的 route 决策元数据：provider、model、source、sceneKey、session handle。配置变化后，in-flight run 的 cancel/nudge/restart/evaluate 仍命中原 provider。
prestart fallback 已验证：Claude backend 启动失败时，同 Run 能自动回退 Native；post-start 不发生隐式跨 executor 切换。
kill switch 已验证：关闭 Claude 路由后，新 run 立即回到 Native，旧 run 不被错误 attach 或强制迁移。
最小测试集全部通过，并且至少有一条真实 canary run 证据覆盖 dispatch、completion、rollback 三段。
平台 ownership 未被改写：Run / Stage / artifact / governance / intervention contract 仍由 Antigravity 定义，这一点必须继续符合 docs/design/claude-code-model-mapping-2026-04-10.md。
一句话收口：Phase 6 最稳的技术方案不是“把 Claude Code 设成全局默认”，而是“先把 Claude Code 做成只覆盖 coding-shell 安全区间的可回退默认，并把 provider provenance 从瞬时配置升级成 run 级真相源”。

如果你要，我可以把这份内容压成一页更像 RFC 的 Phase 6 文档提纲。
如果你要，我可以继续只读把“run 级 provenance 需要新增哪些字段”再细化成字段级方案。


