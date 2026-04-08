# PromptExecutor 最小接口草案

日期：2026-04-08  
状态：持续讨论稿 / 已入库  
范围：Prompt Mode 的最小 API、Run 字段、兼容策略、调度入口

## 一页结论

如果 Antigravity 要正式支持 Prompt Mode，最稳的最小落地方式不是新增一套平行系统，而是：

1. 保留 `Project`
2. 保留 `Run`
3. 新增 `PromptExecutor`
4. 让现有 `POST /api/agent-runs` 从 template-only 升级为 generic execution entry

也就是说：

> `agent-runs` 仍然是统一入口，只是它不再默认等于 template dispatch，而是根据 executionTarget 分流到 TemplateExecutor 或 PromptExecutor。

---

## 1. 目标

这份草案只解决最小问题：

1. Prompt Mode 如何进入现有运行时
2. Prompt Mode 如何复用 Run
3. Prompt Mode 如何兼容当前 template-first API

这份草案不处理：

1. UI 最终长什么样
2. PromptExecutor 内部具体调用多少 playbook / skill
3. Future execution flow 的设计

---

## 2. 当前约束

今天的 `POST /api/agent-runs` 本质还是 template-first：

1. 请求体直接传 `templateId`
2. route 直接调用 `executeDispatch()`
3. 没有 `templateId` 就无法进入真实执行主链

因此，如果要支持 Prompt Mode，最小接口设计必须解决两件事：

1. 让 route 能识别 `prompt` 类型执行目标
2. 在不破坏旧调用方的前提下保留现有 template 兼容入口

---

## 3. 最小概念模型

### 3.1 ExecutionTarget

建议最小定义：

```ts
type ExecutionTarget =
  | { kind: 'template'; templateId: string; stageId?: string }
  | { kind: 'prompt'; promptAssetRefs?: string[]; skillHints?: string[] }
  | { kind: 'project-only' };
```

说明：

1. `template` 用于固定编排
2. `prompt` 用于 Prompt Mode
3. `project-only` 用于只创建项目、不自动执行

### 3.2 ExecutorKind

建议在 Run 上补一个非常薄的字段：

```ts
type ExecutorKind = 'template' | 'prompt';
```

它的作用只是帮助：

1. 查询
2. UI 分流
3. 审计事件分类
4. 结果展示分流

### 3.3 TriggerContext

建议补一层触发上下文，避免 scheduler / CEO / MCP 的信息继续散落在私有字段里：

```ts
interface TriggerContext {
  source?: 'ceo-command' | 'ceo-workflow' | 'scheduler' | 'mcp' | 'web' | 'api';
  schedulerJobId?: string;
  intentSummary?: string;
}
```

---

## 4. PromptExecutor 最小请求体

### 4.1 建议的统一请求体

建议未来的 `POST /api/agent-runs` 接收如下形态：

```ts
interface CreateRunRequest {
  workspace: string;
  projectId?: string;
  prompt?: string;
  model?: string;
  parentConversationId?: string;
  conversationMode?: 'shared' | 'isolated';
  taskEnvelope?: Record<string, unknown>;
  sourceRunIds?: string[];
  executionTarget?: ExecutionTarget;
  triggerContext?: TriggerContext;

  // legacy compatibility
  templateId?: string;
  stageId?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  pipelineStageIndex?: number;
  templateOverrides?: Record<string, unknown>;
}
```

### 4.2 Prompt Mode 请求示例

```json
{
  "workspace": "file:///Users/.../ai-news",
  "projectId": "<projectId>",
  "prompt": "整理今天 AI 资讯部门需要跟进的 5 条重点信号，并根据需要调用相关 playbook 与 skill",
  "model": "MODEL_PLACEHOLDER_M37",
  "conversationMode": "shared",
  "executionTarget": {
    "kind": "prompt",
    "promptAssetRefs": ["daily-digest-playbook", "news-triage-playbook"],
    "skillHints": ["research", "summarization"]
  },
  "triggerContext": {
    "source": "ceo-command",
    "intentSummary": "让 AI 资讯部门今天整理重点情报"
  }
}
```

### 4.3 Template 兼容请求示例

旧请求体仍然允许：

```json
{
  "workspace": "file:///Users/.../backend",
  "projectId": "<projectId>",
  "prompt": "修复登录接口",
  "templateId": "coding-basic-template"
}
```

route 内部可以自动归一化成：

```json
{
  "executionTarget": {
    "kind": "template",
    "templateId": "coding-basic-template"
  }
}
```

---

## 5. Route 分流建议

### 5.1 当前最小 route 策略

建议 `POST /api/agent-runs` 按下面顺序分流：

1. 如果有 `executionTarget.kind = 'template'`，走 `executeDispatch()`
2. 如果有 `executionTarget.kind = 'prompt'`，走 `executePrompt()`
3. 如果没有 `executionTarget`，但传了 `templateId / pipelineId`，走 legacy template compatibility
4. 其他情况报 400

