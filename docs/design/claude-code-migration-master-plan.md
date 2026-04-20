# Claude Code 核心功能移植总纲

> **目标**：将 Claude Code 的核心能力从"CLI 子进程调用"升级为"内存级嵌入式集成"，使 Antigravity 平台获得产品级的代码执行、工具调用、权限管理和上下文构建能力。

---

## 一、移植范围总览

### 源代码规模

| 模块 | 行数 | 独立性 | 移植难度 |
|:-----|:----:|:------:|:-------:|
| 查询引擎（query.ts + QueryEngine.ts） | ~3,400 | 2/5 | ★★★★★ |
| API 客户端层（services/api/） | ~4,000 | 3/5 | ★★★★ |
| 工具系统（Tool.ts + tools.ts + 55 工具） | ~15,000 | 2/5 | ★★★ |
| 上下文构建（context.ts + claudemd.ts） | ~1,300 | 4/5 | ★★ |
| 权限系统（types + utils/permissions/） | ~2,000 | 3/5 | ★★★ |
| MCP 客户端（services/mcp/） | ~4,000 | 2/5 | ★★★★ |
| 记忆系统（memdir/） | ~900 | 4/5 | ★★ |
| 状态管理（state/ + bootstrap/） | ~1,500 | 2/5 | ★★★★★ |
| **合计** | **~32,000** | | |

> 注：55 个工具不需要全部移植。核心工具（文件操作 + Shell + 搜索）约 6 个，约 5,000 行。

### 依赖关系图

```
                    ┌──────────────────────┐
                    │     查询引擎          │
                    │  query.ts + QEngine   │
                    └────────┬─────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ API 客户端 │  │ 工具执行  │  │  压缩器   │
        │ claude.ts │  │ ToolExec │  │ compact/ │
        └────┬─────┘  └────┬─────┘  └──────────┘
             │              │
             │         ┌────┴────┐
             │         ▼         ▼
             │   ┌──────────┐ ┌──────────┐
             │   │ 工具注册  │ │ 权限系统  │
             │   │ tools.ts │ │ perms/   │
             │   └────┬─────┘ └────┬─────┘
             │        │            │
             ├────────┴────────────┤
             ▼                     ▼
       ┌──────────┐         ┌──────────┐
       │ 状态管理  │◄────────│  MCP     │
       │ AppState │         │ client   │
       └────┬─────┘         └──────────┘
            │
       ┌────┴────────┐
       ▼             ▼
 ┌──────────┐  ┌──────────┐
 │ 上下文    │  │  记忆     │
 │ context  │  │ memdir/  │
 └──────────┘  └──────────┘
```

**关键洞察**：状态管理（AppState）是中央总线，所有模块都依赖它。移植策略的核心是**用 Antigravity 自己的状态管理替代 AppState**，而不是照搬 Claude Code 的 React Context。

---

## 二、移植策略：自底向上 + 适配器隔离

### 核心原则

1. **不照搬 AppState** — 用 Antigravity 已有的 `AgentRunState` + `BackendRunConfig` 替代
2. **适配器模式** — 每个移植模块都通过适配器接入 Antigravity，不修改 Claude Code 原始代码
3. **渐进式替换** — 先移植底层（类型 + 工具接口），再移植上层（查询引擎）
4. **测试驱动** — 每个阶段都有独立测试，移植前先写测试

### 阶段总览

| 阶段 | 名称 | 移植内容 | 代码量 | 依赖 |
|:----:|:-----|:---------|:------:|:----:|
| M1 | 类型基座 | Tool 接口、消息类型、权限类型 | ~1,500 | 无 |
| M2 | 上下文层 | CLAUDE.md 发现、Git 状态、系统上下文 | ~1,300 | M1 |
| M3 | 记忆层 | memdir、MEMORY.md、相关性过滤 | ~900 | M2 |
| M4 | 工具层 | 6 核心工具 + 注册框架 | ~5,000 | M1 |
| M5 | 权限层 | 权限检查、规则优先级、mode 管理 | ~2,000 | M1, M4 |
| M6 | API 层 | 原生 fetch 调用、SSE 解析、重试与 usage | ~4,000 | M1 |
| M7 | MCP 层 | MCP client、工具发现、资源获取 | ~4,000 | M4, M5 |
| M8 | 查询引擎 | query loop、tool execution、compaction | ~3,400 | 全部 |

