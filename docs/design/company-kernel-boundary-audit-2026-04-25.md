# Company Kernel Boundary Audit

**日期**: 2026-04-25  
**状态**: Phase 0 completed for Phase 1-2 implementation  
**关联 RFC**: `docs/design/company-kernel-phase-0-2-implementation-rfc-2026-04-25.md`

## 1. 结论

本审计确认 Company Kernel Phase 1-2 的安全落点：

1. Run lifecycle 的主写入口是 `createRun()` / `updateRun()` / finalization。
2. 长期知识的结构化入口是 `knowledge_assets`，但 run 完成后的自动写入必须先进入 `memory_candidates`。
3. Legacy `.department/memory/*.md` 可以继续被读取和人工写入，但 run finalization 不应自动 append。
4. Scheduler/worker 不应为了 Company Kernel 新增循环；Company Kernel 只消费现有 run lifecycle。
5. Antigravity IDE 的 workspace/server/Language Server/provider 启动路径不属于 Company Kernel 的改造范围。

## 2. Run Lifecycle 写路径

| 路径 | 当前职责 | Phase 1-2 处理 |
| --- | --- | --- |
| `src/lib/agents/run-registry.ts#createRun` | 创建 `AgentRunState`，写 `runs` 表，写 run history | 记录 `run-created` capsule snapshot |
| `src/lib/agents/run-registry.ts#updateRun` | 更新状态、result、artifact、session、verification，写 `runs` 表 | 仅在低频关键字段变化时更新 capsule |
| `src/lib/agents/finalization.ts#finalizeAdvisoryRun` | 扫描 artifact、写 result envelope、持久化知识 | 停止自动写 Markdown memory，知识改走 candidate |
| `src/lib/agents/finalization.ts#finalizeDeliveryRun` | 校验 delivery packet、写 result envelope、更新 terminal status | 停止自动写 Markdown memory，知识改走 candidate |
| `src/lib/backends/run-session-hooks.ts` | 将 provider terminal event 回写 run 并调用 memory hooks | 保持不变，可作为后续补充触发点 |
| `src/lib/agents/group-runtime.ts` | 多角色 runtime 编排，多个位置调用 `updateRun()` | 不直接嵌入 Company Kernel 复杂逻辑 |

## 3. Memory / Knowledge 写路径

| 路径 | 写入对象 | 风险 | Phase 1-2 处理 |
| --- | --- | --- | --- |
| `src/lib/agents/department-memory.ts#appendDepartmentMemory` | `.department/memory/*.md` | 人工写入可接受，自动写入会污染 | 保留函数，禁止 finalization 自动调用 |
| `src/lib/agents/department-memory.ts#extractAndPersistMemory` | `.department/memory/knowledge.md` / `decisions.md` | 正则 + changedFiles 直接永久化 | 不再由 run finalization 自动调用 |
| `src/lib/knowledge/index.ts#persistKnowledgeForRun` | `knowledge_assets` + filesystem mirror | 直接 active/proposal，证据弱 | 改为 RunCapsule -> MemoryCandidate；默认不自动 promote |
| `src/lib/knowledge/store.ts#upsertKnowledgeAsset` | SQLite + mirror | 正确结构化入口 | 仅 promotion 后调用 |
| `src/lib/knowledge/extractor.ts#extractKnowledgeAssetsFromRun` | 构造 legacy assets | 可用于 legacy 测试/迁移，不作为主线 | 保留兼容，不再作为 persist 主线 |
| `src/lib/agents/department-memory-bridge.ts` | 读取 legacy memory + structured knowledge 注入 execution | 读取路径安全 | 保留读取，不增加写入 |

## 4. Evolution 写路径

| 路径 | 当前职责 | Phase 1-2 处理 |
| --- | --- | --- |
| `src/lib/evolution/generator.ts` | 从 proposal knowledge 和 repeated prompt runs 生成草稿 | 暂不重写；未来改消费 RunCapsule / promoted memory |
| `src/lib/evolution/evaluator.ts` | 评估 proposal 命中 run 的成功率 | 保持不变 |
| `src/lib/evolution/publisher.ts` | 发布 workflow/skill | 保持审批后发布，不自动发布 |
| `src/app/api/evolution/proposals/*` | proposal CRUD/evaluate/publish/observe | 保持不变 |

