# 快速项目详情页版式重构（2026-04-17）

## 背景

用户明确指出：

- 详情页里“部门介绍 / 能力说明”占比过大
- 设计原则有问题

这说明当前问题已经不只是信息缺失，而是：

- 首屏阅读顺序本身错了

用户进入项目详情页时，真正优先级应该是：

1. 这件事现在完成了吗
2. 结果在哪
3. 证据是什么
4. 如需解释，再看部门上下文

而不是一上来先看：

- Department
- Skills
- WorkflowRef
- SkillRefs

## 设计原则调整

本次基于 `ui-ux-pro-max` 的 dashboard / result-first 思路，做了三条版式收口：

### 1. 首屏结果优先

详情页头部在项目标题下面新增结果摘要卡，优先展示：

- Latest Run
- Execution Route
- Output Evidence
- Verification

让用户先回答：

- 是否完成
- 命中了哪个 workflow
- 有多少 artifacts
- 验证是否通过

### 2. 部门上下文降级为二级信息

原本大块的 Department 区改成：

- `Execution Context` 概览条
- `查看部门上下文` 折叠入口

默认只展示：

- 部门名
- 类型
- provider
- skills 数量
- workflow-bound 数量
- fallback refs 数量
- description 的短摘要

只有用户主动展开时，才显示：

- OKR snapshot
- SkillBrowser

### 3. 让“为什么这样执行”晚于“执行出了什么”

重构后的阅读路径是：

1. Project header
2. Result / verification cards
3. Department context summary
4. 可选展开的 Department detail
5. 下方 workbench / prompt run detail

这比此前“部门说明卡 → SkillBrowser → 后面才是执行内容”的顺序更符合项目详情页的用户心智。

## 代码修改

主要修改：

- `src/components/projects-panel.tsx`

配合此前已完成的：

- `src/components/project-workbench.tsx`
- `src/components/prompt-runs-section.tsx`
- `src/components/agent-run-detail.tsx`

整体效果是：

- 顶部版式先交付结果
- 中部 workbench 负责查看执行
- 部门能力说明退到辅助上下文层

## 用户可见变化

### 修复前

用户进入详情页时会先看到：

- 大块 Department 区
- OKR
- SkillBrowser

造成：

- 首屏被“背景信息”吃掉
- 项目结果要继续往下找

### 修复后

用户进入详情页时先看到：

- 项目标题和状态
- run / workflow / artifact / verification 四个结果卡
- 简短的 Execution Context 条

如果需要再主动展开部门细节。

## 验证

### 通过

- `npx eslint src/components/projects-panel.tsx src/components/project-workbench.tsx src/components/prompt-runs-section.tsx src/components/agent-run-detail.tsx` ✅

### 仍存在的仓库级问题

尝试执行：

- `npm run build`

仍被仓库内既有 TypeScript 问题拦住：

- `src/lib/agents/canonical-assets.ts`

说明：

- 本次详情页重构本身没有新的 eslint 错误
- build blocker 不是本次版式修改引入的

## 结论

这次修改的核心不是“把 Department 卡缩小一点”，而是把详情页从：

- `上下文优先`

改成：

- `结果优先，上下文按需展开`

这是项目详情页更合理的设计原则。
