# 设计文档：Group Elimination 终态说明

> **版本**: v2.1（终态清扫版）
> **日期**: 2026-04-06  
> **状态**: 已实现终态；旧 run/project fallback 已移除

---

## 1. 摘要

Group Elimination 已经从“审核中的迁移计划”进入“已落地主链路”的阶段。

当前仓库的实际架构已经完成以下核心转向：

1. **对外语义统一为 `templateId + stageId`**
2. **模板持久化统一为 inline-only**
3. **运行时不再依赖全局 `group-registry` / `loadAllGroups()`**
4. **AI 生成 Pipeline、CEO 模板摘要、确认保存链路都已切到 stage-centric**

因此，这份文档不再讨论“要不要做”，而是准确描述：

- 已经完成了什么
- 当前只保留哪些模板加载期兼容
- 迁移边界和不可恢复项是什么

---

## 2. 当前真实状态

### 2.1 已完成的结构性变更

以下能力已经在代码中落地：

| 范围 | 当前状态 | 关键文件 |
|:-----|:---------|:---------|
| 模板加载 | 已改为 normalize 后读取 inline stage/node config | `src/lib/agents/pipeline/template-normalizer.ts` |
| Stage 解析 | 已统一基于 `templateId + stageId` | `src/lib/agents/stage-resolver.ts` |
| 运行时派发 | 已以 `stageId` 为主语义 | `src/lib/agents/dispatch-service.ts` |
| Runtime 执行 | 已消费 resolved stage config | `src/lib/agents/group-runtime.ts` |
| 公开 Run API | 已改为 `stageId` 请求/过滤 | `src/app/api/agent-runs/route.ts` |
| Scheduler UI | 已去掉 `dispatch-group` 公开入口 | `src/components/scheduler-panel.tsx` |
| 模板资产 | repo templates 已迁移为 inline-only persisted templates | `.agents/assets/templates/*.json` |
| AI 生成链路 | 已直接生成/保存 inline stage/node config | `src/lib/agents/generation-context.ts`、`src/lib/agents/pipeline-generator.ts`、`src/app/api/pipelines/generate/[draftId]/confirm/route.ts` |

### 2.2 已移除的旧抽象

以下旧抽象已经不再是主链路的一部分：

- 全局 `group-registry.ts`
- `AssetLoader.loadAllGroups()` 展平机制
- public `/api/agent-groups` 路由
- scheduler `dispatch-group` 作为对外能力
- persisted template `groups{}` 作为标准保存格式

### 2.3 当前兼容边界

当前只保留**模板加载期**兼容层：

- 若旧模板仍带 `groupId` / `groups{}`，加载时会被 normalize 到 stage-centric schema

旧运行态 fallback 已经移除：

- persisted run 如果没有 `stageId` / `pipelineStageId`，启动时直接跳过
- persisted project 如果 `pipelineState.stages[*]` 缺少 `stageId`，启动时直接跳过
- runtime / project state / provider metadata 不再读取或回填 `groupId`

这意味着：

> **旧模板仍可迁移读取，但 pre-migration run/project 状态不再保证可见、可恢复或可继续执行。**

---

## 3. 终态架构

### 3.1 模板数据模型

终态模板只保留两种主结构之一：

```json
{
  "pipeline": [
    {
      "stageId": "product-spec",
      "title": "产品规格",
      "executionMode": "review-loop",
      "roles": [],
      "sourceContract": {
        "acceptedSourceStageIds": []
      }
    }
  ]
}
```

或：

```json
{
  "graphPipeline": {
    "nodes": [
      {
        "id": "planning",
        "kind": "stage",
        "title": "规划",
        "executionMode": "review-loop",
        "roles": []
      }
    ],
    "edges": []
  }
}
```

关键原则：

- **不再持久化 `groups{}`**
- **stage / node 自带执行配置**
- **source contract 以 `acceptedSourceStageIds` 为准**

### 3.2 运行时模型

运行时只消费 normalize 后的 resolved stage config：

```text
raw template
  → normalizeTemplateDefinition()
  → resolveStageDefinition(templateId, stageId)
  → dispatch/runtime consume resolved config
```

