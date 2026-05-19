# BuiltIn Job 最小修复方案 — Platform Engineering Story Top 3

> 日期：2026-05-11  
> 修订：2026-05-12  
> 范围：仅调度系统（`src/lib/agents/scheduler.ts` + 可选的 `src/app/api/scheduler/jobs/[id]/route.ts` 保护）。**不涉及** PromptComposer / 新架构。

---

## 0. 一句话目标

把 `builtin-platform-engineering-story-top-candidates` 从“每次 ensure 把用户改动覆盖”改成“默认值只用于首次 seed，之后复用现有 scheduler cron 机制，用户通过现有 GUI/API/MCP 修改 `cronExpression / enabled / timeZone` 并持久”。

本轮不新增第二套配置真源。`scheduled_jobs` 继续是 Story Top 3 调度配置的唯一真源。

---

## 1. 当前事实

### 1.1 现有 cron 机制已经足够承载配置

当前系统已有完整 scheduler CRUD：

- `ScheduledJob` 原生包含 `cronExpression / timeZone / enabled`。
- `/api/scheduler/jobs/{id}` 已支持 PATCH 更新 job。
- `scheduled_jobs.payload_json` 已持久化完整 job。
- GUI/API/MCP 都围绕这套机制工作。

因此 Story Top 3 的 cron 配置不需要新增 policy 表、policy API 或 policy 到 job 的反写链路。

### 1.2 真 bug 是 ensure 覆盖用户字段

`src/lib/agents/scheduler.ts:223-243` 的默认构造目前写死：

```ts
cronExpression: '0 9 * * *',
timeZone: detectLocalTimeZone(),
enabled: true,
```

这些默认值本身可以作为首次 seed 的出厂值；问题在 `ensureBuiltInPlatformEngineeringStoryCandidateJob`：

```ts
const job = normalizeScheduledJobDefinition({
  ...buildBuiltInPlatformEngineeringStoryCandidateJob(now),   // 默认值
  ...(state.jobs.get(BUILT_IN_...JOB_ID) || {}),               // 用户改动
  ...buildBuiltInPlatformEngineeringStoryCandidateJob(now),   // 默认值再次覆盖
  createdAt: state.jobs.get(BUILT_IN_...JOB_ID)?.createdAt || now,
});
```

第三个 spread 把用户通过现有 scheduler 机制写入的 `cronExpression / enabled / timeZone` 覆盖回出厂默认值。

### 1.3 Company Loop policy 不是本问题的模板

Company Loop policy 承载的是 loop 业务规则：review hour、agenda cap、dispatch cap、allowed actions、notification 等；scheduler job 只是它的物化视图。

Story Top 3 当前只需要解决一个内置 scheduler job 的 cron 持久化问题。把它做成 `PlatformEngineeringPolicy -> ScheduledJob` 会制造第二套真源和同步路径。

---

## 2. 本轮明确不做

本轮不做以下设计：

- 不新增 `PlatformEngineeringPolicy`。
- 不新增 `platform_engineering_policies` 表。
- 不新增 `/api/platform-engineering/policies`。
- 不做 scheduler PATCH 反写 policy。
- 不新增 cron 反解析 helper。
- 不为尚未落地的部门级 Story Top 预留 `scope/scopeId`。
- 不改 Company Loop policy 或 Company Loop builtIn 的语义。
- 不新增 PromptComposer、ConfigurationLayer、YAML manifest 相关逻辑。

---

## 3. 推荐方案

### 3.1 继续使用 `scheduled_jobs` 作为唯一真源

对 `builtin-platform-engineering-story-top-candidates`：

| 字段 | 真源 | 行为 |
|---|---|---|
| `cronExpression` | `scheduled_jobs.payload_json` | 用户通过现有 scheduler GUI/API/MCP 修改后持久 |
| `timeZone` | `scheduled_jobs.payload_json` | 用户修改后持久 |
| `enabled` | `scheduled_jobs.payload_json` | 用户启停后持久 |
| `jobId` | 系统固定 | 不允许变 |
| `action / promptAssetRefs / departmentWorkspaceUri` | 系统固定或随代码升级刷新 | 不作为用户 cron 配置入口 |
| `createdAt / lastRunAt / lastRunResult / lastRunError` | existing job | 保留历史 |

