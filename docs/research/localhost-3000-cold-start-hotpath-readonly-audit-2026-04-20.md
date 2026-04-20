# localhost:3000 冷启动/首请求剩余热路径污染只读复核

**状态**: ✅ 已完成
**日期**: 2026-04-20
**类型**: 只读架构复核（未改代码）

## 本轮目标

只读复核以下入口是否仍存在会拖慢 `localhost:3000` 冷启动 / 首请求的剩余热路径污染：

1. `src/app/api/conversations/[id]/steps/route.ts`
2. `src/app/api/conversations/[id]/send/route.ts`
3. `src/app/api/conversations/[id]/files/route.ts`
4. `src/app/api/agent-runs/route.ts`
5. `src/app/api/projects/route.ts`

重点确认：

1. 是否还有顶层重 import
2. 是否还有全量扫描
3. 是否会触发：
   - `run-registry.loadFromDisk()`
   - `project-registry.loadFromDisk()`
   - `getConversations()` 全量扫描
4. 最小修复建议是否可以尽量限制在读路径

## 总结结论

本轮确认：**剩余污染仍然明显存在，而且主要不是“算法细节”，而是“入口模块导入时就把重 registry / execution 图一起拉起”，再叠加 conversation record 的全量合并扫描。**

最重的 3 条路径是：

1. `resolveConversationRecord() -> getConversations()` 仍然是 conversation 读入口的首要阻塞点  
   - 会执行：
     - `ls ~/.gemini/antigravity/conversations`
     - `python3 + blackboxprotobuf` 解 SQLite protobuf
     - `listConversationRecords()`
     - `ls ~/.gemini/antigravity/brain`
     - 对脑目录逐个 `head task.md / walkthrough.md`
2. `run-registry` 仍在模块顶层 `loadFromDisk()`  
   - 任何顶层 import `listRuns` 的 route，冷启动首命中都会先全量读 `runs` 表并做恢复检查
3. `/api/agent-runs` 与 `/api/projects` 仍把写路径 / 执行路径依赖一起带进 GET 冷路径  
   - `agent-runs` 的 GET 虽然只是列表，但顶层就 import 了 `dispatch-service` + `prompt-executor`
   - `projects` 的 GET 虽然只是列表，但顶层 import `project-registry`，其模块初始化仍会 `loadFromDisk()`，并可能进一步触发 `AssetLoader.loadAllTemplates()`

## 逐入口结论

| 入口 | 顶层重 import / 热路径污染 | `run-registry.loadFromDisk()` | `project-registry.loadFromDisk()` | `getConversations()` 全量扫描 |
| --- | --- | --- | --- | --- |
| `conversations/[id]/steps` | 有 | 是 | 否 | 是 |
| `conversations/[id]/send` | 有 | 是 | 否 | 是 |
| `conversations/[id]/files` | 有 | 是 | 否 | 是 |
| `agent-runs` | 很重 | 是 | 是 | 否 |
| `projects` | 中到重 | 否 | 是 | 否 |

## 具体慢路径

### 1. `conversations/[id]/steps`

关键链路：

1. route 顶层 import `listRuns`
2. `run-registry.ts` 模块初始化时执行 `loadFromDisk()`
3. 请求进入后先执行 `resolveConversationRecord(cascadeId)`
4. `resolveConversationRecord()` 先走 `getConversationRecord()`
5. `getConversationRecord()` 直接调用 `getConversations().find(...)`

实际代价：

1. 冷启动时先全量恢复 runs
2. 每次请求先全量扫描 conversations 元数据
3. 本地 provider fallback 时还会 `listRuns().find(...)`
4. 远端 provider fallback 时还会：
   - `getAllConnections()`
   - `discoverLanguageServers()` 的 `ps aux + lsof`
   - 对所有 server 顺序 `LoadTrajectory + GetCascadeTrajectorySteps`

证据：

