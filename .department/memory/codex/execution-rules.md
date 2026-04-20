# Codex 执行规则

## 工作方式
- Codex 使用 MCP 协议通过 CodexMCPClient 交互
- sandbox 模式：workspace-write
- approval policy: never（全自动）

## 代码生成偏好
- 优先使用项目已有的库和工具
- 不引入新依赖，除非明确要求
- 输出代码放在 artifactDir 指定的目录下
