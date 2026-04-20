# localhost:3000 开发态慢问题深度根因分析

**状态**: ✅ 已完成  
**日期**: 2026-04-20  
**类型**: 开发态运行时深度根因研究  
**关联文档**:

1. `docs/research/localhost-3000-performance-remediation-2026-04-20.md`
2. `docs/research/localhost-3000-cold-start-hotpath-readonly-audit-2026-04-20.md`

## 结论优先

当前 `localhost:3000` 开发态这组：

1. `GET /api/agent-runs`
2. `GET /api/projects`
3. `GET /api/conversations/:id/steps`

在修掉 API 读路径污染后，之所以还会一起慢到 `4s - 6s`，**主因已经不是接口自身查询逻辑**，而是：

1. **开发态单进程 Node 事件循环被后台 scheduler 风暴持续占住**
2. **run/project registry 每次状态变化都做同步全量持久化，形成写放大**
3. **Next dev 首次编译仍有额外冷成本，尤其 `/steps` 路由图更重**

换句话说，用户看到的 `4.3s / 4.3s / 4.3s`，本质上更像：

1. 请求进入 `3000` 后，先在队列里等主线程空下来
2. 真正进入 handler 以后，接口逻辑本身只花了几十到几百毫秒

## 本轮核心发现

### 1. 存储读路径已经不是主瓶颈

本轮直接对真实数据集做只读实测：

1. `storage.sqlite` 打开 + 计数查询：
   - `3ms`
2. `listProjectRecords()`：
   - `4ms`
3. `findRunRecordByConversationRef(...)`：
   - `37ms`
4. `listRunRecordsByFilter()`：
   - `190ms`

对应真实数据量：

1. `projects = 154`
2. `runs = 3869+`
3. `conversation_sessions = 110`

说明：

1. 修复后的 SQLite 定点查询与列表查询，已经不可能单独解释 `4s+`
2. 真实慢点不在 DB 读路径本身

### 2. 空数据开发态没有复现 `4s+`

本轮起了一个全新 dev 实例，使用空 `AG_GATEWAY_HOME`：

1. `GET /api/agent-runs`
   - 首次 `1.428s`
   - 热请求 `0.020s`
2. `GET /api/projects`
   - 首次 `0.829s`
   - 热请求 `0.023s`

并且 Next dev 日志明确显示：

1. 慢主要来自 `compile`
2. 热后请求已经下降到几十毫秒

说明：

1. 代码修复后的接口，在“没有后台历史负担”的开发态里是健康的
2. `3000` 现象依赖真实运行态数据与后台任务，不是单纯 dev 模式固定慢

### 3. 真实数据集下，第二轮请求卡住时，handler 实际执行并不慢

本轮在真实 `~/.gemini/antigravity/gateway` 数据集上复现：

#### 第一轮

1. `GET /api/agent-runs`
   - `200 0.746308`
2. `GET /api/projects`
   - `200 0.251310`
3. `GET /api/conversations/native-codex-.../steps`
   - `200 2.160492`

#### 紧接着第二轮

1. `GET /api/agent-runs`
   - `200 5.923122`
2. `GET /api/projects`
   - `200 5.844693`
3. `GET /api/conversations/native-codex-.../steps`
   - `200 5.888763`

但是同一时段 server 端自己的 Next dev 日志显示，这三个请求真正进入 handler 后的耗时分别只有：

1. `/api/projects`
   - `200 in 298ms`
2. `/api/agent-runs`
   - `200 in 381ms`
3. `/api/conversations/.../steps`
   - `200 in 45ms`

这说明：

1. `curl` 看到的 `5.8s` 不是 handler 内部算出来的
2. 请求主要耗在**进入 handler 之前**
3. 更准确地说，是 **Node 单线程在处理别的同步工作，请求被排队了**

## 真正主因

### 主因 A：scheduler 存在 11 个 `5s` interval job，持续触发 prompt dispatch

本轮直接查 `scheduled_jobs`：

1. 当前启用的 `interval <= 5000ms` job 数量：
   - `11`
2. 其中大部分都是：
   - `dispatch-prompt`
3. 还有一个：
   - `health-check`

典型条目包括：

1. `市场部 Prompt 任务 · 每隔5秒`
2. `AI情报工作室 标准调度测试 · 每隔5秒`
3. `OPC 可视化检查 · 循环健康巡检`

代码层面，`scheduler.ts` 的 `tick()` 是：

1. 先筛出所有 due jobs
2. 再 `for (const job of dueJobs) await triggerScheduledJob(job.jobId)`

也就是：

1. **串行执行**
2. **不是并发让出主线程**

