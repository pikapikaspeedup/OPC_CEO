# Chat 架构补充 + Tauri 迁移评估（2026-04-17）

## 目标

补充两件事：

1. 当前产品的 chat 架构到底是什么
2. 当前代码结构迁到 Tauri 是否方便，以及应该怎么迁

说明：

- chat 架构结论基于仓库当前实现
- Tauri 结论基于当前仓库结构 + Tauri 2 官方文档

## 当前 Chat 架构

### 1. 入口层

主 UI 入口：

- `src/app/page.tsx`

核心表现：

- 左侧/主区展示 `Chat`
- 底部使用 `ChatInput`
- 同时维护：
  - `activeId`
  - `steps`
  - `WebSocket` 订阅状态

也就是说，当前“chat”不是一个独立子系统，而是：

- `Conversation viewer`
- `message sender`
- `live step subscriber`

三者组合。

### 2. Conversation 层

接口：

- `POST /api/conversations`
- `GET /api/conversations`
- `GET /api/conversations/:id/steps`
- `POST /api/conversations/:id/send`

当前语义：

- `Conversation` 是 provider/IDE 侧会话对象
- 创建 conversation 只是“开一个会话”
- 不等于 `run`

### 3. Live update 层

当前实时更新通过：

- `server.ts`
- `/ws`
- `src/lib/api.ts -> connectWs(...)`

服务端做的事：

- Next.js 自定义 HTTP server
- 同端口挂 WebSocket
- 对 `cascadeId` 订阅 provider 侧 step stream

前端拿到的是：

- `steps`
- `status`
- `cascadeStatus`

所以当前 chat 的实时体验，本质上依赖：

- 自定义 Node server
- WebSocket
- conversation step merge

### 4. Provider execution 层

执行端并不只有一个 provider：

- `antigravity`
- `native-codex`
- `codex`
- `claude-code`

在 chat / conversation 这件事上，它们能力并不对等：

#### `antigravity`

- 有真实 conversation id
- 有 step-level trajectory
- 前端可以直接读 `/api/conversations/:id/steps`

#### `native-codex`

- 当前更像 in-process provider session
- 有 `handle`
- 默认没有 antigravity 那种 `childConversationId`
- 目前已补 transcript route，但不是真正 step watch

#### `codex`

- 类似 `native-codex`
- 目前也更偏 thread/transcript，而不是统一 step stream

### 5. 当前 chat 的本质

当前系统里的 “chat” 其实是两类东西混在一起：

1. **用户直接对话**
   - 普通 workspace conversation
   - 默认不产生 run
2. **执行过程回放**
   - provider session / run transcript / steps
   - 和 `run` / `project` / `pipeline` 绑定

所以 chat 现在不是纯聊天产品里的单一会话模型，而是：

- `Conversation UI`
- `Agent runtime viewer`

混合体。

## 当前架构的优点

### 1. 前后端一体

- Next.js 页面
- API routes
- WebSocket
- 自定义 server

都在一个仓库和一个运行容器里，开发效率高。

### 2. provider 接入灵活

- 可以很快加 provider
- 可以把不同 provider 抽象到 `run`

### 3. chat / run / project 可以共存

- 适合你现在这种“聊天 + 调度 + 项目化执行”混合产品

## 当前架构的主要问题

### 1. chat 不是单一真相源

- 对话内容分散
- run 结果分散
- journal 又只记控制流

所以系统更像：

- 多个 trace source 拼在一起

### 2. Web 端体验问题不一定来自浏览器本身

你说“web 体验不是很好”，就当前仓库看，原因更可能来自：

- 信息架构混乱
- 业务对象与技术对象混显
- 对话 / run / project 三套模型交叠
- Desktop 级交互缺少原生壳能力

也就是说：

- **不是换 Tauri 就自然变好**

### 3. 当前对 Tauri 不友好的地方

这个仓库不是一个纯静态前端，而是：

- Next.js app
- 自定义 `server.ts`
- 本地 API routes
- `/ws`
- provider / CLI / bridge / scheduler 全在 Node 进程里

这意味着它不是 Tauri 官方文档最推荐的那类：

- Vite SPA + Tauri

## Tauri 官方边界

### 1. Tauri 支持现有前端，但本质像静态宿主

