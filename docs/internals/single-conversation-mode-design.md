# 单对话 Multi-Agent 执行模式 — 设计文档

**Status**: Draft  
**Target**: AG V5.5+  
**核心收益**: Token 消耗降低 ~73%（串行 review-loop 场景）

---

## 1. 动机

当前 AG 的 review-loop（`executeReviewRound()`）每个 role 都通过 `createAndDispatchChild()` → `grpc.startCascade()` 创建**全新的子对话**。3 轮审查 × 2 role = 6 个独立子对话，每个子对话都需要重新注入：
- System prompt（~5K tokens）
- 代码库上下文（~20K tokens）
- 上游产物（~15K tokens）

**总计重复注入 ~240K tokens，其中 ~175K 是完全可以避免的。**

Claude Code 的 Team Agent 通过 `SendMessage` 在同一个对话中继续已有 worker，增量 token 仅 ~200。

## 2. 现有基础

`grpc.sendMessage()` 已支持向已有 cascadeId 发送后续消息：
```typescript
// src/lib/bridge/grpc.ts:220
export async function sendMessage(
  port, csrf, apiKey,
  cascadeId,  // ← 已有对话的 ID 
  text,       // ← 新的 prompt
  model?, agenticMode?, attachments?, artifactReviewMode?
)
```

**关键发现**：底层 gRPC 层已经支持，且 **`nudge` intervention 已经在生产中验证了这条路径**：

```typescript
// group-runtime.ts:734 — nudge 向已完成响应的 cascade 发送新消息
await grpc.sendMessage(server.port, server.csrf, apiKey, cascadeId, nudgePrompt, run.model);
// → watchUntilComplete() 正常监听后续 step event
({ steps, result } = await watchUntilComplete(
  runId, cascadeId, { port: server.port, csrf: server.csrf }, apiKey, roleDef, cascadeId,
));
```

前端 React 也是同样的模式：用户在聊天框中连续发送消息 → `POST /api/conversations/{id}/send` → 同一个 cascadeId。

**无需验证 gRPC 层行为——nudge 功能已经证明了。**

## 3. 方案设计

### 3.1 Template 配置

在 `pipeline-types.ts` 的 `PipelineStage` 增加可选字段：

```typescript
interface PipelineStage {
  // ... 现有字段
  
  /**
   * 对话复用策略。仅对串行（非 fan-out）stage 有效。
   * - "shared": 所有串行 role 共享同一个 conversation
   * - "isolated": 每个 role 独立 conversation（当前默认行为）
   * - "auto": 同轮 author 复用上轮 author 的 conversation，reviewer 始终独立
   */
  conversationMode?: 'shared' | 'isolated' | 'auto';
}
```

默认值 `'isolated'`，向后兼容。

### 3.2 核心改动：executeReviewRound()

当前代码（简化）：
```typescript
async function executeReviewRound(..., round, startRoleIndex) {
  for (let i = startRoleIndex; i < group.roles.length; i++) {
    const role = group.roles[i];
    const rolePrompt = buildRolePrompt(...);
    
    // 每次都新建子对话
    const cascadeId = await createAndDispatchChild(
      server, apiKey, wsUri, runId, input.groupId, role.id,
      rolePrompt, finalModel, input.parentConversationId,
    );
    
    const { steps, result } = await watchUntilComplete(...);
    // ...
  }
}
```

改造为：
```typescript
async function executeReviewRound(..., round, startRoleIndex, sharedState?: SharedConversationState) {
  const convMode = resolveConversationMode(group);
  
  for (let i = startRoleIndex; i < group.roles.length; i++) {
    const role = group.roles[i];
    const isReviewer = i === group.roles.length - 1 && group.reviewPolicyId !== undefined;
    
    // 决策：复用还是新建
    const shouldReuse = convMode === 'shared' 
      || (convMode === 'auto' && !isReviewer && sharedState?.authorCascadeId);
    
    let cascadeId: string;
    
    if (shouldReuse && sharedState?.authorCascadeId) {
      // 复用已有对话：发送角色切换 prompt
      cascadeId = sharedState.authorCascadeId;
      const switchPrompt = buildRoleSwitchPrompt(role, round, isReviewer, ...);
      await grpc.sendMessage(
        server.port, server.csrf, apiKey,
        cascadeId, switchPrompt, finalModel,
      );
    } else {
      // 新建子对话（现有逻辑）
      const rolePrompt = buildRolePrompt(...);
      cascadeId = await createAndDispatchChild(
        server, apiKey, wsUri, runId, input.groupId, role.id,
        rolePrompt, finalModel, input.parentConversationId,
      );
      
      // 记录用于后续复用
      if (!isReviewer) {
        sharedState = { ...sharedState, authorCascadeId: cascadeId };
      }
    }
    
    const { steps, result } = await watchUntilComplete(...);
    // ... 后续逻辑不变
  }
  
  return { ..., sharedState }; // 传给下一轮
}
```

