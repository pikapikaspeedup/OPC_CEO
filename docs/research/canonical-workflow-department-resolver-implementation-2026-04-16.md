# Canonical Workflow + Department Resolver 实施记录（2026-04-16）

## 本轮目标

把“Antigravity IDE 才能自动发现并执行 workflow / skill / rule”的能力，向 Gateway 自己的跨 provider 执行语义收口，并完成第一阶段可运行实现：

1. 统一 canonical 资产源
2. 接入 Department Capability Registry / Resolver
3. Prompt Mode / Template 路径开始消费部门能力包
4. Department sync 改为“canonical assets → IDE mirrors”
5. 修复 Ops 左栏 assets 死入口

## 已实现

### 1. Canonical 资产源

新增：

- `src/lib/agents/canonical-assets.ts`

行为：

- workflow / skill / rule 统一从 `~/.gemini/antigravity/gateway/assets` 读取
- 提供 canonical 的 list/get/save/delete helpers
- workflow 名称支持 `/name` 和 `name` 两种引用

### 2. 启动期 legacy 资产迁移到 canonical

修改：

- `src/lib/agents/gateway-home.ts`

行为：

- repo `.agents/workflows` 仍会同步到 gateway assets
- `~/.gemini/antigravity/global_workflows/*.md` 会补充同步到 canonical workflows
- `~/.gemini/antigravity/skills/<name>/SKILL.md` 会整目录同步到 canonical skills

效果：

- canonical API 不再依赖 IDE gRPC 才能看到全局 workflow / skill

### 3. `/api/workflows|skills|rules` 改为同源

修改：

- `src/app/api/workflows/route.ts`
- `src/app/api/workflows/[name]/route.ts`
- `src/app/api/skills/route.ts`
- `src/app/api/skills/[name]/route.ts`
- `src/app/api/rules/route.ts`
- `src/app/api/rules/[name]/route.ts`

效果：

- 列表与详情统一来自 canonical source
- 返回对象新增 `source: "canonical"`

验证：

- `/api/workflows/ai-topic-discovery`：从之前的 `404` 变成 `200`
- `/api/skills/browser-testing`：返回 canonical 路径和完整内容

### 4. Department Capability Registry

新增：

- `src/lib/agents/department-capability-registry.ts`

职责：

- 读取 `workspace/.department/config.json`
- 生成 department identity rule
- 解析 skill → workflowRef / skillRefs
- 读取本地 legacy rules（`.department/rules` + `.agents/rules`）
- 收集模板中引用的 workflow

说明：

- 本轮没有把 workspace local workflow 继续当正式真相源
- 但会继续读取本地规则，避免现有项目上下文完全丢失

### 5. Department Execution Resolver

新增：

- `src/lib/agents/department-execution-resolver.ts`

职责：

- **Template 已定**：校验 template 是否被部门允许，并构建部门能力注入上下文
- **Prompt Mode**：不做 AI 二次选择，只把部门允许的 workflow / fallback skills / rules / identity 打包给 provider

关键策略：

- 有 explicit `promptAssetRefs` 时优先它们
- 否则注入部门 skill 绑定的 workflow
- 没有 workflow 再注入 fallback skills
- 对外仍统一记为 Prompt Mode

### 6. Prompt / Template 路径接 Resolver

修改：

- `src/lib/agents/prompt-executor.ts`
- `src/lib/agents/dispatch-service.ts`
- `src/lib/agents/group-runtime.ts`
- `src/lib/agents/run-registry.ts`
- `src/lib/types.ts`
- `src/lib/agents/group-types.ts`

效果：

- Prompt Mode run 开始写入：
  - `resolvedWorkflowRef?`
  - `resolvedSkillRefs?`
  - `resolutionReason`
- Template run 在派发前校验部门 template allowlist
- runtime prompt 会 prepend department capability pack
- 下游自动 stage dispatch 也会兜底注入 template context

### 7. Department sync 重写

修改：

- `src/lib/agents/department-sync.ts`
- `src/app/api/departments/route.ts`

行为：

- 不再依赖 `.department/workflows` 作为手写真相源
- 由 `DepartmentConfig + canonical workflows + local rules + memory`
  生成：
  - `workspace/.agents/rules/*`
  - `workspace/.agents/workflows/*`
  - `AGENTS.md` / `CLAUDE.md` / `.cursorrules`

注意：

- Antigravity 镜像目录改为 `.agents/`，与现有工作区约定保持一致

### 8. UI 收口

修改：

- `src/components/sidebar.tsx`
- `src/app/page.tsx`
- `src/components/assets-manager.tsx`
- `src/components/department-setup-dialog.tsx`
- `src/components/skill-browser.tsx`

效果：

- Ops 左栏 recent assets 点击后会切到主区对应 tab 并展开对应条目
- AssetsManager 展示 canonical `source`
- AssetsManager 编辑前详情加载失败时不再开空编辑器
- Department Setup 可维护：
  - 部门 skill
  - `workflowRef`
  - `skillRefs`

## 本轮没有做的

1. **没有引入独立 Department Orchestrator agent/runtime**
   - 当前只做 Deterministic Resolver

2. **没有新增 discovered 资产独立 API/UI**
   - 本轮直接把主列表切到 canonical source
   - 如果后续还要看 IDE discovered assets，需要单独加 discover/import 视图

3. **没有把 workspace 本地 workflow 当正式真相源**
   - 例如 `baogaoai/.agents/workflows/ai_digest.md`
   - 这类本地 workflow 仍需后续迁移到 canonical global workflows 才能进入正式执行链

## 验证

### 单元测试

执行：

```bash
npx vitest run \
  src/lib/agents/department-capability-registry.test.ts \
  src/lib/agents/department-execution-resolver.test.ts \
  src/lib/providers/ai-config.test.ts \
  src/lib/bridge/native-codex-adapter.test.ts
```

结果：

- 4 个文件
- 25 条测试
- 全部通过

### 接口实测

执行后结果：

- `/api/workflows` → `workflowCount = 68`
- `/api/workflows/ai-topic-discovery` → `200`
- `/api/skills` → `skillCount = 18`
- `/api/skills/browser-testing` → `200`
- workflow / skill 返回对象均带 `source = canonical`

### Lint

本轮新增/核心改动文件无 lint error。  
仍保留少量历史 warning（例如已有组件中的 `<img>` 提示），未阻塞本轮实现。
