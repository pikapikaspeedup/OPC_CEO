# localhost:3000 三类慢接口共享重依赖只读审计

**状态**: ✅ 已完成  
**日期**: 2026-04-20  
**类型**: 只读依赖图审计 + 运行时对照测量

## 目标

只读分析当前代码里这 3 类慢接口是否仍共享重型依赖：

1. `/api/agent-runs`
2. `/api/projects`
3. `/api/conversations/[id]/steps`

重点排查：

1. 顶层 import
2. dynamic import
3. storage / db 查询
4. dev 编译触发
5. 任何仍会让 Next dev 在第一次请求时编译大图的模块

本轮**没有改代码**。

## 结论先说

### 1. 三条接口已经**不再共享之前那种架构级重运行态依赖**

当前代码里，三条接口都已经不再共享这些旧问题：

1. 不再共同顶层 import `run-registry`
2. 不再共同顶层 import `project-registry`
3. 不再共同通过 `resolveConversationRecord() -> getConversations()` 触发 conversation 全量聚合扫描
4. `/api/agent-runs` 的 POST 执行图也已经从 GET 顶层剥离

### 2. 现在仍然存在的**共同依赖**，只剩一个最值得注意的共享副作用

三条接口当前都还会间接经过：

1. `src/lib/storage/gateway-db.ts`
2. `src/lib/agents/gateway-home.ts`

而 `gateway-home.ts` 在模块顶层会立即执行：

1. `syncAssetsToGlobal()`

也就是：

1. 扫 repo 的 `.agents/assets/templates`
2. 扫 `.agents/workflows`
3. 扫 `.agents/skills`
4. 复制到 `~/.gemini/antigravity/gateway/assets`

这属于**共享的模块加载副作用**，不是纯函数式配置。

### 3. 但 4.3s 级别的主要矛盾，已经不像是运行时查库慢，而是 dev 首次按路由编译大图

我对当前真实数据做了独立测量：

1. `agent-runs` 读路径模拟：约 `261ms`
2. `projects` 读路径模拟：约 `11ms`
3. 用户给出的 `native-codex-1441.../steps` 本地路径模拟：约 `50ms`

和现存 dev 请求：

1. `/api/agent-runs` `4.37s`
2. `/api/projects` `4.30s`
3. `/api/conversations/.../steps` `4.29s`

差了一个数量级。

因此当前更合理的判断是：

1. **运行时代码本身已经不够慢到解释 4.3s**
2. **Next dev 首次命中 route 时的服务端编译图，才是主因**

## 依赖矩阵

| 接口 | 仍共享 `gateway-db -> gateway-home` | 仍有自己额外的大图 |
| --- | --- | --- |
| `/api/agent-runs` | 是 | `stage-resolver -> asset-loader` |
| `/api/projects` | 是 | 基本没有明显额外大图 |
| `/api/conversations/[id]/steps` | 是 | `bridge/gateway`、`api-provider-conversations`、`run-conversation-transcript` |

## 逐条分析

### A. 三条接口共同剩余依赖：`gateway-db -> gateway-home`

文件位置：

1. `src/app/api/agent-runs/route.ts`
   - 顶层 import `@/lib/storage/gateway-db`
2. `src/app/api/projects/route.ts`
   - 顶层 import `@/lib/storage/gateway-db`
3. `src/app/api/conversations/[id]/steps/route.ts`
   - 顶层 import `findRunRecordByConversationRef` from `@/lib/storage/gateway-db`

对应代码：

1. `src/lib/storage/gateway-db.ts:5`
   - `import { GATEWAY_HOME } from '../agents/gateway-home';`
2. `src/lib/agents/gateway-home.ts:60-112`
   - 顶层定义并立即执行 `syncAssetsToGlobal()`

这意味着只要任一接口第一次加载 `gateway-db`，就会顺带做一次 repo 资产同步。

### B. 这个共享副作用不仅存在，而且目前还暴露出并发不安全

本轮只读测量里，我并发用独立进程 import `gateway-db`，实际打到了：

1. `ENOENT: no such file or directory, unlink .../gateway/assets/skills/.../__pycache__/fetch_context.cpython-312.pyc`

这说明：

1. `gateway-home.ts` 顶层的 `cpSync(..., { recursive: true, force: true })`
2. 对同一目标目录并发同步时存在竞争窗口

虽然这不能直接解释单请求 `4.3s`，但它说明这块副作用并不“干净”，而且会制造额外文件系统抖动。

### C. `/api/agent-runs` 当前已经很轻，但仍残留一个按数据触发的动态大图

文件位置：

1. `src/app/api/agent-runs/route.ts:6-13`
   - 顶层只保留 `execution` 和 `gateway-db`
2. `src/app/api/agent-runs/route.ts:103-125`
   - POST 执行器已改成 lazy import
