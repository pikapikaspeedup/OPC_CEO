# Provider 集成分类口径（2026-04-19）

## 结论

如果只粗分成两类：

1. **直接调用外部软件 / 本机工具**
2. **直接调用远程 API**

那么当前系统里：

### A. 直接调用外部软件 / 本机工具

- `antigravity`
  - 通过本机 Antigravity IDE 的 `language_server`
  - 走 gRPC / Connect
- `codex`
  - 通过本机 `codex` CLI
  - 支持 `codex exec`
  - 支持 `codex mcp-server`
- `claude-code`
  - 属于本机 CLI / 本地软件集成思路

### B. 直接调用远程 API

- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`

这些都属于标准意义上的 API provider。

## 最容易混淆的点：`native-codex`

`native-codex` **不属于旧 `codex CLI` 那类本机外部软件调用**。

它更准确地说是：

- **进程内直接调用远程 Codex backend API**
- 认证方式不是 `sk-* API key`
- 而是复用本机 `~/.codex/auth.json` 里的 OAuth 登录态

所以它是一个：

- **API 型 provider**
- 但不是“API Key 型 provider”
- 而是“OAuth / Subscription 型 provider”

## 更准确的三分类

如果按系统实现而不是按产品感觉，当前最好分成三类：

### 1. 外部软件 / 本机进程型

- `antigravity`
- `codex`
- `claude-code`

特点：

- 依赖本机安装的软件
- Gateway 通过 gRPC、stdio、CLI subprocess 与它们通信

### 2. 远程 API + API Key 型

- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`

特点：

- 直接走 HTTP API
- 用 API key 鉴权

### 3. 远程 API + 本机 OAuth 登录态型

- `native-codex`

特点：

- 直接走 HTTP API
- 不依赖 `codex` 二进制执行任务
- 用本机 OAuth token / refresh token

## 代码证据

- `src/lib/providers/antigravity-executor.ts`
  - `antigravity` 走本机 `language_server`
- `src/lib/bridge/codex-adapter.ts`
  - 旧 `codex` 走 `codex exec` / `codex mcp-server`
- `src/lib/providers/native-codex-executor.ts`
  - 明确写着 `in-process`
  - 不依赖 `codex` binary
- `src/lib/bridge/native-codex-adapter.ts`
  - 直接请求 `https://chatgpt.com/backend-api/codex`
- `src/lib/bridge/native-codex-auth.ts`
  - 从 `~/.codex/auth.json` 读取 / 刷新 OAuth token
- `ARCHITECTURE.md`
  - 当前 provider matrix 已明确把：
    - `antigravity` 标为 `gRPC -> Language Server`
    - `codex` 标为 `CLI / MCP`
    - `native-codex` 标为 `OAuth -> Codex Responses API (in-process)`

## 面向产品沟通的简化说法

如果你是从产品/运营角度讲，可以这么说：

- `Antigravity IDE`、`Codex CLI`、`Claude Code`：算“软件集成型 provider”
- `Claude/OpenAI/Gemini/Grok/Custom`：算“API 型 provider”
- `Native Codex`：本质也算“API 型 provider”，只是认证方式不是 API key，而是本机登录态

## 后续审计口径约定

如果后续要审：

- “整个系统还有哪些对第三方 API 的支持不够好”

那么建议默认把以下 provider 放到**同一大类**一起审：

- `native-codex`
- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`

也就是统一按：

- **云端 API Provider**

来做产品层审计。

但在研究文档里，仍建议把 `native-codex` 单独加注：

- 它是 OAuth 型 API provider
- 不是 API key 型
- 以免把认证、健康检查、登录态、配额来源这些实现细节混掉

## 进一步澄清：第二类和第三类能不能合并

可以。

如果目标是：

- 产品解释
- 用户认知
- 前端分组
- Provider 文案

那么完全可以把：

1. `远程 API + API Key 型`
2. `远程 API + 本机 OAuth 登录态型`

合并成一个大类：

- **云端 API Provider**

此时：

- `native-codex`
- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`

都可以归在一起。

### 为什么说“从产品上可以合并”

因为它们的共性确实是一样的：

- 都不是靠本机 IDE / CLI 进程直接执行任务
- 都是 Gateway 自己发远程请求
- 都属于云端模型 provider
- 都可以共享同一套“第三方 API / 云端 Provider”概念

### 为什么说“从工程上最好仍保留内部差异”

不是因为业务逻辑不同，而是因为下面这些运维机制不同：

- 凭证来源
  - API key
  - OAuth token / refresh token
- 失效方式
  - key 缺失 / key 无效
  - 登录态过期 / refresh 失败
- 可用性检测
  - 检查 key 是否存在
  - 检查本机登录态文件与 token 是否有效
- 配额来源
  - API billing
  - ChatGPT 订阅 / OAuth backend

所以最实用的口径是：

- **对外**：`native-codex` 归到第三方 API / 云端 API provider，和其他 API provider 一类
- **对内**：保留 `API key 型` 与 `OAuth 型` 的实现区分即可
