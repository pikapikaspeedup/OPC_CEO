# PromptComposer 改造方案 v4（最小修复版）

> **日期**: 2026-05-11
> **状态**: 取代 v3 `prompt-composer-target-architecture-v3-2026-05-11.md`
> **关联**:
> - 撤回前序: v1 / v2 / v3 大型重构方向
> - 复用: `docs/design/builtin-job-policy-fix-2026-05-11.md`
> - 考古: `docs/research/prompt-composition-systemic-analysis-2026-05-11.md`

本方案撤回 v1-v3 的大型重构方向（PromptComposer + 12 provider + AssetRegistry + Ledger，~3700 行 + 14 文件深度改），改为**最小修复路线**：约 200 行代码、零新架构组件、5-6 个文件局部改，端到端解决用户原始的 7 个具体痛点。

撤回原因：v3 在评审中承认其本身就是"上下游一起改"的方案——schema 声明化、provider 拆分、composer funnel、ledger 去重、registry 收编、入口切换之间相互绑定，任何一个环节回滚都会让其余环节落空。同样的痛点用 1/18 代价可以端到端解决，没有必要把工程半径放大到 12-14 PR / 6-9 周。

仍然 3 章：核心问题 / 预计修改的点以及收益 / 架构调整影响。

---

## 1. 核心问题

事实没变。以下问题在 v4 全部用最小切口修复，无新架构组件、无入口切换、无类型声明化。

| # | 问题 | 证据位置 | 业务影响 |
|---|------|---------|---------|
| ★1 | 同一份 workflow MD 全文重复注入 ×2（capability-pack 段 + builder inline） | `department-execution-resolver.ts:295` `formatWorkflowSection` + `prompt-builder.ts:88` 内 `AssetLoader.resolveWorkflowContent` | 单 prompt ~2500 token 中 ~1300 token 重复 |
| ★2 | PromptExecutor 路径再多一份 Playbook context（同 workflow 第二副本） | `prompt-executor.ts:511` `.join('\n\n')` 三段拼接 | daily-digest 每次浪费 ~1300 token |
| ★3 | Schema 在 3 处独立维护，漂移风险 | workflow MD frontmatter / `workflow-runtime-hooks.ts` 的 `runtimeProfile` switch / `canonical-assets.ts:173` | 改字段名需同步 3 处 |
| ★4 | `affectedAreas` 用 TS 联合语法 `'a' \| 'b' \|...` 出现在 prompt 字符串里冒充 JSON | `workflow-runtime-hooks.ts:383` | 模型把 `\|` 误读为 markdown 表格分隔符 |
| ★5 | Frontmatter（runtime / schedule / scripts）原文随 `workflow.content` 整段进 prompt | `canonical-assets.ts:161` 直接 `fs.readFileSync` 不剥；`formatWorkflowSection` push 完整 content | 每 prompt 浪费 ~200-400 token |
| ★6 | runtime hook 多 round × N 副作用放大（python spawn / fetch / `recordKnowledgeAssetAccess`） | `workflow-runtime-hooks.ts:215+`；review-loop 每 round 每 role 各调一次 | review-loop 一轮 6 个 role → fetch_context.py spawn 6 次、knowledge access 重复 record |
| ★7 | Story Top 3 调度配置（cron/启停/timezone）在 GUI 改完被 ensure 覆盖回出厂默认 | `scheduler.ts:281-303` 第三个 spread 覆盖用户字段 | 用户在调度面板能改 AI 情报日报，却改不了 Story Top 3 |
| ★8 | 装配过程不可见 —— 仓库内不存在 `composedSections` / 完整 prompt 落盘 | 全仓库 grep 0 命中 | 复盘只能 diff 全文，无法定位"哪段注入了什么、为什么超长" |

---

## 2. 预计修改的点以及收益

### 2.1 改动清单（按落地优先级）

