# AI Company 全特性实测结果（2026-04-19）

## 1. 测试范围

本次实测基于：

- `docs/research/ai-company-full-feature-test-plan-2026-04-19.md`

实际重点验证了：

1. `Codex Native` 真实执行
2. `Execution Profiles`
3. `Knowledge Loop`
4. `CEO / Approval / Management` 读侧联动
5. `Evolution Pipeline`

---

## 2. 测试环境

### 服务

- 本地地址：`http://127.0.0.1:3000`
- 测试时以独立 `AG_GATEWAY_HOME` 启动：
  - `/tmp/ai-company-e2e-gateway`

### Provider

- `native-codex`
- 登录态：
  - `~/.codex/auth.json` 存在
  - `loggedIn = true`

### 测试工作区

- `/tmp/ai-company-e2e`
- Department config:
  - `provider = native-codex`
  - `templateIds = ["coding-basic-template", "design-review-template"]`

### UI 证据

截图：

1. `/tmp/ai-company-e2e-evidence/ceo-dashboard.png`
2. `/tmp/ai-company-e2e-evidence/knowledge-console.png`

---

## 3. 结果总览

### 通过

1. `workflow-run` 在 `native-codex` 下真实完成
2. `dag-orchestration` 在 `native-codex` 下真实完成
3. scheduler 的 `dispatch-execution-profile` 可真实触发两类 run
4. `KnowledgeAsset` 自动提取成功
5. retrieval 真实命中，`usageCount` / `lastAccessedAt` 更新
6. approval -> CEO pending issue -> resolve 生命周期真实成立
7. `Evolution Pipeline` 全链路真实跑通：
   - generate
   - evaluate
   - publish approval
   - approval callback publish
   - observe

### 失败 / 风险

1. `review-flow` 在 `native-codex` 下真实失败
2. organization-level approval 数据是全局组织态
   - 本次隔离测试里看见历史审批数据，符合当前机制
   - 因此不能把它当作当前实现 bug

---

## 4. 关键实测结果

## 4.1 Workflow Run

### Run

- `runId`: `fb05de40-f4f8-4cf1-a046-c2b7a1412a23`
- `status`: `completed`
- `provider`: `native-codex`
- `resolvedWorkflowRef`: `/dev-worker`
- `executionProfileSummary`: `Workflow Run`

### 结论

`workflow-run` 在 `native-codex` 下可真实执行，不是只走到创建 run 为止。

---

## 4.2 Review Flow

### Run

- `runId`: `bf2b7b02-46db-4834-a91d-ea0930ca30d3`
- `templateId`: `design-review-template`
- `stageId`: `ux-review`
- `status`: `failed`
- `provider`: `native-codex`

### 实际失败点

author role 运行完成后，没有按模板要求产出 `specs/` 下的输出文件，最终被 runtime 判定失败。

关键错误：

- `Author role ux-review-author completed without producing output files in specs/.`

### 结论

`review-flow` 的 dispatch 链路现在已经成立，但在 `native-codex` 下并不稳定可用。  
更准确地说：

1. profile 已可派发
2. provider 能启动该模板 run
3. 但 `native-codex` 当前不足以稳定完成这类需要严格产物协议与文件写入的 review-loop

---

## 4.3 DAG Orchestration

### Run

- `runId`: `3cd8088f-230c-4ecf-9cb9-5b1c76ad34d0`
- `templateId`: `coding-basic-template`
- `stageId`: `coding-basic`
- `status`: `completed`
- `provider`: `native-codex`
- `executionProfileSummary`: `DAG Orchestration`

### 结论

`dag-orchestration` 的 template dispatch 语义在 `native-codex` 下可真实完成。

说明：

- 这里验证的是 `ExecutionProfile -> template dispatch` 这条链
- 不是复杂多阶段 fan-out DAG 的能力上限

---

## 4.4 Scheduler: Dispatch Execution Profile

### Job A

- `jobId`: `710691b2-92af-4985-a582-3a3d41525673`
- kind: `dispatch-execution-profile`
- profile: `workflow-run`
- triggered `runId`: `a2e5a8b8-48da-4fdc-98a8-224c095c4282`
- run `status`: `completed`

### Job B

- `jobId`: `6437445b-5884-4540-a450-9ba2a9332162`
- kind: `dispatch-execution-profile`
- profile: `dag-orchestration`
- triggered `runId`: `3cd5b4a3-767f-4925-af2e-27033530610c`
- run `status`: `completed`

### 结论

scheduler 按 `ExecutionProfile` 触发的主链已成立，而且能在 `native-codex` 下真实产出 run。

---

## 4.5 Knowledge Loop

### 第一次沉淀

来源 run：

- `fb05de40-f4f8-4cf1-a046-c2b7a1412a23`

新增知识：

1. `fb05de40-f4f8-4cf1-a046-c2b7a1412a23-decision-e29565e0fa`
2. `fb05de40-f4f8-4cf1-a046-c2b7a1412a23-pattern-f6a25d38d2`

