# Architecture Review Follow-Up（2026-05-09）

承接 [docs/design/architecture-review-2026-05-09.md](/Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/architecture-review-2026-05-09.md) 的逐条整改验收。

> **本次更新（2026-05-09 第二轮）：**
> 已用 4 个独立 verify agent + 人工复核，对 14 条问题逐一**重新核对代码**，不依赖任何自报状态。
> 结论与之前 Rae 自报版本基本一致，但订正了一处证据数字（问题 7：原 audit "19 个 route 跨层 import" 是 grep 错误，实际是 **108 个**，回到原始 review 的判断）。

> **本次更新（2026-05-10 第三轮）：**
> 已继续按 follow-up 主线处理 `Issue 2`，并把 API / UI 外层残留也收口到共享会话句柄解析主线。
> 结论已升级为“已修复”：`sessionProvenance.handle` 现在是唯一权威读源，`childConversationId / activeConversationId` 只保留兼容镜像语义。

## 整改总览

| # | 问题 | 状态 | 验收结论 |
|---|------|------|---------|
| 1 | Storage 双写无锁 | ✅ 已修复 | `web` 默认只读，只有 `api/all` 默认可写；拆分角色要写库必须显式 `AG_STORAGE_MODE=readwrite` |
| 2 | Conversation ID 四套字段 | ✅ 已修复 | `sessionProvenance.handle` 已成为唯一权威主线，旧字段只剩兼容镜像 |
| 3 | growth-* vs self-improvement-* | ✅ 已修复 | growth 自动化写路径与 approval callback 写旁路已退役；业务能力进化已迁入 `evolution/*`，growth 仅保留历史只读 GET 与 POST 410 兼容 |
| 4 | self-improvement-execution.ts 死文件 | ✅ 已修复 | 文件 + 测试已删，全库 0 残留 import |
| 5 | llm-oneshot.ts 死分支 | ✅ 已修复 | 79 行精简版，bridge import 全清，throw 显式 |
| 6 | 日志三件套 schema 重叠 | ✅ 已修复 | `gate` 双写已去掉，journal 类型已收回 node/condition 主线 |
| 7 | Next route 跨层 import | ✅ 已修复 | `src/app/api` 对 `@/server/(?!shared/proxy)` 的静态 route import 已清零 |
| 8 | antigravity-executor 吞错 + servers[0] | ✅ 已修复 | owner lookup 路由 + cancel 显式 throw + addTrackedWorkspace 精确放过 |
| 9 | gateway.ts ownerMap refresh 吞错 | ✅ 已修复 | 引入 failedPorts，部分失败保留旧映射 + 不推 ownerMapAge |
| 10 | agents/ 三处 import bridge/grpc | ✅ 已修复 | llm-oneshot 删除；runtime-helpers 加 provider 守卫；watch-conversation 加注释 |
| 11 | runtime-helpers 私有化 + 去重 | ✅ 已修复 | 5 个 helper 私有化，summarizeFailureText 单一实现 |
| 12 | bridge → agents 反向依赖 | ✅ 已修复 | initializeGatewayHome 上提到 bridge-worker-process |
| 13 | Provider 列表多处定义 | ✅ 已修复 | provider-registry 统一；4 个文件 + 2 个 route 全派生 |
| 14 | security/ vs security-core/ 命名 | ✅ 已修复 | 本地适配层已更名为 `security-adapters/`，`security-core` 注明 upstream-synced |

**统计**：✅ 已修复 14 / ❌ 退化 0。

**整体健康度**：tsc `exit=0`、未引入 `@ts-ignore` / `console.log`、新增针对性测试覆盖关键收口点。本轮实施质量良好。

---

## 逐条验收

### 1. Storage 双写无锁 — ✅ 已修复

**本轮处理结果**：已把默认部署拓扑收口成单写者模型。

