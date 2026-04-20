# localhost:3000 开发态共享阻塞风险只读审计

**状态**: ✅ 已完成  
**日期**: 2026-04-20  
**类型**: 只读代码审计

## 本轮目标

用户要求只读分析当前仓库中：

1. `server.ts`
2. 自定义 Next dev 启动链
3. 后台初始化：
   - `scheduler`
   - `fan-out`
   - `approval`
   - `CEO`
   - `tunnel`

它们对开发态接口响应的共享阻塞风险。

重点回答：

1. 哪些初始化仍会和请求竞争事件循环 / 文件锁 / 磁盘 IO
2. 哪些是启动一次性成本，哪些会持续影响后续每次请求
3. 给出文件路径和关键代码位置

## 总结结论

当前 `3000` 开发态接口慢，按当前代码结构看，不像只剩单一 API 热路径问题，而是以下三类共享成本叠加：

1. `npm run dev` 实际跑的是：
   - `tsx watch --exclude './demolong/**' server.ts`
   - `server.ts` 内再启动 `next({ dev: true })`
2. `server.listen()` 之后虽然用了 `void warmBackgroundServices(port)`，不再阻塞“监听端口成功”这一步，但后台初始化仍会在同一 Node 事件循环里执行同步模块求值、同步文件系统访问和同步 SQLite 读写
3. 若请求在 `warmBackgroundServices()` 运行窗口内到达，就会与这些同步段竞争事件循环
4. 后台模块初始化完成后，又注册了持续运行的 timer / project-event listener；这些 listener 在 run / project 状态变化时仍会持续触发同步写盘，因此不是纯启动成本

## A. 自定义 dev 启动链的共享风险

### 1. `tsx watch` + 自定义 server + Next dev 是双层开发态链路

文件：

1. `package.json:6`
2. `server.ts:20-25`
3. `server.ts:112-129`

事实：

1. `npm run dev` 实际命令是：
   - `tsx watch --exclude './demolong/**' server.ts`
2. `server.ts` 内部再执行：
   - `next({ dev, hostname, port, turbopack: false })`
   - `app.prepare()`

含义：

1. 外层 `tsx watch` 负责源码变更重启 Node 进程
2. 内层 Next dev 负责开发态编译 / HMR / `.next/dev` 状态
3. 两层都在开发态下工作，因此 `3000` 端口不是“纯 API server”

### 2. `.next/dev/lock` 风险仍然存在于 dev 启动链

文件：

1. `server.ts:5-9`

事实：

1. 顶部注释明确写明：
   - `tsx watch` 监控静态 import
   - server 重启时 Next.js 可能来不及释放 `.next/dev/lock`
   - 会出现 lock conflict / restart loop

结论：

1. 这是 dev 链路特有的共享锁风险
2. 该风险主要影响：
   - 启动 / 重启窗口
   - HMR 后短时间
3. 它更偏向“启动与重启一次性成本”，不是每个请求都会触发
4. 但如果长期运行 dev 实例经历了多次 watch 重启 / HMR 累积，它会放大整个实例的不稳定性

### 3. `app.prepare()` 是真正进入 Next dev 编译态的入口

文件：

1. `server.ts:112`

事实：

1. 自定义 server 在 `app.prepare().then(...)` 之后才创建 HTTP server

结论：

1. 这里属于启动一次性成本
2. 只要是 dev 模式，就天然包含 Next dev 的编译 / 缓存 / HMR 状态管理
3. 这部分不是当前仓库业务代码能完全解释的，但当前链路设计确实把它与自定义后台服务叠加到了同一个进程里

## B. `warmBackgroundServices()` 哪些会竞争事件循环 / 文件锁 / 磁盘 IO

### 1. 总体行为：异步触发，但同步段仍与请求共享主线程

文件：

1. `server.ts:59-110`
2. `server.ts:294-298`

事实：

1. `server.listen(..., async () => { ... void warmBackgroundServices(port); })`
2. `warmBackgroundServices()` 依次 `await import(...)` / 调初始化函数

