---
name: baogaoai-ai-bigevent-generator
description: 为 AI 情报工作室准备 AI 大事件上下文、构建上报 payload，并完成真实上报与验证。
---

# BaogaoAI AI Big Event Generator

这个 skill 为 `AI情报工作室` 的 **AI 大事件** 场景提供确定性脚本能力。

## 提供脚本

- `scripts/fetch_context.py`
- `scripts/build_report.py`
- `scripts/report_daily_events.py`

## 执行职责

1. 按 Asia/Shanghai 目标日期准备大事件候选上下文
2. 将 Native Codex 输出归一化成 `/admin/daily-events/report` 兼容 payload
3. 真实 POST 到后端并回读 `/daily-events` 验证是否写入成功

## 数据合同

- `fetch_context.py` 负责产出 prepared context
- `build_report.py` 负责产出最终 payload
- `report_daily_events.py` 负责上报与回读验证

## 适用场景

- AI 大事件
- 今日重大 AI 事件提炼
- 需要真实写入 `daily-events` 后端的行业事件抽取任务
