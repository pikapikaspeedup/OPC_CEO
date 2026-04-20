# Provider Runtime Hardening（2026-04-17）

## 背景

在 `Native Codex AI 大事件` 成功后，又针对 4 个 review finding 做了第二轮收口：

1. repo skill sync 是 copy-once，后续 repo 修复无法刷新 canonical home
2. `report_daily_events.py` 把 admin token 作为 repo 默认值写死
3. `workflow-runtime-hooks.ts` 通过 workflow name `switch` 绑定业务逻辑
4. `ceo-agent.ts` fallback parser 通过 `提炼|上报` 词表驱动 dispatch

## 本轮修改

### 1. workflow runtime 改成 manifest-driven

修改：

- `src/lib/agents/canonical-assets.ts`
- `src/lib/agents/workflow-runtime-hooks.ts`

做法：

- canonical workflow frontmatter 新增：
  - `runtimeProfile`
  - `runtimeSkill`
- runtime hook 不再按 `/ai_digest`、`/ai_bigevent` 名字分支
- 共享 runtime 只认 `runtimeProfile`

当前 profile：

- `daily-digest`
- `daily-events`

### 2. daily-events token 改成私有配置 / 环境变量

修改：

- `.agents/skills/baogaoai-ai-bigevent-generator/scripts/report_daily_events.py`

行为：

- 不再有 repo 默认 token
- 优先级改为：
  1. `--token`
  2. `BAOGAOAI_DAILY_EVENTS_TOKEN`
  3. `BAOGAOAI_ADMIN_TOKEN`
  4. `--token-file` 指向的私有 JSON

本机私有配置文件：

- `/Users/darrel/Documents/baogaoai/.department/private.json`

字段：

```json
{
  "dailyEventsAdminToken": "..."
}
```

### 3. canonical sync 改为 repo refresh

修改：

- `src/lib/agents/gateway-home.ts`

结果：

- repo `.agents/workflows` / `.agents/skills` 现在每次启动都会刷新 canonical home mirror
- legacy home assets 仍保留“只补缺，不覆写”
- 这样 repo 修复不会再被旧 canonical skill 吃掉

### 4. CEO fallback 去掉业务词表依赖

修改：

- `src/lib/agents/ceo-agent.ts`

结果：

- 不再依赖 `提炼|上报` 这类业务词表才能 dispatch
- fallback 只要：
  - 不是 schedule/status
  - 唯一匹配到部门
  - 能提取出有效 goal
  就直接走 Prompt Mode
- 实际 workflow 命中继续交给 Department Resolver

## 验证

### lint / test

- `npx eslint src/lib/agents/workflow-runtime-hooks.ts src/lib/agents/canonical-assets.ts src/lib/agents/gateway-home.ts src/lib/agents/prompt-executor.ts src/lib/agents/department-execution-resolver.ts` ✅
- `npx vitest run src/lib/agents/department-execution-resolver.test.ts src/lib/agents/department-capability-registry.test.ts` ✅

### script 验证

- `python3 -m py_compile .../fetch_context.py .../build_report.py .../report_daily_events.py` ✅
- `report_daily_events.py --token-file /Users/darrel/Documents/baogaoai/.department/private.json ...` ✅
  - `status = success`
  - `saved = 5`
  - `verificationPassed = true`

### CEO fallback 验证

命令：

- `AI情报工作室提炼今天的 AI 大事件并上报`

结果：

- `POST /api/ceo/command` 返回 `dispatch_prompt`
- 新 run `resolvedWorkflowRef = /ai_bigevent`
- 说明 dispatch 不再依赖新增业务词表，而是靠部门匹配 + resolver 命中

验证 run：

- `a2deab47-cbad-451a-b3f4-28a505c890bb`

验证后已取消，避免继续改写业务数据。
