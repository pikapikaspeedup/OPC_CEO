# Gateway 数据架构迁移方案

> 将全局注册表和角色配置从 workspace 内 (`data/`, `.agents/`) 剥离到用户 home 目录，  
> 实现真正的跨 workspace、跨 IDE、跨 CLI 的统一数据层。

## Phase 1 实施状态 — ✅ 已完成（2026-03-25）

| 项目 | 状态 | 说明 |
|------|------|------|
| `gateway-home.ts` 统一路径 | ✅ | `GATEWAY_HOME` = `~/.gemini/antigravity/gateway/`，支持 `AG_GATEWAY_HOME` 环境变量 |
| `run-registry.ts` 路径迁移 | ✅ | `DATA_DIR` → `RUNS_FILE`，含 legacy fallback |
| `project-registry.ts` 路径迁移 | ✅ | `DATA_DIR` → `PROJECTS_FILE`，含 legacy fallback |
| `asset-loader.ts` 全局资产 | ✅ | 优先用 `GLOBAL_ASSETS_DIR`，fallback 到 workspace `.agents/assets/` |
| `statedb.ts` 缓存路径 | ✅ | `LOCAL_CACHE_DIR` → `CONVS_FILE` |
| `workspaces/close` 路径 | ✅ | `DATA_DIR` → `HIDDEN_WS_FILE` |
| `bridge-interface.ts` 接口骨架 | ✅ | IDE Bridge 接口定义（未实现新 adapter） |
| 数据迁移脚本 | ✅ | `scripts/ag-migrate.sh` |
| 数据迁移执行 | ✅ | 注册表 + 模板 + workflow 已迁移到 `~/.gemini/antigravity/gateway/` |

---

## 1. 当前痛点

### 痛点 1：全局数据绑死在单一 workspace

```
Antigravity-Mobility-CLI/          ← Gateway 必须在这里启动
  data/
    projects.json                  ← 所有 Project 注册表
    agent_runs.json                ← 所有 Run 状态
    local_conversations.json       ← 会话缓存
    hidden_workspaces.json         ← UI 状态
```

- `run-registry.ts` 硬编码 `DATA_DIR = path.join(process.cwd(), 'data')`
- `project-registry.ts` 同上
- 如果 Gateway 不是在 `Antigravity-Mobility-CLI/` 目录下启动，注册表丢失
- 外部 CLI（ag.ts、Gemini CLI、GitHub CLI）必须知道 Gateway 的 `cwd` 才能找到数据

**结果：** Project 列表和 Run 历史只属于一个目录，切换 workspace 后数据全部消失。

### 痛点 2：角色配置（模板、workflow）困在 workspace 内

```
Antigravity-Mobility-CLI/
  .agents/
    assets/
      templates/                   ← 模板定义 JSON
      review-policies/             ← 审查策略
    workflows/                     ← 角色指令 Markdown
```

- `AssetLoader` 硬编码 `ASSETS_DIR = path.join(process.cwd(), '.agents', 'assets')`
- 第三方项目 workspace 没有 `.agents/` 目录 → multi-agent 系统**完全无法工作**
- 复制 `.agents/` 到每个项目 → 配置碎片化、维护噩梦

**结果：** 只有 `Antigravity-Mobility-CLI` 这个项目能跑 multi-agent Pipeline。

### 痛点 3：产物 artifact 路径混乱

```
Antigravity-Mobility-CLI/
  data/
    projects/{projectId}/runs/{runId}/    ← 产品文档、架构方案、结果
    runs/{runId}/                          ← 无 Project 的独立 Run 产物
```

- 当 `workspace = file:///Users/.../other-project` 时：
  - `artifactDir = data/projects/{id}/runs/{runId}/` → 产物写到了**被监控 workspace** 内
  - 注册表 `agent_runs.json` 却在 Gateway 的 `cwd` (Antigravity-Mobility-CLI) 内
  - 注册表中的 `artifactDir` 是相对路径，**到底相对于谁？**
- 实际代码 `path.join(workspacePath, artifactDir)` → 相对于 workspace，**没问题**
- 但读取时如果 Gateway 重启、`cwd` 不同，`recoverInterruptedRun` 用 `resolveBase()` 可能解析到错误路径

**结果：** Artifact 路径在跨 workspace 场景下存在隐患。

### 痛点 4：无法接入其他 IDE 和 CLI