---

## 三、各阶段详细设计

### M1: 类型基座（~1,500 行）

**目的**：建立 Antigravity 内部的 Claude Code 兼容类型系统。

**移植文件**：
```
claude-code/src/Tool.ts              → ag/src/lib/claude-engine/types/tool.ts
claude-code/src/types/message.ts     → ag/src/lib/claude-engine/types/message.ts
claude-code/src/types/permissions.ts → ag/src/lib/claude-engine/types/permissions.ts
```

**核心类型**：
```typescript
// Tool 接口（简化版，去掉 React/UI 相关）
export type Tool<Input = AnyObject> = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute: (input: Input, context: ToolContext) => AsyncGenerator<ToolProgress>;
  isEnabled?: () => boolean;
  permissionRule?: PermissionRule;
};

// ToolContext（替代 AppState 依赖）
export type ToolContext = {
  workspacePath: string;
  abortSignal: AbortSignal;
  permissions: PermissionChecker;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  exec: (cmd: string) => Promise<ExecResult>;
};

// Message 类型
export type Message = UserMessage | AssistantMessage | SystemMessage;
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

// Permission 类型
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
export type PermissionResult<T = unknown> =
  | { type: 'allow'; value: T }
  | { type: 'deny'; reason: string }
  | { type: 'ask'; prompt: string };
```

**适配点**：
- `ToolContext` 替代 `ToolUseContext`（不依赖 AppState）
- 去掉 React Compiler 的 `_c()` memoization boilerplate
- 去掉 `bun:bundle` feature flag 依赖

**验收测试**：
- [ ] 类型能 import 不报错
- [ ] Tool 接口能正确定义工具
- [ ] Message 类型覆盖所有内容块

---

### M2: 上下文层（~1,300 行）

**目的**：在 Antigravity 内部构建 Claude Code 的上下文管道。

**移植文件**：
```
claude-code/src/context.ts           → ag/src/lib/claude-engine/context/system-context.ts
claude-code/src/utils/claudemd.ts    → ag/src/lib/claude-engine/context/claudemd.ts
claude-code/src/utils/git.ts (部分)  → ag/src/lib/claude-engine/context/git-context.ts
```

**核心功能**：
1. **CLAUDE.md 分层发现**：全局 → 用户 home → 项目根 → 当前目录 → .claude/rules/
2. **@include 递归**：支持 `@include path/to/file.md` 指令
3. **Git 状态快照**：branch、变更文件、最近 commit
4. **系统上下文**：OS、时间、shell、hostname

**适配点**：
- `bootstrap/state.ts` 的 `getCwd()` / `getOriginalCwd()` → 改为参数传入
- 去掉 memoize 全局缓存 → 改为实例级缓存
- 去掉 analytics 事件 → 可选 hook

**验收测试**：
- [ ] 发现 workspace 根目录的 CLAUDE.md
- [ ] 正确合并多层 CLAUDE.md
- [ ] @include 递归加载且防循环引用
- [ ] Git 状态正确提取

---

### M3: 记忆层（~900 行）

**目的**：为 agent run 提供项目记忆和相关性检索。

**移植文件**：
```
claude-code/src/memdir/memdir.ts              → ag/src/lib/claude-engine/memory/memdir.ts
claude-code/src/memdir/memoryTypes.ts          → ag/src/lib/claude-engine/memory/types.ts
claude-code/src/memdir/paths.ts                → ag/src/lib/claude-engine/memory/paths.ts
claude-code/src/memdir/findRelevantMemories.ts → ag/src/lib/claude-engine/memory/relevance.ts
```

**核心功能**：
1. **MEMORY.md 管理**：创建、读取、更新
2. **截断保护**：200 行 / 25KB 上限
3. **相关性搜索**：基于查询的记忆检索
4. **路径约定**：`~/.claude/memory/` 或 `$CLAUDE_CODE_MEMORY_DIR`