结论：

1. 它不会阻塞“listen callback 返回”本身
2. 但 import 的模块求值、模块顶层同步逻辑、初始化函数里的同步 IO，仍在同一个 Node 线程执行
3. 所以它会与启动后很早到达的 HTTP 请求竞争事件循环

### 2. `scheduler` 初始化是当前最重的后台初始化

文件：

1. `server.ts:61-62`
2. `src/lib/agents/scheduler.ts:1-20`
3. `src/lib/agents/scheduler.ts:555-560`

事实：

1. `server.ts` 首先 import `./src/lib/agents/scheduler`
2. `scheduler.ts` 顶层静态 import：
   - `AssetLoader`
   - `executeDispatch`
   - `executePrompt`
   - `getProject`
   - `getRun`
   - `listScheduledJobRecords`
   - `appendCEOEvent`
3. `initializeScheduler()` 会：
   - `loadJobs()`
   - `scheduleNextTick()`

#### 2.1 import `scheduler.ts` 时就会触发的冷路径

文件：

1. `src/lib/agents/scheduler.ts:6-20`
2. `src/lib/agents/gateway-home.ts:17-21`
3. `src/lib/agents/gateway-home.ts:60-112`
4. `src/lib/agents/run-registry.ts:129-186`
5. `src/lib/agents/run-registry.ts:185-186`
6. `src/lib/agents/project-registry.ts:49-90`
7. `src/lib/agents/project-registry.ts:90`
8. `src/lib/agents/dispatch-service.ts:12-23`
9. `src/lib/agents/prompt-executor.ts:4-49`

结论：

1. import `scheduler.ts` 不只是拿到一个函数
2. 它会级联拉起：
   - `gateway-home` 顶层资产同步
   - `run-registry` 顶层 `loadFromDisk()`
   - `project-registry` 顶层 `loadFromDisk()`
   - 调度 / 执行主链的重型模块图
3. 其中 `gateway-home` 的 `syncAssetsToGlobal()` 会同步：
   - `mkdirSync`
   - `readdirSync`
   - `copyFileSync`
   - `cpSync`
4. `run-registry` / `project-registry` 会在模块顶层直接从 SQLite 读取所有 run / project

#### 2.2 `initializeScheduler()` 本身的同步 IO

文件：

1. `src/lib/agents/scheduler.ts:48-77`
2. `src/lib/agents/scheduler.ts:555-560`
3. `src/lib/storage/gateway-db.ts:167-180`
4. `src/lib/storage/gateway-db.ts:518-527`

结论：

1. `loadJobs()` 会调用 `listScheduledJobRecords()`
2. `listScheduledJobRecords()` 通过 `better-sqlite3` 同步读取 SQLite
3. `getGatewayDb()` 首次建库时还会：
   - `mkdirSync`
   - 打开 SQLite 文件
   - `initSchema()`
   - `PRAGMA journal_mode = WAL`
   - 建表建索引
4. 这些都属于启动时真实的同步磁盘 IO

#### 2.3 `scheduler` 不是一次性成本，它会持续运行

文件：

1. `src/lib/agents/scheduler.ts:302-318`
2. `src/lib/agents/scheduler.ts:528-552`
3. `src/lib/agents/scheduler.ts:54-60`
4. `src/lib/agents/scheduler.ts:351-437`
5. `src/lib/agents/scheduler.ts:487-509`
6. `src/lib/agents/scheduler.ts:611-622`
7. `src/lib/agents/scheduler.ts:693-700`

结论：

1. `scheduleNextTick()` 会长期挂 `setTimeout`
2. `tick()` 会周期性执行
3. 每轮除了看 due jobs，还会：
   - `scanFanOutBranchHealth()`
4. 如果 job 触发：
   - 会调用 `executePrompt()` / `executeDispatch()`
   - 会 `saveJobs()` 写 SQLite
   - 会 `appendAuditEvent()`
   - 会 `appendCEOEvent()`
5. 所以它不只是启动成本，而是持续后台负载

