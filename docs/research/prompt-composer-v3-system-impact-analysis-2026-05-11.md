# PromptComposer v3 改造的系统影响面分析

> **日期**: 2026-05-11
> **作者**: 影响面分析师 (Claude / system-impact-audit)
> **关联**:
> - 改造蓝图: `docs/design/prompt-composer-target-architecture-v3-2026-05-11.md`（v3 最终版）
> - 考古结论: `docs/research/prompt-composition-systemic-analysis-2026-05-11.md`
> - 现状修正: `docs/research/scheduler-and-prompt-actual-state-correction-2026-05-11.md`
> - 项目坑点: `PITFALLS.md`

本报告独立于 v3 文档存在。它不解释**改什么**，它解释**改了之后哪些上下游会被波及，哪些是被 v3 漏掉的不预期影响**。所有结论以 `file:line` 为锚，避免凭印象判断。

---

## 0. 评估方法论

### 0.1 影响分级

| 等级 | 定义 |
|---|---|
| 直接 | 被改动文件本身或其导出符号被 v3 列入修改清单 |
| 间接 | 通过被改动符号的调用链感知到行为变化（字符串内容、读盘次数、副作用次数等） |
| 旁路 | 通过共享的资产/数据/事件总线感知到变化，但不在 v3 直接修改路径上 |
| 不预期 | v3 文档未提及，但实地代码确认会被影响 |
| 不影响 | 实地代码确认与改动隔离 |
| 待调查 | 当前样本无法判断，需要更深入跟踪 |

### 0.2 严重度

| 等级 | 定义 |
|---|---|
| Blocking | 上线后导致 prompt 错乱、副作用丢失/重复、数据破坏；必须在 M0 前/对应 M 阶段堵住 |
| High | 上线后 UI 显示异常、回归面广，但功能不会"无声崩坏" |
| Medium | 行为漂移可观察、修补成本可控 |
| Low | 表达层差异、token 计数差异、文案差异 |
| Informational | 仅需在 changelog / playbook 中告知 |

### 0.3 时间维度

| 节点 | 含义 |
|---|---|
| M0 | snapshot 锁定 + skip flag 灰度（仅 PromptExecutor 单 workflow 路径）|
| M1-M2 | 类型骨架 + AssetRegistry（仍然只增不改语义） |
| M3-M4 | Provider 注册 + PromptComposer + Ledger（行为开始切换） |
| M5-M6 | PromptExecutor / group-runtime 端到端入口切换 |
| 长期 | observability、消费层显式覆盖、跨子系统统一 |

---

## 1. 改造点 × 受影响系统对照矩阵

横轴为 v3 §2 的 13 个改造点，纵轴为本报告关注的"系统其他机制"。单元格标记：**D** 直接 / **I** 间接 / **B** 旁路 / **N** 不影响 / **?** 待调查；后缀严重度（H/M/L/B = Blocking）。

| 系统 \ 改造点 | M0-a snap | M0-b skip | M1 types | M2 AssetReg | M3-a 通用 | M3-b stage | M4 composer | M4 cache | M5 PE | M6-a GR | M6-b 三特例 | Obs+黑名单 | 消费层覆盖 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PromptExecutor 完整路径 | I/L | D/M | N | I/M | D/M | D/M | D/M | D/M | D/H | N | N | I/L | D/M |
| group-runtime（含 review-loop / delivery / retry / role-switch） | I/L | N | N | I/M | D/M | D/M | D/M | D/M | N | D/H | D/H | I/L | D/M |
| dispatch-service / executeDispatch | N | N | N | I/L | I/L | I/L | I/M | N | N | D/M | N | N | I/L |
| scheduler.ts（3 个 dispatch action）| N | N | N | N | N | N | N | N | I/L | I/L | N | N | N |
| company-loop-executor（daily/weekly review）| N | N | N | N | N | N | N | N | I/L | I/L | N | N | N |
| `/api/workflows/[name]` GET/PUT | N | N | N | **D/H** | N | N | N | N | N | N | N | N | I/M |
| `/api/skills/[name]` | N | N | N | I/M | N | N | N | N | N | N | N | N | I/L |
| department-sync（IDE mirror）| N | N | N | I/M | N | N | N | N | N | N | N | N | I/L |
| canonical-assets 缓存与热重载 | N | N | N | **D/H** | I/M | I/M | I/M | I/L | N | N | N | N | I/M |
| growth assets / self-evolution 发布 | N | N | N | I/M | D/M | I/L | I/M | N | I/M | N | N | N | I/L |
| run-artifacts 扫描器 | N | N | N | N | N | N | N | N | I/L | I/L | I/L | **D/B** | N |
| syncRunArtifactsToDeliverables（SQLite）| N | N | N | N | N | N | N | N | B/M | B/M | B/M | **D/B** | N |
| 三套 UI 面板（agent-run-detail / runs-panel / stage-detail）| N | N | N | N | N | N | N | N | B/M | B/M | B/M | **D/B** | N |
| Knowledge retrieval + usageCount 统计 | N | N | N | N | **D/H** | N | I/M | **D/H** | D/M | I/M | I/M | N | N |
| Backend memory hook（applyBeforeRunMemoryHooks）| N | N | N | N | N | N | N | N | I/M | I/M | I/M | N | N |
| daily-digest / daily-events / story-top runtime hooks | N | N | N | I/M | **D/H** | N | I/M | **D/H** | D/H | D/H | D/H | N | I/M |
| story-top-candidates ingest（company-kernel DB）| N | N | N | N | I/M | N | I/M | I/M | I/M | I/M | I/M | N | N |
| Antigravity gRPC（StartCascade / sendMessage）| N | N | N | N | N | N | I/L | N | I/L | I/L | I/L | N | N |
| WebSocket 实时推送 | N | N | N | N | N | N | N | N | N | N | N | N | N |
| `/api/agent-runs/*` | N | N | N | N | N | N | N | N | I/L | I/L | I/L | I/L | N |
| `/api/scheduler/jobs*` | N | N | N | N | N | N | N | N | N | N | N | N | N |
| MCP server tools (`antigravity_create_scheduler_job`) | N | N | N | N | N | N | N | N | N | N | N | N | N |
| CEO Office 立项池 / operating agenda | N | N | N | N | N | N | N | N | I/L | I/L | I/L | I/M | N |
| company-kernel 自动决策链路 | N | N | N | N | N | N | N | N | I/L | I/L | I/L | I/M | N |
| CEO Agent 对话调用（ceo-agent.ts）| N | N | N | N | N | N | N | N | I/L | N | N | N | N |
| evaluatePromptRun / supervisor | N | N | N | N | N | N | N | N | I/M | N | N | N | N |
| run-history / 事件流 | N | N | N | N | I/L | I/L | I/L | N | I/L | I/L | I/L | **D/M** | N |
| 现有测试套件 / fixtures | **D/B** | **D/B** | I/L | **D/H** | **D/H** | **D/H** | **D/H** | I/M | **D/H** | **D/H** | **D/H** | I/M | I/M |
| feature flag 基础设施 | I/M | **D/M** | N | I/L | **D/M** | N | **D/M** | **D/M** | **D/M** | **D/M** | N | N | N |
| SQLite schema（deliverables / runs / knowledge）| N | N | N | N | N | N | N | N | B/L | B/L | B/L | B/L | N |
| 启动顺序（initializeGatewayHome / initializeScheduler）| N | N | N | I/L | I/L | I/L | I/L | I/L | I/L | I/L | I/L | N | N |
| Antigravity desktop app 兼容 | N | N | N | N | N | N | N | N | I/L | I/L | I/L | N | N |

矩阵的关键观察：