3. `src/app/api/agent-runs/route.ts:188-190`
   - GET 仍会在必要时 dynamic import `@/lib/agents/stage-resolver`
4. `src/lib/agents/stage-resolver.ts:1-15`
   - 直接依赖 `AssetLoader`
5. `src/lib/agents/asset-loader.ts:32-85, 151-165`
   - 首次 `getTemplate()` 会扫描模板、校验 contract、编译 IR、建立 cache

当前真实数据：

1. `runs` 总数：`3958`
2. 其中需要 `stage-resolver` 补 execution profile 的 run：`158`

独立测量：

1. 不触发 `stage-resolver` 的轻量模拟：约 `188ms`
2. 带 `stage-resolver + AssetLoader` 的完整模拟：约 `261ms`

说明：

1. `/api/agent-runs` 运行时代价确实仍是三者里最大的
2. 但它仍远小于 `4.3s`
3. 因此这里更像是**次要运行时成本 + 首次 dev 编译成本叠加**

### D. `/api/projects` 当前运行时已经非常轻

文件位置：

1. `src/app/api/projects/route.ts:1-3`
   - 顶层只有 `project-utils` + `gateway-db`
2. `src/app/api/projects/route.ts:24-40`
   - GET 只是：
   - `listProjectRecords()`
   - 提取少量失败 stage 的 `runId`
   - `listRunRecordsByIds()`
   - `normalizeProject()`

当前真实数据：

1. `projects` 总数：`154`
2. 当前只需要额外回查失败 run 的数量：`2`

独立测量：

1. 整条 `/api/projects` GET 等价流程：约 `11ms`

这几乎可以直接说明：

1. `/api/projects` 现在的 `4.30s` **不是查询逻辑本身导致**
2. 它慢，主要是因为**它也需要 dev 首次编译自己那条 route graph**

### E. `/api/conversations/[id]/steps` 虽然运行时很快，但静态编译图仍然明显偏大

文件位置：

1. `src/app/api/conversations/[id]/steps/route.ts:2`
   - 顶层 import `@/lib/bridge/gateway`
2. `src/app/api/conversations/[id]/steps/route.ts:8-11`
   - 顶层 import `@/lib/api-provider-conversations`
3. `src/app/api/conversations/[id]/steps/route.ts:12-15`
   - 顶层 import `@/lib/run-conversation-transcript`
4. `src/app/api/conversations/[id]/steps/route.ts:29-50`
   - 对本地 provider 分支来说，运行时其实很快就能返回

#### E1. `bridge/gateway` 仍把 `statedb` 整个模块带进编译图

文件位置：

1. `src/lib/bridge/gateway.ts:19-31`
   - re-export `resolveConversationRecord` 等来自 `statedb`
2. `src/lib/bridge/statedb.ts:1`
   - 顶层就 import `execSync, spawnSync`
3. `src/lib/bridge/statedb.ts:197-260`
   - `getConversations()` 仍然保留了 `.pb` 扫描、SQLite shell、brain 扫描等重逻辑

注意：

1. 当前 `steps` 路由只调用 `resolveConversationRecord()`
2. `resolveConversationRecord()` 现在只是 SQLite 单点 lookup
3. **但编译图里仍然包含整个 `statedb.ts` 文件**

也就是说：

1. 运行时不再走 `getConversations()`
2. 但 dev 首次编译 `steps` route 时，仍要把包含这些重逻辑定义的模块编进去

#### E2. `api-provider-conversations` 静态 import 仍然把 Claude Engine 整图带进来

文件位置：

1. `src/lib/api-provider-conversations.ts:1-8`
   - 顶层 import `ClaudeEngine`
   - `TranscriptStore`
   - `claude-engine-backend`
2. `src/lib/backends/claude-engine-backend.ts:14-58`
   - 继续展开到 `ClaudeEngine`、tools、MCP、permissions、AI config 等
3. `src/lib/claude-engine/engine/claude-engine.ts:1-16`
   - 继续展开到 tool registry、memory、skill store、query loop

独立模块 import 测量：

1. `api-provider-conversations` 首导入约 `705ms`

这不是请求运行时间，而是模块图本身的重量信号。

#### E3. `run-conversation-transcript` 静态 import 仍把 codex / native-codex 执行器带进来

文件位置：

1. `src/lib/run-conversation-transcript.ts:2-4`
   - 顶层 import `run-history`
   - `codex-executor`
   - `native-codex-executor`
2. `src/lib/providers/codex-executor.ts:8-19`
   - 顶层带进 `CodexMCPClient`
3. `src/lib/providers/native-codex-executor.ts:22-37`
   - 顶层带进 native codex adapter + run history

独立模块 import 测量：

1. `run-conversation-transcript` 首导入约 `75ms`

