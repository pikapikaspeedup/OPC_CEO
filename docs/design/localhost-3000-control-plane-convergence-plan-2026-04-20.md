# localhost:3000 体系架构深层问题与整体收敛方案

日期：2026-04-20

## 一句话判断

当前 `localhost:3000` 的性能问题，本质上不是“某几个接口写得慢”，而是：

1. **控制面（control plane）没有完成单一真相源收口**
2. **请求路径、投影构建、外部状态导入、后台调度仍混在同一个 Node 主线程里**
3. **SQLite 主库已经落地，但系统仍然按“多真相源请求时拼装”在运行**

因此现在看到的慢、抖动、不稳定，不是彼此独立的问题，而是同一个体系设计缺口在不同入口上的不同表现。

## 硬约束

本方案有一个不可破坏的前提：

1. **不能影响原生 Antigravity IDE 的正常运行**

因此后续所有收敛动作都必须遵守下面 3 条红线：

1. **绝不写 `state.vscdb`**
2. **绝不写/删 IDE 自己的 `.pb` 与 `brain` 文件**
3. **在前两阶段不改变 `startCascade / send / cancel / updateConversationAnnotations` 的现有语义**

这意味着：

1. Antigravity IDE 仍然是外部 runtime
2. Gateway 只能把 IDE 状态当作 integration source
3. 架构收敛必须发生在 Gateway 自己的读模型、持久化层和 worker 拓扑上，而不是通过侵入 IDE 内部状态来换性能

## 当前问题不是点状，而是 5 个系统级断层

### 1. 真相源没有真正收口

系统已经有：

1. `~/.gemini/antigravity/gateway/storage.sqlite`

而且已经落了：

1. `projects`
2. `runs`
3. `conversation_sessions`
4. `scheduled_jobs`
5. `deliverables`

但当前请求仍然会同时依赖：

1. Gateway SQLite
2. `state.vscdb`
3. `~/.gemini/antigravity/conversations/*.pb`
4. `~/.gemini/antigravity/brain/*`
5. live gRPC `GetAllCascadeTrajectories`

也就是说，系统名义上已经进入 “SQLite 主库” 阶段，但实际运行方式仍是：

1. **多真相源并存**
2. **请求时现场做 federation**
3. **最后再临时决定哪个结果可信**

这是整个问题的第一根主线。

### 2. 请求服务与后台控制面没有隔离

当前单个 Node 进程同时承载：

1. Next.js route handler
2. WebSocket server
3. scheduler
4. fan-out controller
5. approval request restore
6. CEO event consumer
7. tunnel auto-start

虽然 `server.listen()` 之后使用了：

1. `void warmBackgroundServices(port)`

但这只是“异步顺序调用”，不是隔离。

它们仍然：

1. 运行在同一个进程
2. 竞争同一个事件循环
3. 共享同一个同步文件系统 / SQLite / shell-out 开销

所以现在的 dev 态不是“服务端 + 后台 worker”，而是：

1. **一个 UI/API server 兼任 control-plane daemon**

这会让任何后台初始化或恢复动作都直接影响请求延迟。

### 3. 读模型没有物化，导致请求时重建投影

现在很多接口不是“查询已准备好的读模型”，而是“现场重建视图”。

最典型的是：

1. `src/app/api/conversations/route.ts`
2. `src/lib/bridge/statedb.ts`

`GET /api/conversations` 现在会在请求时做：

1. `.pb` 目录扫描
2. `refreshOwnerMap()`
3. `getConversations()`
4. gRPC trajectory 拉取
5. `runs.payload_json` 全表 JSON 扫描
6. 最后才做 workspace filter

而 `getConversations()` 自己还会：

1. shell `ls`
2. shell `head`
3. `spawnSync('python3', ...)`
4. 读取外部 SQLite protobuf

这说明当前系统缺的不是“某个缓存”，而是：

1. **持久化后的读投影（read projection）**
2. **把外部状态导入主库的 ingestion pipeline**

没有 projection，所有 read API 都会天然倾向于变成“请求时计算”。

### 4. runtime registry 与 durable store 的职责混在一起

`run-registry.ts` 与 `project-registry.ts` 当前同时承担了：

1. 进程内 active cache
2. durable state loader
3. state mutator
4. event side-effect trigger
5. persistence writer
6. 某些恢复逻辑与投影同步逻辑

