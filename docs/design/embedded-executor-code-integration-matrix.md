# 外部执行器代码集成复用矩阵

日期：2026-04-10  
状态：研究结论 / 代码级集成口径

## 一句话结论

如果目标不是 product-to-product integration，而是：

> 直接把 Claude Code 或 craft 的代码集成进 Antigravity，自身继续保留 Platform / Control Plane，再让它们适配我们的执行层合同。

那最准确的判断是：

1. **Claude Code 更像“高复用执行内核”**
2. **craft 更像“高复用 execution substrate 参考实现”**
3. **两者都不是可以整包搬进来就直接替掉 Antigravity Native Executor 的低成本方案**
4. **真正必须自己开发的部分，不管选谁都绕不过：Project / Run / Stage 映射、artifact/result contract、intervention semantics、scheduler/governance 接线**

如果必须先选一个做第一默认底座：

1. **短期优先 Claude Code**
2. **长期方向更接近 craft-style runtime + 自有 execution contract**

---

## 1. 这份文档回答什么

这份文档专门回答下面这个更贴近工程落地的问题：

> 如果 Claude Code 与 craft 的代码都准备被集成进 Antigravity 项目里，而不是直接做产品对产品对接，那么大概能复用多少，哪些必须自己开发，哪个更适合先做默认执行底座。

这里的判断口径不是“谁更强”，而是：

1. 直接复用多少
2. 薄包装后可复用多少
3. 哪些必须重写
4. 哪些层不建议直接搬

---

## 2. 总体比较

| 架构层 | Claude Code 复用 | Claude Code 自研 | craft 复用 | craft 自研 | 判断 |
|:--|:--:|:--:|:--:|:--:|:--|
| provider / compatibility layer | 65%-80% | 20%-35% | 65%-80% | 20%-35% | 两边都高复用 |
| session / lifecycle / control plane | 20%-35% | 65%-80% | 10%-25% | 75%-90% | 两边都不该直接照搬 |
| coding execution loop | 60%-75% | 25%-40% | 35%-50% | 50%-65% | Claude Code 更强 |
| tool / permission / workspace | 40%-55% | 45%-60% | 45%-60% | 40%-55% | craft 略优于中层治理，Claude Code 更偏产品意见 |
| UI / CLI shell | 10%-25% | 75%-90% | 5%-15% | 85%-95% | 两边基本都不该搬 |

如果只看 execution kernel：

1. **Claude Code 整体可复用度大致 55%-70%**
2. **craft 整体可复用度大致 45%-60%**

如果把 session/control shell、UI/CLI 外壳也算进去：

1. **Claude Code 更接近 35%-50%**
2. **craft 更接近 30%-45%**

所以最准确的结论是：

1. **Claude Code：内核高复用，平台化改造中高成本**
2. **craft：execution primitives 高复用，系统级集成高改造成本**

---

## 3. Claude Code：可复用什么，必须重写什么

## 3.1 最值得复用的层

Claude Code 最值得复用的是三块：

1. provider / compatibility adapters
2. query / execution loop
3. tool orchestration

### provider / compatibility layer

这一层可复用度最高。

最值得复用的入口主要在：

1. `claude-code/src/utils/model/providers.ts`
2. `claude-code/src/services/api/openai/`
3. `claude-code/src/services/api/gemini/`
4. `claude-code/src/services/api/grok/`
5. `claude-code/src/services/api/client.ts`

这层的价值是：

1. 已经做了多 provider 路由
2. 已经做了流式适配
3. 已经做了 OpenAI / Gemini / Grok 的兼容细节处理

必须自己补的部分是：

1. Antigravity 的 provider policy
2. 凭证路由与 ownership
3. stage 级 provider/model 选择
4. usage / billing / governance 归因

### coding execution loop

Claude Code 在 execution loop 上的复用价值最高。

最值得复用的核心文件：

1. `claude-code/src/QueryEngine.ts`
2. `claude-code/src/query.ts`
3. `claude-code/src/context.ts`

这层已经很接近真正的 agentic execution kernel：

1. 多轮 query loop
2. streaming
3. tool use
4. compaction
5. retry / token budget / fallback

这意味着如果你的目标是尽快得到“强 coding executor”，Claude Code 比 craft 更有现成优势。

### tool orchestration

Claude Code 还有一块很值得复用：

1. `claude-code/src/Tool.ts`
2. `claude-code/src/services/tools/toolExecution.ts`
3. `claude-code/src/services/tools/toolOrchestration.ts`
4. `claude-code/src/services/mcp/client.ts`

这让它很适合做：

1. 本地代码修改
2. shell 执行
3. MCP 工具调用
4. 真正的 coding workspace executor

## 3.2 必须自己开发的层

Claude Code 不能直接给你的，是平台这一层：

1. Project / Run / Stage 映射
2. template stage dispatch 与 source contract
3. artifact / result / changedFiles 合同
4. intervention semantics
  - append
  - attach
  - cancel
  - evaluate
5. scheduler / CEO / approval / governance 接线

