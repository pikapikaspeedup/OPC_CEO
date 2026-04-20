# Antigravity 产品演进路径

> 从单机 CLI 到开放 Multi-Provider 平台的完整演进历程。

---

## 演进全景

```
Phase 1              Phase 2                    Phase 3                Phase 4              Phase 5+
CLI 工具             Multi-Agent Workflow        OPC 架构               开放 Provider         下一代
(2024 Q3)            (2024 Q4 - 2025 Q1)        (2025 Q2 - Q4)         (2026 Q1 - Q2)       (2026 Q3+)

┌───────────┐    ┌────────────────────┐    ┌──────────────────┐    ┌─────────────────┐    ┌────────────┐
│ Gateway   │    │ 4-Stage Pipeline   │    │ OPC 分层架构      │    │ Provider 抽象    │    │ 智能路由   │
│ Bridge    │ →  │ Group Runtime      │ →  │ Orchestrator     │ →  │ claude-api      │ →  │ 自动降级   │
│ REST API  │    │ Review Loop        │    │ Pipeline         │    │ openai-api      │    │ 费用优化   │
│ WebSocket │    │ Scope Governor     │    │ Controller       │    │ ClaudeEngine    │    │ 混合执行   │
└───────────┘    └────────────────────┘    └──────────────────┘    └─────────────────┘    └────────────┘
```

---

## Phase 1: Antigravity Gateway CLI（2024 Q3）

**核心命题**: 让 Antigravity 走出桌面 IDE

**关键里程碑**:
- 通过 `ps` + `lsof` 自动发现 Language Server 实例
- gRPC-Web Connect 编解码桥接
- REST API + WebSocket 实时流
- Web UI 远程访问

**架构特征**:
```
客户端 → HTTP/WS → Gateway → gRPC → Language Server
```

**局限**: 单一 Provider（仅 Antigravity gRPC），无 Agent 编排能力。

---

## Phase 2: Multi-Agent Workflow（2024 Q4 - 2025 Q1）

**核心命题**: 从"对话式开发"到"工程化交付"

**关键里程碑**:
- 4 阶段 Pipeline: 产品定义 → 架构设计 → 自治开发 → 审查交付
- Group Runtime 编排器: 支持 `review-loop`、`delivery-single-pass`、`legacy-single`
- Author-Reviewer 对抗审查循环
- Scope Governor 写入范围审计
- Work Package 结构化产物传递
- Supervisor 监督看护（3 min 无进度检测）

**架构特征**:
```
用户需求 → Dispatcher → Stage Runtime → Role Execution → Review Engine
                ↓              ↓               ↓
         Run Registry    Pipeline Reg.    Scope Governor
```

**局限**: 所有执行仍通过 Antigravity gRPC，无法脱离 IDE。

---

## Phase 3: OPC 架构（2025 Q2 - Q4）

**核心命题**: 分层解耦，可独立扩展

**OPC = Orchestrator + Pipeline + Controller**

| 层 | 职责 | 关键模块 |
|:---|:-----|:---------|
| **Orchestrator** | 项目级编排、跨阶段协调 | `project-registry.ts`, `dispatch-service.ts` |
| **Pipeline** | 流水线定义、阶段依赖、模板管理 | `pipeline-registry.ts`, `template-resolver.ts` |
| **Controller** | 运行控制、监督、干预 | `group-runtime.ts`, `supervisor.ts`, `watch-conversation.ts` |

**关键里程碑**:
- 项目容器（Project 管理 DAG、跨 Stage 状态）
- Pipeline 模板系统（JSON 声明式 + 可视化编辑）
- 数据契约系统（Stage 间类型化输入/输出校验）
- 知识库管理（Knowledge Items + Artifacts）
- 多端接入：微信、Obsidian 插件、MCP Server
- i18n 国际化（中/英双语 276 条消息）
- CEO Office 模式
- 定时调度器

**架构特征**:
```
                    Orchestrator
                    ├── Project Graph (DAG)
                    ├── Cross-Stage Coordination
                    └── Memory & Knowledge
                         │
                    Pipeline Layer
                    ├── Template Registry
                    ├── Data Contract Validation
                    └── Subgraph Reuse
                         │
                    Controller Layer
                    ├── Stage Runtime
                    ├── Supervisor Loop
                    └── Watch + Merger
```