并且它们是：

1. 模块顶层 `loadFromDisk()`
2. 每次状态变化全量 `saveToDisk()`
3. 恢复时继续触发 project stage 同步

这意味着 registry 不是单纯 cache，也不是单纯 repository，而是一个：

1. **runtime state machine + persistence adapter + reconciler 的混合体**

这会带来两个后果：

1. import 它就可能触发重恢复
2. 更新一个对象就可能拖上整表 upsert 和额外 side effects

### 5. provider/bridge 细节泄漏进 control plane

理论上：

1. `state.vscdb`
2. `.pb`
3. `brain`
4. Antigravity gRPC trajectory

都应该只是：

1. `external integration source`

但当前控制面读路径仍然把这些细节当成一等公民。

结果是：

1. provider-specific 的状态结构泄漏进 API route
2. bridge layer 变成“状态导入 + 控制路由 + 连接管理”的大杂烩
3. 想支持 provider-neutral control plane 时，就会不断在请求链里加特判

## 这几个表面问题，其实是同一个问题的不同投影

### 表面现象 A：`/api/conversations` 热态也慢

根因不是单一函数慢，而是：

1. 读路径没有 projection
2. 仍按 federation-on-read 模式运行

### 表面现象 B：清掉 5s jobs 后，dev 还是偶尔抖

根因不是 scheduler 没清干净，而是：

1. 请求线程和后台控制面没有隔离
2. registry 保存仍然是全量持久化

### 表面现象 C：某些接口冷态 compile 很重

根因不是单纯 Next compile，而是：

1. 模块边界不纯
2. import 图里混入顶层副作用
3. control-plane / bridge / asset sync 没做 lifecycle 切割

### 表面现象 D：不同 provider / session / conversation 很难统一

根因不是字段不够，而是：

1. durable model 没完全 provider-neutral
2. 仍在依赖外部 runtime 的存储结构做“事实层”

## 最终应该收敛到什么架构

### 目标原则

必须同时满足这 6 条：

1. **主真相源只有一个：Gateway SQLite**
2. **外部系统只负责输入，不负责主查询**
3. **请求只查 projection，不现场拼接**
4. **runtime cache 只是 cache，不是 durable truth**
5. **后台 worker 与 API 服务逻辑隔离**
6. **provider 细节只留在 adapter / importer，不泄漏到 control plane**

### 目标分层

#### Layer 1：Ingress / UI

负责：

1. Next.js 页面
2. API ingress
3. WebSocket/SSE ingress

要求：

1. 不承载重控制面恢复
2. 不承载状态导入
3. 只面向 repository / read service

#### Layer 2：Control-plane API

负责：

1. 项目、run、conversation、approval、scheduler 的业务 API
2. 所有读写都走 Gateway SQLite

要求：

1. route handler 不直接访问外部 `.pb` / `brain` / `state.vscdb`
2. route handler 不直接调用 shell / Python
3. route handler 不 import 带顶层恢复副作用的模块

#### Layer 3：Projection / Import Workers

负责：

1. 从外部 runtime 导入 conversation metadata
2. 更新 owner cache / live summary cache
3. 同步 run -> project stage projection
4. 生成 child conversation visibility projection

要求：

1. 独立于请求生命周期
2. 可重跑、可失败、可恢复
3. eventual consistency，而不是强耦合到每次请求

#### Layer 4：Execution Adapters

负责：

1. Antigravity gRPC
2. native-codex
3. codex
4. 其他 provider backend

要求：

1. 对控制面暴露统一合同
2. provider-specific 状态只停留在 adapter / importer

#### Layer 5：Storage

分成 3 种：

1. SQLite：主业务真相源 + 读投影
2. JSONL：append-only run history / raw events
3. artifact files：交付物 / 大对象

## 目标数据模型应该怎么改

当前 SQLite 虽然已经是主库，但很多关键查询仍然依赖：

1. `payload_json`
2. `json_extract(...)`
3. `json_each(...)`

这意味着主库还是“存档型”，不是“查询型”。

### 必须新增或强化的热路径表

#### 1. `conversations`

不要再把它只当 `conversation_sessions` 的轻 cache。

建议列：

