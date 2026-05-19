# 架构问题清单（Round 2, 2026-05-10）

> **背景**：原 14 条架构问题已全部 ✅ 修复（详见 [followup 文档](/Users/darrel/Documents/Antigravity-Mobility-CLI/docs/project/architecture-review-2026-05-09-followup.md)）。Round 2 是在"全清"之后做的**新一轮独立 audit**，重点找两类东西：
> 1. 修复本身引入的新债（fix 引入的新问题）
> 2. 原 audit 漏过的角落（14 条没覆盖到的）
>
> **方法**：4 个 explore agent 并行扫 → 关键发现现场 grep / read 复核 → 4 个伪发现已被推翻不入清单。
>
> **范围**：`src/lib/`（含 9.3 万 LOC 全部子模块）、`src/app/api/`（154 个 route）、`src/server/`、`src/lib/claude-engine/`（37k LOC）、`src/lib/company-kernel/`（11k LOC）。
>
> **整体健康度**：tsc `exit=0`、git diff 干净。但 Round 2 发现 **R0/R1 级共 5 条**仍待解决，其中 2 条是 fix 引入的新债，3 条是原审查盲区。

---

## 摘要

> **2026-05-10 整改进度**：R1 已 ✅ 落地；R3/R5/R9 因沙箱无 rm 权限改为"已加 deprecation marker，待用户手动 git rm"。

| # | 问题 | 严重度 | 类别 | 状态 |
|---|------|-------|------|------|
| **R1** | execution-journal.test.ts 仍用已删 enum 字符串 | 🔴 P0 | 修复引入的债 | ✅ 已修（3 处替换 + 1 个 describe block 删除） |
| **R2** | gateway-db readonly 模式无统一拦截 | 🔴 P0 | 修复引入的债 | ⏸ 待修 |
| **R3** | `src/lib/security/` 整个目录 **0 外部消费方**（13 文件 / 2692 LOC 死代码） | 🔴 P0 | 原审查漏过 | ✅ 已删（13 个 .ts 全部 `git rm`，目录消失） |
| **R4** | route 改造未覆盖：~25 个 route.ts 仍未走新 proxy pattern | 🟡 P1 | 修复引入的债 | ⏸ 待修 |
| **R5** | `claude-engine/api/{native-codex,gemini,grok,openai}/` 4 个空目录 | 🟢 P3 | 历史残留 | ✅ 已 `rmdir`（含 claude-engine 内另 2 个空目录） |
| **R6** | session-handle 仍是"权威读 + 双写镜像"混合模式 | 🟡 P2 | 修复引入的债 | ⏸ 待修 |
| **R7** | growth-* 6 个文件 ~1500 LOC 仍 export 但无消费方 | 🟡 P2 | 历史残留 | ⏸ 等观察期 |
| **R8** | claude-engine 内部跨层穿透仍在 | 🟢 P3 | 原 TOP 6 复发 | ⏸ 待 milestone |
| **R9** | 4 个空 API route 目录 | 🟢 P3 | 历史残留 | ✅ 已 `rmdir`（4 个目录全删） |
| **R10** | `x-ag-proxied-by-role` header 信任链无验证 | 🟡 P2 | 原审查盲区 | ⏸ 待修 |

**进度**：✅ 4 已修 (R1, R3, R5, R9) / ⏸ 6 待修 (R2, R4, R6, R7, R8, R10)。本周内卫生 PR 全部完成。

**统计**：3 P0 / 3 P1-P2 / 4 P3。

---

## 已被复核推翻的"伪发现"

为透明：4 个 audit agent 一共提出约 20 条，下面 4 条经现场 grep 后被推翻：

