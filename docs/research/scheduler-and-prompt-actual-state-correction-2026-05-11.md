# 调度系统与 Prompt 拼装系统现状修正报告

> **日期**: 2026-05-11
> **性质**: 前序认知错误修正
> **触发**: 用户提供 UI 截图与运行实例 jobId，直接反驳前序"调度任务硬编码、运营不能不发版配置"的论断
> **关联文档**:
> - 前置考古: [`prompt-composition-systemic-analysis-2026-05-11.md`](./prompt-composition-systemic-analysis-2026-05-11.md)
> - 长期架构（含修正声明）: [`../design/prompt-composer-target-architecture-2026-05-11.md`](../design/prompt-composer-target-architecture-2026-05-11.md)
> - Native Codex 巡检任务记录: [`./native-codex-recurring-patrol-job-2026-04-18.md`](./native-codex-recurring-patrol-job-2026-04-18.md)

---

## 0. 修正声明

前序对话中关于"调度任务硬编码、运营不能不发版配置"的核心论断**错误**。本报告作为正式修正，并撤回前序据此推出的部分长期架构主张（详见第五节）。

修正后的核心论断：

> ✅ **调度系统已经是高度可配置的：6 个在册任务中 5 个可由运营/用户/CEO Agent 不发版修改，仅 1 个（Platform Engineering Story Top 3）是真正硬编码。**
>
> ⚠️ **前序把"prompt 装配存在双重注入"这件事错误外推到了"整个调度系统都是硬编码"，这是混淆。Prompt 装配问题与调度可配置性是两个独立维度。**

---

## 一、前序错误清单

### 错误 1: 把"工作流执行"标签误读为 `createdBy` 字段

**错论**：UI 上若干任务显示"工作流执行"，被前序当作 `createdBy = "workflow-execution"`，并据此推断"调度系统存在一种叫 workflow-execution 的来源类型"。

**现实事实**：
- `createdBy` 的全集只有 5 个枚举值：`'ceo-command' | 'ceo-workflow' | 'mcp' | 'web' | 'api'`，见 `src/lib/agents/scheduler-types.ts:15`。**没有 workflow-execution**。
- UI 上的"工作流执行"标签是 `executionProfile.kind === 'workflow-run'` 的中文化，派生函数在 `src/lib/execution/contracts.ts:29-32`（返回 `label: 'Workflow Run'`），UI 翻译在 `src/components/ops-dashboard.tsx:217-223`（`if (label === 'Workflow Run') return '工作流执行'`）。
- 也就是说，"工作流执行" 描述的是**任务的执行形态**（profile），**不是任务来源**。

**错误根因**：只看 UI 截图、未交叉验证字段语义，把展示层（label）当作了数据层（field）。

---

### 错误 2: 错说"调度任务都是硬编码不可配置"

**错论**：前序断言"调度任务都写死在 TS 代码里，运营要改 cron 必须发版"。

**现实事实**：
- 整个 UI 调度面板 `src/components/scheduler-panel.tsx`（约 1000+ 行）+ `src/components/ops-dashboard.tsx` 已经提供**完整 GUI CRUD**：
  - 新建 / 编辑 / 启停 / 立即执行 / 删除：见 `scheduler-panel.tsx:204` (`api.schedulerJobs()`)、`:256` (`api.updateSchedulerJob`)、`:266` (`api.triggerSchedulerJob`)、`:278` (`api.deleteSchedulerJob`)、`:424` (`api.updateSchedulerJob(editingJobId, payload)`)、`:426` (`api.createSchedulerJob`).
- 编辑对话框支持改动几乎所有字段：cron / type / timeZone / intervalMs / actionKind / actionWorkspace / actionPrompt / actionPromptAssetRefs / actionSkillHints / executionProfile / enabled / departmentWorkspaceUri。
- 后端 REST 端点位于 `src/app/api/scheduler/jobs/route.ts`（GET/POST）与 `src/app/api/scheduler/jobs/[id]/route.ts`（PATCH/DELETE）与 `src/app/api/scheduler/jobs/[id]/trigger/route.ts`（POST trigger）。
- 创建/编辑后通过持久化进 SQLite 表 `scheduled_jobs`，**不需要发版**。