1. **M2 AssetRegistry 是最广面的扰动源**——它接触的 `getCanonicalWorkflow` 同时被 `/api/workflows/[name]` GET / department-sync / department-execution-resolver / evolution publisher / approval handler 引用，任何一处的 raw/body 解释错都是 High 级回归（详见 §2.2）。
2. **M3-a `KnowledgeRetrievalProvider` + M4 runtime-cache 是最隐蔽的语义变更点**——它会改变 `recordKnowledgeAssetAccess` 的调用频次，进而改变知识资产的 `usageCount`、`lastAccessedAt`，以及 `/api/knowledge` 路由按 `usageCount` 排序的 UI 显示（详见 §2.4）。
3. **Observability 改造点是 v3 最先识别但风险最大的**——若 `prompt.composed.{json,md}` 写到 `artifactAbsDir` 根目录而黑名单未生效，会**直接污染** `run-artifacts.ts` 扫描结果 → `outputArtifacts` → `syncRunArtifactsToDeliverables` → `deliverables` SQLite 表 → 三套 UI 面板（详见 §2.3 + §3 不预期影响 #1）。
4. **测试套件几乎在每个改造点都是 High 影响**——12 个 `*.test.ts` 文件 mock 了被改的导出符号，任何接口变化都直接致 fail。

---

## 2. 按系统类别的影响分析

### 2.1 核心运行时

#### PromptExecutor 完整路径

- 入口：`prompt-executor.ts:511 composedPrompt = applyProviderExecutionContext(...)`、`:476 prepareWorkflowRuntimeContext`、`:491 retrieveKnowledgeAssets`、`:484/:503 appendRunHistoryEntry`、`:523 applyBeforeRunMemoryHooks`。
- M0-b skip flag 直接改变 `:181` 与 `:511` 拼装的 prompt 字符串；M5 把整段 `[buildPromptExecutionPrompt, preparedWorkflowContext.promptAppendix, retrievedKnowledgeSection].join('\n\n')` 替换为 `composer.compose({mode:'prompt',...}).text`。
- **不预期影响 1**：M5 一旦切换，`prepareWorkflowRuntimeContext` 的调用时序会从"prompt 拼装阶段同步执行"变为"composer.compose 内 provider lifecycle 异步执行"。`workflow.preflight.completed` 事件目前在 `:484` 位置写入（preflight 后、prompt 发送前），切换后若 provider 顺序未保留，事件相对其他 run-history 项的顺序会变。这会影响 `run-history` 事件流回放顺序，进而影响 `run-conversation-transcript.ts` 的展示。**v3 未提及**。
- **不预期影响 2**：`prompt-executor.ts:666 applyBeforeRunMemoryHooks(evalProvider, ...)`（evaluatePromptRun 路径）依赖与主 run 相同的 `executionContext`。M5 改造若只覆盖 `executePrompt` 主路径而漏处理 `evaluatePromptRun`，会出现"主 run prompt 经过 composer，eval run prompt 还是旧拼装"的内部不一致。v3 §3.1 列了 `:511` 但未列 `:666`。

#### group-runtime 完整路径

- 五处入口：legacy-single (`:1174`)、restart-role (`:1663`)、delivery-single-pass (`:2108`)、review-loop (`:2275`)、role-switch (`:2306-2331`)。
- review-loop 是 M6 风险最高的子路径——每 round × 每 role 调一次 `applyProviderExecutionContext`；M4 配套 per-run runtime-cache 必须正确实现幂等，否则 review-loop 6 role × 3 round 会触发 18 次 `recordKnowledgeAssetAccess`（详见 §2.4）。
- role-switch（`:2306`）是 v3 明确点名的"未经过 applyProviderExecutionContext"特例——它直接调 `buildRoleSwitchPrompt` → `session.send(switchPrompt)`，连 preamble 都没拼。M6-b 改造时必须先决定"shared cascade 内 role 切换是否也要 capability-pack"——若加上会改变 shared cascade 的 token 行为（cascade 内 prompt 累计长度估算 `sharedState.estimatedTokens` 在 `:2313` 用了 `switchPrompt.length / 4 + 2000`，prompt 变长会让 token cap 提前触发 fork）。**v3 提到但未量化**。
- legacy-single (`:1174`) 在矩阵分级 D/M，但实测项目里 legacy-single 现已少用（仅 V1 单 role 路径）。若 M6-b 把它的 `${workflowContent}\n\n${goal}` 字符串硬拼替换为 composer，需要确认 `goal` 段相对位置（旧实现 goal 在 workflow 之后）。

#### dispatch-service / executeDispatch / executePrompt

- `dispatch-service.ts:167 buildTemplateProviderExecutionContext(workspacePath, finalPipelineId)` —— 这就是 v3 §1 ★7 的源头：template 路径不传 `resolvedWorkflowRef`，导致 M0-b 在 group-runtime 流量覆盖率为 0。M6-a gate 必须先确保此处补齐 `resolvedWorkflowRef` 派生。
- `group-runtime.ts:997` 与 `:1064` 也调用 `buildTemplateProviderExecutionContext`——这两处是 dispatchRun 兜底入口和 retryRun 入口，**v3 §3.1 没列 `:1064`**。M6-a 切换若漏掉 `:1064`，会出现"普通 dispatch 走 composer，retry 仍走旧 prepend"的两套字符串契约共存。

#### scheduler.ts 三类 dispatch action

- `dispatch-prompt` → `executePrompt`、`dispatch-pipeline` → `executeDispatch`、`dispatch-execution-profile` → 二选一。本身不被改动，但所有走它进来的任务都会被 M5/M6 字符串差异波及。
- **影响**：6 个在册任务（修正报告 §2.2）触发的 prompt 字符串在 M5 / M6 上线前后会**结构性变化**。若用户在 GUI 上做过 `triggerSchedulerJob` 的 prompt diff 对比（实测 `scheduler-panel.tsx:266` 提供"立即执行"按钮），切换前后会观察到差异。需要在灰度阶段对每个 builtin 任务跑 snapshot diff。

#### company-loop-executor

- `src/lib/company-kernel/company-loop-executor.ts` 负责 daily-review / weekly-review 的执行编排，最终调 `dispatchRun` 或 `executePrompt`。本身不改，但 M6 的字符串变化会传导到 company-loop 的 review prompt。
- daily-review / weekly-review 的产出会进入 `operating-signals` SQLite 表（`gateway-db.ts:379`），如果 prompt 结构变化导致 review 文本格式漂移，下游对 review 文本做正则提取的脚本（如果存在）会破裂——**待调查**。

### 2.2 资产与编辑链路

#### `/api/workflows/[name]` GET/PUT/POST（**v3 已防御，但仍需注意**）

- 现状：`src/app/api/workflows/[name]/route.ts:48 getCanonicalWorkflow(name)`、`:6 saveCanonicalWorkflow`、`:5 deleteCanonicalWorkflow`。
- v3 §3.2 明确"canonical-assets.ts:161 保持原行为返回 raw"，所以这条编辑链路理论上零破坏。
- **不预期影响 3**：v3 §2 #4 "AssetRegistry 上层切 raw/body/meta" 同时收编 `canonical-assets.ts:154/173/232`，但 `canonical-assets` 本身不改。若 AssetRegistry 在某些消费点把 `body` 回写到 `getCanonicalWorkflow` 调用方（比如 `formatWorkflowSection` 收的是 `CanonicalWorkflow` 完整对象，里面 `content` 字段如果被改成 body 而不是 raw），编辑器读 API 时会看到"frontmatter 不见了"。**v3 文档对"`CanonicalWorkflow.content` 字段语义在切换前后是否保持原义"未做硬约束**——这是 M2 验收必须明示的契约项。

#### `/api/skills/[name]`

- `src/app/api/skills/[name]/route.ts:9 getCanonicalSkill(name)`。Skill 在 v3 不被切 raw/body（frontmatter 是 workflow 独有的关注点），M2 改造对它只有"读盘缓存化"层面的间接影响。Low 影响。

#### department-sync（IDE mirror）