### 3.2 修复 ensure 合并顺序

核心原则：

1. 默认 builder 只提供首次 seed 的出厂默认值。
2. 已存在 job 时，保留 existing 的 `cronExpression / timeZone / enabled`。
3. 不再在 existing 后再次 spread 默认值覆盖用户字段。
4. 是否刷新系统字段由 `shouldReplaceBuiltInStoryTopJob` 判断，但刷新时仍必须保留用户可编辑字段。

建议替换 `ensureBuiltInPlatformEngineeringStoryCandidateJob`：

```ts
function shouldReplaceBuiltInStoryTopJob(existing: ScheduledJob | undefined, next: ScheduledJob): boolean {
  if (!existing) return true;
  return existing.name !== next.name
    || existing.type !== next.type
    || existing.cronExpression !== next.cronExpression
    || existing.timeZone !== next.timeZone
    || existing.enabled !== next.enabled
    || existing.intentSummary !== next.intentSummary
    || existing.departmentWorkspaceUri !== next.departmentWorkspaceUri
    || JSON.stringify(existing.action) !== JSON.stringify(next.action);
}

function ensureBuiltInPlatformEngineeringStoryCandidateJob(): void {
  const now = new Date().toISOString();
  const defaults = buildBuiltInPlatformEngineeringStoryCandidateJob(now);
  const existing = state.jobs.get(BUILT_IN_PLATFORM_ENGINEERING_STORY_TOP_JOB_ID);

  const next = normalizeScheduledJobDefinition({
    ...defaults,
    ...(existing?.cronExpression ? { cronExpression: existing.cronExpression } : {}),
    ...(existing?.timeZone ? { timeZone: existing.timeZone } : {}),
    ...(existing ? { enabled: existing.enabled } : {}),
    createdAt: existing?.createdAt || defaults.createdAt,
    ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}),
    ...(existing?.lastRunResult ? { lastRunResult: existing.lastRunResult } : {}),
    ...(existing?.lastRunError ? { lastRunError: existing.lastRunError } : {}),
  });

  if (shouldReplaceBuiltInStoryTopJob(existing, next)) {
    state.jobs.set(next.jobId, next);
    saveJobs();
  }
}
```

这个方案不改变现有 cron 配置机制，只修正 builtIn seed/ensure 的合并规则。

### 3.3 DELETE 行为单独决策

当前 ensure 会在 job 缺失时自动补回内置任务。如果允许 DELETE 成功，用户会看到“删了又回来”的体验。

推荐本轮加一个很薄的 DELETE 保护：

```ts
const PROTECTED_BUILT_IN_JOB_IDS: ReadonlySet<string> = new Set([
  BUILT_IN_PLATFORM_ENGINEERING_STORY_TOP_JOB_ID,
]);

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyControlPlaneRequest()) return proxyToControlPlane(req);
  const { id } = await params;

  if (PROTECTED_BUILT_IN_JOB_IDS.has(id)) {
    return NextResponse.json({
      error: '内置任务不可删除。如需停用，请将 enabled 设为 false。',
      code: 'BUILTIN_JOB_PROTECTED',
      jobId: id,
    }, { status: 403 });
  }

  const deleted = deleteScheduledJob(id);
  if (!deleted) {
    return NextResponse.json({ error: `Scheduled job not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
