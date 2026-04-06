## Git Version Checkpoint: Phase 6 & Core Architecture Align

**状态**: ✅ 已完成
**日期**: $(date +%Y-%m-%d)

### 概要
按用户要求（"帮我 git 下版本，先 git 但是 不推"），对近期完成的所有开发工作进行统一的版本控制提交（Commit）。近期工作总结包括：
- Phase 6: CEO Agent LLM 决策引擎升级，改用 AI 替代硬编码规则引擎
- 架构调整：统一派发路径 `executeDispatch`，建立稳定的 CEO 和团队指派流程闭环
- OPC 组织治理和决策层重写，支持智能选择模板与组群
- 文档全面同步（Architecture, User Guide, API references 覆盖 Provider, Security, Scheduler 等）
- 界面 UI 调整与 BUG 修复（如：NativeSelect, QuickTaskInput, 路由恢复等）

### 执行动作
- 将工作区所有相关修改的文件添加至 Git 追踪（`git add .`）
- 进行了本地 commit 提交。根据要求，当前版本**尚未推送到远端服务器** (`git commit -m ...`)
# Project Progress

> 项目进度跟踪文档，每次任务完成后更新。

---

## 任务：创建本地 Git 快照提交（不 push）

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
按用户要求，对当前仓库工作区创建一次**仅本地保存**的 Git 提交快照，便于后续通过 commit hash、`git log`、`git show`、`git checkout <commit>` 或新分支回溯当前版本。

### 范围
- 本次提交覆盖当前仓库内已追踪和新建的代码、文档、模板、测试与脚本改动。
- **不包含仓库外文件**，例如 `~/.gemini/antigravity/global_workflows/`、`~/.gemini/antigravity/skills/` 等 home 目录资产，因为它们不在当前 Git 仓库中。

### 说明
- 当前分支：`main`
- 操作方式：本地 `git add` + `git commit`
- 不执行 `git push`

### 验证
- 提交前确认当前分支与工作区状态
- 提交后通过 `git rev-parse HEAD` / `git log -1 --oneline` 确认 commit 已落地
- 通过 `git status --short --branch` 确认工作区已收敛

## 任务：复核并修正 `ARCHITECTURE.md` 的 stage-centric 说明

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
对 `ARCHITECTURE.md` 按 Group Elimination 终态做了专项复核，并修正文档中少量仍会误导读者的旧口径：
1. **系统全景与模块图收口**：将顶层 `Agent Engine` 明确标注为“Stage Runtime (`group-runtime.ts`)”，避免读者把当前运行时理解成对外 Group 语义。
2. **Provider 层说明收口**：补充说明 `group-runtime.ts` 只是 legacy 文件名，当前承载的是 stage-centric 的 Stage Runtime。
3. **CLI 架构段更新**：将 `dispatch --template` 改为当前真实用法 `dispatch <templateId> [--stage <stageId>]`，并同步更新辅助 CLI 表。
4. **目录结构注释同步**：`src/lib/agents/` 的目录说明从笼统的 `group-runtime + registry + asset-loader + review` 改为 `Stage Runtime (group-runtime.ts) + registry + asset-loader + review`。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `ARCHITECTURE.md` | 修正 Agent Engine / Provider / CLI / 目录结构中的旧口径，统一到 stage-centric 终态 |

### 验证
- 关键字回扫：
  - `rg -n -- '--template|group-runtime|Agent Engine<br/>Stage Runtime|Stage Runtime 角色执行|dispatch <templateId>|stageId|/api/agent-groups|dispatch-group|acceptedSourceGroupIds|group-registry|loadAllGroups' ARCHITECTURE.md`
  - 结果：仅保留合理的 `group-runtime.ts` 文件名引用；CLI 和架构说明已收口到 `templateId + stageId`。
- 旧接口残留检查：
  - `rg -n "agent-groups|dispatch-group|groupId|--template|templateId \\| Pipeline 模板|stageId \\|" ARCHITECTURE.md`
  - 结果：无命中。
- 仓库静态检查：
  - `git diff --check`
  - 结果：通过。

### 结论
- `ARCHITECTURE.md` 现在和当前实现是一致的。
- 文档里仍出现 `group-runtime.ts` 仅表示**文件名仍未重命名**，不再表示对外存在 Group 派发语义。

## 任务：复核 `skills` 目录中的 runtime 契约残留

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
对 `~/.gemini/antigravity/skills/` 做了针对运行时契约的全文复核，重点确认 skill 文档是否仍绑定旧的 Group / Gateway API 语义：
1. **`SKILL.md` 正文无 runtime 契约残留**：没有发现 `groupId`、`templateId`、`stageId`、`/api/agent-runs`、`/api/projects`、`sourceRunIds`、`pipelineStageIndex`、`dispatch-group`、`/api/agent-groups` 等字段或接口说明。
2. **技能目录整体不需要迁移**：当前 skills 更像方法论与执行技能说明，不直接承载 Gateway dispatch / project / run 协议。
3. **唯一命中的 `browser-testing` 不是问题**：它在 `SKILL.md` 中出现的 `http://localhost:3000` 只是本地 Web 应用测试示例 URL，不依赖 Antigravity runtime 或 `templateId + stageId` 契约。
4. **源码和数据文件中的 `dispatch` 命中也不是问题**：例如 `docx/scripts/accept_changes.py` 的 UNO dispatcher、`ui-ux-pro-max` 数据文件中的 `dispatch` 文本，都与 Gateway 调度完全无关。