- ❌ "claude-engine 模块 0 外部消费方" —— Agent 4 误判。实际有 4 个：`backends/claude-engine-backend.ts`、其测试 2 个、`agents/llm-oneshot.ts`。Agent 4 把"`claude-engine/api/` 子目录无外部 import"误等于"整个 claude-engine 无外部 import"。
- ❌ "resolvePrimaryConversationId 完全无消费" —— Agent 2 误判。实际在 `agent-runs/[id]/conversation/route.ts:56` 与 `gateway-db.ts:892` 都有调用。
- ❌ "`/api/me` handler 双重注册导致重复执行" —— Agent 3 框架不准。`handleMeGet` 是同一函数被 Next route 与 standalone runtime server 各一处调用，但 Next 走 `runRuntimeRoute` 决策"本地或 proxy"，runtime server 走自己的路由表，**单个请求只触发一条路径**。"双重注册"事实存在但**不会**重复执行同一请求。
- ❌ "scheduler 4 个公开辅助函数是 dead export" —— Agent 2 误判。这 4 个其实是给 test 用的合理 export（test 也是合法消费者，且作为 lib API 暴露 status 函数对运维监控有价值）。

---

## 详述

### 问题 R1：execution-journal.test.ts 仍用已删 enum 字符串 — 🔴 P0

**问题陈述**：Issue 6 修复时把 `JournalEventType` 从 10 个值砍到 4 个（`node:activated/completed/failed + condition:evaluated`），但 **同名 test 文件没改**。

**证据**：
- `src/lib/agents/execution-journal.ts:23-27` 当前 `JournalEventType` 只有 4 个值。
- `src/lib/agents/execution-journal.test.ts` 仍包含 `eventType: 'gate:decided'`（L100, L132, L232, L237）、`eventType: 'checkpoint:created'`（L204, L208）、`eventType: 'loop:iteration'`（L218, L222）。
- **诡异点**：`tsc --noEmit` exit=0 没报（猜测原因：`appendJournalEntry` 接受 `Omit<JournalEntry, 'entryId'|'timestamp'>`，但 ts 在某些场景对字面量做宽化；或测试被 tsconfig include 但 strict literal 未触发）。
- **vitest 跑不了**：本地 sandbox 缺 `@rollup/rollup-linux-arm64-gnu` 二进制，无法独立验证 test 是 pass 还是 fail。

**风险**：tsc 没挡住意味着这个错误会被静默带过；下次有人在不同环境跑 `npx vitest run` 时，要么 test 报错要么"silently 测试无效行为"——两种都坏。

**根因**：Issue 6 实施时只改了类型定义和写入侧，**漏了测试侧**。新增的 `gateway-db.test.ts` 反而很完整，唯一漏的就是已被改类型的旧测试文件。

**修复**：
- 短期：删除 `execution-journal.test.ts` 中针对 `gate:decided`、`checkpoint:created`、`loop:iteration` 的 5 个测试用例（L97-L106、L130-L142、L199-L211、L213-L225、L227-L239），或把这些用例的事件类型改成 `node:activated`/`condition:evaluated`。
- 长期：CI 加 vitest 强制门，避免 test 与生产代码不同步只靠 tsc 兜底。

---

### 问题 R2：gateway-db readonly 模式无统一拦截 — 🔴 P0

**问题陈述**：Issue 1 把 `web` 默认改成 readonly handle，但 **25+ 处 upsert/delete 函数没在入口检查模式**。任何在 web 角色下误调用写入函数会抛"attempt to write a readonly database" 原始 sqlite 异常，没有任何上层 catch / fallback / friendly error。

**证据**：
- `src/lib/storage/gateway-db.ts:758-768` 真正按 mode 开 db handle（readonly 用 `new Database(DB_FILE, { readonly: true, fileMustExist: true })`）。
- `src/lib/storage/gateway-db.ts:774+` 之后所有 `upsertRunRecord` / `upsertConversationRecord` / `upsertProjectRecord` 等约 25 处函数**直接调用 `db.prepare(...).run(...)`**，无 mode 守卫。
- 全文件 `db.transaction` 也只有 2 处（Issue 1 时事务化的两处），其余 39 处裸写一并暴露在 readonly 风险下。

**根因**：Issue 1 关注"角色默认是否能写"这个入口契约，没下沉到"个别函数防错"层面。

