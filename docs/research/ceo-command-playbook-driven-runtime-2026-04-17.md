# CEO Command Playbook-Driven Runtime（2026-04-17）

## 背景

此前 `/api/ceo/command` 的实现虽然已经修成“即时部门任务先创建 `Ad-hoc Project`”，但仍存在一个结构性问题：

- Route 最终只是调用 `processCEOCommand(...)`
- `processCEOCommand(...)` 的 LLM 解析 prompt 完全由 TS 内部拼接
- CEO workspace 中的 `ceo-playbook.md` / `ceo-scheduler-playbook.md` 并没有真正参与决策

因此 `/api/ceo/command` 仍然会被 review 定义为“绕开了 CEO playbook”。

## 本轮修改

### 1. `/api/ceo/command` 改为 playbook-driven parser

修改：

- `src/lib/agents/ceo-agent.ts`

新增：

- `readCEOPlaybook(filename)`
- `buildCEOPlaybookContext()`

行为：

- 在构造 LLM parser prompt 时，动态读取：
  - `/Users/darrel/.gemini/antigravity/ceo-workspace/.agents/workflows/ceo-playbook.md`
  - `/Users/darrel/.gemini/antigravity/ceo-workspace/.agents/workflows/ceo-scheduler-playbook.md`
- 将两份 playbook 正文直接注入 parser prompt
- 明确告诉 LLM：
  - 这两份 playbook 是业务规则真相源
  - 若与模型自身习惯冲突，必须服从 playbook

这样 `/api/ceo/command` 不再只是“一个独立 TS 解析器”，而是变成：

- **TS 执行器**
- **playbook 驱动的 LLM 决策层**

### 2. 当前行为收口

在 playbook 注入后，`/api/ceo/command` 的即时部门业务任务规则是：

1. 先创建 `Ad-hoc Project`
2. 明确 template 时派发 template run
3. 否则在项目内派发 prompt run
4. 不允许直接创建裸 prompt run

## 验证

### 单测

```bash
npx vitest run src/lib/agents/ceo-agent.test.ts
```

结果：

- `14/14` 通过

新增覆盖：

- `callLLMOneshot()` 收到的 parser prompt 中包含：
  - `<ceo-playbook>`
  - `CEO 决策与派发工作流`
  - `<ceo-scheduler-playbook>`
  - `CEO 定时调度 + 即时执行工作流`

### 真实接口验证

命令：

```bash
POST /api/ceo/command
{
  "command": "让AI情报工作室只创建项目，不要执行，测试 playbook 驱动"
}
```

返回：

```json
{
  "success": true,
  "action": "create_project",
  "projectId": "5dbe8e84-d0aa-4585-bbc0-c80c70b1ac4c"
}
```

说明：

- playbook 注入没有破坏 `/api/ceo/command`
- 即时任务仍然遵守“先建 Ad-hoc Project”规则

验证后已删除该测试项目，避免污染 OPC 数据。