**适配点**：
- `analytics` 事件 → 可选 hook  
- `bootstrap/state.ts` → 参数传入

**验收测试**：
- [ ] 加载项目 MEMORY.md
- [ ] 截断超长内容并保留警告
- [ ] 相关性搜索返回匹配条目

---

### M4: 工具层（~5,000 行）

**目的**：移植核心工具 + 工具注册框架。

**先移植 6 个核心工具**：
```
claude-code/src/tools/FileReadTool/   → ag/src/lib/claude-engine/tools/file-read.ts
claude-code/src/tools/FileWriteTool/  → ag/src/lib/claude-engine/tools/file-write.ts
claude-code/src/tools/FileEditTool/   → ag/src/lib/claude-engine/tools/file-edit.ts
claude-code/src/tools/BashTool/       → ag/src/lib/claude-engine/tools/bash.ts
claude-code/src/tools/GlobTool/       → ag/src/lib/claude-engine/tools/glob.ts
claude-code/src/tools/GrepTool/       → ag/src/lib/claude-engine/tools/grep.ts
```

**工具注册框架**：
```
claude-code/src/tools.ts              → ag/src/lib/claude-engine/tools/registry.ts
claude-code/src/Tool.ts (findTool等)  → ag/src/lib/claude-engine/tools/lookup.ts
```

**核心功能**：
1. **FileEditTool**：diff-based 编辑、冲突检测、变更追踪
2. **BashTool**：shell 执行、timeout、stdout/stderr 分离
3. **Glob/Grep**：文件搜索、内容搜索、正则支持
4. **注册框架**：`registerTool()` + `getTools()` + 白名单/黑名单

**适配点**：
- `ToolUseContext` → `ToolContext`（M1 定义的）
- `AppState` 依赖 → 去掉
- `feature()` flag → 静态配置
- shell 执行路径 → 参数化（不硬编码 `/bin/bash`）

**验收测试**：
- [ ] FileReadTool 读取文件内容
- [ ] FileEditTool 执行 diff 编辑
- [ ] FileWriteTool 创建/覆盖文件
- [ ] BashTool 执行命令并返回输出
- [ ] GlobTool 按模式搜索文件
- [ ] GrepTool 搜索文件内容
- [ ] 工具注册和查找

---

### M5: 权限层（~2,000 行）

**目的**：在 Antigravity 内部实现权限决策链。

**移植文件**：
```
claude-code/src/utils/permissions/permissions.ts → ag/src/lib/claude-engine/permissions/checker.ts
claude-code/src/utils/permissions/rules.ts       → ag/src/lib/claude-engine/permissions/rules.ts
```

**核心功能**：
1. **规则优先级**：CLI > localSettings > projectSettings > userSettings
2. **模式管理**：default / acceptEdits / bypassPermissions / plan
3. **工具前缀匹配**：`mcp__server_name` 前缀
4. **Denial tracking**：防止重复询问

**适配点**：
- UI 组件 → 去掉（Antigravity 有自己的 intervention 机制）
- React Context → 纯函数
- AppState 依赖 → 参数传入

**权限检查接口**：
```typescript
export type PermissionChecker = {
  checkToolUse(toolName: string, input: unknown): PermissionResult;
  setMode(mode: PermissionMode): void;
  addRule(rule: PermissionRule): void;
  removeRule(ruleId: string): void;
};
```

**验收测试**：
- [ ] bypassPermissions 模式全部通过
- [ ] default 模式：文件写入返回 ask
- [ ] 规则优先级：高优先级 deny 覆盖低优先级 allow
- [ ] 工具前缀匹配

---

### M6: API 层（~4,000 行）

**目的**：直接调用 Anthropic Messages API（而不是通过 CLI 子进程）。