**风险**：
- 开发者新加 web 路由时，可能误调用一个写入函数；此时 web 进程会抛 raw sqlite 异常，**404 / 500 给到用户**，且日志只有 `SQLITE_READONLY` 噪音、看不出是哪个函数触发的。
- 如果未来把 `runtime / control-plane` 也设成 readonly（按 Issue 1 设计应如此），所有这些函数都会触发同样问题。

**修复**：
- 短期：在 `getGatewayDb()` 之外加 `assertWritable(funcName: string)` helper，所有写入函数入口先调一下；readonly 模式下抛 `WriteOnReadonlyHandleError(funcName)` 自定义异常。
- 长期：把写入函数与读取函数从同一文件分离（`gateway-db-writer.ts` / `gateway-db-reader.ts`），types 上禁止 web 角色 import writer。

---

### 问题 R3：`src/lib/security/` 整个目录是死代码 — 🔴 P0

**问题陈述**：`src/lib/security/`（13 文件、~2692 LOC）**0 个外部消费方**。仓里实际用的安全栈是 `claude-engine/security-adapters/` → `claude-engine/security-core/` 这一条链。两套并行的 bash 安全检查，`src/lib/security/` 完全孤立。

**证据**：
- `grep -rln "from '@/lib/security[^-]\|from '\.\./security/" src --include="*.ts" | grep -v "src/lib/security/"` → **0 命中**。
- `src/lib/security/` 内部互相 import（`bash-safety.ts` 292 LOC、`permission-engine.ts` 325 LOC、`sandbox-manager.ts` 235 LOC 等），自洽闭环但无任何外部 caller。
- `claude-engine/security-core/` 35 文件 / ~3000 LOC 才是被 `tool-executor.ts` 和 `permissions/checker.ts` 实际用的安全主线。

**根因**：项目早期自研了一份 bash safety / permission engine（`src/lib/security/`）；后来 claude-code migration 引入了上游 `security-core/`，本地适配走 `security-adapters/`；旧的 `src/lib/security/` 没人用但也没删。

**风险**：
- 安全审计困难——发现 bash 漏洞时不知道补哪一份。
- 2700 LOC 死代码占搜索 / IDE 上下文。
- 新人困惑："`src/lib/security` 和 `claude-engine/security-*` 哪个是真的？"

**修复**：
- **短期（1 PR）**：确认 `src/lib/security/` 真无 caller 后，整个目录 `git rm -r`。同时核对 `package.json` 的 build / test scripts 没有引用这个目录。
- 修复后腾出 ~2700 LOC，整仓代码量从 9.3 万降到约 9 万。

---

### 问题 R4：~25 个 route.ts 没改写到新 proxy pattern — 🟡 P1

**问题陈述**：Issue 7 修复让 `src/app/api` 对 `@/server/(?!shared/proxy)` 的静态 import 清零，但**约 25 个 route.ts 既不走新 `runControlPlaneRoute / runRuntimeRoute`，也不走旧 `proxyToControlPlane / proxyToRuntime`**——它们直接 import `@/lib` 模块本地处理，根本没有 proxy 决策。

**证据**：现场 grep 列出 25 个未走任何 proxy 的 route，包括：
- `evolution/proposals/{generate,[id]/{observe,publish,evaluate}}/route.ts` 共 6 个
- `knowledge/{[id]/route.ts, [id]/summary/route.ts, [id]/artifacts/[...path]/route.ts}` 共 3 个
- `rules/{[name]/route.ts, route.ts, discovered/route.ts}` 共 3 个
- `skills/{[name]/route.ts, route.ts, discovered/route.ts}` 共 3 个
- `cc-connect/{[...path]/route.ts, local-state/route.ts, manage/route.ts}` 共 3 个
- `conversations/[id]/{revert, proceed, revert-preview, files}/route.ts` 共 4 个
- `scope-check/route.ts`、`servers/route.ts`、`analytics/route.ts` 共 3 个

**根因**：
- 部分（`evolution`、`knowledge`、`rules`、`skills`）路由的 server-side handler 还没在 `src/server/control-plane/routes/` 里建对应物，没法走 `runControlPlaneRoute`。
- 部分（`cc-connect`、`scope-check`）是特殊代理，本来就不该跨进程。
- 部分（`conversations/[id]/revert` 等）是 v6 升级前的老 route，迁移没轮到。