### 验证
- Skill 文档契约扫描：
  - `rg -n "groupId|templateId|stageId|/api/agent-runs|/api/projects|projectId|runId|sourceRunIds|pipelineStageIndex|acceptedSourceStageIds|acceptedSourceGroupIds|dispatch-group|/api/agent-groups|resume|intervene" ~/.gemini/antigravity/skills/*/SKILL.md`
  - 结果：无命中。
- 泛化运行时关键词扫描：
  - `rg -n "localhost:3000|localhost:3000|file:///|Active Workspace|Project|Supervisor AI|Agent 运行时|dispatch 到" ~/.gemini/antigravity/skills/*/SKILL.md`
  - 结果：仅 `browser-testing/SKILL.md` 命中本地 URL 示例；其余命中不涉及 Gateway 契约。
- 全目录补充扫描：
  - `rg -n "localhost:3000|/api/agent-runs|/api/projects|templateId|stageId|projectId|runId|sourceRunIds|pipelineStageIndex|groupId|dispatch-group|/api/agent-groups|acceptedSourceGroupIds|acceptedSourceStageIds|resume|intervene|dispatch" ~/.gemini/antigravity/skills`
  - 结果：除 `browser-testing` 示例 URL 与非 Gateway 语义的 `dispatch` 文本外，无需要处理的命中。

### 结论
- **当前无需修改的 skills**：`browser-testing`、`frontend-design`、`mcp-builder`、`theme-factory`、`webapp-testing` 等所有现有 skills
- **当前需要继续关注的外部契约文档**：仍然是 `~/.gemini/antigravity/global_workflows/team-dispatch.md`，而不是 `skills/` 目录

## 任务：复核 `global_workflows` 中其余 runtime 绑定 workflow

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
对 `~/.gemini/antigravity/global_workflows/` 做了整目录的 runtime 契约复核，目标是确认除了 `team-dispatch.md` 之外，是否还有其他 workflow 仍直接绑定旧 Gateway / dispatch / run / project 语义：
1. **全目录 API / dispatch 检索完成**：按 `/api/*`、`templateId`、`stageId`、`projectId`、`runId`、`sourceRunIds`、`pipelineStageIndex`、`groupId` 等关键词扫描整个目录。
2. **结论明确**：当前直接绑定 Antigravity runtime 契约的 workflow，只有 `team-dispatch.md`。
3. **其余 workflow 无需修改**：剩下文件要么是通用技能说明，要么只是引用 `~/.gemini/antigravity/skills/.../SKILL.md` 的 skill 入口文案，不直接描述 Gateway API、dispatch payload 或 stage/source contract。
4. **因此本轮没有新增 workflow 改动**：上一轮已修好的 `team-dispatch.md` 仍是唯一需要收口的 runtime-bound workflow。

### 验证
- 运行时协议关键词扫描：
  - `rg -n "localhost:3000|/api/agent-runs|/api/projects|templateId|stageId|projectId|runId|sourceRunIds|pipelineStageIndex|groupId" ~/.gemini/antigravity/global_workflows`
  - 结果：只有 `team-dispatch.md` 命中。
- 运行时耦合语义扫描：
  - `rg -n "antigravity|gateway|Supervisor AI|Active Workspace|file:///|dispatch 到 Agent 运行时|多 Agent" ~/.gemini/antigravity/global_workflows`
  - 结果：除 `team-dispatch.md` 外，其余命中均为 skill 路径引用或通用说明，不包含 Gateway API 契约。
- 仓库静态检查：
  - `git diff --check`
  - 结果：通过。

### 结论
- **需要继续关注的 runtime workflow**：仅 `~/.gemini/antigravity/global_workflows/team-dispatch.md`
- **当前可维持现状的文件**：`frontend-design.md`、`mcp-builder.md`、`theme-factory.md`、`webapp-testing.md` 等其余 global workflows

## 任务：修正 `team-dispatch` workflow 到 `templateId + stageId`

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
对外部 workflow 文件 `~/.gemini/antigravity/global_workflows/team-dispatch.md` 做了终态收口，避免它继续向执行中的 AI 暴露已经失效的 Group 派发语义：
1. **模式说明更新**：将“模式 B — 单组派发”改为“模式 B — 单阶段派发”，明确单点派发现在基于 `templateId + stageId`。
2. **请求体更新**：单阶段派发示例从 `"groupId": "<groupId>"` 改为 `"templateId": "<templateId>"` + `"stageId": "<stageId>"`。
3. **阶段清单对齐真实模板**：表格改为 `Template ID / Stage ID / 用途 / 上游依赖`，并把过时的 `autonomous-dev` 修正为当前真实 stage `autonomous-dev-pilot`。
4. **入口说明收口**：全链模式改为“默认从入口 stage / entry node 启动”，单阶段模式则补充 `sourceContract.acceptedSourceStageIds` 约束说明。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `~/.gemini/antigravity/global_workflows/team-dispatch.md` | 去掉单组 / `groupId` 派发说明，改为 `templateId + stageId` 语义 |

