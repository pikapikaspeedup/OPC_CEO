# OPC 数据库与存储策略研究（2026-04-17）

## 问题

用户追问两件事：

1. **我们现在的“数据库”到底是什么？**
2. **对于一个 OPC 运营应用，下一步主数据库应该用什么？**

这里必须先澄清：

- 当前系统并没有单一“主数据库”
- 而是多种持久化层并存

## 结论摘要

### 现在是什么

当前系统是：

- `JSON registry + JSONL journal + artifact files + 外部 SQLite(state.vscdb) + 外部 conversation 文件`

拼出来的一套混合持久化架构。

也就是说：

- **我们现在没有自己的统一主数据库**

### 应该用什么

对于当前这个：

- 本地优先
- Tauri / Node sidecar 友好
- 单用户优先
- 但未来可能升级到多人/服务端

的 OPC 产品，最佳策略是：

1. **主数据库：SQLite（WAL 模式）**
2. **原始执行日志：JSONL**
3. **大对象与交付物：文件系统 / artifact 目录**
4. **外部 Antigravity state.vscdb：只做集成读取，不做主真相源**

如果将来进入：

- 多用户
- 中心化部署
- 多机协作

再把主表迁到：

- **Postgres**

## 当前实际持久化层

### 1. Gateway 自己的 JSON 文件

定义位置：

- `src/lib/agents/gateway-home.ts`

当前文件：

- `~/.gemini/antigravity/gateway/projects.json`
- `~/.gemini/antigravity/gateway/agent_runs.json`
- `~/.gemini/antigravity/gateway/local_conversations.json`
- `~/.gemini/antigravity/gateway/scheduled_jobs.json`

作用：

- project registry
- run registry
- local conversation cache
- scheduler jobs

### 2. Project 级 JSONL 日志

定义位置：

- `src/lib/agents/execution-journal.ts`

当前路径：

- `~/.gemini/antigravity/gateway/projects/{projectId}/journal.jsonl`

作用：

- 记录 control-flow / orchestration 事件
- 例如：
  - `node:activated`
  - `node:completed`
  - `gate:decided`
  - `checkpoint:*`

当前边界：

- 不记录完整 conversation 正文
- 不记录完整 provider tool events
- 不是 run-level 的完整历史

### 3. Workspace artifact 文件

当前路径：

- `demolong/runs/{runId}/`
- `demolong/projects/{projectId}/runs/{runId}/`

作用：

- `result.json`
- `result-envelope.json`
- `artifacts.manifest.json`
- 草稿、payload、verification、markdown 结果等

特点：

- 这是最适合文件系统的层
- 不应该强行塞进关系库

### 4. 外部 SQLite：Antigravity `state.vscdb`

定义位置：

- `src/lib/bridge/statedb.ts`

实际路径：

- `~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb`

当前作用：

- 读取 API key
- 读取 workspaces
- 读取 trajectory summaries
- 补 conversation metadata

注意：

- 这不是 OPC 自己的数据库
- 这是外部系统的内部状态库
- 只能当 **integration source**

### 5. 外部 conversation / brain 文件

同样在：

- `src/lib/bridge/statedb.ts`

依赖路径：

- `~/.gemini/antigravity/conversations/*.pb`
- `~/.gemini/antigravity/brain/*`

作用：

- Antigravity 会话列表 / 标题 / 脑区文件回读

注意：

- 这依然是外部 runtime 的存储，不是 OPC 自己的主库

## 当前方案为什么“能跑但不够好”

### 合理的地方

#### 1. JSON registry 适合快速迭代

优点：

- 实现简单
- 本地开发快
- 调试成本低
- 人工查看方便

#### 2. JSONL 适合 append-only event log

优点：

- 写入模型天然简单
- 审计和回放友好
- crash 时损坏面小
- 不需要复杂事务

#### 3. artifact 放文件系统是正确的

优点：

- markdown / json / txt / 交付物天然就是文件
- 不该硬塞到关系型主表

### 不合理的地方

#### 1. 真相源分散

现在要拼完整事实，需要同时看：

- `projects.json`
- `agent_runs.json`
- `journal.jsonl`
- `artifactDir`
- `state.vscdb`
- `conversations/*.pb`

这对运营产品来说过于分裂。

#### 2. JSON 作为主 registry 有并发风险

仓库自己也已有明确记录：

- `agent_runs.json` / `projects.json` 单文件持久化存在并发写风险

#### 3. 查询能力弱

你如果想查：

- 某部门最近 30 天所有失败 run
- 某 provider 下平均完成耗时
- 某项目所有 conversation / run / artifact 的统一时间线

当前会非常难做。

#### 4. 无法形成统一 provider-neutral 模型