1. `conversation_id`
2. `provider`
3. `workspace`
4. `title`
5. `step_count`
6. `created_at`
7. `updated_at`
8. `last_activity_at`
9. `visibility`
10. `source_kind`
11. `session_handle`
12. `primary_run_id`
13. `is_local_only`

它应该是：

1. **conversation list 的唯一查询入口**

#### 2. `run_conversation_links`

把现在藏在：

1. `childConversationId`
2. `activeConversationId`
3. `roles[].childConversationId`
4. `sessionProvenance.handle`

里的关系显式化。

建议列：

1. `run_id`
2. `conversation_id`
3. `session_handle`
4. `relation_kind`
   - `primary`
   - `child`
   - `role`
   - `supervisor`
   - `session-handle`
5. `role_id`
6. `created_at`

这样：

1. conversation 与 run 的关系能用索引直接查
2. 不需要每次扫 `runs.payload_json`

#### 3. `conversation_visibility`

当前隐藏 child conversation 的逻辑不应该每次重算。

建议列：

1. `conversation_id`
2. `is_hidden`
3. `hidden_reason`
4. `source_run_id`
5. `updated_at`

这样：

1. `/api/conversations` 只需要 `WHERE is_hidden = 0`

#### 4. `conversation_owner_cache`

live owner map 应该是 cache/projection，而不是 route 临时重建。

建议列：

1. `conversation_id`
2. `backend_id`
3. `owner_kind`
4. `endpoint`
5. `workspace`
6. `step_count`
7. `last_seen_at`
8. `expires_at`

这个表可以是 SQLite，也可以是内存+短 TTL，但它必须是：

1. **显式 cache**

而不是 route 里现拉。

#### 5. `runs` / `projects` 热字段前置

当前很多查询依赖 `payload_json`。

至少应把下面字段前置成普通列并加索引：

1. `runs.session_handle`
2. `runs.child_conversation_id`
3. `runs.review_outcome`
4. `runs.scheduler_job_id`
5. `projects.template_id`
6. `projects.pipeline_status`

## `/api/conversations` 的最终正确形态

### 现在的错误形态

当前它是：

1. request-time federation endpoint

### 正确形态

应该改成：

1. **projection query endpoint**

即：

1. 只读 `conversations`
2. join `conversation_visibility`
3. 可选 join `conversation_owner_cache`
4. 先 filter，再排序

而不是：

1. 先全量扫 `.pb`
2. 再扫 `brain`
3. 再解外部 protobuf
4. 再扫 runs JSON
5. 最后 filter

### live 信息怎么办

live 信息不能继续挡在 list query 前面。

应该拆成两层：

1. 列表层：
   - 读 durable projection
2. live overlay 层：
   - 由后台定时刷新 owner cache
   - 或由 detail endpoint / websocket 单独补

换句话说：

1. `title/workspace/visibility/last_activity`
   - 属于 durable read model
2. “当前 owner 是否在线”“当前 stepCount 是否刚增长”
   - 属于 live overlay

不能再混成一个 endpoint 的同步前置条件。

## run/project registry 的最终正确形态

### 现在的错误形态

它们现在更像：

1. global mutable singleton
2. import-time loader
3. full-snapshot persister
4. event reconciler

### 正确形态

应该拆成 4 层：

#### 1. Repository

负责：

1. `getById`
2. `listByFilter`
3. `upsertOne`

特点：

1. 纯持久化
2. 不带业务 side effect

#### 2. Runtime Cache

负责：

1. 仅缓存活跃 run / project
2. 仅服务 active session/dispatch

特点：

1. 内存态
2. 进程丢失可恢复
3. 不是主真相源

#### 3. Mutator / Service

负责：

1. status transition
2. pipeline stage sync
3. append history
4. emit domain event

#### 4. Reconciler / Projector

负责：

1. crash recovery
2. replay unresolved transitions
3. rebuild derived projections

### 保存策略必须改

现状：

1. 任何更新都全量 upsert 全表

目标：

1. **谁变了写谁**
2. 可选短 debounce
3. `project.json` 只给 artifact/兼容用途，不再做同步镜像主路径

## 模块生命周期必须显式化

当前最大的问题之一是：

1. import 某个模块就触发恢复、同步、扫描

比如：

1. `gateway-home.ts` 顶层 `syncAssetsToGlobal()`
2. `run-registry.ts` 顶层 `loadFromDisk()`
3. `project-registry.ts` 顶层 `loadFromDisk()`