### 3. `fan-out-controller` 初始化本身较轻，但其 import 冷路径不轻

文件：

1. `server.ts:68-69`
2. `src/lib/agents/fan-out-controller.ts:1-12`
3. `src/lib/agents/fan-out-controller.ts:441-446`

事实：

1. `initializeFanOutController()` 自身只做：
   - `onProjectEvent('fan-out-controller', handleProjectEvent)`
2. 但模块顶层静态 import：
   - `AssetLoader`
   - `dispatchRun`
   - `project-registry`
   - `run-registry`

结论：

1. 若 scheduler 尚未先 import 这些模块，则 fan-out import 也会触发同类冷恢复
2. 在当前 `warmBackgroundServices()` 的顺序里，scheduler 大概率已经先把这些成本吃掉
3. 所以对当前链路而言：
   - fan-out 的“额外启动一次性成本”中等
   - 真正更重的是后续事件处理

#### 3.1 `fan-out-controller` 会持续影响运行期

文件：

1. `src/lib/agents/fan-out-controller.ts:388-439`
2. `src/lib/agents/fan-out-controller.ts:448-484`
3. `src/lib/agents/fan-out-controller.ts:30-71`
4. `src/lib/agents/fan-out-controller.ts:338-360`

事实：

1. `handleProjectEvent()` 在 `stage:completed` / `project:completed` / `branch:completed` 上都会运行
2. 其中会继续：
   - `readFileSync` 读取 work package JSON
   - `dispatchRun()` 派发新 run
   - `updateBranchProgress()` / `updatePipelineStageByStageId()` 持续写 SQLite + `project.json`
   - `writeFileSync()` 写 `fan-out-summary.json`
3. `scheduler.tick()` 每轮还会调用 `scanFanOutBranchHealth()`

结论：

1. `fan-out` 对 HTTP 请求的影响主要不是“初始化当场”
2. 而是后续任何 run/project 状态变化都会在同进程继续触发同步磁盘 IO

### 4. `approval-triggers` 初始化轻，但失败事件上的后续代价不轻

文件：

1. `server.ts:75-76`
2. `src/lib/agents/approval-triggers.ts:25-39`

事实：

1. `initApprovalTriggers()` 只是注册：
   - `onProjectEvent('approval-triggers', async ...)`

结论：

1. 初始化本身较轻
2. 但 import 它时仍会引入：
   - `submitApprovalRequest`
   - `run-registry`
   - `project-registry`
3. 若这些模块未被缓存，也会有启动冷成本

#### 4.1 `approval` 的持续成本

文件：

1. `src/lib/agents/approval-triggers.ts:42-83`
2. `src/lib/approval/handler.ts:116-130`
3. `src/lib/approval/request-store.ts:50-58`
4. `src/lib/approval/request-store.ts:60-83`
5. `src/lib/approval/request-store.ts:95-136`
6. `src/lib/organization/ceo-event-store.ts:18-34`
7. `src/lib/organization/ceo-profile-store.ts:41-82`
8. `src/lib/organization/ceo-profile-store.ts:129-155`

事实：

1. `stage:failed` 时会 `submitApprovalRequest()`
2. `createApprovalRequest()` 会：
   - `ensureRequestsLoaded()`
   - 目录 `readdirSync`
   - 对每个 JSON `readFileSync`
   - `writeFileSync` 写新 request
   - `appendCEOEvent()` 读写 `ceo-events.json`
   - `appendCEOPendingIssue()` 读写 `ceo-profile.json`

结论：

1. 这不是一次性成本
2. 任何失败 / timeout / blocked 的 stage 都会继续触发同步文件系统读写
3. 如果失败风暴较多，会直接和 API 请求竞争主线程

### 5. `loadPersistedRequests()` 是明确的启动一次性目录扫描

文件：

1. `server.ts:82-83`
2. `src/lib/approval/request-store.ts:60-83`
3. `src/lib/approval/request-store.ts:220-224`

事实：