**局限**: Provider 仍硬编码为 Antigravity gRPC（后期加了 Codex 但手动切换）。

---

## Phase 4: 开放 Provider 体系（2026 Q1 - Q2）

**核心命题**: 从"锁定单一 Provider"到"开放多 Provider 平台"

### 4.1 Provider Abstraction Layer（V6）

统一 `TaskExecutor` 接口 + 4 级解析优先级，所有 AI 交互通过抽象层路由。

**已实现 Provider**:

| Provider ID | 执行器 | 协议 | 状态 |
|:-----------|:-------|:-----|:-----|
| `antigravity` | `AntigravityExecutor` | gRPC → Language Server | ✅ 生产 |
| `codex` | `CodexExecutor` | MCP → Codex CLI | ✅ 生产 |
| `claude-code` | `ClaudeCodeExecutor` | Claude Code CLI → stream-json | ✅ 生产 |
| `claude-api` | `ClaudeEngineAgentBackend` | 内存级 → Anthropic API | ✅ 新增 |
| `openai-api` | — | — | 🔧 预留 |
| `custom` | — | — | 🔧 预留 |

### 4.2 ClaudeEngine — 内存级 LLM 执行引擎

独立于 Claude Code CLI 的进程内引擎，8 层架构，215 条测试全覆盖：

```
src/lib/claude-engine/
├── M1 types/          — Tool, Message, Permission 类型体系
├── M2 context/        — CLAUDE.md 发现, Git 状态, 系统上下文
├── M3 memory/         — MEMORY.md 管理, 相关性检索
├── M4 tools/          — 6 核心工具 + 路径沙箱 + 安全防护
├── M5 permissions/    — 权限检查器, 规则解析, MCP 匹配
├── M6 api/            — 原生 fetch SSE, 重试, Usage 跟踪
├── M7 mcp/            — MCP 客户端, stdio transport
└── M8 engine/         — 查询循环, 工具执行器, ClaudeEngine
```

**关键突破**:
- 无外部依赖（不依赖 @anthropic-ai/sdk，用原生 fetch 实现 SSE）
- 进程内直接调用，避免 CLI 子进程开销
- 完整的 JSON-RPC MCP 客户端
- 流式 API + 自动重试（429/529 指数退避）

### 4.3 架构特征

```
前端选择 Provider
      ↓
resolveProvider() → 4 级优先级
      ↓
getAgentBackend(providerId)
      ├── AntigravityAgentBackend    → gRPC → IDE Runtime
      ├── ClaudeCodeAgentBackend     → spawn CLI → stream-json
      ├── ClaudeEngineAgentBackend   → in-process → Anthropic API
      ├── CodexAgentBackend          → MCP → Codex CLI
      └── (future: OpenAI, custom)
```

---

## Phase 5+: 下一代能力（2026 Q3+）

**展望方向**:

| 能力 | 描述 |
|:-----|:-----|
| **智能 Provider 路由** | 根据任务复杂度、成本、延迟自动选择最佳 Provider |
| **自动降级** | 429/529 时自动 fallback 到备用 Provider |
| **混合执行** | 同一 Pipeline 中不同 Stage 使用不同 Provider |
| **费用优化** | 基于 token 单价和任务 budget 的成本感知调度 |
| **消息压缩** | autoCompact 长对话自动压缩 |
| **向量知识库** | 嵌入向量 + 语义检索 |
| **多租户** | 用户隔离 + 认证体系 |
| **Settings UI** | 可视化 Provider/Model/Key 管理 |
| **Usage 仪表盘** | Token 消耗、费用追踪、Provider 对比 |

---

## 核心设计原则

贯穿所有 Phase 的不变量：

1. **渐进式开放** — 每个 Phase 扩展一个维度，不破坏已有功能
2. **接口抽象** — `TaskExecutor` / `AgentBackend` 隔离实现细节
3. **配置驱动** — 4 级优先级解析，组织/部门/Layer/Scene 灵活覆盖
4. **测试覆盖** — 每个新模块 TDD 先行，回归零破坏
5. **开放标准** — MCP/JSON-RPC/SSE 优先，避免私有协议