### 3.3 角色切换 Prompt

新增 `buildRoleSwitchPrompt()` 函数：

```typescript
function buildRoleSwitchPrompt(
  role: RoleDefinition,
  round: number,
  isReviewer: boolean,
  artifactDir: string,
  previousRoundFeedback?: string,
): string {
  const boundary = `
═══════════════════════════════════════════════════════
ROLE SWITCH — Round ${round}
═══════════════════════════════════════════════════════

你现在的角色切换为: ${role.id}
${isReviewer ? '你是审查者。忽略之前作为 author 的所有偏好和思考过程。从全新视角审视代码。' : ''}

${role.workflow ? AssetLoader.resolveWorkflowContent(role.workflow) : ''}

${previousRoundFeedback ? `
## 上一轮审查反馈
${previousRoundFeedback}

请根据以上反馈修改你的产出。
` : ''}

产物目录: ${artifactDir}
`;
  return boundary;
}
```

### 3.4 SharedConversationState 类型

```typescript
interface SharedConversationState {
  /** 当前 author 使用的 cascadeId（跨轮次复用） */
  authorCascadeId?: string;
  /** 当前 reviewer 使用的 cascadeId（auto 模式下始终独立） */
  reviewerCascadeId?: string;
  /** 累计 token 估算（用于判断是否需要新建对话） */
  estimatedTokens?: number;
  /** token 超限后强制新建 */
  maxTokensBeforeReset?: number;
}
```

### 3.5 Auto-compact 安全阀

当单对话累计 token 超过阈值时，强制回退为 isolated 模式：

```typescript
const TOKEN_RESET_THRESHOLD = 100_000; // 可配置

if (sharedState?.estimatedTokens && sharedState.estimatedTokens > TOKEN_RESET_THRESHOLD) {
  log.info({ runId: shortRunId, tokens: sharedState.estimatedTokens }, 
    'Token threshold exceeded, falling back to isolated mode');
  sharedState = undefined; // 下一轮新建对话
}
```

## 4. 数据流

### 4.1 Shared 模式（最大 Token 节约）

```
startCascade() → cascadeId-1
  │
  ├─ Round 1, Author: sendMessage(cascadeId-1, authorPrompt)
  │   └─ watchUntilComplete() → 产出写入 artifactDir
  │
  ├─ Round 1, Reviewer: sendMessage(cascadeId-1, roleSwitchPrompt)
  │   └─ watchUntilComplete() → review 写入 review/
  │
  ├─ Round 2, Author: sendMessage(cascadeId-1, revisePrompt)
  │   └─ watchUntilComplete() → 修改后产物
  │
  ├─ Round 2, Reviewer: sendMessage(cascadeId-1, roleSwitchPrompt)
  │   └─ watchUntilComplete() → 最终 review
  │
  └─ decision: approved → 完成
```

### 4.2 Auto 模式（平衡 Token 节约与审查质量）

```
startCascade() → cascadeId-1 (author)
startCascade() → cascadeId-2 (reviewer)
  │
  ├─ Round 1, Author: 首次 prompt → cascadeId-1
  │
  ├─ Round 1, Reviewer: 首次 prompt → cascadeId-2 (独立视角)
  │
  ├─ Round 2, Author: sendMessage(cascadeId-1, revisePrompt) ← 复用
  │   (author 已有 R1 的完整推理链，直接基于 review 修改)
  │
  ├─ Round 2, Reviewer: sendMessage(cascadeId-2, re-reviewPrompt) ← 复用
  │   (reviewer 有 R1 审查的记忆，可以验证修改是否解决了问题)
  │
  └─ decision: approved → 完成
```

## 5. 影响分析

### 5.1 受影响文件

| 文件 | 改动类型 | 影响范围 |
|:-----|:--------|:---------|
| `src/lib/agents/group-runtime.ts` | **核心改动** | `executeReviewRound()`, `executeReviewLoop()` |
| `src/lib/agents/pipeline-types.ts` | 类型扩展 | 增加 `conversationMode` 字段 |
| `src/lib/agents/group-types.ts` | 类型扩展 | 增加 `SharedConversationState` |
| `src/lib/agents/watch-conversation.ts` | 可能适配 | 需确认 `sendMessage` 后的 stream 监听是否兼容 |
| `src/lib/agents/asset-loader.ts` | 无改动 | workflow 加载逻辑不变 |
| `src/lib/agents/review-engine.ts` | 无改动 | 决策逻辑不变 |
| `src/lib/agents/scope-governor.ts` | 无改动 | Scope audit 不变 |

