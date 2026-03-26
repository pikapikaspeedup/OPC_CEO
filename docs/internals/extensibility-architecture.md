# Antigravity Gateway 长期可扩展性架构

> 本文档阐述系统的当前架构约束、可扩展性瓶颈，以及面向未来的长期演进路线。
> 涵盖：跨 IDE 适配、跨 CLI 集成、多租户部署、数据层解耦、运行时扩展等关键维度。

## 演进路线状态

| Phase | 状态 | 说明 |
|-------|------|------|
| Phase 1: 数据层解耦 | ✅ 已完成 | `GATEWAY_HOME` + 注册表/资产迁移（2026-03-25） |
| Phase 2: Bridge 抽象 | 🔲 骨架就绪 | `bridge-interface.ts` 接口定义已创建，未实现新 adapter |
| Phase 3: CLI 执行后端 | 🔲 未开始 | Codex/Gemini CLI adapter |
| Phase 4: Gateway 独立进程 | 🔲 未开始 | 从 Next.js 剥离 |
| Phase 5: 插件生态 | 🔲 未开始 | 远期 |

---

## 1. 系统架构全景

### 1.1 当前四层架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: 接入层（Ingress）                                 │
│  ├─ Web UI (React, src/app/)                                │
│  ├─ cc-connect / 微信 ACP adapter (antigravity-acp.ts)      │
│  ├─ CLI (ag.ts)                                             │
│  └─ MCP Server (src/mcp/server.ts)                          │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: API 网关（src/app/api/）                          │
│  ├─ HTTP REST: /api/agent-runs, /api/projects, /api/models  │
│  ├─ WebSocket: /ws (实时步骤流)                             │
│  └─ 路由 → Runtime Layer 或 Bridge Layer                   │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 运行时编排（src/lib/agents/）                     │
│  ├─ group-runtime.ts    — 多角色调度、Pipeline 编排         │
│  ├─ run-registry.ts     — Run 状态持久化                    │
│  ├─ project-registry.ts — Project 生命周期                  │
│  ├─ asset-loader.ts     — 模板/角色配置加载                 │
│  ├─ watch-conversation.ts — 对话监视（30s 心跳）            │
│  ├─ review-engine.ts    — 多轮审查决策                      │
│  └─ scope-governor.ts   — 文件写入范围保护                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: 桥接层（src/lib/bridge/）                         │
│  ├─ gateway.ts    — 连接管理、Pre-register 映射             │
│  ├─ grpc.ts       — Connect-JSON gRPC 客户端                │
│  ├─ discovery.ts  — 通过 ps aux + lsof 扫描 LS 进程         │
│  ├─ statedb.ts    — 从 IDE 的 state.vscdb 读取 API key      │
│  └─ tunnel.ts     — Cloudflare Named Tunnel                │
└─────────────────────────────────────────────────────────────┘
                              │
                    HTTPS + Connect-JSON (gRPC)
                              ↓
                 ┌────────────────────────┐
                 │  Language Server (LS)  │
                 │  独立进程，每 workspace 一个  │
                 │  由 IDE 启动并管理       │
                 └────────────────────────┘
```

### 1.2 数据流

```
用户输入 → 接入层 → API 网关 → 运行时编排 → 桥接层 → LS → agent 执行
                                                               │
                                                    文件读写、终端执行
                                                               │
