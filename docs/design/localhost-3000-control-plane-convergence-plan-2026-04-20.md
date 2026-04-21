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

## 面向落地的 Node 前后端分离实施蓝图

### 方案选型结论

本轮收尾建议明确选择下面这条路线：

1. **语言先不变，继续使用 `Node.js + TypeScript`**
2. **优先做前后端分离与后台进程隔离，而不是先做 Go 迁移**
3. **保持单仓库，但把运行时拆成多进程**
4. **本文作为本次收尾工作的唯一母文档**

这里的“前后端分离”指的是：

1. 前端 `web` 不再兼任 scheduler / bridge / registry 恢复器
2. 控制面 API 不再寄生在 Next route handler 里直接访问重模块
3. runtime / scheduler 作为独立进程运行

这里**不**要求一上来就做大规模目录搬家。更稳的做法是：

1. 先完成**进程边界分离**
2. 再完成**服务层与 contracts 收口**
3. 最后再决定是否把目录物理迁到 `apps/*` / `packages/*`

也就是说，本轮优先级是：

1. **边界正确**
2. **接口正确**
3. **生命周期正确**
4. **最后才是目录好看**

### 文档治理约束

为了避免“每个问题一个文档”的失控状态，本轮执行遵守下面规则：

1. **本文是唯一实施母文档**
2. 后续开发任务、提交说明、验收记录都引用本文的 `Phase` / `Checklist` 编号
3. 不再为每个小修复单独新增 research 文档
4. 只有下面两类情况允许新增文档：
   1. 阶段验收报告
   2. 重大架构变更被本方案明确升级

## 目标进程拓扑

### 推荐终态

推荐终态是 `4` 个 Node 进程：

1. `web`
   - Next.js 页面、静态资源、SSR/RSC、非常薄的同源代理层
2. `control-plane`
   - REST API、DTO 转换、SQLite 读写、业务命令入口
3. `runtime`
   - Antigravity / provider / bridge / 会话观察 / Language Server 集成
4. `scheduler`
   - scheduler、fan-out、importer、reconciler、approval/CEO 后台消费

### 为什么不是 2 个进程

如果只拆成 `web + backend` 两个进程，仍然会把：

1. 控制面 API
2. runtime provider 集成
3. scheduler/importer 后台任务

继续挤在一个后端进程里。

这虽然比现在好，但还不够稳。因为：

1. runtime 会继续拉起子进程、连接 IDE、观察会话
2. scheduler/importer 会继续做恢复、扫描、对账
3. control-plane API 还是会被后台抖动拖慢

所以更合理的是 `web / control-plane / runtime / scheduler` 四平面。

### 最小可接受过渡态

如果一次拆四个入口工作量过大，可以接受一个过渡态：

1. `web`
2. `control-plane`
3. `runtime+scheduler`

但这个过渡态只能作为**短期桥接**，不能作为最终形态。

## 模块归属矩阵

### Web

以下模块最终应归 `web`：

1. `src/app/*`
2. `src/components/*`
3. `src/hooks/*`
4. `src/lib/api.ts`
5. `src/lib/app-url-state.ts`
6. `src/lib/home-shell.ts`
7. `src/lib/i18n/*`

`web` 的硬约束：

1. 不初始化 scheduler
2. 不初始化 bridge worker
3. 不直接 import `run-registry.ts` / `project-registry.ts` / `statedb.ts`
4. 不直接读 `.pb` / `brain` / `state.vscdb`

### Control Plane

以下模块最终应归 `control-plane`：

1. `src/app/api/agent-runs/*`
2. `src/app/api/projects/*`
3. `src/app/api/conversations/*`
4. `src/app/api/scheduler/jobs/*`
5. `src/app/api/management/*`
6. `src/lib/storage/gateway-db.ts`
7. `src/lib/pagination.ts`
8. `src/lib/project-utils.ts`
9. `src/lib/management/*`
10. `src/lib/organization/ceo-profile-store.ts`
11. `src/lib/organization/ceo-event-store.ts`

`control-plane` 的硬约束：

1. 列表接口只查 SQLite projection
2. route/service 不直接调用 shell
3. route/service 不直接调用 Python
4. route/service 不直接扫描 `.pb` / `brain`
5. route/service 不直接做 Language Server 发现

### Runtime

以下模块最终应归 `runtime`：

