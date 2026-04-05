# 文档索引

## 使用指南 (`guide/`)

| 文档 | 说明 | 受众 |
|------|------|------|
| [agent-user-guide.md](guide/agent-user-guide.md) | Multi-Agent 系统完整用户手册：Group、Pipeline、Workflow、产物体系 | 用户 |
| [cli-guide.md](guide/cli-guide.md) | `ag` CLI 命令使用指南 | 用户 |
| [gateway-api.md](guide/gateway-api.md) | Gateway REST + WebSocket API 完整参考 | 开发者 |
| [cli-api-reference.md](guide/cli-api-reference.md) | Agent/Project 调度 REST 端点详细参考 | 开发者 |
| [grpc-reference.md](guide/grpc-reference.md) | Language Server gRPC 协议逆向工程参考 | 开发者 |
| [knowledge-api.md](guide/knowledge-api.md) | Knowledge Items API | 开发者 |
| [mcp-server.md](guide/mcp-server.md) | MCP Server 配置与 Tool 说明 | 集成者 |
| [remote-access.md](guide/remote-access.md) | Cloudflare Tunnel 远程访问设置 | 运维 |
| [wechat-setup.md](guide/wechat-setup.md) | 微信 × Claude Connect (cc-connect) 设置指南 | 用户 |
| [obsidian-setup.md](guide/obsidian-setup.md) | Obsidian 插件安装与配置指南 | 用户 |
| [logging-standards.md](guide/logging-standards.md) | Pino 结构化日志规范 | 开发者 |
| [graph-pipeline-guide.md](guide/graph-pipeline-guide.md) | GraphPipeline 完整指南 | 开发者 |

## 设计与规划

| 文档 | 说明 |
|------|------|
| [OPC_next.md](OPC_next.md) | OPC 演进路径规划 |
| [opc-interaction-design-v2.md](opc-interaction-design-v2.md) | OPC 交互设计说明书 v2.0 |
| [user-journey-gaps.md](user-journey-gaps.md) | 用户场景断裂分析（已全部修复） |

## 内部参考 (`internals/`)

| 文档 | 说明 |
|------|------|
| [opc-one-person-company.md](internals/opc-one-person-company.md) | OPC 核心设计文档：概念体系、任务流转、权限、报告 |
| [agent-internals.md](internals/agent-internals.md) | Agent 系统内部实现：gRPC 调用链、Owner 路由、结果提取 |
| [extensibility-architecture.md](internals/extensibility-architecture.md) | 可扩展性架构：Phase 1-5 演进路线、约束分析 |
| [permission-system.md](internals/permission-system.md) | 权限系统：三层模型、toolConfig、审批流程 |
| [cdp-reverse-engineering.md](internals/cdp-reverse-engineering.md) | Chrome DevTools Protocol 研究（决策：不采用）|
| [ag-vs-claude-code-multi-agent.md](internals/ag-vs-claude-code-multi-agent.md) | Multi-Agent 系统架构深度对比报告 |
| [masfactory-comparison.md](internals/masfactory-comparison.md) | MASFactory vs Antigravity Gateway 对比 |
| [masfactory-integration-design.md](internals/masfactory-integration-design.md) | MASFactory 动态图流融合集成方案 |
| [single-conversation-mode-design.md](internals/single-conversation-mode-design.md) | 单对话 Multi-Agent 执行模式设计 |

## 进度跟踪

| 文档 | 说明 |
|------|------|
| [PROJECT_PROGRESS.md](PROJECT_PROGRESS.md) | 项目进度跟踪（每次任务完成后更新） |

## 其他

| 文档 | 说明 |
|------|------|
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | 产品整体架构（根目录）|
| [../README.md](../README.md) | 项目 README |
