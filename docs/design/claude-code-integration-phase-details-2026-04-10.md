# Claude Code 接入分阶段技术细则

日期：2026-04-10  
状态：统一版阶段细则

## 一句话结论

Claude Code 接入不应被当成一坨大工程去做，而应被拆成 6 个阶段，且每个阶段都围绕同一个总边界：

1. Antigravity 继续拥有平台语义
2. Claude Code 只落在 execution seam 后面
3. 每一阶段只引入必要能力，不提前吞掉下一阶段问题

这份文档不是重复总纲，而是把每个阶段的：

1. 代码落点
2. 合同变化
3. 测试集合
4. 风险
5. 退出条件

统一成一套能直接执行的口径。

---

## 1. 阶段依赖图

建议按下面的依赖顺序推进。

1. Phase 1：最小 executor adapter 跑通
2. Phase 2：session / provenance 稳定化
3. Phase 3：事件 / 结果归一化
4. Phase 4：intervention 能力补齐
5. Phase 5：tool / permission / artifact 深化整合
6. Phase 6：路由与上线策略

其中真正的硬前置关系有 3 条：

1. **Phase 2 是 Phase 3、4、5、6 的前置**
2. **Phase 3 是 Phase 5 的前置**
3. **Phase 4 是 Phase 5、6 的前置**

所以不要跳着做。

---

## 2. 跨阶段统一口径

先把所有阶段都共享的规则写死。

## 2.1 统一 ownership

永远保持：

1. Project / Run / Stage / artifact / governance 由 Antigravity 拥有
2. Claude Code session 只能映射到 execution thread / Conversation 层

## 2.2 统一持久化对象

后续所有阶段都应围绕 Run 上的 session provenance 展开，而不是临时字段拼接。

最少应统一这些字段：

1. backendId
2. handle
3. handleKind
4. workspacePath
5. workspaceUri
6. model
7. resolutionSource
8. createdVia
9. forkedFromHandle 或 supersedesHandle

Claude Code 相关 locator 不能丢：

1. transcriptPath
2. projectPath
3. worktreePath 或 worktreeSession 摘要

## 2.3 统一扩展方式

新增 Claude 能力时，优先复用 optional backend extension 模式，不要把主接口改成大而全。

## 2.4 统一验收口径

每阶段都必须同时满足：

1. 行为可跑通
2. 主模型不被外部 runtime 污染
3. 最小测试集合通过

## 2.5 细节来源

这份文档负责统一口径，但不再假装自己是最细粒度实现底稿。真正的 Multi Agent 原始细节，以 `docs/design/claude-code-phases/subagent-raw-reports-2026-04-10.md` 为准。

---

## 3. Phase 1 细则

## 3.1 目标

只证明一件事：

1. Claude Code 可以作为一条新的 execution backend 跑通单角色 coding 任务

## 3.2 只做范围

1. start / execute
2. external handle 回写
3. normalized summary / changedFiles / status 回写

## 3.3 不做范围

1. append
2. attach
3. cancel 恢复态
4. evaluate
5. raw event 吸收
6. tool permission

## 3.4 代码落点

1. 新增 Claude Code bridge adapter
2. 新增 Claude Code provider executor
3. 新增 Claude Code backend
4. RunRegistry 增加 providerId / providerSource / externalHandle 持久化

## 3.5 合同变化

最少需要：

1. provider id：claude-code
2. Run 持久化 provider provenance
3. externalHandle 字段

## 3.6 最小测试集合

1. provider 解析测试
2. backend started -> completed / failed 测试
3. RunRegistry 持久化回归
4. legacy-single coding stage 走 Claude backend 的 characterization test

## 3.7 退出条件

1. 一个 legacy-single coding stage 可以完整跑通
2. Run 正确记录 providerId、providerSource、externalHandle
3. 失败路径能正确写回 failed 和 lastError

---

## 4. Phase 2 细则

## 4.1 目标

把 Claude session 的恢复、attach、resume 真相源稳定到 Run provenance 上。

## 4.2 只做范围

1. sessionProvenance 持久化
2. provenance-first attach / resume
3. lineage / supersedes 基础字段

## 4.3 不做范围

1. 重新发明 durable session store
2. 把 childConversationId 继续当所有 backend 的唯一恢复主键

## 4.4 代码落点

