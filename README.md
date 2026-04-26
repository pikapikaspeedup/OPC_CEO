# Antigravity Gateway

> 将 Antigravity 从桌面 IDE 扩展成可远程访问、可多 Provider 接入、可做 Agent 编排的网关平台。

**[English Documentation →](README_EN.md)**

---

## 系统概览

从产品视角看，这个系统仍然是：

1. 一个 Web 前端
2. 一个 Gateway 后端

默认部署视角看，系统运行在同一台设备上的两个服务：

| 服务 | 主要职责 |
|------|----------|
| `opc-web` | 页面渲染、浏览器入口、HTTP API 代理 |
| `opc-api` | 项目、CEO、部门、审批、设置、conversation、runs、models、workspace、scheduler 可选后台任务 |

内部仍保留 control-plane / runtime / scheduler 的代码边界，但它们不是默认部署概念。

---

## 当前能力

- Web UI：首页、CEO Office、Settings、Projects、Conversations、Knowledge、Operations
- 对话壳层：既支持 Antigravity conversation，也支持本地 provider conversation
- 多 Provider：`antigravity`、`codex`、`native-codex`、`claude-api`、`openai-api`、`gemini-api`、`grok-api`、`custom`
- Agent 编排：公共调度契约已经收口为 `templateId + stageId`
- 项目与审批：Project、Approval、Department、Scheduler、Deliverables、Journal
- 外部接入：MCP Server、CLI、WeChat、Obsidian
- 分页列表：`/api/conversations`、`/api/projects`、`/api/agent-runs`、`/api/scheduler/jobs` 等统一返回分页结构

---

## 快速开始

### 前提

- Node.js 20+
- 建议在 macOS Apple Silicon 上运行
- 如果要走 `antigravity` provider，需要本机已安装并登录 Antigravity，且至少打开过一个 workspace

### 默认启动方式

```bash
git clone https://github.com/pikapikaspeedup/Antigravity-Mobility-CLI.git
cd Antigravity-Mobility-CLI

npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

默认本地开发会在同一台设备上启动两个服务：

1. `opc-api`：`http://127.0.0.1:3101`
2. `opc-web`：`http://127.0.0.1:3000`

后端仍在宿主机上运行，可以访问 Antigravity IDE、Language Server、本地 workspace、`~/.gemini` 和 SQLite。`opc-api` 默认负责 cron scheduler，因此 AI 日报这类循环任务会按计划执行；bridge worker 与 scheduler companion 后台默认关闭，避免 fan-out/approval/consumer 类恢复任务放大 CPU。

### 分离启动

需要单独调试前端或后端时：

```bash
npm run dev:api
npm run dev:web
```

生产同设备部署使用：

```bash
npm run start:api
npm run start:web
```

### 可选桌面壳

需要 macOS 原生文件夹选择能力时，可以在默认本地服务之上打开 Tauri 桌面壳：

```bash
npm run dev
npm run desktop:dev
```

`desktop:dev` 只打开桌面 WebView 并加载 `http://127.0.0.1:3000`，不自动再启动一套 Node 后台。当前桌面壳主要用于 CEO Office 新建部门时选择本机文件夹，导入仍走 `/api/workspaces/import`，不会自动启动 Antigravity 或 Language Server。

不建议把 Docker 作为默认部署方式；本项目和宿主机文件系统、Antigravity IDE、Language Server、workspace 结合很深。Docker 可以作为后续高级部署选项，但默认推荐同设备前后端分离。

---

## 基础验证

```bash
# 用户信息
curl http://localhost:3000/api/me

# 模型列表
curl http://localhost:3000/api/models

# 工作区目录
curl "http://localhost:3000/api/workspaces?page=1&pageSize=20"

# 对话列表（分页）
curl "http://localhost:3000/api/conversations?page=1&pageSize=20"

# Run 列表（分页）
curl "http://localhost:3000/api/agent-runs?page=1&pageSize=20"

# 项目列表（分页）
curl "http://localhost:3000/api/projects?page=1&pageSize=20"
```

---

## 常用示例

### 创建对话并发送消息

```bash
CID=$(curl -sX POST http://localhost:3000/api/conversations \
  -H 'Content-Type: application/json' \
  -d '{"workspace":"file:///path/to/project"}' | jq -r .cascadeId)

curl -sX POST "http://localhost:3000/api/conversations/$CID/send" \
  -H 'Content-Type: application/json' \
  -d '{"text":"解释这个项目的架构"}'

curl -s "http://localhost:3000/api/conversations/$CID/steps" | jq '.steps | length'
```

### 派发一个 Agent Run

```bash
curl -X POST http://localhost:3000/api/agent-runs \
  -H 'Content-Type: application/json' \
  -d '{
    "templateId": "coding-basic-template",
    "workspace": "file:///path/to/project",
    "prompt": "修复登录 token 刷新问题"
  }'
```

如果要从模板的某个特定阶段开始派发：

```bash
curl -X POST http://localhost:3000/api/agent-runs \
  -H 'Content-Type: application/json' \
  -d '{
    "templateId": "development-template-1",
    "stageId": "product-spec",
    "workspace": "file:///path/to/project",
    "prompt": "输出产品规格草案"
  }'
```

---

## 数据目录

运行期主数据位于 `~/.gemini/antigravity/gateway/`：

| 路径 | 说明 |
|------|------|
| `storage.sqlite` | 主 SQLite 数据库 |
| `assets/templates/` | 模板资产 |
| `assets/workflows/` | 工作流资产 |
| `runs/` | Run 级执行历史与产物 |
| `projects/` | 项目级状态、journal、checkpoint 等 |

---

## 文档入口

- [ARCHITECTURE.md](ARCHITECTURE.md)：当前系统架构、角色拆分、模块边界
- [docs/guide/agent-user-guide.md](docs/guide/agent-user-guide.md)：Agent / Template / Stage / Department 使用指南
- [docs/guide/gateway-api.md](docs/guide/gateway-api.md)：对外 API 文档
- [docs/guide/cli-api-reference.md](docs/guide/cli-api-reference.md)：Agent / Project / Scheduler 调度接口
- [docs/guide/mcp-server.md](docs/guide/mcp-server.md)：MCP Server 使用说明
- [docs/guide/remote-access.md](docs/guide/remote-access.md)：Cloudflare Tunnel 远程访问
- [docs/README.md](docs/README.md)：完整文档索引

---

## 兼容性说明

- 对外仍然是一个统一的 Gateway API；split 模式只是后端内部角色拆分
- 现有 Antigravity IDE 路径仍保持兼容：不写 `state.vscdb`，不删除 IDE 自己的 `.pb` / `brain`
- `web` 在 split 模式下只保留壳层与代理职责，不再承载控制面和运行时重逻辑

---

## 免责声明

本项目是出于学习和互操作性目的构建的非官方工具：

- 不提供绕过付费墙、破解认证或滥用 API 的能力
- 依赖用户本机已安装并合法认证的 Antigravity
- 与 Google DeepMind 没有关联、授权或背书

## 许可证

MIT
