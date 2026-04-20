# 云端 API Provider 控制面补齐（2026-04-19）

## 背景

上一批改完后，云端 API provider 已经具备：

- conversation shell
- provider-neutral diagnose
- models fallback

但仍残留两类明显断层：

1. `/api/conversations/[id]/cancel|proceed|revert|revert-preview|files` 仍默认偏 gRPC / IDE
2. credits / analytics / settings 文案层虽然开始 provider-aware，但还需要把控制面口径一并同步

## 本次改动

### 1. provider-neutral conversation control plane

修改：

- `src/app/api/conversations/[id]/cancel/route.ts`
- `src/app/api/conversations/[id]/proceed/route.ts`
- `src/app/api/conversations/[id]/revert/route.ts`
- `src/app/api/conversations/[id]/revert-preview/route.ts`
- `src/app/api/conversations/[id]/files/route.ts`
- `src/lib/local-provider-conversations.ts`
- `src/lib/api-provider-conversations.ts`
- `src/app/page.tsx`

#### 收口内容

- `cancel`
  - 本地 provider conversation 不再回落到 `No server available`
  - 对 API-backed local conversation：
    - 若有活动请求，尝试通过 `AbortController` 中断
    - 否则返回 `status = not_running`

- `proceed`
  - 对本地 provider conversation 明确返回：
    - `status = not_applicable`
  - 不再伪装成必须经过 gRPC 的 Antigravity 专属能力

- `revert-preview`
  - 本地 provider conversation 直接对 transcript 做 preview

- `revert`
  - 文件型本地 transcript（`codex/native-codex`）直接截断
  - API-backed transcript store（`claude-api/openai-api/gemini-api/grok-api/custom`）也能截断

- `files`
  - 不再只依赖 `getOwnerConnection()`
  - 优先从：
    - conversation record
    - backing run
    - gRPC owner
  - 解析 workspace

- 前端：
  - 本地 provider conversation 现在重新允许 inline revert

### 2. provider-aware 壳层同步

修改：

- `docs/guide/gateway-api.md`
- `docs/guide/cli-api-reference.md`

同步内容：

- conversation shell 不再只写 `codex/native-codex`
- `cancel/revert/revert-preview/files` 的本地 provider 语义已写清
- `prompt-mode evaluate` 支持已同步到 CLI/API 文档

## 验证

### lint

通过：

```bash
npx eslint 'src/app/api/conversations/[id]/cancel/route.ts' 'src/app/api/conversations/[id]/proceed/route.ts' 'src/app/api/conversations/[id]/revert/route.ts' 'src/app/api/conversations/[id]/revert-preview/route.ts' 'src/app/api/conversations/[id]/files/route.ts' src/lib/local-provider-conversations.ts src/lib/api-provider-conversations.ts src/lib/providers/native-codex-executor.ts
```

### API smoke

使用真实本地 provider conversation 验证：

- `POST /api/conversations`
  - `200`
  - 返回 `local-native-codex-*`
- `POST /api/conversations/<id>/send`
  - `200`
- `GET /api/conversations/<id>/revert-preview?stepIndex=0`
  - `200`
- `POST /api/conversations/<id>/revert`
  - `200`
- `GET /api/conversations/<id>/steps`
  - `200`
  - 截断后 `stepCount = 1`
- `GET /api/conversations/<id>/files?q=PROJECT_PROGRESS`
  - `200`
- `POST /api/conversations/<id>/cancel`
  - `200`
  - 返回 `status = not_running`

实际样例：

```json
{
  "previewStatus": 200,
  "revertStatus": 200,
  "stepsStatus": 200,
  "filesStatus": 200,
  "cancelStatus": 200
}
```

## 结论

这批之后，云端 API provider 至少已经不再在 conversation control plane 上出现最典型的：

- `No server available`
- 503 / gRPC-only 路径回退

当前仍未做满分的部分：

- 本地 provider conversation 的“真正进行中取消”
  - `native-codex` 仍没有完整 AbortController 链
- `proceed` 对本地 provider 仍是 `not_applicable`
  - 因为当前本地 provider transcript 不产生 Antigravity 风格 artifact approval gate

但控制面现在已经变成：

- **行为自洽**
- **语义明确**
- **不再误导成必须依赖 IDE**
