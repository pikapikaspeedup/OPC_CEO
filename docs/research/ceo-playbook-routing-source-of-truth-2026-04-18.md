# CEO 路由真相源回收为 Playbook（2026-04-18）

## 背景

在验证秒级 scheduler + Native Codex AI 大事件链路时，暴露出一个边界问题：

- `ceo-agent.ts` 不应该自己再加一层业务路由启发式
- “派给哪个部门执行”
- “走 template 还是 prompt”
- 这些判断的真相源应当是：
  - `ceo-playbook.md`
  - `ceo-scheduler-playbook.md`

而不是继续在 TS 中追加关键词或 skill 命中规则。

## 本次收口

### 1. 移除 CEO 侧新增业务启发式

删除了本轮新加的 CEO 侧 skill 命中改判逻辑，不再在 `ceo-agent.ts` 里：

- 扫描 `department.config.skills`
- 命中 skill / workflow / skillRefs 后就强制改判 `dispatch-prompt`
- 自动塞 `promptAssetRefs / skillHints`

### 2. 收紧 regex fallback

`processWithRegex()` 现在只保留：

- 状态查询 → `info`

当 LLM / playbook 解析不可用时：

- 不再自动决定部门
- 不再自动决定 `template` vs `prompt`
- 不再自动创建 scheduler job

而是明确返回：

- `report_to_human`

避免在解析失效时偷偷退回 TS 硬编码路由。

### 3. 保留 playbook 驱动的 LLM 结构化解析

`buildLLMParserPrompt()` 仍然会注入：

- `<ceo-playbook>`
- `<ceo-scheduler-playbook>`

但提示语已改成强调：

- 部门分配
- `dispatch-pipeline / dispatch-prompt / create-project`

必须由 playbook + 实际可用部门/模板信息来决定，而不是靠静态关键词表。

### 4. 一并修复 scheduler 删除持久化缺口

在本轮实跑中顺手发现：

- 删除 scheduler job 只删内存，不删 SQLite
- 重启后 job 会“复活”

已补上：

- `deleteScheduledJobRecord(jobId)` in `gateway-db.ts`
- `deleteScheduledJob()` 调用 SQLite 真删除

## 验证

### 单测

```bash
npm test -- src/lib/agents/ceo-agent.test.ts
```

结果：

- `6 passed`

覆盖：

- playbook 内容注入 LLM parser prompt
- LLM 输出 `dispatch-prompt` 时的即时执行映射
- LLM 输出 `create-project + templateId` 时的模板派发映射
- LLM 输出定时 `dispatch-prompt` 时的 scheduler job 映射
- LLM 不可用时仅保留状态查询 fallback
- LLM 不可用时拒绝用 regex 自动路由业务执行

### 运行时清理

已确认：

- 临时创建的 5 秒 AI 大事件 scheduler job 已删除
- 临时测试残留的 3 条 scheduler job 已从 SQLite 持久化层清理
- `AI情报工作室` provider 已恢复为 `antigravity`

## 结论

这次收口后，`ceo-agent` 的职责重新回到正确边界：

1. **Playbook 是决策真相源**
2. **LLM 负责把 playbook 决策翻译成结构化 JSON**
3. **后端只负责执行，不再在 fallback 中偷偷补业务路由规则**

后续如果需要让某类任务稳定走 `dispatch-prompt`，应该优先改：

- CEO playbook
- Scheduler playbook
- 或显式配置元数据

而不是继续往 `ceo-agent.ts` 塞规则。