**错误根因**：前序只读了后端 `src/lib/agents/scheduler.ts` 的 builtIn 部分（看到 `ensureBuiltInCompanyLoopJobs` / `ensureBuiltInPlatformEngineeringStoryCandidateJob` 两个 ensure 函数），就把它当作"全系统"，忽略了运行时创建的 user-defined jobs。

---

### 错误 3: 错说"`.agents/scheduled-jobs.yaml` 是未来的配置层方向"

**错论**：前序在长期架构（`prompt-composer-target-architecture-2026-05-11.md` §8 ConfigurationLayer / M7）中提议引入 `.agents/scheduled-jobs.yaml` 把所有 cron 任务声明式化。

**现实事实**：
- **GUI 已经是更好的配置层**——它带表单校验（`validateCron` 见 `src/lib/cron-utils.ts`）、实时反馈、操作审计、立即执行按钮、运行历史关联（`api.agentRunsByFilter({ schedulerJobId })` 见 `scheduler-panel.tsx:232`）。
- 把 GUI 已经支持的能力降级成"改 YAML + 热重载"，是**功能退化**而非升级：
  - 失去字段级 schema 校验（YAML 只有事后 validate）
  - 失去操作审计（谁改的、什么时候改的——YAML 只有 git blame）
  - 失去"立即执行"的快速验证闭环
  - 失去与 SQLite 的事务一致性

**错误根因**：架构师视角下意识把"声明式 YAML"当作可配置性的银弹，未先调研已有 GUI 的能力边界。

---

### 错误 4: 错说"AI 情报任务不知道哪里来"

**错论**：前序看到 UI 上有"AI情报工作室日报"和"Native Codex 周期巡检"两个任务，找不到对应代码，就断言"这些任务来源不明，疑似某处硬编码注册"。

**现实事实**：
- "AI情报工作室日报" jobId = `2a1a9a76-e63d-42c6-a4f5-99fb8b89c86f`，cron `0 20 * * *` + `Asia/Shanghai`。明确记录在 `docs/PROJECT_PROGRESS.md:2757` 与 `:3649`，是**运行时由用户/CEO Agent 创建并持久化到 SQLite 的**。
- "AI情报工作室 Native Codex 周期巡检" jobId = `6f1399e3-cb1a-4522-b9af-7d90194572ba`，每 60s 一次。研究报告 `docs/research/native-codex-recurring-patrol-job-2026-04-18.md` 明确记载该任务于 2026-04-18 由用户通过 REST `POST /api/scheduler/jobs` 显式创建。
- "市场部 Prompt 任务"由 CEO Agent 通过对话调 MCP tool `antigravity_create_scheduler_job` 创建，playbook 在 `src/lib/agents/ceo-environment.ts:98-105`（提示 CEO 当用户说"每天/每周/定时"时优先调 MCP / REST），创建参数模板示例在 `:311-332`（"模板 A：定时创建 Ad-hoc Project"，第一个示例就叫"市场部日报任务 · 工作日 09:00"）。

**错误根因**：未交叉查阅 `docs/research/` 与 `docs/PROJECT_PROGRESS.md` 的运行历史记录；未阅读 CEO Agent 的 system prompt（`ceo-environment.ts`）即可看到 MCP 创建路径。

---

## 二、调度系统真实状态

### 2.1 完整 GUI 自服务能力清单

| UI 操作 | 调用的 API 方法 | 后端路由 | 后端函数 |
|---|---|---|---|
| 列出任务 | `api.schedulerJobs()` | `GET /api/scheduler/jobs` | `src/app/api/scheduler/jobs/route.ts` |
| 新建任务 | `api.createSchedulerJob(payload)` | `POST /api/scheduler/jobs` | 同上 |
| 编辑任务 | `api.updateSchedulerJob(id, payload)` | `PATCH /api/scheduler/jobs/[id]` | `src/app/api/scheduler/jobs/[id]/route.ts` |
| 启停任务 | `api.updateSchedulerJob(id, { enabled })` | 同上 | 同上 |
| 立即执行 | `api.triggerSchedulerJob(id)` | `POST /api/scheduler/jobs/[id]/trigger` | `src/app/api/scheduler/jobs/[id]/trigger/route.ts` |
| 删除任务 | `api.deleteSchedulerJob(id)` | `DELETE /api/scheduler/jobs/[id]` | `src/app/api/scheduler/jobs/[id]/route.ts` |
| 关联运行记录 | `api.agentRunsByFilter({ schedulerJobId })` | `GET /api/agent-runs?schedulerJobId=...` | — |
| 触发 Company Loop | `api.runCompanyLoopNow({ kind })` | — | `scheduler-panel.tsx:494` |