| # | 改动 | 文件:行 | 代码量 | 改成什么 | 收益 | 命中 |
|---|------|---------|--------|----------|------|------|
| 1 | 复用 builtin-job-policy-fix | `scheduler.ts:281-303` + 新建 `platform-engineering-policy.ts` + `api/scheduler/jobs/[id]:DELETE` | ~80 行 | 修 ensure 第三个 spread bug；DELETE 加 builtIn 保护；详细见独立方案 | Story Top 3 cron/启停/timezone 在 GUI 可改、不被覆盖 | ★7 |
| 2 | skipWorkflowInline（PromptExecutor only） | `prompt-executor.ts:198-203` | ~10 行 | `buildPromptExecutionPrompt` 内：若 `executionTarget.promptAssetRefs[i]` 已被 `executionContext.resolvedWorkflowRef` 列入 capability-pack workflow，跳过 Playbook context 内嵌 | 单 prompt workflow MD 出现次数 2 → 1，节省 ~600 token | ★1 ★2 |
| 3 | 修 affectedAreas TS 联合冒充 JSON | `workflow-runtime-hooks.ts:383` | ~5 行 | `'  "affectedAreas": ["frontend" \| "api" \| ...]'` → `'  "affectedAreas": ["frontend", "runtime"]   // 允许值: frontend\|api\|runtime\|scheduler\|provider\|knowledge\|approval\|database\|docs'` | LLM 不再输出 `\|` 字面量到 JSON | ★4 |
| 4 | 删除 runtime hook 内 schema 段 | `workflow-runtime-hooks.ts:373-385` | -30 行（净减） | 删 inline `### Required JSON schema`；让 `platform_engineering_story_candidates.md` 已有 schema 作为唯一真理源；runtime hook 仅保留"读哪、写哪、约束" | schema 三处漂移降为一处 | ★3 |
| 5 | AssetLoader 加 `stripFrontmatter` 选项 | `asset-loader.ts:216-228` | ~15 行 | `resolveWorkflowContent(ref, { stripFrontmatter?: boolean })`，**默认 false**；prompt 注入处（`prompt-executor.ts:177`、`prompt-builder.ts:66/105/200/228`、`group-runtime.ts:1173/1934/1955`、`department-execution-resolver.ts:300`）传 `true` | frontmatter 不进 prompt，每 prompt 节省 200-400 token；canonical API / workflow 编辑链路零破坏 | ★5 |
| 6 | runtime hook process-level 缓存 | `workflow-runtime-hooks.ts:906 prepareWorkflowRuntimeContext` | ~20 行 | 加 `Map<string, PreparedContext>` 缓存 key=`${runId}:${runtimeProfile}`；review-loop / delivery 同 runId 多 round 复用 | review-loop 一轮 fetch_context.py spawn 6 → 1；knowledge access record 30 → 1；usageCount 不再人为膨胀 | ★6 |
| 7 | Runtime Contract 挪到 workflow MD（**零占位符**） | `workflow-runtime-hooks.ts:358-388` + `.agents/workflows/platform_engineering_story_candidates.md` | ~30 行 | workflow MD 文末加 `## Runtime Contract` section，写静态业务约束（用相对路径如 `User Story/**/*.md`）；runtime hook 简化为 (a) 读取该 section、(b) 追加 2 行运行时上下文 `Workspace: <workspacePath>` + `Artifact directory: <artifactAbsDir>`；**不引入任何模板/占位符语法** | 用户在 workflow 编辑器改 contract，无需发版改 TS；LLM 通过 Workspace + 相对路径自行解析绝对路径 | ★3 ★8 |
| 8 | 装配可见 `_composed-prompt.txt` | `prompt-executor.ts:518` composedPrompt 拼接完成后 | ~10 行 | `fs.writeFileSync(path.join(artifactAbsDir, '_internal', 'composed-prompt.txt'), composedPrompt)`；写到 `_internal/` 子目录避免被 `run-artifacts.ts:122` 扫描器吸入 deliverables | 每次 run 自动落盘完整 prompt，复盘直接打开 `.txt`，零新 UI | ★8 |

### 2.2 代价对照

| 维度 | v3 大型重构 | v4 最小修复 |
|---|---|---|
| 代码量 | ~3700 行 | ~200 行 |
| 新组件 | 12 provider + composer + registry + ledger | 0 |
| 影响文件 | 14 个文件深度改 | 5-6 个文件局部改 |
| LLM prompt 行为变化 | 大（结构性重排 + 去重 + frontmatter 剥离） | 小（仅去重 + frontmatter 剥离） |
| 风险等级 | Medium-High | Low |
| 落地周期 | 6-9 周 / 2-3 sprint / 12-14 PR | 1-2 周 / 8 PR |
| Feature flag 矩阵 | 5 维 × 多组合灰度 | 0（每个 PR 直接合入） |
| 解决用户原始痛点 | 7/7 | 7/7 |

---

## 3. 架构调整影响

### 3.1 影响文件清单

仅 5-6 个文件 + 1 个 workflow MD：

- `src/lib/agents/scheduler.ts`（改动 1）
- `src/app/api/scheduler/jobs/[id]/route.ts`（改动 1，DELETE 保护）
- `src/lib/agents/prompt-executor.ts`（改动 2 + 8）
- `src/lib/agents/workflow-runtime-hooks.ts`（改动 3 + 4 + 6 + 7）
- `src/lib/agents/asset-loader.ts`（改动 5）
- `.agents/workflows/platform_engineering_story_candidates.md`（改动 7）
- 新建 `src/lib/company-kernel/platform-engineering-policy.ts`（改动 1，按 builtin-job-policy-fix 方案）

### 3.2 不破坏的边界（明示）