### 第二次 retrieval 命中

来源 run：

- `5bdfa99f-aa27-45f2-919c-4c1ea0b61fa6`

命中后旧知识状态变化：

1. `usageCount` 从 `0` -> `1`
2. `lastAccessedAt` 更新到 `2026-04-19T20:20:18.xxxZ`

### 结论

`run -> knowledge extraction -> retrieval -> next run` 的最小闭环真实成立。

---

## 4.6 CEO / Approval / Pending Issue

### 手工审批验证

- `approvalId`: `9dd3d582-0f12-4ee4-971a-8b2b18a62ac0`

创建后：

- `CEOProfile.pendingIssues` 出现：
  - `approval:9dd3d582-0f12-4ee4-971a-8b2b18a62ac0`

批准后：

- `pendingIssues` 清空

### 结论

审批请求 -> CEO pending issue -> resolve 的生命周期当前已真实成立。

---

## 4.7 Management Overview

### Department Overview

查询：

- `GET /api/management/overview?workspace=file:///tmp/ai-company-e2e`

关键结果：

1. `recentKnowledge = 14`
2. `throughput30d = 9`
3. `workflowHitRate = 0.4`
4. `memoryReuseRate = 1`

### 组织级现象

查询：

- `GET /api/management/overview`

组织级 `pendingApprovals = 4`，但这些不是本次隔离实例自己生成的待审批。

### 结论

1. 部门级 management metrics 已能反映本次真实测试数据
2. 组织级 approval 数据当前是全局共享组织态，不能用隔离实例口径解读

---

## 4.8 Evolution Pipeline

### Repeated Runs

用于生成 proposal 的 3 条 repeated prompt runs：

1. `312ed014-deb1-4b7e-ac8d-4ee028725450`
2. `6c20e2ae-815b-449d-ba61-1e83e9a83421`
3. `d03712c1-5176-4e41-a6c0-615abb5a35fb`

都为：

- `status = completed`
- `provider = native-codex`
- `resolvedWorkflowRef = null`

### Proposal

- `proposalId`: `proposal-b993beb5-f09b-40fd-837d-71e7fabeaa57`
- `status`: `draft -> evaluated -> pending-approval -> published`

### Evaluation

- `sampleSize = 3`
- `matchedRunIds = 3 条`
- `successRate = 1`
- `recommendation = publish`

### Publish Approval

- `approvalId`: `9c0e5e28-19c7-4d49-9481-d49977c9dc56`
- approval 后 proposal 状态：
  - `published`

### Published Workflow

- 路径：
  - `/tmp/ai-company-e2e-gateway/assets/workflows/ai-company-e2e-new-workflow.md`

### Observe

发布后命中 run：

- `runId`: `c627c8c4-a92f-4e8e-89ad-3e8545a5adda`
- `resolvedWorkflowRef = /ai-company-e2e-new-workflow`
- `status = completed`

observe 刷新后：

1. `hitCount = 1`
2. `matchedRunIds = [c627c8c4-a92f-4e8e-89ad-3e8545a5adda]`
3. `successRate = 1`
4. `lastUsedAt` 已更新

### 结论

`Evolution Pipeline v1` 的最小闭环已经在真实数据上跑通。

---

## 5. 本次发现的新问题

## 问题 1：`review-flow` 在 `native-codex` 下不稳定可用

表现：

1. dispatch 成功
2. role 执行也启动了
3. 但无法稳定产出模板要求的 artifact 文件

影响：

- `review-flow` 目前不能宣称“在 Codex Native 下可用”

## 说明 2：approval store 当前是组织级全局状态

表现：

组织级 `pendingApprovals` 混入了当前实例外的旧审批数据。

原因：

- approval request store 按当前设计就是 organization-global
- 它使用共享的 `~/.gemini/antigravity/requests`

影响：

- 做隔离实测时，不能拿 organization-level approval 指标作为纯净实例证据
- 正确断言方式应该使用：
  - `approvalId`
  - `workspace` 过滤
  - `pendingIssues` 生命周期

---

## 6. 最终判断

### 已确认可用

1. `workflow-run` + `native-codex`
2. `dag-orchestration` + `native-codex`
3. scheduler `dispatch-execution-profile`
4. knowledge extraction / retrieval
5. approval -> pending issue -> resolve
6. evolution proposal -> evaluate -> approval -> publish -> observe

### 已确认存在问题

1. `review-flow` 在 `native-codex` 下失败

### 不应误判为 bug 的现象

1. organization-level approval 数据是全局共享组织态

### 总结

按“AI Company 当前已开发能力”的真实口径：

1. **Learning Plane 最小闭环成立**
2. **Execution Profiles 主链大体成立**
3. **Management / CEO 读侧已能看到真实数据**
4. **Evolution Pipeline 已能在真实数据上跑通**
5. **但 `review-flow + native-codex` 仍不能算通过**