- `src/lib/agents/department-sync.ts:18 getCanonicalWorkflow`、`:102` 读全套 workflow ref。它把 canonical workflow 写到 `.agents/workflows`（Antigravity）/ 单文件 instructions（Codex / Claude Code / Cursor）。
- **不预期影响 4**：如果 M2 后 AssetRegistry 对 `getCanonicalWorkflow` 做"读盘后剥 frontmatter 缓存 body"，而 department-sync 期望写入 IDE 镜像的是**带 frontmatter 的 raw**（因为 IDE 那边的 workflow 编辑器可能依赖 frontmatter），就会出现"IDE 镜像被剥光 frontmatter"的不可见破坏。检查 `department-sync.ts:102-103` 当前确实是 `getCanonicalWorkflow(ref)` 直接拿 `workflow.content`——若 `.content` 语义被改，这条镜像链路就被破坏。**v3 未识别**。

#### canonical-assets 缓存与热重载

- 当前 `canonical-assets.ts:154-170 getCanonicalWorkflow` **每次都 `fs.readFileSync`**，没有缓存。M2 AssetRegistry 提议"同一 ref 一 run 内读盘 1 次"——这意味着 AssetRegistry 会成为新缓存层。
- **不预期影响 5**：现状下，一旦 `/api/workflows/[name] PUT` 写盘成功，下一次 `getCanonicalWorkflow` 立即看到新内容（无缓存即"实时一致性"）。M2 加缓存后，若 AssetRegistry 不订阅写事件，编辑器保存后**当前 run 内**仍读到老 body。
- 建议：AssetRegistry 的缓存 scope 必须是 **per-run** 而不是 process-global；且 `saveCanonicalWorkflow` 写盘后必须 invalidate。v3 文档对此**未明示**。

#### AGENTS.md 自动生成

- 全仓库搜索没有 AGENTS.md 自动生成机制（仅有手写 `ARCHITECTURE.md`）。**不影响**。

#### growth assets / self-evolution 发布链路

- `src/lib/evolution/publisher.ts:43/47` 通过 `getCanonicalWorkflow/getCanonicalSkill` 拿 path → 写盘发布。
- `src/lib/evolution/generator.ts:52/53/55` 同样调 `getCanonicalWorkflow/Skill/ScriptsDir` 做"是否存在"判定。
- **影响**：M2 AssetRegistry 化以后 evolution 链路读盘频次降低（间接收益）；但若它在发布期间需要 raw（含 frontmatter）来回写，需要确认 publisher 拿到的是 raw 还是 body。`publisher.ts:43` 只取 `.path` 不取 `.content`，看似无碍。**Low / 待 M2 验收时复查**。

#### `.agents/workflows/` 文件监听

- 全仓库没有 `chokidar`、`fs.watch` 监听 `.agents/workflows` 的代码。**不影响**。

### 2.3 Artifact / Deliverables / Run capsule（**v3 已防御的关键面**）

#### run-artifacts 扫描器与黑名单

- `src/lib/agents/run-artifacts.ts:130-135 ignoredPromptRootFiles = new Set([artifacts.manifest.json, result-envelope.json, result.json, task-envelope.json])`。
- v3 改造点 #12 明示加入 `prompt.composed.json` 和 `prompt.composed.md`。
- **不预期影响 6（v3 已部分覆盖）**：黑名单只防 `executionTarget?.kind === 'prompt'` 路径（`:176`）。**group-runtime / template 路径不走 `scanPromptRootArtifacts`**，所以 group-runtime 路径下即便有 `prompt.composed.{json,md}` 写到 `artifactAbsDir` 根，也不会被 `scanPromptRootArtifacts` 吸入。
- 但 `scanRecursive` 扫的是 `specs/architecture/review/delivery` 4 个子目录（`run-artifacts.ts:137-142`）——只要 composer 把 ledger 写到根目录或这 4 个子目录之外的根目录路径，group-runtime 路径也是安全的。**关键不变量**：composer 的 ledger 落盘位置必须是 `artifactAbsDir` 根，**绝对不能落到 `specs/`、`architecture/`、`review/`、`delivery/` 任何一个子目录**——否则会被 group-runtime 路径以 `kind=specs.prompt.composed` 等形式吸入并写入 deliverables。v3 §3.1 写"`composer.compose()` 末尾写 `prompt.composed.{json,md}`"但**没硬约束目录位置**。建议在 M4 验收明示。

#### syncRunArtifactsToDeliverables → SQLite deliverables 表

- `src/lib/storage/gateway-db.ts:1634 syncRunArtifactsToDeliverables`：只要 `run.resultEnvelope.outputArtifacts` 里有条目，就 `upsertDeliverableRecord`。
- **不预期影响 7**：若黑名单失效或 composer 落盘位置错误，每条 prompt run 都会向 deliverables 表插入 2 条幽灵记录（`.json` + `.md`）。100 次 run 后 deliverables 表就有 200 条无意义条目，污染 `listDeliverableRecordsByProject(projectId)` 返回。
- 缓解：M4 + M12 联动测试，写 fixture 在 prompt-mode + template-mode 下都跑一次 `executePrompt` / `dispatchRun`，断言 `listDeliverableRecordsByProject` 返回的数目不变。

#### run capsule export

- `gateway-db.ts:338 CREATE TABLE run_capsules`——run capsule 保存的是 run 元信息，不直接保存 prompt 字符串。但 capsule 内可能引用 outputArtifacts。Medium 影响通过 deliverables 间接传导。

#### project deliverables 展示

- `listDeliverableRecordsByProject(projectId)` 给前端拉记录。**间接影响 8**：若 v3 在某些过渡阶段 `prompt.composed.{json,md}` 未被黑名单覆盖，UI 上"项目交付物"列表会突然冒出"Prompt Composed"条目，运营会困惑。

#### agent-run-detail / agent-runs-panel / stage-detail-panel

- 三套 UI 面板从 `/api/agent-runs/[id]` 拿数据，包含 outputArtifacts 渲染。同上链路影响。

### 2.4 Knowledge / Memory

#### Knowledge retrieval 与 usageCount 副作用收口

- `src/lib/knowledge/retrieval.ts:67 retrieveKnowledgeAssets`、`:80 recordKnowledgeAssetAccess`。
- 现状：仅 `prompt-executor.ts:491` 调用一次。Group-runtime 路径不接 knowledge。
- M3-a `KnowledgeRetrievalProvider.shouldRun` 默认 false、仅 prompt mode 启用——v3 已明示守门。
- **不预期影响 9**：M4 配套 per-run runtime-cache 把 `recordKnowledgeAssetAccess` 从"review-loop 每 round 每 role 1 次"降到"整轮 1 次"。这意味着**统计语义变化**：
  - 过去：跑一次 review-loop 6 role × 3 round = 18 次 `usageCount` 增量
  - 改造后：1 次
  - `src/app/api/knowledge/route.ts:161 copy.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))` 按 usageCount 排序的"最常用知识"列表会发生**数值跳变**。
  - `src/components/knowledge-browser-workspace.tsx:281 ${detail.usageCount || 0} 次复用` 与 `knowledge-panel.tsx:324` 累加显示会显著降低（"复用次数"突然变小）。
- 缓解：在 M4 上线 changelog 中明示"复用次数定义变更：从 prompt token 级 → run 级"；考虑加 migration 脚本对历史 usageCount 一次性 normalize。v3 **未提及**。

#### Backend memory hook（applyBeforeRunMemoryHooks）

- 6 处调用：`prompt-executor.ts:523/666`、`group-runtime.ts:396/734/1193/1552`、`supervisor.ts:153`。
- 这是 backend 层 hook，不在本期范围。v3 §3.2 明示"Backend memory hook 边界不动"。
- **间接影响 10（关注点而非问题）**：memory hook 接收的 `BackendRunConfig` 里的 `prompt` 字段会从旧拼装变成 composer 输出。若 memory hook 对 prompt 做字符串模式匹配（如查找 "### Workflow:" 字面量），会因 composer 段头格式变化而失配。需要扫一遍 `src/lib/backends/memory-hooks.ts` 与 `department-memory-bridge.ts` 是否做 prompt 字符串解析。**待 M3-a/M4 切换前验证**。

#### Claude Engine memory 系统

- `src/lib/claude-engine/engine/skill-store.ts:22-73` 有独立的 `usageCount` 统计，**按自己逻辑递增**（`:197 skill.metadata.usageCount += 1`），与 prompt 拼装无关。**不影响**。