### 测试与验证
- 旧语义残留检查：
  - `rg -n "groupId|单组派发|Group ID|\"groupId\"|acceptedSourceGroupIds|/api/agent-groups|dispatch-group" ~/.gemini/antigravity/global_workflows/team-dispatch.md`
  - 结果：无命中。
- 模板 stage 对齐检查：
  - `jq -r '.id + ": " + (if .pipeline then (.pipeline | map(.stageId) | join(", ")) else (.graphPipeline.nodes | map(.id) | join(", ")) end)' .agents/assets/templates/*.json`
  - 结果：已确认 `development-template-1` / `ux-driven-dev-template` 使用 `autonomous-dev-pilot`，并据此修正 workflow 示例。

### 额外说明
- 本次只修改了外部 workflow 引导文案，没有变更仓库内模板资产；`.agents/assets/templates/*.json` 仍保持此前验证通过的 inline-only / stage-centric 状态。

## 任务：复核 `global_workflows` 与 Template 资产的 Group 残留

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
对用户提到的 `~/.gemini/antigravity/global_workflows/` 与仓库内 `.agents/assets/templates/` 做了针对性复核，重点检查旧 `groupId`、`groups{}`、`dispatch-group`、`acceptedSourceGroupIds` 等残留：
1. **Global workflows 基本干净**：目录内大多数 markdown 只是通用技能说明或任务工作流说明，与当前 `templateId + stageId` 派发契约无关。
2. **唯一需要改的 workflow 是 `team-dispatch.md`**：该文件仍保留“模式 B — 单组派发”、`Group ID` 表头，以及向 `/api/agent-runs` 发送 `"groupId": "<groupId>"` 的旧请求体示例。
3. **`team-dispatch.md` 还有一处内容过时**：单阶段表示例里写了 `autonomous-dev`，但当前真实模板的 stageId 是 `autonomous-dev-pilot`。
4. **Template 资产已对齐终态**：`.agents/assets/templates/*.json` 中未发现 `groups{}`、`groupId`、`acceptedSourceGroupIds`、`dispatch-group` 或 `/api/agent-groups` 残留，仓库模板已是 inline-only / stage-centric。

### 复核结论
- **必须修改**：
  - `~/.gemini/antigravity/global_workflows/team-dispatch.md`
- **当前无需修改**：
  - `.agents/assets/templates/adhoc-universal.json`
  - `.agents/assets/templates/coding-basic-template.json`
  - `.agents/assets/templates/design-review-template.json`
  - `.agents/assets/templates/development-template-1.json`
  - `.agents/assets/templates/graph-smoke-template.json`
  - `.agents/assets/templates/large-project-template.json`
  - `.agents/assets/templates/template-factory.json`
  - `.agents/assets/templates/ux-driven-dev-template.json`
  - `.agents/assets/templates/v4-smoke-branch-template.json`
  - `.agents/assets/templates/v4-smoke-template.json`

### 验证
- 关键词筛查：
  - `rg -n "groupId|group id|groupIds|group-registry|dispatch-group|/api/agent-groups|acceptedSourceGroupIds|Group:" ~/.gemini/antigravity/global_workflows .agents/assets/templates`
  - 结果：只有 `team-dispatch.md` 命中旧 Group 语义。
- 模板残留检查：
  - `rg -n '"groups"|"groupId"|acceptedSourceGroupIds|dispatch-group|/api/agent-groups' .agents/assets/templates`
  - 结果：无命中。
- 模板迁移稳定性：
  - `npx tsx scripts/migrate-inline-templates.ts --check`
  - 结果：10 个模板全部 `unchanged`。

### 额外说明
- 本次是复核，没有直接修改 `~/.gemini/antigravity/global_workflows/team-dispatch.md`。如果需要，可以在下一步把它改成“单阶段派发 / `templateId + stageId`”版本。