### 2.2 6 个调度任务的真实分类

| # | 任务名 | 来源 | createdBy | UI 标签 | cron 可改性 |
|---|---|---|---|---|---|
| 1 | 市场部 Prompt 任务 · 每周（`0 15 * * 1,5`） | 运行时（CEO Agent 调 MCP / REST） | `mcp` 或 `ceo-workflow` | "工作流执行" | ✅ GUI / API / MCP 全可改 |
| 2 | AI情报工作室 Native Codex 周期巡检（每 60s interval） | 运行时（用户直接 REST） | `api` | "工作流执行" | ✅ GUI 可改 |
| 3 | AI情报工作室日报 · 每天 20:00（`0 20 * * *`） | 运行时（用户/CEO 创建） | `api` 或 `ceo-workflow` | "工作流执行" | ✅ GUI 可改 |
| 4 | Company Daily Loop · 20:05 | builtIn 硬编码 | `api` | "API" | 通过 policy API 可改（`dailyReviewHour` 等字段） |
| 5 | Company Weekly Review · 周五 20:30 | builtIn 硬编码 | `api` | "API" | 通过 policy API 可改（`weeklyReviewDay/Hour`） |
| 6 | Platform Engineering Story Top 3 · 09:00 | builtIn 硬编码 | `api` | "工作流执行" | ❌ cron 字面量硬编码，GUI 改了被 ensure 函数重置 |

证据：
- jobId `builtin-company-daily-loop`、`builtin-company-weekly-review`、`builtin-platform-engineering-story-top-candidates` 三个 builtIn 常量定义在 `src/lib/agents/scheduler.ts:156-158`。
- ensure 函数仅作用于这 3 个 jobId：`ensureBuiltInCompanyLoopJobs` (`scheduler.ts:256-279`)、`ensureBuiltInPlatformEngineeringStoryCandidateJob` (`scheduler.ts:281-303`)。
- Company Loop 的 cron 来源于 `policy.dailyReviewHour` / `policy.weeklyReviewDay` / `policy.weeklyReviewHour`（见 `scheduler.ts:188-220`），改 policy 就能改 cron。
- Platform Engineering Story Top 3 的 cron 是字面量 `'0 9 * * *'` 写死（`scheduler.ts:229`），且 ensure 函数会用 `buildBuiltInPlatformEngineeringStoryCandidateJob(now)` 在每次启动时覆盖现有值（`scheduler.ts:283-302`，注意 line 286 第二次展开会用新值覆盖任何用户编辑），这是 **6 个里唯一真正"GUI 改了被覆盖"的任务**。

### 2.3 `createdBy` / `executionProfile.kind` 字段语义澄清

| 维度 | 字段 | 取值 | UI 标签来源 |
|---|---|---|---|
| **任务来源** | `createdBy` | `api / mcp / web / ceo-command / ceo-workflow` | UI 显示一般为 "API/MCP/Web/CEO 指令/CEO 工作流" |
| **任务执行形态** | `executionProfile.kind` | `workflow-run / review-flow / dag-orchestration / template` | "工作流执行/评审流程/流程编排/..." |

UI 上同一个任务卡片可能**同时**显示两个标签：左边是来源（"API"），右边是执行形态（"工作流执行"）。前序混淆了这两个维度。

### 2.4 ensure 函数的真实保护范围

只有 3 个 jobId 受 ensure 函数保护（启动期、policy 变更时被强制重置）：

| jobId 常量 | scheduler.ts 行号 | ensure 函数行号 |
|---|---|---|
| `BUILT_IN_COMPANY_DAILY_LOOP_ID` = `'builtin-company-daily-loop'` | 156 | 256-279（受 policy 控制，可改） |
| `BUILT_IN_COMPANY_WEEKLY_REVIEW_ID` = `'builtin-company-weekly-review'` | 157 | 256-279（受 policy 控制，可改） |
| `BUILT_IN_PLATFORM_ENGINEERING_STORY_TOP_JOB_ID` = `'builtin-platform-engineering-story-top-candidates'` | 158 | 281-303（cron 字面量硬编码，**唯一真正不可改**） |

