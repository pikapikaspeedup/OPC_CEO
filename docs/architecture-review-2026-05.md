# 架构评审报告 — Antigravity Gateway

- **日期**：2026-05-30
- **范围**：整体架构，聚焦「冗余」与「设计不当」两个维度
- **方法**：源码静态走查 + 运行时 SQLite/日志取证（`~/.gemini/antigravity/gateway/storage.sqlite`、`logs/system.*.log`）
- **代码体量参考**：前端 80 个组件、`src` 下 592 个源文件 / 175 个测试文件；后端 `agents` 18.5k 行、`company-kernel` 10k 行、`backends` 3.4k 行

---

## 执行摘要

架构的「骨架」是合理的——单进程角色模型、统一 SQLite 索引、插件式 backend 注册、自适应调度器 tick，这些设计本身没问题。

主要病灶是**「演进过程中只加不减」**：新实现上线后旧实现没有删除，而是用注释 / flag / `@deprecated` 标记后继续保留。其结果是多套并行子系统、双路由表、双持久化、巨型组件层层叠加。最值得做的两件事是 **(1) 一次性「退休清理」**，**(2) 本地默认单进程化**——这能去掉最大一块冗余。

> 一句话：**架构的骨没问题，肉太肥**——三代自我改进子系统、deprecated backends、双路由表、双持久化、6 个 >1700 行的巨型组件叠在一起。

---

## 发现清单（按优先级）

### 🔴 P0-1　技术债累积：「新实现上线、旧实现不删」是全栈系统性问题

**现象**：同一概念存在多代实现并存，多数旧代已死或空跑，但代码、数据表、注册项都还在。

**证据**：
- **三代「自我改进 / 提案」子系统并存**：
  | 子系统 | 代码 | 表 / 行数 | 状态 |
  |---|---|---|---|
  | evolution | `src/lib/evolution/{generator,store}.ts` | `evolution_proposals` = **0 行** | 基本全死，不在 company loop 内 |
  | growth | `src/lib/company-kernel/growth-proposal-store.ts` | `growth_proposals` = 9 / `growth_observations` = **0** | company loop 仍调用但**已退休空跑** |
  | system-improvement | `src/lib/company-kernel/self-improvement-*.ts` | `system_improvement_proposals` = **0** / `signals` = 39 | 半挂：只收 signal 不出 proposal |
- company loop 的提案生成实际是空操作：`src/lib/company-kernel/company-loop-executor.ts:240` 只调用 `maybeGenerateGrowthProposals`，而该函数在 `:164` 直接返回 `skippedReason: 'growth-pipeline-retired'`。
- **backends 层双路径**：`src/lib/backends/builtin-backends.ts:1059–1101` 中两个 `@deprecated "Compatibility/manual path only"` 的 `LegacyCodexManualBackend` / `LegacyClaudeCodeManualBackend` 仍在 `registerAgentBackend` 注册。
- **类型层 deprecated 别名**：`src/lib/types.ts:486` / `:505`、`src/lib/providers/types.ts:150`。
- **死代码常量**：`src/lib/agents/gateway-home.ts` 导出的 `PROJECTS_FILE` / `RUNS_FILE` / `CONVS_FILE` / `SCHEDULED_JOBS_FILE` 全库 **0 处引用**。
- `src/lib/agents/group-runtime.ts` 头部注释保留 V1.5 / V2 / V2.5 多版本说明。

**影响**：心智负担大、易误改死路径、数据库 schema 膨胀、新人难判断哪套是「现行」。

**建议**：开一个独立的「退休清理 PR」——删除 evolution 整套、growth 退休分支、死常量、deprecated manual backends 及其空表。低风险、收益立竿见影。

---

### 🔴 P0-2　进程 / 路由架构对「本地单用户应用」过度拆分

**现象**：6 角色微服务式拆分（`all` / `web` / `api` / `control-plane` / `runtime` / `scheduler`），但本质是 Tauri 桌面 / `file://` 工作区 / 单用户的本地工具。

