# Claude Engine Department Runtime 完成度审计（2026-04-20）

**日期**: 2026-04-20  
**范围**: 审计 `docs/design/claude-engine-department-runtime-design-2026-04-19.md` 的实现完成度  
**结论**: **A-D 代码骨架与主要接线已落地，但按设计全文与验收口径，不能算 100% 完成。**

---

## 1. 当前判断

如果按“是否已经有代码、测试、类型检查、构建通过”来判断：

1. `Phase A`
2. `Phase B`
3. `Phase C`
4. `Phase D`

基本都已经有实现，并且当前关键测试、`tsc`、`build` 都通过。

但如果按设计文档自己的完成标准来判断：

- **还不能宣称这份设计已经完全开发完成**

原因有两个关键断点。

---

## 2. Finding 1：`native-codex` 主链注册已切到 Claude Engine，但真实 provider 仍然被解析成 `openai`

### 证据

`native-codex` 的 Department 主链注册，确实已经改为：

- [builtin-backends.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/backends/builtin-backends.ts:1195)

这里注册的是：

- `new ClaudeEngineAgentBackend('native-codex')`

但是在 `ClaudeEngineAgentBackend` 内部，`native-codex` 的 model config 仍然被解析成：

- `provider: 'openai'`

关键位置：

- [claude-engine-backend.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/backends/claude-engine-backend.ts:128)

而 Claude Engine 主循环里，只有当 `provider === 'native-codex'` 时，才会走：

- `streamQueryNativeCodex(options)`

关键位置：

- [retry.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/claude-engine/api/retry.ts:198)

### 判断

这意味着：

1. 注册层已经把 `native-codex` 指向了 Claude Engine backend
2. 但真实 query loop 仍未必会走 native-codex 专用 adapter
3. 因此 `Phase C` 还不能算完全闭环

更直接地说：

- **“`native-codex` 已进入 Claude Engine API adapter 主链” 这个说法，目前在 backend 内部仍有断点。**

---

## 3. Finding 2：capability-aware routing 已把 `native-codex` 当成强 Department runtime，但这个判断建立在过强假设上

### 证据

当前 capability registry 对 `native-codex` 的升级条件之一是：

1. backend 已经是 `ClaudeEngineAgentBackend`
2. 或 backend 报出强 Department runtime capabilities

关键位置：

- [department-capability-registry.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/agents/department-capability-registry.ts:242)

因此一旦 `native-codex` 被注册成 `ClaudeEngineAgentBackend('native-codex')`，capability profile 就会升级成：

1. `runtimeFamily = 'claude-engine'`
2. 支持 `artifact-heavy / review-loop / delivery`

关键位置：

- [department-capability-registry.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/agents/department-capability-registry.ts:258)

### 判断

如果 Finding 1 中的 provider 断点仍然存在，那么这里的 capability 升级其实是：

- **注册层已切换**

但不是：

- **真实 native-codex adapter 路径已完全走通**

这会带来一个风险：

1. routing 可能认为 `native-codex` 已可承接强约束 Department 任务
2. 但真实执行链仍可能没有走到 native-codex 专用 provider adapter

所以 `Phase D` 的路由框架已经实现，但对 `native-codex` 的能力判断仍可能“过早乐观”。

---

## 4. Finding 3：设计文档自己的 Phase E 验收标准，目前没有被当前仓库证据完全满足

设计文档明确要求：

- `review-flow + native-codex` 至少有一条模板链路跑通

关键位置：

- [claude-engine-department-runtime-design-2026-04-19.md](/Users/darrel/Documents/Antigravity-Mobility-CLI/docs/design/claude-engine-department-runtime-design-2026-04-19.md:742)

但仓库里现有的真实实测文档明确记录：

1. `design-review-template`
2. `provider = native-codex`
3. `status = failed`
4. 原因是没有产出 `specs/` 规定文件

关键位置：

- [ai-company-full-feature-test-results-2026-04-19.md](/Users/darrel/Documents/Antigravity-Mobility-CLI/docs/research/ai-company-full-feature-test-results-2026-04-19.md:94)
- [ai-company-full-feature-test-results-2026-04-19.md](/Users/darrel/Documents/Antigravity-Mobility-CLI/docs/research/ai-company-full-feature-test-results-2026-04-19.md:112)

### 判断

当前仓库里我能确认的是：

1. 单测 / 接线测试 / 构建 都是绿的
2. 但没有看到一份 **更新于 2026-04-20 的真实 smoke / e2e 证据** 来推翻这份失败记录

所以按设计文档自己的 Phase E 口径：

- **尚不能认定“全文完成”**

---

## 5. 已确认完成的部分

以下内容已经有充分代码和测试证据：

1. `DepartmentRuntimeContract` 合同层
2. `readRoots / writeRoots / requiredArtifacts` 进入 runtime
3. `AgentTool` / MCP resource provider 的 context-scoped 注入
4. `ToolExecutor` 的 permission / root enforcement
5. `capability-aware routing` 框架
6. `native-codex` adapter 文件与测试
7. `native-codex` Department backend 注册切换

---

## 6. 当前最准确定义

截至 **2026-04-20**，最准确的判断应是：

1. **这份设计的 Phase A-D 大体已经开发完成**
2. **但按设计全文与验收标准，不能算 100% 完成**

最核心的未闭环点是：

1. `native-codex -> Claude Engine API adapter` 在 backend provider 解析上仍有断点
2. `review-flow + native-codex` 缺少当前有效的真实通过证据

---

## 7. 建议口径

对内建议统一改成：

- **“Claude Engine Department Runtime 统一设计的 Phase A-D 已基本落地；Phase E 验收仍未完全闭环。”**

不要直接说：

- **“这份设计已经全部开发完成。”**
