# OPC Next — 演进路径规划

> 2026-04-02 讨论记录

---

## OPC 核心理念（2026-04-02 确认版）

### 一、组织架构映射

```
电脑 = 总部 / 分支机构（未来可能多台电脑）
文件夹 = 部门（多个文件夹可属于同一部门，有层级关系）
部门 ≈ IDE workspace（隔离 + 权限 + 指令）
```

### 二、组织治理

- 组织有目标（OKR），可级联分解到部门
- 部门有规范（类似 CLAUDE.md，发现并注入指令）
- **财务管控只有 Token 配额**，不做微管理
- 每个部门可自运营（自主选择工具、Provider、工作方式）
- 缺乏资源时可打**申请报告**给 CEO 审批

### 三、持久化记忆

- 跨会话记忆（不只是单次对话历史）
- 部门级知识（项目文档、架构决策、技术栈偏好）
- 组织级知识（全局策略、跨部门经验）

---

## 背景与现状

### 当前架构

Antigravity Gateway 是一个基于 Google DeepMind Antigravity IDE 的 Agentic Coding Platform：

- **多入口**：Web UI（React 19 + shadcn/ui）/ CLI / WeChat（cc-connect ACP）/ Obsidian 插件 / MCP Server
- **Agent Team Pipeline**：完整的 DagIR 编排引擎，支持 fan-out/join、subgraph、gate、switch、loop 节点
- **Review Engine**：Supervisor 审阅 + approve/revise/reject 多轮机制
- **Checkpoint/Replay**：项目状态快照与恢复
- **Source Contract**：上游产出自动注入下游的契约系统
- **Resource Policy**：资源配额策略（V5.4）

核心依赖链：**Gateway → gRPC Bridge → Antigravity Language Server**

### OPC 理念

- 每个目录/文件夹是一个工作区，代表一个"部门"
- CEO 派发任务 → 指定部门（文件夹范围）→ 通过 workflow 进行工作或自主工作
- 最大限度利用 IDE、CLI 等工具构建功能，确保安全性

### 两大挑战

1. **过度捆绑 Antigravity**：未来需要支持更多 API 或 CLI 工具（如 Codex CLI、Claude Code SDK 等）
2. **安全能力不足**：目前只面向 localhost，如果支持 API 接入，需要实现各类安全能力

---

## 整体架构设计

### 分层架构

```
┌──────────────────────────────────────────────────┐
│           Antigravity Gateway                     │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │     OPC Organization Layer                 │  │  ← 组织/部门/OKR/Token
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │     Orchestration Knowledge Layer          │  │  ← 记忆/指令/工具注册
│  │  Memory | Instructions | Skills | Workflow │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │     IDE Adapter Manager                    │  │  ← 配置同步/软连接
│  │  Claude | Cursor | Codex | VS Code         │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │     Gateway Tools (Provider 无关)          │  │  ← 基础 coding tools
│  │  FileRead | FileEdit | Bash | Grep | Glob  │  │    从 CCB 提取
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │     Security Layer                          │  │  ← 安全执行层
│  │  CommandParser | DangerDetector | Sandbox   │  │    借鉴 CCB BashTool
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │     Provider Adapter Layer                 │  │  ← Provider 抽象
│  │  Antigravity | LLM API | CLI Tools         │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### Gateway Tools（从 CCB 提取）

当使用第三方 LLM API（非 Antigravity）时，Gateway 需要自己的基础 coding tools：

| 工具 | CCB 来源 | 职责 |
|---|---|---|
| FileReadTool | `src/tools/FileReadTool/` | 带行号范围读取、编码检测 |
| FileEditTool | `src/tools/FileEditTool/` | diff-based 精确编辑 |
| FileWriteTool | `src/tools/FileWriteTool/` | 原子写入 + 编码保持 |
| BashTool | `src/tools/BashTool/` | 安全执行 + 超时 + 输出截断 |
| GrepTool | `src/tools/GrepTool/` | ripgrep 封装 |
| GlobTool | `src/tools/GlobTool/` | 文件搜索 |
| WebFetchTool | `src/tools/WebFetchTool/` | 网页抓取 |

提取策略：去掉 CCB 中的 Anthropic 特定依赖（telemetry、growthbook、feature flags），保留核心逻辑。

**Antigravity Provider** 使用 IDE Skills（更强），Gateway Tools 作为补充。  
**裸 LLM Provider** 完全使用 Gateway Tools。

### IDE Adapter Manager（配置同步）

不同 IDE/CLI 都支持 Markdown 格式指令和 workflows，但配置约定不同。

#### 各工具原生配置位置

| 概念 | Antigravity (Gemini) | Claude Code | Codex CLI | Cursor |
|---|---|---|---|---|
| **全局规则** | `~/.gemini/GEMINI.md` | `~/.claude/CLAUDE.md` | 无 | 无 |
| **全局工作流** | `~/.gemini/antigravity/global_workflows/` | 无 | 无 | 无 |
| **工作区规则** | `workspace/.agent/rules/` | `workspace/CLAUDE.md` | `workspace/AGENTS.md` | `workspace/.cursorrules` |
| **工作区工作流** | `workspace/.agent/workflows/` | 无 | 无 | 无 |
| **MCP 配置** | IDE 内建 | `workspace/.mcp.json` | 无 | 无 |

#### Source of Truth 设计

已有 `.department/config.json` 作为结构化配置源。现在新增统一的规则/工作流源：

```
workspace/
├── .department/
│   ├── config.json            ← 已有：部门结构化配置（OKR, skills, roster）
│   ├── rules/                 ← 新增：部门规则（Source of Truth）
│   │   └── department-rules.md
│   ├── workflows/             ← 新增：部门工作流（Source of Truth）
│   │   └── dev-workflow.md
│   └── memory/                ← 新增：部门持久记忆
│       ├── knowledge.md
│       ├── decisions.md
│       └── patterns.md
```

#### Symlink 策略

```
.department/rules/department-rules.md  ← Source of Truth
    ├── symlink → .agent/rules/department-rules.md   (Antigravity)
    ├── symlink → CLAUDE.md                          (Claude Code)
    ├── symlink → AGENTS.md                          (Codex CLI)
    └── symlink → .cursorrules                       (Cursor)