1. `src/lib/providers/*`
2. `src/lib/backends/*`
3. `src/lib/bridge/*`
4. `src/lib/agents/group-runtime.ts`
5. `src/lib/agents/watch-conversation.ts`
6. `src/lib/agents/prompt-executor.ts`
7. `src/lib/agents/dispatch-service.ts`
8. `src/lib/agents/result-parser.ts`
9. `src/lib/agents/run-artifacts.ts`

`runtime` 的硬约束：

1. `provider=antigravity` 时继续走现有 Antigravity 逻辑
2. 不改 `startCascade / send / cancel / updateConversationAnnotations` 现有语义
3. 不写 `state.vscdb`
4. 不写删 IDE 的 `.pb` / `brain` 文件

### Scheduler / Workers

以下模块最终应归 `scheduler`：

1. `src/lib/agents/scheduler.ts`
2. `src/lib/agents/fan-out-controller.ts`
3. `src/lib/agents/approval-triggers.ts`
4. `src/lib/organization/ceo-event-consumer.ts`
5. `src/lib/bridge/conversation-importer.ts`
6. `src/lib/agents/project-reconciler.ts`

`scheduler` 的硬约束：

1. 不在 `web` 进程内启动
2. 不在 `control-plane` 进程内隐式恢复
3. 只通过显式 entrypoint 和显式 feature flag 启动

### Shared Contracts / Core

以下内容应抽成共享 contracts/core：

1. API DTO
2. 分页模型
3. 事件模型
4. provider-neutral conversation/run/project summary 类型
5. runtime internal command / response schema

## 目录落地策略

### 第一阶段：先逻辑拆分，不强制物理搬家

第一阶段建议仍保留当前目录主体，只新增下面几类入口和服务层：

1. `src/entrypoints/web-server.ts`
2. `src/entrypoints/control-plane.ts`
3. `src/entrypoints/runtime.ts`
4. `src/entrypoints/scheduler.ts`
5. `src/contracts/*`
6. `src/server/control-plane/*`
7. `src/server/runtime/*`
8. `src/server/workers/*`

这样可以先把行为边界拆开，而不用立刻在全仓库里改 import 路径。

### 第二阶段：稳定后再选择是否搬到 monorepo 目录

如果第一阶段稳定，再决定是否进一步迁到：

1. `apps/web`
2. `apps/control-plane`
3. `apps/runtime`
4. `apps/scheduler`
5. `packages/contracts`
6. `packages/core`

这一步不是本轮收尾的前置条件。

## 详细实施清单

### Phase 0：基线冻结与切换护栏

目标：

1. 把现状测清楚
2. 把切换边界钉死
3. 确保迁移期间不误伤 Antigravity IDE

Checklist：

- [ ] 记录当前 `web` / `server.ts` / route handler 的启动路径图
- [ ] 记录当前 `/api/agent-runs`、`/api/projects`、`/api/conversations`、`/api/conversations/:id/steps` 的响应时间与响应体大小
- [ ] 确认所有现存启用中的 scheduler job 清单，并建立启动时不自动恢复的预期
- [ ] 增加角色开关：`AG_ROLE=web|control-plane|runtime|scheduler`
- [ ] 增加桥接开关：`AG_DISABLE_BRIDGE_WORKER=1`
- [ ] 增加导入器开关：`AG_ENABLE_IMPORTERS=0|1`
- [ ] 增加 scheduler 开关：`AG_ENABLE_SCHEDULER=0|1`
- [ ] 为 Antigravity 路径补兼容性红线测试

涉及模块：

1. `server.ts`
2. `src/lib/agents/gateway-home.ts`
3. `src/lib/agents/run-registry.ts`
4. `src/lib/agents/project-registry.ts`
5. `src/lib/agents/scheduler.ts`
6. `src/lib/bridge/gateway.ts`

验收标准：

1. 能在不启动 scheduler/runtime 的情况下单独起 `web`
2. 能在不启动 `web` 的情况下单独起 `control-plane`
3. 兼容性红线在自动化测试里被显式表达

### Phase 1：Contracts 与列表接口收口

目标：

1. 停止把内部状态对象直接暴露给前端
2. 一次性修掉“应该分页但没分页”的设计
3. 为响应体瘦身建立统一规范

Checklist：