## 任务：迁移 CLI 到 `templateId + stageId` 并同步内部说明

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
按最新要求，将 CLI 脚本与对应文档一起从 group-centric 语义迁移到 stage-centric 终态，避免出现“接口已变更，但 CLI 和指南还停留在 `groupId`”的割裂状态：
1. **CLI 派发入口迁移**：`scripts/ag.ts` 的 `dispatch` 改为 `dispatch <templateId> [--stage <stageId>]`，不再接受 `--template` 参数，也不再围绕 `groupId` 组织输入与输出。
2. **CLI 查询与展示收口**：`runs` 新增 `--stage` 过滤，`run` / `project` 输出统一展示 `Stage` 与 stage title，不再打印 `Group:` 或依赖 `groupId` 字段。
3. **CLI 指南同步**：`docs/guide/cli-guide.md` 的命令示例、参数表、返回示例和说明全部改成 `templateId + stageId` 语义。
4. **内部说明同步**：`docs/internals/agent-internals.md` 的 tracing / annotation 示例从 `antigravity.task.groupId` 改为 `antigravity.task.stageId`，并同步更新 runtime / normalizer 相关文件索引说明。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `scripts/ag.ts` | `dispatch` 改为 `dispatch <templateId> [--stage <stageId>]`；`runs` 支持 `--stage`；`run` / `project` 输出改成 Stage |
| `docs/guide/cli-guide.md` | 更新 CLI 示例、参数表、输出示例与说明，去掉 `dispatch <groupId>` / `Group:` |
| `docs/internals/agent-internals.md` | 将 `antigravity.task.groupId` 改为 `antigravity.task.stageId`，并刷新内部模块树说明 |

### 测试与验证
- CLI 帮助输出：
  - `npx tsx scripts/ag.ts help`
  - 结果：通过。帮助文本已显示 `dispatch <templateId>` 与 `--stage <stageId>`。
- 构建验证：
  - `npm run build`
  - 结果：通过。Next.js production build 完成；构建日志中 `RunRegistry` 明确按新规则跳过 legacy run，记录 `skippedLegacy: 30`。
- 静态检查：
  - `git diff --check`
  - 结果：通过。

### 额外说明
- `npm run build` 期间 `ProjectRegistry` 仍会同步 demo 项目状态，因此再次回写了若干 `demolong/projects/*/project.json`。这些是运行态样本数据刷新，不是代码回退。

## 任务：复核文档是否仍有 Group Elimination 残留

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 结论
本轮复核后，文档状态可以分成两类：
1. **主文档已基本对齐**：`docs/design/group-elimination-design.md`、`docs/guide/gateway-api.md`、`docs/guide/cli-api-reference.md`、`docs/guide/agent-user-guide.md`、`docs/guide/mcp-server.md`、`docs/guide/graph-pipeline-guide.md` 已经和当前 stage-centric / inline-only 实现一致。
2. **仍有少量文档残留，但要区分是否应立即修改**：
   - `docs/guide/cli-guide.md` 仍写 `dispatch <groupId>` 与 `Group:` 输出；不过这不是单纯文档落后，因为实际 CLI 脚本 `scripts/ag.ts` 目前也还保留同样的 group-centric 语义。这里应当是“CLI 实现 + 文档”一起迁移，而不是只改文档。
   - `docs/internals/agent-internals.md` 的注解示例仍写 `antigravity.task.groupId`，这份内部说明应更新为 `antigravity.task.stageId`。
   - `docs/template-vs-group-analysis.md`、`docs/user-journey-gaps.md`、`docs/internals/masfactory-integration-design.md` 等仍有大量 `groupId`，但它们属于历史分析 / backlog / 内部设计材料，不属于当前公共契约文档，暂不构成对外误导。

### 复核依据
- 通过全文检索 `groupId`、`dispatch-group`、`/api/agent-groups`、`groupId-only`、`acceptedSourceGroupIds` 等关键字核对 docs 与 `ARCHITECTURE.md`
- 额外核对 `scripts/ag.ts`，确认 CLI 指南中的 group 语义当前仍与脚本实现一致

### 建议
- **需要优先更新**：`docs/internals/agent-internals.md`
- **需要和代码一起更新**：`docs/guide/cli-guide.md` + `scripts/ag.ts`
- **可保留为历史材料**：`docs/template-vs-group-analysis.md`、`docs/user-journey-gaps.md`、legacy / internals 设计文档

---

## 任务：移除旧 run/project 状态 fallback

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
按用户最新决策，彻底放弃 pre-migration run/project 状态的兼容恢复，不再保留 `groupId`-only persisted state 的 best-effort 读取：
1. **运行态 fallback 移除**：`AgentRunState`、`PipelineStageProgress` 移除运行态 `groupId` 字段；`RunRegistry` / `ProjectRegistry` 不再从旧 persisted state 回填或读取 `groupId`，缺少 `stageId` / `pipelineStageId` 的旧 run 直接跳过，缺少 `stageId` 的旧 project stage 直接跳过。
2. **旧路径 fallback 移除**：不再读取 `data/agent_runs.json` / `data/projects.json` 这类 legacy 路径，当前仅认 gateway 的正式持久化路径。
3. **文档边界同步**：设计文档、Gateway API、CLI API、用户指南全部明确 `recover` 仅适用于当前 stage-centric persisted state；旧 `groupId`-only run/project 不再进入恢复流程。
4. **测试夹具收口**：更新 project diagnostics / reconciler / checkpoint / CEO / dag runtime 相关测试夹具，移除运行态 `groupId` 依赖。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `src/lib/agents/group-types.ts` | 删除 `AgentRunState.groupId` 运行态字段 |
| `src/lib/agents/project-types.ts` | 删除 `PipelineStageProgress.groupId`，保留 `title` 作为 stage-centric 展示字段 |
| `src/lib/agents/run-registry.ts` | 移除 legacy path fallback；加载时跳过无 `stageId/pipelineStageId` 的 persisted run |
| `src/lib/agents/project-registry.ts` | 移除 legacy path fallback；加载时跳过缺失 `stageId` 的 persisted project stage |
| `docs/design/group-elimination-design.md` | 改为 v2.1，明确旧 run/project fallback 已移除，仅保留模板加载期兼容 |
| `docs/guide/cli-api-reference.md` / `docs/guide/gateway-api.md` / `docs/guide/agent-user-guide.md` | 补充 `recover` 的迁移边界说明 |
| `src/lib/agents/project-diagnostics.test.ts` / `src/lib/agents/project-reconciler.test.ts` / `src/lib/agents/checkpoint-manager.test.ts` / `src/lib/agents/pipeline/dag-runtime.test.ts` / `src/lib/ceo-events.test.ts` / `src/lib/agents/ceo-agent.test.ts` | 清理运行态 `groupId` 夹具与断言依赖 |

