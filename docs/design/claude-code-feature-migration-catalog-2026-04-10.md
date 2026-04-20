# Claude Code 特性移植总目录

日期：2026-04-10  
状态：正式特性清单 / 可直接拆开发任务  
来源：对 `/Users/darrel/Documents/claude-code` 仓库的全面盘点

## 一句话结论

Claude Code 逆向仓库共包含 **22 个可移植特性域**，约 **64000 行**生产级代码。

按移植优先级分为三档：

1. **P0（7 个）**：没有就不是完整执行器
2. **P1（6 个）**：有了才算强执行器
3. **P2（9 个）**：锦上添花，按需移植

---

## P0：核心基座（没有就不是完整执行器）

### 1. Provider 多模型兼容层

**功能描述**

统一的 API 适配器模式，支持 7 个 provider，下游代码完全无感知。

**支持的 Provider**

1. Anthropic（第一方直连）
2. OpenAI（兼容 Ollama/DeepSeek/vLLM/LM Studio）
3. Gemini（Google）
4. Grok（xAI）
5. Bedrock（AWS）
6. Vertex（Google Cloud）
7. Foundry

**核心入口文件**

1. `claude-code/src/services/api/claude.ts` — 核心 API client
2. `claude-code/src/services/api/openai/index.ts` — OpenAI 兼容层
3. `claude-code/src/services/api/gemini/index.ts` — Gemini 兼容层
4. `claude-code/src/services/api/grok/index.ts` — Grok 兼容层
5. `claude-code/src/utils/model/providers.ts` — Provider 选择器

**关键特性**

1. 流式消息适配（各家 API 流式格式 → Anthropic 内部格式）
2. 工具定义转换（Anthropic tool schema → OpenAI function schema）
3. DeepSeek thinking mode 自动检测
4. 模型能力推断（thinking、structured outputs、effort 等）
5. 环境变量驱动的 provider 选择

**移植复杂度**：中  
**代码量**：~6000 行

---

### 2. 工具系统 & 注册框架

**功能描述**

灵活的工具框架，包含 55+ 个内置工具、权限过滤、工具搜索、工具混合（内置 + MCP）。

**核心入口文件**

1. `claude-code/src/Tool.ts` — 工具接口定义
2. `claude-code/src/tools.ts` — 工具池配置与过滤
3. `claude-code/src/tools/` — 55+ 个工具子目录

**工具分类**

| 分类 | 工具 | 说明 |
|:-----|:-----|:-----|
| 文件操作 | FileEditTool, FileReadTool, FileWriteTool, GlobTool, GrepTool, NotebookEditTool | 代码级读写编辑 |
| Shell 执行 | BashTool, PowerShellTool, REPLTool | 命令执行与沙箱 |
| Web 能力 | WebFetchTool, WebSearchTool, WebBrowserTool | 网页抓取与搜索 |
| Agent/Task | AgentTool, TaskCreateTool, TaskUpdateTool, TaskListTool, TaskGetTool, TaskStopTool | 二阶 agent 编排 |
| 规划 | EnterPlanModeTool, ExitPlanModeV2Tool, VerifyPlanExecutionTool | 结构化规划 |
| 项目 | EnterWorktreeTool, ExitWorktreeTool | Git worktree 隔离 |
| 系统 | SkillTool, MCPTool, ConfigTool, BriefTool, TodoWriteTool | 扩展能力 |

**关键特性**

1. 统一的 Tool 接口（name、description、inputSchema、execute）
2. Feature flag 控制工具可用性
3. 工具搜索（deferred tools）：按需延迟加载
4. MCP 工具与内置工具统一池
5. 工具权限过滤

**移植复杂度**：中  
**代码量**：~15000 行

---

### 3. 查询引擎 & 会话循环

**功能描述**

完整的 LLM 对话循环：多轮对话、工具调用执行、错误恢复、token 预算管理、会话持久化。

**核心入口文件**

1. `claude-code/src/query.ts` — 核心查询循环
2. `claude-code/src/QueryEngine.ts` — 高级编排
3. `claude-code/src/query/tokenBudget.ts` — Token 预算
4. `claude-code/src/query/stopHooks.ts` — 停止条件

