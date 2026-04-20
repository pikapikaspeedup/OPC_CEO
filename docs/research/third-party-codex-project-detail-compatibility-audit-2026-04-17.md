# 第三方 Codex 项目详情链路兼容性审计（2026-04-17）

## 审计目标

围绕当前快速项目详情页，核对：

1. 当前页面涉及到的每个主要页面/面板
2. 当前页面依赖的关键接口
3. 显示内容对第三方 Codex，尤其 `native-codex` / `codex` 的支持是否存在断点

说明：

- 本次范围聚焦“项目详情链路”
- 不做全站所有页面穷举
- 重点检查当前详情页真实会经过的 UI 和 API

## 审计结论概览

### 已确认正常

1. `Settings Panel / Provider 配置`
   - `native-codex` / `codex` 在 provider inventory 中有独立状态展示
2. `Department Setup Dialog`
   - 可配置 `codex` / `native-codex`
3. `Quick Task Input`
   - 可显式选择 `Codex` / `Codex Native`
4. `POST /api/agent-runs`
   - prompt/template 两条路径都支持 provider 侧运行
5. `GET /api/agent-runs/:id`
   - run 对象已包含 `provider / resolvedWorkflowRef / verificationPassed / reportedEventCount / resultEnvelope`

### 本次发现并已修复

1. `native-codex` prompt-only run 的 `outputArtifacts` 为空
2. 左侧 prompt-only summary card 与 Prompt Runs card 重复表达，语义不清
3. `Deliverables` 页只依赖手工 deliverable，prompt-only / 第三方 Codex 产物默认不可见
4. `agent.evaluate` 缺少 i18n 文案，UI 会显示裸 key

### 仍存在的已知余留问题

1. `npm run build` 仍被仓库内既有 TypeScript 问题拦住
   - `src/lib/agents/canonical-assets.ts`
2. `/api/projects/[id]/deliverables`
   - 仍然是内存态、手工录入 deliverable
   - 本次通过前端 fallback 让 run artifacts 可见，但接口层尚未正式持久化这些产物

## 页面 / 面板审计

### 1. `ProjectsPanel` 详情头部

#### 修复前

- 部门说明占比过大
- 对第三方 Codex run 的“结果证据”表达不够靠前

#### 修复后

- 首屏先展示：
  - Latest Run
  - Execution Route
  - Output Evidence
  - Verification
- 部门上下文降级为可折叠区

#### 结论

- 对第三方 Codex 的 provider / workflow / verification 展示已可用
- 页面语义已从“上下文优先”改成“结果优先”

### 2. `ProjectWorkbench`

#### 修复前

- prompt-only 项目会出现一张大卡说明“Prompt-Only Project”
- 下面又再出现 Prompt Runs 卡片
- 两块内容重复，用户不清楚它们的区别

#### 修复后

- 保留轻量级提示条
- 主要信息集中在 Prompt Runs 列表与右侧详情面板

#### 结论

- 左侧重复语义已明显下降
- 详情页主检视入口仍然是 Prompt Run 本身

### 3. `PromptRunsSection`

#### 修复前

- 只显示摘要和少量标签
- 无法可靠反映第三方 Codex 产物数量
- artifact 数量来源于空 manifest，显示为 `0`

#### 修复后

- 卡片支持选中
- 直接展示：
  - `resolvedWorkflowRef`
  - `result status`
  - artifact 数量
  - verified items
  - verification 状态

#### 结论

- 第三方 Codex 的 run 证据现在可以直接看出来

### 4. `AgentRunDetail`

#### 修复前

- `outputArtifacts` 因 manifest 为空而显示不可信
- `agent.evaluate` 会显示成裸 key

#### 修复后

- 增加 `Completion Evidence`
- `Output Artifacts`
- `Traceable Paths`
- 补齐 `AI Diagnose` 文案

#### 结论

- 第三方 Codex 的结果、验证、产物路径现在能在右侧详情中完整检视

### 5. `DeliverablesPanel`