#### E4. 用户给的实际会话，运行时本身并不慢

用户给出的慢接口样例：

1. `GET /api/conversations/native-codex-1441e900-e67c-4462-bcca-6664af7dd959/steps`

当前数据确认：

1. 它在 `conversation_sessions` 中对应的是本地 record
2. provider 是 `native-codex`
3. sessionHandle 是 `native-codex-1441e900-e67c-4462-bcca-6664af7dd959`
4. 本地 `.local.json` / `.codex.json` transcript 文件不存在
5. 但 backing run 可查到，最终能回退到 run history / native conversation 路径

独立测量：

1. 该会话当前 `steps` 本地 provider 路径：约 `50ms`

所以这条接口的 `4.29s`，基本不可能是 lookup / transcript 运行时代码本身导致。

## Dev 编译视角

文件位置：

1. `package.json:6`
   - `dev = tsx watch --exclude './demolong/**' server.ts`
2. `server.ts:24`
   - `next({ dev, hostname, port, turbopack: false })`

这说明当前 `3000` 端口不是一个干净的单进程生产态，而是：

1. `tsx watch`
2. 自定义 Node server
3. Next dev
4. 且关闭了 turbopack

在这个模式下：

1. 第一次命中一个 API route，会触发该 route 的 server bundle 编译
2. 编译时间更受**静态 import 图大小**影响
3. 不受“这次请求实际走没走到某个分支”影响

这正好解释：

1. `/api/projects` 运行时只有 `11ms`，dev 却是 `4.30s`
2. `/steps` 运行时只有 `50ms`，dev 却也是 `4.29s`
3. 三条路由都落在 `4.3s` 左右，说明像是**同一类 dev 首编译开销**，而不是三段不同的业务查询刚好一样慢

## 明确根因候选

按优先级排序：

### 候选 1：Next dev 首次命中 API route 的 server graph 编译仍然是主因

置信度：高

依据：

1. 三条不同接口都在 `4.3s` 左右
2. 独立运行时代价只有 `11ms / 50ms / 261ms`
3. `steps` route 仍静态 import 了明显偏大的 provider/backend 图

### 候选 2：三条接口共同经过 `gateway-db -> gateway-home`，顶层资产同步仍有共享副作用

置信度：中高

依据：

1. 三条接口都共享这条链
2. `gateway-home.ts` 顶层不是纯常量，而是真实文件系统同步
3. 并发导入时已实测出现 `cpSync` 竞争报错

### 候选 3：`/api/agent-runs` 第一次实际 GET 仍会按数据触发 `stage-resolver -> AssetLoader`

置信度：中

依据：

1. 当前仍有 `158` 条 run 缺 `executionProfile`
2. 第一次 GET 会 dynamic import `stage-resolver`
3. `AssetLoader` 首次模板加载会校验并预编译 IR

### 候选 4：`steps` route 的静态 import 图仍然明显偏大

置信度：高

依据：

1. `api-provider-conversations` 顶层就拉进 Claude Engine 图
2. `run-conversation-transcript` 顶层就拉进 codex / native-codex executor
3. `bridge/gateway` 又把含有重扫描函数定义的 `statedb.ts` 编进去

## 当前最准确的判断

如果问题是：

1. “这 3 类接口现在是否还共享重型运行态依赖？”

答案是：

1. **不再共享以前那种 run-registry / project-registry / getConversations 全量扫描级别的重运行态依赖**
2. **仍共享 `gateway-db -> gateway-home` 这条有顶层文件系统副作用的链**

如果问题是：

1. “为什么 3000 开发态还是稳定在 4.3s 左右？”

答案更接近：

1. **主要不是当前业务运行时慢**
2. **而是 Next dev 在首次命中 route 时，仍要编译偏大的服务端模块图**
3. 其中 `steps` 这条图最大，`agent-runs` 次之，`projects` 本身很轻，但仍逃不掉自己的首编译成本

## 本轮证据摘要

### 独立 import 测量

1. `gateway-home`：约 `51ms`
2. `gateway-db`：约 `37ms`
3. `bridge/gateway`：约 `112ms`
4. `run-conversation-transcript`：约 `75ms`
5. `stage-resolver`：约 `74ms`
6. `api-provider-conversations`：约 `705ms`

### 运行时数据规模

1. `runs`：`3958`
2. `projects`：`154`
3. `conversation_sessions`：`110`
4. 缺 execution profile 且会触发 `stage-resolver` 的 runs：`158`

### 等价运行时测量

1. `agent-runs` 完整读路径：约 `261ms`
2. `projects` 完整读路径：约 `11ms`
3. `native-codex ... /steps` 当前本地路径：约 `50ms`

## 本轮说明

1. 本轮只做了代码与数据的只读审计
2. 本轮没有修改任何代码
3. 本轮没有做性能修复