**关键特性**

1. 多轮 query loop：发送 → 收响应 → 处理 tool_use → 再发送
2. 思考模式（thinking blocks）自动参数化
3. 自动恢复 & 重试（3 次上限）
4. Token 预算跟踪与 auto-compact 触发
5. Compaction 边界处理
6. 停止条件钩子（stopHooks）
7. 会话快照与恢复

**移植复杂度**：高  
**代码量**：~10000 行

---

### 4. 权限系统 & 工具权限控制

**功能描述**

多层次权限系统：Mode（default/ask/deny/bypass）、Allow/Deny/Ask 规则、文件系统沙箱、路径模式匹配、设备信任。

**核心入口文件**

1. `claude-code/src/utils/permissions/` — 权限框架
2. `claude-code/src/types/permissions.ts` — 权限类型
3. `claude-code/src/state/onChangeAppState.ts` — 权限模式管理

**关键特性**

1. 四级模式：default → ask → deny → bypass
2. 规则来源：本地配置、项目配置、额外工作目录
3. 文件系统规则：路径模式匹配、权限边界
4. `.claude` 文件夹保护
5. 设备信任：TCP 信任决策
6. 自动模式分类器（Auto Mode）

**移植复杂度**：中  
**代码量**：~5000 行

---

### 5. 上下文构建 & System Prompt

**功能描述**

多源内容构建框架：git 状态、CLAUDE.md 文件、memory 文件、项目上下文、时间日期。

**核心入口文件**

1. `claude-code/src/context.ts` — 上下文聚合
2. `claude-code/src/utils/claudemd.ts` — CLAUDE.md 发现
3. `claude-code/src/memdir/` — 内存文件管理（9 个核心文件）
4. `claude-code/src/bootstrap/state.ts` — 会话全局状态

**关键特性**

1. CLAUDE.md 分层发现（project → home → system）
2. 内存文件与权限系统联动
3. Git 状态缓存与快速检查
4. System prompt 注入点（cache breaking detection）
5. 多来源 context 聚合管道

**移植复杂度**：中  
**代码量**：~4000 行

---

### 6. 文件编辑 & Diff 管理

**功能描述**

精细化的文件编辑：编辑器 diff、冲突检测、变更历史、属性跟踪、版本比对。

**核心入口文件**

1. `claude-code/src/tools/FileEditTool/` — 编辑工具
2. `claude-code/src/utils/fileHistory.ts` — 文件历史快照
3. `claude-code/src/utils/toolResultStorage.ts` — 工具结果存储

**关键特性**

1. 自动冲突检测（创建后文件被外部修改）
2. 编辑前后差异追踪
3. 工具结果上限管理（防存储溢出）
4. Notebook 编辑支持
5. 文件属性跟踪（attribution）

**移植复杂度**：中  
**代码量**：~3000 行

---

### 7. Token 预算 & 成本控制

**功能描述**

Token 成本管理：预算设置、自动 compaction 触发、成本统计、多 provider 费率计算。

**核心入口文件**

1. `claude-code/src/query/tokenBudget.ts` — Token 预算追踪
2. `claude-code/src/services/compact/` — Compaction 策略
3. `claude-code/src/cost-tracker.ts` — API 成本跟踪

**关键特性**

1. 每次 query 后自动检查 token 消耗
2. 超过阈值自动触发 compaction
3. 多 provider 费率映射
4. 会话级成本统计
5. Compaction 策略：保留关键上下文、压缩历史

**移植复杂度**：中  
**代码量**：~3000 行

---

## P1：高级编排（有了才算强执行器）

### 8. MCP 集成 & MCP 工具

**功能描述**

完整的 MCP 客户端：从配置解析、连接管理、工具&命令&资源暴露、错误恢复到权限集成。

**核心入口文件**

1. `claude-code/src/services/mcp/` — MCP 核心（55+ 文件）
2. `claude-code/src/tools/MCPTool/` — MCP 工具执行
3. `claude-code/src/services/mcp/useManageMCPConnections.ts` — 连接管理

