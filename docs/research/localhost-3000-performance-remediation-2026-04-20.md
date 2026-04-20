# localhost:3000 慢问题修复与实测

**状态**: ✅ 已完成  
**日期**: 2026-04-20  
**类型**: 架构修复 + 真实运行验证

## 背景

在上一轮只读复核里，已经确认 `localhost:3000` 的慢，不只是单一路由逻辑，而是几类冷路径叠加：

1. id 级 conversation 路由为了查单条记录，误走 `getConversations()` 全量聚合扫描
2. `agent-runs` / `projects` 的 GET 顶层 import 了写路径和 registry，导致冷启动读接口也会恢复整个运行态
3. conversation 读路径里大量使用 `listRuns().find(...)`
   - 先全量排序
   - 再找一条 run

## 本轮修复

### 1. 存储层补定点查询

在 `src/lib/storage/gateway-db.ts` 新增了：

1. `getProjectRecord()`
2. `getRunRecord()`
3. `listRunRecordsByIds()`
4. `listRunRecordsByFilter()`
5. `findRunRecordByConversationRef()`
6. `getConversationRecordById()`
7. `findConversationRecordBySessionHandle()`
8. `listChildConversationIdsFromRuns()`

目的：

1. 用 SQLite 单点读取替代 registry 全量恢复
2. 用单条 run lookup 替代 `listRuns().find(...)`

### 2. conversation 热路由切到存储直读

修改：

1. `src/lib/bridge/statedb.ts`
2. `src/app/api/conversations/[id]/steps/route.ts`
3. `src/app/api/conversations/[id]/send/route.ts`
4. `src/app/api/conversations/[id]/files/route.ts`
5. `src/app/api/conversations/route.ts`

效果：

1. `resolveConversationRecord()` 不再为了单条会话触发 `getConversations()` 全量扫描
2. backing run 查找不再依赖 `run-registry`
3. conversation list 过滤 child conversation 时不再顶层 import `run-registry`

### 3. `agent-runs` GET 从执行图剥离

修改：

1. `src/app/api/agent-runs/route.ts`

效果：

1. `GET /api/agent-runs` 改走 `listRunRecordsByFilter()`
2. `executeDispatch` / `executePrompt` 改成 `POST()` 内 lazy import
3. execution profile 优先从持久化 run payload 读取
4. 只有必要时才 lazy import `stage-resolver`

### 4. `projects` GET 从 project-registry 剥离

修改：

1. `src/lib/project-utils.ts`
2. `src/app/api/projects/route.ts`
3. `src/app/api/projects/[id]/route.ts`
4. `src/app/api/agent-runs/[id]/conversation/route.ts`

效果：

1. `GET /api/projects` 改走 `listProjectRecords()`
2. `GET /api/projects/[id]` 改走 `getProjectRecord() + listRunRecordsByIds()`
3. `normalizeProject()` 支持显式传入 run lookup，不再强依赖 `run-registry`
4. `GET /api/agent-runs/[id]/conversation` 改走 `getRunRecord()`

### 5. 启动层小修

修改：

1. `next.config.ts`
2. `server.ts`

效果：

1. 固定 `turbopack.root = process.cwd()`
2. server 启动后的 scheduler / fan-out / approval / CEO consumer / tunnel 初始化改为后台异步触发

## 测试与验证

### 单测

命令：

```bash
pnpm -s vitest run \
  'src/app/api/conversations/[id]/steps/route.test.ts' \
  'src/app/api/conversations/[id]/send/route.test.ts' \
  'src/app/api/agent-runs/route.test.ts' \
  'src/app/api/agent-runs/[id]/conversation/route.test.ts' \
  'src/lib/project-utils.test.ts'
```

结果：

1. `5` 个 test files 全部通过
2. `44` 个 tests 全部通过

### 类型检查

命令：

```bash
npx tsc --noEmit --pretty false
```

结果：

1. 通过

### build

命令：

```bash
npm run build
```

结果：

1. 通过
2. 仍存在一个旧的 Turbopack broad-pattern warning
   - 位于 `src/lib/agents/run-registry.ts:107`
   - 这不是本轮新增问题

### 真实请求计时

#### 修复前已知基线

1. 旧 `3101` 生产态：
   - `GET /api/conversations/native-codex-1441.../steps`
   - 首次约 `12.44s`
2. 旧 `3000` 开发态：
   - `curl -m 5`
   - 直接超时

#### 修复后：隔离生产态 `3104`

1. `GET /api/agent-runs`
   - `200 0.383198`
   - 再次请求 `200 0.327793`
2. `GET /api/projects`
   - `200 0.362183`
   - 再次请求 `200 0.291328`
3. `GET /api/conversations/native-codex-1441e900-e67c-4462-bcca-6664af7dd959/steps`
   - `200 0.352452`
   - 再次请求 `200 0.292577`

#### 修复后：现存 `3000` 开发态

1. `GET /api/agent-runs`
   - `200 4.373772`
2. `GET /api/projects`
   - `200 4.302163`
3. `GET /api/conversations/native-codex-1441.../steps`
   - `200 4.298466`

补充说明：

1. 现存 `3000` 已经从“5 秒内超时无响应”变成“能返回 200”
2. 但它仍明显偏慢，而且多次请求会波动到 `6s-8s`
3. 这更像是**现有长期运行 dev 实例本身的运行态问题**
   - `tsx watch`
   - `next dev`
   - `.next/dev/lock`
   - 长时间增量编译 / HMR 状态

### 验证副作用

本轮真实起生产态 server 做验收时，还观察到一个额外现象：

1. server 启动后会自动初始化：
   - scheduler
   - approval triggers
   - fan-out controller
   - CEO event consumer
   - tunnel
2. 这会触发真实定时任务和 run/project 持久化
3. 因此验收期间仓库内的某些持久化文件会被刷新

这不是本轮新引入的问题，而是当前 server 启动策略本身的副作用。

## 结论

本轮已经把真正该修的读路径架构问题落掉了：

1. 单条会话读取不再触发全量 conversation 聚合
2. `agent-runs` / `projects` 的 GET 不再默认把完整执行图和 registry 恢复带进来
3. 真实生产态请求时间已经从秒级 / 超时，收敛到约 `0.29s - 0.38s`

剩余问题主要是：

1. **现存 `3000` dev 进程仍然不健康**
2. 它的慢更多来自开发态实例本身，而不是这轮已经修掉的 API 热路径
3. server 启动仍会带真实后台 subsystem 副作用

## 下一步建议

如果下一轮继续压 `3000` 开发态体验，优先看两件事：

1. `run-registry.ts:107` 的 broad file-pattern warning
2. 仍会在 server / build 期提前拉起 `RunRegistry / ProjectRegistry` 的其他入口
   - 当前 build trace 仍指向：
     - `src/app/api/projects/[id]/resume/route.ts`
     - `src/app/api/departments/sync/route.ts`