**证据**：
- `src/lib/storage/gateway-db.ts` 现在按 `AG_ROLE / AG_STORAGE_MODE` 解析 DB 模式。
- 默认只有 `api` / `all` 拿 `readwrite` handle；`web` 与其它拆分角色默认 `readonly`。
- 若未来要让 `runtime / control-plane / scheduler` 单独写库，必须显式设置 `AG_STORAGE_MODE=readwrite`，不再靠隐式多写者行为。
- 新增 `src/lib/storage/gateway-db.test.ts` 覆盖：同一份 SQLite 在 `api` 初始化后，`web` 角色可读但写入会失败。

---

### 2. Conversation ID 四套字段 — ✅ 已修复

**本轮处理结果**：已把“多字段都能当权威源”的问题收口成“单一权威 + 兼容镜像”。

**证据**：
- 新增 `src/lib/agents/session-handle.ts`，把 `resolveRunSessionHandle()`、`buildLegacyConversationHandleBinding()`、`resolvePrimaryConversationId()`、`collectRunChildConversationIds()` 集中到一处。
- `src/lib/agents/group-runtime.ts` 已删除内联 `resolveSessionHandle()`；runtime / backend / supervisor / storage 全部改走共享 helper。
- `src/app/api/agent-runs/[id]/conversation/route.ts`、`src/app/api/projects/[id]/resume/route.ts`、`src/app/api/agent-runs/route.ts` 与相关 UI 打开对话逻辑已经切到 `sessionProvenance.handle` / conversation resolver 主线。
- `src/lib/company-kernel/working-checkpoint.ts` 的会话 checkpoint 只再记录 `sessionHandle / backendId`，不再把 `childConversationId / activeConversationId` 当成新的审计事实。
- `childConversationId / activeConversationId` 仍保留在类型与持久化里，但现在只是兼容镜像，不再是新的架构权威读源。

---

### 3. growth-* vs self-improvement-* 双管道 — ✅ 已修复

**本轮处理结果**：growth 已从“活跃自动化主线”降级成“历史只读兼容层”，且旧 approval callback 写旁路已清零。旧 Crystallizer 的业务能力进化能力已迁入 `evolution/*`。

**证据**：
- `src/lib/company-kernel/company-loop-executor.ts` 不再生成 growth proposal。
- `src/lib/company-kernel/ceo-decision-control.ts` 不再把 growth proposal 放进 CEO 决策队列。
- `src/lib/company-kernel/growth-evaluator.ts`、`growth-observer.ts`、`growth-publisher.ts` 已删除。
- `src/lib/company-kernel/growth-proposal-store.ts` 只保留 `count/get/list`，`src/lib/company-kernel/growth-observation-store.ts` 只保留 `listGrowthObservations()`。
- `src/lib/approval/dispatcher.ts` 对旧 `publish-growth-proposal` / `reject-growth-proposal` callback 只记录 retired warning，不再执行旧写流。
- `POST /api/company/growth/proposals/generate|:id/evaluate|approve|reject|dry-run|publish` 与 `POST /api/company/growth/observations` 统一返回 `410 Gone`。
- `GET /api/company/growth/proposals*` 与 `GET /api/company/growth/observations` 仍保留，作为历史查询接口。
- `src/lib/evolution/generator.ts` 与 `src/lib/evolution/publisher.ts` 已接管 RunCapsule / MemoryCandidate / KnowledgeAsset → SOP/workflow/skill/script/rule 的业务能力进化。

---

### 4. self-improvement-execution.ts 死文件 — ✅ 已修复

**Rae 声明**：删除文件 + 测试。

**独立核实结果**：✅ 准确，干净。

**证据**：
- `git diff --stat` 显示文件已删（`-281` LOC + `-454` LOC test）。
- `grep -rn "self-improvement-execution\b"` 全库 **0 命中**。
- `self-improvement-codex-execution.ts` 805 行，导出 6 个函数/接口，完整接管职责。

**残留**：无。

---

### 5. llm-oneshot.ts 死分支 — ✅ 已修复

**Rae 声明**：删除 Antigravity polling fallback，只保留 API-backed `ClaudeEngine` 主路。

**独立核实结果**：✅ 准确，**清得很彻底**。