1. AgentRunState 扩展 session provenance
2. RunRegistry 持久化新字段
3. run-session-hooks 在 started 时写 provenance
4. group-runtime 的恢复态改成先读 provenance

## 4.5 合同变化

统一 canonical 对象：

1. sessionProvenance

它是后续 Phase 3-6 的基础。

Claude Code 相关的恢复 locator 需要被视为 sessionProvenance 的一部分，而不是可有可无的附属信息。至少要考虑：

1. transcriptPath
2. projectPath
3. worktreePath 或 worktreeSession 摘要

恢复态口径建议统一成三种：

1. live-attached
2. persisted-detached
3. expired-or-missing

## 4.6 最小测试集合

1. Run provenance round-trip
2. provider 配置漂移后 attach 仍命中原 backend
3. attach 失败显式报错
4. old handle 的晚到事件不会覆盖新 handle

## 4.7 退出条件

1. 恢复态不再靠当前 workspace 再猜 provider
2. session-registry 继续只是内存缓存
3. provenance 能支撑 attach / resume / evaluate / cancel 的恢复

---

## 5. Phase 3 细则

## 5.1 目标

把 Claude event / tool / result 归一化成 Antigravity 自己的 Step / liveState / result envelope 语言。

## 5.1.1 采集边界

最稳的采集边界是 Claude Code 的 QueryEngine / query 层，不是 provider 原始 SSE，也不是只看 CLI 最终文本。

## 5.1.2 normalized step 最小 schema

至少应稳定这些字段：

1. provider
2. kind
3. status
4. title
5. preview
6. toolCategory
7. toolName
8. affectedPaths
9. timestamp
10. rawRef

## 5.1.3 result mapping rules

1. summary 优先 Claude 最终 success result，其次最后一个稳定 assistant_text
2. blocked 与 failed 要分流，不能一律落 failed
3. changedFiles 只取高置信 file_write 路径
4. raw event / tool input / output / stop_reason 只进 trace，不进 result envelope

## 5.2 只做范围

1. lifecycle event -> liveState
2. text / reasoning / tool_call / tool_result -> normalized steps
3. success / error -> TaskResult
4. raw trace 仅做 artifact evidence

## 5.3 不做范围

1. 直接透传 Claude 原始 event
2. 用 raw thinking 填 summary
3. 承诺 shell/MCP 写入的全量 changedFiles 正确率

## 5.4 代码落点

1. Claude backend 内部新增事件归一化层
2. 工具分类与结果归一化逻辑内聚在 backend
3. Run artifact 下新增 raw trace / normalized trace

## 5.5 合同变化

最少新增：

1. provider-neutral normalized step 结构

## 5.6 最小测试集合

1. event normalization 单测
2. tool 分类单测
3. result normalization 单测
4. backend integration started -> live_state -> completed 测试
5. finalization / artifact trace 回归

## 5.7 退出条件

1. 上层只消费平台 Step / liveState / TaskResult
2. Claude raw event shape 不泄漏进 control plane
3. result envelope 仍由平台自己产出

---

## 6. Phase 4 细则

## 6.1 目标

把 Claude Code 接到平台 intervention contract 上，但不把 intervention 语义交给 Claude 决定。

## 6.1.1 首发 profile

统一口径：

1. v1 先做 embedded-local profile
2. remote session profile 后补

不要把 Claude CLI 的 `--resume` 当成第一代稳定 attach API。

## 6.2 只做范围

1. append / nudge
2. attach / resume
3. cancel
4. evaluate diagnostics

## 6.3 不做范围

1. 直接把 Claude CLI resume 当作稳定 attach API
2. 把 evaluate 判定权交给 Claude executor

## 6.4 代码落点

1. Claude backend 补 session control / diagnostics extension
2. Run provenance 支持恢复态 intervention
3. API / MCP 继续只暴露平台自己的 verbs

恢复态 provenance 至少要能带：

1. backendId
2. sessionId 或 handle
3. transcriptPath 或 fullPath
4. worktree 或 cwd

## 6.5 合同变化

1. append / attach / cancel / evaluate 继续沿用平台 contract
2. Claude 只是 execution-plane provider

## 6.6 最小测试集合

1. active append 成功
2. unattached attach 后 append 成功
3. attach unsupported 显式失败
4. active cancel 后晚到 completion 被抑制
5. evaluate success / failed / cancelled / malformed
6. attached-session timeout / superseded

## 6.7 退出条件