.department/workflows/dev-workflow.md  ← Source of Truth
    └── symlink → .agent/workflows/dev-workflow.md   (Antigravity)
    （其他工具暂无工作流约定，规则兜底即可）
```

**核心原则**：
- 规则内容在 `.department/rules/` 维护一份，各工具通过 symlink 读取
- Antigravity 天然支持 `rules/` 和 `workflows/` 目录，最契合
- Codex CLI 的 `AGENTS.md` 支持反复迭代（PR 评审反馈自动更新）
- Cursor 的 `.cursorrules` 也是纯文本，symlink 兼容

```bash
# CLI 命令
ag department init --name "后端开发"
ag department sync --ide antigravity   # symlink → .agent/rules/ + .agent/workflows/
ag department sync --ide claude-code   # symlink → CLAUDE.md + .mcp.json
ag department sync --ide codex         # symlink → AGENTS.md
ag department sync --ide cursor        # symlink → .cursorrules
ag department sync --all               # 全部 IDE
ag department watch                    # 监听变化自动同步
```

### Orchestration Knowledge Layer

Provider 无关的知识/能力层，负责组装好上下文后交给任何 Provider 执行。

#### 知识注入策略（Provider 差异化）

各 Provider 的文件访问范围不同，决定了知识注入方式：

| 知识 | 存放位置 | Antigravity 可访问 | Codex 可访问 | 注入方式 |
|---|---|---|---|---|
| 部门规则 | `workspace/.department/rules/` | ✅ symlink 到 `.agent/rules/` | ✅ symlink 到 `AGENTS.md` | 文件系统自动发现 |
| 部门记忆 | `workspace/.department/memory/` | ✅ 规则文件指引读取 | ✅ AGENTS.md 指引读取 | AGENTS.md 里写指引 |
| 组织记忆 | `~/.gemini/antigravity/memory/` | ✅ 全局规则自动加载 | ❌ workspace-write 沙箱不可达 | **Codex: `base-instructions` 参数** |
| 任务状态 | Gateway 内存 + JSON | — | — | Gateway 自行管理 |
| Token 配额 | Gateway 内存 | — | — | Gateway dispatch 前检查 |

**核心原则**：
- **workspace 内的知识** → 通过文件系统让 Provider 自己发现
- **workspace 外的知识** → Antigravity 全局规则自动加载；Codex 通过 `base-instructions` 参数注入
- **任务状态和配额** → Provider 不知道也不需要知道，Gateway 全权管理

#### Provider 执行流程

```
Gateway (group-runtime)
    │
    ├── 1. prepareAgentContext()
    │   ├── 读取组织级记忆 (~/.gemini/antigravity/memory/)
    │   ├── 检查 Token 配额
    │   └── 构造任务 prompt
    │
    ├── 2. 根据 provider 类型分流
    │   ├── Antigravity: grpc.startCascade() + grpc.sendMessage(prompt)
    │   │   └── IDE 自动加载 .agent/rules/ + .agent/workflows/（已 symlink）
    │   │   └── 全局规则 ~/.gemini/GEMINI.md 也自动加载
    │   │   └── 部门记忆由规则文件指引 Agent 读取
    │   │
    │   └── Codex MCP: codexClient.startSession(prompt, {
    │         cwd: workspace,
    │         sandbox: 'workspace-write',
    │         approvalPolicy: 'never',
    │         baseInstructions: orgMemory,  // ← 组织记忆通过此参数注入
    │       })
    │       └── AGENTS.md 自动发现（已 symlink）
    │       └── AGENTS.md 指引 Agent 读取 .department/memory/
    │
    ├── 3. 等待完成 + 收集结果
    │   ├── Antigravity: watchConversation() → IDLE 检测
    │   └── Codex MCP: startSession 返回 { threadId, content }
    │       └── 可选：codexClient.reply(threadId, followUp) 多轮
    │
    └── 4. 后处理
        ├── 更新 Run 状态 (updateRun)
        ├── 可选：AI 总结本次工作，追加到 .department/memory/
        └── 传递给下一个 Stage (Source Contract)