启动期触发位置：`scheduler.ts:948-949`、`:977-978`、`:995-996`。

**所有其它 jobId（用户/CEO/MCP 创建的）都不受 ensure 影响——GUI 修改即永久生效。**

---

## 三、用户自创任务的真实路径

### 3.1 三个等价入口

```
HTTP REST (curl / 任意客户端)
   POST /api/scheduler/jobs            → 创建
   PATCH /api/scheduler/jobs/[id]      → 编辑
   POST /api/scheduler/jobs/[id]/trigger → 立即执行
   DELETE /api/scheduler/jobs/[id]     → 删除

MCP Tool (CEO Agent / Claude Code / 其它 MCP client)
   antigravity_create_scheduler_job
   antigravity_update_scheduler_job
   antigravity_trigger_scheduler_job

GUI (浏览器)
   /ops Dashboard → SchedulerPanel
   走的还是上面的 REST，但表单封装更友好
```

三条路径**完全等价**，都最终写入 SQLite `scheduled_jobs` 表。

### 3.2 持久化

- 存储后端：SQLite，表名 `scheduled_jobs`
- 数据形态：`ScheduledJob` interface（`src/lib/agents/scheduler-types.ts:1-27`）序列化后的 row
- 启动期加载：`scheduler.ts` 初始化时把表里所有行读进内存 `state.jobs: Map<string, ScheduledJob>`

### 3.3 CEO Agent 通过对话创建（实证）

`src/lib/agents/ceo-environment.ts:98-105` 是 CEO Agent 的 system prompt 片段：

> ### C. 定时任务 / Cron / 自动执行
> 如果用户提到"每天""每周""明天""定时""cron""自动执行"：
> - **优先阅读并遵循** @../workflows/ceo-scheduler-playbook.md
> - 有 MCP 时，优先调用 `antigravity_create_scheduler_job` / `antigravity_update_scheduler_job` / `antigravity_trigger_scheduler_job`
> - 没有 MCP 时，使用 `curl` 调用 `/api/scheduler/jobs`、`/api/scheduler/jobs/:id`、`/api/scheduler/jobs/:id/trigger`
> - 默认把用户意图翻译成业务模板动作，而不是要求用户手填原始 cron 表达式
> - 只有在部门、项目、模板存在歧义时，才向用户做最小澄清
> - 成功创建后必须回报 `jobId` 和下一次执行时间

`ceo-environment.ts:311-332` 给出了具体的 MCP 创建参数模板，第一个示例就叫"市场部日报任务 · 工作日 09:00"。

### 3.4 两个已知运行实例

| jobId | 任务名 | 来源记录 |
|---|---|---|
| `2a1a9a76-e63d-42c6-a4f5-99fb8b89c86f` | AI情报工作室日报 (cron `0 20 * * *`, TZ `Asia/Shanghai`) | `docs/PROJECT_PROGRESS.md:2757`、`:3649` |
| `6f1399e3-cb1a-4522-b9af-7d90194572ba` | AI情报工作室 Native Codex 周期巡检 (每 60s) | `docs/research/native-codex-recurring-patrol-job-2026-04-18.md` 全文 |

---

## 四、Prompt 拼装系统的问题（澄清这是独立维度）

### 4.1 前序"双重注入 / Ledger 缺失"诊断仍然成立

考古报告 `prompt-composition-systemic-analysis-2026-05-11.md` 的核心发现**不被本次修正影响**：

- ✅ 5 个 builder × 8 个入口 × 4 套加载器的笛卡尔积——依然成立
- ✅ workflow MD 在某些 prompt mode 下被注入两次——依然成立
- ✅ 缺少 PromptLedger / contentHash / canonicalRef 双键去重——依然成立
- ✅ `applyProviderExecutionContext` 是 prepend 而非 funnel——依然成立

### 4.2 与调度系统是两个独立问题

| 维度 | 问题 | 现状 | 修复路径 |
|---|---|---|---|
| **调度可配置性** | 任务能否不发版改 | ✅ 6 个里 5 个可改，已有 GUI/API/MCP | 不需要重做 |
| **Prompt 装配确定性** | 同一份 workflow 是否被注入两次 | ❌ 双重注入 / 无 ledger | 需要做 PromptComposer + Ledger（M1-M5） |