### 测试与验证
- 构建验证：
  - `npm run build`
  - 结果：通过。构建阶段日志确认旧 persisted run 已按新规则跳过，`RunRegistry` 记录 `skippedLegacy: 30`。
- 相关测试：
  - `npx vitest run src/lib/agents/pipeline/dag-runtime.test.ts src/lib/agents/project-diagnostics.test.ts src/lib/agents/project-reconciler.test.ts src/lib/agents/checkpoint-manager.test.ts src/lib/ceo-events.test.ts src/lib/agents/ceo-agent.test.ts`
  - 结果：`6` 个测试文件全部通过，`108` 个测试全部通过。
- 静态检查：
  - `git diff --check`
  - 结果：通过。

### 额外说明
- `npm run build` 期间 `ProjectRegistry` 会继续同步 demo 项目状态，因此再次回写了若干 `demolong/projects/*/project.json`。这些是运行态样本数据更新，不是回退。
- 当前仓库中剩余的 `groupId` 仅用于模板加载期 normalize、模板编辑器兼容类型和历史模板测试，不再参与 run/project 恢复。

---

## 任务：落地 Group Elimination 终态迁移（inline-only / stage-centric）

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
按终态计划完成了 Group Elimination 的端到端收束，公共语义统一切到 `templateId + stageId`，模板持久化改成 inline-only：
1. **数据模型与运行时去 Group**：`TemplateDefinition.groups`、`PipelineStage.groupId`、`GraphPipelineNode.groupId` 不再作为公共 schema；loader 改为 normalize legacy 模板到 stage-inline；dispatch/runtime/sourceContract 全链路改为 `acceptedSourceStageIds` 与 `stageId`。
2. **公共接口与前端切到 stage-centric**：`/api/agent-runs`、scheduler、MCP、模板详情/列表、工作台、Deliverables、Stage Detail 等入口都改成 `templateId + stageId`；`/api/agent-groups` 与 scheduler `dispatch-group` 已删除。
3. **模板资产与 AI 生成链路迁移**：新增 `scripts/migrate-inline-templates.ts`，并将仓库 `.agents/assets/templates/*.json` 全量迁为 inline-only；pipeline generator / generation context / risk assessor / confirm route 全部改成直接生成和保存 stage-inline / node-inline 模板。
4. **文档同步**：更新 `ARCHITECTURE.md`、`docs/guide/gateway-api.md`、`docs/guide/cli-api-reference.md`、`docs/guide/agent-user-guide.md`、`docs/guide/mcp-server.md`、`docs/guide/graph-pipeline-guide.md`。

### 关键修改文件

| 文件 | 变更 |
|:-----|:-----|
| `src/lib/agents/group-types.ts` | 引入 stage-centric core types，运行态以 `stageId` 为主 |
| `src/lib/agents/pipeline/template-normalizer.ts` | 新增模板归一化，将 legacy `groups + groupId` 转为 inline stage/node config |
| `src/lib/agents/stage-resolver.ts` | 新增 template-scoped `stageId` 解析器 |
| `src/lib/agents/asset-loader.ts` | 删除全局 group 展平读取，统一走 normalized template load |
| `src/lib/agents/dispatch-service.ts` / `src/lib/agents/group-runtime.ts` | 派发与 runtime 统一按 `templateId + stageId` 解析、执行、自动触发 |
| `src/lib/agents/pipeline/*.ts` | DAG / graph compiler、IR、runtime、registry 统一消费 inline stage config |
| `src/app/api/agent-runs/route.ts` | POST / GET 去掉 `groupId` 公共入口和过滤，改为 `stageId` |
| `src/app/api/pipelines/[id]/route.ts` / `src/app/api/pipelines/route.ts` | 模板 API 返回 inline stage metadata，不再暴露 `groups{}` |
| `src/components/scheduler-panel.tsx` | 删除 `dispatch-group` UI，仅保留 `dispatch-pipeline` + optional `stageId` |
| `.agents/assets/templates/*.json` | 全量迁移为 inline-only persisted templates |
| `scripts/migrate-inline-templates.ts` | 新增正式模板迁移脚本 |