对 `antigravity`：

- conversation 数据在外部 SQLite + protobuf + brain

对 `native-codex` / `codex`：

- 目前更多靠本地内存 / artifact fallback

所以如果没有自己的主数据库层，就很难做 provider-neutral 的运营视图。

## 数据库选型结论

### 不建议继续把 JSON 当主数据库

原因：

- registry 单文件会越来越脆弱
- 不适合复杂查询
- 不适合并发写
- 不适合长期演进

### 不建议把 JSONL 当主数据库

原因：

- JSONL 适合日志，不适合主业务查询
- UI 不该直接依赖 JSONL 做主状态查询

### 不建议现在直接上 Postgres

原因：

- 当前是本地优先 / sidecar 架构
- 会增加部署与运维复杂度
- 会过早引入网络化依赖
- 目前还在对象模型快速变化期

### 推荐：SQLite 作为主数据库

原因：

1. 非常适合当前单机 / sidecar / Tauri 路线
2. 支持事务
3. 支持索引与结构化查询
4. 迁移成本低
5. 后续可平滑映射到 Postgres

### 推荐运行模式

- SQLite + WAL
- 单机本地文件 DB
- Node sidecar 持有写权限
- 前端全部经 API route / service 层访问

## 推荐的最终分层

### Layer 1：主数据库（SQLite）

建议存：

- `projects`
- `runs`
- `conversation_sessions`
- `run_conversation_links`
- `deliverables`
- `departments`
- `scheduled_jobs`
- `checkpoints`

这是**主业务真相源**。

### Layer 2：事件日志（JSONL）

建议存：

- 每个 run 一份 `run-history.jsonl`

记录：

- session start / attach / resume
- user / assistant messages
- tool calls / tool results
- workflow hooks
- verification
- finalization

这是**原始执行历史层**。

### Layer 3：artifact 文件

建议继续保留：

- markdown
- json payload
- verification file
- report file
- generated content

这是**大对象 / 交付物层**。

### Layer 4：外部系统集成层

保留读取：

- `state.vscdb`
- protobuf conversations
- brain files

但它们只能作为：

- `external import / integration source`

不能再作为 OPC 的主真相源。

## 对 Provider 差异的影响

### Antigravity 原生执行器

特点：

- 有外部 runtime
- 有 IDE conversation
- 有 `state.vscdb`
- 有 protobuf / brain 文件

所以：

- 它自带“部分历史”
- 但我们仍然不该依赖它当主数据库

### 第三方 Codex / API / CLI

特点：

- 不一定有 IDE-native conversation store
- 不一定有结构化 step stream
- 很多时候只有：
  - handle
  - final output
  - tool calls / transcript

所以：

- 越是第三方 provider
- 越需要 OPC 自己有主数据库 + run-history 日志

这也是为什么：

- SQLite 主库 + JSONL 事件流

比继续依赖外部 runtime 存储更重要。

## 具体推荐技术方案

### 主库

- **SQLite**

### Node 侧驱动

推荐顺序：

1. `better-sqlite3`
2. `Drizzle ORM`（如果想要 schema / migration / 将来迁 Postgres 的可移植性）

如果只求最快落地：

- `better-sqlite3 + 手写 SQL`

如果考虑后续演进：

- `Drizzle + better-sqlite3`

### 为什么不是 Prisma

不是不能用，而是不优先。

原因：

- 当前本地 sidecar 场景更偏轻量
- Prisma 生成链更重
- 对这类文件型本地 app 并不是最小成本方案

## 迁移建议

### Phase 1

先把：

- `projects.json`
- `agent_runs.json`
- `scheduled_jobs.json`

迁入 SQLite。

### Phase 2

新增：

- `run_history.jsonl`

把 run 的 conversation / tool / hook / verification 统一写进去。

### Phase 3

把 `local_conversations.json` 降级成 cache，不再当正式 registry。

### Phase 4

把 `Deliverables` / `conversation sessions` / `links` 也结构化入库。

### Phase 5

如果未来走多人/服务端，再把 SQLite 主表平移到 Postgres。

## 最终结论

### 现在数据库是什么

严格说：

- **现在没有统一主数据库**

只有：

- JSON registry
- JSONL journal
- artifact files
- 外部 Antigravity SQLite / protobuf / brain

### 应该用什么

对当前 OPC 来说，最合理的是：

- **SQLite 做主数据库**
- **JSONL 做原始执行日志**
- **artifact 继续走文件系统**
- **state.vscdb 只做外部读取**

### 核心判断

`jsonl` 不是错，错的是：

- 当前没有把它放在正确层级

它应该是：

- **日志层**

而不是：

- **主数据库层**
