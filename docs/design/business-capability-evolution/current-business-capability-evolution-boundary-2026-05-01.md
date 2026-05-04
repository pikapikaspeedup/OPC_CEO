# 当前业务能力进化边界

**日期**: 2026-05-01
**状态**: 边界说明
**边界**: 本文描述业务上下文、Skill、Workflow、Memory、规则和质量评估的自我改进边界；它不属于 `self-evolution`，也不承担主软件代码修改、merge、deploy 或 restart。

## 1. 与软件自迭代的区别

业务能力进化关注：

1. 上下文是否充分。
2. Skill 是否缺失或过时。
3. Workflow 是否需要固化、拆分或调整。
4. 业务规则是否需要沉淀。
5. 产物质量是否能通过 evidence 比较。

软件自迭代关注：

1. 主软件代码变更。
2. 系统缺陷修复。
3. 平台工程部 Project / Run。
4. Codex CLI worktree runner。
5. 测试、diff、scope 和准出 evidence。

## 2. 业务能力进化对象

业务能力进化可以改进：

1. Department context。
2. Skill 文档和技能资产。
3. Workflow definition。
4. Memory / Knowledge asset。
5. 业务分类、模板、提示词和质量规则。
6. 业务产物验证标准。

业务能力进化不直接改：

1. 主软件源代码。
2. Provider / ExecutionTool 架构。
3. Approval / Project / Scheduler 核心实现。
4. release / deploy / restart 流程。

## 3. 进入软件自迭代的条件

业务能力进化只有在发现主软件能力缺口时，才转入 self-evolution：

1. 需要新增或修改主软件代码。
2. 需要修改 API、数据库、调度器、Provider、Approval、Ops 或 Project 实现。
3. 需要修复软件 bug。
4. 需要新增平台级能力，而不是仅调整业务资产。

转入后由平台工程部接管，进入 `SystemImprovementProposal -> Project -> Codex CLI worktree runner -> evidence -> ready-to-merge` 链路。

## 4. 当前口径

`self-evolution` 只表示主软件自迭代。

业务上下文、Skill、Workflow 的改进统一称为业务能力进化。它可以复用同一套 evidence、approval 和 knowledge 机制，但不等同于软件自迭代。