### 2.5 Workflow Runtime hooks 副作用面（**M3-a 核心收口**）

#### prepareWorkflowRuntimeContext 与 3 个 runtimeProfile

- `workflow-runtime-hooks.ts:906 prepareWorkflowRuntimeContext` → switch on `runtimeProfile`：
  - `daily-digest` → `prepareAiDigestContext`（`:247`，含 `fetch_context.py` spawn + `https://api.aitrend.us/digest` fetch）
  - `daily-events` → `prepareAiBigEventContext`（`:406`，含 `fetch_context.py` spawn）
  - `story-top-candidates` → `prepareStoryTopCandidatesContext`（`:358`，最终调 `ingestStoryTopCandidatesFromArtifact:716`）
- **不预期影响 11**：M3-a `WorkflowRuntimeProvider.shouldRun` 默认 false，仅 `runtimeProfile ∈ {daily-digest, daily-events, story-top-candidates}` 才启用。**但 v3 没说"如果其他 workflow 在未来引入新 runtimeProfile（比如 `weekly-summary`），shouldRun 会自动开还是默认 false"**。这是 forward-compat 缺口：未来加新 runtimeProfile 必须同步更新 `WorkflowRuntimeProvider` 白名单。建议在 M3-a 加上"未知 runtimeProfile 一律 false + 告警日志"的兜底。

#### 现存 cron / GUI 任务（6 个）的 runtime hook 触发

- 修正报告 §2.2 列了 6 个在册任务：
  1. 市场部 Prompt 任务（每周）
  2. Native Codex 周期巡检（60s）
  3. AI情报工作室日报（20:00）
  4. Company Daily Loop（20:05）
  5. Company Weekly Review（周五 20:30）
  6. Platform Engineering Story Top 3（09:00）
- 任务 3（AI情报工作室日报）依赖 `runtimeProfile: daily-digest` → fetch_context.py + api.aitrend.us。
- 任务 6（Story Top 3）依赖 `runtimeProfile: story-top-candidates` → ingest 到 company-kernel DB。
- 任务 2（Native Codex 巡检 60s 高频）：**Blocking 级别关注**——它每 60s 触发一次，若 M3-a 副作用守门失误（runtime hook 在 template mode 也跑），就是每分钟一次 fetch + spawn 的资源放大。v3 验收 gate 明确"template mode 无 runtimeProfile 时 0 次 spawn / 0 次 fetch"——必须**先在 M3-a 写 1 个针对 Native Codex 任务的回归测试**再上线。

#### story-top-candidates ingest → company-kernel DB

- `workflow-runtime-hooks.ts:716 ingested = ingestStoryTopCandidatesFromArtifact(...)` → 写入 `operating_signals` / `story_top_candidates` 等 company-kernel 表。
- **不预期影响 12**：M4 runtime-cache 把 review-loop 整轮 runtime hook 输出共享。但 `ingestStoryTopCandidatesFromArtifact` **不仅生成 prompt context，它有数据库副作用**——如果某条 review-loop 跑了 6 次 ingest（旧行为，每 role 各 ingest 一次），改成 1 次后 `operating_signals` 表的 insertion 频次降为 1/6。若下游有"按 signals 数量做 trending"的统计（比如 `ceo-office-improvement-pool` 的池排名），会受冲击。
- 实际上 v3 §1 ★6 把这归为"副作用浪费"，**没认识到副作用本身可能是被下游统计依赖的**。M4 上线前必须扫一遍 `operating_signals` / `story_top_candidates` 的读侧消费方。

### 2.6 API 层与外部协议

#### Antigravity gRPC（StartCascade / sendMessage / StreamAgentStateUpdates）

- `src/lib/providers/antigravity-executor.ts:97 StartCascade`、`:121/164 sendMessage`。这是 prompt 字符串最终落地的 RPC 出口。
- v3 §3.2 明示"gRPC 协议契约不动，仅改 prompt 字符串内容"。Low 影响。
- **不预期影响 13**：`PITFALLS.md` 坑 9 提到 `StreamAgentStateUpdates` 推 delta、必须 merge——这与 prompt 拼装无关。但 `PITFALLS.md` 坑 16 提到 "Agent Manager 看不到 Web 前端创建的对话"——若 PromptComposer 输出的 prompt 与 Agent Manager 内部的 prompt 模板"看起来不一致"（因为 composer 加了 ledger 段头标记），Agent Manager 端的 IDE 可能对 prompt 内容做某种内容解析（猜测：title 派生、context block 识别）。**待调查**：检查 Agent Manager 是否对 prompt 做内容侧解析。无法直接读 Agent Manager 源码，只能从行为日志推断。

#### WebSocket 实时推送

- 仅推 step 增量，不解析 prompt 字符串内容。**不影响**。

#### `/api/agent-runs/*` 路由

- 拉 run 元信息 + outputArtifacts。Low / 间接影响（通过 deliverables 链路）。

#### `/api/conversations/*` 路由

- 不参与 prompt 拼装。**不影响**。

#### `/api/scheduler/jobs*` 路由

- 修正报告确认完全独立维度。**不影响**。

#### MCP server tools（`antigravity_create_scheduler_job` 等）

- 创建 scheduler job 的入口，不参与 prompt 拼装。**不影响**。

### 2.7 CEO Office / 治理机制

#### CEO Office 立项池（ceo-office-improvement-pool）

- 它从 `operating_signals` / story-top candidates / run history 提案池里挑改进项。
- **间接影响 14**：v3 §2 改造点 #12（Observability：`prompt.composed` 事件）会让 run-history 新增 `prompt.composed` 事件类型——若立项池消费 run-history 做 trending 分析（如"prompt 重复内容率排名"），新事件类型必须被识别。**待调查**：检查 `src/lib/ceo-office-improvement-pool.test.ts` 与相关消费代码。

#### operating agenda / 决策队列

- `operating_signals` 表是输入源。受 §2.5 ingest 频次变化影响（不预期影响 12）。

#### company-kernel 自动决策链路

- `src/lib/company-kernel/company-loop-executor.ts` 调 `dispatchRun` 或 `executePrompt`。受 M5/M6 字符串变化波及。Medium 影响（间接）。

#### CEO Agent 对话调用

- `src/lib/agents/ceo-environment.ts` 是 CEO Agent 的 system prompt。**与 v3 不冲突**——它是 CEO 决策层 prompt，不是 worker prompt。v3 §3.2 明示"CEO prompts 不在本期范围"。**不影响**。

### 2.8 评估 / 复盘

#### evaluatePromptRun

- `prompt-executor.ts:615 evaluatePromptRun(runId)`、`:666 applyBeforeRunMemoryHooks(evalProvider, ...)`。
- **不预期影响 15**：evaluator 本身也是个 prompt 调用，但 v3 §2 改造点 #5 / #9 都没明确把 evaluator 的 prompt 路径纳入 M5。**evaluator prompt 是否过 composer**——文档没说。若不过，会出现"主 run prompt 经过 composer + 去重，eval prompt 仍是旧拼装且含双重 workflow"的内部不一致。

#### supervisor / step summary

- `src/lib/agents/supervisor.ts:153 applyBeforeRunMemoryHooks(evalProvider, ...)`。它的 prompt 拼装链路更小，**v3 §3.2 明示 supervisor 不在本期**。Low 影响。

#### run history / 事件流

- v3 改造点 #12 加 `prompt.composed` 事件类型。消费方包括 `run-conversation-transcript.ts`、`agent-run-detail` UI。**直接影响**：所有 run-history 消费方必须能处理新 eventType（默认忽略 / 显式渲染）。建议在 M12 上线前给 `agent-run-detail` 加一个"Prompt Composed"折叠面板原型。

### 2.9 测试覆盖

#### 100% 必须重写的测试（**Blocking**）