这意味着只要 due jobs 扎堆，`3000` 这个单进程 dev server 就会不断进入：

1. 执行调度任务
2. 创建/更新 run
3. 写 SQLite
4. 写 run history / project 状态
5. 再执行下一个 due job

### 主因 B：run registry 每次更新都全量重刷全部 runs

`src/lib/agents/run-registry.ts` 的 `saveToDisk()` 行为是：

1. `Array.from(runs.values())`
2. 遍历所有 run
3. 对每一个 run 调 `upsertRunRecord(run)`

这不是增量写，而是：

1. **任何一条 run 状态变化**
2. 都会把内存里的**全部 run**再写一遍

本轮基于真实数据副本做了持久化基准：

1. `runCount = 3942`
2. 单次“把全部 runs 再 upsert 一遍”：
   - `284ms`

而一次 `dispatch-prompt` 在当前日志里至少会触发：

1. `Run created`
2. `Run updated -> starting`
3. `Run updated -> running`

也就是单个 scheduler prompt job 的最小同步写盘成本，大致就是：

1. `3 * 284ms ≈ 852ms`

这还**没算**：

1. `completed / blocked / failed` 等后续状态
2. `run-history`
3. `knowledge assets`
4. 其他 project event 副作用

### 主因 C：project registry 每次 stage 变化也会全量重刷全部 projects

`src/lib/agents/project-registry.ts` 的 `saveToDisk()` 也是同一模式：

1. 遍历全部 project
2. 全量 `upsertProjectRecord(project)`
3. 还会尝试同步各 workspace 下的 `project.json`

同时：

1. `updatePipelineStageByStageId()`
2. `updateBranchProgress()`
3. `trackStageDispatch()`
4. `incrementStageAttempts()`

这些路径每次都直接 `saveToDisk()`

结果就是：

1. run 状态同步到 project pipeline
2. project 状态一变
3. 又触发一轮全量 project 写盘

这构成了第二层写放大。

### 主因 D：server 启动后立即拉起后台系统，启动窗口内就开始竞争主线程

`server.ts` 在 listen 成功后立即：

1. `initializeScheduler()`
2. `initializeFanOutController()`
3. `initApprovalTriggers()`
4. `loadPersistedRequests()`
5. `ensureCEOEventConsumer()`
6. `startTunnel()`

虽然写法是 `void warmBackgroundServices(port)`，但这些初始化并不是“独立线程”：

1. 顶层模块求值仍在同一个 Node 事件循环
2. 里面有大量同步 `fs` 与 `better-sqlite3`

真实启动日志已经直接显示：

1. `Runs loaded from disk: 3891+`
2. `Projects loaded from disk: 154`
3. 随后大量 `Projects persisted`
4. 并且 scheduler 立刻开始 dispatch prompt job

所以 dev server 启动后的一段时间里，根本不是“空闲等请求”，而是：

1. 刚启动就处于后台自激活状态

## 次级因素

### 次级因素 A：`/steps` 首次编译确实比另外两个接口更重

本轮 Next dev 日志显示：

1. `/api/conversations/.../steps`
   - 一次首编 `2.1s`
   - 一次首编 `863ms`
2. 但热后 render 只有：
   - `40ms - 85ms`

说明：

1. `/steps` 的路由图首次编译确实偏重
2. 它解释了“第一次比另外两个更慢”
3. 但解释不了“3 个接口一起稳定卡在 4s - 6s”

所以它只是**次级原因**，不是当前主因。

补充只读代码审计后，本轮进一步确认：

1. `/api/conversations/[id]/steps` 虽然运行时已经不再误走 `getConversations()` 全量扫描
2. 但它顶层仍静态引入：
   - `bridge/gateway`
   - `api-provider-conversations`
   - `run-conversation-transcript`
3. 这会把 `ClaudeEngine` / backend / transcript / provider 相关模块编进首编译图
4. 因此 `/steps` 冷首编译显著高于另外两条路由，是符合现状的

### 次级因素 B：`gateway-db -> gateway-home` 仍然存在顶层文件系统副作用

这 3 个接口虽然已经不再共享旧的 registry / `getConversations()` 重路径，但它们仍然都会经过：

1. `gateway-db`
2. `gateway-home`

而 `gateway-home.ts` 顶层会直接执行：

1. `.agents/assets/templates` 同步
2. `.agents/workflows` 同步
3. `.agents/skills` 同步

也就是说：

1. 这不是纯常量模块
2. 在 dev 首次编译和模块初始化窗口里，仍然会带来额外文件系统抖动

它解释不了 `4s - 6s` 级共享卡顿，但解释得了：

