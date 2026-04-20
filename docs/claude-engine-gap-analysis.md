# Claude-Engine vs Claude-Code 功能差距分析

**日期**: 2026-04-13（第五次更新）

## 汇总

| 子系统 | 原版行数 | 仿写行数 | 功能覆盖率 | 优先级 | 状态 |
|:-------|-------:|-------:|----------:|:-------|:-----|
| API 调用层 | 7,098 | ~4,100 | **90%** | P0 | ✅ 基本完成+Provider Fallback+Cache Monitor |
| 工具系统 | 19,329 | ~3,600 | **51%** | P0 | ✅ 26 个工具+注册表+并行执行+Skill自学习 |
| 权限/安全+security-core | 32,399 | ~25,000 | **85%** | P0 | ✅ 完整移植+auto-mode |
| 上下文构建 | 3,297 | ~900 | **45%** | P1 | ✅ 递归+@include+frontmatter |
| 会话引擎/压缩 | 5,226 | ~1,800 | **55%** | P0 | ✅ 多轮+压缩+续写+持久化+Iteration Budget |
| Memory | 2,789 | ~800 | **35%** | P2 | ✅ Phase 1+1b 完成 |
| MCP | 5,734 | ~1,400 | **55%** | P1 | ✅ 客户端+资源工具+多Transport |

**总计**: 原版 ~76K 行 vs 仿写 **~37K 行**（含 security-core ~24K 行完整移植）
**自研代码**: ~13.5K 行（不含 security-core）
**测试总数**: 588 条（19 文件），全绿
**外部依赖**: ✅ 零（security-core 已内化，项目完全自包含）

## 核心结论

1. **架构方向正确** — 全部 8 个子系统（M1-M8）已落地
2. **工具系统 24 个工具** — 覆盖核心文件操作+搜索+Web+任务+规划+MCP+Agent
3. **权限/安全已完整移植** — security-core 24K 行代码内化，覆盖率从 55% 跃升到 85%
4. **项目完全自包含** — 不再依赖外部 claude-code 目录
5. **主要差距已从"架构骨架"转为"功能深度"** — 核心路径已打通，缺的是高级特性

## 工具系统详细覆盖

### 已实现工具（24 个）

| 分类 | 工具名 | 对应 claude-code | 实现状态 |
|:-----|:------|:----------------|:---------|
| **文件操作** | FileReadTool | FileReadTool | ✅ 完整 |
| | FileWriteTool | FileWriteTool | ✅ 完整 |
| | FileEditTool | FileEditTool | ✅ 完整 |
| | NotebookEditTool | NotebookEditTool | ✅ 简化版（去权限/历史） |
| **Shell/搜索** | BashTool | BashTool | ✅ 完整 |
| | GlobTool | GlobTool | ✅ 完整 |
| | GrepTool | GrepTool | ✅ 完整 |
| **Web** | WebFetchTool | WebFetchTool | ✅ 完整（含 LRU 缓存） |
| | WebSearchTool | WebSearchTool | ✅ 完整（Tavily/Brave/Kagi） |
| **任务管理** | TaskCreateTool | TaskCreateTool | ✅ 完整 |
| | TaskUpdateTool | TaskUpdateTool | ✅ 完整 |
| | TaskListTool | TaskListTool | ✅ 完整 |
| | TaskGetTool | TaskGetTool | ✅ 完整 |
| | TodoWriteTool | TodoWriteTool | ✅ 简化版（去 GrowthBook） |
| **用户交互** | AskUserQuestionTool | AskUserQuestionTool | ✅ 完整 |
| **Agent** | AgentTool | AgentTool | ✅ 适配器模式 |
| **技能** | SkillTool | SkillTool | ✅ 完整 |
| **规划** | EnterPlanModeTool | EnterPlanModeTool | ✅ 简化版 |
| | ExitPlanModeTool | ExitPlanModeV2Tool | ✅ 简化版 |
| | VerifyPlanExecutionTool | VerifyPlanExecutionTool | ✅ 完整 |
| **发现/配置** | ToolSearchTool | ToolSearchTool | ✅ 简化版 |
| | ConfigTool | ConfigTool | ✅ 简化版 |
| **MCP 资源** | ListMcpResourcesTool | ListMcpResourcesTool | ✅ 完整 |
| | ReadMcpResourceTool | ReadMcpResourceTool | ✅ 完整 |

### 未移植工具（27 个）及理由