```

#### Codex CLI 沙盒权限说明

Codex CLI 有 3 种沙盒模式，决定能访问哪些文件：

| 模式 | workspace 内读 | workspace 内写 | workspace 外 |
|---|---|---|---|
| `read-only` | ✅ | ❌ | ❌ |
| `workspace-write` | ✅ | ✅ | ❌ |
| `danger-full-access` | ✅ | ✅ | ✅（不推荐）|

因此 `~/.gemini/` 目录对 Codex workspace-write 模式**不可达**，只能由 Gateway 在 prompt 中注入。

#### AGENTS.md 内容模板

```markdown
# Department: {部门名称}

## Rules
{.department/rules/department-rules.md 的内容，或 symlink}

## Memory References
Before starting any task, check the following files for relevant context:
- `.department/memory/knowledge.md` — Technical knowledge and patterns
- `.department/memory/decisions.md` — Past decisions and rationale  
- `.department/memory/patterns.md` — Best practices

Only read the files relevant to the current task. Do not read all of them unless necessary.

## Workflows
{如果有 .department/workflows/ 里的内容}
```

---

## 参考资源分析

本次讨论对比分析了三份 Claude Code 相关资料：

| 项目 | 性质 | 来源 | 可用性 |
|---|---|---|---|
| `claude_code_source` | Claude Code 原始 TS 源码（不完整） | npm 包提取/反编译 | 缺构建配置，不能直接运行 |
| HitCC | 纯文档逆向分析（27000+ 行，81 个文件） | 基于混淆 `cli.js` bundle 静态分析 | 无可执行代码，作为参考文档 |
| CCB (`claude-code`) | 可构建可运行的完整版（10k+ stars） | 基于同样源码 + 类型修复 + 工程化 | `bun install && bun run dev` 可跑 |

### HitCC 文档质量抽检结论

- **总体准确度 ~95%+**
- Hook 事件列表：遗漏 `PermissionDenied`（26 个中漏 1 个）
- 工具列表、CLI 命令树、入口分流架构、MCP 系统：与源码完全吻合
- 工具执行链（ToolSearch / deferred tools）：描述精确且深入
- 文档组织按运行时主题而非源码文件树，逻辑清晰

### 关键判断

Antigravity Gateway 的 Agent Team 编排能力已经**远超 Claude Code**：
- Claude Code 的 multi-agent 本质是 "prompt 驱动 + 本地文件共享状态"，没有真正的 DAG 编排
- Antigravity Gateway 有完整的 DagIR、fan-out/join、subgraph、source contract、checkpoint/replay

需要从 Claude Code 借鉴的只是：
1. Provider Adapter 层（解耦 Antigravity）
2. Permission/Hook 安全层（API 接入安全）
3. Instruction Discovery（OPC 文件夹即部门的指令系统）

---

## 演进路线图

### 阶段零：OPC 组织增强（增量扩展已有代码）

**目标**：在已有 `DepartmentConfig` 基础上增量扩展，建立规则/记忆/配额能力。

> **设计原则**：不新建数据模型，扩展已有接口；不引入新目录约定，沿用 `.department/`。

#### 数据模型扩展（增量）

```typescript
// 已有 DepartmentConfig (src/lib/types.ts) 新增字段
interface DepartmentConfig {
  // ... 现有字段（name, type, skills, OKR, roster, templateIds）保持不变 ...
  
  provider?: 'antigravity' | 'codex';   // 新增：部门默认 Provider
  tokenQuota?: TokenQuota;               // 新增：Token 配额
}

// 新增 Token 配额类型
interface TokenQuota {
  daily: number
  monthly: number
  used: { daily: number, monthly: number }
  canRequestMore: boolean
}