### 测试与验证
- 构建验证：
  - `npm run build`
  - 结果：通过。Next.js production build 完成，`/api/agent-groups` 路由已不再出现在构建产物中。
- 模板迁移验证：
  - `npx tsx scripts/migrate-inline-templates.ts --check`
  - 结果：10 个 repo 模板全部 `unchanged`，说明 inline-only 迁移结果稳定。
- 相关测试：
  - `npx vitest run src/lib/agents/pipeline/dag-runtime.test.ts src/lib/agents/pipeline/graph-compiler.test.ts src/lib/agents/pipeline-generator.test.ts 'src/app/api/pipelines/[id]/route.test.ts' 'src/app/api/pipelines/generate/[draftId]/confirm/route.test.ts' src/lib/agents/project-diagnostics.test.ts src/lib/agents/project-reconciler.test.ts src/lib/agents/scheduler.test.ts`
  - 结果：`8` 个测试文件全部通过，`149` 个测试全部通过。

---

## 任务：收尾 Group Elimination 文档与前端语义残留

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
继续对 Group Elimination 做收尾，不再停留在“完成度复核”，而是直接把残留的设计文档、前端命名和深层指南示例对齐到当前 stage-centric / inline-only 终态：
1. **设计文档改为终态说明**：`docs/design/group-elimination-design.md` 不再保留审核期的渐进式建议，而是明确记录当前已经生效的架构、兼容边界和剩余收尾项。
2. **前端语义收口**：模板浏览器、项目工作台、Stage/Node 编辑器和 FE 类型从 `Group/Profile` 语义切到 `Stage Config / templateStages`，删除未使用的 `template-group-card.tsx`。
3. **深层指南示例清扫**：`graph-pipeline-guide.md` 与 `agent-user-guide.md` 中关键 JSON 示例和 API 示例改为 inline stage/node execution config，不再用 `groupId` 作为主语义。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `docs/design/group-elimination-design.md` | 重写为 v2.0 终态说明文档，记录已落地能力、兼容边界与剩余收尾项 |
| `docs/guide/graph-pipeline-guide.md` | 将 GraphPipeline 节点示例改为 `executionMode + roles` inline 配置，更新必填字段说明 |
| `docs/guide/agent-user-guide.md` | 将关键 API / graph / fan-out / subgraph / shared conversation 示例改为 `templateId + stageId` / inline stage config |
| `src/lib/types.ts` | 新增 `TemplateStageConfigFE` 作为前端主类型，保留 `TemplateGroupDetailFE` 兼容 alias |
| `src/components/project-workbench.tsx` | `templateGroups` 改为 `templateStages`，Stage 标题解析语义收口 |
| `src/components/projects-panel.tsx` | 调整 `ProjectWorkbench` 入参命名 |
| `src/components/template-browser.tsx` | 将 UI 文案与内部变量从 Group/Profile 改为 Stage Config |
| `src/components/template-stage-editor.tsx` | 编辑面板语义改为 Stage Config |
| `src/components/template-node-editor.tsx` | 编辑面板语义改为 Stage Config |
| `src/components/template-group-card.tsx` | 删除未使用的旧 Group 组件 |
| `docs/PROJECT_PROGRESS.md` | 记录本次收尾修改与验证结果 |

### 验证结果
- 构建验证：
  - `npm run build`
  - 结果：通过。
- 回归测试：
  - `npx vitest run src/lib/agents/pipeline-generator.test.ts 'src/app/api/pipelines/generate/[draftId]/confirm/route.test.ts' 'src/app/api/pipelines/[id]/route.test.ts'`
  - 结果：`3` 个测试文件全部通过，`35` 个测试全部通过。
- 静态残留检查：
  - 对 `docs/design/group-elimination-design.md`、`docs/guide/graph-pipeline-guide.md`、`docs/guide/agent-user-guide.md` 以及模板编辑器相关组件执行 `rg` 检查
  - 结果：文档中的 `groupId` 仅剩迁移说明；代码中的 `groupId` 仅保留 deprecated alias / 兼容读取路径

### 额外说明
- `npm run build` 期间 `ProjectRegistry` 会加载并持久化 demo 项目状态，因此回写了若干 `demolong/projects/*/project.json`。这些是运行态样本数据更新，不是模板或业务逻辑回退。

---