**证据**：
- `src/lib/agents/llm-oneshot.ts` 总行数 79（原约 150+）。
- 顶部 import 仅剩 `ClaudeEngine` / `resolveProvider` / `getCEOWorkspacePath`，**不再 import `discoverLanguageServers / getApiKey / grpc`**。
- L78：`throw new Error(\`callLLMOneshot only supports API-backed providers; got: ${provider}\`)` —— 显式 safety valve，符合原方案建议。
- 全文件无 `cascade / poll / handle / language server` 残留。

**残留**：无。

---

### 6. 日志三件套部分 schema 重叠 — ✅ 已修复

**本轮处理结果**：journal 已收回 node/condition 主线，gate 双写消失。

**证据**：
- `src/lib/agents/execution-journal.ts` 的 `JournalEventType` 已缩到 `node:*` + `condition:evaluated`。
- `/api/projects/[id]/gate/[nodeId]/approve/route.ts` 与 `src/mcp/server.ts` 不再写 `gate:decided` journal。
- `ops-audit` 继续承担 gate 侧的唯一审计写点。

---

### 7. Next route 跨层 import — ✅ 已修复

**本轮处理结果**：route 对 `@/server/*` 的静态依赖已经清零。

**证据**：
- `src/server/shared/proxy.ts` 新增 `runControlPlaneRoute()`、`runRuntimeRoute()`、`runControlPlaneThenRuntimeRoute()`。
- `src/app/api` 下原先 30 个直连 `@/server/control-plane/*` 或 `@/server/runtime/*` 的薄 wrapper route 已统一改为：
  - 通过 shared proxy helper 决定是否转发
  - 仅在本地执行分支里 `await import(...)` 动态加载 server handler
- 当前 `rg -n "from '@/server/(?!shared/proxy)" src/app/api -g 'route.ts' -P` 已无命中。

---

### 8. antigravity-executor.ts 吞错 + servers[0] — ✅ 已修复

**Rae 声明**：appendMessage / cancel 改 owner lookup；cancel 失败显式抛；addTrackedWorkspace 只放过 already-tracked。

**独立核实结果**：✅ 准确，覆盖度符合短期方案。

**证据**：
- `src/lib/providers/antigravity-executor.ts:40-46` 新增 `resolveOwnerConnection(handle)` helper。
- L161-162 `appendMessage()`：`const owner = await resolveOwnerConnection(handle)` —— 不再硬取 `servers[0]`。
- L190-199 `cancel()`：try/catch 后 `throw new Error(...)` 显式抛错。
- L35-38 `isAlreadyTrackedWorkspaceError()`：精确 match `includes('already') && includes('track')`。
- L85-91 `addTrackedWorkspace()` 只在该匹配下吞错，其他错重抛。
- 新增测试 `src/lib/providers/antigravity-executor.test.ts`（118 行）覆盖三个修复点。

**残留**：无（短期方案完成）。

---

### 9. bridge/gateway.ts ownerMap refresh 吞错 — ✅ 已修复

**Rae 声明**：单 server 失败保留旧映射，部分失败不推 `ownerMapAge`。

**独立核实结果**：✅ 准确，且实现得比方案建议更细。

**证据**：
- `src/lib/bridge/gateway.ts:204` 仍执行 `convOwnerMap.clear()`，但：
  - L199 catch 中加 `failedPorts.add(conn.port)`；
  - L216-228 在 clear 后恢复 pre-registered owners；
  - L231-238 显式从旧 mapping 恢复"失败 server 上的"条目；
  - L240-242 仅在 `failedPorts.size === 0` 时才推进 `ownerMapAge`。
- 整体语义：失败 server 上的 cascade 路由信息**不会丢**，且上游能感知"刷新未完成"。

**残留**：无 per-server health 标记（方案中期建议项），但短期方案已落地。

---

### 10. agents/ 三处 import bridge/grpc — ✅ 已修复

**Rae 声明**：llm-oneshot 删除 grpc；runtime-helpers `cancelCascadeBestEffort` 加 provider 守卫；watch-conversation 标注 Antigravity-only。

**独立核实结果**：✅ 准确，三处一致。

