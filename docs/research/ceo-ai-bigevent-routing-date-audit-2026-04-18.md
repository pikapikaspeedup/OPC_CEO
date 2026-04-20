# CEO 命令命中 `/ai_bigevent` 与“今天”日期判定审计（2026-04-18）

## 结论速记

1. 最稳的触发句子是：
   - `AI情报工作室提炼今天的 AI 大事件并上报`
   - 如果要更像 CEO 口吻，也可以用：`让 AI情报工作室提炼今天的 AI 大事件并上报`
2. `provider/native-codex` **只影响执行 backend / executor 路由，不影响 workflow 命中逻辑本身**。
3. “今天”对 `AI 大事件` 不是按本机时区随便取，而是**强制按 `Asia/Shanghai`** 计算。
4. workflow 命中链路是：
   - CEO command -> `executePrompt`
   - `buildPromptModeProviderExecutionContext`
   - 由部门 skill `AI 大事件 -> /ai_bigevent`
   - `prepareWorkflowRuntimeContext` 读取 `/ai_bigevent` frontmatter
   - `daily-events` runtime hooks 按 `Asia/Shanghai` 注入绝对日期并完成上报/回读

## 1. 什么句子最稳

最稳不是“随便提到大事件”就行，而是同时满足两点：

1. 命令里带**准确部门名**：`AI情报工作室`
2. 命令里带**准确 skill 名**：`AI 大事件`

原因：

- 部门识别是 `normalizeText(command)` 后做 alias 包含匹配。
- prompt-mode workflow 命中也是把 prompt 归一化后，去匹配部门 skill 的 `name / skillId / skillRefs / workflow.name`。

因此最稳句子就是已经被测试和真实 run 反复覆盖过的：

```text
AI情报工作室提炼今天的 AI 大事件并上报
```

不建议改成：

- `AI 情报中心...`
- `整理今天大事件...`
- `做个 AI 新闻总结...`

因为这些写法虽然有时也可能被 LLM parse 理解，但没有“部门名 + skill 名”双重硬锚点。

## 2. `provider/native-codex` 是否只影响执行器

答案：**是。**

workflow 命中发生在 provider/backend 启动之前。

关键顺序：

1. `executePrompt()` 先 `resolveProvider('execution', workspacePath)`
2. 同一个函数里再调用 `buildPromptModeProviderExecutionContext(workspacePath, { promptText })`
3. `resolvedWorkflowRef` 在这里就已经确定
4. 最后才 `getAgentBackend(resolvedProvider.provider)` 启动具体 backend

也就是说：

- `provider = native-codex`
- `provider = antigravity`

都会先走同一套 department workflow resolution。

provider 影响的是：

- 具体用哪个 backend
- 具体模型/会话 handle
- 输出 draft 的风格与执行能力

provider **不影响**：

- `/ai_bigevent` 是否被命中
- `resolvedWorkflowRef` 的计算逻辑

## 3. “今天”按哪个时区/逻辑决定

答案：**按 `Asia/Shanghai`。**

具体逻辑分三层锁定：

### 第一层：Node runtime hook 先算目标日

`workflow-runtime-hooks.ts` 里的 `getAsiaShanghaiDateString()` 用：

- `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })`

生成 `YYYY-MM-DD`。

随后 `prepareAiBigEventContext()` 把这个日期作为 `targetDate`，并显式传给 Python：

- `fetch_context.py --date <targetDate>`

### 第二层：Python skill 即使独立运行，默认也是上海时区

`fetch_context.py` 内部：

- `SH_TZ = ZoneInfo("Asia/Shanghai")`
- 如果没传 `--date`，`parse_target_date()` 也会用 `dt.datetime.now(SH_TZ).date()`

但当前实际 runtime 已经显式传了 `--date`，所以这里是双保险。

### 第三层：最终上报与验证都锁定这个绝对日期

`build_report.py` 直接把：

- `target_date = context["targetDate"]`
- `eventDate = target_date`

写入上报 payload。

`report_daily_events.py` 再用：

- `target_date = payload["eventDate"]`
- `GET /daily-events?from=target_date&to=target_date`

做回读验证。

所以“今天”的业务日期不是看用户机器当前 locale，也不是看 Rome/UTC，而是：

- **先按上海时区取绝对日期**
- **再把这个绝对日期贯穿 preflight -> payload -> verify**

## 4. 关键代码点

### CEO 命令入口