1. `src/app/api/conversations/[id]/steps/route.ts:2-3,29,44-50,55-61`
2. `src/lib/bridge/statedb.ts:60-70,191-299`
3. `src/lib/agents/run-registry.ts:129-186,464-485`
4. `src/lib/bridge/gateway.ts:37-42`
5. `src/lib/bridge/discovery.ts:93-157`

### 2. `conversations/[id]/send`

关键链路：

1. route 顶层 import：
   - `getExecutor`
   - `api-provider-conversations`
   - `listRuns`
2. 这让 send 路由即使只是普通远端会话，也会先加载本地 provider / API provider / run registry 相关模块图
3. 请求进入后仍然先 `resolveConversationRecord(cascadeId)`
4. 本地 provider 分支还会 `listRuns().find(...)`
5. 远端 provider 分支在 owner map 过旧时会 `refreshOwnerMap()`
   - 顺序扫所有 server 的 `GetAllCascadeTrajectories`

实际代价：

1. 冷启动时有 run-registry 顶层恢复
2. 每次请求有 `getConversations()` 全量扫描
3. 本地 provider 分支会把更重的 executor / Claude Engine 对话路径提前装入
4. 远端 provider 分支在 owner map miss/stale 时会做全量 server refresh

证据：

1. `src/app/api/conversations/[id]/send/route.ts:2-22,54-68,74-111,127,164-166`
2. `src/lib/providers/index.ts:23-40,60-77`
3. `src/lib/api-provider-conversations.ts:1-15,135-176`
4. `src/lib/bridge/gateway.ts:73-90,93-180`
5. `src/lib/agents/run-registry.ts:129-186`

### 3. `conversations/[id]/files`

关键链路：

1. route 顶层 import `listRuns`
2. 冷启动时仍先触发 `run-registry.loadFromDisk()`
3. 请求进入先 `resolveConversationRecord(id)`
4. 然后无论 conversation record / owner connection 是否已足够，还会 `listRuns().find(...)`
5. 最后直接对 workspace 跑一次递归 `find`

实际代价：

1. 冷启动污染：
   - run registry 恢复
   - conversation 全量扫描
2. 运行期热点：
   - 为找一个 backing run，先把全部 runs 排序再 `.find`
   - 文件搜索直接递归整个 workspace；`q=''` 时最差会近似列全量文件

证据：

1. `src/app/api/conversations/[id]/files/route.ts:2-4,18-21,39-51`
2. `src/lib/agents/run-registry.ts:464-485`
3. `src/lib/bridge/statedb.ts:68-70,191-299`

### 4. `agent-runs`

这是当前名单里**顶层 import 污染最重**的入口。

关键链路：

1. route 顶层 import：
   - `dispatch-service`
   - `prompt-executor`
   - `listRuns`
2. `dispatch-service` 顶层又 import：
   - `group-runtime`
   - `project-registry`
   - `AssetLoader`
3. `prompt-executor` 顶层又 import：
   - `project-registry`
   - `run-registry`
   - `backends`
   - `department-execution-resolver`
   - `knowledge`
4. `project-registry` 模块初始化时立刻 `loadFromDisk()`
5. `run-registry` 模块初始化时立刻 `loadFromDisk()`
6. GET 本身还会：
   - `listRuns()`
   - 对每个 run 调两次 `getStageDefinition()`
   - 首次 `getStageDefinition()` 可能触发 `AssetLoader.loadAllTemplates()`
   - `AssetLoader` 会读完整个 templates 目录、校验并预编译 IR

实际代价：

1. 冷启动即使只打 `GET /api/agent-runs`，也会把 POST 执行图带进来
2. 还会顺带恢复 projects + runs
3. 首次列表还可能做全模板扫描/验证/IR 预编译
4. 对 run 数量大时，`getStageDefinition()` 还会在 map 阶段重复调用

证据：

1. `src/app/api/agent-runs/route.ts:2-7,154-188`
2. `src/lib/agents/dispatch-service.ts:12-23,99-100,167-170`
3. `src/lib/agents/prompt-executor.ts:4-49,372-390`
4. `src/lib/agents/run-registry.ts:129-186`
5. `src/lib/agents/project-registry.ts:49-90`
6. `src/lib/agents/stage-resolver.ts:12-15`
7. `src/lib/agents/asset-loader.ts:32-89,151-166`