```
                    ┌─ Antigravity IDE  ← 唯一支持的入口
                    │
Gateway ──▶ data/   └─ Cortex IDE?      ← 不知道 data 在哪
                    └─ Gemini CLI?       ← 不知道 data 在哪
                    └─ GitHub CLI?       ← 不知道 data 在哪
```

所有外部调用者都必须 hardcode `Antigravity-Mobility-CLI/data/` 路径，不可扩展。

---

## 2. 目标

1. **跨 workspace**：任何项目目录都能使用 multi-agent 系统，无需复制 `.agents/`
2. **跨 IDE**：Antigravity、Cortex、任何 VSCode fork 都能共享 Project/Run 数据
3. **跨 CLI**：ag.ts、Gemini CLI、GitHub CLI、微信 cc-connect 都能用统一路径访问注册表
4. **产物隔离**：每个 workspace 的 artifact 仍然在自己的目录内（LS 访问需求）
5. **向后兼容**：现有 `data/` 目录的数据可无损迁移
6. **单一真相源**：配置和注册表各只有一份，不存在同步问题

---

## 3. 推荐方案：`~/.gemini/antigravity/gateway/`

> **路径选择说明：** Antigravity IDE 创建并管理 `~/.gemini/antigravity/` 目录（存放 conversations、brain、annotations 等）。
> 注意 `~/.antigravity/` 也存在但只存放 `argv.json` 和 `extensions/`，不是运行时数据目录。
> 我们选择 `~/.gemini/antigravity/gateway/` 与现有数据目录保持一致。

### 3.1 新数据布局

```
~/.gemini/antigravity/                       ← 已存在，Antigravity IDE 创建
  gateway/                                   ← 新增：Gateway 服务数据根
    ├── config.json                          ← Gateway 配置（端口、日志级别、默认模型等）
    ├── projects.json                        ← 全局 Project 注册表
    ├── agent_runs.json                      ← 全局 Run 注册表
    ├── local_conversations.json             ← 会话缓存
    ├── hidden_workspaces.json               ← UI 状态
    └── assets/                              ← 全局角色配置（从 .agents/ 迁移）
        ├── templates/
        │   ├── development-template-1.json
        │   ├── ux-driven-dev-template.json
        │   ├── design-review-template.json
        │   └── coding-basic-template.json
        ├── review-policies/
        │   ├── default-product.json
        │   └── default-architecture.json
        └── workflows/
            ├── pm-author.md
            ├── product-lead-reviewer.md
            ├── architect.md
            ├── architecture-reviewer.md
            ├── dev-pilot.md
            ├── dev-worker.md
            ├── ux-auditor.md
            ├── ux-reviewer.md
            └── team-dispatch.md

{workspace}/                                 ← 各项目的 workspace
  .ag/                                       ← 可选：workspace 级别的 override
    └── workflows/                           ← 项目特定的 workflow override
  data/
    projects/{projectId}/
      runs/{runId}/                          ← artifact 产物（不变）
        ├── task-envelope.json
        ├── result.json
        ├── architecture/
        └── *.md
```

### 3.2 配置解析优先级

模板/workflow 的加载顺序（后者覆盖前者）：

```
1. ~/.gemini/antigravity/gateway/assets/          ← 全局基线（必须存在）
2. {workspace}/.ag/                         ← 项目级 override（可选）
3. 内置 fallback                            ← 代码中的硬编码默认值
```

这样：
- 全局模板对所有项目可用
- 特定项目可以放 `.ag/workflows/coder.md` 来定制 coding 指令
- 不需要每个项目都复制完整的 `.agents/`

### 3.3 路径常量

```typescript
import { homedir } from 'os';
import path from 'path';

// 全局数据根 — 与 Antigravity IDE 的 ~/.gemini/antigravity/ 同级
const GATEWAY_HOME = path.join(homedir(), '.gemini', 'antigravity', 'gateway');

// 注册表
const PROJECTS_FILE   = path.join(GATEWAY_HOME, 'projects.json');
const RUNS_FILE       = path.join(GATEWAY_HOME, 'agent_runs.json');
const CONVS_FILE      = path.join(GATEWAY_HOME, 'local_conversations.json');
const HIDDEN_WS_FILE  = path.join(GATEWAY_HOME, 'hidden_workspaces.json');

// 全局角色配置
const GLOBAL_ASSETS_DIR = path.join(GATEWAY_HOME, 'assets');

// Workspace 级 override
const WS_ASSETS_DIR = (workspacePath: string) => path.join(workspacePath, '.ag');
```

