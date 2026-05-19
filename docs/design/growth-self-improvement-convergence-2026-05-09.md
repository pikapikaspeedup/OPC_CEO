# Growth To Self-Improvement Convergence（2026-05-09）

目标：明确 `growth-*` 与 `self-improvement-*` 的边界，避免两条 proposal 主线继续漂移。

> **2026-05-10 复核补充**：`self-improvement-*` 只代表软件进化主线，不能覆盖业务能力进化。业务能力进化由 `src/lib/evolution/*` 与 `/api/evolution/proposals/*` 承载；旧 `growth-*` 中的 Phase 5 Crystallizer 能力已迁入 `evolution/*`，不应被解释为“由 self-improvement 替代”。详见 `docs/design/business-evolution-growth-impact-check-2026-05-10.md`。

## 决议

- `self-improvement-*` 是唯一的软件自迭代主线。
- `evolution/*` 是业务能力进化主线，覆盖 SOP / workflow / skill / script / rule proposal。
- `growth-*` 进入兼容保留阶段，只为以下场景继续存在：
  - 历史 API URL 与历史数据兼容
  - 历史 growth proposal 数据查询
- 新增自动化、调度链路、CEO 决策入口，不再以 `growth proposal` 作为首选建模。

## 当前边界

- `self-improvement-*`
  - 负责 signal、risk、approval、runtime-state、release-gate、codex execution 等完整闭环。
  - CEO 决策和系统改进执行都应优先走这条链。
- `growth-*`
  - 仅保留为 legacy proposal 只读兼容层。
  - 允许读取历史 proposal / observation，但不再生成、评估、审批、dry-run、发布新的 growth proposal。
- `evolution/*`
  - 负责业务 SOP、workflow、skill、rule、script 的生成、评估、审批发布和 rollout observe。
  - 输入来源包括 `MemoryCandidate`、`KnowledgeAsset`、RunCapsule 聚类和 repeated prompt runs。

## 本轮落地

- 已删除 `crystallizer.ts`、`growth-approval.ts`、`growth-script-dry-run.ts` 这些不再有主链 caller 的 growth 自动化旧代码。
- [src/lib/company-kernel/company-loop-executor.ts](/Users/darrel/Documents/Antigravity-Mobility-CLI/src/lib/company-kernel/company-loop-executor.ts) 不再自动生成 growth proposal。
- `POST /api/company/growth/proposals/generate|:id/evaluate|approve|reject|dry-run|publish` 与 `POST /api/company/growth/observations` 现在统一返回 `410 Gone`，明确 growth 写路径已经退役。
- Web UI 不再暴露 growth proposal 的生成 / 评估 / 发布入口；`knowledge-panel`、`ceo-office-cockpit`、`page` 已只保留 read-only / navigation 语义。
- 旧 Crystallizer 的 RunCapsule / MemoryCandidate / rule / script / SOP 生成和发布能力已迁入 `src/lib/evolution/generator.ts` 与 `src/lib/evolution/publisher.ts`。
- [docs/project/architecture-review-2026-05-09-followup.md](/Users/darrel/Documents/Antigravity-Mobility-CLI/docs/project/architecture-review-2026-05-09-followup.md) 已把该问题标为“已确认，短期开始收口”。

## 后续迁移顺序

1. 保持 `GET /api/company/growth/proposals*` 与 `GET /api/company/growth/observations` 可用，但只作为历史查询接口。
2. 新的软件自身改进统一走 `self-improvement-*`；新的业务能力进化统一走 `evolution/*`。
3. 等历史数据窗口结束后，再评估 growth store 和只读查询 API 的 sunset。
