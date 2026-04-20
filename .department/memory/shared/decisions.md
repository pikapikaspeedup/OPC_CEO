# Department Decisions

Architectural and implementation decisions with rationale.

---

### 2026-04-12 (architect)

- **记忆系统架构**：采用"管理层 + 执行层"模型，而非三套独立系统
  - Department Memory = 管理控制面（编辑各 Provider 的执行层记忆）
  - Claude-Engine Memory = Claude Provider 执行层
  - Knowledge = Gemini Provider 执行层（IDE 原生）

### 2026-04-10 (architect)

- **Provider 策略**：多 Provider 并行（Claude API / Codex / Antigravity），通过 resolveProvider() 统一选择
- **Agent 系统**：采用 Pipeline/Stage 模式，支持 DAG 依赖链

### 2026-04-08 (architect)

- **前端技术栈**：Next.js 15 + shadcn/ui + Tailwind CSS
- **后端运行时**：Node.js + tsx（开发环境热重载）

---