| 文件 | 原因 | 改造点 |
|---|---|---|
| `prompt-builder.test.ts` | mock 了 `resolveWorkflowContent`，5 个 builder 行为契约固化在 fixture | M0-a snapshot / M2 / M3-b |
| `prompt-executor.test.ts` | mock 了 `applyProviderExecutionContext / buildPromptModeProviderExecutionContext / retrieveKnowledgeAssets / prepareWorkflowRuntimeContext / resolveWorkflowContent` 全部被改 | M5 |
| `group-runtime.test.ts` | mock 了 `applyProviderExecutionContext / buildTemplateProviderExecutionContext / resolveWorkflowContent` | M6-a / M6-b |
| `group-runtime.multi-role.test.ts` | 同上 + review-loop 多 role 路径 | M6-a |
| `__tests__/prompt-runtime-contract.acceptance.test.ts` | 完整端到端契约测试，mock 几乎所有改造点 | 全部 |
| `department-execution-resolver.test.ts` | 测试 `buildTemplateProviderExecutionContext / buildPromptModeProviderExecutionContext` 输出 prompt 字符串 | M3-a |

#### 需要更新 fixture 的测试

| 文件 | 原因 |
|---|---|
| `prompt-builder.test.ts` | builder 输出字符串中 workflow 段落格式可能变化（由 raw 改为 body） |
| `workflow-runtime-hooks.test.ts` | runtime hook 输出与 composer 集成后断言点变化 |
| `app/api/pipelines/[id]/route.test.ts` | 该 route 直接 `AssetLoader.resolveWorkflowContent`，M13 改造层后 fixture 期望变化 |
| `department-capability-registry.test.ts` | `getCanonicalWorkflow` mock 在 M2 后语义变化 |

#### 缺测试覆盖（建议新增）

1. **AssetRegistry raw/body/meta 切分单测**：保证 frontmatter 不出现在 body、raw 完整保留。
2. **canonical-assets API 编辑链路回归测试**：保存 → 读取 → diff 应零差异。
3. **department-sync IDE mirror 不被 frontmatter 剥离破坏的测试**：写 canonical workflow → 触发 department-sync → 检查 `.agents/workflows/<name>.md` 内容含 frontmatter。
4. **Knowledge usageCount 行为契约测试**：review-loop 6 role × 3 round → recordKnowledgeAssetAccess 只调 1 次（M4 cache 验收）。
5. **副作用 fence 测试**：template mode + 无 runtimeProfile → 0 次 fetch_context.py spawn / 0 次 api.aitrend.us fetch / 0 次 `recordKnowledgeAssetAccess`（M3-a / M4 双重验收）。
6. **`prompt.composed.{json,md}` 不污染 deliverables 测试**：跑一次 prompt-mode run + 一次 template-mode run → `listDeliverableRecordsByProject` 返回数 = 0 个 composed 条目。
7. **role-switch composer 等价性测试**：M6-b 改造后，shared cascade 内 switch prompt 与 fresh cascade 内 fresh prompt 在"包含哪些 capability-pack 段"上行为一致。
8. **Native Codex 巡检任务 60s 高频回归测试**：连续 5 次触发 → token 消耗 / 副作用计数线性可控。

#### 推荐的测试金字塔（M0-a snapshot 的延展）

- L1 单元：Provider 行为 snapshot（每个 provider 独立 30 行 fixture）
- L2 集成：composer.compose() 输出 snapshot（mode×target 笛卡尔积）
- L3 端到端：6 个 builtin 任务各 1 个 e2e（mock backend，断言 prompt 字符串）

### 2.10 数据兼容性 / SQLite migration

#### deliverables 表

- 不需要 migration。Schema 不变。但需要在 M12 上线前**人工清理**已经被旧逻辑误吸入的 prompt-related 文件（如果有）——v3 §3.1 改造点 #12 明示"加黑名单"是防新污染，**未提及清理历史污染**。建议加一次性脚本：`DELETE FROM deliverables WHERE artifact_path LIKE 'prompt.composed.%'`。

#### knowledge_assets 表

- 不需要 schema migration，但 usageCount 语义变化（详见 §2.4 #9）。

#### run_capsules / runs / operating_signals 表

- 不变。Low 影响。

#### 现有 artifact 目录的 prompt-related 文件清理

- 实地检查现状：`scanArtifactManifest` 黑名单当前已含 `result-envelope.json` 等，没有 `prompt.composed.*` 残留。属于全新引入，零兼容性问题。

#### 现有 in-flight runs 升级处理

- **不预期影响 16**：M5 / M6 切换瞬间，正在运行的 review-loop 若已经在 round N 的中段，切换后 round N+1 拼装规则不同，prompt 跳变。建议 feature flag 仅对**新启动的 run** 生效，对在运行的 run 沿用旧逻辑（per-run flag 锁定）。v3 §3.4 feature flag matrix **未明示 per-run 锁定**。

### 2.11 运行时灰度策略

#### M0-M6 Feature Flag matrix

| Milestone | Flag | 默认 | 灰度对象 | 可观测指标 | 回滚动作 |
|---|---|---|---|---|---|
| M0-a | 无 | — | snapshot 测试 always-on | golden diff = 0 | 删 snapshot |
| M0-b | `PROMPT_COMPOSER_SKIP_INLINE` | off | PromptExecutor 单 workflow prompt-mode | workflow MD 出现次数 = 1；snapshot diff = 预期 | 关 flag |
| M1 | 无 | — | tsc 通过 | `tsc --noEmit` 0 错 | revert PR |
| M2 | 无（feature gate 不必要）| — | 同 ref 一 run 1 次读盘 | 读盘 counter | revert AssetRegistry，回退到 4 套加载器 |
| M3-a | `PROMPT_COMPOSER_RUNTIME_HOOKS_IN_TEMPLATE_MODE`、`KNOWLEDGE_IN_TEMPLATE_MODE` | off | provider 是否在 template mode 启用 | spawn / fetch / record 计数 | 关 flag 双重默认 |
| M3-b | 无（stage-specific 默认绑入对应 builder）| — | snapshot diff = 0 | 4 stage provider 输出与原 builder 对照 | 撤回 builder 内 provider 调用 |
| M4 | `PROMPT_COMPOSER_V2` | off | composer + ledger 是否启用 | ledger 双键去重命中数；review-loop runtime cache hit rate | 关 flag |
| M5 | 同 M4 | off | PromptExecutor 是否走 composer | prompt 字符串 diff；workflow MD count | 关 flag |
| M6-a | 同 M4 + `resolvedWorkflowRef` 派生 | off | group-runtime 5 入口是否走 composer | 同上 + 4 个 builder 行为对照 | 关 flag |
| M6-b | 同 M6-a | off | retry / role-switch / legacy-single | 三路径 prompt 字符串 diff | 关 flag |
| M12 | 黑名单常驻 | always-on | run-artifacts | deliverables 表中无 `prompt.composed.*` 条目 | 加入黑名单的 commit revert |

**Per-run flag 锁定**（新增建议）：每个 run 启动时把当前 flag 值快照到 `run.flags`，整 run 内沿用，避免 in-flight 跨 flag 切换。

#### 灰度阶段可观测指标

- **强信号**：
  - workflow MD 在最终 prompt 字符串里出现次数（每 builder 单独计）
  - review-loop 一轮内 `fetch_context.py` spawn 次数
  - 一轮内 `recordKnowledgeAssetAccess` 调用次数
  - deliverables 表中以 `prompt.composed.` 开头的条目数
- **弱信号**：
  - prompt 字节数 P50 / P90
  - run latency P50（与 prompt token 数相关）
  - 模型完成质量评分（业务侧 review pass rate）

### 2.12 部署 / 兼容性

#### Antigravity desktop app 同步发版

- v3 §3.2 明示"gRPC 协议契约不动"。所以**不需要同步发版**。但仍需要在 release notes 中告知运营"prompt 字符串结构变化"。Informational。

#### 跨 worker / 跨实例同步

- 项目当前 single-process Next.js，无多 worker 同步问题（确认：`src/lib/storage/gateway-db.ts` 是单文件 SQLite，启动期一次性 open）。**不影响**。

#### 启动顺序依赖

- `initializeGatewayHome / initializeScheduler` 在启动期触发 ensure 函数。AssetRegistry 若是 module-level singleton 初始化，要保证它在 PromptComposer 之前 ready。建议 M4 上线时给 composer.compose() 加"AssetRegistry 未 ready 时显式 throw"的兜底，避免静默使用空 registry。

