---
name: baogaoai-ai-digest-generator
description: 为 AI 情报工作室提供 AI 日报生成的全局能力入口。当前 runtime 脚本资产由 canonical workflow `ai_digest` 挂载到 workflow-scripts。
---

# BaogaoAI AI Digest Generator

这个 skill 继续作为 `AI情报工作室` 的全局可复用能力声明存在，用来表达“日报生成/整理”这类能力语义。

当前实现边界：

- workflow 编排：canonical workflow `/ai_digest`
- runtime helper scripts：`gateway/assets/workflow-scripts/ai_digest/*`
- skill 角色：能力入口与语义复用，不再承担 `ai_digest` 的必需脚本宿主职责

这样 workflow 可以直接运行，也仍然允许其他地方把这个 skill 当成可复用能力进行引用。
