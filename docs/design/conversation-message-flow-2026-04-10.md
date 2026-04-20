# Conversation 消息发送链路

日期：2026-04-10  
状态：说明文档 / 当前实现快照

## 一句话结论

当前 Conversation 的发送消息逻辑，不是分散成很多套完全不同的实现，而是：

1. 上层有多个入口
2. 中间有 Session / Provider 两层承接
3. 如果目标是 Antigravity conversation，最终都会收敛到同一个 gRPC 叶子：`grpc.sendMessage()`

也就是说，真正需要记住的不是“每个地方都怎么发”，而是：

1. **谁在触发发送**
2. **它是直接发已有 conversation，还是先创建 conversation 再发第一条消息**
3. **目标 provider 是 Antigravity 还是 Codex**

---

## 1. 总体分层

当前代码里的消息发送可以分成 4 层。

## 1.1 入口层

负责接住“用户/系统现在要发一条消息”这个动作。

主要入口有：

1. Web Conversation API
2. Agent runtime 内部的 nudge / attached session / shared-conversation role switch
3. Provider executor 在新 conversation 创建后发送第一条 prompt

## 1.2 Session 层

负责把“给一个正在运行的会话追加消息”统一成 `session.append()` 语义。

这里的价值是：

1. orchestration 层不直接碰 transport
2. 不同 provider 都先走统一 Session 合同

## 1.3 Provider / Backend 层

负责把 append / start 之类的语义转换成具体 provider 的发送动作。

当前最典型的是：

1. Antigravity backend / executor
2. Codex backend / executor

## 1.4 Transport 叶子层

如果是 Antigravity，会最终落到：

1. `src/lib/bridge/grpc.ts` 的 `sendMessage()`

它最终调用的是：

1. `SendUserCascadeMessage`

---

## 2. Web Conversation API 的发送路径

用户在 Web conversation 界面里发送消息，当前入口是：

1. `src/app/api/conversations/[id]/send/route.ts`

这条路径做的事是：

1. 解析文本和文件引用
2. 把文本 / 文件 mention 打包成 attachments.items
3. 刷新 owner map（必要时）
4. 最终调用 `grpc.sendMessage(...)`

因此这条路径本质上是：

1. **API route 直接发已有 cascade 的消息**

它不经过 AgentSession，因为它本来就是一条“面向已有 conversation 的 Web API”。

---

## 3. Runtime 内部的发送路径

这部分是现在更容易混淆的地方。

## 3.1 nudge / attached session

在 runtime 里，如果要给一个正在运行的会话继续发消息，当前不会让 orchestration 层直接调 gRPC，而是先走：

1. `AgentSession.append()`

典型上层调用点包括：

1. `src/lib/agents/group-runtime.ts` 中 intervention 的 nudge
2. shared-conversation 下的 attached role switch

真正的 Antigravity Session append 承接点在：

1. `src/lib/backends/builtin-backends.ts` 的 `AntigravityAgentSession.append()`

这里会：

1. 先解析 owner connection
2. 再调用 `grpc.sendMessage(...)`

所以这条链是：

1. orchestration
2. AgentSession.append
3. AntigravityAgentSession.append
4. grpc.sendMessage

## 3.2 shared-conversation role switch

shared-conversation 不是新建 author conversation 再跑一遍，而是：

1. 构造 `switch prompt`
2. 通过 attached session 给已有 author cascade 追加一条消息

因此 shared-conversation 的“发消息”本质也是 append，只是 prompt 的语义不是普通用户聊天，而是：

1. 角色切换
2. 继续同一条会话里的下一轮任务

---

## 4. 新 conversation 的首条消息路径

这条路径和“给已有 conversation 追加消息”不是同一类。

## 4.1 Web conversation 新建

新建 conversation 的入口在：

1. `src/app/api/conversations/route.ts`

这条路径会：

1. `addTrackedWorkspace`
2. `startCascade`
3. `updateConversationAnnotations`
4. 返回 cascadeId

它本身不一定在这里就发业务 prompt；主要职责是把 conversation 建起来。

## 4.2 Antigravity executor 的首条 prompt

如果是 runtime / template / role execution 触发的新任务，新建 conversation 后的第一条 prompt 通常由：

1. `src/lib/providers/antigravity-executor.ts`

负责发送。

这条链是：

1. 找到 server
2. `startCascade`
3. 写 annotation
4. `grpc.sendMessage(...)` 发第一条 workflow prompt

因此它是：

1. **先建 conversation，再发首条 prompt**

这和 Web send route 的“给已有 conversation 发消息”是两件事。

---

## 5. Codex 路径有什么不同

Codex 不走 Antigravity 的 gRPC conversation transport。

所以它的发送消息链虽然在上层仍然会表现成：

1. Session.append

但真正叶子不是 `grpc.sendMessage()`，而是：

1. `src/lib/providers/codex-executor.ts` 的 `appendMessage()`

也就是说：

1. **上层语义统一**
2. **叶子 transport 不统一**

这也是为什么现在系统要把消息发送拆成：

1. orchestration 语义
2. session 合同
3. provider 叶子

而不是让所有上层直接依赖 Antigravity gRPC。

---

## 6. 当前最值得记住的承接点

如果你只想抓住当前实现里真正关键的 5 个点，记住下面这些就够了。

## 6.1 Antigravity conversation 的统一 transport 叶子

1. `src/lib/bridge/grpc.ts` 的 `sendMessage()`

## 6.2 Web 对已有 conversation 发消息的入口

1. `src/app/api/conversations/[id]/send/route.ts`

## 6.3 Runtime 对已有会话追加消息的统一入口

1. `AgentSession.append()`

## 6.4 Antigravity session append 的具体承接点

1. `src/lib/backends/builtin-backends.ts` 的 `AntigravityAgentSession.append()`

## 6.5 新任务首条 prompt 的发送承接点

1. `src/lib/providers/antigravity-executor.ts`

---

## 7. 一句话判断

当前 Conversation 的发送消息逻辑可以这样理解：

1. **已有 Antigravity conversation 的消息追加，最终统一落到 `grpc.sendMessage()`**
2. **不同入口只是决定谁来调用它：Web route、Session.append、还是 executor start 流程**
3. **Codex 只复用上层 append 语义，不复用 Antigravity 的 gRPC transport**