# Scheduler / Run / Conversation 机制说明（2026-04-18）

## 用户问题

用户指出：

- 周期任务已经执行
- 也能看到 run 和结果
- 但“查看 AI 对话”之前会返回 unavailable
- 因此用户无法理解当前机制到底是什么

## 机制拆解

当前系统里其实有四层对象：

### 1. Scheduler Job

作用：

- 表示“计划”
- 定义何时触发、触发什么动作

例子：

- `type = interval`
- `intervalMs = 60000`
- `action.kind = dispatch-prompt`

### 2. Run

作用：

- 表示某一次真实执行实例

也就是说：

- 一个 scheduler job 会反复创建多个 run
- run 才是真正执行 provider 的对象

### 3. Run History

作用：

- 作为 run 级持久化证据

当前真相源：

- `~/.gemini/antigravity/gateway/runs/{runId}/run-history.jsonl`

其中会记录：

- `conversation.message.user`
- `conversation.message.assistant`
- `workflow.preflight.*`
- `workflow.finalize.*`
- `session.*`
- `result.discovered`

### 4. Conversation API

作用：

- 给前端“查看 AI 对话”提供 transcript

接口：

- `GET /api/agent-runs/:id/conversation`

它不是 run 本身，而是一个“回放器”。

## 之前的机制缺口

对 `native-codex` 来说，原先 conversation route 的回放优先级是：

1. provider 内存 transcript
2. artifact `.md` 草稿
3. 否则 `unavailable`

问题在于：

- 周期任务是异步、持续运行的
- dev/HMR 或进程切换时，provider 内存 transcript 容易拿不到
- 但 run-history 里其实已经有完整消息

于是就出现了用户看到的反直觉现象：

1. job 存在
2. run 存在
3. result 存在
4. 但 conversation 却 unavailable

这不是执行失败，而是“回放链路”不稳。

## 修复后的机制

### A. job -> run 关联

现在 scheduler 触发时会把：

- `triggerContext.source = scheduler`
- `triggerContext.schedulerJobId = <jobId>`

写入 run。

所以：

- `GET /api/agent-runs?schedulerJobId=...`

可以稳定反查这条任务触发出来的 runs。

### B. conversation transcript 回放

现在 `GET /api/agent-runs/:id/conversation` 的回放逻辑变成：

1. 先读 provider 内存 transcript
2. 若没有，再读 `run-history.jsonl`
3. 再不行才退到 artifact `.md`
4. 最后才 `unavailable`

因此 `native-codex` 周期任务现在不再依赖 provider 进程内存是否还在。

## 正确理解方式

可以把四层理解成：

1. `Scheduler Job` = 计划
2. `Run` = 一次执行
3. `Run History` = 证据
4. `Conversation API` = 回放器

所以：

- job 不是对话
- run 也不是对话
- 对话内容真正稳定的真相源应该落在 run-history

## 结论

用户之前感到“看不懂”，本质上是机制层确实有不一致：

- 执行链是持久化真相源
- 对话回放链最初部分依赖易丢失的内存

现在这层已经补齐为：

- `scheduler job -> run -> run-history -> conversation API`

后续只要 run-history 在，对话就应可回放。