---

## 3. 高优先级"不预期影响"清单

按严重度排序，每条都按"描述 / 触发条件 / 暴露场景 / 缓解策略 / 是否已被 v3 文档覆盖"四要素展开。所有条目都在 §2 详证过。

### #1 prompt.composed 落盘位置错误污染 group-runtime deliverables

- **描述**：v3 §3.1 黑名单 `ignoredPromptRootFiles` 只防 `executionTarget?.kind === 'prompt'` 路径（`run-artifacts.ts:176`）。group-runtime 路径走 `scanRecursive(specs/architecture/review/delivery)`——若 composer 把 ledger 误落到这 4 个子目录中，会被以 `kind=specs.prompt.composed` 等形式吸入。
- **触发条件**：M4 composer.compose() 实现 ledger 落盘逻辑时，目录路径硬编码错误或环境变量配置错误。
- **暴露场景**：每条 template/review-flow run 都会向 deliverables 插入 2 条幽灵记录；100 次 run 后 deliverables 表 +200 条；UI 上"项目交付物"突然出现"Prompt Composed"卡片。
- **缓解策略**：composer 实现期约定"ledger 唯一允许落盘位置：`artifactAbsDir` 根目录"；加单测断言 `specs/`、`architecture/`、`review/`、`delivery/` 不出现 `prompt.composed.*`。
- **v3 已覆盖**：部分（提及黑名单加 ledger 文件名，但未明示目录约束）。
- **严重度**：**Blocking**

### #2 Knowledge usageCount 语义跳变破坏 UI / 排序

- **描述**：M4 per-run runtime-cache 让 `recordKnowledgeAssetAccess` 从"review-loop 每 round 每 role"降到"整轮 1 次"。usageCount 增长率降低 ~18x。
- **触发条件**：M4 上线，且系统中有按 usageCount 排序或显示的 UI。
- **暴露场景**：`/api/knowledge?sort=usageCount`（`route.ts:161`）排名跳变；`knowledge-browser-workspace.tsx:281` "X 次复用"显示骤降；`knowledge-panel.tsx:324` 累加显示降低。
- **缓解策略**：M4 changelog 明示"复用次数定义变更：prompt 注入级 → run 级"；考虑一次性 migration 把历史 usageCount 除以某个估算系数 normalize；或新增 `lastUsedInRunId` 字段做"按 run 级去重"的统计。
- **v3 已覆盖**：**否**。
- **严重度**：**High**

### #3 department-sync IDE mirror 被剥 frontmatter

- **描述**：`department-sync.ts:102-103` 当前直接读 `getCanonicalWorkflow(ref).content`。若 M2 AssetRegistry 把 `.content` 字段语义改成 body（剥 frontmatter），IDE 镜像（`.agents/workflows/<name>.md`）会丢失 frontmatter。
- **触发条件**：M2 AssetRegistry 改 `CanonicalWorkflow.content` 字段含义；department-sync 不感知。
- **暴露场景**：用户在 Antigravity / Codex 里看到的本地 workflow 文件失去 `runtimeProfile / schedule / scripts` 等元数据，IDE workflow 编辑器破坏。
- **缓解策略**：v3 §3.2 明示"`canonical-assets.ts:161` 保持原行为返回 raw"。**但需要进一步约束**："`CanonicalWorkflow.content` 字段保持 raw 语义，body 仅在 AssetRegistry 出口暴露"。在 M2 验收必须明示此契约。
- **v3 已覆盖**：部分（说了 canonical-assets 不动，但没说 `CanonicalWorkflow.content` 字段语义不动）。
- **严重度**：**High**

### #4 in-flight runs 跨 flag 切换导致 prompt 跳变

- **描述**：M5 / M6 切换瞬间，正在运行的 review-loop 若已经在 round N 的中段，切换后 round N+1 拼装规则不同。
- **触发条件**：运维在 review-loop 进行中翻转 `PROMPT_COMPOSER_V2` flag。
- **暴露场景**：同一 run 的不同 round 看到不同的 prompt 结构，模型可能因上下文断裂产生质量退化。
- **缓解策略**：run 启动时把 flag 值快照到 `run.flags`，整 run 内沿用。给 `dispatchRun` 加 `effectiveFlags` 字段，下发时立即固化。
- **v3 已覆盖**：**否**。
- **严重度**：**High**

### #5 ingestStoryTopCandidatesFromArtifact 副作用频次降低影响下游统计

- **描述**：M4 cache 把 review-loop runtime hook 的 ingest 副作用从 N 次降到 1 次。但 `ingestStoryTopCandidatesFromArtifact` 不仅是上下文生成，它有 DB 副作用（`operating_signals` 表）。
- **触发条件**：M4 上线 + 系统中有按 `operating_signals` 频次做 trending/ranking 的逻辑（待调查）。
- **暴露场景**：CEO Office 立项池排名因 signals 计数变化而抖动。
- **缓解策略**：M4 上线前扫一遍 `src/lib/company-kernel/*` 对 `operating_signals` 的所有 SELECT，确认是否有 frequency-based 逻辑；若有，把 ingest 副作用独立于 prompt-context 准备，单独跑一次/run 而不是 N 次。
- **v3 已覆盖**：**否**（v3 把它归为浪费，未识别它是被依赖的副作用）。
- **严重度**：**High**

### #6 evaluatePromptRun 漏切换 composer 导致主/eval prompt 拼装不一致

- **描述**：M5 改 `prompt-executor.ts:511` 主路径，`:666 applyBeforeRunMemoryHooks(evalProvider, ...)` 与 evaluatePromptRun（`:615`）路径若不同步切换，eval prompt 还是旧拼装。
- **触发条件**：M5 实现时遗漏 evaluator 路径。
- **暴露场景**：内部审计困惑——同一 run 的主 prompt 走 composer，eval prompt 仍含双重 workflow。
- **缓解策略**：M5 PR 描述明示覆盖 `:511` 与 `:666` 两处；加 fixture 测试 evaluatePromptRun 输出符合 composer 契约。
- **v3 已覆盖**：**否**（§3.1 只列 `:511`）。
- **严重度**：**Medium**

### #7 AssetRegistry 缓存与 `/api/workflows/[name] PUT` 写盘的一致性

- **描述**：M2 AssetRegistry 引入"同一 ref 一 run 内读盘 1 次"。若不订阅 saveCanonicalWorkflow 写事件，编辑器保存后的修改在当前 run 内不可见。
- **触发条件**：M2 上线后，用户在 GUI 编辑 workflow → 同时有 run 在进行 → run 内读到老 body。
- **暴露场景**：用户在 GUI 改 workflow 后立即"重试 run"，发现修改未生效，怀疑 GUI bug。
- **缓解策略**：AssetRegistry 缓存严格 per-run；或在 `saveCanonicalWorkflow` 写盘后 emit 事件，全局 registry 监听 invalidate。
- **v3 已覆盖**：**否**。
- **严重度**：**Medium**

### #8 未来新 runtimeProfile forward-compat 缺口

- **描述**：M3-a `WorkflowRuntimeProvider.shouldRun` 仅在 `runtimeProfile ∈ {daily-digest, daily-events, story-top-candidates}` 启用。未来加新 profile（如 `weekly-summary`）必须同步白名单。
- **触发条件**：未来某 PR 新增 runtimeProfile 但漏改 WorkflowRuntimeProvider 白名单。
- **暴露场景**：新 profile 的 workflow 上线后 prompt 不含 runtime context，模型表现退化。
- **缓解策略**：M3-a 实现期把白名单提到 `canonical-assets.ts` 与 schema 单一真理源；加"未知 runtimeProfile + 告警日志"的兜底，让漏配置可观测。
- **v3 已覆盖**：**否**。
- **严重度**：**Medium**

### #9 Backend memory hook 对 prompt 字符串做模式匹配的隐患