也就是说，Claude Code 再强，也只是 execution kernel，不是你的 platform runtime。

## 3.3 不建议直接搬的层

下面这些层不建议整包搬：

1. `claude-code/src/main.tsx`
2. `claude-code/src/entrypoints/cli.tsx`
3. `claude-code/src/screens/REPL.tsx`
4. `claude-code/src/hooks/toolPermission/PermissionContext.ts`
5. `claude-code/src/utils/permissions/filesystem.ts`
6. `claude-code/src/utils/claudemd.ts`
7. `claude-code/src/entrypoints/agentSdkTypes.ts`

原因很简单：

1. 这些已经是 Claude Code 自己的产品壳或产品意见
2. 不是纯 execution substrate
3. 直接搬会把 Antigravity 拉去适配 Claude Code 的产品模型

---

## 4. craft：可复用什么，必须重写什么

## 4.1 最值得复用的层

craft 最值得复用的不是 UI，而是 execution substrate 相关的 primitives。

### provider / compatibility layer

craft 这一层也很强。

最值得复用的目录和文件：

1. `craft-agents-oss/packages/shared/src/agent/backend/`
2. `craft-agents-oss/packages/shared/src/config/llm-connections.ts`
3. `craft-agents-oss/packages/shared/src/config/models.ts`
4. `craft-agents-oss/packages/pi-agent-server/src/`

它最有价值的点在于：

1. provider driver registry 比较干净
2. runtime resolver 比较清楚
3. pi / pi_compat 这类兼容层更像 execution substrate，而不是某个具体产品的附属功能

### tool / permission / middleware

craft 在 tool / permission / pre-tool pipeline 上的复用价值很高。

最值得复用的部分：

1. `craft-agents-oss/packages/shared/src/agent/core/pre-tool-use.ts`
2. `craft-agents-oss/packages/shared/src/agent/permissions-config.ts`
3. `craft-agents-oss/packages/shared/src/agent/mode-manager.ts`
4. `craft-agents-oss/packages/session-tools-core/src/`

这一层的优点是：

1. 工具前置校验收口得比较干净
2. safe / ask / allow-all 权限模式可借
3. session tool registry 更适合作为 execution middleware 参考

### execution primitives

craft 在 execution primitives 上也有可复用价值，但不如 Claude Code 那么“现成强执行”。

最值得看的核心：

1. `craft-agents-oss/packages/shared/src/agent/base-agent.ts`
2. `craft-agents-oss/packages/shared/src/agent/backend/claude/event-adapter.ts`
3. `craft-agents-oss/packages/shared/src/agent/backend/pi/event-adapter.ts`
4. `craft-agents-oss/packages/pi-agent-server/src/index.ts`

这层的价值更多是：

1. 统一 event normalization
2. backend 差异下沉
3. execution shell 的架构参考

## 4.2 必须自己开发的层

craft 最不能直接拿来当现成底座的，正是它自己的 session/control shell。

必须自己开发的部分包括：

1. stage lifecycle 与 run registry 映射
2. project / run / stage 真相源
3. artifact / result / review-loop / governance 接线
4. Antigravity 的 workspace ownership 与逻辑 Workspace 模型
5. scheduler / CEO / approval 集成

换句话说：

1. craft 可以给你 execution shell 素材
2. 但不能直接给你 Antigravity 的 control plane

## 4.3 不建议直接搬的层

下面这些层不建议直接搬：

1. `craft-agents-oss/packages/server-core/src/sessions/SessionManager.ts`
2. `craft-agents-oss/packages/server-core/src/handlers/rpc/`
3. `craft-agents-oss/packages/shared/src/config/storage.ts`
4. `craft-agents-oss/packages/shared/src/workspaces/storage.ts`
5. `craft-agents-oss/apps/electron/src/`
6. `craft-agents-oss/apps/webui/src/`
7. `craft-agents-oss/apps/cli/src/`

原因同样很直接：

1. 这些已经是 craft 自己的 session-first / workspace-first 产品壳
2. 直接搬会把 Antigravity 往 craft 的产品模型上拉
3. 这和你要保留的 Project / Run / Stage 真相源正面冲突

---

## 5. 不管选谁，都必须自己开发的部分

这部分最关键，因为它直接回答“到底多少我们自己要做”。

如果目标是让它们完全适配 Antigravity，不管 Claude Code 还是 craft，下面这些层都必须由 Antigravity 自己拥有：

1. **Execution Contract**
  - start
  - append
  - attach
  - cancel
  - terminal semantics
  - capability matrix
2. **Stage Adapter**
  - template stage -> executor session 的映射
3. **Run / Project / Stage Truth Source**
  - registry
  - recovery
  - governance
4. **Artifact / Result Contract**
  - changedFiles
  - result text
  - artifactDir
  - reviewOutcome
5. **Intervention Contract**
  - nudge
  - restart_role
  - evaluate
  - cancel
6. **Policy Layer**
  - scheduler
  - CEO
  - approval
  - memory / rules