前序错误地把第二个问题的表象（"prompt 里有重复内容"）外推到了第一个维度的结论（"系统都是硬编码"），**这是混淆**。一个任务的 cron 可以被运营在 GUI 上改完，但它一旦触发，prompt 装配链路里的双重注入问题依然存在——这两件事互相独立。

### 4.3 修正前的混淆错误

前序原话（综合多次发言意译）：

> "AI 情报任务的 prompt 装配是黑盒——workflow 被注入两次、找不到 cron 配置在哪改、所有东西都是 TS 写死……所以整个调度+prompt 系统都需要重做。"

这句话把三件事混为一谈：
1. workflow 被注入两次 → ✅ 真实问题（属于 prompt 装配维度）
2. 找不到 cron 配置在哪改 → ❌ 错论（GUI 就能改，作者没找）
3. 所有东西都是 TS 写死 → ❌ 错论（6 个里只有 1 个真硬编码）

正确表述应该是：

> "AI 情报任务的 cron 是用户在运行时通过 GUI/MCP 创建的，运营完全可以不发版修改；但它一旦被触发，prompt 装配链路里存在 workflow 双重注入等问题——这是另一个独立维度的问题，需要 PromptComposer + Ledger 解决。"

---

## 五、对长期架构 P2 终态的修正

### 5.1 ⚠️ §8 ConfigurationLayer（YAML manifest 化）应被废弃或重新定位

原 §8 提议引入：
- `.agents/scheduled-jobs.yaml`
- `.department/prompt-composition.yaml`
- `.agents/provider-policy.yaml`

修正：
- `.agents/scheduled-jobs.yaml` —— **完全撤回**。GUI 已经是更好的配置层。
- `.department/prompt-composition.yaml` —— **保留**，但其内容应限于 provider 开关、budget、priority override 等"装配策略"，不要把调度任务也塞进来。
- `.agents/provider-policy.yaml` —— **保留**，同上理由。

### 5.2 ⚠️ §11 M7 milestone 应重新定位

原 M7 名为"ConfigurationLayer（把 cron 任务 manifest 化）"。修正后：

- **删除"内置 cron 任务 manifest 化"作为核心目标**。
- 真正需要"manifest 化或运营接管"的 builtIn 任务只有 1 个：`Platform Engineering Story Top 3`。建议改造方向：
  - **方案 A（推荐）**：把它降级为 "onboarding seed" —— 安装期 seed 一次进 SQLite，之后让运营在 GUI 上自主接管。删除 `ensureBuiltInPlatformEngineeringStoryCandidateJob` 这个 ensure 函数（`scheduler.ts:281-303`、`:949`、`:978`、`:996`），不再覆盖用户编辑。
  - **方案 B（备选）**：把它转成 Company Loop 同款的 "policy-controlled cron"——增加一份 `platform_engineering_top_story_policy`，让 cron 通过 policy 字段可改。
- M7 范围应缩窄到"装配策略 YAML 化"（provider 开关 / budget / priority），而非"调度任务 YAML 化"。

### 5.3 ✅ M1-M5 依然必要

PromptComposer Service + PromptLedger + AssetRegistry + ContextProvider 注册表——**全部保留**。这是 prompt 装配双重注入问题的解药，与调度可配置性无关。

| Milestone | 状态 | 原因 |
|---|---|---|
| M1 AssetRegistry + PromptSection model | ✅ 保留 | 解决资产加载链路四套并行问题 |
| M2 PromptLedger | ✅ 保留 | 解决双键去重缺失问题 |
| M3 ContextProvider 接口 + 5 个核心 provider | ✅ 保留 | 解决"加一个上下文要改 8 处"问题 |
| M4 PromptComposer service + feature flag | ✅ 保留 | 单一入口收敛 |
| M5 PromptExecutor 路径切换 | ✅ 保留 | 让 dispatch-prompt 走 composer |
| M6 group-runtime 5 个入口切换 | ✅ 保留 | 收敛 template 路径 |
| **M7 ConfigurationLayer（原版）** | ⚠️ **缩窄** | 删掉调度 YAML 部分，只保留装配策略 YAML |
| M8 跨子系统统一 + 删除旧入口 | ✅ 保留 | 仍是终态 |

### 5.4 长期架构核心简化

