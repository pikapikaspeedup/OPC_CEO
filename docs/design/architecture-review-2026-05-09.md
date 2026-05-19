# 架构问题清单与方案建议（2026-05-09）

> 上下文：紧接 Antigravity 平级化降级（同日完成）做的一次系统化架构 review。
> 方法：4 个 audit agent 并行扫描 → 4 个 verify agent 逐条复核 → 把伪发现剔除、把数字修正。
> 范围：`src/lib/{providers,backends,bridge,agents,claude-engine,company-kernel,storage}/`、`src/app/api/`、`src/server/`、`docs/`。
>
> 本文不替代 ARCHITECTURE.md、不替代各模块设计文档；它只列**当前明确成立的架构债**，按"风险×可改性"排序，给出根因和落地建议。
>
> 每条都附 `file:line` 证据；执行清理时请先以本文证据为准重新核验，避免参考过期。

---

## 摘要

> **2026-05-09 整改状态**：详见 [docs/project/architecture-review-2026-05-09-followup.md](/Users/darrel/Documents/Antigravity-Mobility-CLI/docs/project/architecture-review-2026-05-09-followup.md)。
> 已 ✅ 修复 8 / 🟡 部分缓解或仅文档化 3 / ⏸ 未改动 3 / ❌ 退化 0；tsc `exit=0`。