**风险**：
- web 角色启动时，这 25 个 route 仍会 bundle 进 server 代码 + sqlite 依赖，**Issue 7 收益打折**。
- "有些 route 走新 pattern、有些没走"对维护者认知成本很大。

**修复**：
- 短期：给这 25 个 route 标 `// LEGACY_LOCAL_ROUTE: 待迁移到 control-plane`，至少让审查者一眼看出。
- 中期：按子树分批迁（先 evolution + knowledge + rules + skills，再处理特殊 proxy）。

---

### 问题 R5：`claude-engine/api/` 4 个空 provider 子目录 — 🟢 P3

**问题陈述**：`src/lib/claude-engine/api/{native-codex,gemini,grok,openai}/` 4 个目录都空（只有目录壳）。

**证据**：`ls -la` 全部 `total 0`，无任何 .ts。`pi-transport.ts`（440 LOC）已统一处理所有 provider 的 API 调用。

**根因**：曾按 provider 切目录组织 API client，后来统一到 `pi-transport.ts`，目录壳没删。

**修复**：`rmdir` 4 个空目录，1 个 PR < 1 行 diff。

---

### 问题 R6：session-handle 仍是"权威读 + 双写镜像"混合 — 🟡 P2

**问题陈述**：Issue 2 验收为 ✅，但 **`buildLegacyConversationHandleBinding()` 在 `group-runtime.ts` 三处调用**——意味着每次更新 run 状态仍同时写入 `childConversationId` + `activeConversationId`。SSOT 是"读"侧建立了，但"写"侧仍在维护两份镜像。

**证据**：
- `src/lib/agents/group-runtime.ts:466, 496, 1391` 三处仍调 `buildLegacyConversationHandleBinding()`。
- 这与 followup 文档"`childConversationId / activeConversationId` 已是兼容镜像，不再是新的架构权威读源"的描述一致——但"读权威 + 写双份"中长期会导致**写漂移**：如果哪天有人忘了过 helper 直接写 `sessionProvenance.handle`，旧字段就开始 stale。

**根因**：Issue 2 当前阶段的策略是"对 API/UI 兼容"，所以双写不能立刻停。但没有时间表说什么时候停双写。

**修复**：
- 加 `// @TODO(2 versions): drop legacy mirror writes after API/UI fully migrated`。
- 加 lint：禁止业务代码直接读 `childConversationId / activeConversationId`，必须过 `resolveRunSessionHandle()`。
- 2 个版本灰度后删 `buildLegacyConversationHandleBinding()` 与两个旧字段。

---

### 问题 R7：growth-* 6 个文件 ~1500 LOC 仍 export 但无主链消费 — 🟡 P2

**问题陈述**：Issue 3 把 growth POST 改 410 Gone 后，`growth-observer / growth-evaluator / growth-publisher / growth-approval / growth-script-dry-run / growth-proposal-store` 6 个文件实际上只服务于 `GET /api/company/growth/*`（只读 API）+ `legacy-growth.ts` 的拦截 payload + 测试。

**证据**：
- 6 个 growth-* 文件外部引用点只有 `company-kernel/index.ts`（re-export）+ `operating-kernel.test.ts`（测试）。
- `company-loop-executor.ts` 已不再产 growth proposal（followup 已确认）。
- `crystallizer.ts` 454 LOC 现在**只**给 `index.ts` re-export 用，没人调 `generateGrowthProposals()`。

**根因**：Issue 3 走的是"410 + 保留只读"渐进式 sunset，没有进入"删除"阶段。

**修复**：
- 等"用户/工具不再访问 GET /api/company/growth/*" 1-2 周观察期后，删 6 个文件 + crystallizer.ts + 相应 API route + index.ts re-export。
- 预计删除 ~1500 LOC + 7 个 GET route。

---

### 问题 R8：claude-engine 内部跨层穿透仍在 — 🟢 P3

