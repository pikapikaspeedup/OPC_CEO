# Hermes Agent vs Antigravity — 深度架构对比分析

**日期**: 2026-04-13
**Hermes 版本**: v0.8.0 (NousResearch/hermes-agent)
**Antigravity 版本**: v0.3.0 (当前)

---

## 一、项目定位对比

| 维度 | Hermes Agent | Antigravity |
|:-----|:-------------|:------------|
| **定位** | 通用 AI Agent 框架（CLI + 消息平台 + API） | IDE 增强型管理层 + 多 Agent 编排平台 |
| **语言** | Python (386K 行) | TypeScript/Next.js (~37K 行引擎 + 前端) |
| **核心用户** | 开发者/研究者/自部署用户 | 企业级 AI 编程管理层 |
| **模型绑定** | 完全无绑定，任意 provider | 以 Antigravity IDE 为核心，多 provider |
| **开源协议** | Apache 2.0 | 未开源（内部产品） |
| **代码规模** | Python 855 文件 / ~386K 行 | TS ~37K 行引擎 + Next.js 前端 |

---

## 二、架构对比

### 2.1 Agent Loop 对比

```
┌─────────────────────────────────────────────────────────────────┐
│                     Hermes Agent                                │
│                                                                 │
│  AIAgent (单体类 2000+ 行)                                      │
│  ├─ System Prompt Builder (Skills + Memory + SOUL.md)          │
│  ├─ API Call (OpenAI SDK facade → 多 provider)                 │
│  ├─ Tool Loop (max 90 iterations, 并行+串行)                    │
│  ├─ Context Compressor (辅助 LLM 压缩中间轮次)                  │
│  └─ State → SQLite (sessions + messages + FTS5)                │
│                                                                 │
│  [学习闭环]: 技能自动生成 → 持久化 → 下次对话复用               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Antigravity                                  │
│                                                                 │
│  管理层 (Next.js Gateway)                                       │
│  ├─ Department → Group → Run 三级调度                           │
│  ├─ Prompt Builder (角色/模板/记忆)                              │
│  ├─ Provider Router (多后端: IDE/ClaudeEngine/CLI)              │
│  └─ Approval/审批流 → Memory Bridge                             │
│                                                                 │
│  执行层 (ClaudeEngine / Language Server)                        │
│  ├─ API Client (Anthropic/OpenAI/Gemini/Grok)                  │
│  ├─ Tool System (24 tools + security-core 安全校验)             │
│  ├─ Query Loop (多轮+压缩+续写)                                │
│  └─ Transcript Persistence (JSONL)                              │
│                                                                 │
│  [IDE 集成]: Language Server gRPC ↔ Gateway bridge              │
└─────────────────────────────────────────────────────────────────┘
```

**核心差异**：
- Hermes = **单体 Agent 类**，一个 `run_agent.py` 管一切
- Antigravity = **管理层 + 执行层分离**，Gateway 编排，多个执行后端

### 2.2 Tool System 对比

| 维度 | Hermes | Antigravity |
|:-----|:-------|:------------|
| **工具数量** | 55+ | 24 |
| **注册方式** | Python 装饰器 `@registry.register()` | TypeScript Tool 接口 + 注册表 |
| **安全校验** | 基础 approval 提示 | security-core 24K 行（23 种验证器 + AST 分析） |
| **并行执行** | ThreadPoolExecutor (max 8) | 无（串行） |
| **浏览器自动化** | 10 个 browser tools (Playwright) | WebFetchTool + WebSearchTool |
| **代码沙箱** | execute_code (Python sandbox) | BashTool (有安全检查) |
| **MCP** | 双向（作为 server + 调用外部 server） | 客户端（调用外部 server） |
| **Subagent** | delegate_task (独立预算) | AgentTool (适配器模式) |
| **Smart Home** | Home Assistant 集成 | 无 |
| **Toolset 组合** | 按场景分组（safe/debug/web/...） | 无分组概念 |

### 2.3 上下文管理对比

| 维度 | Hermes | Antigravity |
|:-----|:-------|:------------|
| **压缩策略** | 辅助 LLM 压缩中间轮次（可配比例） | Pre-turn 主动压缩（85% 阈值）+ 413 reactive |
| **Skills/记忆注入** | SKILL.md + MEMORY.md + USER.md 注入 system prompt | CLAUDE.md递归 + @include + frontmatter |
| **Session 搜索** | FTS5 全文搜索（跨所有对话） | 无（仅按 ID 查找） |
| **Prompt Cache** | Anthropic prompt caching | Prompt Cache Break Detection（两阶段检测） |
| **上下文窗口感知** | 自动检测模型上下文长度 | Token 估算（4 chars ≈ 1 token） |

### 2.4 Provider 支持对比