### 5.2 为什么不建议立刻新开 `/api/prompt-runs`

不建议一上来新开独立 route，原因很实际：

1. 运行态对象本来就还是 Run
2. 项目详情本来就按 run 聚合
3. 审计和 CEO 汇总未来也要按统一执行对象汇总
4. 先分两个 route，后面大概率还要再统一回来

所以更稳的最小方案是：

> 一个 run 入口，多种 executionTarget。

---

## 6. Run 最小字段变更建议

建议在 `AgentRunState` 上补最少的 3 个字段：

```ts
interface AgentRunState {
  executorKind?: 'template' | 'prompt';
  executionTarget?: ExecutionTarget;
  triggerContext?: TriggerContext;
}
```

说明：

1. `executorKind` 方便快速筛选和 UI 分流
2. `executionTarget` 记录这次执行到底是 template 还是 prompt
3. `triggerContext` 保留来自 CEO / scheduler / MCP 的业务上下文

当前已有的这些字段仍然保留：

1. `projectId`
2. `prompt`
3. `parentConversationId`
4. `sourceRunIds`
5. `artifactDir`
6. `status`

只有与 template 强绑定的字段不应在 Prompt Mode 强行伪造：

1. `templateId`
2. `pipelineStageId`
3. `pipelineStageIndex`

---

## 7. Envelope 与结果文件最小变更建议

Prompt Mode 最大的坑之一，是现在很多结果类型默认 templateId 必然存在。

最小建议是：

1. `TaskEnvelope` 增加 `executionTarget`
2. `ResultEnvelope` 增加 `executionTarget`
3. `ArtifactManifest` 增加 `executionTarget`
4. `templateId` 改为可选或兼容字段

推荐方向：

```ts
interface ResultEnvelope {
  runId: string;
  status: string;
  executionTarget?: ExecutionTarget;
  templateId?: string;
  summary: string;
  outputArtifacts: ArtifactRef[];
}
```

原则是：

> Prompt Mode 不应为了兼容旧展示链路而伪造 templateId。

---

## 8. Scheduler 与 CEO 的最小接入方式

### 8.1 CEO

CEO 层在创建执行时，应该先决定：

1. project-only
2. template
3. prompt

如果是 Prompt Mode，则只需把：

1. 业务 prompt
2. promptAssetRefs
3. skillHints
4. triggerContext

组装好后交给统一 run 入口。

### 8.2 Scheduler

Scheduler 若未来支持 Prompt Mode，我建议新增独立 action，而不是复用 `dispatch-pipeline`：

```ts
{ kind: 'dispatch-prompt'; workspace: string; prompt: string; promptAssetRefs?: string[]; skillHints?: string[]; projectId?: string; model?: string }
```

这样可以保持 scheduler action 语义清晰：

1. `dispatch-pipeline` = 固定模板编排
2. `dispatch-prompt` = Prompt Mode 执行
3. `create-project` = 只创建项目

---

## 9. 前端 API 最小补充建议

在 [src/lib/api.ts](../../src/lib/api.ts) 这一层，我建议不要直接替换旧接口，而是新增一个轻包装：

```ts
createPromptRun: (data: {
  workspace: string;
  projectId?: string;
  prompt: string;
  model?: string;
  parentConversationId?: string;
  conversationMode?: 'shared' | 'isolated';
  promptAssetRefs?: string[];
  skillHints?: string[];
  triggerContext?: TriggerContext;
}) => POST /api/agent-runs
```

内部仍调用同一个 route，只是把 body 组装成 `executionTarget.kind = 'prompt'`。

这样：

1. 老的 `dispatchRun`/template 调用不动
2. 新的 Prompt Mode 调用也能明确表达意图

---

## 10. 当前最小落地顺序建议

如果后续真的要从设计走向实现，我建议按最小顺序推进：

1. 先补 `ExecutionTarget` / `executorKind` / `triggerContext` 类型
2. 再改 `POST /api/agent-runs` 支持 prompt 分流
3. 再补 `createPromptRun` 前端包装
4. 再补 scheduler 的 `dispatch-prompt` 设计
5. 最后再做 UI 展示分流

这个顺序能最大限度利用现有 run 框架，又不会太早陷入 UI 和 naming 细节。

---

## 11. 当前建议

如果只压缩成一句话，这份草案的核心建议是：

> PromptExecutor 的最小实现，不是新增另一套运行时，而是让 `agent-runs` 成为真正的统一执行入口，并通过 `executionTarget.kind = 'prompt'` 把 Prompt Mode 接到现有 Run 框架里。

这条路最稳，也最容易和今天已经成熟的 Project / Run / Artifact / Audit 体系接起来。