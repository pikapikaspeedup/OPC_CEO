# 快速项目结果可检视性修复（2026-04-17）

## 背景

用户进一步明确：

- 当前快速项目详情页的核心问题不是“样式不好看”
- 而是看不到实际结果，因此无法判断任务是否真正完成

这说明页面缺的不是更多状态标签，而是：

1. 结果入口
2. 完成证据
3. 验证摘要
4. 产物可追溯信息

## 根因

当前后端其实已经为 prompt run 保存了：

- `result`
- `resultEnvelope`
- `artifactManifestPath`
- `resolvedWorkflowRef`
- `reportedEventDate`
- `reportedEventCount`
- `verificationPassed`

但在快速项目详情页里，这些数据只被压缩成：

- 一条 `Prompt Runs` 卡片
- 一段摘要文案

用户看不到：

- 具体产物数量
- 命中的 workflow
- 是否通过验证
- 可以进一步点进去检查的结果面板

## 本次修改

### 1. Prompt-only 项目不再只显示 `0/0 pipeline`

修改：

- `src/components/project-workbench.tsx`

行为：

- 若项目没有 pipeline stage，但存在 standalone prompt runs
- 页面顶部改为显示 `Prompt-Only Project`
- 直接告诉用户：
  - 这是 prompt 直接产出的项目
  - 下方 run 可直接检查结果、产物、workflow 和验证字段

### 2. Prompt Run 卡片变成可检视入口

修改：

- `src/components/prompt-runs-section.tsx`

行为：

- prompt run 支持选中
- 当前选中态有高亮
- 卡片直接显示：
  - `result status`
  - artifact 数量
  - `resolvedWorkflowRef`
  - `reportedEventCount`
  - `verificationPassed`

不再只有一段摘要文本。

### 3. 快速项目默认打开最新 Prompt Run 的详情

修改：

- `src/components/project-workbench.tsx`

行为：

- 对于 prompt-only quick project
- 默认选中最新的 standalone prompt run
- 用户一进页面就能看到右侧详情

不需要自己再猜“应该点哪里看结果”。

### 4. 右侧详情面板补齐“完成证据”

修改：

- `src/components/agent-run-detail.tsx`

新增侧栏信息：

- `Run Status`
- `Result Status`
- `Workflow`
- `Artifacts`
- `Verification`
- `Resolution Reason`
- `Output Artifacts`
- `Traceable Paths`

并支持在 project 场景下直接触发：

- `AI Diagnose`

### 5. Prompt Run 详情支持显示 streaming 结果

修改：

- `src/components/agent-run-detail.tsx`

行为：

- 当 run 仍在执行中时
- `result` tab 可以直接显示流式文本
- 减少“明明在跑，但右侧像空白”的观感

## 用户可见效果

修复后，用户进入 quick project 时，可以直接回答这几个问题：

1. 这是 pipeline 项目，还是 prompt-only 项目
2. 当前 run 是什么状态
3. 产出了几个 artifacts
4. 命中了哪个 workflow
5. 是否存在验证字段，是否通过验证
6. 结果可以去哪里继续查看

## 验证

### 通过

- `npx eslint src/components/project-workbench.tsx src/components/prompt-runs-section.tsx src/components/agent-run-detail.tsx` ✅

### 未完成但已定位

尝试执行：

- `npm run build`

构建未能完全结束，原因是仓库内已存在与本次 UI 改动无关的 TypeScript 问题：

1. `src/lib/agents/canonical-assets.ts`
2. `src/lib/agents/department-capability-registry.ts`

说明：

- 这两个报错不在本次修改文件中
- 本次 UI 改动对应文件已通过 eslint
- 需要后续单独做一次仓库级 TS 清理，才能拿到完整 build 通过

## 结论

这次修复的重点不是“换视觉风格”，而是把原本已经存在于 run 数据里的：

- 结果
- 验证
- 产物
- 路由原因

真正变成用户能在 quick project 页面里直接检视的完成证据。
