# Native Codex 日报场景复测（Canonical Workflow + Resolver 后）

日期：2026-04-16  
对象：`AI情报工作室`  
工作区：`/Users/darrel/Documents/baogaoai`

## 测试目的

在完成 canonical workflow / department resolver 第一阶段后，重新验证：

1. `AI情报工作室` 切到 `native-codex`
2. 通过 CEO 命令发起“总结今天日报”
3. 实际执行时是否：
   - 真的走 `native-codex`
   - 命中 workflow / skill
   - 产出结果是否更可信

## 测试命令

1. `让 AI情报工作室生成今天的日报总结报告`
2. `AI情报工作室汇总今天的日报`

## 运行结果

### Run A

- runId: `ef145a73-42fb-4924-83a5-98c69f19df6b`
- backend: `native-codex`
- status: `completed`

### Run B

- runId: `d3e9981d-4365-4d2b-9db7-38bccf42594f`
- backend: `native-codex`
- status: `completed`

## Prompt Resolution 结果

两条 run 的 `promptResolution` 一致：

```json
{
  "mode": "prompt",
  "requestedWorkflowRefs": [],
  "requestedSkillHints": ["reporting"],
  "matchedWorkflowRefs": [],
  "matchedSkillRefs": [],
  "resolutionReason": "Prompt Mode injected department identity/rules only; no workflow or skill asset configured."
}
```

并且都给出结构化建议：

```json
{
  "workflowSuggestion": {
    "shouldCreateWorkflow": true,
    "source": "prompt",
    "title": "AI情报工作室-new-workflow",
    "recommendedScope": "department"
  }
}
```

## 结论

### 技术层

- ✅ 这次确实是 **全 Native Codex**
- ✅ Prompt Mode 的结构化 `promptResolution` / `workflowSuggestion` 已经能落到 run/result/result-envelope
- ✅ 系统已经能明确告诉我们：这次没有命中任何 workflow/skill，只是 pure prompt fallback

### 业务层

- ⚠️ 结果依然**不可信**

表现：

1. 明确提示“没有提供今天的原始资讯素材、链接或指定日期”
2. 产出的是一份**日报模板**
3. 日期仍然是错误的：`2025-08-08`

这说明第一阶段改造虽然让系统**知道自己没命中 workflow**，也能给出“该沉淀 workflow”的建议，但它仍然没有真正接入：

- `AI情报工作室` 的 canonical workflow
- 真实的“今日日报源数据”
- “今天 = 2026-04-16”的绝对日期上下文

## 最重要的新信息

相比上一次复测，这次最大的进步不是“日报更好了”，而是：

> 系统终于能**准确暴露失败原因**：不是 Native Codex 不行，而是部门根本没有被配置到任何 canonical workflow/skill，因此只能走纯 prompt fallback。

## 测试后恢复

测试结束后，已将：

- `/Users/darrel/Documents/baogaoai/.department/config.json`

中的 `provider` 恢复回：

```json
"provider": "antigravity"
```