---

## 4. 改动清单

### 4.1 注册表迁移

| 文件 | 改动 |
|------|------|
| `src/lib/agents/run-registry.ts` | `DATA_DIR` → `GATEWAY_HOME`；`PERSIST_FILE` → `RUNS_FILE` |
| `src/lib/agents/project-registry.ts` | `DATA_DIR` → `GATEWAY_HOME`；`PERSIST_FILE` → `PROJECTS_FILE` |
| `src/lib/bridge/statedb.ts` | `LOCAL_CACHE_DIR` 当前是 `process.cwd()/../data/`（注意是上级目录），改为 `GATEWAY_HOME` |
| `src/app/api/workspaces/close/route.ts` | `hidden_workspaces.json` 路径当前是 `process.cwd()/../data/`，改为 `GATEWAY_HOME` |

### 4.2 AssetLoader 改造

| 改动 |
|------|
| `ASSETS_DIR` → `GLOBAL_ASSETS_DIR`（模板 JSON 加载） |
| ✅ 已完成：workflow `.md` 文件现已由 AssetLoader 统一从全局目录 `GLOBAL_ASSETS_DIR/workflows/` 加载，通过 `resolveWorkflowContent()` 解析 |
| 新增 workspace override 层，合并 `{workspace}/.ag/` 的内容 |
| workflow 解析支持 fallback：先查 workspace `.ag/workflows/`，再查全局 |

### 4.3 group-runtime.ts 产物路径

| 改动 |
|------|
| `artifactDir` 使用 workspace 内相对路径 `demolong/projects/.../runs/.../`（已从 `data/` 迁移） |
| 不再用 `process.cwd()` 拼接产物路径，改为使用 `run.workspace` |
| `recoverInterruptedRun` 的 `resolveBase()` 使用 `entry.workspace`（已实现） |

### 4.4 CLI / 外部工具

| 工具 | 改动 |
|------|------|
| `scripts/ag.ts` | API 调用不受影响（通过 HTTP） |
| `scripts/antigravity-acp.ts` | 不受影响（通过 HTTP） |
| `cc-connect` | 不受影响（通过 ACP adapter） |
| MCP server | 如果直接读 JSON，路径更新 |

### 4.5 数据迁移

```bash
# 创建目标目录
mkdir -p ~/.gemini/antigravity/gateway/assets/{templates,review-policies,workflows}

# 迁移注册表
cp data/projects.json ~/.gemini/antigravity/gateway/
cp data/agent_runs.json ~/.gemini/antigravity/gateway/

# 注意：local_conversations.json 和 hidden_workspaces.json
# 当前实际在 process.cwd()/../data/（不是 ./data/），需确认实际路径后迁移
cp ../data/local_conversations.json ~/.gemini/antigravity/gateway/ 2>/dev/null || \
  cp data/local_conversations.json ~/.gemini/antigravity/gateway/
cp ../data/hidden_workspaces.json ~/.gemini/antigravity/gateway/ 2>/dev/null || \
  cp data/hidden_workspaces.json ~/.gemini/antigravity/gateway/

# 迁移角色配置
cp .agents/assets/templates/*.json ~/.gemini/antigravity/gateway/assets/templates/
cp .agents/assets/review-policies/*.json ~/.gemini/antigravity/gateway/assets/review-policies/
# workflow .md 文件被作为 path 引用嵌入 prompt，不是被 AssetLoader 加载
# 但仍然迁移到全局目录，以便未来统一管理
cp .agents/workflows/*.md ~/.gemini/antigravity/gateway/assets/workflows/
```

---

## 5. 迁移前后对比

### 5.1 第三方项目使用 multi-agent

**迁移前：**
```
客户项目 /Users/*/clients/project-a/
  → Antigravity 打开目录
  → 微信发 "ws 2" 切换到此 workspace
  → 微信发 "帮我写一个 REST API"
  → Gateway 的 AssetLoader 从 process.cwd()/.agents/ 加载配置
  → ❌ process.cwd() = Antigravity-Mobility-CLI，但 workspace = project-a
  → 模板和 workflow 可用 ← 因为 Gateway 仍在 CLI 目录启动
  → ⚠️ 但如果 Gateway 改为在 project-a/ 启动 → 配置全部丢失
```