**当前已落地文件**：
```
claude-code/src/services/api/claude.ts        → ag/src/lib/claude-engine/api/client.ts
claude-code/src/services/api/withRetry.ts     → ag/src/lib/claude-engine/api/retry.ts
claude-code/src/Tool.ts                       → ag/src/lib/claude-engine/api/tool-schema.ts
claude-code/src/query/tokenBudget.ts (部分)   → ag/src/lib/claude-engine/api/usage.ts
```

**当前范围**：
1. Anthropic 直连：默认 endpoint 为 `https://api.anthropic.com/v1/messages`
2. 原生 `fetch` + SSE 解析：不依赖 `@anthropic-ai/sdk`
3. `query()`：通过流式事件拼装最终 `APIResponse`
4. `streamQueryWithRetry()`：指数退避 + jitter + retry event
5. `toolToAPISchema()`：内部 Tool → Anthropic `tools` JSON Schema
6. `UsageTracker`：累计 token usage 并估算 USD 成本

**暂不实现**：
1. OAuth 认证
2. Bedrock / Vertex / Foundry 实际调用
3. Claude Code 上游的多 provider adapter 全量迁移
4. `@anthropic-ai/sdk` 依赖接入

**核心接口**：
```typescript
export type QueryOptions = {
  model: ModelConfig;
  systemPrompt: string;
  messages: APIMessage[];
  tools?: APITool[];
  thinking?: { type: 'enabled'; budgetTokens: number } | { type: 'disabled' };
  maxOutputTokens?: number;
  signal?: AbortSignal;
  betas?: string[];
};

export async function* streamQuery(options: QueryOptions): AsyncGenerator<StreamEvent>;
export async function query(options: QueryOptions): Promise<APIResponse>;
```

**验收测试**：
- [x] headers / body 构建
- [x] SSE 行与帧解析
- [x] `query()` 从流事件拼装最终 `APIResponse`
- [x] 429 / 529 / 503 重试与 retry event
- [x] Tool schema 转换与 token usage 跟踪

---

### M7: MCP 层（~4,000 行）

**目的**：在 Antigravity 内部运行 MCP client。

**当前已落地文件**：
```
claude-code/src/services/mcp/types.ts           → ag/src/lib/claude-engine/mcp/types.ts
claude-code/src/services/mcp/client.ts          → ag/src/lib/claude-engine/mcp/client.ts
claude-code/src/services/mcp/* raw transport    → ag/src/lib/claude-engine/mcp/json-rpc.ts
claude-code/src/services/mcp/* stdio runtime    → ag/src/lib/claude-engine/mcp/stdio-transport.ts
工具桥接与多 server 管理                         → ag/src/lib/claude-engine/mcp/manager.ts
统一导出                                       → ag/src/lib/claude-engine/mcp/index.ts
```

**当前范围**：
1. **stdio-only transport**：运行时主链优先使用 `@modelcontextprotocol/sdk` 的 `Client` 与 `StdioClientTransport`。
2. **工具发现**：`McpClient.listTools()` 返回 `McpTool[]`，`McpManager.getAllTools()` 进一步桥接成 `mcp__server__tool` 形式的 Claude Engine Tool。
3. **工具调用**：`McpClient.callTool()` 与 `McpManager.callTool()` 已支持 stdio server 的工具调用结果映射。
4. **资源获取**：`McpClient.listResources()` 与 `readResource()` 已支持资源元数据与内容读取。
5. **轻量 helper**：仓库内保留 `json-rpc.ts` 与 `stdio-transport.ts`，用于最小 JSON-RPC/stdio primitive、测试和 fallback 边界。

**适配点**：
- `@modelcontextprotocol/sdk` → 直接依赖（npm 包）
- 连接缓存 → 实例级管理
- React 组件 → 去掉
- SSE / HTTP / OAuth → 当前不实现，只保留配置入口与类型扩展位

**验收测试**：
- [x] JSON-RPC helper：请求序列化、响应解析、通知识别、自增 ID
- [x] stdio helper transport：spawn、request/notify、buffer splitting、close
- [x] SDK-backed MCP client：connect、listTools、callTool、listResources、readResource
- [x] 多 server manager：add/remove/load/disconnect、工具聚合、`mcp__server__tool` 路由
- [ ] 真实 MCP server 端到端联调（当前仍全部 mock）