1. intervention 不需要为 Claude Code 额外长一套平台语义
2. provenance-first 恢复态成立
3. evaluate 使用 Claude diagnostics，但 verdict 仍写入平台 supervisorReviews

---

## 7. Phase 5 细则

## 7.1 目标

增加规范化的 permission、artifact、changedFiles、approval 回调续跑能力。

## 7.1.1 当前 blocker

当前最大的 blocker 不是 permission 对象怎么定义，而是 approval dispatcher 的 callback 仍是 placeholder；在它真正接通之前，不能把 Phase 5 宣称成已闭环。

## 7.1.2 方案优先级

1. 首选：暂停-审批-续跑
2. 次选：阻塞-审批-重试
3. 不建议：直接搬运 Claude 原生 PermissionContext 产品壳

## 7.2 只做范围

1. permission_request 规范化事件
2. changedFiles 高置信汇总
3. trace artifact 留存
4. approval callback 后续跑

## 7.3 不做范围

1. 搬运 Claude 原生 PermissionContext 产品壳
2. 把 Claude 内部附件或 file history 当平台 artifact contract

## 7.4 代码落点

1. backend optional extensions 继续扩展
2. session-consumer 接 permission_request
3. approval dispatcher / handler 真正打通 resume callback
4. run-artifacts / finalization 继续保持平台 ownership

## 7.5 合同变化

1. 新增平台自有 permission request 对象
2. 不引入 Claude 原始 rule / update 结构到平台主模型

## 7.6 最小测试集合

1. backend permission bridge test
2. session-consumer permission event order test
3. approval callback 幂等与失败回滚 test
4. changedFiles / trace artifact test
5. Claude-routed 单角色端到端 permission approval test

## 7.7 退出条件

1. permission 能在平台内形成规范化事件
2. 批准后 run 能确定性续跑或终止
3. changedFiles 和 artifact 不破坏现有 finalization / scope audit 语义

---

## 8. Phase 6 细则

## 8.1 目标

让 Claude Code 成为“可控默认 executor”，而不是全面接管 execution plane。

## 8.1.1 路由 taxonomy

推荐的 scene / task taxonomy：

1. execution.native-required
2. execution.coding-shell
3. execution.api-light

## 8.1.2 rollout 开关

推荐显式保留这些开关名：

1. AG_CLAUDE_CODE_ENABLED
2. AG_FORCE_EXECUTION_PROVIDER
3. AG_CLAUDE_CODE_ALLOWLIST
4. AG_CLAUDE_CODE_FALLBACK_MODE=prestart-only

## 8.2 只做范围

1. coding-shell 安全区间路由
2. fallback / rollback
3. kill switch
4. canary workspace / stage 策略

## 8.3 不做范围

1. 全局默认切换 Claude Code
2. 百分比动态流量控制平台
3. 立即接 review-loop / shared-conversation / evaluate 默认流量

## 8.4 代码落点

1. 复用现有 ai-config 解析链
2. scene key / department override / env kill switch
3. run 级 route provenance 持久化

## 8.5 合同变化

1. route decision 应在 run 创建时冻结
2. in-flight run 不能因配置变化被切到另一个 executor

## 8.6 最小测试集合

1. ai-config 对 claude-code scene / department 解析测试
2. Prompt Mode canary 路由测试
3. legacy-single coding stage 路由测试
4. prestart fallback 测试
5. rollback / kill switch 测试
6. 一条真实 canary run 证据

## 8.7 退出条件

1. Claude Code 只在 coding-shell 安全区间内成为默认 executor
2. kill switch 生效且新旧 run 行为正确
3. fallback 只发生在 prestart-retryable 阶段

---

## 9. 统一禁止越界项

下面这些事，在任何阶段都不应该顺手做。

1. 把 Claude session 抬升成 Run 真相源
2. 让 Claude Code 拥有 Stage 定义权
3. 直接把 Claude raw event / tool / permission 结构写进平台主模型
4. 为 Claude Code 新造一套平台 verbs
5. 为了快，重新把 transport / session / resolver 逻辑污染回 group-runtime

---

## 10. 最后一句话

如果你后面真要按 Multi Agent 的方式推进 Claude Code 接入，最重要的不是“每个阶段都很详细”，而是每个阶段都要守住同一个判断：

> Claude Code 是 execution backend，不是平台本体；每一阶段只把必要能力接进 execution seam，不让 control plane 围着 Claude 的模型重写自己。