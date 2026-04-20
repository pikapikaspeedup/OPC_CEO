# localhost:3000 清掉 5s scheduler jobs 后的剩余性能问题审计

日期：2026-04-20

## 背景

在真实库中删除 `11` 个启用中的 `5s interval job` 之后，重新对 `3000` 开发态做了一轮只读审计，目的是回答：

1. 之前那批 scheduler job 清掉后，是否还有别的真实慢点
2. 哪些问题仍会稳定拖慢开发态
3. 哪些属于运行时慢，哪些只是首次编译慢

## 重新测量结果

干净重启 `3000` 后，日志显示：

1. `GET /api/projects`
   - 冷态：`200 in 622ms (compile: 162ms, render: 460ms)`
   - 热态：`200 in 16ms (compile: 3ms, render: 13ms)`
2. `GET /api/agent-runs`
   - 冷态：`200 in 781ms (compile: 191ms, render: 590ms)`
   - 热态：`200 in 321ms (compile: 2ms, render: 318ms)`
3. `GET /api/conversations/:id/steps`
   - 冷态：`200 in 2.9s (compile: 2.9s, render: 45ms)`
   - 热态：`200 in 43ms (compile: 3ms, render: 40ms)`
4. `GET /api/conversations?workspace=file:///Users/darrel/Documents/Openmind`
   - 冷态：`200 in 3.0s (compile: 751ms, render: 2.3s)`
   - 热态：`200 in 2.1s (compile: 7ms, render: 2.1s)`
5. `GET /api/conversations?workspace=file:///Users/darrel/Documents/WorkSatation/WorkStation`
   - 热态：`200 in 1.7s (compile: 1ms, render: 1.7s)`

这说明：

1. `agent-runs` / `projects` 的主要 runtime 慢点已经明显下降
2. `steps` 现在主要剩首次 Next dev 编译成本
3. **新的头号运行时慢点是 `/api/conversations`**

## 结论一：`/api/conversations` 仍然是当前最大的稳定慢点

相关代码：

1. `src/app/api/conversations/route.ts:56-152`
2. `src/lib/bridge/statedb.ts:197-375`
3. `src/lib/storage/gateway-db.ts:418-438`

当前 `GET /api/conversations` 即使带 `workspace` 过滤，也会先做完整全局扫描，然后最后才过滤：

1. 扫 `.pb` 文件
2. `refreshOwnerMap()`
3. `getConversations()`
4. `getAllConnections()`
5. 对每个 server 拉 `getAllCascadeTrajectories()`
6. `listChildConversationIdsFromRuns()`
7. 最后才执行 `workspace` filter

### 分段计时

对当前真实环境做函数级计时，结果如下：

1. `discoverLanguageServers`：`81.5ms`
2. `getAllConnections`：`111.3ms`
3. `refreshOwnerMap`：`155.3ms`
4. `getConversations`：`1825.4ms`
5. `listChildConversationIdsFromRuns`：`199.6ms`

当时真实环境没有活跃 language server，`connectionCount = 0`。因此这轮可以明确判断：

1. 当前 `/api/conversations` 的慢，**不是** gRPC trajectory 拉取导致的
2. 真正的大头是 `getConversations()` 本身

## 结论二：`getConversations()` 的主要耗时来自 `brain` 目录的失败 shell 扫描

相关代码：

1. `src/lib/bridge/statedb.ts:200-219`
2. `src/lib/bridge/statedb.ts:221-234`
3. `src/lib/bridge/statedb.ts:248-293`
4. `src/lib/bridge/statedb.ts:305-375`

对 `getConversations()` 内部步骤做真实拆分，得到：

1. `.pb` 扫描：`7.1ms`
   - 文件数：`100`
2. `conversation_sessions` SQLite 查询：`3.5ms`
   - 行数：`110`
3. `brain` 目录枚举：`5.2ms`
   - 目录数：`221`
4. `brain` 标题读取：`1650.4ms`
   - 遍历目录数：`221`
   - 实际读到标题次数：`0`
5. `listChildConversationIdsFromRuns()` 查询：`89.0ms`
   - 返回 child conversation id：`211`

这里最关键的点不是“读文件慢”，而是：

1. `src/lib/bridge/statedb.ts:257-289` 会对每个 brain 目录都起 shell 去跑：
   - `head task.md`
   - 失败后再 `head walkthrough.md`
2. 当前真实环境里这 `221` 个目录里，测量时 **0 次成功命中标题**
3. 也就是说这 `1.65s` 绝大多数不是在读有效数据，而是在付出大量“失败子进程”的成本

这就是为什么即使带 `workspace` 过滤，`/api/conversations` 热态仍稳定卡在 `1.7s~2.1s`。

## 结论三：protobuf 元数据补全链已经大到会撞 `spawnSync` 缓冲区

相关代码：

1. `src/lib/bridge/statedb.ts:305-375`

当前真实 `state.vscdb` 中：

1. `antigravityUnifiedStateSync.trajectorySummaries` base64 长度：`2,330,032`
2. 解码后 protobuf 字节数：`1,747,522`
3. trajectory 数量：`150`