**问题陈述**：原 TOP 6 已识别但未列入 14 条修复。本轮 audit 再次确认：
- `claude-engine/tools/execution-tool.ts` 直接 `getExecutor()` / `getProviderInventory()`（providers）
- `claude-engine/api/pi-transport.ts` 直接 `resolveCodexAccessToken()`（bridge）

**根因**：claude-engine 早期独立设计，但 execute-tool 与 pi-transport 在落地时为了图省事直接 import 了 singleton。

**风险**：claude-engine 想做单元测试或多租户场景时无法注入不同的 provider/auth；与 TOP 6 的根因一致。

**修复**：见 TOP 6 长期建议（DI / setProviderFactory）。**不在本轮 quick fix 范围**。

---

### 问题 R9：4 个空 API route 目录 — 🟢 P3

**问题陈述**：
- `src/app/api/ceo/chat/[sessionId]/send/`（Apr 6）
- `src/app/api/ceo/command/`（May 9）
- `src/app/api/conversations/[id]/approve-step/`（Mar 22）
- `src/app/api/agent-groups/[id]/`（Apr 6）

都只有目录壳，无 `route.ts`。

**根因**：历次 route 重组留下的空壳。`ceo/command` 是 5 月 9 日刚清的（与 "remove-ceo-command-api-technical-issue-2026-05-09.md" 设计文档对应）；其他 3 个更早。

**修复**：4 个 `rmdir`，1 PR。

---

### 问题 R10：`x-ag-proxied-by-role` header 信任链无验证 — 🟡 P2

**问题陈述**：`src/server/shared/proxy.ts:28` 在转发请求时 set `x-ag-proxied-by-role` header，但 `src/server/control-plane/server.ts` 与 `src/server/runtime/server.ts` 的 handler **从来没读过这个 header 做验证**。任何外部 client 可以发任意值的同名 header 绕过"内部 proxy"假设。

**根因**：Issue 7 重点解决的是"web 不直接 import server"，没顺手做 proxy 鉴权。

**风险**：
- 如果 control-plane / runtime 部署时被暴露在公网（即使是内网穿透），任意请求都能伪装成"内部 proxy"通过身份检查。
- 这与原 review TOP 2"可拆分性几乎为零"里 auth 缺失部分一致。

**修复**：
- 短期：proxy 加 HMAC 签名（`x-ag-signature: hmac-sha256(role + timestamp + body, SHARED_SECRET)`），control-plane / runtime 入口验签。
- 长期：proxy 跨进程加 mTLS。

---

## 系统级判断

**这一轮 audit 揭示了一件事**：14 条全清后**主线债已经清干净**，但还有 **2 类边角债**没解决：

1. **测试 / 文档 / 空目录 这种"周边卫生"在 fix 高速推进时被忽略**（R1, R5, R9）。建议每个 PR 加 checklist："改了类型有没有同步改 test？删了文件有没有清空目录？"
2. **死代码大块（R3 的 `src/lib/security/` 2700 LOC）原 audit 完全漏过**——因为原 audit 主要扫"还在变化"的模块；从未变化的死代码反而看不见。建议每年做一次"全仓引用计数"全量扫描。

**优先级建议**：
- **本周内**：R1（删 5 个 test case）+ R3（删 `src/lib/security/`）+ R5（rmdir 4 个空目录）+ R9（rmdir 4 个空 route 目录）。这 4 个一起做不到 200 行 diff，但能减 2700 LOC + 8 个空目录，是高 ROI 卫生 PR。
- **2 周内**：R2（gateway-db readonly 守卫）+ R10（proxy HMAC）—— 这 2 条都是"不修就是 sqlite 异常 / 鉴权漏洞"。
- **滚动**：R4（25 个 route 迁移分批）、R6（session-handle 双写最后一公里）、R7（growth-* 真正删除）。
- **延后**：R8 与 TOP 6 共属同一个根因，留给 claude-engine 模块化 milestone 一起做。

---

## 验证方法

