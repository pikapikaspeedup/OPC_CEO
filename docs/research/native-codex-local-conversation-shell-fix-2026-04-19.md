# Native Codex 本地会话壳修复（2026-04-19）

## 背景

在全局 provider 已切到 `native-codex` 后，前端对话壳仍然主要绑定：

- Antigravity language server
- 旧 `codex-*` 本地会话分支
- gRPC conversation / steps 读取模型

直接导致两类核心问题：

1. `CEO Office` 左栏 `+` 点击后 `POST /api/conversations` 返回 `503 workspace_not_running`
2. 就算本地 conversation 能创建，聊天页也看不到可渲染的 transcript，因为旧 `codex` 假 steps 结构不符合 `Chat` 组件期望的 `CORTEX_STEP_TYPE_*`

## 根因

### 1. create 路由只特判旧 `codex`

`src/app/api/conversations/route.ts`

- 之前只有 `provider === 'codex'` 时才走“免 IDE 本地会话”
- `native-codex` 仍会掉回 Antigravity language server 路径

### 2. send / steps 只识别 `codex-*`

`src/app/api/conversations/[id]/send/route.ts`

- 只对 `codex-*` 走本地 append
- 其它 conversation 全部走 `getOwnerConnection() + grpc.sendMessage()`

`src/app/api/conversations/[id]/steps/route.ts`

- 同样只给 `codex-*` 做本地 transcript 回放

### 3. 本地 transcript 结构不兼容前端 Chat

旧本地 steps 写的是：

- `kind = CORTEX_STEP_KIND_MESSAGE`
- `assistantMessage.prompt/response`

但 `src/components/chat.tsx` 实际只渲染：

- `CORTEX_STEP_TYPE_USER_INPUT`
- `CORTEX_STEP_TYPE_PLANNER_RESPONSE`
- 等标准 CORTEX step 类型

### 4. 本地会话没有 WS，发送后页面也不会自动刷新

`page.tsx` 原本依赖：

- `loadSteps(id)` 首次加载
- WebSocket `subscribe` 实时更新

本地 provider conversation 没有 owner server，也没有 step stream，所以发送后即使后端成功，前端也不会主动 reload。

## 本次修复

### 1. conversations create 路由补齐 `native-codex`

`src/app/api/conversations/route.ts`

- 当 `resolveProvider('execution', workspacePath)` 命中：
  - `codex`
  - `native-codex`
- 直接创建本地 conversation，不再强依赖 IDE / language server
- 新的本地会话 ID 采用：
  - `local-codex-*`
  - `local-native-codex-*`

### 2. conversations 列表补回本地会话

`GET /api/conversations`

- 之前主路径只枚举 `.pb` 会话文件
- 现在会把 `getConversations()` 中仅存在于本地缓存 / SQLite 的 conversation 也合并进结果

这一步修掉了：

- 新会话创建成功但左栏历史看不见

### 3. send / steps 路由改成 provider-aware

`src/app/api/conversations/[id]/send/route.ts`

- 根据：
  - local record 的 `provider`
  - conversation id 前缀
- 识别本地 provider conversation
- 首次消息走：
  - `executor.executeTask(...)`
- 后续消息优先走：
  - `executor.appendMessage(sessionHandle, ...)`
- append 失败时自动回退到 fresh `executeTask(...)`

`src/app/api/conversations/[id]/steps/route.ts`

- 本地 provider conversation 直接读取本地 transcript

### 4. 新增统一的本地 transcript helper

新增：

- `src/lib/local-provider-conversations.ts`

职责：

- 生成本地 conversation id
- 识别 `codex` / `native-codex`
- 将本地 transcript 统一序列化为前端可渲染的标准 step：
  - `CORTEX_STEP_TYPE_USER_INPUT`
  - `CORTEX_STEP_TYPE_PLANNER_RESPONSE`
- 兼容读取旧 `.codex.json`

### 5. 前端本地 conversation 不再误走 WS / revert

`src/app/page.tsx`

- 本地 provider conversation 不再发送 WS `subscribe`
- `send` 成功后主动 `loadSteps(activeId)`
- 本地 conversation 隐藏 inline revert，避免点到仍依赖 gRPC 的旧控制面