1. server 启动后显式调用 `loadPersistedRequests()`
2. 它会扫描 `~/.gemini/antigravity/requests`
3. 对每个 `.json` 用同步方式读取和 `JSON.parse`

结论：

1. 这是清晰的启动一次性成本
2. 它不会在每个请求都重复发生
3. 但如果 requests 目录历史数据很多，会在启动窗口与早期请求竞争事件循环和磁盘

### 6. `CEO event consumer` 初始化轻，但事件写盘持续存在

文件：

1. `server.ts:89-90`
2. `src/lib/organization/ceo-event-consumer.ts:7-11`

事实：

1. `ensureCEOEventConsumer()` 只注册 listener

#### 6.1 持续成本

文件：

1. `src/lib/organization/ceo-event-consumer.ts:11-65`
2. `src/lib/organization/ceo-event-store.ts:18-34`
3. `src/lib/organization/ceo-profile-store.ts:41-82`
4. `src/lib/organization/ceo-profile-store.ts:129-155`

事实：

1. `stage:completed`
   - `removeCEOPendingIssuesByPrefix()`
   - `appendCEOEvent()`
2. `stage:failed`
   - `appendCEOEvent()`
   - `appendCEOPendingIssue()`
3. `project:completed`
   - `removeCEOPendingIssuesByPrefix()`
   - `appendCEOEvent()`
4. `branch:completed`
   - `appendCEOEvent()`

结论：

1. CEO consumer 初始化本身不重
2. 但它把几乎所有 project lifecycle 事件都变成了同步 JSON 读写
3. 这部分会持续和请求共享同一事件循环

### 7. `tunnel` 的风险主要在启动窗口，不是每次请求

文件：

1. `server.ts:95-108`
2. `src/lib/bridge/tunnel.ts:32-41`
3. `src/lib/bridge/tunnel.ts:52-159`

事实：

1. `loadTunnelConfig()` 会同步 `readFileSync` 读 `~/.gemini/antigravity/tunnel_config.json`
2. 若 `autoStart` 开启，会 `spawn('cloudflared', ...)`
3. `startTunnel()` 会挂 stdout/stderr 监听，并等待连接成功或超时

结论：

1. 配置读取是很小的同步磁盘 IO
2. `spawn` 后的大部分等待是异步的
3. 因此 tunnel 更像启动阶段的附加噪音，不像 scheduler / approval / CEO 那样持续写盘
4. 但若 `cloudflared` 日志很多，也会带来一定事件循环开销

## C. 哪些是启动一次性成本，哪些会持续影响每次请求

### 启动一次性成本为主

1. `package.json:6`
   - `tsx watch` 外层 dev watcher
2. `server.ts:112`
   - `app.prepare()` 进入 Next dev 准备阶段
3. `server.ts:59-110`
   - `warmBackgroundServices()` 依次 import 后台模块
4. `src/lib/agents/gateway-home.ts:60-112`
   - `syncAssetsToGlobal()` 顶层资产同步
5. `src/lib/agents/run-registry.ts:129-186`
   - 顶层 `loadFromDisk()`
6. `src/lib/agents/project-registry.ts:49-90`
   - 顶层 `loadFromDisk()`
7. `src/lib/approval/request-store.ts:220-224`
   - `loadPersistedRequests()`
8. `src/lib/bridge/tunnel.ts:32-41`
   - `loadTunnelConfig()`
9. `server.ts:100`
   - `startTunnel(port)` 若开启 autoStart

### 会持续影响运行期

1. `src/lib/agents/scheduler.ts:302-318`
   - 长期 timer loop
2. `src/lib/agents/scheduler.ts:528-552`
   - 每轮 tick 执行 due jobs + `scanFanOutBranchHealth()`
3. `src/lib/agents/fan-out-controller.ts:388-439`
   - project-event listener 持续工作
4. `src/lib/agents/approval-triggers.ts:29-37`
   - `stage:failed` listener 持续工作
5. `src/lib/organization/ceo-event-consumer.ts:11-65`
   - CEO project-event listener 持续工作
