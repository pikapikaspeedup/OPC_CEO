# SQLite 迁移与历史可见性审计

日期：2026-04-18

## 目标

核对两件事：

1. SQLite 主库是否已经成为真实运行时主路径
2. 历史内容是否真的可见，而不是只停留在“有摘要没过程”

## 审计结论

### 1. 迁移成功

当前主库：

- `~/.gemini/antigravity/gateway/storage.sqlite`

实际回读结果：

- `projects = 144`
- `runs = 194`

说明：

- 之前迁移后的 `192` 条 runs 之外，本轮又增加了 2 条 smoke runs
- 当前运行时读出的数据已经来自 SQLite，而不是旧 JSON registry

### 2. 历史内容“能看到”，但要区分两类

#### A. 迁移前的历史 run

代表样本：

- `e06490c0-15ce-4faa-8bc3-b08eccc180fa`
- provider: `native-codex`

验证结果：

- `run-history.jsonl` 条数：`6`
- 事件类型：
  - `migration.imported`
  - `result.discovered`
  - `verification.discovered`
  - `conversation.message.user`
  - `conversation.message.assistant`
  - `artifact.discovered`
- `GET /api/agent-runs/:id/conversation`
  - `status = 200`
  - `kind = transcript`
  - `messageCount = 2`

结论：

- **能看**
- 但这是**迁移后补出来的可读历史**
- 不是完整的逐 step 原始运行流

也就是说，历史 run 目前能回放：

- 用户输入
- AI 输出
- 结果摘要
- 验证字段
- 产物索引

但不能保证还原出完整的 provider 内部步骤流，因为这些老 run 在 cutover 前本来就没有统一持久化。

#### B. 迁移后的新 run

代表样本：

- `73163290-593d-41e3-9339-226d7783f39d`
- provider: `antigravity`

验证结果：

- `status = completed`
- `historyCount = 44`
- `provider.step = 8`
- 包含事件：
  - `provider.dispatch`
  - `provider.step`
  - `session.started`
  - `session.live_state`
  - `workflow.finalize.started/completed`
  - `result.discovered`
  - `artifact.discovered`
  - `session.completed`
  - `conversation.message.assistant`

结论：

- **迁移后的新 run 是满血可回放的**
- 这说明新的 `run-history.jsonl` 路径已经真正生效

### 3. Deliverables 读路径已切到 SQLite

验证项目：

- `79dc21b7-7916-4651-8638-421ab99c30c0`

结果：

- `GET /api/projects/:id/deliverables`
  - `status = 200`
  - `length = 5`

说明：

- 历史项目的 deliverables 已经能通过 SQLite 主路径回读
- 不再依赖前端 fallback 才能看到

## 最重要的真实判断

### 真正成功的部分

- SQLite 主库切换成功
- Deliverables 已切到 SQLite 主路径
- 历史 run 至少能看到 transcript / result / verification / artifacts
- 新 run 已经有完整的 run-history 过程日志

### 还不该自欺欺人的部分

- **迁移前的历史 run 并没有被“神奇恢复”为完整 step-by-step 运行过程**
- 现在能看到的是：
  - 补导入的 transcript
  - 补导入的结果与验证
  - 补扫描的 artifacts
- 对老 run 来说，这已经可用，但不是 full-fidelity replay

## 建议表述

对外应该这样说：

- **迁移成功**
- **历史内容可见**
- **但完整 step 级运行轨迹只对 cutover 后的新 run 保证**
- **cutover 前的老 run 只能保证 transcript/result/artifact/verification 级别的回放**

这才是对当前状态最准确的描述。