**证据**：
- **内部 localhost HTTP 代理跳转**：标准拓扑（web:3000 + api:3101）下，80 个带 proxy 分支的 Next 路由，真实调用链为
  `浏览器 → web:3000 [Next middleware + 路由 proxy 分支] → fetch 到 api:3101 [自定义正则路由] → import 的是同一个 Next handler 的 local 分支 → 读 SQLite`。
  即一次本地读库要过 5 层；日志里每条 `/api/*` 的 `proxy.ts: Xms` 就是这个空转 middleware（`src/proxy.ts` 名为 proxy 实则只在缺 URL 时返回 503）。
- **两张必须人肉同步的路由表**：
  - 隐式：156 个 `src/app/api/**/route.ts`（Next 文件系统路由）。
  - 显式：122 条手写正则，散在 `src/server/control-plane/server.ts`(50) + `company-routes.ts`(51) + `runtime/server.ts`(21)。
  - 独立 server 通过 `import { GET, POST } from '@/app/api/.../route'` **复用同一份 handler**，但必须手动在正则表注册——漏注册即 web→api 代理静默 404。
- 最简单、零代理跳转、无第二路由表的单进程 `all` 模式被标注为 `legacy`（`server.ts:5`）。

**影响**：每个 API 调用多一次本地网络往返；两张路由表无编译期保证、易漂移；维护成本高于收益。

**建议**：
1. 本地默认跑单进程（`role=all`，直连 lib），去掉代理跳转和正则表；
2. 把多角色拆分降级为「可选部署模式」（仅在真要水平拆分时启用）；
3. 若必须保留拆分，用代码生成正则路由表，消除手动同步。

---

### 🟡 P1-3　持久化策略不统一

**现象**：同类状态有三种落地方式并存。

**证据**：
- 26 张表已在 SQLite，但 **hidden-workspaces 仍是裸 JSON 文件**（`src/server/control-plane/routes/workspaces.ts` 读写 `HIDDEN_WS_FILE`），而明明已有 `workspace_catalog` 表。
- **projects 双写**：`src/lib/agents/project-registry.ts:46` 写 `project.json` 文件 + `:52` `upsertProjectRecord` 写表；读只走 sqlite（`:68 listProjectRecords`）——文件是次要产物，会漂移。
- **owner 缓存双层**：内存 `convOwnerMap`（`src/lib/bridge/gateway.ts:59`）+ 持久 `conversation_owner_cache` 表（仅 **8 行**）。dev 下 bridge worker 关闭，持久层基本没被填。

**影响**：源头真相不统一、漂移风险、读写两套逻辑。

**建议**：统一收口 sqlite（hidden-ws 并入 `workspace_catalog`）；owner 持久缓存在 bridge worker 关闭场景本无用，可移除。

---

### 🟡 P1-4　前端集中式 state + 巨型组件

**现象**：少数超大组件 + 单体 API 客户端 + god orchestrator。

**证据**：
- 6 个组件超过 1700 行：`settings-panel.tsx` **4284**、`projects-panel.tsx` **3889**、`ceo-office-cockpit.tsx` 2115、`ops-dashboard.tsx` 1880、`app/page.tsx` 1863、`department-setup-dialog.tsx` 1736。
- `src/lib/api.ts`：单文件 **1546 行 / 170 个方法**。
- `app/page.tsx`（1863 行）是 god orchestrator：集中持有全量 state + 轮询 + URL 同步，并把同一份派生数组下发给 6 个面板。

**影响**：可测性 / 可维护性差；集中 state 的副作用会跨面板连锁。

> **实例**：本次会话开头排查的「打开 `?section=operations` 反复刷新 / 每秒全量重拉每个 workspace 的 quota」，根因正是 `page.tsx` 每次渲染新建 `departmentWorkspaces` 数组 → `ops-dashboard` 的加载 effect 每次渲染重跑。已修（`page.tsx` 用 `useMemo` 稳定引用、`ops-dashboard.tsx` 按 `wsKey` 触发），但它是这一类集中式 state 问题的代表。

**建议**：按 section 把 `page.tsx` 的 state 拆成 context / store；`api.ts` 按域拆分模块；大面板下沉子组件。