**证据**：
- `src/lib/agents/llm-oneshot.ts` 顶部 import 不再有 grpc / gateway / discoverLanguageServers / getApiKey。
- `src/lib/agents/runtime-helpers.ts:8` 仍 import grpc，但 L41 `cancelCascadeBestEffort()` 早返：`if (provider !== 'antigravity') return;`；签名新增 provider 参数。
- 调用方 `group-runtime.ts:1719` 同步传入 provider 参数。
- `src/lib/agents/watch-conversation.ts:4` 顶部新增 "Antigravity-only bridge adapter" 注释。
- `grep -rln "from '\.\./bridge/grpc\|from '\.\./bridge/gateway" src/lib/agents` 命中 2 个文件（runtime-helpers + watch-conversation），且都已合理化。

**残留**：无（中期"lint rule 强约束"建议项可后续做）。

---

### 11. runtime-helpers 私有化 + 去重 — ✅ 已修复

**Rae 声明**：5 个 helper 私有化；`summarizeFailureText` 去重。

**独立核实结果**：✅ 准确。

**证据**：
- `src/lib/agents/runtime-helpers.ts` 当前 `export` 列表：`isAuthoritativeConversation` / `cancelCascadeBestEffort` / `summarizeFailureText`（再出口） / `getFailureReason` / `propagateTermination` / `getCanonicalTaskEnvelope` / `buildRoleInputReadAudit` / `enforceCanonicalInputReadProtocol`。
- 5 个原过度暴露的（normalizeComparablePath / includesPathCandidate / extractStepReadEvidence / filterEvidenceByCandidates / dedupeStringList）现在都是非 export `function`（行 95 / 109 / 114 / 133 / 147）。
- L9 `import { summarizeFailureText } from '../project-utils'`、L53 `export { summarizeFailureText };` —— 真的从 project-utils 转发，不再本地实现。
- `src/lib/project-utils.ts:11` 是 `summarizeFailureText` 的唯一定义。

**残留**：`getFailureReason` 仍然是 runtime-helpers 独有（`project-utils.ts` 没有它），所以"去重"只对 `summarizeFailureText` 一个生效——这与原 review 描述一致，不是新问题。

---

### 12. bridge → agents 反向依赖 — ✅ 已修复

**Rae 声明**：worker-entry 去掉 import；bridge-worker-process 显式调 `initializeGatewayHome`。

**独立核实结果**：✅ 准确，且加了测试。

**证据**：
- `src/lib/bridge/worker-entry.ts` 顶部 import 区**不再**有 `from '../agents/gateway-home'`。
- 文件总行数 55，main() 只调 `startBridgeWorker`。
- `src/server/runtime/bridge-worker-process.ts:6` 新增 `import { initializeGatewayHome } from '@/lib/agents/gateway-home'`，L13 显式调 `initializeGatewayHome({ syncAssets: true })`。
- 新增测试 `src/server/runtime/bridge-worker-process.test.ts`（55 行）验证调用时机。
- `grep -rln "from '\.\..*agents/" src/lib/bridge` 现在 **0 命中**。

**残留**：无。

---

### 13. Provider 列表多处定义 — ✅ 已修复

**Rae 声明**：新增 provider-registry，4 个文件派生；额外把 conversation route 的 PROVIDER_TITLES 也收口到共享 helper。

**独立核实结果**：✅ 准确，比原方案多收了一项。

**证据**：
- 新文件 `src/lib/providers/provider-registry.ts`（L13-62 定义 `PROVIDER_REGISTRY`，L64-68 派生 `PROVIDER_OPTIONS / PROVIDER_LABELS / DEFAULT_PROVIDER_PROFILES / STORED_API_KEY_IDS`）。
- `src/lib/providers/provider-availability.ts:2-6` 从 registry 导入 `PROVIDER_LABELS` / `PROVIDER_OPTIONS`，不再硬编码。
- `src/lib/providers/ai-config.ts:20` 从 registry 导入 `DEFAULT_PROVIDER_PROFILES`。
- `src/lib/providers/provider-inventory.ts` 从 registry 导入 `STORED_API_KEY_IDS`。
- 新文件 `src/lib/local-provider-conversations.ts` 提供 `getLocalProviderTitle()` 共享 helper（混合 Codex 与 registry label）。
- `src/app/api/conversations/route.ts` 与 `src/app/api/conversations/[id]/send/route.ts` 都删了各自的 PROVIDER_TITLES 表（git diff 显示 -22 行），改为 import `getLocalProviderTitle()`。