- [ ] 新建共享 DTO：`RunSummary`、`RunDetail`、`ProjectSummary`、`ProjectDetail`、`ConversationSummary`、`ConversationDetail`
- [ ] 新建统一分页模型：`PaginationQuery`、`PaginatedResponse<T>`
- [ ] 为 `agent-runs`、`projects`、`conversations` 全量接入默认分页和 `maxPageSize`
- [ ] 为大字段建立 detail-only 规则
- [ ] 从列表接口中移除无效字段、重复字段、调试字段
- [ ] 明确 `summary` 与 `detail` 的字段边界
- [ ] 为前端 API client 加字段契约测试

重点接口：

1. `GET /api/agent-runs`
2. `GET /api/projects`
3. `GET /api/conversations`
4. `GET /api/conversations/:id/steps`
5. `GET /api/scheduler/jobs`

涉及模块：

1. `src/app/api/agent-runs/*`
2. `src/app/api/projects/*`
3. `src/app/api/conversations/*`
4. `src/app/api/scheduler/jobs/*`
5. `src/lib/api.ts`
6. `src/lib/pagination.ts`
7. `src/lib/storage/gateway-db.ts`

验收标准：

1. 所有列表接口默认分页
2. `/api/agent-runs` 默认列表响应体不再出现多 MB 级别
3. 前端列表页不再依赖 detail-only 字段

### Phase 2：SQLite 读模型与热字段前置

目标：

1. 真正让 SQLite 成为查询型主库
2. 停止在热路径上扫 `payload_json`
3. 为 `conversations`、`run_conversation_links`、`conversation_visibility` 做完整物化

Checklist：

- [ ] 为 `runs` 表前置热字段并补索引
- [ ] 为 `projects` 表前置热字段并补索引
- [ ] 完整启用 `conversations` 作为唯一列表查询入口
- [ ] 完整启用 `run_conversation_links`
- [ ] 完整启用 `conversation_visibility`
- [ ] 完整启用 `conversation_owner_cache`
- [ ] 为 `childConversationId`、`activeConversationId`、`sessionProvenance.handle` 做 backfill
- [ ] 为历史数据编写一次性 backfill 脚本
- [ ] 为新写入路径增加 dual-write，直到读路径切换完成

涉及模块：

1. `src/lib/storage/gateway-db.ts`
2. `src/lib/agents/run-registry.ts`
3. `src/lib/agents/project-registry.ts`
4. `src/lib/bridge/conversation-importer.ts`
5. `src/app/api/conversations/*`

验收标准：

1. `/api/conversations` 只查 SQLite projection
2. 请求路径上不再调用 `.pb` 扫描、`brain` 扫描、`state.vscdb` 读取、`runs.payload_json` 全表 JSON 联表
3. 历史 conversation 与 run 关系能通过索引查询恢复

### Phase 3：Web 与后台初始化隔离

目标：

1. 首页和普通页面加载不再带出后台恢复噪音
2. `web` 进程不再成为半个 daemon
3. 模块顶层副作用清零

Checklist：

- [ ] 把 `server.ts` 改成纯 role launcher，禁止顶层初始化重模块
- [ ] 把 `gateway-home.ts` 拆成 `paths` 与 `asset-sync`
- [ ] 去掉 `run-registry.ts` 顶层 `loadFromDisk()`
- [ ] 去掉 `project-registry.ts` 顶层 `loadFromDisk()`
- [ ] 去掉任何 import-time 的 scheduler 恢复
- [ ] 去掉任何 import-time 的 bridge worker 拉起
- [ ] 明确每个服务的 `initialize/start/shutdown` 生命周期

涉及模块：

1. `server.ts`
2. `src/lib/agents/gateway-home.ts`
3. `src/lib/agents/run-registry.ts`
4. `src/lib/agents/project-registry.ts`
5. `src/lib/agents/scheduler.ts`
6. `src/lib/agents/fan-out-controller.ts`
7. `src/lib/agents/approval-triggers.ts`
8. `src/lib/organization/ceo-event-consumer.ts`

验收标准：

1. `web` 单独启动时不再初始化 scheduler / registry / bridge worker
2. `npm run start` 的 `web` 角色日志不再出现后台恢复噪音
3. 首页打开时不再新建额外 Node 后台进程

### Phase 4：Control-plane API 服务化

目标：

