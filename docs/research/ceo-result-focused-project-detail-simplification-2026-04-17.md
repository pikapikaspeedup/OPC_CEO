# CEO 结果检查视角的项目详情页收缩（2026-04-17）

## 背景

用户进一步明确：

- `Prompt-Only Execution` 这类解释性提示完全不需要
- 当前详情页默认暴露了过多技术信息
- 作为 CEO，用户只想先检查结果是否有问题
- 如果结果没有问题，不关心 provider / workflow / model / trace

这说明当前页面的目标不应是：

- “把系统执行细节尽量显示出来”

而应改成：

- “先让 CEO 快速判断结果是否正常，再决定是否下钻技术细节”

## 本次收缩原则

### 1. 删除无意义的解释卡

移除：

- `Prompt-Only Execution`

原因：

- 它不提供结果
- 不提供动作
- 只是在解释系统结构
- 与下方 `Prompt Runs` 卡重复表达同一事实

### 1.1 单 run 不再保留左侧大卡

进一步收口：

- 当 quick project 只有 1 条 prompt run 时
- 左侧不再显示独立 run 卡片
- 直接把右侧结果详情作为主视图

只有当存在多条 run 时，左侧才显示：

- 一条窄时间轴 / run history

而不是继续用大卡片重复讲同一条记录。

### 2. 默认隐藏技术实现标签

对 CEO 默认隐藏：

- provider
- model
- workspace
- workflow
- token usage
- trace / envelope 等技术 tab

保留：

- 当前状态
- 校验是否通过
- 执行时间
- 结果摘要
- 交付物
- 是否存在关注项

### 3. 技术信息改成按需展开

在 run 详情页中加入：

- `技术细节（按需查看）`

只有用户主动展开时才显示：

- provider
- workflow
- artifactManifestPath
- reportApiResponse

## 主要修改

### 1. `src/components/project-workbench.tsx`

结果：

- 删除 prompt-only explanation card
- prompt-only 项目直接进入 `Prompt Runs` 列表
- 右侧 run 详情使用 `executiveMode`

### 2. `src/components/prompt-runs-section.tsx`

结果：

- 单 run 场景不再默认占据左侧主区域
- 多 run 场景改为紧凑时间轴
- 去掉：
  - `Prompt`
  - `resolvedWorkflowRef`
  - `Inspecting`
  - `Result · completed`
- 保留更接近业务检查的信息：
  - 时间
  - 耗时
  - deliverables 数
  - verified items
  - verification 状态

### 3. `src/components/agent-run-detail.tsx`

结果：

- 新增 `executiveMode`
- CEO 视图下只显示：
  - 状态
  - 校验
  - 时间
  - 耗时
- 隐藏：
  - provider
  - workspace
  - model
  - prompt executor 标签
  - token usage
  - envelope / trace / chat tab
- `AI Diagnose` 仅在有关注项时保留

### 4. `src/components/projects-panel.tsx`

结果：

- 顶部结果卡改成更偏业务语言：
  - `最近执行`
  - `结果概览`
  - `交付物`
  - `关注项`
- 删除 `Execution Route` 这类技术导向卡
- Department summary 默认不再显示 provider / workflow-bound / fallback refs

## 用户可见效果

### 修复后，CEO 首屏优先看到

1. 最近执行是否完成
2. 结果摘要
3. 交付物数量
4. 是否有关注项
5. 校验是否通过

并且：

- 单 run 时不再出现“左边一大张、右边再一大张”的重复卡片
- 多 run 时左侧只保留窄时间轴供切换

### 不再默认看到

1. `Prompt-Only Execution`
2. `provider`
3. `workflow`
4. `model`
5. `workspace`
6. `trace / envelope`

只有主动展开技术细节时才看这些内容。

## 验证

- `npx eslint src/components/project-workbench.tsx src/components/prompt-runs-section.tsx src/components/agent-run-detail.tsx src/components/projects-panel.tsx src/components/deliverables-panel.tsx src/lib/agents/run-artifacts.ts src/lib/i18n/messages/zh.ts src/lib/i18n/messages/en.ts` ✅

## 结论

这次不是继续“加更多信息”，而是把项目详情页从：

- 技术执行台

收成：

- CEO 结果检查页

技术细节仍然可追溯，但不再默认打到用户脸上。
