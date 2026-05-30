# 三代「自我改进」系统并存 — 深度解析与单一架构收敛

- **日期**：2026-05-30
- **目标**：深挖 evolution / growth / system-improvement 三套并存的问题，**只保留单一架构**
- **取证**：源码 + `storage.sqlite` 行数 + `scheduled_jobs` 实查

---

## 一、为什么会有三套？—— 同一概念的三代演进，旧代未删

「系统观察自身 → 生成改进提案 → 评估 → 发布」这一个概念，被实现了三次，每次另起炉灶、旧的不删：

| 维度 | **evolution**（第一代） | **growth**（第二代） | **system-improvement**（第三代 / 现行） |
|---|---|---|---|
| lib 代码 | `src/lib/evolution/` 6 文件 1107 行 | `company-kernel/growth-{proposal,observation}-store.ts` | `company-kernel/self-improvement-*.ts` **10 模块** |
| API 路由 | `/api/evolution/proposals/*` 6 条 | `/api/company/growth/*` 9 条 | `/api/company/self-improvement/*` 4 条 |
| 数据表 | `evolution_proposals` = **0 行** | `growth_proposals`=9 / `growth_observations`=**0** | `system_improvement_signals`=**39** / `proposals`=0 |
| 调度 / 编排接线 | **无**（只有 UI→API→store） | company-loop 调用，但**已退休空跑** | 定时任务喂养 + run 失败 observer + CEO 事件消费 |
| UI 表面 | `evolution-workspace.tsx` + **主导航 section** + ceo-dashboard 卡片 | settings / ops / cockpit 里零散引用 | 专属 `system-improvement-detail-drawer.tsx` + 7 个组件深度集成 |
| 现状判定 | **废弃**：有界面无数据，仅手动 API 能生成 | **退休**：`company-loop-executor` 里 `growth-pipeline-retired` | **现行主线** |

**证据**：
- `company-loop-executor.ts` 旧版 `maybeGenerateGrowthProposals()` 直接返回 `skippedReason: 'growth-pipeline-retired'`，且每次 loop 还往 `skipped` 塞一条噪声。
- evolution 全库无任何 lib/scheduler 调用，只被自己的 6 个 API 路由引用 → 最孤立。
- system-improvement 被 `api.ts` / `decision-control` / `platform-engineering` / `run-registry` / `ceo-office-improvement-pool` / `story-top-candidate-signals` 等广泛引用 → 主线无疑。

---

## 二、「现在的提升」走的是哪条定时任务？

**结论：你现在活着的"提升"就是 system-improvement，由定时任务喂养——确认你的记忆正确。**

数据流：

```
定时任务「Platform Engineering Story Top 3 · 09:00」
  (action.kind = dispatch-prompt, cron `0 9 * * *`, 时区 Europe/Rome)
      │  产出 story 候选
      ▼
story-top-candidate-signals.ts  →  system_improvement_signals (39 条)
      ▼
self-improvement-planner / observer  →  提案 → 评估 → release-gate
```

补充触发源（非定时）：`platform-engineering-observer.observeRunFailureForPlatformEngineering`（run 失败时）、`ensureCEOEventConsumer`（CEO 事件，dev 下 companion 关闭）。

**注意**：
- **Company Daily/Weekly Loop**（`company-loop` 类任务）虽然在跑，但它的"改进产出"接的是**已退休的 growth**，等于**不产出任何提升**。
- 那个 story-top 任务的时区 `Europe/Rome` 是 `detectLocalTimeZone()` 自动取的本机时区（本机就是 Rome），cron 仍是默认 `0 9 * * *` —— **没有发现手动改 cron 的痕迹**。若你记得"上次调整过一次"，更可能是改了 company-loop 的 review 时间（`company-loop-policy` 默认 `dailyReviewHour: 20`）或启停了某个任务，可再确认。

---

## 三、决断：只保留 system-improvement

| | 处置 | 理由 |
|---|---|---|
| **system-improvement** | ✅ **保留为唯一架构** | 现行主线、定时任务喂养、深度集成、有数据 |
| **growth** | ❌ 下线 | 已退休空跑，company-loop 里是纯噪声 |
| **evolution** | ❌ 下线 | 废弃功能，0 数据，无编排接线，仅残留界面 |

---

## 四、落地路线（按风险分层）

- ✅ **已完成 · Slice 1**（已验证 lint + 5 测试绿）：从 `company-loop-executor.ts` 活路径摘除 `maybeGenerateGrowthProposals` 及其 `growth-pipeline-retired` 噪声项。

- **Slice 2 · 纯后端死代码（低风险）**
  - 解耦 company-loop 结果/`company-loop-digest.ts` 对 `GrowthProposal` 类型的依赖（去掉 `RunCompanyLoopResult.generatedProposals` 残留类型）。
  - 移除 `company-loop-policy` 的 `growthReviewEnabled` 字段。

- **Slice 3 · growth 整体下线**
  - 删 `growth-proposal-store.ts` / `growth-observation-store.ts`、`/api/company/growth/*`、`contracts` 中 `GrowthProposal` 相关类型。
  - 清理 `settings-panel` / `ops-dashboard` / `ceo-office-cockpit` 中 growth 引用。

- **Slice 4 · evolution 整体下线（含 UI / 产品决策）**
  - 删 `src/lib/evolution/`、`/api/evolution/*`、`evolution-workspace.tsx`、ceo-dashboard 卡片。
  - 移除主导航 `evolution` section（`app-url-state.ts` 的 `VALID_SECTIONS`、`sidebar.tsx`、`page.tsx` 分支）—— **此步会移除一个可见的「进化」入口，需确认。**

- **Slice 5 · 数据表清理（destructive，单独确认）**
  - `evolution_proposals`(0) / `growth_observations`(0) 可直接 drop；`growth_proposals`(9 行) 建议先归档再 drop。

---

## 进度日志

- 2026-05-30：Slice 1 完成并验证（company-loop 去 growth 噪声）。后续 Slice 2–5 待续。
