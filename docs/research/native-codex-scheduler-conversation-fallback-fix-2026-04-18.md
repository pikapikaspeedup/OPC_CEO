# Native Codex 周期任务 AI 对话 unavailable 修复（2026-04-18）

## 背景

用户在查看保留的 Native Codex 周期任务时，点击“查看 AI 对话”得到：

- `当前 provider 没有可展示的 AI 对话内容。`

但同一条周期任务的 run 实际已经：

- `completed`
- 有 `sessionProvenance.handle`
- 有 `run-history.jsonl`
- 有 `conversation.message.user / assistant`

说明问题不在执行本身，而在对话回放链路。

## 根因

`GET /api/agent-runs/:id/conversation` 原先的优先级是：

1. `childConversationId`
2. provider 内存 transcript
3. artifact `.md` 草稿 fallback

对 `native-codex` 周期任务来说，真正稳定存在的真相源其实是：

- `run-history.jsonl`

而不是 provider 模块内存。

因此一旦 route 侧拿不到内存 transcript，就会直接掉进：

- `kind = unavailable`

即使 run-history 里已经有完整的 user / assistant 消息。

## 本次修复

### 1. `conversation route` 增加 `run-history` transcript fallback

修改：

- `src/app/api/agent-runs/[id]/conversation/route.ts`

新增逻辑：

- 先尝试 provider 内存 transcript
- 如果没有，再读 `run-history.jsonl`
- 从：
  - `conversation.message.user`
  - `conversation.message.assistant`
  重建 transcript

处理细节：

- 第一条 user message 优先显示 `run.prompt`
- 避免把 provider 内部拼接后的超长 prompt 直接暴露给前端

### 2. Native Codex / Codex transcript map 改为 `globalThis` 单例

修改：

- `src/lib/providers/native-codex-executor.ts`
- `src/lib/providers/codex-executor.ts`

作用：

- 减少 dev / HMR 场景下 module 重载导致的 transcript 丢失

### 3. 单测补齐

新增：

- `src/app/api/agent-runs/[id]/conversation/route.test.ts`

验证：

- provider 内存 transcript 不可用时
- route 能从 run-history 正常返回 transcript

## 验证

### 单测

```bash
npm test -- src/app/api/agent-runs/[id]/conversation/route.test.ts
```

结果：

- `1 passed`

### 真实接口

周期任务样本：

- `jobId = 6f1399e3-cb1a-4522-b9af-7d90194572ba`

真实 run：

- `80eebd77-dd3f-4587-9bad-3e63a2871076`
- `9680c9f7-399f-44aa-b615-91d2c6576ee1`

修复后回读：

- `GET /api/agent-runs/80eebd77-dd3f-4587-9bad-3e63a2871076/conversation`
- `GET /api/agent-runs/9680c9f7-399f-44aa-b615-91d2c6576ee1/conversation`

两条都返回：

- `kind = transcript`
- `provider = native-codex`
- 包含：
  - `user`
  - `assistant`

## 结论

这次修复后，Native Codex 周期任务的执行链条已经补齐到可回看状态：

1. scheduler job 触发 run
2. run 产生结果
3. `run-history.jsonl` 持久化消息
4. conversation API 能稳定回放 transcript

也就是说，现在“查看 AI 对话”不再依赖 provider 进程内存是否还在。