- **描述**：composer 输出的 prompt 段头格式可能与旧拼装不同（如 "### Workflow:" → "## Workflow"），若 memory hook 做字面量匹配会失配。
- **触发条件**：M5/M6 切换后，memory hook 内有任何字符串解析。
- **暴露场景**：memory hook 静默 fallback、无 enrichment，模型质量退化但无告警。
- **缓解策略**：M5 上线前 grep `src/lib/backends/*.ts` 与 `department-memory-bridge.ts` 对 prompt 字符串的 `includes / match / split` 调用；若有，要么 composer 输出沿用旧段头格式，要么 hook 同步改造。
- **v3 已覆盖**：**否**（v3 §3.2 写"memory hook 边界不动"，但只指接口边界）。
- **严重度**：**Medium**

### #10 dispatchRun retry 路径漏切换 composer

- **描述**：`group-runtime.ts:1064 buildTemplateProviderExecutionContext`（retry 路径）未在 v3 §3.1 列出。M6-a 若只覆盖 `:997`（主 dispatch）会出现"主 dispatch 走 composer，retry 走旧 prepend"。
- **触发条件**：M6-a 切换；运行中发生 retry。
- **暴露场景**：retry 后 prompt 结构突然回退到旧形态。
- **缓解策略**：M6-a 实现时同步覆盖 `:997` 与 `:1064`，单测覆盖 retry 路径 prompt 字符串契约。
- **v3 已覆盖**：**否**。
- **严重度**：**Medium**

### #11 历史 deliverables 中已有 prompt-related 文件未清理

- **描述**：v3 §3.1 加黑名单防新污染，但不会清理历史污染。若过去已有"误吸入"的条目存在 deliverables 表，会持续显示。
- **触发条件**：M12 上线后查询 `listDeliverableRecordsByProject`。
- **暴露场景**：UI 永久残留"Prompt Composed"卡片。
- **缓解策略**：M12 上线时附带一次性清理脚本 `DELETE FROM deliverables WHERE artifact_path LIKE 'prompt.composed.%' OR artifact_path LIKE '%/prompt-composer-runtime-%'`。
- **v3 已覆盖**：**否**。
- **严重度**：**Low**

### #12 6 个 builtin 任务的 prompt diff 未做切换前后对照

- **描述**：修正报告 §2.2 列了 6 个在册任务。M5/M6 切换后它们的 prompt 字符串结构会变。需要每个任务都做 fixture diff 才能确认安全。
- **触发条件**：M5/M6 上线。
- **暴露场景**：某个 builtin 任务因 prompt 结构变化导致模型输出格式漂移，下游 ingest 解析破裂（与不预期影响 #5 联动）。
- **缓解策略**：M0-a snapshot 必须覆盖 6 个 builtin 任务各一次实跑 fixture。
- **v3 已覆盖**：部分（M0-a 覆盖 6 个 builder + PromptExecutor 入口，但没明示要覆盖 6 个 builtin 任务的端到端 fixture）。
- **严重度**：**Low**

---

## 4. 测试覆盖影响

### 4.1 100% 失败必须重写的测试（6 个）

| 文件 | M | 重写工作量 |
|---|---|---|
| `prompt-builder.test.ts` | M2/M3-b | 中（mock 改为 AssetRegistry） |
| `prompt-executor.test.ts` | M5 | 大（端到端 mock 拓扑变化） |
| `group-runtime.test.ts` | M6-a | 大 |
| `group-runtime.multi-role.test.ts` | M6-a | 中 |
| `prompt-runtime-contract.acceptance.test.ts` | 全部 | 大（契约重写） |
| `department-execution-resolver.test.ts` | M3-a | 中（resolver 改 composer thin wrapper） |

### 4.2 需要更新 fixture 的测试

- `workflow-runtime-hooks.test.ts`：runtime hook 与 composer 集成后 assert 点变化
- `app/api/pipelines/[id]/route.test.ts`：M13 改造层 fixture 期望
- `department-capability-registry.test.ts`：mock 在 M2 后语义变化
- `run-artifacts.test.ts`：增加 `prompt.composed.*` 黑名单覆盖案例

### 4.3 缺测试覆盖（建议新增 8 项）

见 §2.9 列表。重点强调：
- **副作用 fence 测试**（M3-a/M4 双重验收，Blocking 等级守门）
- **`prompt.composed.{json,md}` 不污染 deliverables 测试**（M4/M12 双重守门）
- **Native Codex 60s 巡检高频回归测试**

### 4.4 推荐的测试金字塔

```
L1 单元（每 provider 30 行 fixture，共 12 provider）
   ↓
L2 集成（composer.compose() snapshot，mode × target 矩阵，~24 case）
   ↓
L3 端到端（6 个 builtin 任务 + 1 个 retry + 1 个 role-switch 共 8 e2e，mock backend）
   ↓
L4 副作用守门（fence + cache + ledger 三类断言）
```

---

## 5. 数据兼容性

### 5.1 SQLite migration 需求

| 表 | 是否需 migration | 原因 |
|---|---|---|
| `deliverables` | 否 + 一次性清理 | schema 不变；建议 M12 加 `DELETE WHERE artifact_path LIKE 'prompt.composed.%'` |
| `knowledge_assets` | 否 + usageCount 一次性 normalize（可选）| 语义变化（详见 §3 #2）；schema 不变 |
| `runs` | 否 | 不变 |
| `run_capsules` | 否 | 不变 |
| `operating_signals` | 否 | 不变；但写入频次降低需观察 |
| `scheduled_jobs` | 否 | 完全独立维度 |
| `evolution_proposals` | 否 | 不变 |

### 5.2 artifact 目录清理

- 检查现状：当前 `scanArtifactManifest` 黑名单已经在用，无历史 `prompt.composed.*` 残留。
- M12 上线时一次性脚本 + `WHERE artifact_path LIKE 'prompt.composed.%'`。

### 5.3 in-flight runs 升级

- **关键不变量**：run 启动期固化 flag 快照到 `run.flags`，整 run 内沿用。
- 实施：`dispatchRun` 入参增加 `effectiveFlags`，`executePrompt` 同样。
- 升级窗口：建议先 drain，等 in-flight runs 都结束再切 flag。

---

## 6. 运行时灰度策略

### 6.1 M0-M6 Feature-flag matrix

| M | 主 flag | 副 flag | 默认 | 灰度对象 | 可观测指标 | 回滚动作 |
|---|---|---|---|---|---|---|
| M0-a | — | — | always | golden fixture 测试 | snapshot diff = 0 | 删 snapshot PR |
| M0-b | `PROMPT_COMPOSER_SKIP_INLINE` | — | off | PromptExecutor prompt-mode 单 workflow | workflow MD 出现次数；snapshot diff | 关 flag |
| M2 | — | — | always-on | 全局 | 同 ref 读盘次数；frontmatter 不进 body | 撤回 AssetRegistry，回退 4 套加载器 |
| M3-a | `PROMPT_COMPOSER_RUNTIME_HOOKS_IN_TEMPLATE_MODE`、`KNOWLEDGE_IN_TEMPLATE_MODE` | — | off | template mode 是否启用 runtime/knowledge provider | spawn/fetch/record 计数 | 关 flag |
| M4 | `PROMPT_COMPOSER_V2` | — | off | composer + ledger 是否启用 | ledger 双键命中数；review-loop runtime cache hit rate | 关 flag |
| M5 | 同 M4 | — | off + per-run 锁定 | PromptExecutor 走 composer | prompt diff；workflow MD count | 关 flag |
| M6-a | 同 M4 + `resolvedWorkflowRef` 派生 | — | off | group-runtime 5 入口走 composer | 同上 + 4 stage provider 对照 | 关 flag |
| M6-b | 同 M6-a | `PROMPT_COMPOSER_RETRY`、`PROMPT_COMPOSER_ROLE_SWITCH`、`PROMPT_COMPOSER_LEGACY_SINGLE` | off | 三特例独立切换 | 三路径 prompt 字符串 diff | 关单条 flag |
| M12 | — | — | always-on（带版本控制）| 黑名单常驻 | deliverables 表 0 个 `prompt.composed.*` | revert 黑名单 commit |