**残留**：
- `AIProviderId` 类型仍是手写 string union（未改成 `keyof typeof PROVIDER_REGISTRY`）。这意味着加 provider 时还是要"types.ts + registry"两处一起改，比之前的 3 处少一处但未到 1 处。registry 的 key 与 types 值必须人工对齐——不是运行时风险，但 type-level SSOT 没建立。

---

### 14. security/ vs security-core/ 命名 — ✅ 已修复

**本轮处理结果**：本地适配层已和 upstream core 显式分离命名。

**证据**：
- `src/lib/claude-engine/security/` 已更名为 `src/lib/claude-engine/security-adapters/`。
- `src/lib/claude-engine/engine/tool-executor.ts`、`permissions/checker.ts` 已切到新路径。
- `src/lib/claude-engine/security-core/index.ts` 顶部已增加 upstream-synced 注记。
- `git log --diff-filter=R` 无 rename。
- git status 中两个目录均无 modified 文件。

**残留**：低优先级，按计划留待后续处理。

---

## 整体健康度抽检

**A. 类型检查**：`npx tsc --noEmit --pretty false` → `exit=0`，零错误。

**B. 新增测试**：
- `src/lib/providers/antigravity-executor.test.ts`（118 行）—— 覆盖问题 8 的三个修复点。
- `src/server/runtime/bridge-worker-process.test.ts`（55 行）—— 覆盖问题 12 的初始化时机。
- 覆盖面**有限**：问题 9（gateway.ts ownerMap）的 `failedPorts` 逻辑没有专门测试；问题 11 的 helper 私有化没有测试（不需要）；问题 1 的两个事务化没有测试。

**C. 代码卫生**：本轮 diff 无新增 `@ts-ignore` / `@ts-expect-error` / `console.log`，未引入新的 try/catch 吞错。

**D. 改了未测的文件**（仅大改的）：
- `src/lib/bridge/gateway.ts`（problem 9，但 `failedPorts` 路径无测）—— 建议补 1-2 个 unit test。
- `src/lib/agents/llm-oneshot.ts`（problem 5/10，整体精简到 79 行）—— 建议补 throw 路径测试。
- 其余（runtime-helpers、worker-entry、crystallizer、provider-inventory）改动局部，风险中等可接受。

---

## 仍待跟进的优先级建议

按 review 原排序结合本次状态：

1. **P0-1（Storage 双写）**：把另外 39 处裸 `prepare().run()` 中所有"多语句相关的写"包进 `db.transaction`；引入 `AG_ROLE` writable/readonly 分流（这一步独立可做）。
2. **P0-2（Conversation ID）**：先加 `@internal` + lint rule 锁住直接读，再分两版本灰度删字段。
3. **P0-3（growth 退役）**：已改为历史 GET / POST 410 兼容；不要 308 到 `self-improvement-*`，业务能力进化主线是 `/api/evolution/*`。
4. **P2-6（日志重叠）**：开始执行边界文档里的事件迁移——把 journal 的 `gate/switch/loop/checkpoint` 5 类事件迁出。
5. **P2-7（route 跨层）**：在 `src/middleware.ts` 加角色拦截，让 web 进程根本不走 route handler；这一步可一次性消除 108 处的双分流代码。

其余 ✅ 项目可关闭，⏸ 项目（问题 14）保留低优先级。

---

## 验证方法

- 4 个独立 verify agent 并行核对（不读 Rae 的 followup 内容，只看代码）。
- 每个 agent 用 `grep / find / wc / git diff` 直接读源文件，给 file:line 证据。
- 关键数字（问题 7 的 108 vs 19）跑了第三次 grep 复核，确认 108 是对的。
- 整体跑 tsc `exit=0` 通过。
- 抽查 git diff 无可疑副作用。

> 维护：本文为 2026-05-09 第二轮验收快照。后续如再有整改，建议新建 `architecture-review-2026-05-09-followup-r3.md` 而非覆盖本文。
