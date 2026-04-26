# 文档索引

> 当前事实优先级：`README.md` / `ARCHITECTURE.md` / `docs/guide/*` 高于 `docs/design/*`、`docs/research/*`。
> 已确认废弃且不再需要的文档会直接删除；历史背景只在必要时保留短说明，不再默认归档整份旧正文。

## 核心文档

| 文档 | 说明 | 用途 |
|------|------|------|
| [../README.md](../README.md) | 项目入口说明 | 快速了解系统与启动方式 |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | 当前系统架构 | 角色拆分、模块边界、关键文件 |
| [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md) | 已完成并验证的实现记录 | 看最近落地内容 |
| [guide/agent-user-guide.md](guide/agent-user-guide.md) | Agent / Template / Stage / Department 使用指南 | 产品与交付主链 |
| [guide/gateway-api.md](guide/gateway-api.md) | 对外 API 文档 | 对话、运行时、分页列表、split ownership |
| [guide/cli-api-reference.md](guide/cli-api-reference.md) | 调度类 API 参考 | Projects / Runs / Scheduler / Resume / Intervene |

## 接入与运维

| 文档 | 说明 |
|------|------|
| [guide/cli-guide.md](guide/cli-guide.md) | `ag` CLI 使用指南 |
| [guide/ceo-scheduler-guide.md](guide/ceo-scheduler-guide.md) | CEO 调度与 Scheduler 使用说明 |
| [guide/mcp-server.md](guide/mcp-server.md) | MCP Server 配置与工具说明 |
| [guide/remote-access.md](guide/remote-access.md) | Cloudflare Tunnel 远程访问 |
| [guide/wechat-setup.md](guide/wechat-setup.md) | 微信接入 |
| [guide/obsidian-setup.md](guide/obsidian-setup.md) | Obsidian 插件 |
| [guide/grpc-reference.md](guide/grpc-reference.md) | gRPC 协议逆向参考 |
| [guide/knowledge-api.md](guide/knowledge-api.md) | Knowledge API |
| [guide/logging-standards.md](guide/logging-standards.md) | 日志规范 |
| [guide/graph-pipeline-guide.md](guide/graph-pipeline-guide.md) | GraphPipeline 指南 |

## 设计与研究

| 目录/文档 | 说明 |
|-----------|------|
| [`design/`](design) | 设计方案、落地前约束、实现前分析 |
| [`research/`](research) | 时间点审计、问题复盘、性能研究 |
| [OPC_next.md](OPC_next.md) | 早期 OPC 演进规划，保留为背景材料，不代表当前事实 |
| [opc-interaction-design-v2.md](opc-interaction-design-v2.md) | OPC 交互设计说明 |

## 内部参考

| 文档 | 说明 |
|------|------|
| [internals/agent-internals.md](internals/agent-internals.md) | Agent 系统内部实现 |
| [internals/extensibility-architecture.md](internals/extensibility-architecture.md) | 可扩展架构 |
| [internals/permission-system.md](internals/permission-system.md) | 权限系统 |
| [internals/opc-one-person-company.md](internals/opc-one-person-company.md) | OPC 核心设计 |

## 历史说明

只有在确实需要保留背景时，仓库里才会留下：

1. 顶部带“历史/已过时”说明的研究文档
2. 少量 tombstone 文件，用来说明旧路径已删除

## 运行经验

| 文档 | 说明 |
|------|------|
| [../PITFALLS.md](../PITFALLS.md) | 真实踩坑记录与排障经验 |
