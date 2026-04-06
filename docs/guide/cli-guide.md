# Antigravity CLI (`ag`)

> 轻量级命令行工具，直接调用本地 Next.js API，无需 MCP 持久连接。

## 快速上手

```bash
# 确保 dev server 正在运行
npm run dev

# 查看帮助
npm run ag -- help

# 查看所有项目
npm run ag -- projects
```

## 命令一览

### `projects` — 列出所有项目

```bash
npm run ag -- projects
```

输出示例：
```
📋 Projects (9)
id        name                     status     pipeline   stage  runs
01748476  前端重构 v2                active     running    1      3
328dad15  前端重构                   completed  completed  0      1
```

---

### `project <id>` — 查看项目详情 + 流水线状态

```bash
npm run ag -- project 01748476-3e33-47fb-be86-5bb57628d46c
```

输出示例：
```
🏗️  Project-Centric 前端重构 v2
   Status: active  |  Pipeline: running

Pipeline Stages:
  ✅ Stage 0: product-spec  [completed]  run=ff318228
  ✅ Stage 1: architecture-advisory  [completed]  run=22946833
  ⏳ Stage 2: autonomous-dev-pilot  [pending]  run=—
```

> **Tip**: ID 支持完整 UUID 或前 8 位短 ID（取决于 API 端）。

---

### `runs` — 列出 Runs

```bash
# 全部
npm run ag -- runs

# 按状态过滤
npm run ag -- runs --status=running
npm run ag -- runs --status=failed

# 按 stage 过滤
npm run ag -- runs --stage=product-spec
```

---

### `run <runId>` — 查看 Run 详情

```bash
npm run ag -- run 90b9e6b9-9787-4d97-be7f-458d8e870fc6
```

输出示例：
```
🔍 Run 90b9e6b9
   Stage: autonomous-dev-pilot  |  Status: running  |  Round: 1
   Review: —  |  Template: development-template-1

   Roles:
     [R1] autonomous-dev               running

   Live: running  steps=63  last=PLANNER_RESPONSE
```

---

### `dispatch <templateId>` — 派发新 Run

```bash
# 最简用法：派发模板入口 stage
npm run ag -- dispatch coding-basic-template \
  --prompt "Fix the login bug"

# 完整用法：在项目内派发模板的指定 stage
npm run ag -- dispatch development-template-1 \
  --stage autonomous-dev-pilot \
  --project 01748476-3e33-47fb-be86-5bb57628d46c \
  --source 22946833-7867-4926-9e90-0a2e2c44f5fd \
  --prompt "Implement the frontend workbench"
```

| 参数 | 说明 |
|------|------|
| `<templateId>` | 模板 ID，位置参数 |
| `--stage <stageId>` | 指定模板中的某个 stage；省略时派发入口 stage |
| `--project <id>` | 关联到指定项目 |
| `--source <runId>` | 上游 Source Run（可重复多次） |
| `--prompt "..."` | 任务目标描述 |
| `--workspace <uri>` | 工作区 URI（默认当前项目） |

补充说明：

- 同时提供 `--source` 和 `<templateId>` 时，服务端会优先尝试自动推断下游 stage
- 不传 `--stage` 时，线性模板默认派发第一个 stage；graph 模板默认派发入口 node
- `ag dispatch` 不再接受 `--template`，位置参数就是模板 ID

---

### `intervene <runId> <action>` — 干预 Run

```bash
# 在同一 Run 内重启卡住的角色
npm run ag -- intervene ff318228-... restart_role \
  --prompt "Please complete the review" \
  --role product-lead-reviewer

# 取消正在运行的任务
npm run ag -- intervene 90b9e6b9-... cancel

# 给卡住的 Agent 发 nudge
npm run ag -- intervene 90b9e6b9-... nudge \
  --prompt "Focus on finishing the result.json"
```

| Action | 说明 |
|--------|------|
| `retry` | 兼容别名，内部等价于 `restart_role` |
| `restart_role` | 在同一 Run 内新建 Conversation 接管指定角色 |
| `nudge` | 给 stale-active 的 Agent 发送提示 |
| `cancel` | 取消运行 |
| `evaluate` | 触发对当前 Run 状态的评估（适用于需要重新检测完成状态的场景） |

选择建议：

- Run 还在 `running/starting`，并且已经出现 `liveState.staleSince`：用 `nudge`
- 当前 Conversation 明显坏掉了，但想保留同一个 Run：用 `restart_role`
- 需要立刻终止当前执行：用 `cancel`
- 需要重新评估 Run 的产物和状态：用 `evaluate`
- `retry` 只是兼容别名；新用法优先写 `restart_role`

---

### `resume <projectId>` — 恢复 Project Pipeline

```bash
# 从现有产物恢复 canonical run
npm run ag -- resume 01748476-3e33-47fb-be86-5bb57628d46c --action recover

# 给 stale-active stage 的当前对话发提示
npm run ag -- resume 01748476-... --action nudge

# 在同一 Run 内重启指定角色
npm run ag -- resume 01748476-... --action restart_role --role product-lead-reviewer

# 取消当前 stage 的 canonical run
npm run ag -- resume 01748476-... --action cancel

# 跳过当前 stage（不触发下游）
npm run ag -- resume 01748476-... --action skip

# 强制完成卡住的 stage（触发下游 dispatch）
npm run ag -- resume 01748476-... --action force-complete
```

`resume` 现在必须显式传 `--action`。选择逻辑如下：

- `recover`：产物已经写完，只是状态没同步
- `nudge`：run 仍在 `starting/running`，且 `liveState.staleSince` 已出现
- `restart_role`：需要在同一个 run 内换一个新 Conversation 接管
- `cancel`：要终止当前 canonical run，并把 stage 标记为 `cancelled`
- `skip`：跳过 stage，不执行也不触发下游（适用于 `pending`/`failed`/`blocked`/`cancelled` 状态）
- `force-complete`：标记 stage 完成并触发下游（适用于 Watcher 断连等卡死场景）

如果不传 `--stageIndex`，服务端会自动选择第一个 actionable stage：

- `failed`
- `blocked`
- `cancelled`
- `starting/running` 且 canonical run 已出现 `liveState.staleSince`

注意：

- `resume` 不会再创建新 run
- `redispatch` 不属于正常恢复流程
- 如果动作不适用于当前状态，接口会返回 `409`

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AG_BASE_URL` | `http://localhost:3000` | API 服务器地址 |

远程访问示例：
```bash
AG_BASE_URL=https://your-tunnel.trycloudflare.com npm run ag -- projects
```

## 与 MCP 的对比

| 特性 | CLI (`ag`) | MCP Server |
|------|-----------|------------|
| 连接方式 | HTTP 请求，用完即走 | stdio 持久连接 |
| 交互稳定性 | ✅ 非常稳定 | ⚠️ 会话更容易断开 |
| 执行链路 | ✅ 直接调用 Next.js API | ✅ dispatch / recovery 会转发到 Next.js 常驻进程 |
| 已派发任务连续性 | ✅ 不受终端关闭影响 | ✅ 已派发后不受 MCP 会话关闭影响 |
| 使用场景 | 手动操作、脚本集成 | AI Agent 自动调用 |

> **建议**：日常操作使用 CLI，只在需要让外部 AI Agent 自动化调度时才用 MCP。