agent 回复 ← WS 推送 ← gRPC stream ← LS ←────────────────────┘
```

---

## 2. 当前可扩展性约束

### 2.1 硬约束（破坏性耦合）

#### 约束 C1: LS 发现绑定 Antigravity 进程特征

```typescript
// discovery.ts — 硬编码搜索 Antigravity 的 LS 进程
const psOutput = execSync('ps aux').toString();
// 匹配 argv.json 中含 antigravity 的进程
```

**影响：** 只能发现 Antigravity IDE 启动的 LS。Cursor、Windsurf、VS Code 的 LS 进程无法被识别。
**扩展成本：** 中等 — 需要添加多 IDE 进程签名匹配或改为显式注册。

#### 约束 C2: API Key 从 Antigravity 的 state.vscdb 读取

```typescript
// statedb.ts — 从 IDE 专属数据库读取 API key
const VSCDB_PATH = '~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb';
```

**影响：** 如果 Antigravity 未安装或用其它 IDE，无法获取认证凭证。
**扩展成本：** 低 — 支持环境变量 fallback 即可。

#### 约束 C3: 全局注册表在 `process.cwd()/data/`

```typescript
// run-registry.ts, project-registry.ts
const DATA_DIR = path.join(process.cwd(), 'data');
```

**影响：** 注册表位置依赖 Gateway 启动目录。跨 workspace 不可见。
**扩展成本：** 低 — 改为 `~/.gemini/antigravity/gateway/`（见 [data-architecture-migration.md](./data-architecture-migration.md)）。

#### 约束 C4: 资产配置在 `process.cwd()/.agents/`

```typescript
// asset-loader.ts
const ASSETS_DIR = path.join(process.cwd(), '.agents', 'assets');
```

**影响：** 模板和角色配置只在特定 workspace 可用。
**扩展成本：** 低 — 改为全局路径 + workspace override 层。

### 2.2 软约束（性能/扩展瓶颈）

| ID | 约束描述 | 当前值 | 影响 |
|----|---------|--------|------|
| S1 | LS 发现缓存 3s | 每 3s 执行 `ps aux` | 高频调用时 CPU 开销 |
| S2 | Pre-register TTL 60s | 对话创建后 60s 必须被主映射覆盖 | 慢速 LS 可能超时 |
| S3 | Watcher 心跳 30s | 步骤更新最大滞后 30s | 实时性受限 |
| S4 | 陈旧检测阈值 180s | 3 分钟无新步骤标记为 stale | 长时间思考的任务误判 |
| S5 | 单进程模型 | Gateway 是 Next.js dev server | 无法水平扩展 |
| S6 | JSON 文件持久化 | `agent_runs.json` 单文件 | 并发写入风险 |
| S7 | 内存运行缓存 | `runMap` 在 globalThis | 进程重启丢失运行中状态 |

### 2.3 耦合矩阵

```
              ┌───────────┬──────────┬─────────┬───────────┐
              │ 接入层    │ API 网关 │ 运行时  │ 桥接层    │
┌─────────────┼───────────┼──────────┼─────────┼───────────┤
│ 接入层      │     -     │  HTTP    │    -    │     -     │
│ API 网关    │  HTTP/WS  │    -     │  直接调用│     -     │
│ 运行时      │     -     │ 被调用   │    -    │  gRPC 调用│
│ 桥接层      │     -     │    -     │ 被调用  │     -     │
│ LS (外部)   │     -     │    -     │    -    │  gRPC 被调│
│ IDE (外部)  │     -     │    -     │    -    │  statedb  │
│ 文件系统    │   config  │    -     │ registry│ discovery │
└─────────────┴───────────┴──────────┴─────────┴───────────┘

强耦合: API 网关 ←→ 运行时（直接函数调用）
强耦合: 运行时 ←→ 桥接层（gRPC 同步调用）
弱耦合: 桥接层 ←→ LS（可替换的 Connect-JSON 协议）
```

---

## 3. 可扩展性维度

### 3.1 维度一：多 IDE 支持

**目标：** 不仅支持 Antigravity，也支持 Cortex、Cursor、Windsurf、Trae 等 IDE。

**当前障碍：**
- C1: LS 发现只认 Antigravity 进程
- C2: API key 从 Antigravity statedb 读取
- gRPC 协议可能不同（Cursor 用自己的协议）

**解决路线：**

```
阶段 1: 多签名 LS 发现
  discovery.ts 支持多组进程签名：
  ├─ Antigravity: argv.json 含 "antigravity"
  ├─ Cortex:      argv.json 含 "cortex"（如果是 fork）
  └─ 通用:        扫描已知 gRPC 端口

阶段 2: 插件化 Bridge
  bridge/
  ├─ antigravity-bridge.ts   ← 现有的 Connect-JSON 实现
  ├─ cortex-bridge.ts        ← Cortex 的 gRPC 适配
  ├─ cursor-bridge.ts        ← Cursor 的 HTTP API 适配
  └─ bridge-interface.ts     ← 统一接口定义

阶段 3: API Key 多来源
  认证优先级：
  1. 环境变量 AG_API_KEY
  2. ~/.ag-gateway/config.json 中的 api_key 字段
  3. Antigravity statedb（fallback）
  4. Cortex statedb
```

**接口定义（bridge-interface.ts）：**

```typescript
interface IDEBridge {
  readonly kind: string;  // 'antigravity' | 'cortex' | 'cursor' | ...
  
  // 发现
  discoverServers(): Promise<LanguageServer[]>;
  