// 新增申请报告类型
interface ResourceRequest {
  id: string
  workspace: string          // 用 workspace URI 作为部门标识（已有模式）
  type: 'token_increase' | 'new_tool' | 'new_provider' | 'other'
  description: string
  status: 'pending' | 'approved' | 'rejected'
  ceoResponse?: string
  createdAt: string
}
```

#### 文件目录约定（统一为 `.department/`）

```
workspace/
├── .department/
│   ├── config.json            ← 已有：部门结构化配置
│   ├── rules/                 ← 新增：部门规则（Source of Truth）
│   │   └── department-rules.md
│   ├── workflows/             ← 新增：部门工作流（Source of Truth）
│   │   └── dev-workflow.md
│   └── memory/                ← 新增：部门持久记忆
│       ├── knowledge.md       ← 技术知识
│       ├── decisions.md       ← 决策日志
│       └── patterns.md        ← 最佳实践

~/.gemini/antigravity/          ← 沿用已有全局目录
├── memory/                    ← 新增：组织级持久记忆
│   ├── policies.md
│   ├── shared-knowledge.md
│   └── decision-log.md
└── requests/                  ← 新增：申请报告队列
    └── req-*.json
```

> 注：不使用 `.ag/` 新约定，直接复用已有的 `.department/` 和 `~/.gemini/antigravity/`。

#### 持久化记忆系统（Markdown 文件）

记忆以 Markdown 文件形式存储，Agent 可直接读取，人类也可直接编辑：

```
组织级（~/.gemini/antigravity/memory/）
    ├── policies.md          —— 全局策略和约束
    ├── shared-knowledge.md  —— 跨部门经验 
    └── decision-log.md      —— 重大决策日志

部门级（workspace/.department/memory/）
    ├── knowledge.md         —— 技术栈、框架偏好
    ├── decisions.md         —— 架构和实现决策
    └── patterns.md          —— 最佳实践和踩坑记录
```

**写入时机**：Run 完成后，Gateway 可选择让 AI 总结本次工作要点，追加到对应记忆文件。

**读取方式**：
- Antigravity：规则文件 `.agent/rules/read-memory.md` 指引 Agent 按需读取
- Codex CLI：`base-instructions` 参数注入组织级记忆 + AGENTS.md 指引读取部门级记忆

#### CEO 工作流

```
CEO（你）
    │
    ├── 设定 OKR → 写入 .department/config.json 的 okr 字段
    ├── 审批申请报告 → ~/.gemini/antigravity/requests/
    └── 查看全局状态 → 各部门进度、Token 消耗
    
部门（自运营）
    │
    ├── 接收任务 → Pipeline 派发
    ├── 在配额内自由操作
    ├── 生成记忆 → Run 完成后自动沉淀
    └── 遇到瓶颈 → 自动生成申请报告给 CEO
```

### 阶段一：Provider 抽象层（解耦 Antigravity）

**目标**：引入 Provider Adapter 接口，将所有 AI 能力调用从 Antigravity 硬编码解耦。

```
Engine Layer (group-runtime, project-registry)
    ↓
Provider Adapter Interface  ← 新增
    ├── AntigravityProvider (现有 grpc + discovery)
    ├── ClaudeCodeProvider  (Claude Code SDK / API)
    ├── CodexProvider       (OpenAI Codex CLI)
    └── GenericLLMProvider  (OpenRouter / 自定义)
```

**核心接口设计**：

```typescript
interface ProviderAdapter {
  createConversation(opts: ConvOptions): Promise<ConversationHandle>
  sendMessage(handle: ConversationHandle, msg: Message): AsyncIterable<StreamEvent>
  listTools(): Promise<ToolDefinition[]>
  executeTool(name: string, input: unknown): Promise<ToolResult>
  getCapabilities(): ProviderCapabilities  // 支持的功能矩阵
}
```

**参考**：Claude Code 的 Model Adapter 层（HitCC `docs/01-runtime/05-model-adapter-provider-and-auth.md`）

### 阶段二：安全体系（借鉴 Claude Code）

**目标**：为工具执行引入 4 层安全机制。

| 层 | Claude Code 机制 | Antigravity 对应实现 |
|---|---|---|
| Permission Mode | `default` / `auto` / `bypass` + classifier | Agent Group 级别权限模式 |
| Tool-level Policy | `alwaysAllow` / `alwaysDeny` / `alwaysAsk` 规则 | 扩展 `scope-check` API |
| Hook 审批 | `PreToolUse` / `PostToolUse` hook 可拦截 | 复用已有 Review Engine |
| Sandbox/Enterprise | managed policy + enterprise config | OPC 场景下的 Resource Policy |

**执行链扩展**：

```
Tool Call 
  → PreToolUse Hook (可拦截/修改输入)
  → Permission Classifier (auto mode: 判断是否安全)
  → 实际执行
  → PostToolUse Hook (可修改输出)
