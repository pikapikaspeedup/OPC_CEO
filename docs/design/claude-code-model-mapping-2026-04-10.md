# Claude Code 与 Antigravity 模型映射

日期：2026-04-10  
状态：映射文档 / PoC 前置

## 一句话结论

如果后面要把 Claude Code 接入 Antigravity，最关键的不是先写 adapter 代码，而是先把概念映射对齐。

最核心的一句话是：

1. **Claude Code 的 session 只能映射到我们的 execution thread / Conversation 层，不能抬升成 Run / Stage 真相源。**

---

## 1. 先写死两个世界各自的主语

## 1.1 Antigravity 的主语

Antigravity 当前平台真正的主语是：

1. Project
2. Run
3. Stage
4. artifact / result contract
5. intervention / scheduler / governance

这些语义属于：

1. control plane

## 1.2 Claude Code 的主语

Claude Code 更接近这些主语：

1. workspace
2. session / conversation thread
3. message loop / tool loop
4. provider / model
5. tool execution / permission flow

这些语义属于：

1. execution plane

所以两边不是“同一套对象名不同”，而是：

1. 一边是平台调度语义
2. 一边是执行运行时语义

---

## 2. 核心映射表

| Antigravity | Claude Code | 说明 |
|:---|:---|:---|
| Project | 无直接一一对应 | Project 是平台级业务容器，Claude Code 没有这个主语 |
| Run | 一次受控执行任务 | Claude Code 没有原生 Run 真相源，PoC 里应由 Antigravity 保持 Run ownership |
| Stage | 无直接一一对应 | Stage 是平台派发语义，不应交给 Claude Code |
| Conversation / childConversationId | Claude session / thread | 这是最接近的一层，但只能映射 execution thread |
| ProviderId / backend | Claude provider / model adapter | 属于 execution plane 配置层 |
| Step / liveState | Claude tool loop / streamed events | 需要做事件映射与压缩 |
| artifact / result envelope | Claude 运行产出 | 需要 Antigravity 自己做归一化，不应直接吃 Claude 原始结构 |
| intervention: nudge / attach / cancel / evaluate | Claude session append / resume / cancel / inspect 能力 | 需要 adapter 转译，不能直接裸透传 Claude 内部合同 |

---

## 3. 最重要的 5 个映射关系

## 3.1 Run 不等于 Claude session

这是最重要的边界。

正确关系是：

1. 一个 Antigravity Run 可以持有一个外部 Claude session handle
2. 但 Run 本身不能退化成 Claude session

因为 Run 还承担：

1. stage 语义
2. project / pipeline 同步
3. governance / scheduler / approval
4. artifact / result 真相源

所以更准确的说法是：

1. **Run owns the external Claude session handle**
2. **Run is not the Claude session itself**

## 3.2 Conversation 最接近 Claude session

如果一定要找最像的一层，Claude session 最接近：

1. childConversationId
2. activeConversationId
3. execution thread handle

也就是说，Claude session 应该被放在：

1. execution thread / Conversation 层

而不是：

1. Project 层
2. Run 业务语义层
3. Stage 派发层

## 3.3 Stage 应保持平台 ownership

Claude Code 并没有原生的 Stage 主语。

所以 PoC 正确做法不是“让 Claude Code 理解 Stage”，而是：

1. Antigravity 先决定当前 Stage
2. 再把 Stage 目标转成 prompt / context / input artifacts
3. 最后派给 Claude Code 执行

也就是说：

1. Claude Code 执行 Stage
2. 但不拥有 Stage 定义权

## 3.4 Tool loop / event 流要映射成我们的 Step / liveState

Claude Code 的工具调用、流式输出、session 事件，不应直接塞进我们平台模型。

正确做法是：

1. Claude 原始事件
2. 映射到 Antigravity 的 Step / liveState / result envelope
3. 保持平台上层只认自己定义的 contract

这一步本质上就是：

1. execution adapter
2. event adapter

## 3.5 Permission / approval 只能接到 execution plane

Claude Code 本身会有工具权限、用户批准、运行期交互。

这类东西应该被映射成：

1. execution plane 的 permission / approval 事件

而不应该直接变成：

1. Antigravity 平台治理规则本身

否则平台会开始围着 Claude 的 permission 流转。

---

## 4. 如果做 Claude Code PoC，最合理的落位

当前最合理的落位不是“把 Claude Code 接成一个新平台”，而是：

1. 把它接成一个新的 AgentBackend / external executor adapter

更具体地说：

1. 输入
  - workspacePath
  - prompt
  - stage metadata
  - artifactDir
  - parentConversationId 或 external handle
2. 输出
  - external session handle
  - normalized liveState
  - normalized steps
  - normalized result envelope

因此 PoC 里的 Claude Code 位置应该是：

1. Native Executor、Direct Open API backend 旁边的另一种 execution backend

不是：

1. control plane 替代品

---

## 5. 最容易犯错的错误映射

下面这些映射最危险，PoC 里一定要避开。

## 错误 1：把 Claude session 当 Run

后果：

1. Run 业务语义被外部 runtime 塑形

## 错误 2：让 Claude Code 直接拥有 Stage 定义权

后果：

1. 平台派发语义丢失
2. project pipeline 无法保持统一

## 错误 3：直接吃 Claude 原始 event / tool shape

后果：

1. 你的上层模型会开始围着 Claude 事件结构长

## 错误 4：把 Claude permission flow 当平台治理

后果：

1. approval / governance 的 ownership 被反向交出去

---

## 6. 最推荐的映射口径

如果你后面要开 Claude Code PoC，我建议把映射口径写死成下面这句：

> Claude Code 是 execution backend；Claude session 映射 execution thread / Conversation；Run / Stage / artifact / governance 仍然由 Antigravity 平台自己拥有。

如果这句话在 PoC 里一直不被破坏，那条路就基本走对了。