这也是为什么“把代码集成进来”并不等于“省掉平台层工作”。

真正能省掉的，是 execution kernel 的一部分，不是 control plane 的主干。

---

## 6. 如果只选一个先做默认底座，应该选谁

### 6.1 短期默认底座

如果目标是：

1. 尽快把真实 coding task 跑起来
2. 真正能在 workspace 里改代码、跑命令、调用工具
3. 同时顺手拿到多 provider 兼容能力

更合适的是：

1. **Claude Code**

因为它在下面三件事上明显更强：

1. query / execution loop 更成熟
2. coding executor 能力更强
3. 工具链更接近“能立刻干活”的状态

### 6.2 长期标准方向

如果目标是：

1. 做一个真正不再绑死某个产品壳的 execution runtime
2. 多 provider / 多 executor 共存
3. session / event / capability 合同长期稳定

更接近的方向是：

1. **craft-style runtime 思路**

注意这里说的是：

1. **craft-style**

而不是：

1. **把整个 craft 产品照搬进来**

---

## 7. 最稳的路线

如果把“要集成代码，不是产品对产品对接”作为前提，最稳路线应该是：

### Phase 1

先完成 Task B，继续净化 `group-runtime.ts` 与 Native transport 的耦合。

### Phase 2

把 Antigravity 自己的 execution contract 写死。

### Phase 3

优先集成 Claude Code 的高复用层：

1. provider adapters
2. QueryEngine / query loop
3. tool orchestration

### Phase 4

并行吸收 craft 更值得借的 substrate 层：

1. backend/event 归一化思路
2. pre-tool-use middleware
3. permissions / mode manager
4. session-tools-core

### Phase 5

最后再决定：

1. 是否继续做自己的长期 execution shell
2. 还是维持“Claude Code 为默认强执行底座 + craft 设计借鉴”的混合模式

---

## 7.1 如果选择 Claude Code，会不会还是被绑死

不会自动解绑，也不会自动绑死。

关键不在于：

1. 代码是不是合进 Antigravity 仓库

关键在于：

1. **谁拥有运行时合同**
2. **谁决定平台要适配谁**

### 情况 A：只是把 Claude Code 代码 vendoring 进来，但平台开始围着它的内部模型转

这种情况仍然会被绑住。

例如如果 Antigravity 最后开始依赖这些东西作为事实标准：

1. Claude Code 的 session 模型
2. Claude Code 的 tool permission 模型
3. Claude Code 的 workspace / context 组织方式
4. Claude Code 的 internal event shape
5. Claude Code 的 query loop 生命周期

那即使代码已经在自己仓库里，本质上也只是：

1. **从 API 绑定变成源码级绑定**

这类绑定的风险包括：

1. 以后替换执行器时，Antigravity 自己的 runtime 也要一起改
2. Project / Run / Stage 容易慢慢去迎合 Claude Code 的 session 语义
3. intervention、artifact、routing policy 会被 Claude Code 的内部抽象反向塑形

### 情况 B：Claude Code 只是被拆成 Antigravity 的一个内部执行内核

这种情况就不会形成严重绑定。

前提是平台自己明确持有这些边界：

1. start / append / attach / cancel / terminal semantics
2. Project / Run / Stage 真相源
3. artifact / result / changedFiles contract
4. scheduler / CEO / approval / governance
5. provider routing policy

这时 Claude Code 的角色就只是：

1. provider adapters
2. query loop
3. tool runtime
4. coding executor implementation

也就是说：

1. **代码在你仓库里**
2. **但合同在 Antigravity 手里**
3. **Claude Code 只是默认 substrate，而不是平台标准本身**

### 所以真正的判断标准是什么

如果你选择 Claude Code，下面这句成立，就不会形成严重锁定：

> Claude Code 可以被替换掉，而 Antigravity 的 Project / Run / Stage、artifact、intervention、scheduler 语义不需要跟着重写。

如果这句不成立，那就说明：

1. 你不是在“集成 Claude Code”
2. 而是在“把 Antigravity 建在 Claude Code 的内部模型上”

### 更直白的结论

所以答案不是：

1. 代码合进来就一定不会绑死

而是：

1. **代码合进来，只能解决外部依赖问题**
2. **能不能真正不被绑死，取决于平台有没有坚持让 Claude Code 去适配 Antigravity 的 execution contract，而不是反过来**

换句话说：

1. **合入代码 ≠ 自动解绑**
2. **自有合同 + 内部 adapter 才是真正解绑**

---

## 8. 最终判断

如果把这次问题压缩成一句工程判断，答案是：

> Claude Code 更适合先被集成为 Antigravity 的默认强执行底座，craft 更适合作为长期 execution substrate 的设计来源；两边都能复用不少代码，但真正必须由 Antigravity 自己持有的控制合同和平台语义，谁都替不了。

再直白一点：

1. **想先跑起来，优先整合 Claude Code 内核**
2. **想长期不被某个产品壳绑住，要自己拥有 execution contract，并有选择地吸收 craft 的 substrate 思路**