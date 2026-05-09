---
description: 平台工程部每日从真实 User Story 中提炼全局 Top 3 的待立项候选。
trigger: always_on
runtimeProfile: story-top-candidates
---

# 平台工程部 Story Top 3 候选提炼

你的任务只有一件事：在当前 workspace 中直接读取 `User Story/**/*.md`，找到所有 `- [不支持]` 的故事行，并从全局范围内挑出 **最值得立项的 3 条**。

## 工作边界

- 只读取真实 `User Story/**/*.md` 文件，不要依赖外部摘要或手工清单
- 不要修改仓库业务代码
- 只允许在本次 run 的 artifact 目录中写文件
- 每条候选必须是 **story-level**，不是文件级聚合

## 选题原则

优先保留：

1. 影响核心治理或核心工作流的缺口
2. 影响 CEO / Projects / Ops / Settings 主路径的缺口
3. 能明显打通现有闭环、减少人工步骤、提升可用性的缺口

避免选择：

- 纯文案润色
- 低影响、边缘、重复的故事
- 只是同一问题的轻微变体

## 输出要求

必须在 artifact 根目录写出一个 `story-top-candidates.json` 文件。

内容必须是一个严格 JSON 数组，最多 3 条，每条字段如下：

```json
[
  {
    "storyKey": "stable-key-if-possible",
    "sourcePath": "User Story/Settings/个人偏好.md",
    "storyText": "作为用户，我希望……",
    "title": "系统改进：……",
    "summary": "用 1-2 句话说清现在缺什么，为什么值得立项。",
    "expectedOutcome": "落地后业务上会得到什么结果。",
    "severity": "low|medium|high|critical",
    "rationale": "为什么它进入全局 Top 3，而不是别的故事。",
    "affectedAreas": ["frontend", "runtime"]
  }
]
```

## 严格约束

- 只输出 **全局 Top 3**
- `sourcePath` 必须是仓库内真实存在的 `User Story` 文件相对路径
- `storyText` 必须来自真实 `[不支持]` 行，不允许改写成另一条故事
- `title` / `summary` / `expectedOutcome` / `rationale` 可以归纳，但必须忠于原故事
- `affectedAreas` 可选；如提供，必须只使用：
  - `frontend`
  - `api`
  - `runtime`
  - `scheduler`
  - `provider`
  - `knowledge`
  - `approval`
  - `database`
  - `docs`

## 最终回复

- 先完成文件写入
- 再在最终回复里返回同一份 JSON 的 ```json fenced block
- 不要输出额外说明文字