去掉调度 manifest 化的歧路后，PromptComposer 终态核心简化为一句话：

> **一个 PromptComposer service + 一套 ContextProvider 插件 + 一个 AssetRegistry + 一份 PromptLedger 双键去重协议。**

ConfigurationLayer 的角色由"YAML 文件配置"重新定位为：

- **调度任务**：GUI 已存在，仅 `Platform Engineering Story Top 3` 这种特例需要 seed 化处理。
- **装配策略**（provider 开关 / budget / priority）：YAML 仍可考虑，但作用域仅限装配策略，不碰调度。

---

## 六、给用户的诚实回应

### 6.1 我错在哪、为什么错

**错在三个层面：**

1. **只看代码不看产品**——只读了 `src/lib/agents/scheduler.ts` 的 builtIn 部分，没打开过 UI；没读 `scheduler-panel.tsx`，没意识到 GUI 已经是完整 CRUD。
2. **没交叉验证**——没读 `docs/PROJECT_PROGRESS.md` 和 `docs/research/` 的运行历史记录，否则就能直接看到 jobId `2a1a9a76-…` 和 `6f1399e3-…` 是用户运行时创建的。
3. **错误归因**——把"prompt 装配问题"的负面体验外推到了整个系统的可配置性，没把这两个独立维度拆开。

### 6.2 哪些前序结论仍然成立、哪些必须撤回

**仍然成立**：
- ✅ Prompt 装配存在 5 builder × 8 入口的笛卡尔积
- ✅ workflow MD 在某些 prompt mode 下被注入两次
- ✅ 缺少 PromptLedger / contentHash / canonicalRef 双键去重
- ✅ 需要 PromptComposer Service 收敛
- ✅ M1-M5 milestone 全保留

**必须撤回**：
- ❌ "调度任务都硬编码"——错论，6 个里 5 个可改
- ❌ "AI 情报任务来源不明"——错论，有清晰的 jobId 与创建路径
- ❌ "需要 `.agents/scheduled-jobs.yaml`"——撤回，GUI 已是更好配置层
- ❌ M7 "把内置 cron 任务 manifest 化" 作为核心目标——撤回，仅 1 个特例需要处理

### 6.3 接下来该怎么做

1. **调度系统不需要重做**。已有 GUI/MCP/REST 三条等价创建路径已经覆盖了 80% 以上的运营场景。
2. **`Platform Engineering Story Top 3` 单独处理**——按 5.2 方案 A 降级为 onboarding seed，删 ensure 函数。这个改动小到几个小时。
3. **PromptComposer 仍然要做**——M1-M5 按原计划推进。这是真正能消除"workflow 被注入两次""prompt 黑盒难复盘"的工作。
4. **架构文档需要追加修正声明**（见姊妹交付物：`docs/design/prompt-composer-target-architecture-2026-05-11.md` 附录 X）。

---

## 附录 A：UI 标签到代码字段完整映射表

| UI 标签 | 派生源字段 | 派生函数 / 转换逻辑 | file:line |
|---|---|---|---|
| "工作流执行" | `executionProfile.kind === 'workflow-run'` | `summarizeExecutionProfile` → `label: 'Workflow Run'` → `formatExecutionProfileLabel('Workflow Run')` | `src/lib/execution/contracts.ts:29-32`、`src/components/ops-dashboard.tsx:219` |
| "评审流程" | `executionProfile.kind === 'review-flow'` | 同上链路 → `label: 'Review Flow'` | `contracts.ts` + `ops-dashboard.tsx:220` |
| "流程编排" | `executionProfile.kind === 'dag-orchestration'` | 同上链路 → `label: 'DAG Orchestration'` | `ops-dashboard.tsx:221` |
| "API"（来源） | `createdBy === 'api'` | 直接展示 | `scheduler-types.ts:15` |
| "MCP"（来源） | `createdBy === 'mcp'` | 直接展示 | 同上 |
| "Web"（来源） | `createdBy === 'web'` | 直接展示 | 同上 |
| "CEO 指令" | `createdBy === 'ceo-command'` | 直接展示 | 同上 |
| "CEO 工作流" | `createdBy === 'ceo-workflow'` | 直接展示 | 同上 |
| "运行中" | run.status | `formatRunLifecycleStatus` | `ops-dashboard.tsx:210-214` |
| "调度循环运行中" | scheduler runtime msg | `formatSchedulerRuntimeMessage('Scheduler loop is running.')` | `ops-dashboard.tsx:225-230` |
| "每日巡检/每周复盘/..." | `CompanyLoopRun.kind` | `formatLoopKind` | `ops-dashboard.tsx:233-246` |