1. 把 route handler 变成薄入口
2. 让控制面 API 独立于 Next 生命周期
3. 把读写逻辑从页面框架中拆出去

Checklist：

- [ ] 新建独立 `control-plane` server entrypoint
- [ ] 把 `agent-runs`、`projects`、`conversations`、`scheduler/jobs`、`management/overview` 抽成 service/repository
- [ ] route handler 在过渡期仅作为 proxy 或 adapter
- [ ] 前端 `src/lib/api.ts` 改成通过统一 base URL 访问 control-plane
- [ ] 为 `summary/detail` 接口补 contract tests
- [ ] 为 `POST/PUT/DELETE` 命令接口补幂等和错误语义测试

涉及模块：

1. `src/app/api/*`
2. `src/lib/api.ts`
3. `src/lib/storage/gateway-db.ts`
4. `src/lib/management/*`
5. 新增 `src/server/control-plane/*`

验收标准：

1. 关闭 Next route handler 直连实现后，前端仍可正常工作
2. `control-plane` 单独启动即可支撑主要列表页与详情页
3. `web` 与 `control-plane` 能通过本地代理或环境变量切换

### Phase 5：Runtime 服务化与 Antigravity 兼容隔离

目标：

1. 把 IDE/provider/bridge 细节收回 runtime
2. 不影响原生 Antigravity IDE 正常运行
3. 让 control-plane 对 provider 细节只见合同，不见实现

Checklist：

- [ ] 定义 runtime internal API：`startRun`、`appendMessage`、`cancelRun`、`getSteps`、`resolveOwner`、`discoverLanguageServers`
- [ ] 把 Antigravity gRPC 适配逻辑全部压到 runtime service
- [ ] 把 `native-codex`、`codex`、其他 provider 统一成同类适配器
- [ ] 把 `group-runtime` 中的 provider-specific 分支拆走
- [ ] 把 `watch-conversation` 作为 runtime 能力暴露，而不是 page/API 直接 import
- [ ] 为 `provider=antigravity` 增加兼容回归测试

涉及模块：

1. `src/lib/providers/*`
2. `src/lib/backends/*`
3. `src/lib/bridge/*`
4. `src/lib/agents/group-runtime.ts`
5. `src/lib/agents/watch-conversation.ts`
6. `src/lib/agents/dispatch-service.ts`
7. `src/lib/agents/prompt-executor.ts`

验收标准：

1. 选择 Antigravity 时，Language Server 发现仍可用
2. 选择 Antigravity 时，启动 conversation / send / cancel / step watch 仍可用
3. 选择非 Antigravity provider 时，不再意外触发 Antigravity 路径

### Phase 6：Scheduler / Importer / Reconciler 独立进程化

目标：

1. 把后台任务从请求线程彻底剥离
2. 把外部状态读取改成后台导入，而不是请求时拼装
3. 让 dev/prod 的后台行为可控

Checklist：

- [ ] 新建 `scheduler` entrypoint
- [ ] 把 scheduler tick loop 从 `web` / `control-plane` 中拿掉
- [ ] 把 owner refresh 改成后台 importer/cache refresh
- [ ] 把 `.pb` / `brain` / `state.vscdb` 读取改成 importer job
- [ ] 把 reconciler / fan-out / approval triggers 改成 worker-only
- [ ] 为后台任务补唯一实例与重复启动保护
- [ ] 增加 job 恢复与关闭行为测试

涉及模块：

1. `src/lib/agents/scheduler.ts`
2. `src/lib/agents/fan-out-controller.ts`
3. `src/lib/agents/project-reconciler.ts`
4. `src/lib/bridge/conversation-importer.ts`
5. `src/lib/bridge/statedb.ts`
6. `src/lib/organization/ceo-event-consumer.ts`

验收标准：

1. `web` 和 `control-plane` 不再读外部 runtime 存储
2. 关闭 `scheduler` 进程时，页面仍可读已有 projection
3. 开启 `scheduler` 进程时，只做后台增量刷新，不阻塞请求

### Phase 7：前端切换、用户旅程补齐与旧路径清理

目标：

1. 完成前端对新后端的接入
2. 补齐用户旅程中的断裂点
3. 删除已被替代的旧实现

Checklist：