```

如果产品决定“完全交给运营接管，删除也应永久生效”，则不要加 DELETE 保护，同时需要停止缺失时自动补回，或者引入明确 tombstone。那是另一轮产品决策，不放进本轮最小修复。

### 3.4 PATCH 字段保护是可选项

为了避免用户 PATCH `name / action / promptAssetRefs` 后又被 ensure 刷回，可以在 builtIn job 上只允许修改 `cronExpression / enabled / timeZone`。

这是 API validation，不是第二套配置机制。若本轮只修 cron 覆盖 bug，可以先不做 PATCH 白名单；若要避免静默覆盖，建议同步加上。

```ts
const BUILT_IN_MUTABLE_FIELDS: ReadonlySet<string> = new Set([
  'cronExpression',
  'enabled',
  'timeZone',
]);
```

注意：不要在 PATCH handler 里反写任何 policy；直接调用现有 `updateScheduledJob(id, body)` 即可。

---

## 4. 迁移与兼容

### 4.1 无 schema 迁移

本方案不新增表、不改 `ScheduledJob` 类型、不改 `scheduled_jobs` schema。

### 4.2 既有数据处理

- 如果 `scheduled_jobs` 里已有 Story Top job：保留当前行，修复后用户后续修改的 `cronExpression / timeZone / enabled` 不再被 ensure 覆盖。
- 如果当前 cron 已经被旧 bug 覆盖回 `'0 9 * * *'`：无法知道用户之前想改成什么，只能保留当前事实，并在 release note 说明。
- 如果 `scheduled_jobs` 里没有该 job：ensure 用 builder 默认值 seed 一条新 job。

### 4.3 回滚

代码回滚即可。没有新表和数据迁移，因此没有 schema rollback。

---

## 5. 验收清单

- [ ] 用户 PATCH `/api/scheduler/jobs/builtin-platform-engineering-story-top-candidates` 改 `cronExpression` 后，刷新列表仍展示新 cron。
- [ ] 服务重启后，新 cron 不被重置为 `'0 9 * * *'`。
- [ ] 用户改 `enabled=false` 后，刷新和重启后仍为 false。
- [ ] 用户改 `timeZone` 后，刷新和重启后仍保留。
- [ ] `lastRunAt / lastRunResult / lastRunError` 不因 ensure 丢失。
- [ ] 如果实现 DELETE 保护：DELETE Story Top builtIn 返回 403 + `BUILTIN_JOB_PROTECTED`。
- [ ] Company Daily Loop / Company Weekly Review 行为不变。

---

## 6. 影响文件

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `src/lib/agents/scheduler.ts` | 必改 | 修 `ensureBuiltInPlatformEngineeringStoryCandidateJob`，保留 existing 的 cron/timeZone/enabled |
| `src/app/api/scheduler/jobs/[id]/route.ts` | 可选 | DELETE 保护；可选 PATCH 字段白名单 |
| scheduler 相关测试 | 必改 | 覆盖 cron/timeZone/enabled 持久和 builtIn 缺失 seed |

不涉及：

- `src/lib/company-kernel/*`
- `src/lib/storage/gateway-db.ts`
- `src/lib/types.ts`
- `src/lib/api.ts`
- 新的 platform engineering policy route

---

## 7. 测试建议

- Unit：existing Story Top job 的 `cronExpression` 与默认值不同，ensure 后保持 existing 值。
- Unit：existing Story Top job 的 `enabled=false`，ensure 后保持 false。
- Unit：existing Story Top job 的 `timeZone='Asia/Shanghai'`，ensure 后保持该值。
- Unit：Story Top job 缺失时，ensure seed 默认 job。
- Integration：PATCH scheduler job cron 后，再次 GET/list 不被重置。
- Integration：重启或重新 initialize scheduler 后，PATCH 过的 cron 仍保留。
- Regression：Company Loop builtIn ensure 仍从 CompanyLoopPolicy 派生，不受本轮影响。

---

## 8. 被移除的过度设计

上一版中的以下内容已撤回：

- 新建 `PlatformEngineeringPolicy`。
- 新建 `platform_engineering_policies`。
- 新建 `/api/platform-engineering/policies`。
- scheduler PATCH 反写 policy。
- policy API 的 GET/PUT。
- cron 字符串反解析为 hour/minute。
- `scope/scopeId` 预留。
- 前端跳转到 Platform Engineering policy 设置页。

撤回原因：这些都会让 Story Top 3 从现有 scheduler cron 机制变成“policy + materialized job”的双真源。对当前 bug 来说，这是重复机制，不是必要抽象。

---

**END**