**迁移后：**
```
客户项目 /Users/*/clients/project-a/
  → Antigravity 打开目录
  → Gateway 从 ~/.gemini/antigravity/gateway/assets/ 加载全局配置 ✅
  → 如果 project-a/.ag/workflows/coder.md 存在 → 使用项目特定 workflow ✅
  → 无论 Gateway 从哪启动，配置都能找到 ✅
```

### 5.2 接入新 IDE

**迁移前：**
```
Cortex IDE 打开 /path/to/cortex-project/
  → Cortex 的 LS 启动
  → Gateway 找到 Cortex LS（通过 ps aux）
  → 创建 conversation → LS 正常工作
  → Multi-agent dispatch → AssetLoader 从 process.cwd()/.agents/ 读配置
  → ❌ 如果 Gateway cwd ≠ Antigravity-Mobility-CLI → 配置不可用
```

**迁移后：**
```
Cortex IDE 打开 /path/to/cortex-project/
  → Gateway 从 ~/.gemini/antigravity/gateway/assets/ 读配置 ✅
  → Multi-agent 正常工作 ✅
  → 注册表在 ~/.gemini/antigravity/gateway/projects.json ✅
```

### 5.3 外部 CLI 访问

**迁移前：**
```bash
# Gemini CLI 想读 Project 列表
cat ???/data/projects.json  # 不知道 Gateway 的 cwd 在哪
```

**迁移后：**
```bash
# 任何 CLI 工具都用同一路径
cat ~/.gemini/antigravity/gateway/projects.json  ✅
```

---

## 6. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 迁移期间数据丢失 | 先 copy 不 move；旧 `data/` 保留作为备份 |
| `.agents/` 目录已被 Antigravity IDE 使用 | IDE 读取 `.agents/rules.md` (workspace rules file) 作为 system prompt 的一部分。我们迁移的是 `assets/` 和 `workflows/`，两者不冲突。注意 `.agents/rules.md` 是文件不是目录 |
| 文件权限问题 | `~/.gemini/antigravity/` 已由 IDE 创建，owner = 当前用户，权限 `drwxr-xr-x` |
| 多 Gateway 实例并发写 JSON | 当前已存在此问题（单进程设计），迁移不引入新风险 |
| 产物路径 `data/projects/` 在不同 workspace 内重名 | 不会，`projectId` 是 UUID，全局唯一 |

---

## 7. 时间线建议

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| 阶段 1 | 注册表迁移（projects/runs/convs → `~/.gemini/antigravity/gateway/`） | 高 |
| 阶段 2 | AssetLoader 改造（全局 + workspace override） | 高 |
| 阶段 3 | 清理旧 `data/*.json`（保留 artifact 目录） | 低 |
| 阶段 4 | 支持 `{workspace}/.ag/workflows/` override | 中 |
| 阶段 5 | Gateway 独立进程化（不依赖 Next.js dev server） | 未来 |

---

## 8. 关联文件

- `src/lib/agents/run-registry.ts` — Run 注册表存储
- `src/lib/agents/project-registry.ts` — Project 注册表存储
- `src/lib/agents/asset-loader.ts` — 模板/角色/workflow 加载
- `src/lib/agents/group-runtime.ts` — Multi-agent 运行时（artifact 路径）
- `src/lib/bridge/statedb.ts` — 会话缓存
- `.agents/assets/templates/` — 当前模板 JSON
- `.agents/workflows/` — 当前 workflow Markdown
- `scripts/ag.ts` — CLI 工具
- `scripts/antigravity-acp.ts` — 微信 ACP adapter

---

## 9. 跨 IDE 切换与迁移方案

### 9.1 各 IDE 的数据区域现状

每个 VSCode-based IDE 都有自己的数据区域，互不共享：

| IDE | 配置目录 | 应用数据目录 | 本机状态 |
|-----|---------|-------------|---------|
| Antigravity | `~/.antigravity/` + `~/.gemini/antigravity/` | `~/Library/Application Support/Antigravity/` | ✅ 已安装 |
| VS Code | `~/.vscode/` | `~/Library/Application Support/Code/` | ✅ 已安装 |
| VS Code Insiders | `~/.vscode-insiders/` | `~/Library/Application Support/Code - Insiders/` | ✅ 已安装 |
| Cursor | `~/.cursor/` | `~/Library/Application Support/Cursor/` | ✅ 已安装 |
| Trae | `~/.trae/` | `~/Library/Application Support/Trae/` | ✅ 已安装 |
| Windsurf | `~/.windsurf/` | `~/Library/Application Support/Windsurf/` | ❌ 未安装 |