- [ ] 前端所有列表页切到新的分页接口
- [ ] 详情页按需拉 detail endpoint，不再从列表缓存里偷字段
- [ ] 首页、项目页、会话页、调度页补 loading / empty / degraded 状态
- [ ] 对 runtime 不可达、scheduler 关闭、conversation 尚未投影完成等情况补 UI 提示
- [ ] 删除旧的 route-time federation 逻辑
- [ ] 删除不再使用的 shell/Python bridge 只读兜底
- [ ] 删除 Next route handler 里残留的重逻辑

涉及模块：

1. `src/components/home-overview.tsx`
2. `src/components/agent-runs-panel.tsx`
3. `src/components/projects-panel.tsx`
4. `src/components/chat.tsx`
5. `src/components/scheduler-panel.tsx`
6. `src/lib/api.ts`
7. `src/app/api/*`

验收标准：

1. 首页旅程、项目旅程、会话旅程在控制面不可用时都能给出明确状态
2. 列表页与详情页的加载策略清晰可预测
3. 旧路径删除后，没有回退到 request-time federation

## 迁移策略

### 推荐切换顺序

切换顺序必须遵守下面规则：

1. **先加表和 backfill**
2. **再 dual-write**
3. **再切读**
4. **最后删旧**

具体顺序：

1. 先做 `contracts + pagination + DTO`
2. 再做 `SQLite schema + backfill`
3. 再做 `web` 去副作用
4. 再起 `control-plane`
5. 再起 `runtime`
6. 再起 `scheduler`
7. 最后删除 Next 里的旧 route-time 实现

### 绝不能反过来做的事

下面几件事禁止先做：

1. 不要先全仓库搬目录
2. 不要先改语言
3. 不要先删旧路径而没有 dual-write/backfill
4. 不要先把 Antigravity 逻辑抽空再谈兼容

## 测试与验收清单

### 自动化测试

- [ ] 为分页与 DTO 建立 contract tests
- [ ] 为 SQLite backfill 建立 migration tests
- [ ] 为 `web` 单独启动建立 smoke test
- [ ] 为 `control-plane` 单独启动建立 smoke test
- [ ] 为 `runtime` 单独启动建立 smoke test
- [ ] 为 `scheduler` 单独启动建立 smoke test
- [ ] 为 Antigravity provider 建立兼容回归测试
- [ ] 为 `agent-runs/projects/conversations` 的 summary/detail 组合建立 API tests

### 手工验收

- [ ] 只启动 `web` 时，首页可打开，且不会起后台 worker
- [ ] 启动 `web + control-plane` 时，列表页可正常浏览
- [ ] 启动 `web + control-plane + runtime` 时，Antigravity 会话可正常创建和观察
- [ ] 启动全套服务时，不再出现 5s interval job 风暴
- [ ] 切到非 Antigravity provider 时，不再误走 Antigravity 逻辑

### 性能门槛

以下门槛按**本地开发热态**定义，不把首次 Next compile 算进去：

1. `GET /api/agent-runs?page=1&pageSize=50`
   - 目标：`< 200ms`
   - 响应体：`< 1MB`
2. `GET /api/projects?page=1&pageSize=50`
   - 目标：`< 150ms`
   - 响应体：`< 512KB`
3. `GET /api/conversations?workspace=...&page=1&pageSize=50`
   - 目标：`< 200ms`
   - 响应体：`< 512KB`
4. `GET /api/conversations/:id/steps`
   - 目标：detail endpoint 可接受较慢，但必须支持增量加载或分页
5. `web` 启动
   - 目标：不初始化 scheduler / bridge worker / importer

## 完成定义

只有当下面条件全部满足，才算本轮“前后端分离收尾完成”：

1. `web` 不再承载后台恢复、副作用初始化和进程编排
2. `control-plane` 成为唯一业务 API 入口
3. `runtime` 成为唯一 provider / IDE / bridge 入口
4. `scheduler` 成为唯一后台任务入口
5. SQLite 成为唯一 durable query truth
6. `/api/conversations`、`/api/agent-runs`、`/api/projects` 全部 projection-first
7. Antigravity IDE 正常运行未受破坏
8. 不再为每个小问题持续新增平行文档

## 一句话收尾建议

如果目标是“一次性解决并收尾”，最稳的路线不是先换 Go，而是：

1. **继续用 Node**
2. **把前后端与后台进程边界一次性拆清**
3. **把 SQLite 和 contracts 收口成真正的控制面基础设施**
