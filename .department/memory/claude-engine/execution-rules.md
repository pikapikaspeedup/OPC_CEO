# Claude Engine 执行规则

## API 设计
- API 路由放在 `src/app/api/` 下，遵循 Next.js App Router 规范
- 统一使用 JSON 响应，错误码使用 HTTP 标准状态码
- gRPC 调用使用 gateway 模块的 `grpc()` 函数

## 代码规范
- 使用 `createLogger()` 创建模块级日志
- 异步操作优先使用 async/await，避免回调
- 错误处理：业务错误返回 400+，系统错误返回 500+

## 记忆系统
- MemoryStore 底座位于 `src/lib/claude-engine/memory/`
- 记忆文件使用 frontmatter（name/description/type）
- MEMORY.md 是索引入口，限制 200 行