### 5.2 不受影响

- **Scope Audit** — 仍然基于 delivery packet 审计，与对话创建方式无关
- **Typed Contracts** — 编译期校验，不涉及运行时对话
- **Checkpoint / Journal** — 基于 pipeline state，不依赖对话拓扑
- **Resource Quota** — 基于 runs/branches 计数，不涉及对话层
- **Review Engine** — 基于 AgentRunState 评估，不关心底层对话实现

### 5.3 已验证的假设 ✅

~~1. **`grpc.sendMessage()` 后 `streamAgentState()` 能否正确监听后续 step？**~~
   - ✅ **已通过 `nudge` intervention 验证**：`group-runtime.ts:734` 向已完成一轮响应的 cascade 发送新消息，`watchUntilComplete()` 正常监听后续 step。

~~2. **watchUntilComplete() 的 cascadeId 归属检查**~~
   - ✅ `isAuthoritativeConversation()` 检查 `run.activeConversationId === cascadeId`。shared 模式下 cascadeId 不变，归属检查天然通过。

### 5.4 仍需验证的假设

1. **角色切换 prompt 是否对 Gemini 有效？**
   - Gemini 的 system instruction 在对话创建时设定，中途无法更改
   - sendMessage 只能以 user 角色追加
   - **缓解**: 通过强分隔符 + 明确角色指令模拟角色切换
   - **风险**: 低——nudge 已经证明可以通过追加 prompt 改变 Agent 行为方向

## 6. 量化预期

### 3 轮审查 + 2 role（中等复杂度功能）

| 指标 | Isolated（当前） | Shared 模式 | Auto 模式 |
|:-----|:---------------|:-----------|:----------|
| 子对话数 | 6 | 1 | 2 |
| SP 注入 | 30K | 5K | 10K |
| 代码上下文注入 | 120K | 20K | 40K |
| 上游产物注入 | 90K | 15K | 30K |
| 历史积累成本 | 0 | 25K | 15K |
| **总 input tokens** | **~240K** | **~65K** | **~95K** |
| **节约率** | — | **~73%** | **~60%** |

### API 成本影响（假设 Gemini 1.5 Pro pricing）

| | Isolated | Shared | 月节约（100 次任务） |
|--|---------|--------|---------------------|
| Input token 费用 | $0.30/任务 | $0.08/任务 | **~$22** |

## 7. 实施策略

### Phase 1: 最小验证（1-2 天）
1. 在 `executeReviewRound()` 中增加 `conversationMode: 'shared'` 的分支
2. 使用 feature flag `AG_SHARED_CONVERSATION=true` 控制
3. 运行一个 2-round review-loop 任务验证：
   - `grpc.sendMessage()` 后 `watchUntilComplete()` 是否正常工作
   - 角色切换 prompt 是否有效
   - 产物是否正确写入

### Phase 2: Auto 模式 + Token 估算
1. 实现 `SharedConversationState` 跟踪
2. 实现 token 超限回退逻辑
3. 实现 `auto` 模式（author 复用、reviewer 独立）

### Phase 3: 产品化
1. 在 Template JSON 中暴露 `conversationMode` 配置
2. 在 UI 上展示对话复用状态
3. 在 Journal 中记录对话复用事件
4. 更新文档

## 8. 回滚策略

- `conversationMode` 默认 `'isolated'`，不影响现有行为
- Feature flag `AG_SHARED_CONVERSATION` 可随时关闭
- 任何运行时异常自动回退到 isolated 模式  

## 9. 与 CC 的设计对比

| 方面 | CC Worker Continue | AG Shared Conversation |
|:-----|:------------------|:----------------------|
| 触发方式 | Coordinator prompt 决定 | Template 配置 + 运行时决策 |
| 角色切换 | 无——同一 worker 不换角色 | 显式角色切换 prompt |
| Token 安全阀 | auto-compact 压缩历史 | token 超限回退 isolated |
| 决策权 | LLM 动态决定 | 代码/配置定义策略 |
| 审查独立性 | "spawn fresh" 建议 | `auto` 模式强制 reviewer 独立 |

**AG 的优势**：通过配置策略控制复用行为，而不是让 LLM 动态猜测。这符合 AG "显式编排" 的设计哲学。