**关键特性**

1. 支持 4 种 transport：stdio、SSE、HTTP、WebSocket
2. 权限系统联动
3. OAuth 授权流程
4. MCP 工具与内置工具统一池
5. 跨进程通信与错误恢复

**移植复杂度**：高  
**代码量**：~8000 行

---

### 9. Agent 子系统 & Task API

**功能描述**

二阶 agent 框架：Agent 描述加载、Task 创建/更新/查询/停止、Coordinator 编排多个 worker。

**核心入口文件**

1. `claude-code/src/tools/AgentTool/` — Agent 定义 & 执行
2. `claude-code/src/coordinator/` — Coordinator 模式
3. `claude-code/src/tools/TaskCreateTool/` 等 — Task 管理（5 个工具）

**关键特性**

1. Built-in Agent：Verification Agent、Sketch Plan Agent
2. Task API：create → update → list → get → stop
3. Worker 隔离：每个 worker 独立会话 & 权限上下文
4. Coordinator：调度 worker、汇总结果

**移植复杂度**：高  
**代码量**：~5000 行

---

### 10. Plan Mode（规划能力）

**功能描述**

专用规划模式：进入计划状态 → 生成结构化计划 → 验证执行。

**核心入口文件**

1. `claude-code/src/tools/EnterPlanModeTool/`
2. `claude-code/src/tools/ExitPlanModeTool/`
3. `claude-code/src/tools/VerifyPlanExecutionTool/`

**关键特性**

1. 模式切换：normal → plan → execution
2. 结构化输出计划
3. 执行后验证

**移植复杂度**：中  
**代码量**：~2000 行

---

### 11. 会话持久化 & 恢复

**功能描述**

会话快照、历史恢复、断重连。

**核心入口文件**

1. `claude-code/src/history.ts` — 会话历史
2. `claude-code/src/utils/sessionStorage.ts` — 会话 I/O
3. `claude-code/src/server/sessionManager.ts` — 服务端会话管理

**关键特性**

1. 会话序列化与反序列化
2. 历史列表与恢复
3. 续写（reply/continue）
4. 会话分支

**移植复杂度**：中  
**代码量**：~3000 行

---

### 12. Memory / 长期记忆

**功能描述**

结构化记忆存储、相关性检索、记忆压实。

**核心入口文件**

1. `claude-code/src/memdir/` — 9 个核心文件
2. `claude-code/src/services/SessionMemory/` — 会话内存

**关键特性**

1. 记忆文件读写
2. 相关性过滤
3. 记忆压实与去重
4. 与 context 构建管道集成

**移植复杂度**：中-高  
**代码量**：~3000 行

---

### 13. Bridge / Remote Control

**功能描述**

远程执行引擎：会话隔离、消息传输、权限回调、JWT 认证、Web UI 控制面板。

**核心入口文件**

1. `claude-code/src/bridge/` — 37 个文件
2. `claude-code/src/bridge/bridgeMain.ts` — Bridge 循环入口
3. `claude-code/packages/remote-control-server/` — 自托管 RCS + Web UI

**关键特性**

1. 多会话并发（--spawn / --capacity）
2. 容错恢复（自动重连）
3. JWT 认证
4. Web UI 控制面板
5. Device trust & 过期令牌处理

**移植复杂度**：高  
**代码量**：~8000 行

---

## P2：增强体验（按需移植）

### 14. Skill 系统

**功能描述**

动态技能注册：内置 skill + MCP skill 混合、Skill 发现与搜索。

**核心入口文件**

1. `claude-code/src/skills/` — 4 个核心文件
2. `claude-code/src/tools/SkillTool/` — Skill 执行工具

**移植复杂度**：中  
**代码量**：~1500 行

---

### 15. Daemon / 后台会话

**功能描述**

长驻进程监督：worker 启动/重启、指数退避、快速失败检测、优雅关闭。

**核心入口文件**

1. `claude-code/src/daemon/main.ts`
2. `claude-code/src/daemon/workerRegistry.ts`

**移植复杂度**：中  
**代码量**：~2000 行