## 5. Scheduler / Worker 启动路径

| 路径 | 当前职责 | Company Kernel 约束 |
| --- | --- | --- |
| `src/lib/agents/scheduler.ts` | cron/interval job 计算、触发 | 不新增 Company Kernel 扫描循环 |
| `src/server/workers/scheduler-worker.ts` | API role 下启动 cron loop，可选 companions | 不改启动策略 |
| `server.ts` / `src/server/api/server.ts` | 同设备 API 组合服务 | 不增加新角色 |
| `scripts/run-local-services.mjs` | 启动 web + api | 不增加第三个长期服务 |

## 6. API Route 副作用

| API | 副作用 | 处理 |
| --- | --- | --- |
| `POST /api/agent-runs` | 创建 run，可能启动 provider | Company Kernel 只记录 run snapshot，不改变 dispatch |
| `GET /api/agent-runs` | 读 run，必须分页 | 保持只读 |
| `GET /api/knowledge` | 读 filesystem mirror | 保持只读 |
| `PUT/DELETE /api/knowledge/:id` | 修改/删除 knowledge | 保持人工操作 |
| `POST /api/evolution/proposals/generate` | 写 evolution proposals | 保持显式触发 |
| `POST /api/scheduler/jobs/:id/trigger` | 显式触发 job/run | 不增加额外触发 |
| `GET /api/company/run-capsules` | 读 capsule，分页 | 新增只读 |
| `GET /api/company/memory-candidates` | 读 candidate，分页 | 新增只读 |
| `POST /api/company/memory-candidates/:id/promote` | 写 knowledge asset | 新增显式晋升 |
| `POST /api/company/memory-candidates/:id/reject` | 更新 candidate 状态 | 新增显式拒绝 |

## 7. Test Isolation 规则

新增测试必须满足：

1. 使用 `vitest.setup.ts` 默认隔离 HOME / AG_GATEWAY_HOME。
2. 单测如需手动重载模块，必须清理 `globalThis.__AG_GATEWAY_DB__` 并 `vi.resetModules()`。
3. 不写真实 `~/.gemini/antigravity/gateway/storage.sqlite`。
4. 不写真实 workspace `.department/memory`。
5. 不启动 dev/start/watch 服务。
6. 不依赖真实 scheduler loop。

本轮新增 store/API tests 均应以临时 gateway home 或 mock store 运行。

## 8. Antigravity IDE 不可破坏路径

Company Kernel 不触碰：

1. Antigravity recent workspace scan。
2. Antigravity server discovery。
3. Language Server 二进制查找。
4. Language Server 进程启动。
5. Antigravity conversation/cascade attach/resume。
6. Provider selection / model selection。
7. Native Codex / Codex CLI / Third-party API 执行器启动逻辑。

Company Kernel 只记录 run 后验事实，不决定 provider 如何运行。

## 9. Phase 1-2 Owner Modules

| 模块 | Owner | 职责 |
| --- | --- | --- |
| `src/lib/company-kernel/contracts.ts` | Company Kernel | 类型契约 |
| `src/lib/company-kernel/run-capsule.ts` | Company Kernel | RunCapsule 构建 |
| `src/lib/company-kernel/run-capsule-store.ts` | Company Kernel | RunCapsule SQLite 持久化 |
| `src/lib/company-kernel/memory-candidate.ts` | Company Kernel | 候选生成与评分 |
| `src/lib/company-kernel/memory-candidate-store.ts` | Company Kernel | Candidate SQLite 持久化 |
| `src/lib/company-kernel/memory-promotion.ts` | Company Kernel | 晋升/拒绝 |
| `src/lib/storage/gateway-db.ts` | Storage | schema 表创建 |
| `src/lib/knowledge/contracts.ts` | Knowledge | evidence/promotion optional metadata |
| `src/lib/knowledge/index.ts` | Knowledge | 兼容入口改走候选 |
| `src/app/api/company/*` | API | 新增 capsule/candidate/promotion API |

## 10. 冻结规则

从本审计开始，Phase 1-2 期间禁止：

1. 新增 run 完成后直接 append `.department/memory`。
2. 新增 run 完成后直接创建 active knowledge。
3. 新增启动时全库回填。
4. 新增高频扫描 worker。
5. 新增测试写真实用户库。

