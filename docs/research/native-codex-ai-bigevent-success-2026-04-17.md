# Native Codex AI 大事件链路打通（2026-04-17）

## 目标

让 `AI情报工作室` 在 **Native Codex** 下，通过 CEO 命令真正命中 canonical `/ai_bigevent`，并完成：

1. prepared context 生成
2. Native Codex 提炼事件
3. payload 构建
4. `POST /admin/daily-events/report`
5. `GET /daily-events` 回读验证

## 本轮实现

### 1. canonical workflow / skill 资产

新增 repo seed assets：

- `.agents/workflows/ai_bigevent.md`
- `.agents/skills/baogaoai-ai-bigevent-generator/SKILL.md`
- `.agents/skills/baogaoai-ai-bigevent-generator/scripts/fetch_context.py`
- `.agents/skills/baogaoai-ai-bigevent-generator/scripts/build_report.py`
- `.agents/skills/baogaoai-ai-bigevent-generator/scripts/report_daily_events.py`

并通过 `src/lib/agents/gateway-home.ts` 新增 repo `.agents/skills` → canonical home sync。

### 2. Department Resolver 动态命中

修改：

- `src/lib/agents/department-execution-resolver.ts`

结果：

- Prompt Mode 支持基于 `promptText + department skill/workflow aliases` 动态匹配能力
- 当部门同时声明 `/ai_digest` 和 `/ai_bigevent` 时，不再因为多个 workflow 并存而丢失 `resolvedWorkflowRef`
- 本次命中结果为：
  - `resolvedWorkflowRef = /ai_bigevent`
  - `resolvedSkillRefs = ['baogaoai-ai-bigevent-generator']`

### 3. workflow lifecycle hooks

新增：

- `src/lib/agents/workflow-runtime-hooks.ts`

并把 `prompt-executor.ts` 的 `/ai_digest` 特判迁入 hook 层，同时新增 `/ai_bigevent`：

- `prepareWorkflowRuntimeContext()`：
  - 生成 `prepared-ai-bigevent-context.json`
  - 注入绝对日期、same-day 去重上下文、30 天历史上下文、候选文章与文章详情
- `finalizeWorkflowRun()`：
  - 读取 Native Codex 原始输出
  - 生成 `daily-events-report.json`
  - 真实上报并生成 `daily-events-verification.json`
  - 将 `reportedEventDate / reportedEventCount / verificationPassed` 回写到 run 和 result-envelope

### 4. AI情报工作室能力声明扩展

更新：

- `/Users/darrel/Documents/baogaoai/.department/config.json`

新增 skill：

```json
{
  "skillId": "ai-big-event",
  "name": "AI 大事件",
  "category": "research",
  "workflowRef": "/ai_bigevent",
  "skillRefs": ["baogaoai-ai-bigevent-generator"]
}
```

## 脚本层验证

### fetch_context.py

运行：

```bash
python3 .../fetch_context.py --date 2026-04-17 --out /tmp/baogaoai-bigevent-context.json --insecure
```

结果：

- `status = ok`
- `targetDate = 2026-04-17`
- `runMode = first`
- `articleCount = 18`

### build_report.py

使用结构化 smoke draft 验证 payload 构建，成功产出：

- `/tmp/baogaoai-bigevent-report.json`
- `/tmp/baogaoai-bigevent-build.json`

## 端到端运行

CEO 命令：

```text
AI情报工作室提炼今天的 AI 大事件并上报
```

runId：

- `b44974e2-ea70-4937-b447-0b40e5389144`

run 关键信息：

- `status = completed`
- `sessionProvenance.backendId = native-codex`
- `resolvedWorkflowRef = /ai_bigevent`
- `promptResolution.mode = workflow`
- `reportedEventDate = 2026-04-17`
- `reportedEventCount = 5`
- `verificationPassed = true`

## 关键产物

路径：

- `/Users/darrel/Documents/baogaoai/demolong/runs/b44974e2-ea70-4937-b447-0b40e5389144/prepared-ai-bigevent-context.json`
- `/Users/darrel/Documents/baogaoai/demolong/runs/b44974e2-ea70-4937-b447-0b40e5389144/native-codex-ai-bigevent-draft.md`
- `/Users/darrel/Documents/baogaoai/demolong/runs/b44974e2-ea70-4937-b447-0b40e5389144/daily-events-report.json`
- `/Users/darrel/Documents/baogaoai/demolong/runs/b44974e2-ea70-4937-b447-0b40e5389144/daily-events-verification.json`

## 后端回读结果

```json
{
  "total": 5,
  "titles": [
    "Anthropic 发布 Claude Opus 4.7，面向大众开放的软件工程旗舰模型升级并强化视觉能力",
    "OpenAI 重写 Agents SDK，加入原生 harness 与沙盒能力直指生产级 Agent 基建",
    "Google 在 Chrome 推出 AI Mode 并排浏览与多标签打包查询，强化搜索中的持续上下文交互",
    "Upscale AI 启动新一轮融资谈判，拟以约 20 亿美元估值募资 1.8 亿至 2 亿美元",
    "Roblox 为开发助手上线 Planning Mode，并新增生成与测试型 Agent 工具"
  ]
}
```

## 测试后恢复

已将 `AI情报工作室` 的 provider 恢复为：

- `antigravity`