---

### 🟢 P2-5　启动期资产重复同步

**现象**：`syncAssetsToGlobal()` 在 web / api / runtime / bridge-worker **每个进程每次启动**都无条件 `cpSync` 一遍 `.agents/assets/**` 到 `~/.gemini`（调用点：`server.ts:255`、`server.ts:328`、`src/server/runtime/bridge-worker-process.ts:13`）。多进程并发抄到同一目标目录 → 重复 I/O + 潜在写竞态；dev 下每次 `tsx watch` 重启都抄。

**建议**：加 mtime / 版本判断，仅在源变更时同步；或只由单一进程负责。

---

### 🟢 P2-6　仓库卫生

**现象**：根目录把一批 scratch / 运行时文件提交进了 git。

**证据**（均为 git-tracked）：`add.py`、`calculate.py`、`sum.py`、`result.json`、`test-env.ts`、`test-xueqiu.ts`、`ts_errors.log`、`单 skill`，以及运行时产物目录 `artifactDir`、`demolong`。

**建议**：`git rm --cached` 移除并补 `.gitignore`；运行时产物目录不应入版本控制。

---

## ✅ 设计得当、不建议改动

- **调度器自适应 tick**（`src/lib/agents/scheduler.ts`）：空闲最多每 30s 醒一次、临近任务收敛到 1s，省且准。
- **run 分发分层**：`createRun`（`run-registry.ts:277`）是单一入口；`pipeline-generator` / `group-runtime` / `project-reconciler` 职责各异，是合理分层、**非冗余**（已核实）。
- **backends 插件注册机制**：`registerAgentBackend` + resolver 是干净的扩展点（问题只在保留了 deprecated 实现）。
- **SQLite 作为统一查询索引**：方向正确，需要做的是「收口」而非「推翻」。

---

## 附录 A　关键量化数据

**路由层**
| 项 | 数量 |
|---|---|
| Next 文件系统路由（`src/app/api/**/route.ts`） | 156 |
| 带 proxy 分支、依赖独立 server 接住的路由 | 80 |
| 手写正则路由（control-plane 50 + company-routes 51 + runtime 21） | 122 |

**SQLite 表行数抽样**（取证日 2026-05-30）
| 表 | 行数 | 备注 |
|---|---|---|
| `evolution_proposals` | 0 | 死 |
| `system_improvement_proposals` | 0 | 半挂 |
| `growth_observations` | 0 | 退休 |
| `growth_proposals` | 9 | 退休空跑 |
| `system_improvement_signals` | 39 | 活 |
| `conversation_owner_cache` | 8 | 半闲置 |
| `operating_signals` / `operating_agenda` | 668 / 676 | 活 |
| `budget_ledger` | 388 | 活 |
| `memory_candidates` | 401 | 活 |
| `knowledge_assets` | 3569 | 活 |

**前端体量 Top**
`settings-panel.tsx` 4284 / `projects-panel.tsx` 3889 / `ceo-office-cockpit.tsx` 2115 / `ops-dashboard.tsx` 1880 / `app/page.tsx` 1863 / `department-setup-dialog.tsx` 1736；`api.ts` 1546 行 / 170 方法。

---

## 附录 B　建议的清理顺序（roadmap）

1. **退休清理 PR**（P0-1）：删 evolution、growth 退休分支、死常量、deprecated backends。纯删除、低风险。
2. **仓库卫生 PR**（P2-6）：`git rm --cached` scratch / 运行时文件 + `.gitignore`。顺手做。
3. **持久化收口**（P1-3）：hidden-ws / owner 缓存归入 sqlite。
4. **本地单进程化**（P0-2）：本地默认 `role=all`，拆分降级为可选。改动面较大，单独评估。
5. **前端拆分**（P1-4）：从 `page.tsx` state 切分与 `api.ts` 分模块入手，渐进进行。

---

*本报告由一次自定节奏（`/loop`）的 4 轮走查汇总而成；所有行数 / 表行数 / 路由数均为取证日实测值，后续代码演进后需复核。*