### 6.2 灰度阶段可观测性

- **L1 强信号**（必上）：workflow MD 计数、副作用计数、deliverables 污染计数。
- **L2 弱信号**：prompt 字节数 P50/P90、run latency P50、模型完成质量（业务侧 pass rate）。
- 建议：M3-a 阶段就接入 prometheus / log-based metrics，让"副作用守门"可观测。

### 6.3 每个 M 的回滚动作

详见 §6.1。关键原则：**每个 M 必须可独立 revert**，不能产生跨 M 的 lock-in。

---

## 7. 部署 / 兼容性

### 7.1 Antigravity desktop app 同步发版

- 不需要。gRPC 契约不动。
- Release notes 中告知运营 "prompt 字符串结构变化" 即可。

### 7.2 跨 worker / 跨实例同步

- 项目当前 single-process Next.js。无跨进程同步问题。
- 注意：若未来转 multi-worker，AssetRegistry 与 PromptComposer 的 per-run scope 必须随 worker 隔离（current design 已天然支持）。

### 7.3 启动顺序

- `initializeGatewayHome` → `canonical-assets` 准备 → `initializeScheduler` → 之后 PromptComposer / AssetRegistry 初始化。
- 建议 M2/M4 上线时给 composer.compose() 加"AssetRegistry 未 ready 时显式 throw"的兜底，避免静默空 registry。

---

## 8. 综合结论

### 8.1 总体风险评级

**Medium-to-High**。改造方向正确，v3 文档对核心风险（M0 边界、retry/role-switch 特例、副作用守门、artifact 污染）已有清晰防御。但仍存在 12 条"v3 未识别的不预期影响"，其中 3 条 Blocking 或 High（#1 ledger 落盘位置、#2 usageCount 语义、#3 frontmatter 剥离）。

如果按 v3 的 M0-M6 节奏推进，并补齐本报告 §3 与 §4 提到的 8 项新测试 + 3 条文档约束（CanonicalWorkflow.content 字段语义、ledger 落盘目录、per-run flag 锁定），整体风险可降至 **Low-to-Medium**。

### 8.2 必须在动手前回答的 5 个开放问题

1. **AssetRegistry 是否影响 `CanonicalWorkflow.content` 字段语义？**——目前 v3 §3.2 只说 canonical-assets API 行为不动，未说该字段语义。需在 M2 起点明确：**字段保持 raw，body 仅在 AssetRegistry 出口暴露**。
2. **per-run flag 锁定如何实现？**——dispatchRun / executePrompt 入参增加 `effectiveFlags`？还是从环境变量到 run 启动期一次性快照？
3. **`recordKnowledgeAssetAccess` 与 `ingestStoryTopCandidatesFromArtifact` 副作用收口是否切割 prompt-context 准备？**——理想路径是把 DB 副作用与 prompt 段生成解耦（一次 ingest + N 次 read context）。v3 没区分。
4. **evaluatePromptRun 是否也走 composer？**——M5 落地范围必须明示。
5. **6 个 builtin 任务是否各有独立的 e2e fixture？**——M0-a 验收范围必须明示扩展到 builtin 任务粒度，不仅是 builder 粒度。

### 8.3 建议的"M-1"前置工作（开工前 3-5 天）

1. **加埋点**（半天）：给 `recordKnowledgeAssetAccess` / `fetch_context.py spawn` / `prompt 字节数` 加 metric，先建立 baseline 数据。
2. **建 fixture vault**（1 天）：把 6 个 builtin 任务 + 3 个 review-loop 高频任务的端到端 prompt 字符串录制为 golden fixture，作为 M0-a / M5 / M6 的回归基线。
3. **frontmatter 字段语义 audit**（半天）：扫描 `getCanonicalWorkflow / .content / CanonicalWorkflow` 所有引用方，列出每个调用方"需要 raw 还是 body"，得到一张明确表。
4. **operating_signals 消费方 audit**（1 天）：扫 `src/lib/company-kernel/*` 与 CEO Office 对 signals 的所有 SELECT，确认是否有 frequency-based 逻辑——M4 副作用频次降低前必须先确认下游不依赖。
5. **memory hook prompt 字符串解析 audit**（半天）：grep `src/lib/backends/*.ts` 与 `department-memory-bridge.ts` 对 prompt 字符串的字面量解析。

完成 M-1 前置后再进入 M0-a，整体改造风险可控、ROI 清晰。

---

## 附录 A：关键 file:line 引用清单

| 引用 | 含义 |
|---|---|
| `src/lib/agents/prompt-executor.ts:511` | M5 主切换点 |
| `src/lib/agents/prompt-executor.ts:476` | prepareWorkflowRuntimeContext 调用 |
| `src/lib/agents/prompt-executor.ts:484` | workflow.preflight.completed 事件 |
| `src/lib/agents/prompt-executor.ts:491` | retrieveKnowledgeAssets 调用 |
| `src/lib/agents/prompt-executor.ts:503` | knowledge.retrieval.injected 事件 |
| `src/lib/agents/prompt-executor.ts:523/666` | applyBeforeRunMemoryHooks（main + eval） |
| `src/lib/agents/prompt-executor.ts:615` | evaluatePromptRun |
| `src/lib/agents/group-runtime.ts:1174` | legacy-single（M6-b） |
| `src/lib/agents/group-runtime.ts:1663` | restart-role retry（M6-b） |
| `src/lib/agents/group-runtime.ts:2108` | delivery-single-pass（M6-a） |
| `src/lib/agents/group-runtime.ts:2275` | review-loop（M6-a） |
| `src/lib/agents/group-runtime.ts:2305-2331` | role-switch（M6-b） |
| `src/lib/agents/group-runtime.ts:997/1064` | template context build（M6-a + 隐藏 :1064） |
| `src/lib/agents/dispatch-service.ts:167` | M6-a `resolvedWorkflowRef` 派生源头 |
| `src/lib/agents/department-execution-resolver.ts:405-407` | applyProviderExecutionContext = prepend |
| `src/lib/agents/department-execution-resolver.ts:410/452` | buildTemplate/PromptModeProviderExecutionContext |
| `src/lib/agents/canonical-assets.ts:154-170` | getCanonicalWorkflow（无缓存） |
| `src/lib/agents/canonical-assets.ts:173/232` | getCanonicalWorkflowRuntimeConfig / Skill |
| `src/lib/agents/run-artifacts.ts:130-135` | ignoredPromptRootFiles 黑名单 |
| `src/lib/agents/run-artifacts.ts:137-142/176` | scanDirs + scanPromptRootArtifacts 范围 |
| `src/lib/storage/gateway-db.ts:1634-1657` | syncRunArtifactsToDeliverables |
| `src/lib/knowledge/store.ts:325-337` | recordKnowledgeAssetAccess |
| `src/lib/knowledge/retrieval.ts:67/80` | retrieveKnowledgeAssets + record |
| `src/app/api/knowledge/route.ts:161` | usageCount 排序 |
| `src/components/knowledge-browser-workspace.tsx:281` | UI 复用次数显示 |
| `src/lib/agents/workflow-runtime-hooks.ts:906/913/938` | prepareWorkflowRuntimeContext + runtimeProfile switch |
| `src/lib/agents/workflow-runtime-hooks.ts:188/255/414` | fetch + spawn 副作用源 |
| `src/lib/agents/workflow-runtime-hooks.ts:716` | ingestStoryTopCandidatesFromArtifact |
| `src/lib/agents/department-sync.ts:102-103` | IDE mirror 读 .content |
| `src/lib/agents/scheduler.ts:156-158` | 3 个 builtin jobId |
| `src/lib/storage/gateway-db.ts:288/305/338/358/379` | deliverables / knowledge_assets / run_capsules / memory_candidates / operating_signals tables |
| `src/app/api/workflows/[name]/route.ts:48` | canonical-asset 编辑链路 GET |
| `src/lib/providers/antigravity-executor.ts:97/121/164` | StartCascade + sendMessage（gRPC 出口） |

— 影响面分析，2026-05-11
