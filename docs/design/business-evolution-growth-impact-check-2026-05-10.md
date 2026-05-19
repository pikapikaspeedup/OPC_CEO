# Business Evolution / Growth Impact Check（2026-05-10）

## 背景

本轮复核用于确认退役 `growth-*` 写链路是否误伤“业务自动进化”能力。

结论：业务自动进化不等于 `self-improvement-*`。当前仓库存在两类进化：

1. 软件进化：`self-improvement-*`，负责主软件代码改造、Codex execution、release gate、runtime state。
2. 业务能力进化：`evolution/*`，负责 Workflow、Skill、SOP、Rule、Script、Memory、Knowledge 和部门业务产物质量改进。

`growth-*` 曾承载 Phase 5 Crystallizer 的部分业务能力进化实现，但现在只保留历史 GET / POST 410 兼容层。

## 当前处理结果

旧 Crystallizer 的关键能力已迁入 `src/lib/evolution/*`：

1. `EvolutionProposal.kind` 已覆盖 `sop / workflow / skill / script / rule`。
2. `generateEvolutionProposals()` 可从 `MemoryCandidate`、`KnowledgeAsset`、RunCapsule 聚类和 repeated prompt runs 生成 proposal。
3. `publishEvolutionProposal()` 可发布到 canonical workflow、canonical skill、canonical rule、workflow script，或把 SOP 发布成 active `KnowledgeAsset(pattern)`。
4. `/api/evolution/proposals/*` 继续承载 evaluate / publish approval / approval callback publish / observe。
5. `/api/company/growth/*` 不恢复为主线；GET 读取历史数据，POST 统一 `410 Gone`。

本轮验证：

```bash
npx tsc --noEmit --pretty false
```

```bash
npx vitest run src/lib/evolution/__tests__/generator.test.ts src/lib/evolution/__tests__/evaluator.test.ts src/lib/evolution/__tests__/publisher.test.ts src/app/api/evolution/proposals/route.test.ts src/app/api/evolution/proposals/generate/route.test.ts 'src/app/api/evolution/proposals/[id]/publish/route.test.ts' src/lib/company-kernel/memory-promotion.test.ts
```

结果：7 个测试文件、15 个测试通过。

```bash
npx eslint src/lib/evolution/contracts.ts src/lib/evolution/generator.ts src/lib/evolution/publisher.ts src/lib/evolution/__tests__/generator.test.ts src/lib/evolution/__tests__/publisher.test.ts src/app/api/evolution/proposals/route.ts src/lib/types.ts src/lib/api.ts
```

## 业务自进化标准流程

1. 部门工作完成后，Company Kernel 生成或更新 `RunCapsule`，并沉淀 `MemoryCandidate`。
2. 候选记忆经人工或策略晋升后成为 `KnowledgeAsset`；稳定的 `pattern/lesson` 也可作为 SOP 来源。
3. `POST /api/evolution/proposals/generate` 从 `MemoryCandidate`、`KnowledgeAsset`、RunCapsule 聚类和 repeated prompt runs 生成业务能力 proposal。
4. `POST /api/evolution/proposals/:id/evaluate` 用历史 runs 对 proposal 做样本匹配和成功率评估。
5. `POST /api/evolution/proposals/:id/publish` 创建 `proposal_publish` 审批。
6. 审批通过后，approval callback 调用 `publishEvolutionProposal()` 写入对应业务资产。
7. workflow/skill 发布后参与后续 Prompt Mode 解析；SOP 进入知识库召回；rule/script 进入 canonical asset / workflow script 体系。

## 保留与删除边界

保留：

1. `src/lib/evolution/*`：业务能力进化主线。
2. `/api/evolution/proposals/*`：业务能力进化 API。
3. `growth-proposal-store.ts` / `growth-observation-store.ts`：历史只读查询。
4. `/api/company/growth/*`：历史 GET / POST 410 兼容。

删除或保持退役：

1. 旧 `crystallizer.ts`、`growth-approval.ts`、`growth-script-dry-run.ts`、`growth-evaluator.ts`、`growth-observer.ts`、`growth-publisher.ts` 不恢复。
2. Company Loop、CEO 决策、UI 写入口和 approval callback 不再推进 `GrowthProposal`。
3. 新的业务能力提案不再使用 `growth-*` 命名。

## 当前风险

业务能力进化主线已恢复到 `evolution/*`，不再依赖已退役的 `growth-*` 写流。

剩余风险是产品体验层面：如果需要在 UI 上重新暴露“从候选记忆/RunCapsule 生成 EvolutionProposal”的显式入口，需要单独做前端交互收口；本轮只完成底层业务能力和 API 主线迁移。