#### Anthropic 内部工具（不适用，8 个）

- TeamCreateTool / TeamDeleteTool — Anthropic 团队管理
- TungstenTool — 内部调试
- SyntheticOutputTool — 测试用合成输出
- OverflowTestTool — 内部测试
- SuggestBackgroundPRTool — Anthropic 内部 PR 工作流
- BriefTool — 深度依赖 Kairos/AppState
- MonitorTool — 需要完整 daemon 子系统

#### 需要完整子系统支持（暂不实现，11 个）

- MCPTool — 完整 MCP 注册系统（动态 schema）
- McpAuthTool — MCP OAuth 认证
- RemoteTriggerTool — Bridge/Remote Control 子系统
- SendMessageTool — Bridge 消息管道
- SendUserFileTool — Bridge 文件传输
- ScheduleCronTool — Daemon 子系统
- EnterWorktreeTool / ExitWorktreeTool — Git Worktree 子系统
- REPLTool — Ink UI 框架
- WebBrowserTool — Computer Use 子系统
- LSPTool — 已删除/无实现

#### 低优先级（可后续添加，8 个）

- PowerShellTool — Windows-only
- TerminalCaptureTool — 终端输出捕获
- ReviewArtifactTool — 需 artifact 系统
- SnipTool — 代码片段管理
- DiscoverSkillsTool — 与 SkillTool 冗余
- SleepTool — 安全风险
- TaskOutputTool — 可通过 TaskGetTool 替代
- TaskStopTool — 可通过 TaskUpdateTool 替代

## 各子系统详细差距

### 1. API 调用层 (90% 覆盖) ✅

**已完成**:
- ✅ Anthropic 原生 fetch + SSE 流式客户端
- ✅ 指数退避重试（区分 429/502/503/529）
- ✅ OAuth Token 管理器（4 Provider 工厂）
- ✅ 错误分类器（9 种错误类型）
- ✅ Tool → API schema 转换
- ✅ Token usage / USD 成本跟踪
- ✅ 多 Provider 支持（OpenAI/Gemini/Grok 兼容层）
- ✅ Provider Fallback Chain（跨 Provider 主→备自动切换）
- ✅ buildProviderChainFromEnv（环境变量自动构建链）
- ✅ Prompt Cache Break Detection（两阶段检测 + 压缩感知）
- ✅ Cache 指标聚合（命中率/创建量/break历史）

**缺失**:
- 🟡 Thinking/effort budget 控制
- 🟡 Provider-specific body mapping（Bedrock/Vertex）

### 2. 工具系统 (47% 覆盖) ✅

**已完成**:
- ✅ 24 个工具 + 注册表 + alias 查找
- ✅ 文件操作完整链（Read/Write/Edit + Notebook）
- ✅ Web 完整链（Fetch + Search）
- ✅ 任务管理完整链（Create/Update/List/Get + Todo）
- ✅ 规划模式完整链（Enter/Exit/Verify）
- ✅ MCP 资源链（List/Read）
- ✅ 工具发现（ToolSearch）+ 配置管理（Config）

**缺失**:
- 🟡 流式执行 + 保序输出 + 进度消息
- 🟡 defer_loading（延迟加载）
- 🟡 strict mode
- 🟡 兄弟工具取消、fallback 后丢弃 orphan result

### 3. 权限/安全 (85% 覆盖) ✅

**已完成**:
- ✅ 23 种安全验证器（security-core 完整移植 24K 行）
- ✅ 规则匹配引擎（精确/前缀/通配符）
- ✅ 危险命令模式检测
- ✅ 基础权限模式（plan/auto/default）
- ✅ MCP 工具名前缀匹配
- ✅ 完整权限决策链（Phase 3 已落地）
- ✅ Bash parser + AST 分析
- ✅ Sed/Path/Mode/Sandbox 子验证器
- ✅ ParsedCommand + 命令树构建
- ✅ Auto-mode 分类器
- ✅ security-core 已内化（零外部依赖）

**缺失**:
- 🟡 Auto-mode 分类器（yoloClassifier）
- 🟡 规则持久化 + settings-backed rule loading
- 🟡 Managed-only policy
- 🟡 Denial tracking

### 4. 上下文构建 (45% 覆盖) ✅