---

### M8: 查询引擎（~3,400 行）

**目的**：在 Antigravity 内部运行完整的 query loop。

**移植文件**：
```
claude-code/src/query.ts        → ag/src/lib/claude-engine/engine/query.ts
claude-code/src/QueryEngine.ts  → ag/src/lib/claude-engine/engine/query-engine.ts
```

**核心功能**：
1. **Query Loop**：消息准备 → API 调用 → 流式工具执行 → 结果处理 → 循环
2. **Auto-compaction**：token 超限时自动压缩上下文
3. **工具执行**：并行/串行执行、超时、abort
4. **会话管理**：turn 计数、token 预算、停止条件

**适配点**：
- `AppState` → `ClaudeEngineState`（新的轻量级状态容器）
- `bootstrap/state.ts` 全局单例 → 实例参数
- UI 回调 → 事件发射器
- Feature flags → 配置参数

**查询引擎接口**：
```typescript
export type ClaudeEngineConfig = {
  apiKey: string;
  model: string;
  tools: Tool[];
  permissions: PermissionChecker;
  mcpServers?: McpServerConfig[];
  claudeMdPaths?: string[];
  memoryDir?: string;
  maxTurns?: number;
  tokenBudget?: number;
  thinking?: ThinkingConfig;
  systemPrompt?: string;
  onStep?: (step: NormalizedStep) => void;
  onTokenUsage?: (usage: TokenUsage) => void;
};

export class ClaudeEngine {
  constructor(config: ClaudeEngineConfig);
  
  async *execute(prompt: string, workspace: string): AsyncGenerator<EngineEvent>;
  async resume(sessionId: string, prompt: string): AsyncGenerator<EngineEvent>;
  cancel(): void;
  
  getTokenUsage(): TokenUsage;
  getChangedFiles(): string[];
  getSteps(): NormalizedStep[];
}
```

**验收测试**：
- [ ] 简单文本对话
- [ ] 工具调用循环（读文件 → 编辑文件）
- [ ] Auto-compaction 触发
- [ ] Token 预算限制
- [ ] Cancel 中止执行
- [ ] Resume 恢复会话

---

## 四、目录结构

```
src/lib/claude-engine/
├── index.ts                  # 公共 API
├── types/
│   ├── tool.ts              # M1: Tool 接口
│   ├── message.ts           # M1: Message 类型
│   └── permissions.ts       # M1: Permission 类型
├── context/
│   ├── system-context.ts    # M2: 系统上下文
│   ├── claudemd.ts          # M2: CLAUDE.md 发现
│   └── git-context.ts       # M2: Git 状态
├── memory/
│   ├── memdir.ts            # M3: MEMORY.md 管理
│   ├── types.ts             # M3: 记忆类型
│   └── relevance.ts         # M3: 相关性搜索
├── tools/
│   ├── registry.ts          # M4: 工具注册
│   ├── lookup.ts            # M4: 工具查找
│   ├── file-read.ts         # M4: FileReadTool
│   ├── file-write.ts        # M4: FileWriteTool
│   ├── file-edit.ts         # M4: FileEditTool
│   ├── bash.ts              # M4: BashTool
│   ├── glob.ts              # M4: GlobTool
│   └── grep.ts              # M4: GrepTool
├── permissions/
│   ├── checker.ts           # M5: 权限检查
│   └── rules.ts             # M5: 规则引擎
├── api/
│   ├── types.ts             # M6: API 层类型
│   ├── client.ts            # M6: 原生 fetch + SSE 客户端
│   ├── retry.ts             # M6: 重试
│   ├── tool-schema.ts       # M6: Tool -> APITool JSON Schema
│   ├── usage.ts             # M6: usage 跟踪与成本估算
│   └── index.ts             # M6: 统一导出
├── mcp/
│   ├── client.ts            # M7: MCP 客户端
│   ├── types.ts             # M7: MCP 类型
│   └── auth.ts              # M7: MCP 认证
└── engine/
    ├── query.ts             # M8: Query Loop
    ├── query-engine.ts      # M8: QueryEngine
    └── state.ts             # M8: 轻量级状态容器
```

