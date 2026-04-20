# Native Codex AI 日报测试命令行 Runbook（2026-04-17）

## 目的

通过命令行手动触发 `AI情报工作室` 使用 **Native Codex** 生成“今天的日报”，并验证：

1. CEO 命令会先创建 `Ad-hoc Project`
2. run 会使用 `native-codex`
3. workflow 会命中 `/ai_digest`
4. 结果会落到项目运行目录
5. 测试结束后恢复部门默认 provider

## 前提

- Gateway Web 已启动，默认地址：
  - `http://127.0.0.1:3000`
- 工作区存在：
  - `/Users/darrel/Documents/baogaoai`
- 部门配置文件存在：
  - `/Users/darrel/Documents/baogaoai/.department/config.json`
- `Native Codex` 已登录可用

## Step 1：查看当前部门 provider

```bash
python3 - <<'PY'
import json
p='/Users/darrel/Documents/baogaoai/.department/config.json'
obj=json.load(open(p))
print(json.dumps({
  'provider': obj.get('provider'),
  'skills': [s.get('workflowRef') for s in obj.get('skills', [])],
}, ensure_ascii=False, indent=2))
PY
```

## Step 2：临时切到 `native-codex`

```bash
python3 - <<'PY'
import json
p='/Users/darrel/Documents/baogaoai/.department/config.json'
obj=json.load(open(p))
obj['provider']='native-codex'
json.dump(obj, open(p,'w'), ensure_ascii=False, indent=2)
print(obj['provider'])
PY
```

## Step 3：触发 CEO 命令

日报命令：

```bash
curl -s -X POST http://127.0.0.1:3000/api/ceo/command \
  -H 'Content-Type: application/json' \
  -d '{"command":"AI情报工作室生成今天的日报"}' | python3 -c 'import sys,json; obj=json.load(sys.stdin); print(json.dumps(obj, ensure_ascii=False, indent=2))'
```

预期返回：

- `action = create_project`
- 同时包含：
  - `projectId`
  - `runId`

记下这两个值，后面要用。

## Step 4：轮询 run 到终态

把下面脚本里的 `RUN_ID` 和 `PROJECT_ID` 替换成上一步返回的真实值：

```bash
python3 - <<'PY'
import json, time, urllib.request

RUN_ID = 'REPLACE_RUN_ID'
PROJECT_ID = 'REPLACE_PROJECT_ID'

run_url = f'http://127.0.0.1:3000/api/agent-runs/{RUN_ID}'
project_url = f'http://127.0.0.1:3000/api/projects/{PROJECT_ID}'

for i in range(90):
    with urllib.request.urlopen(run_url, timeout=10) as resp:
        run = json.load(resp)
    print(json.dumps({
        'poll': i,
        'status': run.get('status'),
        'projectId': run.get('projectId'),
        'provider': run.get('provider'),
        'backendId': ((run.get('sessionProvenance') or {}).get('backendId')),
        'resolvedWorkflowRef': run.get('resolvedWorkflowRef'),
        'resultStatus': (run.get('result') or {}).get('status'),
        'resultSummary': ((run.get('result') or {}).get('summary') or '')[:220],
        'lastError': run.get('lastError'),
    }, ensure_ascii=False))
    if run.get('status') in {'completed','blocked','failed','cancelled','timeout'}:
        break
    time.sleep(2)

with urllib.request.urlopen(project_url, timeout=10) as resp:
    project = json.load(resp)

print('PROJECT')
print(json.dumps({
    'projectId': project.get('projectId'),
    'status': project.get('status'),
    'runIds': project.get('runIds'),
    'workspace': project.get('workspace'),
    'projectType': project.get('projectType'),
}, ensure_ascii=False, indent=2))
PY
```

成功时预期：

- `provider = native-codex`
- `backendId = native-codex`
- `resolvedWorkflowRef = /ai_digest`
- `run.status = completed`
- `project.status = completed`
- `project.runIds` 包含当前 `runId`

## Step 5：查看产物目录

把下面命令里的 `PROJECT_ID` 和 `RUN_ID` 替换掉：

```bash
find "/Users/darrel/Documents/baogaoai/demolong/projects/PROJECT_ID/runs/RUN_ID" -maxdepth 2 -type f | sort
```

当前 `Native Codex` 日报 run 通常会有：

- `prepared-ai-digest-context.json`
- `task-envelope.json`
- `result.json`
- `result-envelope.json`
- `artifacts.manifest.json`

## Step 6：查看结果摘要

```bash
python3 - <<'PY'
import json
path = "/Users/darrel/Documents/baogaoai/demolong/projects/PROJECT_ID/runs/RUN_ID/result.json"
obj = json.load(open(path))
print(json.dumps(obj, ensure_ascii=False, indent=2))
PY
```

## Step 7：如果想看 Antigravity 那种“过程”，这是边界

`Native Codex` 当前不会像 `antigravity` 一样提供完整 conversation step trace。  
如果你想验证“项目化 + 结果”就用上面这套；如果你想验证“过程可见性”，需要用部门默认 provider `antigravity` 再跑一遍。

## Step 8：测试后恢复 provider

```bash
python3 - <<'PY'
import json
p='/Users/darrel/Documents/baogaoai/.department/config.json'
obj=json.load(open(p))
obj['provider']='antigravity'
json.dump(obj, open(p,'w'), ensure_ascii=False, indent=2)
print(obj['provider'])
PY
```

## 当前已验证过的一次成功样本

在 `2026-04-17` 的一次成功样本中：

- `projectId = 77c6a0f8-14e8-4be3-b1bd-635f16311e11`
- `runId = 2424cb6c-eca0-4618-a2f3-593d86456847`
- `provider = native-codex`
- `resolvedWorkflowRef = /ai_digest`
- `project.status = completed`

对应研究记录：

- `docs/research/native-codex-daily-digest-adhoc-project-rerun-2026-04-17.md`
