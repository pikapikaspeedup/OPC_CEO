# Department Patterns

Best practices, coding conventions, and lessons learned.

---

### 测试规范
- 单元测试使用 Vitest，放在 `__tests__/` 目录
- 测试命名：`describe("模块名")` + `it("行为描述")`
- Mock 使用 `vi.mock()` + `vi.hoisted()`

### 代码风格
- TypeScript strict mode
- 生产代码禁止 `as any`，测试代码中 mock 数据可使用
- 文件结构：types → helpers → main logic → exports

### 文档同步
- 代码改了 → 文档必须同步改（不是"之后补"）
- `PROJECT_PROGRESS.md` 每次任务完成后更新

---