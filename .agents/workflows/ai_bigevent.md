---
description: AI 大事件提炼与上报 workflow。优先使用已准备好的当日大事件上下文，输出严格 JSON payload，由运行时完成校验、上报和验证。
trigger: always_on
runtimeProfile: daily-events
runtimeSkill: baogaoai-ai-bigevent-generator
---

# AI 大事件提炼器

## 目标

为 `AI情报工作室` 提炼 **今天（Asia/Shanghai）** 的 AI 行业大事件，并交由运行时完成真实上报与回读验证。

## 事实源优先级

### 优先级 1：使用已准备好的 Daily Events Context

如果 prompt 中已经出现以下内容：

- `Prepared Daily Events Context`
- `Existing same-day events`
- `Recent 30-day events`
- `Candidate articles`
- `Article details`

则这些内容就是**本次提炼的唯一事实源**。

此时你必须：

1. 只基于这些上下文提炼事件
2. 明确使用 prompt 中给出的绝对日期
3. 避免重复 `same-day` 或明显重复的 `last30Days` 事件
4. 不要再向用户索要链接、文章或日期

### 优先级 2：上下文不足时保守输出

如果 prepared context 说明文章不足，或者上下文本身不够支撑可靠事件：

1. 仍然返回规定 JSON
2. `events` 可以为空数组
3. 在 `notes` 中明确写出原因
4. 不要编造事件

## 输出合同

你的主输出必须是 **唯一一个** ` ```json ` fenced block，内容必须是一个对象：

```json
{
  "eventDate": "YYYY-MM-DD",
  "events": [
    {
      "category": "funding",
      "title": "事件标题",
      "summary": "一句话摘要",
      "importance": 4,
      "sourceArticleIds": [123],
      "sourceUrls": ["https://example.com/a"]
    }
  ],
  "notes": "本次提炼说明"
}
```

## 字段要求

- `eventDate`：必须等于 prepared context 里的绝对日期
- `events[].category`：只能是以下 9 种之一
  - `model_release`
  - `product_launch`
  - `funding`
  - `ipo_ma`
  - `policy`
  - `milestone`
  - `partnership`
  - `talent`
  - `open_source`
- `events[].importance`：只能是 `1..5`
- `events[].sourceArticleIds`：只能使用 prepared context 中出现过的 article id
- `events[].sourceUrls`：只能使用 prepared context 中出现过的 article url

## 质量标准

- 标题必须体现“谁 + 做了什么 + 量级/意义”
- 摘要必须保留硬事实：金额、版本名、产品名、合作方、关键数字
- 同一事件跨多篇文章时应合并成一条
- 没有新事实的旧闻、评论、教程、观点文不要提炼为事件

## 最终要求

- 不输出 Markdown 正文总结
- 不输出模板说明
- 不输出多段解释
- 只输出可被运行时解析和上报的 JSON block