- `src/lib/agents/ceo-agent.ts`
  - `matchDepartment()`：部门命中看 alias 包含
  - `cleanupGoal()`：去掉“让/请/时间词”等调度噪音
  - `executeImmediateDepartmentTask()`：即时任务统一先建项目，再 `executePrompt()`
  - `processCEOCommand()`：优先走 LLM parse，失败后走 regex fallback

### workflow 命中

- `src/lib/agents/department-execution-resolver.ts`
  - `buildPromptModeProviderExecutionContext()`
  - 先读部门能力包
  - 再用 prompt 文本匹配部门 skill / workflow
  - 当只命中一个 workflow 时，直接回写 `resolvedWorkflowRef`

### 部门能力来源

- `/Users/darrel/Documents/baogaoai/.department/config.json`
  - `AI 大事件`
  - `workflowRef = /ai_bigevent`
  - `skillRefs = ["baogaoai-ai-bigevent-generator"]`

### prompt 执行总线

- `src/lib/agents/prompt-executor.ts`
  - `resolveProvider('execution', workspacePath)` 先解 provider
  - `buildPromptModeProviderExecutionContext(...)` 再解 workflow
  - `createRun(...)` 同时写入 `provider` 和 `resolvedWorkflowRef`
  - `prepareWorkflowRuntimeContext(...)` 进入 preflight
  - `finalizeWorkflowRun(...)` 进入 post-run finalize
  - `getAgentBackend(resolvedProvider.provider)` 才真正选 executor

### canonical workflow runtime 配置

- `.agents/workflows/ai_bigevent.md`
  - `runtimeProfile: daily-events`
  - `runtimeSkill: baogaoai-ai-bigevent-generator`
  - 文档正文明确写了“今天（Asia/Shanghai）”

- `src/lib/agents/canonical-assets.ts`
  - `getCanonicalWorkflowRuntimeConfig()` 从 workflow frontmatter 提取 `runtimeProfile / runtimeSkill`

### 日期与上报

- `src/lib/agents/workflow-runtime-hooks.ts`
  - `getAsiaShanghaiDateString()`
  - `prepareAiBigEventContext()`
  - `finalizeAiBigEventRun()`

- `.agents/skills/baogaoai-ai-bigevent-generator/scripts/fetch_context.py`
  - `SH_TZ = ZoneInfo("Asia/Shanghai")`
  - `parse_target_date()`

- `.agents/skills/baogaoai-ai-bigevent-generator/scripts/build_report.py`
  - `target_date = context["targetDate"]`
  - `eventDate = target_date`

- `.agents/skills/baogaoai-ai-bigevent-generator/scripts/report_daily_events.py`
  - `target_date = payload["eventDate"]`
  - verify API 用 `from=target_date&to=target_date`

## 5. 真实运行证据

回读现有 run：

- `runId = e06490c0-15ce-4faa-8bc3-b08eccc180fa`
- `provider = native-codex`
- `resolvedWorkflowRef = /ai_bigevent`
- `reportedEventDate = 2026-04-18`

对应产物：

- `/Users/darrel/Documents/baogaoai/demolong/projects/79dc21b7-7916-4651-8638-421ab99c30c0/runs/e06490c0-15ce-4faa-8bc3-b08eccc180fa/result.json`
- `/Users/darrel/Documents/baogaoai/demolong/projects/79dc21b7-7916-4651-8638-421ab99c30c0/runs/e06490c0-15ce-4faa-8bc3-b08eccc180fa/result-envelope.json`
- `/Users/darrel/Documents/baogaoai/demolong/projects/79dc21b7-7916-4651-8638-421ab99c30c0/runs/e06490c0-15ce-4faa-8bc3-b08eccc180fa/daily-events-verification.json`

其中 `daily-events-verification.json` 明确显示：

- `targetDate = 2026-04-18`
- verify API = `.../daily-events?from=2026-04-18&to=2026-04-18`

## 6. 最终判断

1. 触发 `/ai_bigevent` 最稳的中文句子，就是保留**完整部门名 + 完整 skill 名**的：
   - `AI情报工作室提炼今天的 AI 大事件并上报`
2. `native-codex` 只改执行 backend，不改 workflow 命中逻辑。
3. “今天”严格按 `Asia/Shanghai` 计算，并贯穿上下文准备、payload 构建和回读验证。
4. 这条链路当前已有真实 run 证据，不是仅从代码推断。