### 6. CEO Office `+` 增加可访问名称和失败反馈

`src/components/sidebar.tsx`

- `aria-label = "新建 CEO 对话"`
- `title = "新建 CEO 对话"`
- 创建失败时不再静默吞掉

### 7. 临时关闭旧 `CodexWidget` 的多轮 session 入口

`src/components/codex-widget.tsx`

- `Ops` 里的 `CodexWidget` 仍保留一条独立 legacy 路径：
  - `/api/codex/sessions`
  - `/api/codex/sessions/[threadId]`
- 本机实测：
  - `POST /api/codex/sessions -> 500`
  - `error = "codex mcp-server exited with code 0"`
- 为避免前端继续撞这个错误，本轮先在 UI 层禁用 `多轮对话`
- 保留 `单次执行`
- 并明确提示用户主系统请使用 Native Codex 的 `CEO Office / Conversations` 对话壳

## 验证

### 自动化测试

```bash
npm test -- src/app/api/conversations/route.test.ts 'src/app/api/conversations/[id]/send/route.test.ts' 'src/app/api/conversations/[id]/steps/route.test.ts'
```

结果：

- `3 passed`
- `5 passed`

覆盖点：

- `native-codex` 创建本地 conversation
- Antigravity workspace 仍走原 language-server 分支
- 本地 provider send 走 executor，不走 gRPC
- 本地 provider steps 可回放标准 CORTEX step

### lint

```bash
npx eslint src/app/api/conversations/route.ts 'src/app/api/conversations/[id]/send/route.ts' 'src/app/api/conversations/[id]/steps/route.ts' src/components/sidebar.tsx src/lib/local-provider-conversations.ts src/app/api/conversations/route.test.ts 'src/app/api/conversations/[id]/send/route.test.ts' 'src/app/api/conversations/[id]/steps/route.test.ts'
```

结果：

- 通过

### API smoke

1. CEO Office / Native Codex 创建

```json
{
  "status": 200,
  "body": {
    "cascadeId": "local-native-codex-7f8498a5-a7a9-4aec-9d3d-167ecffccdc2",
    "state": "idle",
    "provider": "native-codex"
  }
}
```

2. Playground / Antigravity 特例未破坏

```json
{
  "status": 200,
  "body": {
    "cascadeId": "4024befe-bed9-414c-8a46-96c1f19cd581"
  }
}
```

3. 本地会话 send

```json
{
  "status": 200,
  "body": {
    "ok": true,
    "data": {
      "cascadeId": "local-native-codex-7f8498a5-a7a9-4aec-9d3d-167ecffccdc2",
      "state": "idle",
      "provider": "native-codex"
    }
  }
}
```

4. 本地会话 steps

```json
{
  "status": 200,
  "stepCount": 2,
  "firstTwo": [
    {
      "type": "CORTEX_STEP_TYPE_USER_INPUT"
    },
    {
      "type": "CORTEX_STEP_TYPE_PLANNER_RESPONSE"
    }
  ]
}
```

### 浏览器验证（bb-browser）

- `CEO Office` 页左栏 `+` 现在可被识别为：
  - `button "新建 CEO 对话"`
- 点击后浏览器实际抓到：
  - `POST /api/conversations -> 200`
  - `GET /api/conversations/local-native-codex-.../steps -> 200`
- 在新本地 CEO 会话中发送消息后，浏览器实际抓到：
  - `POST /api/conversations/local-native-codex-.../send -> 200`
  - `GET /api/conversations/local-native-codex-.../steps -> 200`

## 结论

这次修复后，前端 conversation shell 与 Native Codex 的关系从“后端 run 已适配、前端对话壳未适配”变成了：

- `create`：可本地创建
- `list`：可在侧栏看到
- `send`：可本地发送
- `steps`：可前端渲染
- `page refresh`：发送后立即刷新 transcript

同时保留：

- Antigravity workspace 仍走原有 language server / gRPC 路径
- Playground 特例仍能创建真实 Antigravity cascade