6. `src/lib/approval/request-store.ts:95-136`
   - 每次创建 approval 都同步写文件
7. `src/lib/organization/ceo-event-store.ts:18-34`
   - 每次 CEO 事件都整文件 read + write
8. `src/lib/organization/ceo-profile-store.ts:41-82`
   - 每次 pending issue 变化都整文件 read + write
9. `src/lib/agents/project-registry.ts:26-47`
   - 每次 project 更新都会 upsert SQLite，并同步 `project.json`
10. `src/lib/agents/run-registry.ts:44-54`
    - 每次 run 更新会全量遍历 in-memory runs 并 upsert

## D. 哪些最可能直接拖慢开发态接口响应

按风险级别排序：

### P0. `scheduler` import 冷路径

文件：

1. `server.ts:61-62`
2. `src/lib/agents/scheduler.ts:1-20`
3. `src/lib/agents/gateway-home.ts:60-112`
4. `src/lib/agents/run-registry.ts:185-186`
5. `src/lib/agents/project-registry.ts:90`

原因：

1. 首个后台初始化就会把最重的执行链和两个 registry 拉起来
2. 这些都包含同步 SQLite / 文件系统操作
3. 启动后早到的 HTTP 请求会直接撞上这段冷恢复

### P0. project / run lifecycle listener 的持续同步写盘

文件：

1. `src/lib/agents/project-events.ts:23-60`
2. `src/lib/agents/fan-out-controller.ts:388-439`
3. `src/lib/agents/approval-triggers.ts:29-37`
4. `src/lib/organization/ceo-event-consumer.ts:11-65`
5. `src/lib/agents/project-registry.ts:26-47`
6. `src/lib/agents/run-registry.ts:44-54`

原因：

1. project events 一旦发生，会同时通知多个 listener
2. listener 自身虽通过 `void listener(event)` 不会串行 `await`
3. 但每个 listener 内部仍会在同一线程做同步磁盘 IO
4. 所以并不会“隔离主线程负担”，只是变成多个并发 promise 各自抢同一个事件循环

### P1. approval / CEO JSON 文件存储

文件：

1. `src/lib/approval/request-store.ts:50-58`
2. `src/lib/approval/request-store.ts:60-83`
3. `src/lib/organization/ceo-event-store.ts:18-34`
4. `src/lib/organization/ceo-profile-store.ts:41-82`

原因：

1. 这些是典型同步 JSON 文件存储
2. 每次更新都不是 append-only，而是整文件 read / modify / write
3. 长期运行 dev 实例下，这类共享状态越多，越容易形成尾延迟波动

### P1. `gateway-home` 顶层资产同步

文件：

1. `src/lib/agents/gateway-home.ts:60-112`

原因：

1. 该逻辑位于模块顶层
2. import 就执行
3. 会同步扫描 repo `.agents` 与 home 目录，并进行文件复制
4. 它是启动成本，不是每个请求成本，但会放大冷启动和首次 import 抖动

## E. 最终判断

只看当前仓库代码，后台初始化对开发态接口的共享阻塞风险结论是：

1. **仍然存在明显竞争**
   - 主要不是 `server.listen()` 自己卡住
   - 而是 listen 后立即启动的后台 import / 初始化，在同一 Node 主线程里执行同步 IO
2. **最重的一次性启动成本是**
   - `scheduler` import 链
   - `gateway-home` 资产同步
   - `run-registry` / `project-registry` 顶层恢复
   - `loadPersistedRequests()` 目录扫描
3. **最重要的持续运行期成本是**
   - scheduler timer loop
   - fan-out / approval / CEO project-event listeners
   - request / CEO store 的整文件同步读写
   - project / run registry 的持续同步 SQLite 写入与镜像文件写入
4. **tunnel 相对不是主因**
   - 更像可选启动噪音
   - 不是高频请求级负担

## 说明

本轮为只读审计：

1. 没有修改业务代码
2. 没有做性能修复
3. 结论完全基于当前仓库代码路径与模块初始化行为