## 任务：复核 Group Elimination 完成度与文档 / AI 生成链路状态

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
针对 `docs/design/group-elimination-design.md`、当前实现代码、相关文档以及自动生成 Pipeline / CEO 生成链路做了交叉复核，结论如下：
1. **实现完成度高于设计文档**：仓库当前代码已经落到 terminal stage-centric 终态，实际完成度超过设计文档 v1.1 中的渐进式建议。
2. **设计文档部分过时**：`group-elimination-design.md` 仍保留“先 deprecated `/api/agent-groups`、不要马上清零 `groupId`”等审核期建议，但代码里这些兼容层已经移除。
3. **主链路已切到 stage-centric，但内部仍有 legacy 兼容层**：`group-runtime.ts`、`dispatch-service.ts`、`run-registry.ts`、`project-registry.ts`、`scheduler-panel.tsx` 等仍保留 `groupId` dual-read / alias，用于旧 run/project 数据 best-effort 读取；模板编辑器与前端类型也还存在 `TemplateGroup*` / `GroupCard` 命名与结构。
4. **相关文档已做主说明更新，但还没有彻底清扫**：架构、Gateway API、CLI API、用户指南、MCP、Graph Pipeline 指南都已补充 stage-centric / inline-only 说明，但深层示例和历史章节里仍残留较多 `groupId` 老例子。
5. **自动生成 Pipeline 已更新**：AI 生成上下文、生成 prompt/schema、风险分析、confirm/save draft 全链路都已切到 inline stage/node config。
6. **CEO 路径已联动更新**：CEO 相关前端入口、模板摘要和派发调用已经改为 `templateId + stageId`，不再依赖 public `groupId` 语义。

### 关键核对点

| 范围 | 结论 | 证据文件 |
|:-----|:-----|:---------|
| 模板与运行时 | 已完成 inline-only + stage-centric | `src/lib/agents/pipeline/template-normalizer.ts`、`src/lib/agents/stage-resolver.ts`、`src/lib/agents/asset-loader.ts`、`src/lib/agents/dispatch-service.ts`、`src/lib/agents/group-runtime.ts` |
| Public API / Scheduler | 已去掉 public `groupId` 与 `dispatch-group` | `src/app/api/agent-runs/route.ts`、`src/components/scheduler-panel.tsx` |
| 模板资产 | 已迁移为 inline-only persisted templates | `.agents/assets/templates/*.json`、`scripts/migrate-inline-templates.ts` |
| AI 生成 Pipeline | 已按 stage/node inline config 更新 | `src/lib/agents/generation-context.ts`、`src/lib/agents/pipeline-generator.ts`、`src/lib/agents/risk-assessor.ts`、`src/app/api/pipelines/generate/[draftId]/confirm/route.ts` |
| CEO 链路 | 已使用 stage-centric 摘要与派发 | `src/lib/agents/ceo-prompts.ts`、`src/components/projects-panel.tsx`、`src/app/page.tsx` |
| 前端 / FE 类型残留 | 仍保留 Group 命名与兼容结构，未彻底收尾 | `src/components/template-browser.tsx`、`src/components/template-group-card.tsx`、`src/components/project-workbench.tsx`、`src/lib/types.ts` |
| 文档同步 | 已做主文档同步，但设计审核文档与深层示例仍落后于实现 | `ARCHITECTURE.md`、`docs/guide/gateway-api.md`、`docs/guide/cli-api-reference.md`、`docs/guide/agent-user-guide.md`、`docs/guide/mcp-server.md`、`docs/guide/graph-pipeline-guide.md` |

### 验证依据
- 构建验证：
  - `npm run build`
  - 结果：通过。
- 模板迁移验证：
  - `npx tsx scripts/migrate-inline-templates.ts --check`
  - 结果：10 个模板全部稳定，无需额外回写。
- 测试验证：
  - `npx vitest run src/lib/agents/pipeline/dag-runtime.test.ts src/lib/agents/pipeline/graph-compiler.test.ts src/lib/agents/pipeline-generator.test.ts 'src/app/api/pipelines/[id]/route.test.ts' 'src/app/api/pipelines/generate/[draftId]/confirm/route.test.ts' src/lib/agents/project-diagnostics.test.ts src/lib/agents/project-reconciler.test.ts src/lib/agents/scheduler.test.ts`
  - 结果：`8` 个测试文件全部通过，`149` 个测试全部通过。

### 结论
- `docs/design/group-elimination-design.md` 现在更像是“审核期的历史计划”，不是仓库当前真实状态的终态说明。
- 对外主链路已经切到 stage-centric，功能上基本完成；但严格按“彻底移除 Group 语义”衡量，还没有完全收尾。
- 相关对外文档已经补充 stage-centric 说明，但深层内容尚未完全完成历史术语清扫。
- 自动生成 Pipeline 和 CEO 驱动的流水线生成 / 确认链路已经同步更新，不再依赖旧的 `groupId/groups{}` 公共语义。

---

## 任务：审核并修订 Group Elimination 设计方案

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
基于当前代码实况，对 `docs/design/group-elimination-design.md` 做了完整审核和重写修订。重点结论：
1. 当前真正需要先消除的是 **全局 Group registry**，而不是第一步就粗暴删除所有 `groupId/groups{}`。
2. 原方案低估了 runtime、DAG/graph、AI 生成链路、API、MCP 和前端模板编辑器的联动影响。
3. 新方案调整为 **“template-scoped resolver → runtime normalized config → API/前端兼容层 → AI 生成改造 → 数据迁移清理”** 的渐进式迁移计划。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `docs/design/group-elimination-design.md` | 按代码审阅结果重写为 v1.1 审核修订版，补齐真实影响面、修正错误假设、改写迁移阶段 |
| `docs/PROJECT_PROGRESS.md` | 记录本次设计审核、文档修订与测试结果 |