1. 为什么冷首请求依然不是纯毫秒级
2. 为什么路由初始化还会有一定波动

### 次级因素 C：`.next/dev/lock` 会造成 dev 重启链不稳定

仓库自己在 `server.ts` 顶部已经写明：

1. `tsx watch` 重启时
2. Next dev 可能还没来得及释放 `.next/dev/lock`
3. 会出现 lock 冲突和重启循环

本轮也真实复现了：

1. 同仓库无法同时起第二个 dev server
2. 直接报：
   - `Unable to acquire lock at .next/dev/lock`

这会放大开发态“不稳定”的体感，但它不是这次 `4.3s` 的主解释。

### 次级因素 D：`storage.sqlite-wal` 膨胀到 `661M`

真实网关目录中：

1. `storage.sqlite = 40M`
2. `storage.sqlite-wal = 661M`

这更像是前述写放大的症状，而不是独立主因：

1. 因为 DB 只读打开和查询仍很快
2. 真正的问题是“写太频繁、写太全量”

## 关键对照验证

为了确认主因真的是 scheduler，而不是“真实数据集本身”或“这几个 API 还藏着慢 SQL”，本轮做了一个关键对照：

1. 用真实数据集备份出一个临时 `AG_GATEWAY_HOME`
2. 只把 `interval` scheduler jobs 全部禁用
3. 其余 runs / projects / conversations 数据全部保留
4. 再起同样的 dev server

结果：

### 冷请求

1. `GET /api/agent-runs`
   - `200 0.608003`
2. `GET /api/projects`
   - `200 0.587916`
3. `GET /api/conversations/native-codex-.../steps`
   - `200 0.912299`

### 热请求

1. `GET /api/agent-runs`
   - `200 0.359941`
2. `GET /api/projects`
   - `200 0.255268`
3. `GET /api/conversations/native-codex-.../steps`
   - `200 0.342300`

并且没有再出现：

1. `5s+` 卡顿
2. 三个接口一起挂住

这几乎可以直接下结论：

1. **同一份真实数据并不会天然导致 4s+**
2. **把 interval scheduler 风暴拿掉后，3000 dev 立刻恢复正常**

## 最终根因排序

### Root Cause 1

`scheduler` 中存在大量 `5s` interval `dispatch-prompt` job，串行触发，持续制造 run 状态变化与 provider 调用。

### Root Cause 2

`run-registry` 与 `project-registry` 的持久化模型是“每次变化都全量重刷全部对象”，造成严重同步写放大，阻塞 Node 主线程。

### Root Cause 3

`server.ts` 启动后立即拉起 scheduler / fan-out / approval / CEO / tunnel，使开发态刚启动就进入后台活动状态，请求容易撞上初始化与调度窗口。

### Root Cause 4

Next dev 对 `/api/conversations/.../steps` 的首次编译本身偏重，但这是次级问题，只解释首轮慢，不解释共享 `4s+` 排队。

### Root Cause 5

`.next/dev/lock` 与 `tsx watch` 重启链问题会加重 dev 不稳定体感，但不是本轮慢请求的主瓶颈。

## 对当前 `3000` 现象的最准确定义

当前最准确的说法不是：

1. “`/api/agent-runs` 还很慢”
2. “`/api/projects` 还很慢”
3. “`/api/conversations/:id/steps` 还很慢”

而是：

1. **当前 `localhost:3000` 这条开发态单进程服务，被后台 interval scheduler + 全量同步持久化持续拖住**
2. **这 3 个接口只是一起受害，不是各自还有独立 4 秒业务热路径**

## 如果继续修，优先级应该怎么排

### 第一优先级

把 `run-registry` / `project-registry` 从“全量重刷”改成真正的增量持久化：

1. 单条 run 更新只 upsert 这一条
2. 单条 project/stage 更新只 upsert 这一条
3. 不要每次状态变化都重写全部内存对象

### 第二优先级

给 dev 启动增加“后台系统分级启动 / 可关闭”能力：

1. scheduler 可关闭
2. tunnel 可关闭
3. CEO / approval / fan-out 可关闭
4. 至少开发态验收不要默认全部拉起

### 第三优先级

清理现有 scheduler 配置中的重复 `5s interval dispatch-prompt` job。

### 第四优先级

如果还要继续打磨开发体验，再处理：

1. `/steps` 首编图过大
2. `.next/dev/lock`
3. 过大的 WAL / 写盘频率

## 本轮产出

本轮没有修改业务代码，只完成：

1. 真实复现
2. 对照实验
3. 根因收敛
4. 本地研究文档固化