按当前实现，Node 会起一个 `python3 -c ...` 子进程，把整个 trajectory 列表 JSON 打到 stdout，再由 `spawnSync(...).stdout` 吃回进程内。

在真实环境复现实验时，这一步直接报出：

1. `spawnSync python3 ENOBUFS`

而当前实现是：

1. 没设置 `maxBuffer`
2. 整个 `getConversationsFromProtobuf()` 外层只有一个总 `try/catch`
3. 一旦 stdout 太大或 JSON parse 失败，就直接 `return []`

这意味着这里不只是“有点慢”，还存在一个更细的结构性问题：

1. 当 trajectorySummaries 继续增长时，这条元数据补全链很可能会**静默退化**
2. `/api/conversations` 仍会继续慢
3. 但 protobuf 里的 title / workspace / stepCount 可能已经拿不到了

## 结论四：`listChildConversationIdsFromRuns()` 仍在每次列表请求里全表扫 runs JSON

相关代码：

1. `src/app/api/conversations/route.ts:85-86`
2. `src/lib/storage/gateway-db.ts:418-438`

当前真实库规模：

1. `runs` 总数：`4181`
2. 活跃 run：`43`
3. `projects` 总数：`154`
4. 活跃 project：`24`

`listChildConversationIdsFromRuns()` 每次请求都要：

1. 扫 `runs.payload_json`
2. 再对 `roles` 做 `json_each(...)`
3. 最后 `UNION` 出 child conversation id 列表

本轮实测这一步单独在 `89ms~200ms`，虽然不像 `brain` 扫描那样是秒级，但它已经是一个稳定的固定税。

## 结论五：启动恢复链的“全量持久化”问题还在，只是少了 5s job 的持续触发

相关代码：

1. `src/lib/agents/run-registry.ts:44-53`
2. `src/lib/agents/run-registry.ts:129-179`
3. `src/lib/agents/project-registry.ts:26-47`
4. `src/lib/agents/project-registry.ts:321-336`

当前实现依然是：

1. `run-registry.saveToDisk()` 每次保存都把 **全部 runs** 做一遍 `upsert`
2. `project-registry.saveToDisk()` 每次保存都把 **全部 projects** 做一遍 `upsert`
3. `project-registry.saveToDisk()` 还会对所有存在目录的 project 重写 `project.json`
4. `run-registry.loadFromDisk()` 模块初始化后，还会继续触发 `syncRunStatusToProject()`
5. `updatePipelineStageByStageId()` 每次阶段状态变化又会再次 `saveToDisk()`

所以：

1. 删掉那 `11` 个 `5s interval job` 之后，最大的周期性噪音已经没了
2. 但**启动恢复期**和**活跃 run/project 状态流转期**，仍然会把主线程拖进全量 DB upsert + 文件写入
3. 这部分现在不是 `/api/conversations` 慢的直接原因，但仍然是 dev 态整体抖动的结构风险

## 结论六：`/api/conversations/:id/steps` 现在剩下的是编译图，不是运行态查数

相关现象：

1. 冷态：`2.9s compile + 45ms render`
2. 热态：`43ms`

因此这条链当前的残余问题是：

1. 仍然有较重的 Next dev server graph 首次编译成本
2. 但运行时逻辑本身已经不再是主要矛盾

## 额外观察

1. 当前进程里还能看到两个旧 `tsx watch` 包装进程：
   - `5691`
   - `39779`
2. 它们这轮没有监听 `3000`，也没有再次把旧 scheduler job 写回
3. 但它们会增加环境噪音，后续建议一起清理

## 优先级建议

### P0：先砍 `/api/conversations` 的 `brain` shell 扫描

目标：

1. 不再对 `221` 个 brain 目录逐个起 `head`
2. 尤其不能在 `workspace` 过滤请求里仍做全量扫描

### P0：修掉 `getConversationsFromProtobuf()` 的缓冲区与静默退化

目标：

1. 不再通过 stdout 回传整份大 JSON
2. 至少补 `maxBuffer`
3. 更好的是改成直接在 Node 内解析或只返回必要字段

### P1：给 `listChildConversationIdsFromRuns()` 做缓存或物化

目标：

1. 不再每次列表请求全表扫 `runs.payload_json`
2. 至少在短 TTL 内复用结果

### P1：把 run/project registry 从“全量保存”改成“按 key 增量保存”

目标：

1. run 更新只 upsert 当前 run
2. project 更新只 upsert 当前 project
3. `project.json` 只在目标 project 变更时写

## 最终判断

在删掉 `11` 个 `5s interval job` 之后，`3000` 开发态的主因已经发生变化：

1. `/api/agent-runs`、`/api/projects` 基本已经从“秒级异常慢”恢复到可接受范围
2. `/api/conversations/:id/steps` 剩下主要是冷编译
3. **真正还没解决干净的核心慢点，是 `/api/conversations` 的全局聚合扫描**
4. 其中最刺眼、最值得先砍的是：
   - `brain` 目录失败 shell 扫描
   - protobuf 子进程 stdout 膨胀与 `ENOBUFS`
   - 每次请求全表扫 `runs.payload_json`