### 审阅覆盖
- 核心类型与加载：`pipeline-types.ts`、`group-types.ts`、`group-registry.ts`、`asset-loader.ts`
- 运行时与编排：`dispatch-service.ts`、`group-runtime.ts`、`run-registry.ts`、`project-registry.ts`、`project-diagnostics.ts`、`scheduler.ts`
- DAG / graph / 编译：`dag-runtime.ts`、`graph-compiler.ts`、`dag-compiler.ts`、`graph-pipeline-types.ts`
- AI 生成链路：`pipeline-generator.ts`、`generation-context.ts`、`risk-assessor.ts`、`pipelines/generate/[draftId]/confirm/route.ts`
- API / MCP / 前端：`/api/pipelines*`、`/api/agent-runs`、`src/mcp/server.ts`、`template-browser.tsx`、`project-workbench.tsx`、`stage-detail-panel.tsx`、`scheduler-panel.tsx`

### 测试结果
- 运行命令：
  `npx vitest run src/lib/agents/pipeline/dag-runtime.test.ts src/lib/agents/pipeline/graph-compiler.test.ts src/lib/agents/pipeline-generator.test.ts 'src/app/api/pipelines/[id]/route.test.ts' 'src/app/api/pipelines/generate/[draftId]/confirm/route.test.ts' src/lib/agents/project-diagnostics.test.ts src/lib/agents/project-reconciler.test.ts`
- 结果：`7` 个测试文件全部通过，`146` 个测试全部通过。
- 用时：`453ms`

---

## 任务：计算 1+10 并打印结果

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
编写 Python 脚本计算 1+10 的结果并打印到控制台。

### 修改文件

| 文件 | 变更 |
|:-----|:-----|
| `/tmp/calculate_1_plus_10.py` | 新增脚本文件（临时） |

### 测试结果
- 运行 `python3 -c "print(1 + 10)"` 输出结果为 `11`。
- 脚本验证通过。

---

## Phase 6.1: CEO 决策持久化 + 项目详情展示
... (preserved original content)

---

## Phase 6.2: CEO 面板显示逻辑修复与项目详情布局调整

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
修复了 CEO 决策信息在项目列表中的显示范围，以及 `ProjectWorkbench` 中 Tabs 的排版布局：
1. **CEO 面板显示限制**：将 CEO Decision Card 仅显示在项目展开后的详情区域中，列表态不显示。同时修复了无 Pipeline 状态下 CEO 面板数据为空无法读取的 Bug，引入了根据 `viewProject.ceoDecision` 缓存数据的后备展现。
2. **Tabs 布局修复**：修复了 Base UI 与 Tailwind 冲突导致的横向（并排）挤压问题。将 `data-horizontal` 修改为 `data-[orientation=horizontal]` 使 Tabs 恢复正常的纵向上（Tab Bar）中下（内容）堆叠样式。

### 修改文件
| 文件 | 变更 |
|:-----|:-----|
| `src/components/projects-panel.tsx` | 添加了仅在选中/展开卡片状态下的 CEO Decision Card 构建模块。修复 no-pipeline panel 根据 `ceoDecision` 回调数据显示提案的问题 |
| `src/components/ui/tabs.tsx` | 重写所有 `data-horizontal` 与 `data-vertical` 的选择器为 `data-[orientation=...]`，修复样式不匹配问题 |

---

## Phase 6.3: AI CEO 接入 Provider 架构与全局独立工作区

**状态**: ✅ 已完成
**日期**: 2026-04-06

### 概要
彻底移除了 `callLLMOneshot` 对底层 `grpc` 的硬编码耦合，将其正式接入系统的 `Provider` 抽象层。解决 CEO Agent 模型无法配置、运行时处于 `file:///tmp` 无法累积知识的问题。
1. **全局 CEO 工作区**：在 `~/.gemini/antigravity/ceo-workspace` 创建持久化目录，供 CEO 级大模型查询和记录决策上下文（上帝视角）。
2. **Provider 架构重构**：`llm-oneshot` 目前会自动采用 `executive` 阶层（Layer）读取由于 `codex`, `openai-api` 等设定的外部 Provider。若是原生 provider（`antigravity`）保留异步轮询，外部 provider 启用同步 `executeTask`。

### 修改文件
| 文件 | 变更 |
|:-----|:-----|
| `src/lib/agents/llm-oneshot.ts` | 引入 `resolveProvider` 和 `getExecutor`。增加 `getCEOWorkspacePath` 管理独立空间，支持并根据 Provider 的能力走分发逻辑 |
| `task.md` | 创建与标记 CEO 独立工作区的执行计划清单 |