---

### 16. Computer Use

**功能描述**

屏幕感知 & 操作：截图、鼠标移动/点击、键盘输入、应用焦点管理。

**核心入口文件**

1. `claude-code/packages/@ant/computer-use-mcp/`
2. `claude-code/packages/@ant/computer-use-input/`
3. `claude-code/packages/@ant/computer-use-swift/`

**平台支持**：macOS（完整）、Windows（部分）、Linux（部分）

**移植复杂度**：高  
**代码量**：~5000 行

---

### 17. Voice Mode

**功能描述**

Push-to-Talk 语音输入、STT（speech-to-text）、语音关键词检测。

**核心入口文件**

1. `claude-code/src/voice/voiceModeEnabled.ts`
2. `claude-code/src/services/voice.ts`
3. `claude-code/packages/@ant/audio-capture-napi/`

**移植复杂度**：高  
**代码量**：~3000 行

---

### 18. SSH 远程执行

**功能描述**

SSH 连接、远程文件 & 命令执行。

**核心入口文件**

1. `claude-code/src/commands/ssh/`

**移植复杂度**：中  
**代码量**：~1500 行

---

### 19. Server / IDE 直连

**功能描述**

本地 TCP 服务器，支持多客户端直连。

**核心入口文件**

1. `claude-code/src/server/`

**移植复杂度**：中  
**代码量**：~2000 行

---

### 20. Auto Mode

**功能描述**

自动权限决策分类器，降低人工确认频率。

**核心入口文件**

1. `claude-code/src/utils/permissions/autoModeState.ts`
2. `claude-code/src/commands/auto-mode/`

**移植复杂度**：中  
**代码量**：~1000 行

---

### 21. Worktree / 项目隔离

**功能描述**

Git worktree 集成，多项目并行隔离。

**核心入口文件**

1. `claude-code/src/tools/EnterWorktreeTool/`
2. `claude-code/src/tools/ExitWorktreeTool/`

**移植复杂度**：中  
**代码量**：~1500 行

---

### 22. Thinking / Effort 模式

**功能描述**

链式思维参数化、快速/深思切换。

**核心入口文件**

1. `claude-code/src/utils/thinking.ts`
2. `claude-code/src/utils/effort.ts`

**移植复杂度**：低  
**代码量**：~500 行

---

## 总量统计

| 分档 | 特性数 | 代码量 | 说明 |
|:-----|:------:|:------:|:-----|
| P0 | 7 | ~46000 行 | 核心基座，必须移植 |
| P1 | 6 | ~29000 行 | 高级编排，强烈推荐 |
| P2 | 9 | ~18000 行 | 增强体验，按需选取 |
| **合计** | **22** | **~93000 行** | |

注：部分代码跨域共享，实际独立增量约 64000 行。

---

## 和 Antigravity 现有系统的对接关系

| Claude Code 特性 | Antigravity 对应层 | 对接方式 |
|:-----------------|:------------------|:---------|
| Provider 兼容层 | execution plane / AgentBackend | 包成 provider leaf |
| 工具系统 | execution plane | 嵌入执行器内部 |
| 查询引擎 | execution plane | 作为 execution kernel |
| 权限系统 | control + execution plane | 上层 policy 由平台定，下层执行由 executor 管 |
| 上下文构建 | execution plane | CLAUDE.md → Antigravity rules/memory |
| MCP 集成 | execution plane | MCP client 嵌入执行器 |
| Agent/Task API | control plane | 映射到 Project/Run/Stage |
| Bridge/Remote | 平台级 | 可替代或补充现有 bridge |
| 会话持久化 | execution plane | 与 Run registry 对接 |

---

## 移植边界提醒

1. **所有特性必须适配 Antigravity 的 execution contract，不能反过来**
2. **Claude Code 的 session 只能映射到 execution thread，不能升级成 Run/Stage 真相源**
3. **权限上层 policy 由 Antigravity 平台决定，Claude Code 只负责下层执行权限**
4. **Provider 路由由 Antigravity 的 provider policy 控制，不是 Claude Code 自己决定用哪个 provider**