### 9.1.1 CLI 工具数据区域

| CLI 工具 | 数据目录 | 关键内容 | 本机状态 |
|---------|---------|---------|---------|
| Gemini CLI | `~/.gemini/` | `projects.json`, `skills/`, `history/`, `oauth_creds.json`, `settings.json` | ✅ 已安装 |
| Copilot CLI | `~/.copilot/` | `config.json`（GitHub 登录）, `logs/`, `session-state/` | ✅ 已安装 |
| OpenAI Codex CLI | `~/.codex/` | `config.toml`（模型设置）, `sessions/`, `memories/`, `skills/`, `rules/` | ✅ 已安装 |

**Antigravity 运行时数据的完整目录结构（`~/.gemini/antigravity/`）：**
```
~/.gemini/antigravity/
  ├── agents/              ← agent 配置
  ├── annotations/         ← 对话注释（351 个）
  ├── brain/               ← AI brain 数据（183 个）
  ├── browser_recordings/  ← 浏览器录制
  ├── code_tracker/        ← 代码变更追踪
  ├── conversations/       ← 对话历史（103 个）
  ├── daemon/              ← 后台守护进程
  ├── global_workflows/    ← 全局 workflow
  └── ...
```

### 9.2 核心问题：耦合在哪里？

Gateway 与 Antigravity IDE 的耦合点：

```
1. discovery.ts  ← 通过进程名/argv.json 发现 LS 实例
2. grpc.ts       ← 使用 Antigravity 的 gRPC proto 定义
3. gateway.ts    ← 使用 Antigravity 的 API key 格式
4. statedb.ts    ← 从 ~/.gemini/antigravity/ 读取 state.vscdb
```

如果要切换到 **Cortex IDE** 或其他 IDE：
- **如果 Cortex 是 Antigravity 的 fork**（同样的 gRPC 接口）→ 改 discovery 的进程特征即可
- **如果 Cortex 有不同的 gRPC 接口** → 需要写新的 bridge adapter
- **如果是 Cursor/Windsurf 等不同架构的 IDE** → gRPC 接口完全不同，需要全新的 bridge 层

### 9.3 IDE 无关的数据层设计

为了实现真正的 IDE 无关性，数据存储**不应放在任何 IDE 的专属目录**：

```
❌ ~/.gemini/antigravity/gateway/    ← 和 Antigravity 绑定
❌ ~/.cursor/gateway/                 ← 和 Cursor 绑定

✅ ~/.ag-gateway/                     ← IDE 无关，独立存在
   ├── config.json
   ├── projects.json
   ├── agent_runs.json
   ├── local_conversations.json
   └── assets/
       ├── templates/
       ├── review-policies/
       └── workflows/
```

**但有一个现实约束：** Gateway 目前通过 `state.vscdb` 读取 API key，这个文件在 IDE 专属目录内。如果用 `~/.ag-gateway/`，需要额外配置 API key 来源。

### 9.4 推荐的分阶段策略

**阶段 1（近期）：先迁移到 `~/.gemini/antigravity/gateway/`**
- 最小改动，与现有 Antigravity 生态兼容
- Gateway 仍依赖 Antigravity 的 statedb 获取 API key
- 注册表和角色配置脱离 workspace

**阶段 2（中期）：引入 `AG_GATEWAY_HOME` 环境变量**
```bash
# 默认
AG_GATEWAY_HOME=~/.gemini/antigravity/gateway

# 自定义（IDE 无关）
AG_GATEWAY_HOME=~/.ag-gateway
```
- 所有路径通过 `AG_GATEWAY_HOME` 解析
- 不同 IDE 可以通过设置环境变量指向同一个数据目录

**阶段 3（远期）：Gateway 独立进程化**
```
Gateway 进程（独立于任何 IDE）
  ├── 自己的 HTTP server（:3000）
  ├── 自己的 config.json（含 API key）
  ├── 多 IDE bridge adapters
  │   ├── antigravity-bridge（gRPC proto A）
  │   ├── cortex-bridge（gRPC proto B）
  │   └── cursor-bridge（HTTP API）
  └── 统一数据层 ~/.ag-gateway/
```