  // 对话管理
  startConversation(server: LanguageServer, workspace: string): Promise<string>;
  sendMessage(conversationId: string, text: string, model?: string): Promise<void>;
  cancelConversation(conversationId: string): Promise<void>;
  
  // 状态订阅
  subscribeSteps(conversationId: string, onUpdate: StepCallback): () => void;
  getSteps(conversationId: string): Promise<Step[]>;
  
  // 元数据
  getApiKey(): Promise<string>;
  getModels(): Promise<ModelConfig[]>;
}
```

### 3.2 维度二：多 CLI 集成

**目标：** Gateway 统一调度 Gemini CLI、Codex CLI、Copilot CLI 等外部 CLI 工具。

**当前能力对比：**

```
                Antigravity LS    Gemini CLI    Codex CLI    Copilot CLI
──────────────────────────────────────────────────────────────────
集成方式          gRPC            --acp / -p     exec / proto   --acp / -p
文件操作          LS 内置          CLI 内置       CLI 内置       CLI 内置
多角色            Gateway 编排     ❌ 单 agent    ✅ multi_agent ❌ 单 agent
实时流            gRPC stream     stdout         stdout/proto  stdout
工具调用          LS 工具链       gemini 工具链  codex 工具链   copilot 工具链
MCP              ❌              ✅              ✅             ✅
Skills           .agents/        ~/.gemini/skills  ~/.codex/skills  ❌
Memories         brain/          ❌              ~/.codex/memories ❌
```

**集成架构：**

```
                     ┌────────────────────────┐
                     │      Unified Router     │
                     │                         │
                     │  路由决策：               │
                     │  ├─ 有 LS? → gRPC Bridge │
                     │  ├─ 需要 GPT? → Codex    │
                     │  ├─ 需要 Gemini? → Gem    │
                     │  └─ fallback → Copilot   │
                     └─────────┬───────────────┘
                ┌──────────────┼──────────────────┐
                ↓              ↓                  ↓
         ┌──────────┐   ┌──────────┐      ┌──────────┐
         │ gRPC     │   │ CLI Exec │      │ CLI Exec │
         │ Bridge   │   │ Adapter  │      │ Adapter  │
         │ (现有)   │   │ (Gemini) │      │ (Codex)  │
         └────┬─────┘   └────┬─────┘      └────┬─────┘
              ↓              ↓                  ↓
         Antigravity LS   gemini -p "..."   codex exec "..."
```

**CLI Exec Adapter 接口：**

```typescript
interface CLIExecAdapter {
  readonly cliName: string;
  readonly binaryPath: string;
  
  // 检查 CLI 是否可用
  isAvailable(): Promise<boolean>;
  
  // 执行任务
  execute(params: {
    prompt: string;
    workingDir: string;
    model?: string;
    timeout?: number;
  }): Promise<{ output: string; exitCode: number }>;
  
  // 流式执行（如果支持）
  stream?(params: {
    prompt: string;
    workingDir: string;
    onChunk: (text: string) => void;
  }): Promise<void>;
  