```

**参考**：CCB `src/types/hooks.ts` + `src/utils/permissions/`

### 阶段三：多 Provider Agent Team

**目标**：Pipeline 支持混合 Provider 编排。

```
CEO 派发任务
  → Stage 0: product-spec (Claude API — 擅长文档)
  → Stage 1: architecture (Antigravity — 有 IDE 上下文)
  → Stage 2: coding (Codex CLI — 代码执行沙盒)
  → Stage 3: review (Claude API — 擅长审阅)
```

每个 Agent Group 的 Role 可指定 `provider`，而不是所有人都走 Antigravity。

### 阶段四：OPC 文件夹即部门

**目标**：每个工作区文件夹有独立的权限配置、工具集和指令。

```
workspace/
├── .department/
│   ├── config.json       ← 已有：部门配置（含 OKR, skills, provider, tokenQuota）
│   ├── rules/            ← 部门规则
│   ├── workflows/        ← 部门工作流
│   └── memory/           ← 部门持久记忆
├── .agent/rules/         ← Antigravity symlink 目标
├── AGENTS.md             ← Codex CLI symlink 目标
└── ...工作文件
```

**参考**：Claude Code 的 project-level `.claude/settings.json` + `.mcp.json` + CLAUDE.md 发现机制

### 阶段五：开放 API 安全接入

**目标**：支持公开 API 访问，完善安全基础设施。

| 能力 | Claude Code 参考 | 实现方案 |
|---|---|---|
| Auth | OAuth + API Key + Keychain | JWT + API Key + Cloudflare Access |
| Session Isolation | session_id 隔离所有状态 | 扩展 cascadeId 到 Provider 级别 |
| Rate Limiting | policy limits + telemetry | 基于 Resource Policy 加入 API 层 |
| Audit Trail | telemetry events | 扩展 `/api/operations/audit` |
| Sandbox | managed policy + approval backend | Docker/nsjail per-workspace（远期）|

---

## 建议时间线

### 当前资源盘点

| 资源 | 状态 | 能力 |
|---|---|---|
| **Antigravity IDE** | ✅ 主力 | Ultra 会员，Language Server，完整 IDE Skills |
| **Codex CLI** | ✅ 可用 | OpenAI 的 CLI agent 工具 |
| **第三方 LLM API** | ❌ 暂无 | 未来可扩展（Claude API / GPT API / Gemini API）|

### 近期（1-2 周）— 基于现有 Antigravity + Codex CLI

目标：在不新增 API 的前提下，先建立 OPC 的组织基础。

```
1. DepartmentConfig 新增 provider + tokenQuota 字段          ~20 行
2. group-runtime Provider 分流（已有 CodexMCPClient）         ~80 行
3. .department/rules/ + symlink 同步                          ~80 行
4. .department/memory/ 读写 + Run 后自动沉淀                   ~200 行
总计                                                          ~380 行
```

### 中期（2-4 周）— Provider 抽象 + Gateway Tools

目标：建立 Provider 无关的工具和安全层。

```
1. 定义 ProviderAdapter 接口
2. 封装 AntigravityProvider（现有 gRPC Bridge）
3. 封装 CodexProvider（subprocess）
4. 从 CCB 提取基础 coding tools（file/bash/grep）
5. 实现安全执行层（精简版 BashTool 安全检测）
6. 实现 Orchestration Knowledge Layer（指令发现 + 3 层记忆）
```

### 远期（1-3 月）— 完整 OPC 自运营

```
1. 实现 OKR 系统（组织级 → 部门级级联分解）
2. 申请报告系统（部门→CEO 审批流）
3. 自动记忆沉淀（项目完成→知识提取→存入记忆）
4. CEO Dashboard（全局 OKR 进度 + Token 用量 + 部门状态）
5. 添加第三方 LLM API Provider（当有 API 时）
6. 通知集成（申请报告→WeChat/Obsidian 通知 CEO）
```

### 长远（3-6 月）— 多机协同

```
1. 多台电脑注册为分支机构
2. 跨机器部门管理和任务分发
3. 分布式记忆同步
4. 统一组织级 Dashboard
```

---

## 未来愿景：完整 OPC 运行画面

### 一天的工作流

```
早上 9:00 — CEO（你）开始工作日
    │
    ├── 打开 CEO Dashboard（Web UI 或 Obsidian）
    │   ├── 组织 OKR 进度总览
    │   ├── 各部门昨晚自动完成的任务
    │   ├── 待审批的申请报告（3 条）
    │   └── Token 消耗报表
    │
    ├── 审批申请报告
    │   ├── 后端部门：申请增加 10K Token 做性能优化 → 批准
    │   ├── 前端部门：申请使用 Claude API 做设计 → 批准并分配配额
    │   └── 测试部门：申请新增 MCP 工具 → 批准
    │
    ├── 派发新任务
    │   └── CEO: "给产品部做一个用户画像分析"
    │       → 系统自动：
    │         1. 识别目标部门（产品部）
    │         2. 加载部门规范（INSTRUCTIONS.md）
    │         3. 加载部门记忆（上次分析经验）
    │         4. 选择 Provider（产品部默认 Antigravity）
    │         5. 组装 system prompt（OKR + 规范 + 记忆 + 任务）
    │         6. 通过 Pipeline 派发（product-spec → analysis → report）
    │         7. CEO 可实时查看进度或等完成通知
    │
    └── 自运营中...
        ├── 后端部门（Antigravity Provider）
        │   ├── 自动检测到 PR 需要 review → 启动 ux-review Pipeline
        │   ├── 在 Token 配额内自主完成
        │   └── 完成后自动沉淀记忆（代码规范、架构决策）
        │
        ├── 前端部门（未来 Claude API Provider）
        │   ├── 收到设计任务 → 自动加载设计稿
        │   ├── 使用 LLM API 分析设计稿
        │   └── 生成开发任务清单 → 转交后端部门
        │
        └── 测试部门（Codex CLI Provider）
            ├── 自动扫描最新代码变更
            ├── 用 Codex CLI 生成测试用例
            └── 运行测试并报告结果

