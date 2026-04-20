# OPC 循环任务可视化审计与优化（2026-04-18）

## 背景

用户继续追问：

- 循环执行的任务在 OPC 里是否能看到
- 如果能看到，入口到底在哪里
- 当前与循环有关的可视化有哪些不足

因此本轮不再验证调度后端正确性，而是专门审计：

- `OPC / Projects`
- `CEO Dashboard`
- `Operations / SchedulerPanel`

对 interval / loop job 的可见性。

## 审计前现状

### 1. OPC 主工作台几乎看不到“循环任务本体”

`ProjectsPanel` 只展示：

- Project
- Run
- Project Detail

也就是说，用户能看到“被循环任务触发出来的项目/运行”，但看不到：

- 这条循环任务本身是否存在
- 它多久跑一次
- 下一次什么时候跑
- 最近跑成了还是 blocked / failed

### 2. CEO Dashboard 有 Scheduler 摘要，但表达仍偏弱

`ceo-dashboard.tsx` 已有 Scheduler 卡片，但它更像：

- recent jobs
- recent activity

对 interval / loop 的可读性不足，尤其缺少：

- “这是一条循环任务”的强语义
- 人类可读 cadence（例如“每 5 秒”）

### 3. SchedulerPanel 对 interval 的表达太原始

`scheduler-panel.tsx` 原本主要问题：

- 只显示原始 `type = interval`
- 表单里没有 `dispatch-prompt`
- 对 `promptAssetRefs / skillHints` 没有可视入口
- 行内信息是平铺文本，循环任务和 cron / once 混在一起

## 本次优化

### 1. OPC 主工作台新增“循环任务”可视卡

修改：

- `src/components/projects-panel.tsx`

新增：

- `ProjectsPanel` 顶部的 `循环任务` Spotlight 卡

作用：

- 直接显示 interval job 数量与启用状态
- 展示最近 3 条循环任务
- 每条卡片显示：
  - 名称
  - cadence（如“每 5 秒”）
  - action kind
  - 目标 workspace / project
  - next / last 时间
  - lastRunResult / lastRunError
- 提供“打开 Scheduler”按钮跳转到完整调度面板

### 2. SchedulerPanel 强化 interval / loop 表达

修改：

- `src/components/scheduler-panel.tsx`

优化点：

- Header 新增 loop 数量胶囊
- interval job 使用 `Repeat` 图标，与 cron / once 视觉区分
- `intervalMs` 转成人类可读 cadence
- 行内信息改成：
  - cadence badge
  - action badge
  - target badge
  - next / last 双卡片
- `lastRunError` 保持独立错误提示

### 3. SchedulerPanel 补齐 `dispatch-prompt` 表单入口

表单新增：

- `dispatch-prompt` action kind
- `Prompt Asset Refs`
- `Skill Hints`

这让标准 schedule 入口在 UI 中也能完整表达，而不只是通过 REST。

## 页面验证

本轮使用 `bb-browser` 做实际页面检查。

### OPC 页验证

页面文本已能检出：

- `循环任务`
- `现在的 OPC 主工作台默认只会把被触发出来的 Project / Run 暴露出来，这里补的是“循环任务本体”的可见性。`
- `打开 Scheduler`
- `OPC 可视化检查 · 循环健康巡检`
- `每 5 秒`

说明：

- 循环任务现在已经能在 `OPC / Projects` 主工作台被直接看到

### Operations 页验证

页面文本已能检出：

- `打开 Scheduler`
- `OPC 可视化检查 · 循环健康巡检`
- `每 5 秒`

说明：

- `SchedulerPanel` 已开始以“循环任务”视角表达 interval job，而不是只剩原始字段

## 结论

现在关于“循环执行任务”这件事，入口已经更清晰：

1. **OPC / Projects**：看循环任务概览与最近关键 loop job
2. **CEO Dashboard**：看 scheduler 摘要与最近活动
3. **Operations / SchedulerPanel**：看完整任务清单、编辑、触发、删除与参数

也就是说，用户不再只能通过“某个被触发出来的项目名”间接猜测循环任务是否存在，而是可以在 OPC 里直接看到循环任务本体。