- ✅ GUI 调度面板（`scheduler-panel.tsx` / `/api/scheduler/jobs*`）完全不动
- ✅ 调度系统 `ScheduledJob` 类型与 `scheduled_jobs` SQLite 表完全不动
- ✅ Antigravity gRPC 协议契约不动
- ✅ canonical-assets API 行为不动 —— `/api/workflows/[name]/route.ts:53` 编辑链路继续返回完整 markdown（含 frontmatter）
- ✅ workflow 编辑器、`department-sync.ts:102` IDE mirror 链路继续走 AssetLoader 默认行为（含 frontmatter）
- ✅ group-runtime / review-loop / delivery / retry / role-switch 全部行为不变（v4 不切入口、不动 builder）
- ✅ Backend memory hook、Claude Engine memory、supervisor、CEO prompts 不动
- ✅ Knowledge retrieval / RAG 行为不动
- ✅ run-history / artifact 扫描 / deliverables / run capsule 不动（`_internal/` 子目录受扫描器边界保护）
- ✅ AssetLoader 默认行为不变（仅新增可选参数 `stripFrontmatter`，默认 false）
- ✅ 不引入任何模板引擎 / 占位符语法（Runtime Contract 改造采用纯字符串拼接，无 `{{var}}` 替换）

### 3.3 风险与守门

| 风险 | 触发场景 | 守门策略 |
|------|---------|---------|
| 改动 5 `stripFrontmatter` 误传到 canonical / 编辑链路 | 调用方误把 `true` 传到非 prompt 注入路径 | 默认 false；只在显式列出的 6 个 prompt 注入处传 true；单测覆盖 `/api/workflows/[name]:53` 仍返回含 frontmatter 的 raw |
| 改动 6 cache key 冲突导致跨 run 串数据 | 两个 run 拿到同一 runId | runId 是 UUID，几乎不可能冲突；额外用 `${runId}:${runtimeProfile}` 双段 key |
| 改动 7 workflow MD 缺失 `## Runtime Contract` section | workflow MD 被误删该 section / 标题拼写错 | runtime hook 读取时若找不到 section 立即抛错（fail-fast）；单测覆盖 `.agents/workflows/platform_engineering_story_candidates.md` 必含该 section |
| 改动 8 `_internal/` 子目录被未来扩展的扫描器误吸 | 后续给 `run-artifacts.ts` 加新扫描规则忘记排除 | 在 `run-artifacts.ts:122` 加注释明确 `_internal/` 不应被 scan；单测断言 deliverables 列表不含 `composed-prompt.txt` |
| 改动 4 删 schema 段后 LLM 输出格式漂移 | playbook MD 内 schema 与原 inline schema 不完全一致 | 改动落地前 diff 两份 schema、对齐到完全一致；保留改动 4 的 git revert 路径（30 行可秒回滚） |
| 改动 2 skipWorkflowInline 在 group-runtime 路径未生效 | group-runtime / retry / role-switch 不走 PromptExecutor | v4 明示：改动 2 仅 PromptExecutor 路径；group-runtime 路径的 ★1 重复留待后续单独评估，不在 v4 范围 |

### 3.4 落地路径

8 个 PR 全部独立、可独立 review、可独立合入。按"代码量从小到大、风险从低到高"顺序排：

| PR | 改动 | 代码量 | 风险 | 验收 |
|----|------|--------|------|------|
| PR1 | 改动 1（builtin-job-policy-fix） | ~80 行 | 低 | 见 `builtin-job-policy-fix-2026-05-11.md` §5 验收清单 |
| PR2 | 改动 3（affectedAreas） | ~5 行 | 极低 | 渲染后 prompt 不含 `\|` 在 JSON 区块 |
| PR3 | 改动 4（删 schema 段） | -30 行 | 低 | 对照 playbook MD 内 schema 字段一致；daily-digest run 输出格式不变 |
| PR4 | 改动 8（`_composed-prompt.txt`） | ~10 行 | 极低 | 每 run 在 `_internal/composed-prompt.txt` 看到完整 prompt；deliverables 不含此文件 |
| PR5 | 改动 5（stripFrontmatter） | ~15 行 | 低 | prompt 注入处 frontmatter 已剥；canonical API 仍返回完整 raw |
| PR6 | 改动 2（skipWorkflowInline） | ~10 行 | 低 | PromptExecutor 路径单 prompt workflow MD 出现 1 次；group-runtime 行为不变 |
| PR7 | 改动 6（runtime hook cache） | ~20 行 | 中 | review-loop 一轮 spawn / fetch / knowledge access 各 1 次 |
| PR8 | 改动 7（contract 挪到 workflow MD，零占位符） | ~30 行 | 中 | workflow 编辑器改 `## Runtime Contract` 后立即生效；runtime hook 仅做 section 读取 + 追加 2 行运行时上下文；单测断言渲染产物不含任何 `{{` / `}}` 字面量 |

每个 PR 含对应单测，独立验收，无跨 PR 依赖；任何一个出问题可独立 revert，不影响其余 7 个。

---

**END**