官方文档说明：

- Tauri 是 frontend agnostic
- 但从概念上它像“静态 web host”
- 官方不原生支持 server-based 方案（例如 SSR）

对应官方文档：

- Frontend Configuration
- Next.js

### 2. Next.js 集成要求 static export

Tauri 官方对 Next.js 的明确要求是：

- `output: 'export'`
- 使用 `out` 目录作为 `frontendDist`

这和你当前项目不一致，因为你现在依赖：

- API routes
- custom server
- WebSocket

### 3. Tauri 可以用 sidecar 跑外部二进制

官方也支持：

- `sidecar`

可把外部二进制嵌进应用里，典型包括：

- Node.js sidecar
- Python sidecar
- localhost server

这对你当前仓库非常关键，因为你现在最容易迁的不是“前端静态化”，而是：

- 把现有 Node/Next/Gateway 进程包装成 sidecar

## 迁到 Tauri，方便吗？

### 结论先说

**可以迁，但不算“直接方便”。**

更准确地说：

- **作为 Desktop Shell 包装，方便**
- **作为彻底替换当前运行时架构，不方便**

## 三种迁移路径

### 路径 A：Tauri 只做桌面壳，现有 Gateway 保持不动

做法：

- Tauri 负责窗口、托盘、菜单、原生能力
- 当前 `server.ts + Next + API + WS` 作为 sidecar 启动
- WebView 指向本地 sidecar 提供的 `http://127.0.0.1:<port>`

优点：

- 最接近当前架构
- 风险最低
- 几乎不改业务逻辑
- chat / run / project / ws 都能原样保留

缺点：

- 本质仍然是“桌面壳 + 本地 web app”
- web 体验本身不会自动改善
- 仍然需要处理 sidecar 打包、进程管理、端口、日志

### 路径 B：前端改成 SPA，后端仍然保留本地 service

做法：

- 把 Next 前端逐步收成 Vite/SPA
- API 与 WS 继续在本地 gateway service 中运行
- Tauri 只加载静态前端，并连接本地 backend

优点：

- 更符合 Tauri 官方推荐
- UI 打包更自然
- 后续移动端或多平台更清晰

缺点：

- 前端改造量明显更大
- 要拆出 Next API 依赖

### 路径 C：Tauri + Rust 核心，逐步替代 Node Gateway

做法：

- 把 provider orchestration / state / ws / file I/O 慢慢迁到 Rust

优点：

- Desktop 原生一体化最高
- 长期性能和进程控制最好

缺点：

- 成本最高
- 不是短期路线

## 对你的产品最现实的判断

### 如果你的痛点是这些

1. 想要更像桌面应用
2. 想要更好窗口/托盘/菜单/文件系统体验
3. 想让本地 provider/CLI 更自然地被调起

那么：

- **Tauri 值得做**

### 但如果你的痛点主要是这些

1. 信息架构混乱
2. 结果与过程看不清
3. chat / run / project 模型让人困惑
4. 页面布局像调试台

那么：

- **Tauri 不能替你解决核心问题**

因为这些问题在 WebView 里依然会存在。

## 我的建议

### 推荐路线

**推荐做路径 A，再准备路径 B。**

也就是：

1. 先保留当前 Gateway 运行时
2. 用 Tauri 做桌面壳 + sidecar
3. 先拿到更像桌面应用的体验
4. 等对象模型和信息架构稳定后，再评估是否把前端从 Next 收成 SPA

### 不推荐现在直接做的事

- 立刻把整个产品改成“纯 Tauri 静态前端 + 全 Rust 后端”

因为当前你真正还没收口的是：

- chat / run / conversation / project 的信息模型

先动框架，风险会大于收益。

## 结论

### Chat 架构

当前 chat 是：

- `Conversation viewer`
- `message sender`
- `run/process viewer`

三者混合，不是单纯 IM。

### Tauri 迁移

对你这套代码来说：

- **能迁**
- **最适合做 Desktop Shell + sidecar**
- **不适合直接把现有 Next 运行时当成 Tauri 原生推荐路径**

### 最终建议

- 如果目标是“桌面化”，可以做
- 如果目标是“顺便解决体验问题”，不要对 Tauri 抱过高预期
- 真正要先解决的，还是产品对象模型和信息架构