  // 获取可用模型
  listModels?(): Promise<string[]>;
}
```

### 3.3 维度三：数据层解耦

**目标：** 全局数据和配置不依赖任何特定 workspace 或 IDE。

详见 [data-architecture-migration.md](./data-architecture-migration.md)，核心三步：

```
Step 1: 注册表 → ~/.gemini/antigravity/gateway/ (AG_GATEWAY_HOME)
Step 2: 资产   → ~/.gemini/antigravity/gateway/assets/
Step 3: 环境变量 AG_GATEWAY_HOME 支持自定义路径
```

**长期目标数据模型：**

```
~/.ag-gateway/                    ← AG_GATEWAY_HOME（IDE 无关）
  ├── config.json                 ← Gateway 配置
  │   {
  │     "apiKeys": {
  │       "antigravity": "从 statedb 自动获取",
  │       "openai": "sk-...",
  │       "gemini": "从 ~/.gemini/oauth_creds.json 自动获取"
  │     },
  │     "defaultBackend": "antigravity",
  │     "port": 3000
  │   }
  ├── projects.json               ← 全局 Project 注册表
  ├── agent_runs.json             ← 全局 Run 注册表
  ├── assets/
  │   ├── templates/*.json        ← Pipeline 模板
  │   ├── review-policies/*.json  ← 审查策略
  │   └── workflows/*.md          ← 角色指令
  └── shared-skills/              ← 跨 CLI 共享 Skills
      ├── manifests/              ← 统一 Skill 定义
      └── adapters/               ← CLI 特定格式转换
          ├─ gemini/              ← symlink → ~/.gemini/skills/
          └─ codex/               ← symlink → ~/.codex/skills/
```

### 3.4 维度四：Multi-Tenant（多租户）

**目标：** 多个用户通过不同通道（微信、API、CLI）共享同一 Gateway 实例。

**当前状态：** 单用户设计（API key 来自 statedb，无用户隔离）。

**扩展路线：**

```
阶段 1: 多 Session 隔离（已实现）
  cc-connect 按微信用户 ID 隔离 session
  每个 session 有独立的 conversationId 和 model 选择

阶段 2: 用户认证 + 权限
  Gateway API 添加 Bearer token 认证
  不同用户绑定不同的 API key 和 workspace 权限
  ├─ 管理员：所有 workspace + 所有角色
  ├─ 开发者：指定 workspace + 限定角色
  └─ 观察者：只读 + Run 状态查看

阶段 3: 多 API Key 池
  不同用户/组织使用不同的 Antigravity API key
  按 quota 分配和计费
```

### 3.5 维度五：运行时扩展

**目标：** 支持自定义 agent 执行模式、工具链、审查策略。

**当前扩展点：**

| 扩展点 | 方式 | 复杂度 |
|--------|------|--------|
| 新增 Group | 添加模板 JSON | 低 |
| 新增 Workflow | 添加 `.md` 文件 | 低 |
| 新增执行模式 | 修改 `group-runtime.ts` | 高 |
| 新增审查策略 | 修改 `review-engine.ts` | 高 |
| 新增工具 | LS 侧添加（不受 Gateway 控制）| N/A |
| 新增 MCP 工具 | 修改 `src/mcp/server.ts` | 低 |

**长期方向：插件化执行模式**

```typescript
// execution-modes/registry.ts
interface ExecutionMode {
  readonly id: string;
  readonly name: string;
  
  // 验证 group 定义是否兼容
  validate(group: GroupDefinition): ValidationResult;
  
  // 执行编排
  execute(ctx: ExecutionContext): AsyncGenerator<RunUpdate>;
  
  // 响应干预（nudge/retry/cancel）
  handleIntervention(action: string, ctx: ExecutionContext): Promise<void>;
}

// 内置模式
export const BUILTIN_MODES = {
  'legacy-single': new LegacySingleMode(),
  'review-loop': new ReviewLoopMode(),
  'delivery-single-pass': new DeliverySinglePassMode(),
};

// 用户自定义模式
// ~/.ag-gateway/assets/modes/my-custom-mode.ts
```

### 3.6 维度六：可观测性

**目标：** 系统运行状态的全面可见性。

**当前状态：**

| 层级 | 日志 | 指标 | 追踪 |
|------|------|------|------|
| 接入层 | cc-connect 日志 | ❌ | ❌ |
| API 网关 | pino 日志 | ❌ | ❌ |
| 运行时 | pino 日志（详细） | ❌ | ❌ |
| 桥接层 | pino 日志 | ❌ | ❌ |
| LS | IDE 内部日志 | ❌ | ❌ |

**长期方向：**

```
阶段 1: 结构化日志标准化（已部分实现）
  所有日志使用 pino + 统一 context 字段
  ├─ runId, conversationId, projectId
  ├─ duration, stepCount, model
  └─ 输出到文件 + stdout

阶段 2: 运行时指标
  ├─ 每 Run 的耗时分布（各角色）
  ├─ 模型调用次数和 token 消耗
  ├─ 审查通过率
  └─ LS 发现成功率

阶段 3: 分布式追踪
  ├─ 请求ID 从接入层穿透到 LS
  ├─ 支持 OpenTelemetry 采集
  └─ Grafana/Jaeger 可视化
```

---

## 4. 演进路线图

### Phase 1: 数据解耦（基础设施）

```
目标：消除 process.cwd() 依赖
改动：run-registry / project-registry / asset-loader / statedb
产出：全局注册表 + 全局资产配置
前置条件：无
```

| 任务 | 改动文件 | 风险 |
|------|---------|------|
| 注册表路径改为 `AG_GATEWAY_HOME` | run-registry.ts, project-registry.ts | 低（纯路径改动） |
| 资产加载支持全局 + workspace override | asset-loader.ts | 低 |
| API Key 支持环境变量 fallback | statedb.ts | 低 |
| 数据迁移脚本 | scripts/ag-migrate.sh | 低 |
| 现有 data/*.json 向后兼容读取 | run-registry.ts | 低 |

### Phase 2: Bridge 抽象层

```
目标：支持多 IDE 后端
改动：bridge 层抽象化
产出：bridge-interface.ts + antigravity-bridge.ts
前置条件：Phase 1
```

| 任务 | 改动文件 | 风险 |
|------|---------|------|
| 定义 IDEBridge 接口 | bridge/bridge-interface.ts (新) | 低 |
| 将现有 grpc.ts 封装为 AntiBridge | bridge/antigravity-bridge.ts (新) | 中（重构） |
| discovery.ts 支持多签名 | bridge/discovery.ts | 低 |
| Gateway 按 bridge 类型路由 | bridge/gateway.ts | 中 |

### Phase 3: CLI 执行后端

```
目标：LS 不可用时 fallback 到 CLI
改动：新增 CLI exec adapter
产出：codex-adapter.ts, gemini-adapter.ts
前置条件：Phase 2
```

| 任务 | 改动文件 | 风险 |
|------|---------|------|
| CLI Exec Adapter 接口 | bridge/cli-adapter-interface.ts (新) | 低 |
| Codex CLI adapter | bridge/codex-adapter.ts (新) | 中 |
| Gemini CLI adapter | bridge/gemini-adapter.ts (新) | 中 |
| 路由决策逻辑 | bridge/gateway.ts | 中 |

### Phase 4: Gateway 独立进程化

```
目标：Gateway 脱离 Next.js dev server
改动：独立 HTTP server + 前端分离
产出：standalone gateway binary
前置条件：Phase 1-3
```

| 任务 | 改动文件 | 风险 |
|------|---------|------|
| 提取 API 路由为 Express/Fastify | src/server-standalone.ts (新) | 高 |
| 前端改为独立 SPA（Vite） | src/app/ → dist/ | 高 |
| 进程管理（systemd/launchd） | scripts/ag-service.ts (新) | 中 |
| 配置文件管理 | ~/.ag-gateway/config.json | 低 |

### Phase 5: 插件生态

```
目标：第三方可扩展 Gateway 功能
改动：插件接口 + 加载器
产出：plugin SDK
前置条件：Phase 4
```

| 任务 | 描述 |
|------|------|
| 执行模式插件 | 自定义 Pipeline 编排逻辑 |
| Bridge 插件 | 连接新 IDE/CLI |
| 接入层插件 | 新的消息通道（Discord、Slack、Telegram） |
| MCP 工具插件 | 动态注册 MCP 工具 |
| Skill 共享 | 跨 CLI 的统一 Skill 格式 |

---

## 5. 关键设计决策记录

### 决策 D1: 为什么不直接用 Codex CLI 替代 Gateway？

**背景：** Codex CLI 有 `multi_agent`、`memories`、`skills`，看似可以替代 Gateway。

**决策：** Gateway 保持独立，Codex 作为可选执行后端。

**理由：**
1. Codex CLI 的 `multi_agent` 是黑盒——无法控制角色分配、审查策略、工作包格式
2. Gateway 的 Pipeline 编排具有可定制的 source contract、review loop、交付包构建
3. Codex CLI 没有 ACP 模式，无法作为 cc-connect 的 agent
4. 保持自主权：不依赖单一 CLI 的功能演进方向

### 决策 D2: 为什么选 `~/.gemini/antigravity/gateway/` 而非 `~/.ag-gateway/`？

**背景：** 数据目录位置选择。

**决策：** 阶段 1 先用 `~/.gemini/antigravity/gateway/`，阶段 2 引入 `AG_GATEWAY_HOME` 环境变量。

**理由：**
1. `~/.gemini/antigravity/` 已存在，权限正确，不需创建新顶级 dotdir
2. 与 Antigravity 生态保持亲和性
3. 环境变量 `AG_GATEWAY_HOME` 提供未来灵活性

### 决策 D3: 为什么 Bridge 是同步调用而非异步消息队列？

**背景：** 运行时调用 gRPC 是同步的（`await grpc.sendMessage()`）。

**决策：** 保持同步，除非遇到性能瓶颈。

**理由：**
1. 当前规模（<10 并发 Run）不需要消息队列
2. 同步调用更容易追踪错误
3. 消息队列引入额外的基础设施依赖（Redis/RabbitMQ）
4. 如果未来需要，可以在 Bridge 层内部异步化，不影响上层

### 决策 D4: 产物 artifact 为什么留在 workspace 内？

**背景：** 是否把 artifact 也迁到 `AG_GATEWAY_HOME`。

**决策：** 保持在 `{workspace}/data/projects/{id}/runs/{runId}/`。

**理由：**
1. LS agent 需要读写这些文件（代码、文档、测试）
2. LS 的文件操作受限于 workspace 目录
3. 产物和代码放在一起方便 git 管理
4. 注册表中用 `workspace + relativePath` 定位产物，不需要集中存储

---

## 6. 接口稳定性承诺

### 稳定接口（不会 breaking change）

```
HTTP API 端点
  ├─ POST /api/agent-runs          ← dispatch
  ├─ GET  /api/agent-runs          ← list
  ├─ GET  /api/agent-runs/{id}     ← detail
  ├─ DELETE /api/agent-runs/{id}   ← cancel
  ├─ POST /api/projects            ← create
  ├─ GET  /api/projects            ← list
  ├─ POST /api/conversations       ← create
  ├─ POST /api/conversations/{id}/send ← send
  └─ GET  /api/models              ← list

WebSocket 消息格式
  ├─ { type: 'steps', steps: [...] }
  └─ { type: 'status', cascadeStatus, isActive }
```

### 可能变化的接口（演进中）

```
MCP 工具集                        ← 工具名可能调整
cc-connect ACP 命令               ← 关键词命令可能更名
Pipeline 模板 JSON schema         ← 字段可能增删
Group 定义 TypeScript 类型        ← 新增字段
```

---

## 7. 技术债务清单

| ID | 描述 | 优先级 | 影响范围 |
|----|------|--------|---------|
| TD-1 | `process.cwd()` 硬编码（4个文件） | **高** | 跨 workspace 功能 |
| TD-2 | JSON 文件持久化无并发保护 | 中 | 数据一致性 |
| TD-3 | Next.js dev server 作为 Gateway 容器 | 中 | 部署和性能 |
| TD-4 | statedb.ts 路径硬编码 | 中 | 多 IDE 支持 |
| TD-5 | discovery.ts 进程扫描方式 | 低 | 多 IDE 支持 |
| TD-6 | Supervisor Loop 创建过多对话（已修复，观察） | 低 | LS 负载 |
| TD-7 | workflow `.md` 未被 AssetLoader 统一管理 | 低 | 配置一致性 |
| TD-8 | review-engine.ts 审查策略硬编码 | 低 | 定制化 |
| TD-9 | scope-governor.ts 范围规则硬编码 | 低 | 定制化 |
| TD-10 | 无 API 认证（仅 127.0.0.1 限制） | 中 | 安全性 |

---

## 8. 附录：当前本机 IDE/CLI 安装情况

### 已安装的 IDE

| IDE | 数据目录 | 状态 |
|-----|---------|------|
| Antigravity | `~/.antigravity/` + `~/.gemini/antigravity/` | ✅ 主力 IDE |
| VS Code | `~/.vscode/` | ✅ 已安装 |
| VS Code Insiders | `~/.vscode-insiders/` | ✅ 已安装（当前使用） |
| Cursor | `~/.cursor/` | ✅ 已安装 |
| Trae | `~/.trae/` | ✅ 已安装 |

### 已安装的 CLI 工具

| CLI | 数据目录 | 版本/配置 |
|-----|---------|----------|
| Gemini CLI | `~/.gemini/` | `gemini-3-flash-preview`, OAuth 认证, 有 skills 和 projects |
| Copilot CLI | `~/.copilot/` | GitHub 账号 `pikapikaspeedup`, VS Code 集成 |
| OpenAI Codex CLI | `~/.codex/` | `gpt-5.4`, `multi_agent = true`, 有 sessions/memories/skills |

### 数据目录拓扑

```
~/
  ├── .antigravity/              ← IDE 安装配置
  │   ├── argv.json
  │   └── extensions/
  ├── .gemini/
  │   ├── antigravity/           ← Antigravity 运行时（conversations, brain, etc.）
  │   ├── settings.json          ← Gemini CLI 设置
  │   ├── projects.json          ← Gemini CLI 项目列表
  │   ├── skills/                ← Gemini CLI Skills（10+）
  │   └── oauth_creds.json       ← Gemini CLI OAuth 凭证
  ├── .copilot/
  │   ├── config.json            ← GitHub 登录信息
  │   └── session-state/
  ├── .codex/
  │   ├── config.toml            ← 模型/项目/功能配置
  │   ├── sessions/              ← 会话历史
  │   ├── memories/              ← 持久化记忆
  │   ├── skills/                ← Codex Skills
  │   └── rules/                 ← 命令审批规则
  ├── .vscode/
  ├── .vscode-insiders/
  ├── .cursor/
  └── .trae/
```

---

## 9. Phase 1 + 接口骨架 实施方案

> 总改动 ~200 行。目标：数据迁移 + Bridge 接口定义，为后续扩展留好扩展点。

### 9.1 改动文件清单

```
修改 (5 个文件):
  src/lib/agents/run-registry.ts          ← 改 DATA_DIR
  src/lib/agents/project-registry.ts      ← 改 DATA_DIR
  src/lib/agents/asset-loader.ts          ← 改 ASSETS_DIR
  src/lib/bridge/statedb.ts               ← 改 LOCAL_CACHE_DIR
  src/app/api/workspaces/close/route.ts   ← 改 hidden_workspaces.json 路径

新增 (3 个文件):
  src/lib/agents/gateway-home.ts          ← 统一路径常量
  src/lib/bridge/bridge-interface.ts      ← Bridge 统一接口定义
  scripts/ag-migrate.sh                   ← 数据迁移脚本
```

### 9.2 新增文件 1: gateway-home.ts

```typescript
// src/lib/agents/gateway-home.ts
// 统一的 Gateway 数据根路径。所有注册表和全局资产从此路径读取。
// 支持 AG_GATEWAY_HOME 环境变量 override。

import { homedir } from 'os';
import path from 'path';
import fs from 'fs';

const DEFAULT_HOME = path.join(homedir(), '.gemini', 'antigravity', 'gateway');

export const GATEWAY_HOME = process.env.AG_GATEWAY_HOME || DEFAULT_HOME;

// 确保目录存在
if (!fs.existsSync(GATEWAY_HOME)) {
  fs.mkdirSync(GATEWAY_HOME, { recursive: true });
}

// 注册表路径
export const PROJECTS_FILE = path.join(GATEWAY_HOME, 'projects.json');
export const RUNS_FILE = path.join(GATEWAY_HOME, 'agent_runs.json');
export const CONVS_FILE = path.join(GATEWAY_HOME, 'local_conversations.json');
export const HIDDEN_WS_FILE = path.join(GATEWAY_HOME, 'hidden_workspaces.json');

// 全局资产目录
export const GLOBAL_ASSETS_DIR = path.join(GATEWAY_HOME, 'assets');
```

### 9.3 修改 1: run-registry.ts

```diff
- import path from 'path';
- const DATA_DIR = path.join(process.cwd(), 'data');
- const PERSIST_FILE = path.join(DATA_DIR, 'agent_runs.json');
+ import { RUNS_FILE } from './gateway-home';
+ const PERSIST_FILE = RUNS_FILE;
```

`loadSnapshot()` 添加旧路径 fallback：

```typescript
function loadSnapshot() {
  if (fs.existsSync(PERSIST_FILE)) {
    return JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf-8'));
  }
  // Fallback: 旧路径
  const legacyFile = path.join(process.cwd(), 'data', 'agent_runs.json');
  if (fs.existsSync(legacyFile)) {
    log.info('Loading from legacy path, will save to new path on next write');
    return JSON.parse(fs.readFileSync(legacyFile, 'utf-8'));
  }
  return {};
}
```

### 9.4 修改 2: project-registry.ts

```diff
- const DATA_DIR = path.join(process.cwd(), 'data');
- const PERSIST_FILE = path.join(DATA_DIR, 'projects.json');
+ import { PROJECTS_FILE } from './gateway-home';
+ const PERSIST_FILE = PROJECTS_FILE;
```

workspace 内的 `project.json` 备份逻辑 **不改**（LS agent 需要本地读取）。

### 9.5 修改 3: asset-loader.ts

```diff
- const ASSETS_DIR = path.join(process.cwd(), '.agents', 'assets');
+ import { GLOBAL_ASSETS_DIR } from './gateway-home';
+
+ // 优先级：全局资产目录 → 回退到 workspace 本地
+ const ASSETS_DIR = fs.existsSync(path.join(GLOBAL_ASSETS_DIR, 'templates'))
+   ? GLOBAL_ASSETS_DIR
+   : path.join(process.cwd(), '.agents', 'assets');
```

### 9.6 修改 4: statedb.ts

```diff
- const LOCAL_CACHE_DIR = path.join(process.cwd(), '..', 'data');
- const LOCAL_CACHE_FILE = path.join(LOCAL_CACHE_DIR, 'local_conversations.json');
+ import { CONVS_FILE } from '../agents/gateway-home';
+ const LOCAL_CACHE_FILE = CONVS_FILE;
```

### 9.7 修改 5: workspaces/close/route.ts

```diff
- const DATA_DIR = path.join(process.cwd(), '..', 'data');
- const HIDDEN_FILE = path.join(DATA_DIR, 'hidden_workspaces.json');
+ import { HIDDEN_WS_FILE } from '@/lib/agents/gateway-home';
+ const HIDDEN_FILE = HIDDEN_WS_FILE;
```

### 9.8 新增文件 2: bridge-interface.ts

```typescript
// src/lib/bridge/bridge-interface.ts
// Bridge 统一接口。当前只有 Antigravity (gRPC) 实现。
// 未来可以添加 Codex CLI / Gemini CLI adapter。

export interface LanguageServerInfo {
  pid: number;
  port: number;
  csrf: string;
  workspace: string;
}

export interface StepUpdate {
  type: 'steps' | 'status' | 'error';
  steps?: any[];
  isActive?: boolean;
  cascadeStatus?: string;
}

export interface IDEBridge {
  readonly kind: string;

  discoverServers(): Promise<LanguageServerInfo[]>;

  startConversation(
    port: number, csrf: string, apiKey: string, workspaceUri: string
  ): Promise<string>;

  sendMessage(
    port: number, csrf: string, apiKey: string,
    conversationId: string, text: string, model?: string
  ): Promise<void>;

  cancelConversation(
    port: number, csrf: string, apiKey: string, conversationId: string
  ): Promise<void>;

  subscribeSteps(
    port: number, csrf: string, conversationId: string,
    onUpdate: (update: StepUpdate) => void
  ): () => void;

  getApiKey(): Promise<string>;
  getModels(port: number, csrf: string, apiKey: string): Promise<any[]>;
}
```

### 9.9 新增文件 3: ag-migrate.sh

```bash
#!/bin/bash
# 将现有 data/ 和 .agents/ 数据迁移到 ~/.gemini/antigravity/gateway/
# 用法: bash scripts/ag-migrate.sh
set -euo pipefail

TARGET="${AG_GATEWAY_HOME:-$HOME/.gemini/antigravity/gateway}"
echo "Migration target: $TARGET"

mkdir -p "$TARGET/assets/templates" "$TARGET/assets/review-policies" "$TARGET/assets/workflows"

# 迁移注册表
for f in projects.json agent_runs.json; do
  [ -f "data/$f" ] && cp -n "data/$f" "$TARGET/$f" && echo "✅ $f" || true
done

# ../data/ fallback (statedb 旧路径)
for f in local_conversations.json hidden_workspaces.json; do
  for src in "data/$f" "../data/$f"; do
    [ -f "$src" ] && [ ! -f "$TARGET/$f" ] && cp "$src" "$TARGET/$f" && echo "✅ $f" && break || true
  done
done

# 迁移资产
cp -n .agents/assets/templates/*.json "$TARGET/assets/templates/" 2>/dev/null && echo "✅ templates" || true
cp -n .agents/assets/review-policies/*.json "$TARGET/assets/review-policies/" 2>/dev/null && echo "✅ review-policies" || true
cp -n .agents/workflows/*.md "$TARGET/assets/workflows/" 2>/dev/null && echo "✅ workflows" || true

echo "Done. Verify: ls -la $TARGET"
```

### 9.10 向后兼容策略

```
读取优先级：
  1. GATEWAY_HOME/xxx.json (新路径)
  2. process.cwd()/data/xxx.json (旧路径 fallback)

写入：
  只写 GATEWAY_HOME (新路径)
```

首次写入后自动迁移——不需要强制运行迁移脚本。

### 9.11 验证清单

- [ ] `GET /api/agent-runs` 能读到历史 runs
- [ ] `POST /api/agent-runs` 新 run 写入到 GATEWAY_HOME
- [ ] `GET /api/projects` 能读到历史 projects
- [ ] `GET /api/pipelines` 能加载模板（从 GATEWAY_HOME/assets/）
- [ ] Web UI conversations 列表正常
- [ ] workspace 隐藏/显示功能正常
- [ ] 从不同 cwd 启动 Gateway 后数据仍可访问
- [ ] 设置 AG_GATEWAY_HOME 环境变量后路径正确