这类代码的根本问题不只是“慢”，而是：

1. 它让模块不再是库，而变成半个启动器

### 正确做法

每个重模块都要改成：

1. `createXxxService(...)`
2. `initializeXxx(...)`
3. `startXxxWorker(...)`
4. `shutdownXxx(...)`

也就是：

1. **显式生命周期**
2. **显式依赖注入**
3. **显式启动顺序**

而不是靠 `import` 触发副作用。

## `gateway-home` / assets 的正确边界

当前 `gateway-home.ts` 把这些职责混在一起：

1. 定义路径常量
2. 创建目录
3. repo assets → global assets 同步

它不应该是一个“常量文件 + 启动脚本”的混合体。

### 正确做法

拆成：

1. `gateway-paths.ts`
   - 只放路径常量
2. `asset-sync.ts`
   - 显式同步函数
3. `asset-sync-worker.ts`
   - 启动期或变更时同步

这样：

1. 所有只需要 `GATEWAY_HOME` 的模块，不会顺手触发整套 asset sync

## 进程拓扑的最终目标

### 近期最小目标

可以暂时仍保持单进程，但必须满足：

1. route handler 纯 DB 查询
2. worker 逻辑不在 route import 图里
3. 无模块顶层重副作用

### 长期正确目标

应该拆成两个进程：

#### 1. Web/API 进程

负责：

1. Next.js 页面
2. REST/WS ingress
3. 轻量查询与命令投递

#### 2. Control-plane worker 进程

负责：

1. scheduler
2. importers
3. projectors
4. run/project reconciliation
5. bridge owner refresh

这样 dev 模式下：

1. Next compile 不会直接把 scheduler 打停
2. scheduler/importer 抖动不会直接拖 API latency

## 最终落地顺序

这套事不能一起做，必须按收益排序。

### Phase 1：真相源与读路径收口

目标：

1. `/api/conversations` 纯 SQLite 读
2. 新增 `run_conversation_links`
3. 新增 `conversation_visibility`
4. 取消请求时 `.pb` / `brain` / protobuf / runs JSON federation

交付后收益：

1. 当前最重的热路径会直接消失
2. control plane 开始真正以 SQLite 为主库

### Phase 2：registry 去副作用 + 增量持久化

目标：

1. 去掉 `loadFromDisk()` 顶层执行
2. 去掉 `saveToDisk()` 全量保存
3. run/project 改成按 key 增量 upsert
4. `project.json` 降级为输出镜像，不再做主同步链

交付后收益：

1. dev 启动抖动显著下降
2. 状态更新不再和整表规模线性绑定

### Phase 3：bridge/importer 正式化

目标：

1. `state.vscdb`、`.pb`、`brain`、gRPC trajectory 改成 importer
2. 导入结果只写 projection/cache
3. route 不再直接依赖这些外部源

交付后收益：

1. provider-neutral control plane 真正成立
2. 外部 runtime 变成输入源，而不是请求链必经依赖

### Phase 4：进程拓扑拆分

目标：

1. scheduler/importer/consumer 从 Next 进程剥离
2. Web/API 与 control worker 分离

交付后收益：

1. dev/prod 行为更一致
2. 服务延迟和后台恢复解耦

## 最后的总体方案

整体上，不建议继续按“哪个接口慢就修哪个接口”的方式推进。

合理的最终方案是：

1. **把 Gateway SQLite 真正收口成控制面的唯一 durable truth**
2. **把外部 Antigravity 状态降级成 ingestion source**
3. **把读接口改成 projection-first**
4. **把 runtime registry 降级成 active cache，不再兼任主库与恢复器**
5. **把后台控制面从请求线程中剥离出来**

## 最终判断

如果只做点状修补：

1. `/api/conversations` 会快一点
2. 但下一次会从 `ownerMap`、`registry`、`asset sync`、`scheduler`、`route import graph` 里再次冒出新的瓶颈

如果按本文方案收口：

1. 性能问题会下降
2. provider-neutral control plane 会更稳
3. dev 态与 prod 态的行为会更可预测
4. 未来迁到独立 Gateway daemon 或 Postgres 也会自然很多

这不是一次微优化，而是一次：

1. **控制面与存储模型的架构收敛**