### 5. `projects`

关键链路：

1. route 顶层 import `project-registry`
2. `project-registry` 顶层 `loadFromDisk()`
3. `loadFromDisk()` 先 `listProjectRecords()`
4. 对每个带 `pipelineState.templateId` 的 project，调用 `AssetLoader.getTemplate()`
5. 首个 `getTemplate()` 会触发 `loadAllTemplates()`
   - 读完整个 templates 目录
   - JSON parse
   - 校验 pipeline / contracts
   - 预编译 IR

实际代价：

1. 冷启动 GET /api/projects 并不轻
2. 它会把 project registry 恢复 + template 目录加载叠在一起

证据：

1. `src/app/api/projects/route.ts:2,23-24`
2. `src/lib/agents/project-registry.ts:49-90,144-145`
3. `src/lib/storage/gateway-db.ts:158-170,196-205`
4. `src/lib/agents/asset-loader.ts:32-89,151-166`

## 关键基础模块结论

### A. `getConversations()` 仍是最重的全量扫描

它不是普通内存遍历，而是混合了多种阻塞式 I/O：

1. `.pb` 目录扫描：`src/lib/bridge/statedb.ts:194-213`
2. `python3` + `blackboxprotobuf` 解码 SQLite protobuf：`src/lib/bridge/statedb.ts:299-360`
3. 本地会话缓存全表读取：`src/lib/bridge/statedb.ts:230-239`
4. `brain` 目录扫描并对每个目录 `head task.md / walkthrough.md`：`src/lib/bridge/statedb.ts:242-287`

这意味着：

1. `resolveConversationRecord()` 不是 O(1) record lookup
2. 它实际上是一个“全量聚合 conversations 列表”的重函数
3. 不应继续放在 id 级别读接口的热路径上

### B. `run-registry.loadFromDisk()` 仍是冷启动常驻污染

关键事实：

1. `loadFromDisk()` 在模块顶层执行：`src/lib/agents/run-registry.ts:129-186`
2. 首次导入就会：
   - 打开 `better-sqlite3`：`src/lib/storage/gateway-db.ts:158-170`
   - `SELECT payload_json FROM runs` 全量读出：`src/lib/storage/gateway-db.ts:248-257`
   - 对每个非终态 run 做 artifact 恢复检查：`src/lib/agents/run-registry.ts:142-179`
3. `listRuns()` 只是列表，但为了单个 lookup 仍会先 `sort` 全量 runs：`src/lib/agents/run-registry.ts:464-485`

### C. `project-registry.loadFromDisk()` 仍把模板系统带进冷路径

关键事实：

1. `loadFromDisk()` 模块顶层执行：`src/lib/agents/project-registry.ts:49-90`
2. 它不只是读 project rows
3. 它还会在恢复时拿 template 去补 stage title：`src/lib/agents/project-registry.ts:68-80`
4. `AssetLoader.getTemplate()` 首次调用会扫完整个模板目录并预编译 IR：`src/lib/agents/asset-loader.ts:32-89,151-166`

## 最小修复建议（尽量限定在读路径）

### P0. 把 id 级会话路由从 `resolveConversationRecord() -> getConversations()` 脱钩

适用入口：

1. `conversations/[id]/steps`
2. `conversations/[id]/send`
3. `conversations/[id]/files`

建议：

1. 先对原始 `id` 做 `inferLocalProviderFromConversation(id)` 前置判断
2. 如果 `id` 明显是 `native-codex-* / codex-* / claude-api-* / ...` 这类 handle：
   - 不要先走 `resolveConversationRecord()`
   - 先走本地 alias/session lookup
3. 仅 `conversation-*` 这种 viewer alias，才做 conversation record lookup
4. 新增一个 **轻量单记录查询** helper，专门服务 id/handle 路由
   - 不复用 `getConversations()`
   - `getConversations()` 只保留给 conversations 列表接口