---

## 附录 B：所有 `createdBy` 取值及 UI 翻译

定义：`src/lib/agents/scheduler-types.ts:15`

```ts
createdBy?: 'ceo-command' | 'ceo-workflow' | 'mcp' | 'web' | 'api';
```

| 枚举值 | 含义 | 典型 UI 翻译 | 典型创建场景 |
|---|---|---|---|
| `api` | 通过 REST `/api/scheduler/jobs` 创建 | "API" | 用户 curl 创建、builtIn 任务自标记 |
| `mcp` | 通过 MCP tool `antigravity_create_scheduler_job` 创建 | "MCP" | Claude Code / 其他 MCP client |
| `web` | 通过 GUI 表单创建（SchedulerPanel） | "Web" | 运营在浏览器里创建 |
| `ceo-command` | CEO Agent 单条指令执行式创建 | "CEO 指令" | "帮我现在跑一下 X" 类一次性请求 |
| `ceo-workflow` | CEO Agent 在工作流模板里创建 | "CEO 工作流" | playbook driven，例如"市场部日报任务" |

**注意**：枚举值集合内**没有** `workflow-execution` / `workflow-run`。这些字符串在 UI 上出现时，对应的是 `executionProfile.kind`，**不是** `createdBy`。

---

## 附录 C：本报告所有 file:line 引用核对清单

| 引用 | 验证状态 |
|---|---|
| `src/lib/agents/scheduler-types.ts:15` (createdBy enum) | ✅ 已读 |
| `src/lib/execution/contracts.ts:29-32` (label: 'Workflow Run') | ✅ 已读 |
| `src/lib/execution/contracts.ts:139-163` (deriveExecutionProfileFromScheduledAction) | ✅ 已读 |
| `src/components/ops-dashboard.tsx:217-223` (formatExecutionProfileLabel) | ✅ 已读 |
| `src/components/scheduler-panel.tsx:204` (api.schedulerJobs) | ✅ 已读 |
| `src/components/scheduler-panel.tsx:256` (updateSchedulerJob enabled) | ✅ 已读 |
| `src/components/scheduler-panel.tsx:266` (triggerSchedulerJob) | ✅ 已读 |
| `src/components/scheduler-panel.tsx:278` (deleteSchedulerJob) | ✅ 已读 |
| `src/components/scheduler-panel.tsx:424-426` (update/create) | ✅ 已读 |
| `src/lib/agents/scheduler.ts:156-158` (3 个 builtIn jobId 常量) | ✅ 已读 |
| `src/lib/agents/scheduler.ts:188-220` (buildBuiltInCompanyLoopJobs) | ✅ 已读 |
| `src/lib/agents/scheduler.ts:223-243` (buildBuiltInPlatformEngineeringStoryCandidateJob) | ✅ 已读 |
| `src/lib/agents/scheduler.ts:256-303` (ensure 函数们) | ✅ 已读 |
| `src/lib/agents/scheduler.ts:948-996` (ensure 触发点) | ✅ 已读 |
| `src/lib/agents/ceo-environment.ts:98-105` (CEO scheduler playbook) | ✅ 已读 |
| `src/lib/agents/ceo-environment.ts:311-332` (MCP 创建参数模板) | ✅ 已读 |
| `docs/PROJECT_PROGRESS.md:2757`、`:3649` (jobId `2a1a9a76-…`) | ✅ 已读 |
| `docs/research/native-codex-recurring-patrol-job-2026-04-18.md` | ✅ 已 grep 确认 |

---

## 结语

我错把"局部痛点（prompt 装配双重注入）"外推成了"全系统结论（调度都硬编码）"。一句话总结教训：

> **读代码之外还要看产品；看到 UI 标签之前不要假定它的 backing field。**

本次修正不影响 PromptComposer 长期架构的核心（M1-M5 完整保留），但删除了 M7 中"调度任务 YAML 化"的歧路。调度系统已经是高度可配置的——它不需要被重做。

— 架构组，2026-05-11