晚上 — 系统自动
    ├── 各部门完成状态上报
    ├── 记忆沉淀（知识/决策/经验）
    ├── Token 用量结算
    └── 准备明天的 CEO 日报
```

### 部门自运营的关键机制

```
部门收到任务
    │
    ├── 1. 检查 OKR：任务是否符合本部门目标？
    │   └── 不符合 → 转交给合适的部门或上报 CEO
    │
    ├── 2. 检查资源：Token 配额是否充足？
    │   └── 不足 → 自动生成申请报告给 CEO
    │
    ├── 3. 加载上下文：
    │   ├── 部门规范（INSTRUCTIONS.md）
    │   ├── 相关记忆（技术栈、架构决策、过往经验）
    │   ├── 关联部门的共享知识（如果需要跨部门协作）
    │   └── 工具集（Provider Skills + Gateway Tools + MCP Tools）
    │
    ├── 4. 选择执行方式：
    │   ├── 简单任务 → 直接执行（单 Agent + Provider）
    │   ├── 复杂任务 → 启动 Pipeline（多 Stage + Review）
    │   └── 跨部门任务 → fan-out 到相关部门的子 Project
    │
    ├── 5. 执行：
    │   ├── 在配额内自主操作
    │   ├── 安全层实时检查（命令安全、权限、路径约束）
    │   └── 遇到需要权限的操作 → Hook 审批（自动或上报 CEO）
    │
    └── 6. 完成后：
        ├── 输出交付物
        ├── 自动沉淀记忆（学到了什么、做了什么决策）
        ├── 更新 OKR 进度
        └── 上报状态（完成/阻塞/需要帮助）
```

### 跨部门协作场景

```
CEO: "开发一个新的用户登录功能"
    │
    ├── Stage 0: 产品部  ← product-spec Pipeline
    │   ├── Provider: Antigravity（有 IDE 上下文）
    │   ├── 输出: 产品需求文档 PRD.md
    │   └── 记忆: 产品部记下"用户偏好手机号登录"
    │
    ├── Stage 1: 架构部  ← architecture-advisory Pipeline
    │   ├── Provider: Antigravity（分析代码库）
    │   ├── 输入: PRD.md（Source Contract 自动注入）
    │   ├── 输出: 技术方案 TECH_SPEC.md
    │   └── 记忆: 架构部记下"选择 JWT + OAuth2"
    │
    ├── Stage 2: 后端部门  ← autonomous-dev-pilot Pipeline
    │   ├── Provider: Antigravity（写代码）
    │   ├── 输入: PRD.md + TECH_SPEC.md（自动注入）
    │   ├── 输出: 后端代码 + API 文档
    │   └── 记忆: 后端部记下"遇到的坑和解决方案"
    │
    ├── Stage 3: 前端部门  ← autonomous-dev-pilot Pipeline
    │   ├── Provider: Codex CLI（当前可用）
    │   ├── 输入: PRD.md + API 文档
    │   ├── 输出: 前端代码
    │   └── 记忆: 前端部记下"组件复用经验"
    │
    └── Stage 4: 测试部门  ← testing Pipeline
        ├── Provider: Codex CLI
        ├── 输入: 前后端代码
        ├── 输出: 测试报告
        └── 记忆: 测试部记下"边界用例和回归策略"

全部完成后：
    ├── CEO 收到完成通知（WeChat / Obsidian）
    ├── 各部门记忆自动沉淀
    ├── 组织级知识更新（"登录功能用 JWT + OAuth2，前端用 xxx 组件"）
    └── OKR 自动更新进度