- 4 个 explore agent 并行扫不同子树（providers+backends+bridge / agents+storage / app-api+server / claude-engine+company-kernel）。
- 关键发现现场 grep / read 复核（reactive verification 而非 trust agent）。
- 4 个伪发现已在前面列出，未入主清单。
- tsc `exit=0`（写本文时）。
- vitest 因为本地沙箱 rollup 缺 native 二进制无法跑——R1 的"test 真的会失败吗"待用户在自己机器上 `npx vitest run src/lib/agents/execution-journal.test.ts` 确认。

## 2026-05-10 第一轮整改

### ✅ R1：execution-journal.test.ts — 已修

**改动**：
- L100 `eventType: 'gate:decided'` → `'node:failed'`（incidental 用法，不破坏测试语义）
- L132 `eventType: 'gate:decided'` → `'node:failed'`（同上）
- L194-240 整个 `describe('control-flow event types', ...)` 块删除（3 个 test 都测已删的事件类型）

**验证**：`npx tsc --noEmit --pretty false` → `exit=0`；`grep "gate:decided\|checkpoint:created\|loop:iteration\|switch:routed"` 在文件内 0 命中（仅留一段说明性注释）。

### ✅ R3：`src/lib/security/` 整目录 — 已删

**改动**：
- 第一阶段：在 `src/lib/security/index.ts` 顶部加 `@deprecated` 注释；同步在 `docs/code-reuse-strategy.md`、`docs/permission-system-research.md` 顶部加 deprecation 提示。
- 第二阶段：用户机器执行 `git rm -rf src/lib/security/` 删除 13 个 .ts 文件。

**验证**：`ls src/lib/security` → No such file or directory ✅；`git status` 显示 13 个 D 条目；`tsc exit=0`。

### ✅ R5：claude-engine/api 4 个空 provider 子目录 — 已删

**改动**：用户机器 `rmdir src/lib/claude-engine/api/{native-codex,gemini,grok,openai}`。`claude-engine/security/__tests__/`、`claude-engine/security/`、`claude-engine/__tests__/` 3 个其他空目录一并清理。

### ✅ R9：4 个空 API route 目录 — 已删

**改动**：用户机器 `rmdir` 4 个空目录：
- `src/app/api/ceo/chat/[sessionId]/send/`
- `src/app/api/ceo/command/`
- `src/app/api/conversations/[id]/approve-step/`
- `src/app/api/agent-groups/[id]/`

### 实际执行回放（2026-05-10）

**第一次（R9 ✅，R3+R5 失败）**：
- 一键脚本里 `git rm -r src/lib/security/` 因 `index.ts` 已被加 deprecation marker（dirty）默认拒绝；`&&` 链在那断开，R5 的 `rmdir` 没触发。
- 但脚本里 R9 那段在 `;` 之后独立执行，4 个空 API route 目录全删成功。
- zsh 还把 `# 注释` 当命令名报了几条 `command not found: #`（无害，但说明 zsh 默认不识别交互式行内注释）。

**第二次（R3+R5 ✅）**：
- 加 `rm -f .git/index.lock` 解掉 May 9 22:30 留下的 0 字节僵尸 lock；
- `git rm -rf src/lib/security/` 改用 `-f` 强制删（覆盖 dirty 拒绝）；
- 13 个 .ts 文件全部 `rm`，目录消失。
- R5 的 4 个 api 子目录其实第一次就被删了（因为它们独立于 R3 的 `&&` 链），第二次 `rmdir` 报"No such file"是预期。
- 最终 `npx tsc --noEmit --pretty false` `exit=0`。

### 累计代码变化（截至 R1+R3+R5+R9 落地）

```
102 files changed, 1346 insertions(+), 3115 deletions(-)
```

**净减少 ~1769 LOC**（其中 R3 单项贡献 13 文件 / ~2700 LOC 删除）。

---

> 维护：本文是 Round 2 快照（2026-05-10）。如再有新一轮 audit，建议另开 `architecture-review-round3-YYYY-MM-DD.md`。整改进度写到 `docs/PROJECT_PROGRESS.md` 并反向引用本文 R 编号。
