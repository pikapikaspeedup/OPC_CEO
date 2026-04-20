# Native Codex 冒烟测试（2026-04-16）

## 目标

验证 `Codex Native (OAuth)` 不只是出现在 Settings 下拉中，而是能够真实执行 AI 任务。

## 结论

已验证 **可用**。

本次同时发现并修复了两个阻断点：

1. Native Codex 执行链会直接吃到内部占位模型（如 `MODEL_PLACEHOLDER_M26`），导致 ChatGPT 账号链路返回 400
2. `ai-config` 的内存缓存对不同 API 路由不稳定，刚保存的 provider 变更不能保证立即被其他路由看到

修复后，以下两条真实产品链路均已成功：

- **template dispatch** → `coding-basic-template` → `native-codex`
- **prompt mode** → `execution` layer from `ai-config` → `native-codex`

---

## 过程与证据

### 1. 先验证登录态

请求：

```bash
curl -s http://127.0.0.1:3000/api/api-keys
```

关键结果：

```json
{
  "providers": {
    "nativeCodex": {
      "installed": true,
      "loggedIn": true,
      "authFilePath": "/Users/darrel/.codex/auth.json"
    }
  }
}
```

### 2. 直接执行器验证 Native Codex 能力

命令：

```bash
npx tsx -e "import { NativeCodexExecutor } from './src/lib/providers/native-codex-executor.ts'; const ex = new NativeCodexExecutor(); ex.executeTask({workspace:'/Users/darrel/Documents/Antigravity-Mobility-CLI',prompt:'Reply with exactly: NATIVE_CODEX_DIRECT_OK', timeout: 120000}).then(r=>console.log(JSON.stringify(r,null,2)))"
```

结果摘要：

```json
{
  "content": "NATIVE_CODEX_DIRECT_OK",
  "status": "completed"
}
```

说明：

- Native Codex OAuth token 可用
- 与 `chatgpt.com/backend-api/codex` 的实际调用成功

### 3. 首次产品链路失败原因

首次用模板 run 显式传 `provider: native-codex` 时，run 创建成功，但执行失败。

失败 run：

- `88d11a4c-140f-49c4-8909-b9c270ef134b`

关键错误：

```json
{
  "provider": "native-codex",
  "backend": "native-codex",
  "lastError": "Native Codex execution failed: Native Codex API error 400: {\"detail\":\"The 'MODEL_PLACEHOLDER_M26' model is not supported when using Codex with a ChatGPT account.\"}"
}
```

这证明：

- provider 路由已经正确落到 `native-codex`
- 真正的阻断是 **模型 ID 不兼容**

### 4. 修复

#### 修复 A：Native Codex 模型归一化

文件：

- `src/lib/bridge/native-codex-adapter.ts`

行为：

- 支持原生模型名直接透传：`gpt-5.4` / `gpt-5.4-mini` / `gpt-5.3-codex` / `gpt-5.2-codex`
- 内部占位模型自动映射：
  - `MODEL_PLACEHOLDER_M26` → `gpt-5.4`
  - `MODEL_PLACEHOLDER_M47` → `gpt-5.4-mini`
  - `MODEL_AUTO` → `gpt-5.4`
- 其他未知模型回退到 `gpt-5.4`

#### 修复 B：AI config 缓存按文件变更自动刷新

文件：

- `src/lib/providers/ai-config.ts`

行为：

- 缓存区分 `file / override / default`
- 对磁盘文件缓存增加 `mtimeMs` 检查
- `PUT /api/ai-config` 保存后，其他路由再次读取时会因文件 mtime 变化而自动 reload

### 5. 修复后模板 run 成功

请求：

```bash
POST /api/agent-runs
{
  "workspace": "file:///Users/darrel/Documents/Antigravity-Mobility-CLI",
  "prompt": "Do not modify any files. Reply with exactly NATIVE_CODEX_TEMPLATE_OK",
  "templateId": "coding-basic-template",
  "stageId": "coding-basic",
  "provider": "native-codex"
}
```

成功 run：

- `9e9a3e36-b81a-4db9-bc72-6b17aac648df`

关键结果：

```json
{
  "status": "completed",
  "provider": "native-codex",
  "sessionProvenance": {
    "backendId": "native-codex",
    "model": "MODEL_PLACEHOLDER_M26"
  },
  "result": {
    "summary": "NATIVE_CODEX_TEMPLATE_OK"
  }
}
```

说明：

- 即使上层仍传 `MODEL_PLACEHOLDER_M26`
- Native Codex 链路也能自动映射并成功执行

### 6. 修复后 prompt mode 成功

临时将 `execution` layer 切到 `native-codex` 后，执行：

```bash
POST /api/agent-runs
{
  "workspace": "file:///Users/darrel/Documents/Antigravity-Mobility-CLI",
  "prompt": "Reply with exactly: NATIVE_CODEX_PROMPT_OK",
  "executionTarget": { "kind": "prompt" }
}
```

成功 run：

- `69b463c1-441e-4bba-a167-3420ca78e460`

关键结果：

```json
{
  "status": "completed",
  "sessionProvenance": {
    "backendId": "native-codex",
    "model": "MODEL_PLACEHOLDER_M26"
  },
  "result": {
    "summary": "NATIVE_CODEX_PROMPT_OK"
  }
}
```

说明：

- `ai-config` provider 切换在其他 API 路由中已可见
- prompt mode 已真正走到 `native-codex`

---

## 测试后清理

测试过程中临时把 `execution` layer 设置为 `native-codex`，完成后已恢复为：

```json
{
  "defaultProvider": "antigravity",
  "layers": {
    "executive": { "provider": "antigravity" },
    "management": { "provider": "antigravity" },
    "execution": { "provider": "antigravity" },
    "utility": { "provider": "antigravity" }
  }
}
```

如需正式切换，可在 Settings 中再次将 `execution` 或默认 provider 调整为 `Codex Native (OAuth)`。