```

### 多机协同场景（远期）

```
总部电脑（Mac Pro）
    ├── 产品部、架构部、CEO Dashboard
    └── Cloudflare Tunnel → 外网可达

分支 1（MacBook）
    ├── 前端部门
    ├── 本地有前端项目代码
    └── 注册到总部 Gateway

分支 2（Linux Server）
    ├── 后端部门、测试部门
    ├── 有 CI/CD 环境
    └── 注册到总部 Gateway

CEO 视角：统一 Dashboard，不感知哪个部门在哪台机器
```

## 现有能力对照

| OPC 需求 | 现有能力 | 状态 | 缺口 |
|---|---|---|---|
| 电脑 = 总部/分支 | Cloudflare Tunnel + Gateway | ⚠️ 单机 | 多机协同、分布式注册 |
| 文件夹 = 部门 | `.department/config.json` + Department API | ✅ 有 | — |
| 组织目标/OKR | `DepartmentOKR` 接口已定义 | ✅ 有 | Token 配额结算到部门 |
| 部门规范/指令 | Antigravity: `.agent/rules/` + `.agent/workflows/` | ✅ 原生 | 需 symlink 到其他 IDE |
| Codex CLI 适配器 | `codex-adapter.ts` (完整 MCP 客户端) | ✅ 有 | 需接入 group-runtime |
| CEO Agent | `ceo-agent.ts` + `ceo-tools.ts` + `ceo-prompts.ts` | ✅ 有 | — |
| Token 管控 | Resource Policy (V5.4) | ✅ 有基础 | 按部门配额 |
| 自运营 | Agent Team Pipeline (DagIR) | ✅ 有 | — |
| 打申请报告给 CEO | `report_to_human` action | ⚠️ 被动 | 结构化申请/审批流 |
| 持久化记忆 | Run 历史 + Checkpoint | ⚠️ 局部 | 跨会话知识沉淀 |
| 安全执行 | scope-check | ⚠️ 基础 | 命令解析、危险检测 |
| 多 Provider 集成 | Antigravity gRPC + Codex MCP Client | ⚠️ 并行 | group-runtime 统一分流 |

### 精确缺口清单（单文件夹 = 一个部门）

| # | 缺口 | 优先级 | 代码量 | 说明 |
|---|---|---|---|---|
| 1 | DepartmentConfig 新增 provider 字段 | ✅ 简单 | ~20行 | 扩展已有接口，不新建模型 |
| 2 | group-runtime Provider 分流 | 🟡 中 | ~80行 | 复用已有 CodexMCPClient，在 startChildConversation 中分流 |
| 3 | `.department/rules/` + symlink 同步 | 🟡 中 | ~80行 | `ag department sync` 命令 |
| 4 | `.department/memory/` 持久化记忆 | 🔴 高 | ~200行 | Markdown 文件 + Run 完成后自动知识提取 |
| 5 | 部门级 Token 配额 | 🟢 低 | ~80行 | tokenQuota 字段 + dispatch 前检查 |
| 6 | 资源申请报告 | 🟢 低 | ~120行 | `/api/ceo/requests` + 部门超额自动生成 |

**必做**（缺口 1-4）：~380 行 | **可选**（缺口 5-6）：~200 行

---

## 设计决策记录（2026-04-02 确认）

### 决策 1：Codex CLI 集成模式 → MCP 多轮（已有代码）

| 选项 | 描述 | 结论 |
|---|---|---|
| **MCP 多轮** | `CodexMCPClient.startSession()` + `reply()` | ✅ **选定** |
| exec 模式 | `codexExec(prompt)` 一次性执行 | 备选（fallback） |

理由：
- `codex-adapter.ts` 已完整实现了 MCP 客户端（start/stop/startSession/reply）
- MCP 支持 `base-instructions` 参数，可以优雅地注入组织级记忆
- MCP 支持多轮对话（threadId），可复用会话
- MCP 返回结构化结果 `{ threadId, content }`
- exec 作为 fallback 保留（简单任务或 MCP 不可用时）

### 决策 2：指令注入 → 文件系统发现（symlink/拼接）

| Provider | 方式 | 目标文件 |
|---|---|---|
| Antigravity | symlink `.department/rules/` → `.agent/rules/` | IDE 自动加载 |
| Codex CLI | symlink `.department/rules/department-rules.md` → `AGENTS.md` | CLI 自动发现 |
| Claude Code | symlink → `CLAUDE.md` | CLI 自动发现 |
| Cursor | symlink → `.cursorrules` | IDE 自动发现 |

各工具都自动发现各自的规则文件，Gateway 不需要在 sendMessage 时手动注入指令。

### 决策 3：记忆注入 → AGENTS.md 指引读取（而非拼接）

规则文件（AGENTS.md / `.agent/rules/`）中加入指引，提醒 Agent 按需读取 `.department/memory/` 目录。

优点：
- 不会因记忆膨胀导致 AGENTS.md 过大
- Agent 按需读取相关记忆，不浪费上下文
- Codex CLI 有内建文件读取工具，可以自行读取

### 决策 4：Agent 间通讯 → Gateway 中心调度

| 方案 | 适用场景 | 结论 |
|---|---|---|
| 文件信箱（Claude Code 方式） | 分布式多进程 | ❌ 不适用 |
| **Gateway 中心调度** | Hub-and-spoke 架构 | ✅ **选定** |

理由：Gateway (group-runtime) 是中心调度器，Agent 间数据传递通过 Source Contract + artifact manifest 完成（已有）。不需要 Claude Code 的文件信箱机制。

### 决策 5：组织级知识注入 → base-instructions 参数

`~/.gemini/antigravity/memory/` 目录不在 workspace 内，Codex CLI `workspace-write` 沙箱无法访问。

解决方案：
- **Antigravity**：全局规则 `~/.gemini/GEMINI.md` 自动加载
- **Codex CLI**：通过 MCP `base-instructions` 参数注入

```typescript
// Gateway 读取组织记忆，通过 base-instructions 注入
const orgMemory = readFileSync('~/.gemini/antigravity/memory/policies.md', 'utf-8');
const result = await codexClient.startSession(taskPrompt, {
  cwd: workspace,
  sandbox: 'workspace-write',
  approvalPolicy: 'never',
  baseInstructions: orgMemory,  // ← Codex MCP 原生支持
});
```

### 决策 6：任务状态管理 → Gateway 全权管理

Provider（Antigravity / Codex / 未来 API）只负责"执行"，不感知也不更新任务状态。

- Antigravity：Gateway 通过 `watchConversation()` 检测 IDLE 状态
- Codex CLI：Gateway 等待 exec 进程退出，收集 stdout + 文件变更
- 未来 API：Gateway 等待 HTTP 响应

所有状态更新（`updateRun`）、记忆沉淀、Stage 传递均由 Gateway 完成。

---

## Claude Code Terminal 安全层分析

Claude Code 的 BashTool 不是简单的 `exec()`，而是一套 **6 层安全命令执行引擎**：

### 6 层安全防护

1. **命令解析层**（Tree-Sitter AST）
   - 用 tree-sitter 做语法树级别的命令分析
   - 复合命令拆分、子命令提取、重定向检测、heredoc 解析

2. **危险模式检测**（23+ 类攻击向量）
   - `$()` 命令替换、`<()` 进程替换、Zsh 危险命令
   - IFS 注入、Unicode 空白字符、控制字符
   - `jq` 系统函数调用、环境变量劫持
   - `/proc/environ` 访问、花括号展开攻击等

3. **权限分类器**（AI + 规则双引擎）
   - 通配符规则匹配（`Bash(npm:*)` 允许所有 npm 命令）
   - 环境变量前缀/Wrapper 命令自动剥离
   - Auto mode 下用 LLM 判断命令安全性

4. **沙盒隔离**：可配置排除命令、远程模式更严格

5. **路径约束 + 只读模式**：命令不能逃出工作区

6. **语义理解**：理解不同命令的退出码含义

### 集成建议：自建精简安全层

当前 Antigravity 和 Codex CLI 各自有内建安全机制（Antigravity IDE 权限系统、Codex 沙箱）。未来接入裸 LLM API 时，需要自建精简安全层：

```
自建精简安全层（借鉴 BashTool 设计理念）
    ├── 命令白名单/黑名单（已有 scope-check）
    ├── 工作目录锁定（限制在 workspace 内）
    ├── 危险模式检测（最关键的 10 类即可）
    └── PreExecute/PostExecute hook（复用 Review Engine）
```

核心思路：
- **Antigravity Provider** → IDE 自带权限系统
- **Codex CLI Provider** → Codex 自带沙箱（read-only / workspace-write）
- **未来裸 LLM API** → 需要自建安全层（参考 CCB BashTool）
- 不需要复制 BashTool 的全部 2000+ 行安全代码

---

## 关于直接使用 Claude Code 代码的建议

1. **可以直接用 CCB 跑起来理解机制**，然后在 Antigravity Gateway 中按同样的设计理念实现（不抄代码）
2. **官方 SDK（`@anthropic-ai/claude-code`）可作为未来 Provider 选项之一**，但因为是黑盒（无法自定义内部安全策略、调试内部流程），不作为主路径
3. **不建议 fork CCB 作为底座**——Antigravity Gateway 的架构已经更先进，强耦合逆向代码会成为技术负债（CCB 有 1341 个 tsc 错误，作者不确定项目能存活多久）
4. **HitCC 文档可作为长期参考**——理解 Claude Code 的设计决策和边界