| Provider | Hermes | Antigravity |
|:---------|:-------|:------------|
| OpenAI / GPT | ✅ (Chat Completions + Responses) | ✅ (兼容层) |
| Anthropic / Claude | ✅ (原生 + OpenRouter) | ✅ (原生 firstParty) |
| Gemini | ✅ (via OpenRouter) | ✅ (独立兼容层) |
| Grok / xAI | ❌ | ✅ (独立兼容层) |
| Bedrock / Vertex | ✅ (Anthropic adapter) | ✅ (Provider 支持) |
| OpenRouter | ✅ (默认推荐) | ❌ |
| Ollama (本地) | ✅ (OpenAI 兼容) | ✅ (通过 OpenAI 兼容层) |
| Fallback Chain | ✅ (retry → 备用 provider) | ✅ (Provider Fallback Chain) |

---

## 三、Hermes 独特优势（我们应该学习的）

### 3.1 ⭐ 技能自学习闭环（Skill Self-Improvement Loop）

**这是 Hermes 最核心的差异化能力。**

```
对话 1: 用户要求"用 Click 构建 Python CLI"
  → Agent 完成任务
  → 系统提示: "要把这个复杂工作流保存为 Skill 吗?"
  → Agent 调用 skill_manage 创建 SKILL.md

对话 2 (几天后): 用户要求"创建 CLI 工具"
  → System prompt 注入 Skill 摘要
  → Agent 识别: "我之前做过! 用 Click 工作流 skill"
  → 更快、更好的结果
```

**对我们的启示**：
- 当前 Antigravity 的 Memory 系统主要是事实性记忆（知道什么），缺乏过程性记忆（怎么做）
- 可以在 Agent Run 完成后自动提取"工作流模式"，生成可复用的 Skill/Prompt 模板
- 这比简单的 MEMORY.md 更有价值

### 3.2 ⭐ 多平台 Gateway

Hermes 的 Gateway 支持 15+ 消息平台（Telegram/Discord/Slack/WhatsApp/Signal/微信/钉钉/飞书...），**同一套 Agent 代码**。

**对我们的启示**：
- 我们的 Gateway 目前只面向 Web 前端 + Obsidian
- 如果要做"CEO Agent"随时可达，Telegram/微信集成是高价值功能
- Gateway pattern 已经有了，添加 Platform Adapter 技术上可行

### 3.3 ⭐ Session 全文搜索（FTS5）

Hermes 的 `session_search` 工具让 Agent 能**搜索所有历史对话**，找到相关上下文。

```python
# Agent 执行: session_search(query="database migration")
# → 返回所有对话中提到数据库迁移的消息片段
# → Agent 有了历史上下文，避免重复犯错
```

**对我们的启示**：
- 我们的对话历史仅通过 cascadeId 逐个查看
- 缺少跨对话搜索能力
- 实现成本低（SQLite FTS5 或 Transcript JSONL 上索引）

### 3.4 ⭐ 执行环境多态（Terminal Backends）

```yaml
terminal:
  backend: local     # 或 docker / ssh / modal / daytona
```

Agent 的 terminal 命令可以在不同环境执行，**而 Agent 代码完全不变**。

**对我们的启示**：
- 我们的 BashTool 只在本地执行
- 对于安全敏感场景（生产环境调试），Docker 沙箱很有价值
- SSH backend 可实现远程服务器管理

### 3.5 ⭐ 工具并行执行

```python
# 3 个独立工具同时执行
with ThreadPoolExecutor(max_workers=8) as pool:
    futures = [pool.submit(execute_tool, tc) for tc in tool_calls]
```

**对我们的启示**：
- 我们的 Query Loop 串行执行工具
- 并行可 3-5x 加速独立工具（如同时搜索 + 读文件 + web fetch）

### 3.6 ⭐ Iteration Budget（迭代预算）

线程安全的迭代计数器，防止失控循环：
- 主 Agent: 90 次
- Subagent: 50 次（从父级池分配）
- 耗尽后注入"summarize"消息强制收尾

**对我们的启示**：
- 我们的 max_turns 是硬限制，没有优雅降级
- Budget 模型更灵活（refund、子任务分配）

---

## 四、Antigravity 独特优势（它们没有的）

### 4.1 ⭐ IDE 深度集成

Antigravity 通过 Language Server gRPC 直接与 IDE 通信，实现：
- 实时代码感知（LSP）
- 文件系统监控
- 工作区状态同步
- 审批流集成

Hermes 只有 ACP（Agent Client Protocol）+ MCP，无法做到这个深度。

### 4.2 ⭐ 企业级安全（security-core）

24K 行安全引擎：
- 23 种安全验证器
- Bash AST 分析
- Sed/Path/Mode/Sandbox 子验证器
- 自动模式分类器