#### 修复前

- 只显示手工 deliverable
- prompt-only / `native-codex` 结果即使已存在，也可能整页空白

#### 修复后

- 新增 `Run Artifacts` 区
- 自动从项目 run 的 `resultEnvelope.outputArtifacts` 提取产物
- 明确标注这是自动提取，适用于 prompt-only / 第三方 Codex 场景

#### 结论

- 当前详情页里的 Deliverables 视图已不再“对 Codex 看起来像没产物”

## 接口审计

### 1. `GET /api/agent-runs/:id`

状态：

- 正常

原因：

- 已返回第三方 Codex 展示所需关键字段：
  - `provider`
  - `resolvedWorkflowRef`
  - `resultEnvelope`
  - `artifactManifestPath`
  - `reportedEventDate`
  - `reportedEventCount`
  - `verificationPassed`

### 2. `GET /api/projects/:id`

状态：

- 基本正常

原因：

- 返回项目本体 + `runs`
- 当前详情页主要使用全局 `agentRuns`，但接口本身已具备项目回读能力

### 3. `POST /api/agent-runs`

状态：

- 基本正常

原因：

- prompt/template 分流明确
- provider 最终在服务端解析，不要求前端强绑 provider
- 对第三方 Codex 路径没有明显缺字段问题

### 4. `GET /api/projects/[id]/deliverables`

状态：

- 有结构性缺口

问题：

- 只返回手工 deliverables
- 不会自动把第三方 Codex run 产物纳入 deliverable registry

当前处置：

- 本次通过 `DeliverablesPanel` 前端 fallback 补可见性

## 本次核心修复

### 1. 修复第三方 Codex artifact manifest

修改：

- `src/lib/agents/run-artifacts.ts`
- `src/lib/agents/run-artifacts.test.ts`

行为：

- 对 `executionTarget.kind === 'prompt'` 的 run
- 补扫 artifact 根目录
- 忽略：
  - `task-envelope.json`
  - `result.json`
  - `result-envelope.json`
  - `artifacts.manifest.json`

真实样本验证：

- `e06490c0-15ce-4faa-8bc3-b08eccc180fa`
- 现在可扫描出 `5` 个真实业务产物

### 2. 收掉左侧重复卡片

修改：

- `src/components/project-workbench.tsx`

行为：

- 大块 prompt-only summary card 改成轻量提示条
- 不再和下方 Prompt Runs 列表重复讲同一件事

### 3. Deliverables 对第三方 Codex 可见

修改：

- `src/components/deliverables-panel.tsx`
- `src/components/project-workbench.tsx`

行为：

- 直接回读项目 run 的 `outputArtifacts`
- 即使没有手工 deliverable，也能看到 run 产物

### 4. 补齐 i18n 缺口

修改：

- `src/lib/i18n/messages/zh.ts`
- `src/lib/i18n/messages/en.ts`

结果：

- `agent.evaluate` 不再显示成裸 key

## 验证

### 通过

- `npx eslint src/lib/agents/run-artifacts.ts src/lib/i18n/messages/zh.ts src/lib/i18n/messages/en.ts src/components/project-workbench.tsx src/components/prompt-runs-section.tsx src/components/agent-run-detail.tsx src/components/deliverables-panel.tsx src/components/projects-panel.tsx` ✅
- `npx vitest run src/lib/agents/run-artifacts.test.ts` ✅
- 真实样本重扫：
  - `e06490c0-15ce-4faa-8bc3-b08eccc180fa`
  - `artifact count = 5` ✅

### 未完成

- `npm run build`
  - 仍被仓库内既有 `canonical-assets.ts` 类型问题拦住

## 结论

当前“项目详情链路”对于第三方 Codex 的核心断点，已经从：

- 数据有，但显示不出来

修到：

- 结果、验证、产物、workflow 都可以在页面内被正确检视

剩余问题主要在：

- deliverables 接口层未正式持久化 run artifacts
- 仓库级 TypeScript build blocker 仍待单独清理