这保证了：

- 旧模板仍可读
- 新模板只有一种标准形态
- runtime 不需要知道 template 以前是否有 `groups{}`

### 3.3 Public API 模型

对外编排统一为：

```text
templateId + stageId
```

适用范围：

- `POST /api/agent-runs`
- `GET /api/agent-runs?stageId=...`
- MCP dispatch tool
- scheduler `dispatch-pipeline`
- CEO suggestions / confirm / dispatch

没有 `stageId` 时，仅允许入口 stage。

---

## 4. AI 生成与 CEO 路径

### 4.1 自动生成 Pipeline

自动生成链路已经不再围绕 `available groups` 或 `groupId` 工作，而是直接生成 inline stage/node config：

- `generation-context.ts` 提供 workflows、execution modes、node kinds
- `pipeline-generator.ts` 要求输出 `executionMode`、`roles`
- `risk-assessor.ts` 校验缺失执行配置、缺失角色、无效 `acceptedSourceStageIds`
- confirm route 直接保存 inline-only template

### 4.2 CEO 入口

CEO 相关路径已经同步改造：

- 模板摘要基于 stage/node title + stageId
- 生成模板后直接走 confirm draft 保存
- 建议派发 payload 使用 `templateId + stageId`

因此：

> “自动生成 Pipeline” 和 “CEO 驱动的流水线生成/选择/派发” 都已经进入 stage-centric 语义。

---

## 5. 剩余收尾项

当前不再是架构性阻塞，而是**语义清扫与体验收尾**：

### 5.1 前端命名收尾

仍需持续清理：

- `TemplateGroup*` 旧类型别名
- UI 上残留的 Group / Profile 文案
- 少量 `groupId` fallback 字段在 FE projection 中的存在感

### 5.2 文档历史示例清扫

主说明文档已经改到 stage-centric，但历史大文档中仍可能残留：

- `groupId` 示例 JSON
- “Agent Groups” 章节标题
- `dispatch-group` 或 `/api/agent-groups` 的旧表述

### 5.3 剩余内部 alias

当前剩余 alias 只存在于**模板兼容与少量编辑器/编译器输入类型**，用于把旧模板映射到新 schema：

- 模板输入结构中的 `groupId`
- `acceptedSourceGroupIds` 到 `acceptedSourceStageIds` 的 normalize
- 少量前端模板类型里的 deprecated alias

这些 alias 不再参与 persisted run/project 恢复。

---

## 6. 迁移策略结论

本次终态迁移的实际落地策略可以总结为：

1. **先杀掉全局 registry**
2. **再统一 normalize + resolver**
3. **随后切 public API 到 `stageId`**
4. **同步切 AI 生成与模板资产**
5. **最后移除 run/project fallback，仅保留模板 normalize alias**

这条路线已经证明可行，也解释了为什么当前仓库会呈现“外部与运行态已完成、模板加载期保留少量 alias”的状态。

---

## 7. 验证依据

本轮终态迁移的验证基线：

- `npm run build`
- `npx tsx scripts/migrate-inline-templates.ts --check`
- `npx vitest run src/lib/agents/pipeline/dag-runtime.test.ts src/lib/agents/pipeline/graph-compiler.test.ts src/lib/agents/pipeline-generator.test.ts 'src/app/api/pipelines/[id]/route.test.ts' 'src/app/api/pipelines/generate/[draftId]/confirm/route.test.ts' src/lib/agents/project-diagnostics.test.ts src/lib/agents/project-reconciler.test.ts src/lib/agents/scheduler.test.ts`

结果：

- 模板迁移稳定
- 构建通过
- 相关测试全部通过

---

## 8. 结论

Group Elimination 已经完成主迁移，不再是待设计事项。

当前最准确的判断是：

- **架构迁移已完成**
- **公共接口迁移已完成**
- **AI 生成链路迁移已完成**
- **文档与前端语义清扫正在收尾**

后续不应再把这项工作描述为“计划中”，而应描述为：

> **Stage-Centric / Inline-Only 架构已经生效，后续仅做兼容层与历史术语清扫。**