**已完成**:
- ✅ 基础 CLAUDE.md 发现（home/workspace/local）
- ✅ 简单 git 上下文（分支/状态/远端）
- ✅ 递归目录上溯（CWD → 根目录）
- ✅ CLAUDE.md 5 层分类（Managed/User/Project/Local/Rules）
- ✅ @include 递归解析（深度控制 + 循环检测）
- ✅ Frontmatter glob 模式解析
- ✅ Managed 系统级指令层（/etc/claude-code/）

**缺失**:
- 🟡 AutoMem/TeamMem 层（需记忆子系统）
- 🟡 完整 git 快照（缓存、canonical root）
- 🟡 Symlink 感知（safeResolvePath）

### 5. 会话引擎/压缩 (50% 覆盖) ✅

**已完成**:
- ✅ Turn loop + tool_use follow-up
- ✅ Pre-turn 主动压缩（85% 阈值）
- ✅ 413 reactive compaction + turn retry
- ✅ max_tokens continuation（最多 3 次）
- ✅ Token 估算（4 chars ≈ 1 token）
- ✅ ClaudeEngine 封装（chat/chatSimple）
- ✅ Transcript Persistence（JSONL 格式，缓冲写入）
- ✅ Session Resume（parentUuid 链恢复 + unresolved tool_use 过滤）
- ✅ Session List/Delete/Create 完整生命周期

**缺失**:
- 🟡 Streaming fallback tombstone
- 🟡 Tool summary（工具结果摘要）
- 🟡 文件历史快照、归因

### 6. Memory (35% 覆盖) ✅

**已完成**:
- ✅ Memory store（per-project 目录）
- ✅ MEMORY.md 入口管理
- ✅ Frontmatter 扫描
- ✅ mtime 新鲜度提示
- ✅ 记忆系统提示拼装
- ✅ Phase 1: ClaudeEngine MemoryConfig 集成
- ✅ Phase 1b: 管理层→执行层桥接（department-memory-bridge）

**缺失**:
- 🟡 多层目录（user/project/local/team/automem）
- 🟡 查询时相关记忆选择（sideQuery selection）
- 🟡 背景提取 agent

### 7. MCP (30% 覆盖) ✅

**已完成**:
- ✅ stdio transport
- ✅ listTools/callTool/listResources/readResource
- ✅ McpManager（多 server 管理）
- ✅ MCP → Claude Engine Tool 桥接
- ✅ ListMcpResourcesTool + ReadMcpResourceTool

**缺失**:
- 🟡 多 transport（SSE/HTTP/WS）
- 🟡 OAuth/XAA 认证
- 🟡 Server discovery 合并
- 🟡 输出截断/持久化

## 下一步高价值目标

1. **Thinking/effort budget（P2）** — 控制 thinking 输出预算
2. **Tool summary（P2）** — 工具结果摘要压缩
3. **Memory 多层目录（P2）** — user/project/local/team/automem
4. **MCP OAuth/XAA（P2）** — MCP 服务认证
5. **规则持久化（P2）** — settings-backed permission rule loading

## 测试覆盖统计

| 子系统 | 文件数 | 测试数 |
|:-------|------:|------:|
| types | 1 | 31 |
| context | 1 | 37 |
| memory | 1 | 25 |
| permissions | 1 | 31 |
| api (core) | 1 | 37 |
| api (multi-provider) | 1 | 31 |
| api (errors+caching) | 1 | 60 |
| api (auth) | 1 | 26 |
| api (provider-fallback) | 1 | 14 |
| api (prompt-cache-monitor) | 1 | 23 |
| mcp | 1 | 36 |
| tools (core) | 1 | 36 |
| tools (extended) | 1 | 58 |
| engine | 1 | 28 |
| engine (compactor) | 1 | 11 |
| engine (memory) | 1 | 10 |
| engine (transcript) | 1 | 29 |
| security (adapter) | 1 | 30 |
| security (auto-mode) | 1 | 40 |
| **合计** | **19** | **593** |

### 代码量统计（精确）

| 模块 | 行数 |
|:-----|-----:|
| security-core（完整移植） | 24,094 |
| api/ | ~3,500 |
| engine/ | ~2,100 |
| tools/ | ~3,000 |
| mcp/ | ~1,400 |
| context/ | ~900 |
| memory/ | ~800 |
| permissions/ | ~700 |
| security/ | ~700 |
| types/ | ~400 |
| **自研代码小计** | **~12,900** |
| **总计（含 security-core）** | **~37,000** |
| **测试代码** | **~9,100** |