Hermes 只有基础 approval 提示，无深度命令分析。

### 4.3 ⭐ 多级管理编排

```
Department → Group → Role → Run
   ↓          ↓       ↓      ↓
  部门       分组     角色   执行实例
```

Hermes 的 Subagent 是扁平的（parent → child），无法做复杂的组织级编排。

### 4.4 ⭐ 审批/权限流

- 工具执行审批（人在环路）
- 规则引擎（精确/前缀/通配符匹配）
- auto-mode 智能分类

Hermes 的安全模型是二元的（approve/deny），没有精细的规则匹配。

### 4.5 ⭐ Prompt Cache Break Detection

两阶段检测 + 压缩感知 + 缓存指标聚合。Hermes 只做基本的 cache_control 标记。

---

## 五、我们应该做的（行动项）

### P0 — 高价值、低成本

| 行动 | 来源 | 预估工作量 | 价值 | 状态 |
|:-----|:-----|:---------|:-----|:-----|
| **工具并行执行** | Hermes ThreadPoolExecutor | 2-3 天 | 3-5x 工具执行速度提升 | ✅ 已有（比 Hermes 更精细） |
| **Session 全文搜索** | Hermes FTS5 | 2 天 | Agent 跨对话记忆能力 | ✅ 已实现 SessionSearchTool |
| **Iteration Budget** | Hermes IterationBudget | 1 天 | 防止 Agent 失控 + 优雅降级 | ✅ 已实现 budget_warning 机制 |

### P1 — 高价值、中等成本

| 行动 | 来源 | 预估工作量 | 价值 | 状态 |
|:-----|:-----|:---------|:-----|:-----|
| **Skill 自学习系统** | Hermes Skills | 1 周 | 过程性记忆，越用越好 | ✅ 已实现 SkillStore + SkillManageTool + 自动注入 |
| **Toolset 分组** | Hermes Toolsets | 2 天 | 按场景组合工具，减少 token | ✅ 已实现 8 基础 + 4 组合 toolset |
| **上下文压缩优化** | Hermes 辅助 LLM 压缩 | 3 天 | 更智能的长对话处理 | ✅ 已有 + 可配阈值增强 |

### P2 — 值得关注、长期规划

| 行动 | 来源 | 预估工作量 | 价值 |
|:-----|:-----|:---------|:-----|
| **消息平台 Gateway** | Hermes Platform Adapters | 2 周 | CEO Agent 随时可达 |
| **Docker 沙箱执行** | Hermes Terminal Backends | 1 周 | 安全隔离执行 |
| **MCP 双向支持** | Hermes MCP serve | 3 天 | 被外部 Agent 调用 |
| **轨迹数据导出** | Hermes Trajectory | 2 天 | RL 训练数据 |

---

## 六、架构设计哲学对比

| 维度 | Hermes | Antigravity | 评价 |
|:-----|:-------|:------------|:-----|
| **简洁 vs 完备** | 单体类 + 函数式 | 分层架构 + 类型安全 | 各有利弊 |
| **Python vs TypeScript** | 灵活/快速开发/ML 生态 | 类型安全/构建时检查/前端一体 | 取决于场景 |
| **SQLite vs gRPC** | 简单持久化 | 实时双向通信 | Hermes 更轻量 |
| **开放性** | 完全开源、任意 provider、任意平台 | 深度 IDE 集成、企业级安全 | Hermes 更开放 |
| **学习能力** | Skills 自动生成 + Memory + Session Search | CLAUDE.md + 记忆桥接 | Hermes 更强 |
| **安全性** | 基础 | 企业级（24K 行安全引擎） | Antigravity 远超 |
| **部署灵活性** | 6 种执行环境 + 15+ 消息平台 | IDE + Web + Obsidian | Hermes 更广 |
| **编排能力** | 扁平 subagent | Department/Group/Role 多级 | Antigravity 更强 |

---

## 七、总结

**Hermes Agent 是一个优秀的开源通用 AI Agent 框架**，核心优势在于：
1. 技能自学习闭环（越用越好）
2. 多平台 Gateway（15+ 消息平台）
3. 执行环境多态（本地/Docker/SSH/Modal）
4. 工具并行执行

**Antigravity 的核心优势在于**：
1. IDE 深度集成（gRPC + Language Server）
2. 企业级安全（24K 行安全引擎）
3. 多级管理编排（Department/Group/Role）
4. 审批/权限流

**两者是互补而非竞争关系**。Hermes 更像"万能瑞士军刀"，Antigravity 更像"企业级编程管理平台"。

**最高价值的借鉴**：工具并行执行、Session 全文搜索、Skill 自学习系统 — 这三个功能与 Antigravity 现有架构完全兼容，可以直接融入。
