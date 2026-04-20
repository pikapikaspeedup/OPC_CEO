# CEO 即时部门任务强制挂载 Ad-hoc Project（2026-04-17）

## 背景

此前 `/api/ceo/command` 的即时部门任务路径会直接：

- `executePrompt(...)`
- 返回 `dispatch_prompt`
- 不创建 `Project`

这导致：

1. 与 CEO playbook 中“所有正式任务必须先创建 Project”的规则冲突
2. 成功 run 的 `projectId = null`
3. 即使任务执行成功，也不会进入 OPC 项目视图

## 本轮修改

### 1. 即时部门任务统一收口

修改：

- `src/lib/agents/ceo-agent.ts`

新增统一 helper：

- `executeImmediateDepartmentTask(...)`

现在规则变为：

1. 先创建 `projectType = "adhoc"` 的轻量项目
2. 如果即时指令显式命中 template，则在该 Project 下派发 template run
3. 如果没有明确 template，则在该 Project 下派发 prompt run
4. 如果用户明确说“只创建项目 / 不要执行”，则只建 Project，不派发 run

### 2. ProjectWorkbench 修正 prompt run 过滤

修改：

- `src/components/project-workbench.tsx`

结果：

- standalone prompt runs 现在按 `projectId` 过滤
- 不会再把其他项目的 prompt run 混进当前项目

### 3. CEO command card / playbook / docs 同步

修改：

- `src/components/ceo-scheduler-command-card.tsx`
- `src/components/ceo-dashboard.tsx`
- `/Users/darrel/.gemini/antigravity/ceo-workspace/.agents/workflows/ceo-playbook.md`
- `/Users/darrel/.gemini/antigravity/ceo-workspace/.agents/workflows/ceo-scheduler-playbook.md`
- `docs/guide/gateway-api.md`
- `docs/guide/cli-api-reference.md`
- `docs/guide/agent-user-guide.md`
- `ARCHITECTURE.md`

统一后的产品语义：

- `Project` 强制
- `Template` 可选
- 即时部门业务任务不允许再创建裸 prompt run

## 验证

### 单测

```bash
npx vitest run \
  src/lib/agents/ceo-agent.test.ts \
  src/lib/agents/department-execution-resolver.test.ts \
  src/lib/agents/department-capability-registry.test.ts
```

结果：

- `20/20` 通过

### 真实接口验证

命令：

```bash
POST /api/ceo/command
{
  "command": "让AI情报工作室只创建项目，不要执行，测试即时任务项目化"
}
```

返回：

```json
{
  "success": true,
  "action": "create_project",
  "projectId": "9dc3c1a3-923d-4147-a848-4b458264f845"
}
```

并且项目已真实写入 project registry：

- `projectType = "adhoc"`
- `workspace = file:///Users/darrel/Documents/baogaoai`

验证后已删除该测试项目，避免污染 OPC 数据。