### 9.5 一键切换脚本（未来）

```bash
#!/bin/bash
# ag-migrate.sh — 在 IDE 之间迁移 Gateway 数据
# 用法: ag-migrate.sh [from-ide] [to-ide]
# 例: ag-migrate.sh antigravity cortex

FROM=$1
TO=$2

case $FROM in
  antigravity) SRC=~/.gemini/antigravity/gateway ;;
  cortex)      SRC=~/.cortex/gateway ;;
  *)           SRC=~/.ag-gateway ;;
esac

case $TO in
  antigravity) DST=~/.gemini/antigravity/gateway ;;
  cortex)      DST=~/.cortex/gateway ;;
  *)           DST=~/.ag-gateway ;;
esac

# 迁移注册表
mkdir -p "$DST/assets"
cp "$SRC"/*.json "$DST/"
cp -r "$SRC/assets/" "$DST/assets/"

# 产物 artifact 不需要迁移（在各 workspace 内，与 IDE 无关）
echo "Done: $SRC → $DST"
```

### 9.6 以 Codex CLI 为调度中心的架构

#### 9.6.1 三个 CLI 的能力对比

| 能力 | Gemini CLI | Copilot CLI | Codex CLI |
|------|-----------|-------------|-----------|
| ACP 模式 | ✅ `--acp` | ✅ `--acp` | ❌（有 `proto` stdin/stdout 模式） |
| MCP 支持 | ✅ `gemini mcp` | ✅ `--add-github-mcp-tool` | ✅ `codex mcp` |
| Skills 系统 | ✅ `~/.gemini/skills/` | ❌ | ✅ `~/.codex/skills/` |
| Memories 系统 | ❌ | ❌ | ✅ `~/.codex/memories/` |
| Rules 系统 | ❌（用 Policy Engine） | ❌ | ✅ `~/.codex/rules/` |
| Multi-agent | ❌ | ❌ | ✅ `features.multi_agent = true` |
| 会话恢复 | ✅ `--resume` | ❌ | ✅ `codex resume` |
| 非交互模式 | ✅ `-p/--prompt` | ✅ `-p/--prompt` | ✅ `codex exec` |
| 模型选择 | ✅ `-m` | ✅ `--effort` | ✅ `config.toml` |
| 沙盒执行 | ✅ `--sandbox` | ❌ | ❌ |
| YOLO 模式 | ✅ `--yolo` | ❌ | ❌ |
| Hooks | ✅ `gemini hooks` | ❌ | ❌ |
| 当前模型 | `gemini-3-flash-preview` | GitHub Copilot 内置 | `gpt-5.4` |
| 数据目录 | `~/.gemini/` | `~/.copilot/` | `~/.codex/` |

#### 9.6.2 Codex CLI 作为调度中心的方案

Codex CLI 的 `codex exec` 非交互模式 + `codex proto` stdin/stdout 流式协议，可以**作为 Gateway 的执行后端之一**：

```
                     ┌───────────────────┐
微信 ──▶ cc-connect ──▶│   Gateway (现有)   │
                     │                   │
                     │  分流器:           │
                     │  ├─ workspace A   │──▶ Antigravity LS (gRPC)
                     │  ├─ workspace B   │──▶ Codex CLI (exec/proto)
                     │  └─ workspace C   │──▶ Gemini CLI (prompt)
                     └───────────────────┘
```

**架构 A：Codex CLI 作为备用执行引擎**

当 Antigravity LS 不可用时（比如 IDE 未启动），Gateway 可以 fallback 到 Codex CLI：

```typescript
// bridge/codex.ts
import { spawn } from 'child_process';

export function sendMessageViaCodex(
  workspacePath: string,
  prompt: string,
  model?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['exec', '-c', `model="${model || 'gpt-5.4'}"`, prompt];
    const proc = spawn('codex', args, { cwd: workspacePath });
    let output = '';
    proc.stdout.on('data', d => output += d);
    proc.on('close', () => resolve(output));
  });
}
```

**架构 B：Codex CLI 接管 Pipeline/Multi-Agent 调度**

如果未来 Codex CLI 的 `multi_agent` 功能成熟，Gateway 的 Pipeline 调度可以完全委托给 Codex：

```
当前:  Gateway → group-runtime.ts → gRPC → Antigravity LS
未来:  Gateway → codex exec → Codex 内置 multi_agent → 文件操作
```