| # | 问题 | 风险 | 一句话定位 | 优先级 | 状态 |
|---|------|------|-----------|--------|------|
| 1 | Storage 双写无锁 | 🔴 | Next route 与 server runtime 并发写同一份 sqlite，无事务隔离 | P0 | 🟡 部分（仅 2 个 upsert 事务化）|
| 2 | Conversation ID 四套字段并存 | 🔴 | `parent/child/active + sessionProvenance.handle` 历史叠加，靠优先级链兜底 | P0 | ⏸ 未改 |
| 3 | growth-* 与 self-improvement-* 双管道并存 | 🔴 | 旧 growth 流未退场，新 self-improvement 已成主线，CEO 决策只走新流 | P1 | 🟡 部分（决议+ deprecation log）|
| 4 | `self-improvement-execution.ts` 死文件 | 🟡 | 0 个非测试消费方，已被 `self-improvement-codex-execution.ts` 替代 | P1（清理简单）| ✅ 已删 |
| 5 | `llm-oneshot.ts` 双轨实现，Antigravity 分支不可达 | 🟡 | 降级反例：API-backed 主路 + Antigravity 死路并存，throw 永远到不了 | P1 | ✅ 已修（精简到 79 行）|
| 6 | 日志三件套部分 schema 重叠 | 🟡 | `execution-journal` 与 `ops-audit` 在 checkpoint/gate/switch/loop 重叠 | P2 | 🟡 仅文档化 |
| 7 | ~~19 个~~ **108 个** Next route 直 import `@/server` + 内联 proxy 决策（[订正见下](#关于-7-的数字订正)） | 🟡 | 阻塞未来把 control-plane 拆成独立进程 | P2 | ⏸ 未改 |
| 8 | `antigravity-executor.ts` 静默吞错 + `servers[0]` 硬选 | 🟡 | cancel 失败不上报；多 server 路由错位 | P2 | ✅ 已修 |
| 9 | `bridge/gateway.ts` ownerMap 刷新静默吞错 | 🟡 | 单 server 短暂故障会让本周期 cascade 路由 stale | P2 | ✅ 已修（failedPorts 机制）|
| 10 | `agents/` 三处直 import `bridge/grpc` | 🟢 | 1 处合理（watch-conversation Antigravity-only），2 处可下沉/删 | P3 | ✅ 已修 |
| 11 | `runtime-helpers.ts` 部分私有函数被 export + 重复定义 | 🟢 | 5 个内部 helper 不该暴露；`summarizeFailureText/getFailureReason` 与 `project-utils.ts` 重复 | P3 | ✅ 已修 |
| 12 | `bridge/worker-entry.ts → agents/gateway-home` 反向依赖 | 🟢 | 基础设施层 import 业务层，初始化点错位 | P3 | ✅ 已修 |
| 13 | Provider 列表在 3 处定义 | 🟢 | 加 provider 要改 `provider-availability` + `ai-config` + `provider-inventory` | P3 | ✅ 已修（建 provider-registry）|
| 14 | `security/` vs `security-core/` 目录命名分裂 | 🟢 | security-core 是上游工具包，security 是本地适配，命名易混 | P4（可缓） | ✅ 已修（迁到 security-adapters） |

> **2026-05-10 二次更新**：原 14 条已全部 ✅；Round 2/3 又新发现 13 条颗粒度 + 7 条系统级。当前活跃总账与解决决策见下方"当前状况盘点与路线图"章节。

---

## 当前状况盘点与路线图（2026-05-10 第二次更新）

> **本节是当前所有未解决问题的统一索引**，把原 14 条之外的所有 Round 2 / Round 3 / TOP 7 问题整理在一起，并明确每条的"做、缓、不做"决策。
> 决策原则：(1) 代价低 + ROI 高 → **本月做**；(2) 代价中 + 必须做 → **下季度做**；(3) 代价高 + 当前 ROI 不够 → **暂不解决**，明确写下来避免反复讨论。

### 总账

| 类别 | 总数 | ✅ 已修 | ⏸ 待修 | 决策 |
|------|------|--------|---------|------|
| 原 14 条颗粒度 | 14 | 14 | 0 | 全部关闭 |
| Round 2 R1-R10 | 10 | 5 (R1, R3, R5, R7, R9) | 5 | 见下决策 |
| Round 3 R11-R13 | 3 | 2 (R11, R12) | 1 | 见下决策 |
| 系统级 TOP T1-T7 | 7 | 部分 | 部分 | 见下决策（与 R 编号有重叠）|

**整体进度**：原 14 条与近程收敛项已清完；当前剩余问题集中在**下季度评估项 + R13 + 长周期系统级议题**，分三档处理。

---

### 第 1 档：本月做（低代价 + 高 ROI，预估 < 2 周可全部完成）

| 编号 | 问题 | 当前状况 | 解决方案 | 预估代价 |
|------|------|---------|---------|---------|
| **R11** | `phaser` 死依赖 | ✅ 已完成（2026-05-10 第四轮）：`package.json` / `package-lock.json` 已移除 `phaser`，源码仍 0 import | 无后续动作 | 已完成 |
| **R12** | `lodash-es` 半死 | ✅ 已完成（2026-05-10 第四轮）：已确认无真实 runtime import，删除 `security-core/lodash-es.d.ts`，并移除 `@types/lodash-es` | 无后续动作 | 已完成 |
| **R7** | growth-* 1500 LOC 真删 | ✅ 已完成（2026-05-10）：active growth 自动化、UI 写入口、approval callback 写旁路已退场；已删除 `crystallizer.ts`、`growth-approval.ts`、`growth-script-dry-run.ts`、`growth-evaluator.ts`、`growth-observer.ts`、`growth-publisher.ts`；剩余 `growth-proposal-store` / `growth-observation-store` 只承担历史只读 GET，9 个 growth route 保留为 GET/410 兼容层 | 旧 Phase 5 Crystallizer 属于业务能力进化，RunCapsule/MemoryCandidate → SOP/workflow/skill/rule/script 的能力已迁入 `evolution/*` | 已完成 |
| **T7-2** | 4 个 Antigravity 残留 adapter | ✅ 已确认误判（2026-05-10 第七轮）：`native-codex-adapter`、`codex-adapter`、`claude-code-*` 都有主链 caller，属于 active codex / claude-code bridge 能力，不是可直接删除的 Antigravity 残留 | 从“死代码删除项”改为“主链能力归类完成”，不再作为架构债跟踪 | 已完成 |
| **T3-1** | 可观测性 Phase 1：`correlationId` | ✅ 已完成（2026-05-10 第五轮）：`server.ts` 与 `startRouteServer()` 已注入/透传 `x-ag-correlation-id`，logger 通过 `AsyncLocalStorage` 自动带 `correlationId`，bridge worker 进程带 `AG_PROCESS_ROLE=bridge-worker` / `processTag` | 无后续动作 | 已完成 |
| **T4** | 写 `RUNTIME_FLOWS.md` + 子模块 README | ✅ 已完成（2026-05-10 第六轮）：新增 `docs/RUNTIME_FLOWS.md`，并为 `agents/`、`company-kernel/`、`claude-engine/` 补齐子模块 README | 无后续动作 | 已完成 |

**第 1 档总投入**：约 8-12 工作日（一个人）。**完成后效果**：
- 代码减 ~1500 LOC（R7）+ R12 相关类型依赖；T7-2 已确认是主链能力，避免误删
- 生产排障从"看不出"变成"按 correlationId 串日志"
- 新人 onboarding 从"读多份 design doc 拼路径"变成"看 RUNTIME_FLOWS.md"
- 这一档完成后，整体架构成熟度从 60 分提到 75-80 分

---

### 第 2 档：调研中（待 RFC 决策）

> **2026-05-10 第三次更新**：第 2 档原本 7 条，经过用户决策后重新分流：
> - **5 条转入第 3 档**（暂不解决，见下表）
> - **2 条进入"调研中"**：T5-2 与 T3-2 需要先做深度调研出 RFC，再决定方案与时间表
>
> 原"下季度评估"判断已废弃——当前业务规模下，触发条件全部未到，机会成本不值得投入。

| 编号 | 问题 | 状态 | 输出物 |
|------|------|------|--------|
| **T5-2** | scheduler 双入口 / CEO 三决策面板 | 🔵 调研中 | `docs/design/scheduler-and-ceo-command-convergence-rfc-2026-05-10.md`（含现状摸底 + 痛点验证 + 3 方案对比 + 推荐）|
| **T3-2** | 可观测性 Phase 2：circuit-breaker 真接入 + distributed trace | 🔵 调研中 | `docs/design/observability-and-resilience-rfc-2026-05-10.md`（含 4 方案对比：A-circuit-only / B-自研 trace / C-OpenTelemetry+Jaeger / D-OpenTelemetry+SaaS + 推荐）|

**调研产出后处理流程**：RFC 评审 → 决定走 A/B/C 任一档 → 入"第 1 档"开始执行；或直接判定无价值 → 入"第 3 档"暂缓。

---

### 第 3 档：暂不解决（代价过大 / 当前 ROI 不够）

> 这些问题真实存在，但解决代价远超当前价值；明确写下来**不再反复讨论**，等到触发条件满足再启动。

| 编号 | 问题 | 当前状况 | 暂不解决的理由 | 触发条件 |
|------|------|---------|--------------|---------|
| **R2** | gateway-db readonly 模式无统一拦截 | 25+ 处 upsert/delete 函数无 mode 守卫 | 单进程模式不触发；用户决策"等首次出现 SQLITE_READONLY 错时再修" | 首次生产出现 SQLITE_READONLY 错误 |
| **R4** | 25 个 route 没迁新 proxy pattern | `evolution / knowledge / rules / skills / cc-connect / scope-check / conversations` 等仍走旧或无 proxy | 单进程部署用户无感；用户决策"感觉没必要" | 真要把 web 拆成独立部署时 |
| **R6** | session-handle 仍"权威读 + 双写镜像" | `buildLegacyConversationHandleBinding` 三处仍写两个旧字段 | 1-2 人维护下漂移风险可控；用户决策"先不做" | 团队扩到 3 人以上 / 出现新人误读旧字段 bug |
| **R10** | proxy 无 HMAC 鉴权 | `x-ag-proxied-by-role` header 无验证 | 用户决策"不做"——仅本机使用，不会公网 / 内网部署 | 真要让 dev 机器以外的人接入此系统 |
| **R13** | storage → agents 5 处反向 import | gateway-db.ts 反向 import 5 处（type-only 为主）| 不影响 runtime 行为；用户决策"也不需要" | 想把 storage 抽成独立 npm 包 |
| **T1 完整版** | 状态一致性的"单写者模型 / 跨进程内存协调" | Issue 1 已做"web 默认只读"；但内存 Map 与 SQLite 不原子 + scheduler-worker 与 main process 内存分裂仍在 | 完整解决要引入 SQLite WAL + 单写者契约 / 或迁移到 postgres + LISTEN/NOTIFY；2-3 个月工作量；**当前单机部署、单 runtime 实例下不会触发** | 出现以下任一：(1) crash 后频繁丢 run 状态；(2) 横向扩 runtime 需求；(3) 单租户 → 多租户 |
| **T2 完整版** | 可拆分性的"分布式 owner map / Redis / mTLS" | Issue 7 已收敛 proxy；R10 已决定不做；conversation owner 仍内存独占；横扩 runtime 仍不可行 | 完整方案需要 Redis + 分布式锁 + gRPC 服务发现；3-6 个月工作量；**当前单进程 all-in-one 模式下用户无感** | 出现以下任一：(1) 单进程承载不了流量；(2) 多地部署需求；(3) 多租户隔离需求 |
| **R8 / T6 完整版** | claude-engine 跨层穿透到 providers / bridge | `execution-tool.ts` / `pi-transport.ts` singleton 直接 `getExecutor` / `resolveCodexAccessToken` | 完整方案要引入 DI + 构造函数注入 ProviderResolver / AuthResolver；触及 claude-engine 37k LOC 的核心架构；2-3 个月；**当前不影响功能、不影响 tsc** | 出现以下任一：(1) 需要 claude-engine 离线/mock 测试；(2) 多租户场景 token 需要隔离；(3) claude-engine 想抽成独立 npm 包 |
| **T1 / T6 内存分裂** | scheduler-worker ↔ main process 内存 Map 不同步 | 跨进程仅靠 sqlite 通信，无主动失效 | 与 T1 完整版同源；需先解决 SSOT 问题再谈失效 | 同 T1 完整版 |
| **日志合并到单流** | execution-journal + ops-audit 长期合并成单 jsonl 流 | Issue 6 已让两套不重叠；继续合并需重写下游消费者 | 当前不重叠就够用；合并的 ROI 主要是"少一个文件"，价值不高 | 下游 dashboard 需要做且 multi-source aggregation 太烦时 |
| **monorepo 拆 workspace** | 按角色（web / api / runtime）拆 npm workspace | 当前 single package | 拆分 ROI 主要是"web 不带 sqlite 依赖"，但对单机部署用户无感；拆分代价大（要改大量 import path） | 真要做云端 SaaS 部署时 |

---

### 决策总结（2026-05-10 第三次更新）

- **已完成**：R7 / R11 / R12 / T3-1 / T4 / T7-2 + 业务进化能力迁入 `evolution/*` + 产品 UI Phase 1+2 触达点
- **🔵 调研中**：T5-2 / T3-2（2 项，等 RFC 评审后决策）
- **明确不做**（11 项）：
  - 颗粒度 5 条：R2 / R4 / R6 / R10 / R13（用户决策"不做或被动响应"）
  - 系统级 5 条：T1 完整版 / T2 完整版 / R8(T6) 完整版 / 日志合流 / monorepo 拆 workspace
  - 加额外 1 条：R6 漂移风险（与 T1 同源）

**当前架构成熟度判定**：~80 分。"业务上够用 + 演进路径清晰 + 第 3 档明确暂缓"，不等于"最优"——离 85 分（公网部署级）需要 R10 + R2 + T3-2，离 90+ 分（多租户 / 横向扩）需要 T1/T2 完整版。但**这些都需要触发条件先到**。

**预期效果**：
- ✅ 第 1 档已完成 → 架构成熟度 60 → 80 分；生产排障能力质变 + 业务进化主线产品化
- 🔵 第 2 档调研中 → RFC 决策后再判定升级到 1 档执行 / 或下放到 3 档暂缓
- ⏸ 第 3 档保持暂缓 → 不影响日常运行；触发条件未到不主动启动

---

## P0 级问题

### 问题 1：Storage 双写无锁

**风险等级**：🔴 高（生产环境数据竞态）

**问题陈述**：`src/lib/storage/gateway-db.ts`（better-sqlite3）被 38 个文件 import，其中既有 Next App Router 的 route handler 也有 `src/server/` 下的 runtime 模块。当 `dev:web` 与 `dev:api` 作为独立进程同时运行时，两个进程都持有同一份 sqlite 文件句柄，**对同一张表并发写入但没有显式事务包装**。

**证据**：
- `package.json` scripts 定义了 `dev:web` / `dev:api` 双进程模式（`AG_ROLE=web` 与 `AG_ROLE=api`）。
- `run_conversation_links` 表：`src/app/api/agent-runs/[id]/conversation/route.ts` 与 `src/lib/bridge/conversation-importer.ts`（运行在 bridge worker 子进程）同时写入。
- `projects` 表：`src/app/api/projects/route.ts` 与 `src/lib/agents/scheduler.ts` / `src/lib/company-kernel/company-loop-executor.ts`（runtime）同时写入。
- 全仓搜索 `db.transaction(` 命中数极少；写操作主要是裸 `db.prepare(...).run(...)`。

**根因**：
- 历史上 `web` 与 `api` 是同一个 Next 进程，sqlite 单进程写入天然串行；后来引入 `AG_ROLE=api` 拆分时，没有同步把"谁是唯一写入者"的所有权契约约定下来。
- `gateway-db.ts` 没有提供"角色分流"的 API（如"web 进程只读、api 进程读写"），调用点也就没动力遵守。

**影响**：
- SQLite 默认 `journal_mode` 在两进程并发写入时会回退到文件锁定，写入会偶发 `SQLITE_BUSY`，但当前调用方没有统一的重试逻辑。
- 表里出现脏写（最后写入者胜出）的情况无法靠现有日志复盘——三套日志（见问题 6）都不记 db 写入序列。

**方案建议**：
- **短期（1 周内）**：
  - 给 `gateway-db.ts` 加 `getDb({ writable: boolean })` 入口，按 `AG_ROLE` 拒绝错误调用——`web` 进程拿到的是 readonly handle。
  - `run_conversation_links` 与 `projects` 这两张高频双写表，所有写操作包 `db.transaction(...)`，至少把"读-改-写"放进同一事务。
- **中期（1 月内）**：
  - 收敛到"单写者"模型：把 `agent-runs/[id]/conversation` 这条路由的写入下沉成"通过 control-plane proxy 写"，`web` 进程不再直接 import `gateway-db`。
  - 配合问题 7 的 proxy 收敛一起做。

**不动的代价**：跑量上来后偶发数据错乱，且因为两进程对同一行的写入没有 happens-before 关系，bug 极难复现。

---

### 问题 2：Conversation ID 四套字段并存

**风险等级**：🔴 高（每次 run 的状态正确性都依赖这个）

**问题陈述**：`AgentRunState` / `RoleProgress` / `SessionProvenance` 三个类型同时维护四种 conversation 标识符，靠 `resolveSessionHandle()` 的优先级链兜底。

| 字段 | 定义位置 | 写入时机 | 文件命中 |
|------|---------|---------|---------|
| `parentConversationId` | `group-types.ts:358` | 上游 cascade 引用，nudge/restart 时传入 | 15 |
| `childConversationId` | `group-types.ts:359` (RoleProgress + AgentRunState) | session.handle 首次回调 | 10 |
| `activeConversationId` | `group-types.ts:360` | onStarted 回调（覆盖 child） | 12 |
| `sessionProvenance.handle` | `group-types.ts:395` | V6 引入的"权威 handle" | 2 |

**证据**：
- 优先级链在 `src/lib/agents/group-runtime.ts:262-280` 的 `resolveSessionHandle()`：`sessionProvenance.handle → activeConversationId → childConversationId → role-level fallback`。
- 写入位置散在 `group-runtime.ts:489`（写 `childConversationId`）与 L520（写 `activeConversationId`），同一 session.handle 被写两个字段。
- 本次 Antigravity 降级把 `bindConversationHandleForProviders` 从硬编码 `['antigravity']` 改成 `[provider]`，相当于"对所有 provider 都写一遍 child + active"——降级动作正确，但**没顺手收敛字段**。

**根因**：
- 历经 V1→V6 迭代，每轮新增字段都为了解决一个 bug，但旧字段为了"前向兼容"全部保留。
- `SessionProvenance.handle` 是 V6 想做的"权威源"，但只在新代码里写，旧调用方仍然读 `activeConversationId`，导致权威源建立不起来。

**影响**：
- 任何把 run 状态序列化/反序列化的路径（snapshot、restore、cross-process proxy）都要正确处理四个字段；漏一个就会让 `resolveSessionHandle()` 走到错误优先级。
- supervisor / scheduler / intervene / restart_role 都依赖此字段定位"当前活跃 cascade"，写错会让 supervisor 巡检到错误对话。

**方案建议**：
- **短期（2 周内）**：
  - 把 `resolveSessionHandle()` 的优先级链作为唯一读取入口，禁止外部代码直接读这四个字段（用 `// @internal` 标 + lint rule）。
  - 加单测：在 V6 主路径下，写入后读取四字段必须等价。
- **中期（1 月内）**：
  - `SessionProvenance` 升为唯一权威：所有写入只写 `sessionProvenance.handle`，旧三字段做 getter 转发。
  - 通过两个版本灰度后删除三个旧字段。
- **长期**：把整个 conversation 标识符做成不可变 ADT（`type ConversationRef = ProvenanceRef`），避免再新增并行字段。

**不动的代价**：每次新加 run lifecycle 钩子（如本次降级）都要在四个字段之间小心翼翼，认知成本递增。

---

### 问题 3：growth-* 与 self-improvement-* 双管道并存

**风险等级**：🔴 高（两条主线意图不一致，调度链路含糊）

**2026-05-10 收口状态**：已修复。`growth-*` 不再是活跃自动化管道；旧写实现与 approval callback 写旁路已删除，剩余 `GET /api/company/growth/*` 和 POST `410 Gone` 只用于历史兼容。旧 Phase 5 Crystallizer 的业务能力进化能力已迁入 `evolution/*`。

**问题陈述（原始）**：`src/lib/company-kernel/` 同时存在 `growth-*`（6 文件，旧）和 `self-improvement-*`（15 文件，新）两条 `proposal → evaluation → approval → execution` 管道。CEO 决策入口、release-gate、runtime-state 已切到新流，但旧流仍有 API 路由 + crystallizer 桥接 + `company-loop-executor` 公开接口。

**证据**：
- 新流入口：`/api/company/self-improvement/proposals`、`/signals`，被 `/api/company/ceo/decisions/route.ts` 调用 `syncAllActiveSystemImprovementProposals()`。
- 已删除旧写实现：`crystallizer.ts`、`growth-approval.ts`、`growth-script-dry-run.ts`、`growth-evaluator.ts`、`growth-observer.ts`、`growth-publisher.ts`。
- `src/lib/approval/dispatcher.ts` 对旧 `publish-growth-proposal` / `reject-growth-proposal` custom callback 只记录 retired warning，不再发布或拒绝 growth proposal。
- 剩余历史数据面：`growth-proposal-store.ts` 只保留 `count/get/list`，`growth-observation-store.ts` 只保留 `listGrowthObservations()`；`/api/company/growth/*` 的写 route 返回 `410 Gone`。
- `src/lib/evolution/generator.ts` 已接收 `MemoryCandidate`、`KnowledgeAsset`、RunCapsule 聚类和 repeated prompt runs，生成 SOP/workflow/skill/script/rule 业务能力 proposal。
- `src/lib/evolution/publisher.ts` 已支持发布 canonical workflow、skill、rule、workflow script，或把 SOP 发布为 active `KnowledgeAsset(pattern)`。

**根因**：
- 项目从"growth proposal"心智模型（CEO 提议 → 公司增长）演进到"self-improvement signal"心智模型（系统观测信号 → 自我改造），换名时新增了一整套类型，但旧 API 路由作为"用户已熟悉的 URL"被保留。
- 没有写下"什么时候用 growth、什么时候用 self-improvement"的判定，工程上就并行漂下去。

**原影响（已消除）**：
- CEO 决策走 self-improvement，但 company-loop-executor 仍能产生 growth proposal，可能出现"系统提了 growth 提议、CEO 看不见"。
- 两套 store / approval 各自维护状态机，bug 修复要做两遍（已经在 `growth-approval.ts` vs `self-improvement-approval.ts` 看到几乎一样的状态翻转代码）。

**当前影响**：上述 active 双管道风险已消失；剩余影响仅是历史兼容 route 和历史表读取面需要继续维护。

**方案建议**：
- **已完成**：self-improvement 是唯一软件自迭代主线；evolution 是业务能力进化主线；company loop、CEO 决策、UI 写入口、API 写 wrapper、approval callback 均不再产生或推进 growth proposal。
- **保留边界**：`/api/company/growth/*` 保留 GET 历史查询和 POST `410 Gone`，用于旧客户端识别迁移，不再承担业务写入；业务能力新提案走 `/api/evolution/proposals/*`。
- **后续可选**：如果确认无需旧客户端兼容，再单列 compatibility cleanup，删除 9 个 growth route 与两张历史表读取面。

**不动的代价**：当前写链路已清零；仅剩旧 URL / 历史表读取面的兼容维护成本。

---

## P1 级问题

### 问题 4：`self-improvement-execution.ts` 是死文件

**风险等级**：🟡 中（清理成本极低，但留着是迁移未完成的明确信号）

**问题陈述**：`src/lib/company-kernel/self-improvement-execution.ts` 0 个非测试消费方。

**证据**：
- 全库 `grep -rn "self-improvement-execution\b"` 只命中 `self-improvement-execution.test.ts:32` 一个 import。
- 同名职责的 `self-improvement-codex-execution.ts` 有 8 个非测试消费方：`server.ts:41`、`release-gate.ts:480`、`index.ts:251`、`approval.ts:10`、`/api/company/self-improvement/proposals/[id]/run-codex/route.ts:3`、`/api/agent-runs/[id]/intervene/route.ts:8`、`/api/agent-runs/[id]/route.ts:8`、`/api/projects/[id]/resume/route.ts:8`。
- 文件内容看：`self-improvement-execution.ts` 通过 `executeDispatch()` 走 dispatch-service 主链；`self-improvement-codex-execution.ts` 走 codex 直接驱动。后者全面接管。

**根因**：从 dispatch-service 路径（旧）切到 codex direct execution（新）时，新文件单独命名为 `*-codex-execution.ts`，旧文件忘删。

**影响**：仅认知噪音 + 测试维护成本（test 还在跑死代码）。

**方案建议**：
- **短期（本周内）**：删除 `self-improvement-execution.ts` 与 `self-improvement-execution.test.ts`。
- 顺手核对 `release-gate.ts` 是不是真的只通过 codex execution 路径触发；如果是，把 codex execution 拔到一等公民 API（不带 `-codex-` 后缀）。

**不动的代价**：未来读 `self-improvement-*` 系列的人会被误导，以为有两条平行执行路径。

---

### 问题 5：`llm-oneshot.ts` 是降级反例

**风险等级**：🟡 中（在主路径上保留死代码，与降级目标直接矛盾）

**问题陈述**：`src/lib/agents/llm-oneshot.ts:callLLMOneshot` 函数前半段走 `ClaudeEngine`（API-backed providers），后半段保留了 Antigravity polling 全套逻辑（`discoverLanguageServers / getApiKey / cascade / poll`）。L86 `if (provider !== 'antigravity') throw` 在当前配置下**永远不可达**。

**证据**：
- `API_BACKED_PROVIDERS` set（L34-41）= `{native-codex, claude-api, openai-api, gemini-api, grok-api, custom}`。
- `resolveProvider(layer, ...)` 来自 `ai-config.ts`；`DEFAULT_CONFIG.layers.{executive,management,execution,utility}.provider = 'claude-api'`（本次降级刚改）。
- `callLLMOneshot` 的实际调用方 `src/app/api/pipelines/generate/route.ts:39` 不传 `layer`，默认 `'executive'`。
- 推论：除非有人显式把 layer override 成 antigravity，否则 provider 落在 `API_BACKED_PROVIDERS` 内 → 走 L61 分支 → L86 throw 不会被求值 → L96-147 的 antigravity polling 代码 **死代码**。

**根因**：本次降级改 `defaultProvider`、改主链路 session 绑定、改 supervisor，但漏了 `llm-oneshot.ts` 这条"特殊"路径——它不走 backend 抽象，而是直接 import `bridge/gateway`。

**影响**：
- 占代码体积的同时给后人误导（"oneshot 还支持 antigravity 啊"）。
- L11 的 `import { discoverLanguageServers, getApiKey, grpc } from '../bridge/gateway'` 拉进了死路径才需要的依赖，与"agents 不应直接 import bridge"的目标冲突（见问题 10）。

**方案建议**：
- **短期（本周内）**：
  - 删除 `callLLMOneshot` L86 之后的整段 antigravity polling 分支。
  - L11 的 import 同时收掉 `discoverLanguageServers / getApiKey / grpc`，只留 `import { ClaudeEngine } from '../claude-engine/...'`。
  - 把 L86 的 throw 换成 `throw new Error('callLLMOneshot only supports API-backed providers; got: ${provider}')`，作为 future-proof safety valve。
- **中期**：把 `callLLMOneshot` 整体迁移成 `ClaudeEngine.chatSimple()` 的薄壳，与 backend 抽象对齐。

**不动的代价**：下次给 oneshot 加新 provider 时会被死代码误导一两次。

---

## P2 级问题

### 问题 6：日志三件套部分 schema 重叠

**风险等级**：🟡 中

**问题陈述**：`run-history` / `execution-journal` / `ops-audit` 三套 JSONL 系统并存。verify 后确认：
- `run-history` 是**通用日志**（`eventType: string` 自由命名），主要写 conversation message + provider transport 事件，与另外两套基本不重叠。
- `execution-journal` 是 **node 粒度控制流日志**，10 个事件类型（`node:activated/completed/failed`、`condition:evaluated`、`gate:decided`、`switch:routed`、`loop:iteration/terminated`、`checkpoint:created/restored`）。
- `ops-audit` 是 **stage/scheduler 粒度操作审计**，26 个事件类型，**与 execution-journal 在 `checkpoint:*`、`gate:*`、`switch:*`、`loop:*` 上明显重叠**。

**证据**：
- `src/lib/agents/execution-journal.ts:23-32` 的 `JournalEventType` enum。
- `src/lib/agents/ops-audit.ts:14-40` 的 `AuditEventKind` enum。
- 重叠事件实例：`gate:decided` 两边都写一遍（一处在 `/api/projects/[id]/gate/[nodeId]/approve/route.ts` 同时调用 `recordJournalEvent` + `recordAuditEvent`）。

**根因**：
- `execution-journal` 早于 `ops-audit` 引入；后者是为了"操作员可读的 stage 审计"加的，但作者没区分清楚 "node 粒度的控制流" 与 "stage 粒度的操作审计" 的边界，结果两边都把 `gate/switch/loop/checkpoint` 当做"有趣事件"写了一遍。

**影响**：
- 排查问题时三处都要查、查重的代价高。
- 同一事件被写两次但 schema 不一样，做 dashboard / 报表时容易聚合错。

**方案建议**：
- **短期**：在 `docs/design/` 里写一份"三套日志的边界表"——明确 `node:*` 只走 journal，`stage:*` 只走 audit，`gate/switch/loop/checkpoint` 哪个走哪个一次性裁定。
- **中期**：把 `execution-journal` 的 `gate:decided / switch:routed / loop:* / checkpoint:*` 5 个事件迁出，由 `ops-audit` 唯一记录；journal 只保留 node 粒度。
- **长期**：评估是否把 journal 与 audit 合并成单条日志流（用 `category: 'journal' | 'audit'` 区分），简化下游消费。

**不动的代价**：诊断耗时长期高 + 偶发统计错。

---

### 问题 7：19 个 Next route 直 import `@/server` + 内联 proxy 决策

**风险等级**：🟡 中（阻塞 control-plane 真正独立）

**问题陈述**：154 个 `route.ts` 中 19 个直接 `import` server runtime / control-plane 业务函数。这 19 个里几乎全部都同时检查 `shouldProxyControlPlaneRequest()` 决定是 proxy 还是本地执行——一个 handler 里既能发 HTTP 又能本地调，决策逻辑分散。

**证据**：
- 实际数字（已 verify 修正，原 audit 报告 108 是误报，包含 helper 二次命中）：19 个 route 直 import `@/server`。
- proxy 决策点 `src/server/shared/proxy.ts:shouldProxyControlPlaneRequest()`，逻辑= `getGatewayServerRole(env) === 'web' && !!getControlPlaneBaseUrl(env)`。
- 历史样例 `src/app/api/company/growth/observations/route.ts`：`if (shouldProxyControlPlaneRequest()) { return proxyToControlPlane(req); }` 之后本地读 `listGrowthObservations()`；`POST` 已统一返回 `410 Gone`。
- `package.json` scripts 暴露 6 种 `AG_ROLE`：`web / api / control-plane / runtime / scheduler / all`。

**根因**：
- 早期单进程 `next dev` 阶段，所有路由就是本地调用；后来加 `AG_ROLE=web` 拆出去时，没有引入"边界 layer"，让每个 route 自己决定。
- `proxyToControlPlane` 是 helper，没强制成入口契约。

**影响**：
- 想真正独立部署 control-plane（让 web 不再 import server 模块、不带 sqlite 依赖）需要逐个 route 改造。
- 每条路由都要写两套代码（local + proxy 调用形状必须一致），维护成本翻倍。

**方案建议**：
- **短期（2 周内）**：
  - 把 `shouldProxyControlPlaneRequest()` 决策上提成 Next middleware：`src/middleware.ts` 在收请求前判断角色，如果是 `web` 就直接 proxy 转发，根本不进 route handler。
  - 这一步可以让 19 个 route 的 `if (shouldProxy) ...` 全删。
- **中期**：route handler 只保留 control-plane / runtime 角色下的本地实现；web 角色启动时直接屏蔽这部分代码导入（用 dynamic import + 角色判定）。
- **长期**：按角色拆 monorepo workspace，让 web 包根本不依赖 server。

**不动的代价**：control-plane 永远拆不出去，只能 all-in-one 部署。

---

### 问题 8：`antigravity-executor.ts` 静默吞错 + `servers[0]` 硬选

**风险等级**：🟡 中（多 server 场景下 silent failure）

**问题陈述**：`src/lib/providers/antigravity-executor.ts` 三处问题：
- L66-70 `addTrackedWorkspace()` 失败仅 `log.warn("may already be tracked")`，但真正的 permission/network 错误也被当作"已 tracked"。
- L184-188 `cancelCascade()` 失败仅 warning，conversation 可能仍在跑，资源泄漏。
- L146-147（实际行号在该处附近）`appendMessage / cancel` 硬用 `servers[0]`，注释承认 "single-server setup"，多 server 时会发到错误 server。

**证据**：行号已经过 verify 修正（原 L66-75 → L66-70；原 L184-195 → L184-188）。其余在 verify 报告 C3 已确认。

**根因**：
- Antigravity 早期是单 server 假设，后来加多 server 没改这两个地方。
- "fail open"哲学（吞错继续）适合 best-effort cleanup，不适合 cancel 这种"必须确认"的操作。

**影响**：
- 多 server 部署下，cancel 失败会让 cascade 持续吃 token，且上层（intervene / restart_role）以为已取消继续推进。
- `addTrackedWorkspace` 真的失败时（如权限不对），后续 cascade 创建会因为 workspace 没注册而拿到 confusing error。

**方案建议**：
- **短期**：
  - `cancelCascade` 把 catch 改成 `throw` 或返回 `{ success: false, reason }` 让上层显式处理。
  - `appendMessage / cancel` 通过 `getOwnerConnection(cascadeId)`（`bridge/gateway.ts`）查正确 server，不要用 `servers[0]`。
  - `addTrackedWorkspace` 失败时区分"已 tracked"（这种 ok）vs 其他错（要 throw）；可以靠 error message 或 status code 区分。
- **中期**：Antigravity 是可选 provider，这块代码价值随时间衰减；可以考虑把多 server 选 server 的逻辑放到通用 backend 层，executor 只持有 connection ref。

**不动的代价**：多 server 部署难以投入生产。

---

### 问题 9：`bridge/gateway.ts` ownerMap 刷新静默吞错

**风险等级**：🟡 中

**问题陈述**：`src/lib/bridge/gateway.ts:156-198` 的 `refreshOwnerMap()` 在 catch 块仅 `log.warn` 后 continue。本周期内该 server 的 cascade 信息不更新，`getOwnerConnection(cascadeId)` 会读到 stale 数据。没有"标 server unhealthy"机制，只能靠下一个刷新周期补偿。

**证据**：verify 报告 C5 已确认 L156-198 catch 行为；下游 `getOwnerConnection`（L102-127）先读 `convOwnerMap`，miss 走 SQLite cache。

**根因**：
- 设计上 `refreshOwnerMap` 是 best-effort 周期任务，但没考虑"短暂故障期间路由错"的场景。
- 没有 per-server health 指标，也就没法 fall through 到其他 server。

**影响**：
- 单 server 偶发 grpc timeout，本周期内对该 server 上 cascade 的所有调用都会路由错（拿到 null connection 或老数据）。
- 用户层面表现：偶发 "cascade not found" / "appendMessage failed"。

**方案建议**：
- **短期**：catch 块加 `serverHealth.markUnhealthy(conn.port, err)` + 保留旧的 ownerMap entry 而非清空（"宁可 stale 也别空"）。
- **中期**：引入简单的 server health monitor，`getOwnerConnection` 在 ownerMap miss 时如果 server unhealthy，直接返回 null + log，让上游可重试。

**不动的代价**：偶发用户报错，不影响主流量但很难复现/诊断。

---

### 问题 10：`agents/` 三处直 import `bridge/grpc`

**风险等级**：🟡 中（与 provider-neutral 目标冲突）

**问题陈述**：本次 Antigravity 降级目标是让 agents 层 provider-neutral，但 3 处仍然直接 `import` bridge：
- `runtime-helpers.ts:8` — `cancelCascadeBestEffort()` 在 group-runtime 中**无条件调用**（任何 provider 都会走），但内部只对 cascade ID 有意义 = 异味。
- `watch-conversation.ts:14, 251` — 静态 `streamAgentState` + 动态 `getTrajectorySteps`。watch-conversation 模块本身就只服务 Antigravity，**这是合理保留**，但应该明确标 `// Antigravity-only`。
- `llm-oneshot.ts:11` — 在死路径上 import grpc，见问题 5，**删 dead branch 一并解决**。

**证据**：verify 报告 C2 已确认；调用 context 也已核对。

**根因**：本次降级聚焦在主链路（group-runtime / prompt-executor / supervisor / run-session-hooks），没扫边角的 helper / watch 模块。

**影响**：
- `runtime-helpers.cancelCascadeBestEffort` 给非 Antigravity provider 也调一遍，等于无操作但占代码路径，未来阅读者会困惑。
- `agents → bridge` 跨层 import 让 lint 没法做"agents 不依赖 bridge"的硬约束。

**方案建议**：
- **短期**：
  - `cancelCascadeBestEffort` 加 `if (provider !== 'antigravity') return;` 早返，明确语义；或干脆下沉到 `antigravity-executor.ts`。
  - `watch-conversation.ts` 文件顶部加注释明确"This module is Antigravity-only"。
  - 删 `llm-oneshot.ts` 的 grpc import（跟问题 5 一起做）。
- **中期**：写 lint rule（eslint custom）禁止 `agents/` 下 import `bridge/grpc|bridge/gateway`，例外列入白名单（仅 `watch-conversation.ts`）。

**不动的代价**：低；主要是后人会怀疑"是不是又有 Antigravity 残留"。

---

### 问题 11：`runtime-helpers.ts` 部分私有函数被 export + 重复定义

**风险等级**：🟢 低（卫生问题）

**问题陈述**：`runtime-helpers.ts` 12 个 export 中 5 个（`normalizeComparablePath / includesPathCandidate / extractStepReadEvidence / filterEvidenceByCandidates / dedupeStringList`）只在文件内部被其他 helper 调用，**没有任何外部消费方**——它们应该是私有函数；同时 `summarizeFailureText / getFailureReason` 在 `src/lib/project-utils.ts:11` 有重复定义。

**证据**：verify 报告 A3 引用计数表已逐个核对。

**根因**：
- 当初从 `group-runtime.ts` 拆 helper 时为了方便测试，把所有函数都 export 了；测试文件被删后这些 export 没回收。
- `project-utils.ts` 与 `runtime-helpers.ts` 各拆出一份"格式化失败原因"的工具函数，没人发现重复。

**影响**：仅认知噪音 + 编辑器自动 import 时容易选错。

**方案建议**：
- **短期**：把 5 个内部 helper 改成非 export；`project-utils.ts` 的两份重复函数删一份，统一从 `runtime-helpers.ts` import。
- 顺便检查 7 个真有外部消费方的 helper，如果 `group-runtime.ts` 是唯一调用方，可以考虑把它们放回 `group-runtime.ts` 同文件（拆得过细的反弹）。

**不动的代价**：极低。

---

### 问题 12：`bridge/worker-entry.ts → agents/gateway-home` 反向依赖

**风险等级**：🟢 低（架构方向问题，非功能问题）

**问题陈述**：`src/lib/bridge/worker-entry.ts:2` `import { initializeGatewayHome } from '../agents/gateway-home'`。bridge 是基础设施层，agents 是业务层，import 方向反了。

**证据**：worker-entry 在 `bridge-worker-process.ts:14` 子进程启动时执行，调用 `initializeGatewayHome({ syncAssets: true })`，是 bridge worker 的关键步骤。

**根因**：bridge worker 子进程需要在启动时初始化 gateway-home（assets 同步等），但没有"bootstrap layer"专门做这种 cross-cutting init，就让 worker-entry 反向 import 业务层。

**影响**：
- 想把 bridge 抽成独立 npm 包永远做不到。
- 给 bridge 模块加 unit test 时必须 mock 整个 agents 层。

**方案建议**：
- **短期**：把 `initializeGatewayHome` 调用移出 `worker-entry.ts`，由 `server.ts`（更高层 bootstrap）在拉起 bridge worker 子进程**之前**完成 gateway-home 初始化，子进程通过环境变量或 shared storage 读到结果。
- **中期**：建立明确的 layering：`bridge` < `providers/backends` < `agents` < `app`，加 lint 规则强制。

**不动的代价**：架构腐烂的小累加，单独看影响小。

---

### 问题 13：Provider 列表在 3 处定义

**风险等级**：🟢 低

**问题陈述**：加一个 provider 实际要改 3 个文件：
- `src/lib/providers/provider-availability.ts`：`PROVIDER_OPTIONS` + `PROVIDER_LABELS`
- `src/lib/providers/ai-config.ts`：`DEFAULT_CONFIG.providerProfiles`
- `src/lib/providers/provider-inventory.ts`：`StoredApiKeys` 类型 + `getProviderInventory()`

`types.ts` 只定义 `AIProviderId` 类型 + `TaskExecutor` 接口，不列具体 provider，**不算第 4 处**（原 audit 报告夸大了一处）。

**证据**：verify 报告 D6。

**根因**：每个文件按职责切（"UI 选项" / "默认配置" / "API key 存储"），但都隐含"我们支持哪些 provider"这个共享事实。没有 SSOT。

**影响**：加 provider 时漏改一处可能让该 provider 在某些路径上不生效，且类型系统不会报错（因为 types.ts 是字符串 union，加进去就过）。

**方案建议**：
- **短期**：建一个 `src/lib/providers/registry.ts`：`PROVIDER_REGISTRY = { antigravity: { label, defaultProfile, apiKeyKey? }, ... }`，三个文件都从这里派生。
- 同时给 `AIProviderId` 类型来源也改成从 `registry` 推导（`type AIProviderId = keyof typeof PROVIDER_REGISTRY`）。

**不动的代价**：低，主要是新人加 provider 时 onboarding 摩擦。

---

### 问题 14：`security/` vs `security-core/` 目录命名分裂

**风险等级**：🟢 低（命名问题）

**问题陈述**：`src/lib/claude-engine/security/` 只有 2 个文件（`auto-mode-classifier.ts` + `bash-security-adapter.ts`），后者直接包装 `security-core/` 的导出；`security-core/` 本身是完整的 36 文件 permission/parsing 工具包。两个目录平级。

**证据**：verify 报告 D5。`security-core/` 是从 Anthropic 上游同步的工具包，`security/` 是本地适配。

**根因**：文件来源不同（上游 vs 本地），目录分开是合理的，但命名（`security` vs `security-core`）让人误以为是新旧两套。

**影响**：极低，主要是阅读时的方向感。

**方案建议**：
- **短期**：把 `security/` 改名为 `security-adapter/` 或 `security-policy/`，用名字明确"本地适配/策略层"语义。
- **中期**：在 `security-core/index.ts` 注释明确"This is upstream-synced; do not edit"，本地修改全部走 `security-adapter/`。

**不动的代价**：极低。

---

## 执行建议（不分批次的"次序"）

1. **本周内**做掉的"低成本高信号"：问题 4（删死文件）、问题 5（删 oneshot 死分支）、问题 11（私有化 helper）。三个 PR 加起来 < 200 行 diff。
2. **2 周内**做掉的"中等收益"：问题 1（gateway-db 写入分流 + 事务）、问题 6（日志边界文档+ schema 收敛）、问题 7（middleware 收敛 proxy 决策）。
3. **1 月内**做掉的"高收益但需要多版本灰度"：问题 2（Conversation ID 收敛到 SessionProvenance）、问题 3（growth → self-improvement 收敛）。
4. **滚动改进**：问题 8 / 9 / 10 / 12 / 13 / 14 随相关模块改动顺手做，不需要单开 milestone。

---

## 附录：验证方法回顾

- 4 个 audit agent 并行扫描（按 Provider+Backend+Bridge / Agents / Claude-engine+Company-kernel / API+Server+跨切 切分）。
- 4 个 verify agent 并行复核每条发现：拉文件、数引用、跑 grep、对照 git diff，重点是"能不能复现 audit 给出的事实"。
- 5 项被 verify 推翻的"伪发现"已在摘要前的 ❌ 列表点出，不再出现在正文。
- 本文中所有 `file:line` 在写作时点与 git HEAD 一致；执行时如已有变更，请以 `git blame / grep` 实时核对。

> 维护：本文是一次性快照，**不要直接修改本文档**记录后续整改进展。整改进展请写到 `docs/PROJECT_PROGRESS.md`，并在该处反向引用本文相应问题编号。