收益：

1. 直接切掉每个 id 级读接口的全量会话扫描
2. 不碰实际执行逻辑

### P0. 把 `agent-runs` 的 GET 从 POST 执行图剥离

建议：

1. `executeDispatch` / `executePrompt` 改为 `POST()` 内部 lazy import
2. `GET /api/agent-runs` 只保留轻量 run 读取依赖
3. 最稳妥的版本是新增 read-only query helper，直接面向 storage / registry 读列表

收益：

1. GET 列表不再冷启动时把 `group-runtime` / `prompt-executor` / `backends` 整图拉起
2. 不改 dispatch 行为

### P0. 把 `projects` 的 GET 从 `project-registry.loadFromDisk()` 脱钩

建议：

1. `GET /api/projects` 走 storage-only 读 helper
2. 不要为了列表页在模块初始化时恢复整套 project registry
3. stage title 的 template 补齐改成：
   - 惰性补齐
   - 或仅在 detail 路由补齐

收益：

1. 列表页首请求不再顺带加载全模板系统

### P1. 停止用 `listRuns().find(...)` 做单条 run 关联

适用入口：

1. `conversations/[id]/steps`
2. `conversations/[id]/send`
3. `conversations/[id]/files`

建议：

1. 新增 unsorted getter：
   - `findRunByConversationHandle`
   - `findRunByChildConversationId`
2. 或至少提供不排序的遍历 helper

原因：

1. 当前 `listRuns()` 会先把全量 runs 复制并排序，再只取一条
2. 这是纯读路径可去掉的无效成本

### P1. `steps` 远端路径优先 owner lookup，避免默认全 server 顺序探测

建议：

1. 先 `getOwnerConnection(cascadeId)`
2. 只有 owner 未命中时，才回退到 `getAllConnections()` 全探测

收益：

1. 避免 `GET /steps` 首请求默认对所有 server 顺序 `LoadTrajectory + GetCascadeTrajectorySteps`

### P1. `agent-runs` GET 的 stage/template 补充信息改为惰性或 memoize

建议：

1. 每个 run 只算一次 `getStageDefinition()`
2. 同一个 `templateId + stageId` 做 request-scope memoize
3. `executionProfileSummary` 可改成按 query param 显式请求

收益：

1. 切掉首次 runs 列表的模板重复解析
2. 降低 AssetLoader 首次命中后的重复查找成本

### P2. 给 `getConversationsFromProtobuf()` 加 TTL / mtime cache

说明：

1. 这是读路径内部优化
2. 仍不建议继续把它挂在 id 级路由上
3. 但即使保留在 conversations 列表页，也至少不应每次都 `spawnSync('python3', ...)`

## 复核后的优先级判断

### 最高优先级剩余污染

1. `resolveConversationRecord()` 误用 `getConversations()` 作为单记录 lookup
2. `agent-runs` GET 顶层 import POST 执行图
3. `projects` GET 顶层 import registry 恢复图

### 次高优先级

1. `listRuns().find(...)` 先排序再查一条
2. `steps` 远端路径对所有 server 顺序探测
3. `files` 路由对 workspace 直接递归 `find`

## 最终判断

如果只问“剩余导致 `localhost:3000` 冷启动 / 首请求很慢的污染还在不在”，答案是：

1. **还在**
2. 而且当前最确定的残留，不在复杂 execution 细节里
3. 主要还在：
   - conversation 单记录读路径误走全量聚合
   - GET 路由顶层 import 了不该在列表/查询首请求里加载的 registry / execution 图

因此下一轮最小、最稳、最值回票价的动作应该是：

1. 先把 `resolveConversationRecord` 从 id 级读接口拿掉
2. 再把 `/api/agent-runs` 与 `/api/projects` 的 GET 路径和 POST/registry 恢复路径拆开
3. 最后再处理 `listRuns().find(...)` 和 `steps` 的 owner/server 探测顺序
