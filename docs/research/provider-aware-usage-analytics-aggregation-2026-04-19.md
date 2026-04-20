# Provider-aware Usage / Credits / Analytics 聚合（2026-04-19）

## 背景

在前一批完成：

- conversation shell
- diagnose / process viewer
- provider-aware models fallback

之后，用户明确要求继续优先收：

- **provider-aware usage / credits / analytics 聚合**

这次不再只做“提示文案”，而是要让：

- `/api/analytics`
- `/api/me`

真正输出按 provider 聚合的运行数据。

## 本次改动

### 1. 新增 provider 聚合 helper

新增：

- `src/lib/provider-usage-analytics.ts`

职责：

- 从 `run-registry` 读取最近 30 天 runs
- 按 provider 聚合：
  - `runCount`
  - `completedCount`
  - `activeCount`
  - `failedCount`
  - `blockedCount`
  - `cancelledCount`
  - `promptRunCount`
  - `tokenRuns`
  - `inputTokens`
  - `outputTokens`
  - `totalTokens`
  - `lastRunAt`
- 生成 `providerCredits` 摘要
  - `runtime`
  - `oauth`
  - `api-key`
  - `custom-profile`

### 2. `/api/analytics` provider-aware

修改：

- `src/app/api/analytics/route.ts`

现在：

- 若 Antigravity runtime analytics 可用：
  - 返回原 gRPC analytics
  - 同时合并 `providerUsage` / `providerUsageSummary`
- 若 Antigravity runtime analytics 不可用：
  - 仍返回 Gateway run 聚合
  - `dataSources.antigravityRuntime = false`
  - `dataSources.gatewayRuns = true`
  - `providerAwareNotice = Runtime analytics unavailable; showing Gateway run aggregation only.`

### 3. `/api/me` provider-aware

修改：

- `src/app/api/me/route.ts`

现在新增：

- `providerCredits`
- `providerUsageSummary`
- `creditSource`
- `providerAwareNotice`

其中：

- Antigravity credits 仍来自 language_server model configs
- 其它 provider 不伪装成有统一“剩余额度 API”
- 但会明确给出：
  - 已配置 / 未配置
  - 使用 Gateway 本地 usage 聚合跟踪

### 4. Analytics Dashboard 接入 providerUsage

修改：

- `src/components/analytics-dashboard.tsx`

现在新增两块展示：

1. **Gateway Runs (30d)** / **Providers Active** / **Token-Tracked Runs** / **Gateway Tokens**
2. **Provider Usage (Gateway Runs)** 列表

也就是说，Analytics 不再只会显示：

- Antigravity gRPC completion metrics

还会显示：

- Gateway 自己按 provider 聚合的运行使用情况

### 5. Types 扩展

修改：

- `src/lib/types.ts`

新增：

- `UserInfo.providerCredits`
- `UserInfo.providerUsageSummary`
- `AnalyticsData.providerUsage`
- `AnalyticsData.providerUsageSummary`
- `AnalyticsData.dataSources`
- `AnalyticsData.providerAwareNotice`

## 验证

### 自动化测试

通过：

```bash
npm test -- src/app/api/analytics/route.test.ts src/app/api/me/route.test.ts src/app/api/models/route.test.ts
```

结果：

- `3 files passed`
- `3 tests passed`

覆盖点：

- `/api/analytics` 在无 Antigravity runtime analytics 时仍能返回 provider 聚合
- `/api/me` 会返回 `providerCredits + providerUsageSummary`
- `/api/models` 仍保留 provider-aware fallback

### lint

通过：

```bash
npx eslint src/app/api/analytics/route.ts src/app/api/analytics/route.test.ts src/app/api/me/route.ts src/app/api/me/route.test.ts src/lib/provider-usage-analytics.ts src/components/analytics-dashboard.tsx src/lib/types.ts
```

### 真实接口回读

真实回读：

```json
{
  "analyticsSummary": {
    "totalRuns": 1934,
    "providers": 3,
    "tokenRuns": 0,
    "totalTokens": 0,
    "windowDays": 30
  }
}
```

真实 provider 样本：

```json
{
  "provider": "native-codex",
  "runCount": 1436,
  "completedCount": 706,
  "activeCount": 4,
  "failedCount": 29,
  "blockedCount": 697
}
```

`/api/me` 真实回读已出现：

- `providerCredits`
- `providerUsageSummary`

其中包含：

- `antigravity`
- `native-codex`
- `claude-api`
- `openai-api`
- `gemini-api`
- `grok-api`
- `custom`

## 结论

这轮之后，系统在 usage / credits / analytics 这块的状态已经从：

- “只有 Antigravity runtime 指标”

变成：

- “Antigravity runtime 指标 + Gateway provider 级运行聚合”

还没有做到的部分是：

- 真正的供应商账单级 credits / quota API 聚合
  - OpenAI / Gemini / Grok / Claude 各自并没有统一稳定的“剩余额度查询”契约
- tokenUsage 目前很多历史 run 仍为 0
  - 这是历史数据采集粒度问题，不是聚合层问题

但从产品可见性上，这块已经不再是：

- Antigravity-only

而是：

- **provider-aware 的真实聚合壳**