---

## 五、与现有代码的集成点

### Phase 1-4 的关系

Phase 1-4 建立的 `ClaudeCodeExecutor`（CLI 子进程调用）将作为 **fallback**。移植完成后：

```
ag/src/lib/providers/
├── claude-code-executor.ts      # Phase 1: CLI 子进程（fallback）
├── claude-code-normalizer.ts    # Phase 3: 事件归一化（保留）
└── claude-engine-executor.ts    # 新: 内存级调用（优先）
```

`claude-engine-executor.ts` 直接 import `ClaudeEngine`，不走子进程：

```typescript
import { ClaudeEngine } from '../claude-engine';

export class ClaudeEngineExecutor implements TaskExecutor {
  async executeTask(opts: TaskExecutionOptions): Promise<TaskExecutionResult> {
    const engine = new ClaudeEngine({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: opts.model || 'claude-sonnet-4-20250514',
      tools: getDefaultTools(),
      permissions: createPermissionChecker('bypassPermissions'),
      ...
    });
    
    const steps: NormalizedStep[] = [];
    let finalText = '';
    
    for await (const event of engine.execute(opts.prompt, opts.workspace)) {
      if (event.type === 'step') steps.push(event.step);
      if (event.type === 'text') finalText = event.text;
    }
    
    return {
      handle: engine.getSessionId(),
      content: finalText,
      steps,
      changedFiles: engine.getChangedFiles(),
      status: 'completed',
    };
  }
}
```

### Backend 注册

```typescript
// builtin-backends.ts
class ClaudeEngineAgentSession implements AgentSession {
  // 使用 ClaudeEngine 而不是 ClaudeCodeExecutor
  private engine: ClaudeEngine;
  
  private async run() {
    for await (const event of this.engine.execute(...)) {
      // 实时 emit live_state
      this.channel.push({ kind: 'live_state', ... });
    }
  }
}
```

---

## 六、风险与缓解

| 风险 | 影响 | 缓解措施 |
|:-----|:----:|:---------|
| AppState 依赖难解耦 | 高 | 用 ClaudeEngineConfig 替代，不直接依赖 AppState |
| Feature flag 导致代码分支多 | 中 | 移植时直接按"全部启用"处理，不保留 feature flag |
| React Compiler 输出难读 | 中 | 只移植核心逻辑，UI 层完全不移植 |
| 1341 个 tsc errors | 低 | 移植时逐个修复类型，不照搬 decompiled 类型 |
| Anthropic SDK 版本依赖 | 中 | 直接依赖 `@anthropic-ai/sdk`，锁定版本 |
| 工具安全性 | 高 | BashTool 必须有 sandbox/timeout；FileEdit 必须有冲突检测 |

---

## 七、移植顺序建议

```
M1 类型基座 ──→ M2 上下文 ──→ M3 记忆
                    │
                    ▼
              M4 工具层 ──→ M5 权限层
                    │
                    ▼
              M6 API 层 ──→ M7 MCP 层
                    │
                    ▼
              M8 查询引擎
```

**每个阶段都可以独立测试和交付。** M1-M3 完成后就有上下文构建能力。M4-M5 完成后就有工具执行能力。M6 完成后就有直接 API 调用能力。M7 是增强。M8 是集大成。

---

## 八、里程碑定义

| 里程碑 | 阶段 | 能力 | 测试标准 |
|:-------|:----:|:-----|:---------|
| **Alpha** | M1-M4 | 类型 + 上下文 + 记忆 + 6 核心工具 | 工具独立执行通过 |
| **Beta** | M5-M6 | + 权限 + API 直连 | 简单编码任务端到端跑通 |
| **RC** | M7-M8 | + MCP + 查询引擎 | 复杂多轮任务端到端跑通 |
| **GA** | 集成 | 替换 CLI 子进程 | 与 Phase 1-4 功能等价 + 性能更好 |