优势：不依赖 Antigravity LS，Codex 自己管理文件读写和终端执行。
劣势：失去 Antigravity 的 brain、annotations、conversation history 等高级功能。

#### 9.6.3 统一 Skills/Workflows 跨 CLI 共享

三个 CLI 都有 skills 概念但格式不同：

```
~/.gemini/skills/          ← Gemini Skills: YAML manifests + prompts
~/.codex/skills/           ← Codex Skills: 目录结构（含 scripts/）
~/.gemini/antigravity/     ← Antigravity: .agents/workflows/*.md
```

**统一方案：创建一个共享 skills 仓库**

```
~/.ag-gateway/
  shared-skills/
    ├── manifests/          ← 统一的 skill 定义（JSON/YAML）
    └── symlinks/           ← 软链接到各 CLI 的 skills 目录
        ├── gemini → ~/.gemini/skills/
        ├── codex → ~/.codex/skills/
        └── antigravity → ~/.gemini/antigravity/global_workflows/
```

或者用 **symlink 反向方案**：各 CLI 的 skills 目录软链到同一个来源：

```bash
# 统一 skill 仓库
mkdir -p ~/.ag-gateway/skills

# 让各 CLI 共享
ln -sf ~/.ag-gateway/skills ~/.gemini/skills
ln -sf ~/.ag-gateway/skills ~/.codex/skills
```

#### 9.6.4 无痛使用各 CLI 资源的推荐方案

**阶段 1：环境变量 + 路径约定（立即可做）**

```bash
# ~/.zshrc 或 ~/.zprofile
export AG_GATEWAY_HOME="${AG_GATEWAY_HOME:-$HOME/.gemini/antigravity/gateway}"
export AG_SKILLS_DIR="$AG_GATEWAY_HOME/assets/workflows"

# 别名：快速在各 CLI 中使用相同的 workspace
alias ag-gemini='gemini -m gemini-3-flash-preview'
alias ag-codex='codex -c model=gpt-5.4'
alias ag-copilot='copilot'
```

**阶段 2：统一入口 CLI（中期）**

创建一个轻量 CLI `ag`（你已有 `scripts/ag.ts`），聚合所有 CLI：

```bash
ag run "写一个 TODO 应用"              # → 自动选最佳 CLI + 最佳模型
ag run --via codex "重构这个模块"       # → 指定用 Codex CLI
ag run --via gemini "分析这段代码"      # → 指定用 Gemini CLI
ag skills list                         # → 列出所有 CLI 的 skills
ag models                              # → 列出所有 CLI 可用模型
```

```typescript
// scripts/ag.ts 扩展
const CLI_BACKENDS = {
  antigravity: { cmd: 'curl', mode: 'api', baseUrl: 'http://127.0.0.1:3000' },
  gemini:      { cmd: 'gemini', mode: 'prompt', flag: '-p' },
  codex:       { cmd: 'codex', mode: 'exec', flag: 'exec' },
  copilot:     { cmd: 'copilot', mode: 'prompt', flag: '-p' },
};
```

**阶段 3：MCP 互联（远期）**

各 CLI 都支持 MCP。Gateway 可以同时作为 MCP server 被其他 CLI 调用：

```
Codex CLI ──MCP──▶ Gateway MCP Server ──▶ Antigravity LS
Gemini CLI ──MCP──▶ Gateway MCP Server ──▶ Antigravity LS
```

```bash
# Codex 配置使用 Gateway 的 MCP server
codex mcp add ag-gateway --cmd "npx tsx src/mcp/server.ts"

# 然后 Codex 内部可以调用 Gateway 提供的工具
# (list projects, dispatch run, get run status, etc.)
```

### 9.7 结论

| 场景 | 是否可行 | 需要做什么 |
|------|---------|-----------|
| 同时用 Antigravity + Cortex（同 fork） | ✅ | 改 discovery.ts 支持多进程特征 |
| 完全替换 Antigravity 为 Cortex | ✅ | 改 discovery + statedb 路径 + API key 来源 |
| 切换到 Cursor/Windsurf | ⚠️ | 需要全新的 gRPC bridge（这些 IDE 的 agent API 完全不同） |
| Gateway 独立运行（无 IDE） | ⚠️ | 需要阶段 3 的独立进程化 |
| 数据迁移 | ✅ | 复制 `*.json` + `assets/` 即可，产物在 workspace 内不受影响 |
