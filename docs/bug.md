# 遗留需求 & Bug 记录

## 待实现需求

### [HIGH] ClaudeEngine: autoCompact + prompt-too-long 恢复
- **背景**: Antigravity 自身的 Provider 有自动 maintain 对话历史的能力，但 claude-api provider（ClaudeEngine）目前没有
- **需要实现**:
  1. autoCompact — 当 token 超阈值时自动调用 Haiku 压缩对话历史
  2. prompt-too-long 恢复 — 收到 413 错误时触发 reactive compact 重试
  3. max_output_tokens 恢复 — 收到截断时注入 "继续工作" 消息并重试（最多 3 次）
- **参考**: Claude Code 的 `src/services/compact/` 和 `src/query.ts` 第 1086-1240 行
- **优先级**: 在 ClaudeEngine 用于长任务时必须有
