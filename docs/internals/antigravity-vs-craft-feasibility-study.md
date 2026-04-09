# Antigravity 是否应直接基于 craft-agents 继续开发

日期：2026-04-07  
状态：已按控制层 / 执行层概念重写  
范围：静态架构研究，目标仓库为 Antigravity 与 craft-agents

## 一句话结论

按新的概念对齐来看，这个问题不该再问成“Antigravity 要不要基于 craft 重做”，而应该问成：

> craft 适不适合作为 Antigravity 平台下面的下层执行壳。

在这个口径下，结论很清楚：

1. **不建议把 Antigravity 平台直接建立在 craft 之上**
2. **建议保留 Antigravity 作为控制层 / 平台主系统**
3. **craft 可以作为下层 execution shell 的参考对象，甚至未来可作为一个可选执行器接入**

所以这不是“谁替代谁”的问题，而是“谁位于哪一层”的问题。

---

## 1. 正确的比较基线

如果不先拆层，关于 craft 的讨论很容易一直失真。

### 1.1 Antigravity 现在已经不是单一执行器产品

按当前系统形态，Antigravity 应被理解成一个平台：

1. 上面有 OPC / CEO / Scheduler / Approval / Department
2. 中间有 Project / Run / Stage / review-loop / artifact 真相源
3. 下面才是一个或多个执行器

也就是说，Antigravity 的主系统已经更接近**控制层**。

### 1.2 craft 更接近 execution shell

craft 的重心是：

1. workspace
2. session
3. backend
4. event
5. permission / source / auth

它更像“下层受控执行 runtime”，而不是 Project / Run / Stage / governance 这种平台级控制层。

### 1.3 所以这两个东西不在同一层

更准确的比较关系应该是：

1. **Antigravity Platform / Control Plane**
2. 对比 **craft 作为 execution shell**

而不是：

1. 整个平台 Antigravity
2. 对比 craft 整个产品壳

---

## 2. craft 真正擅长什么

如果只看执行层，craft 的优势很明确。

### 2.1 session / backend / event 抽象更自然

craft 的核心就是：

1. backend 统一
2. session 统一
3. event 统一
4. provider 差异下沉

这比当前很多“先有任务，再去适配 provider”的实现方式更像一个通用 execution shell。

### 2.2 第三方 provider 路线更像 execution substrate

craft 本来就更适合承载“多个不同 provider 的执行壳”：

1. Anthropic 路线
2. 第三方兼容 provider 路线
3. 统一 session / event 收口

从 execution plane 的角度看，它比一个完整 coding product 更容易被顶层系统调用。

### 2.3 workspace-based + permission-based 的执行边界更清楚

craft 的价值不在于“它也有文件夹”，而在于：

1. 它把 workspace 当 execution boundary
2. 它把 session 当 runtime object
3. 它把 permission / source / tool call 放在下层 runtime 里解决

这正是下层执行器应该擅长的事情。

---

## 3. Antigravity 顶层真正要保留什么

craft 再强，也不该替代 Antigravity 平台已经长出来的上层真相源。

必须保留在 Antigravity 控制层的东西包括：

1. Project
2. Run
3. Stage
4. review-loop
5. source contract
6. artifact 真相源
7. scheduler / CEO / approval / governance

这些东西的共同点是：

1. 它们回答的是“做什么、为什么做、谁批准、如何追踪、何时继续”
2. 而不是“agent 在 workspace 里具体怎么改代码”

这就是为什么 Antigravity 现在最有价值的部分不在于“会不会调一个模型”，而在于已经长出了平台级控制层。

---

## 4. 在新口径下，结论应该怎么重写

### 4.1 不建议直接以 craft 为基座

现在的不建议，理由不再是“它们都像 workspace 产品，所以冲突”，而是更精确的这句：

> craft 位于 execution shell 层，Antigravity 已经长到 control plane 层，二者层次不同。

如果直接以 craft 为基座，风险不是 provider 接不上，而是：

1. 你会把已经长出来的控制层重新压扁成 session-first 产品壳
2. Project / Run / Stage / governance 会被迫去适配 craft 的 session 语义
3. 平台最稀缺的上层资产反而会被稀释

### 4.2 但可以把 craft 当成下层执行壳

这才是更合理的落点。

在这个模式下：

1. Antigravity 控制层继续决定任务生命周期
2. craft 负责在给定 workspace 中实际执行一次任务
3. craft 回传 started / completed / failed / cancelled 之类的 execution 信号
4. Antigravity 把它们映射回 Run / Project / Stage 真相源

这种关系是合理的。

### 4.3 所以答案不是“完全不用”

更准确的答案是：

1. **不用 craft 来承接整个平台**
2. **可以用 craft 承接执行层的一部分能力**
3. **更值得借的是它的 execution shell 思路，而不是整个产品壳**

---

## 5. 真正值得复用的层

如果要从 craft 吸收东西，优先级应该是下面这些。

### 5.1 backend / session / event 分层

这是最值得借的地方。

它和当前 Antigravity 正在推进的 AgentBackend / AgentSession / session-consumer 方向是一致的。

### 5.2 capability-driven executor model

以后 execution plane 不应该再隐式假设：

1. 所有 provider 都有 append
2. 所有 provider 都有 watcher
3. 所有 provider 都有 IDE 级 live state

craft 的思路提醒我们：

1. 执行器可以能力不等
2. 但必须合同清楚

### 5.3 第三方 provider 兼容思路

如果目标是支持第三方 API，craft 更值得借的不是 UI，而是：

1. 多 provider execution substrate
2. 第三方 provider 路由方式
3. 下层兼容、上层统一的事件模型

---

## 6. 最不该复用的层

下面这些层最不适合直接搬进 Antigravity 主系统。

### 6.1 workspace / session 作为产品真相源

这会直接冲掉 Antigravity 已经存在的：

1. Project
2. Run
3. Stage
4. governance

### 6.2 整个 SessionManager 产品壳

它适合做 execution runtime，不适合直接做平台主心脏。

### 6.3 整套 UI 壳

Antigravity 现在的方向已经不是 IDE shell，而是 OPC / CEO / Project 平台。

---

## 7. 最合理的技术路线

如果你的目标是：

1. 顶层继续做 OPC / CEO / Project 平台
2. 下层逐步支持第三方 API 与更多执行器

那最合理的路线应该是：

### Step 1

继续把 Antigravity 的控制层 / 执行层边界收口。

也就是继续完成当前 AgentBackend 和 Task B 方向。

### Step 2

把 execution plane 的接入合同写死：

1. session lifecycle
2. capability matrix
3. terminal semantics
4. artifact / result 回传要求

### Step 3

只做一个最小 execution shell 实验。

不是接整个 craft，而是验证：

1. 一个单 stage
2. 是否能通过外部 execution shell 跑通
3. 上层仍由 Antigravity 控制层维护真相源

### Step 4

验证通过后，再决定：

1. 只是借设计
2. 还是把 craft 真接成一个可选 executor

---

## 8. 最终判断

用新的控制层 / 执行层视角重写后，这份研究最准确的结论是：

1. **Antigravity 不该基于 craft 重做**
2. **craft 很适合作为 Antigravity 下层 execution shell 的参考对象**
3. **未来甚至可以把 craft 作为一个可选下层执行器接进来**
4. **但平台的控制层真相源，必须继续掌握在 Antigravity 自己手里**

一句话总结：

> 不把 craft 当地基，可以把 craft 当发动机舱里的一个引擎选项。
# Antigravity 是否应直接基于 craft-agents 继续开发

日期：2026-04-07  
状态：已按控制层 / 执行层概念重写  
范围：静态架构研究，目标仓库为 Antigravity 与 craft-agents

## 一句话结论

按新的概念对齐来看，这个问题不该再问成“Antigravity 要不要基于 craft 重做”，而应该问成：

> craft 适不适合作为 Antigravity 平台下面的下层执行壳。

在这个口径下，结论很清楚：

1. **不建议把 Antigravity 平台直接建立在 craft 之上**
2. **建议保留 Antigravity 作为控制层 / 平台主系统**
3. **craft 可以作为下层 execution shell 的参考对象，甚至未来可作为一个可选执行器接入**

所以这不是“谁替代谁”的问题，而是“谁位于哪一层”的问题。

---

## 1. 正确的比较基线

如果不先拆层，关于 craft 的讨论很容易一直失真。

### 1.1 Antigravity 现在已经不是单一执行器产品

按当前系统形态，Antigravity 应被理解成一个平台：

1. 上面有 OPC / CEO / Scheduler / Approval / Department
2. 中间有 Project / Run / Stage / review-loop / artifact 真相源
3. 下面才是一个或多个执行器

也就是说，Antigravity 的主系统已经更接近**控制层**。

### 1.2 craft 更接近 execution shell

craft 的重心是：

1. workspace
2. session
3. backend
4. event
5. permission / source / auth

它更像“下层受控执行 runtime”，而不是 Project / Run / Stage / governance 这种平台级控制层。

### 1.3 所以这两个东西不在同一层

更准确的比较关系应该是：

1. **Antigravity Platform / Control Plane**
2. 对比 **craft 作为 execution shell**

而不是：

1. 整个平台 Antigravity
2. 对比 craft 整个产品壳

---

## 2. craft 真正擅长什么

如果只看执行层，craft 的优势很明确。

### 2.1 session / backend / event 抽象更自然

craft 的核心就是：

1. backend 统一
2. session 统一
3. event 统一
4. provider 差异下沉

这比当前很多“先有任务，再去适配 provider”的实现方式更像一个通用 execution shell。

### 2.2 第三方 provider 路线更像 execution substrate

craft 本来就更适合承载“多个不同 provider 的执行壳”：

1. Anthropic 路线
2. 第三方兼容 provider 路线
3. 统一 session / event 收口

从 execution plane 的角度看，它比一个完整 coding product 更容易被顶层系统调用。

### 2.3 workspace-based + permission-based 的执行边界更清楚

craft 的价值不在于“它也有文件夹”，而在于：

1. 它把 workspace 当 execution boundary
2. 它把 session 当 runtime object
3. 它把 permission / source / tool call 放在下层 runtime 里解决

这正是下层执行器应该擅长的事情。

---

## 3. Antigravity 顶层真正要保留什么

craft 再强，也不该替代 Antigravity 平台已经长出来的上层真相源。

必须保留在 Antigravity 控制层的东西包括：

1. Project
2. Run
3. Stage
4. review-loop
5. source contract
6. artifact 真相源
7. scheduler / CEO / approval / governance

这些东西的共同点是：

1. 它们回答的是“做什么、为什么做、谁批准、如何追踪、何时继续”
2. 而不是“agent 在 workspace 里具体怎么改代码”

这就是为什么 Antigravity 现在最有价值的部分不在于“会不会调一个模型”，而在于已经长出了平台级控制层。

---

## 4. 在新口径下，结论应该怎么重写

### 4.1 不建议直接以 craft 为基座

现在的不建议，理由不再是“它们都像 workspace 产品，所以冲突”，而是更精确的这句：

> craft 位于 execution shell 层，Antigravity 已经长到 control plane 层，二者层次不同。

如果直接以 craft 为基座，风险不是 provider 接不上，而是：

1. 你会把已经长出来的控制层重新压扁成 session-first 产品壳
2. Project / Run / Stage / governance 会被迫去适配 craft 的 session 语义
3. 平台最稀缺的上层资产反而会被稀释

### 4.2 但可以把 craft 当成下层执行壳

这才是更合理的落点。

在这个模式下：

1. Antigravity 控制层继续决定任务生命周期
2. craft 负责在给定 workspace 中实际执行一次任务
3. craft 回传 started / completed / failed / cancelled 之类的 execution 信号
4. Antigravity 把它们映射回 Run / Project / Stage 真相源

这种关系是合理的。

### 4.3 所以答案不是“完全不用”

更准确的答案是：

1. **不用 craft 来承接整个平台**
2. **可以用 craft 承接执行层的一部分能力**
3. **更值得借的是它的 execution shell 思路，而不是整个产品壳**

---

## 5. 真正值得复用的层

如果要从 craft 吸收东西，优先级应该是下面这些。

### 5.1 backend / session / event 分层

这是最值得借的地方。

它和当前 Antigravity 正在推进的 AgentBackend / AgentSession / session-consumer 方向是一致的。

### 5.2 capability-driven executor model

以后 execution plane 不应该再隐式假设：

1. 所有 provider 都有 append
2. 所有 provider 都有 watcher
3. 所有 provider 都有 IDE 级 live state

craft 的思路提醒我们：

1. 执行器可以能力不等
2. 但必须合同清楚

### 5.3 第三方 provider 兼容思路

如果目标是支持第三方 API，craft 更值得借的不是 UI，而是：

1. 多 provider execution substrate
2. 第三方 provider 路由方式
3. 下层兼容、上层统一的事件模型

---

## 6. 最不该复用的层

下面这些层最不适合直接搬进 Antigravity 主系统。

### 6.1 workspace / session 作为产品真相源

这会直接冲掉 Antigravity 已经存在的：

1. Project
2. Run
3. Stage
4. governance

### 6.2 整个 SessionManager 产品壳

它适合做 execution runtime，不适合直接做平台主心脏。

### 6.3 整套 UI 壳

Antigravity 现在的方向已经不是 IDE shell，而是 OPC / CEO / Project 平台。

---

## 7. 最合理的技术路线

如果你的目标是：

1. 顶层继续做 OPC / CEO / Project 平台
2. 下层逐步支持第三方 API 与更多执行器

那最合理的路线应该是：

### Step 1

继续把 Antigravity 的控制层 / 执行层边界收口。

也就是继续完成当前 AgentBackend 和 Task B 方向。

### Step 2

把 execution plane 的接入合同写死：

1. session lifecycle
2. capability matrix
3. terminal semantics
4. artifact / result 回传要求

### Step 3

只做一个最小 execution shell 实验。

不是接整个 craft，而是验证：

1. 一个单 stage
2. 是否能通过外部 execution shell 跑通
3. 上层仍由 Antigravity 控制层维护真相源

### Step 4

验证通过后，再决定：

1. 只是借设计
2. 还是把 craft 真接成一个可选 executor

---

## 8. 最终判断

用新的控制层 / 执行层视角重写后，这份研究最准确的结论是：

1. **Antigravity 不该基于 craft 重做**
2. **craft 很适合作为 Antigravity 下层 execution shell 的参考对象**
3. **未来甚至可以把 craft 作为一个可选下层执行器接进来**
4. **但平台的控制层真相源，必须继续掌握在 Antigravity 自己手里**

一句话总结：

> 不把 craft 当地基，可以把 craft 当发动机舱里的一个引擎选项。# Antigravity 是否应直接基于 craft-agents 继续开发

日期：2026-04-07  
状态：已按控制层 / 执行层概念重写  
范围：静态架构研究，目标仓库为 Antigravity 与 craft-agents

## 一句话结论

按新的概念对齐来看，这个问题不该再问成“Antigravity 要不要基于 craft 重做”，而应该问成：

> craft 适不适合作为 Antigravity 平台下面的下层执行壳。

在这个口径下，结论很清楚：

1. **不建议把 Antigravity 平台直接建立在 craft 之上**
2. **建议保留 Antigravity 作为控制层 / 平台主系统**
3. **craft 可以作为下层 execution shell 的参考对象，甚至未来可作为一个可选执行器接入**

所以这不是“谁替代谁”的问题，而是“谁位于哪一层”的问题。

---

## 1. 正确的比较基线

如果不先拆层，关于 craft 的讨论很容易一直失真。

### 1.1 Antigravity 现在已经不是单一执行器产品

按当前系统形态，Antigravity 应被理解成一个平台：

1. 上面有 OPC / CEO / Scheduler / Approval / Department
2. 中间有 Project / Run / Stage / review-loop / artifact 真相源
3. 下面才是一个或多个执行器

也就是说，Antigravity 的主系统已经更接近**控制层**。

### 1.2 craft 更接近 execution shell

craft 的重心是：

1. workspace
2. session
3. backend
4. event
5. permission / source / auth

它更像“下层受控执行 runtime”，而不是 Project / Run / Stage / governance 这种平台级控制层。

### 1.3 所以这两个东西不在同一层

更准确的比较关系应该是：

1. **Antigravity Platform / Control Plane**
2. 对比 **craft 作为 execution shell**

而不是：

1. 整个平台 Antigravity
2. 对比 craft 整个产品壳

---

## 2. craft 真正擅长什么

如果只看执行层，craft 的优势很明确。

### 2.1 session / backend / event 抽象更自然

craft 的核心就是：

1. backend 统一
2. session 统一
3. event 统一
4. provider 差异下沉

这比当前很多“先有任务，再去适配 provider”的实现方式更像一个通用 execution shell。

### 2.2 第三方 provider 路线更像 execution substrate

craft 本来就更适合承载“多个不同 provider 的执行壳”：

1. Anthropic 路线
2. 第三方兼容 provider 路线
3. 统一 session / event 收口

从 execution plane 的角度看，它比一个完整 coding product 更容易被顶层系统调用。

### 2.3 workspace-based + permission-based 的执行边界更清楚

craft 的价值不在于“它也有文件夹”，而在于：

1. 它把 workspace 当 execution boundary
2. 它把 session 当 runtime object
3. 它把 permission / source / tool call 放在下层 runtime 里解决

这正是下层执行器应该擅长的事情。

---

## 3. Antigravity 顶层真正要保留什么

craft 再强，也不该替代 Antigravity 平台已经长出来的上层真相源。

必须保留在 Antigravity 控制层的东西包括：

1. Project
2. Run
3. Stage
4. review-loop
5. source contract
6. artifact 真相源
7. scheduler / CEO / approval / governance

这些东西的共同点是：

1. 它们回答的是“做什么、为什么做、谁批准、如何追踪、何时继续”
2. 而不是“agent 在 workspace 里具体怎么改代码”

这就是为什么 Antigravity 现在最有价值的部分不在于“会不会调一个模型”，而在于已经长出了平台级控制层。

---

## 4. 在新口径下，结论应该怎么重写

## 4.1 不建议直接以 craft 为基座

现在的不建议，理由不再是“它们都像 workspace 产品，所以冲突”，而是更精确的这句：

> craft 位于 execution shell 层，Antigravity 已经长到 control plane 层，二者层次不同。

如果直接以 craft 为基座，风险不是 provider 接不上，而是：

1. 你会把已经长出来的控制层重新压扁成 session-first 产品壳
2. Project / Run / Stage / governance 会被迫去适配 craft 的 session 语义
3. 平台最稀缺的上层资产反而会被稀释

### 4.2 但可以把 craft 当成下层执行壳

这才是更合理的落点。

在这个模式下：

1. Antigravity 控制层继续决定任务生命周期
2. craft 负责在给定 workspace 中实际执行一次任务
3. craft 回传 started / completed / failed / cancelled 之类的 execution 信号
4. Antigravity 把它们映射回 Run / Project / Stage 真相源

这种关系是合理的。

### 4.3 所以答案不是“完全不用”

更准确的答案是：

1. **不用 craft 来承接整个平台**
2. **可以用 craft 承接执行层的一部分能力**
3. **更值得借的是它的 execution shell 思路，而不是整个产品壳**

---

## 5. 真正值得复用的层

如果要从 craft 吸收东西，优先级应该是下面这些。

### 5.1 backend / session / event 分层

这是最值得借的地方。

它和当前 Antigravity 正在推进的 AgentBackend / AgentSession / session-consumer 方向是一致的。

### 5.2 capability-driven executor model

以后 execution plane 不应该再隐式假设：

1. 所有 provider 都有 append
2. 所有 provider 都有 watcher
3. 所有 provider 都有 IDE 级 live state

craft 的思路提醒我们：

1. 执行器可以能力不等
2. 但必须合同清楚

### 5.3 第三方 provider 兼容思路

如果目标是支持第三方 API，craft 更值得借的不是 UI，而是：

1. 多 provider execution substrate
2. 第三方 provider 路由方式
3. 下层兼容、上层统一的事件模型

---

## 6. 最不该复用的层

下面这些层最不适合直接搬进 Antigravity 主系统。

### 6.1 workspace / session 作为产品真相源

这会直接冲掉 Antigravity 已经存在的：

1. Project
2. Run
3. Stage
4. governance

### 6.2 整个 SessionManager 产品壳

它适合做 execution runtime，不适合直接做平台主心脏。

### 6.3 整套 UI 壳

Antigravity 现在的方向已经不是 IDE shell，而是 OPC / CEO / Project 平台。

---

## 7. 最合理的技术路线

如果你的目标是：

1. 顶层继续做 OPC / CEO / Project 平台
2. 下层逐步支持第三方 API 与更多执行器

那最合理的路线应该是：

### Step 1

继续把 Antigravity 的控制层 / 执行层边界收口。

也就是继续完成当前 AgentBackend 和 Task B 方向。

### Step 2

把 execution plane 的接入合同写死：

1. session lifecycle
2. capability matrix
3. terminal semantics
4. artifact / result 回传要求

### Step 3

只做一个最小 execution shell 实验。

不是接整个 craft，而是验证：

1. 一个单 stage
2. 是否能通过外部 execution shell 跑通
3. 上层仍由 Antigravity 控制层维护真相源

### Step 4

验证通过后，再决定：

1. 只是借设计
2. 还是把 craft 真接成一个可选 executor

---

## 8. 最终判断

用新的控制层 / 执行层视角重写后，这份研究最准确的结论是：

1. **Antigravity 不该基于 craft 重做**
2. **craft 很适合作为 Antigravity 下层 execution shell 的参考对象**
3. **未来甚至可以把 craft 作为一个可选下层执行器接进来**
4. **但平台的控制层真相源，必须继续掌握在 Antigravity 自己手里**

一句话总结：

> 不把 craft 当地基，可以把 craft 当发动机舱里的一个引擎选项。
# Antigravity 是否应直接基于 craft-agents 继续开发

日期：2026-04-07
范围：静态架构研究，目标仓库为 `/Users/darrel/Documents/Antigravity-Mobility-CLI` 与 `/Users/darrel/Documents/craft-agents-oss`

## 一句话结论

**有可能借鉴 craft 的 backend/session 思路，但不建议把 Antigravity 直接建立在 craft-agents 之上。更准确的路线是：保留 Antigravity 现有的 OPC / Project / Stage Runtime 作为上层主系统，只在底层执行器层做“部分借鉴”或“局部嵌入”。**

原因很简单：

1. craft 的中心是 **workspace + session + backend + event**。
2. Antigravity 的中心是 **project + stage + run + governance**。
3. 两边都看起来像“多 Agent + 多 provider + workspace”，但它们所在的层次并不相同。

所以这不是“同类系统二选一”，而是“底座和编排层是否对得上”的问题。当前答案是：**对不上，除非你愿意重写 Antigravity 的核心编排与治理层。**

---

## 1. 为什么你会觉得它们像

从表面上看，这两个项目确实有几个很像的地方：

| 维度 | Antigravity | craft-agents |
|:--|:--|:--|
| Workspace | 以文件夹/工作区为根 | 以文件夹/工作区为根 |
| Conversation / Session | 有会话、有历史、有多 provider | 有 session、有历史、有多 backend |
| Provider | 已有 provider 抽象 | 已有 backend/provider 抽象 |
| Agent 模式 | 有多 Agent / 多角色 / 多阶段 | 有多 backend / 多工具 / 多 source |

这会让人自然产生一个想法：

> 既然两边都有 workspace、会话、provider，那是不是直接把 Antigravity 迁到 craft 上继续做会更快？

但看源码之后，关键结论是：**这几个相似点都只停留在外观层，不在同一个抽象层。**

---

## 2. 五个关键维度的真实对比

## 2.1 Workspace 模型

### Antigravity

Antigravity 的 workspace 不是一个纯应用内对象，而是一个**外部 IDE / language_server 的宿主目标**。

- `src/app/api/conversations/route.ts` 会先根据 `resolveProvider('execution', workspacePath)` 决定走 `codex` 还是 `antigravity`。
- 如果是 `antigravity`，还会检查这个 workspace 是否已经有匹配的 language_server；否则直接返回 `workspace_not_running`。
- `src/app/api/workspaces/launch/route.ts` 甚至会直接调用本机 Antigravity CLI 打开该文件夹，启动 IDE 侧运行时。
- `src/lib/agents/ceo-environment.ts` 也说明了 CEO workspace 本质上还是一个要被 IDE 打开的目录。

也就是说，Antigravity 的 workspace 更像：

> 一个要被外部运行时接管的部门/执行现场。

### craft-agents

craft 的 workspace 则更像一个**应用自己管理的工作容器**。

- `packages/shared/src/workspaces/storage.ts` 明确在 workspace 根目录下创建 `sources/`、`sessions/`、`skills/`。
- `packages/shared/src/sessions/storage.ts` 直接把 session 存在 `{workspaceRootPath}/sessions/{id}/session.jsonl`。

craft 的 workspace 更像：

> 一个由 craft 应用自己创建、自己托管、自己维护的工作空间容器。

### 结论

两边都“以文件夹为单位”，但含义不同：

- Antigravity 的 workspace 是 **执行目标**。
- craft 的 workspace 是 **应用容器**。

这会直接影响生命周期管理、会话归属、配置目录布局和 UI 结构。所以不能把“都是文件夹”理解为“可以直接替换”。

---

## 2.2 Conversation / Session 模型

### Antigravity

Antigravity 当前有两套并行状态：

1. **Conversation 层**
   - `src/app/api/conversations/route.ts`
   - `src/app/api/conversations/[id]/send/route.ts`
   - 其核心对象是 `cascadeId` 或 `codex-*` 线程句柄。
2. **Orchestration 层**
   - `src/lib/agents/run-registry.ts`
   - `src/lib/agents/project-registry.ts`
   - 核心对象是 `runId`、`projectId`、`pipelineState`、`stageId`。

这意味着在 Antigravity 里：

- conversation 只是交互 transport / provider handle
- run / project 才是产品级的一等业务对象

### craft-agents

craft 的 session 是真正的一等对象。

- `packages/shared/src/sessions/storage.ts` 里 session 自带消息、附件、plan、下载、状态元数据。
- `packages/server-core/src/sessions/SessionManager.ts` 直接围绕 session 创建 backend、管理 message、auth、sources、automations。

这意味着在 craft 里：

- session 本身就是产品核心对象
- workspace/session/backend 是第一层
- project / pipeline / CEO 这种治理对象根本不是主轴

### 结论

**Antigravity 的 conversation 不等于 craft 的 session。**

如果你直接基于 craft 往上做，第一件事不是“接入 provider”，而是要先回答：

> Antigravity 现有的 run / project / stage 状态，到底挂在哪个 craft 实体上？

这个映射当前并不存在。

---

## 2.3 Provider 抽象

### Antigravity

Antigravity 的 provider 抽象已经存在，但当前还是**任务执行导向**。

- `src/lib/providers/ai-config.ts` 的 `resolveProvider()` 按 scene / layer / department 做解析。
- `src/lib/providers/types.ts` 的 `TaskExecutor` 只有 `executeTask`、`appendMessage`、`cancel`。
- `src/lib/providers/index.ts` 当前只真正实现了 `antigravity` 和 `codex` 两个 executor。

更关键的是，Antigravity 的编排层还没有完全脱离底层运行时细节：

- `src/lib/agents/group-runtime.ts` 里仍然直接发现 language_server、拉 gRPC、调用 `grpc.startCascade()`、`grpc.sendMessage()`。
- 这说明 Provider PAL 已经出现，但还没有真正把运行时完全隔离干净。

### craft-agents

craft 的 provider/backend 抽象则更偏**会话事件导向**。

- `packages/shared/src/agent/backend/factory.ts` 里 `providerTypeToAgentProvider()` 会把 `anthropic` 映射到 `ClaudeAgent`，把 `pi/pi_compat` 映射到 `PiAgent`。
- `packages/shared/src/agent/backend/types.ts` 的 `AgentBackend` 是围绕 `chat()`、`abort()`、`redirect()`、`runMiniCompletion()`、`applyBridgeUpdates()` 这类 session 级动作设计的。
- `SessionManager` 直接消费 backend 产生的统一 `AgentEvent`。

### 结论

两边的抽象方向并不一致：

- Antigravity：**先有项目/阶段任务，再挑执行器**
- craft：**先有 session/backend，再往上长功能**

所以 craft backend 不是 Antigravity `TaskExecutor` 的直接替代品。中间至少还缺一层适配：

- session event → run lifecycle
- backend capability → stage/runtime expectation
- tool/result stream → Antigravity project/run persistence

---

## 2.4 Multi-Agent / Orchestration

### Antigravity

Antigravity 的真正核心在编排层，而不是聊天层。

- `src/lib/agents/dispatch-service.ts` 的 `executeDispatch()` 是统一派发真相源。
- `src/lib/agents/group-runtime.ts` 的 `dispatchRun()` 负责启动角色执行、source contract、review-loop、artifact、watching。
- `src/lib/agents/project-registry.ts` / `run-registry.ts` 负责项目与 run 的持久化状态。
- 还叠加了 CEO、审批、部门记忆、scheduler、source contract、pipeline state。

这是一整套**交付治理系统**。

### craft-agents

craft 的核心编排更弱，它不是项目流水线编排器，而是 session shell。

- 它很强的是 workspace、session、source、tool、backend、event 统一。
- 它并没有像 Antigravity 这样成熟的 Project -> Stage -> Run -> Review -> Approval 治理骨架。

### 结论

如果你把 Antigravity 建在 craft 上，最大的风险不是 provider 接不上，而是：

> 你会为了复用 craft 的 session/backend 壳，反过来扭曲 Antigravity 自己已经成型的项目治理内核。

这很容易本末倒置。

---

## 2.5 UI / 产品形态

### Antigravity

Antigravity 的产品主轴已经很明确：

- OPC
- CEO Office
- Projects / Pipeline
- Department / Approval / Scheduler

### craft-agents

craft 更像：

- IDE-like workspace shell
- session/source/skills/status/labels 管理器
- 多 backend coding agent 容器

### 结论

两者不是同一类前端。直接“基于 craft 继续开发”意味着：

1. 要么重写 craft UI，最后只留下 backend/session 外壳。
2. 要么把 Antigravity 的 OPC 体验改造成 craft 那一套工作区/会话壳。

这两条都不是低成本路线。

---

## 3. 最终判断：为什么不建议直接基于 craft

结论不是“完全不能”，而是：

**不值得直接以 craft 为基座继续开发。**

原因有五个。

### 3.1 层次错位

craft 解决的是：

- backend 统一
- session 统一
- source/tool/auth 统一

Antigravity 解决的是：

- pipeline orchestration
- project governance
- CEO/department/approval

你若直接基于 craft，相当于拿“下层会话壳”去反向吞掉“上层治理系统”。

### 3.2 现有核心资产会大量重复

Antigravity 已经有：

- workspace API
- conversation routing
- provider resolution
- run/project persistence
- dispatch/review/source contract
- CEO/department/approval

craft 也有另一套：

- workspace storage
- session storage
- backend/session manager
- source/auth/labels/status/permissions

两边的重复面太大，直接合并不会自动节省工作量，反而会引入“双系统并存”的清理成本。

### 3.3 Antigravity 当前最强的不是 provider，而是 orchestration

真正难得的是 `executeDispatch()`、`dispatchRun()`、`project-registry.ts` 这套 stage runtime，而不是“能连哪个模型”。

如果为了复用 craft，把这套骨架弱化成“session 驱动的一层插件”，收益很可疑。

### 3.4 Antigravity 的 provider 抽象还没彻底收口

这反而说明正确方向是：

**继续把 Antigravity 自己的 provider/runtime 抽象收口完，再考虑吸收 craft 的优点。**

而不是在抽象还没收口时，再引一个更重的外部 runtime 体系。

### 3.5 你真正想要的，很可能不是 craft 整体，而是它的一部分能力

目前最值得拿来用的不是 craft 产品整体，而是：

- `AgentBackend` / `AgentEvent` 这种分层思路
- backend capability matrix
- Claude 与 Pi 两条 backend 的事件归一化经验
- session 持久化与 source/auth 编排方法

这属于“借鉴设计与局部代码”，不属于“以 craft 为基座”。

---

## 4. 真正可复用的层在哪里

### 推荐复用层 1：backend/event 抽象思路

这是最值得借鉴的部分。

建议你在 Antigravity 里逐步补出一层比 `TaskExecutor` 更细的抽象，例如：

- `ExecutionBackend` 或 `AgentSessionBackend`
- 具备 start / stream / append / interrupt / cancel / complete
- 统一事件流，而不是只返回最终字符串

这样你才能把：

- antigravity gRPC 路径
- codex 路径
- 未来 claude-api / openai-api / custom 路径

真正变成同一层可编排后端。

### 推荐复用层 2：capability-driven provider model

craft 的 backend capability 做得更彻底。Antigravity 现在虽然也有能力矩阵概念，但运行时仍然默认很多路径“应该像 Antigravity 一样可 watch / 可 cancel / 可 step-stream”。

建议借鉴 craft 的做法，把 provider 能力写成硬约束，让 stage runtime 根据能力降级：

- 支持 streaming
- 支持 step watch
- 支持 cancel
- 支持 multi-turn
- 支持 IDE skills

这样未来接第三方 API 时，系统不会隐式假设所有 provider 都有 IDE 级能力。

### 推荐复用层 3：如果真要接 craft，只把它当叶子执行器

如果你真的想做一次融合，最合理的位置不是把 Antigravity 建在 craft 上，而是：

> 把 craft 视为一种可选 executor/backend，由 Antigravity 的 stage runtime 去调用。

换句话说：

- Antigravity 继续做项目、阶段、审批、部门和 UI
- craft 只负责某些 stage 的具体执行

这时 craft 是一个“供应商”，不是“基座”。

---

## 5. 最不值得复用的层

下面这几层最不适合直接搬。

### 5.1 craft 的 workspace/session 存储层

因为它和 Antigravity 现有的 workspace / conversation / run / project 语义冲突最大。

### 5.2 craft 的 SessionManager 整体

这是 craft 的产品心脏，但对 Antigravity 来说太重，也太偏 session-first。

### 5.3 craft 的 UI 壳

它和 OPC/CEO/Project 这一套不是同类产品。

### 5.4 craft 的 source/labels/status 整体产品模型

里面有很多不错的工程能力，但如果全盘引入，等于把 Antigravity 再做成一个第二 IDE shell。

---

## 6. 哪些现有能力会和 craft 冲突或重复造轮子

## 6.1 Workspace 生命周期

Antigravity 已有：

- `src/app/api/workspaces/route.ts`
- `src/app/api/workspaces/launch/route.ts`

craft 也有一整套 workspace root / config / sessions / skills 管理。

如果直接接，会出现“到底哪个系统拥有 workspace 根目录和生命周期”的冲突。

## 6.2 Conversation / Session 管理

Antigravity 已有：

- `src/app/api/conversations/route.ts`
- `src/app/api/conversations/[id]/send/route.ts`

craft 则有：

- `packages/shared/src/sessions/storage.ts`
- `packages/server-core/src/sessions/SessionManager.ts`

这两套都想做 session 主人。不能同时做主系统。

## 6.3 Provider 路由

Antigravity 已有：

- `src/lib/providers/ai-config.ts`
- `src/lib/providers/index.ts`

craft 也有：

- `packages/shared/src/agent/backend/factory.ts`

两边都在决定“谁调用哪个 backend/provider”。直接叠加只会让路由链更难维护。

## 6.4 运行时状态持久化

Antigravity 的 run/project 状态与 craft 的 session.jsonl 根本不是同一层数据。

如果没有非常清楚的 owner 设计，就会出现：

- session 完成了，但 project 不知道
- project blocked 了，但 session 还在跑

## 6.5 权限 / 工具 / source 系统

craft 的 permission / source / auth 很强，但 Antigravity 这边也已经有：

- Security Guard
- Approval
- MCP Server
- Department / Rules / Memory

这不是“空白能力可以直接填进来”，而是两套治理模型会重叠。

---

## 7. 我建议的技术路线

如果目标是“借 craft 的优势，但不伤 Antigravity 的主骨架”，推荐下面这条路线。

### 路线结论

**保持 Antigravity 为主系统，只在 provider/runtime 边界引入 craft 思想或局部能力。**

### Step 1：先把 Antigravity 的执行边界收口

先完成这件事：

- 让 `group-runtime.ts` 不再直连大量 gRPC 细节
- 把运行期能力统一沉到 executor/backend 层

否则任何外部 backend 都不好接。

### Step 2：把 `TaskExecutor` 升级成事件化接口

现在的 `TaskExecutor` 太像“一次性任务调用”。

建议升级为至少支持：

- 启动
- 追加消息
- 事件流输出
- 中断/取消
- 能力声明

这一步是将来对接 craft 或任何 Claude SDK / Pi runtime 的前提。

### Step 3：只做一个最小实验性 backend

不要一上来接整个 craft。

只做一个实验性 backend：

- 可以叫 `claude-sdk` executor
- 或 `craft-session` executor

目标只验证一件事：

> 能不能让 Antigravity 的单个 stage，在不改 project/stage/CEO 上层语义的前提下，换一个底层执行后端。

### Step 4：验证通过后，再决定是借思路还是借代码

如果实验成功，再决定：

- 只是借抽象设计，自己写 executor
- 还是借 craft 的一小块代码
- 还是把 craft 当外部执行服务

不要在实验前就决定“整个系统迁过去”。

---

## 8. 30 / 60 / 90 分钟最小验证计划

这个验证计划只验证“最小可行融合点”，不做大迁移。

### 30 分钟

目标：确认 Antigravity 现有 stage runtime 要求的最小 backend 能力面。

操作：

1. 把 `group-runtime.ts` 当前实际使用的能力列出来：启动、watch、append、cancel、artifact 回收、status 判定。
2. 把这些能力和 `TaskExecutor` 当前接口逐项对照。
3. 输出一张缺口表，回答“还差哪些接口才能接第三方 session backend”。

成功标准：

- 你能得到一份清晰的 backend contract gap list。

### 60 分钟

目标：做一个不接 UI 的实验性 executor skeleton。

操作：

1. 新增一个实验 executor 接口或适配层。
2. 让它至少能返回：启动句柄、最终结果、取消能力声明。
3. 用一个最简单的单 stage 模板去跑通“创建 project -> dispatch -> 完成 run”。

成功标准：

- 单 stage 不依赖现有 antigravity gRPC 细节也能收敛成 run 完成。

### 90 分钟

目标：验证事件化后端是否真能接进 Antigravity 编排层。

操作：

1. 给实验 executor 补最小事件流。
2. 让 `dispatchRun()` 能消费事件而不是只盯 gRPC watcher。
3. 在一个隔离 workspace 上跑一条最简单的 coding stage。

成功标准：

- Project / Run / Stage 状态能正常推进。
- 上层不需要知道底层是 gRPC、Codex 还是实验 backend。

---

## 9. 成熟度评分矩阵

为了避免“看起来别人更完整，所以我这边没有价值”的错觉，下面强制把比较拆成两个战场。

评分规则：

- 10 分 = 该层已经高度收口，主流程清晰，抽象稳定。
- 7-8 分 = 主链路成熟，但仍有明显扩展债务。
- 5-6 分 = 已经能用，但抽象边界尚未真正稳定。
- 3-4 分 = 只有局部能力，不构成成熟产品层。

### 9.1 如果按“通用 coding agent shell”比较

| 维度 | craft | Antigravity | 判断 |
|:--|:--:|:--:|:--|
| Workspace / Session 一致性 | 8.5 | 6.0 | craft 更成熟，workspace 与 session 都由自己托管；Antigravity 仍夹在 IDE workspace、conversation handle、run/project 三套对象之间 |
| Backend / Provider 抽象 | 8.0 | 5.5 | craft 的 backend factory、AgentBackend、AgentEvent 更完整；Antigravity 有 Provider PAL，但 `group-runtime.ts` 仍直接耦合 gRPC 细节 |
| 多 provider 覆盖面 | 8.5 | 4.5 | craft 已把 anthropic 与 pi/pi_compat 双 backend 路线收口；Antigravity 当前真正落地的执行器主要还是 antigravity 与 codex |
| Session 持久化与恢复 | 8.5 | 5.5 | craft 的 session.jsonl、attachments、plans、downloads 更像成型产品；Antigravity conversation 还不是系统级真相源 |
| 工具 / source / auth 编排 | 8.0 | 5.5 | craft 在 source/auth/session-scoped tools 层成熟度更高；Antigravity 这边能力分散在 bridge、MCP、approval、rules 里 |
| 总体收口度 | 8.2 | 5.8 | 如果把目标定义成“通用本地 coding agent shell”，craft 明显更成熟 |

### 9.2 如果按“AI 软件组织 / 治理平台”比较

| 维度 | craft | Antigravity | 判断 |
|:--|:--:|:--:|:--|
| Project / Run / Stage 编排 | 3.5 | 8.5 | 这是 Antigravity 的核心强项；craft 没有同级别的 project-stage-governance 主骨架 |
| 交付治理与状态持久化 | 4.0 | 8.5 | Antigravity 已经把 run、project、pipelineState、source contract、review 绑成了一套系统 |
| CEO / Department / Approval 模型 | 2.5 | 8.0 | craft 几乎不解决这一层；Antigravity 已经有独立产品结构 |
| 多阶段交付流 | 3.0 | 8.5 | `executeDispatch()`、`dispatchRun()`、`project-registry.ts` 这一层是 Antigravity 的差异化价值 |
| 产品差异化 | 6.0 | 8.5 | craft 更像强大的通用 agent shell；Antigravity 更像 AI 组织运行系统 |
| 总体收口度 | 4.2 | 8.1 | 如果按你真正想做的 OPC / Multi-Agent 公司治理方向比较，Antigravity 反而更成熟 |

### 9.3 最关键的一句解释

所以真正的问题不是：

> “Antigravity 有没有 craft 成熟？”

而是：

> “你到底想把 Antigravity 做成 craft 那样的通用 coding shell，还是做成一个更偏组织编排与交付治理的平台？”

如果答案是前者，那目前 craft 的确更成熟。

如果答案是后者，那 Antigravity 并不低价值，反而已经长出了最难复制、也最不通用的一层。

### 9.4 我对当前 Antigravity 成熟度的直话直说

Antigravity 现在不是“没价值”，而是“价值点已经出现，但底层执行抽象还没收口”。

当前真实状态更像：

1. **上层产品价值已经出现了**：CEO、Department、Project、Stage、Approval 这些不是空想，而是已经写进运行时的骨架。
2. **中层抽象还不够干净**：Provider PAL 已经有了，但 `group-runtime.ts` 仍然吃了太多底层实现细节。
3. **下层通用 agent shell 能力不如 craft**：如果硬要在这个赛道正面比，暂时确实不占优。

所以最危险的误判是：

> 因为下层 shell 不如 craft，就认为整个 Antigravity 没价值。

这相当于拿错标尺。

## 10. 最后的建议

如果你问我的明确态度：

**我建议“部分借鉴”，不建议“直接基于 craft 继续开发”。**

更直白一点：

- 可以把 craft 当老师
- 可以把 craft 当一个将来的可选执行器
- 但现在不应该把 craft 当 Antigravity 的主地基

Antigravity 已经长出来的主价值是：

- OPC
- CEO
- Project / Stage Runtime
- 审批 / 部门 / 治理

这些恰好不是 craft 最擅长的部分。

所以最合理的策略不是“迁过去”，而是：

> 先把 Antigravity 自己的 backend 边界做干净，再按需吸收 craft 在 session/backend/event 抽象上的成熟经验。

---

## 11. 如果目标是支持第三方 API，让顶层去调用下层执行器

这一问法比“要不要直接基于 craft 或 Claude Code 重做”更准确。

真正的问题不是：

1. 谁来替代 Antigravity 的 `Project / Run / Stage`

而是：

1. Antigravity 顶层能不能把某个 workspace-based agent shell 当成**下层受控执行器**来调用
2. 借它来获得第三方 API 支持、严格权限控制和本地工作区执行能力

我的结论是：

> **可以，而且这比“整体迁基座”合理得多。**

但 Claude Code 和 craft 适合承担的角色不完全一样。

### 11.1 Claude Code 能不能承担这个角色

可以，但它更像**强执行器**，不是通用嵌入式 backend 框架。

原因有三点：

1. **它当前这份逆向仓库确实支持第三方 provider**
   - `claude-code/CLAUDE.md` 已明确列出 OpenAI、Gemini、Grok 等兼容层
   - `claude-code/src/utils/model/providers.ts` 也明确支持 `openai`、`gemini`、`grok` 等 provider 解析
2. **它有可被顶层调用的入口，但更像 server / CLI，不像稳定 SDK**
   - `claude-code/src/main.tsx` 已有 long-running server 入口
   - 但 `claude-code/src/entrypoints/agentSdkTypes.ts` 里的 session SDK 入口当前仍是未实现状态
3. **它的优势是本地代码执行能力强**
   - workspace 工作流成熟
   - 工具调用、文件修改、终端执行能力强
   - 适合做一个“被调度的 coding executor”

所以如果你要的是：

1. 顶层创建一个任务
2. 把 prompt 和 workspace 下发给下层
3. 让下层真的去改代码、跑命令、产出结果

那 Claude Code 是可以承担这个角色的。

但它当前更现实的接法是：

1. **CLI 子进程适配器**
2. **本地 server 适配器**

而不是直接把它当成熟 SDK 嵌进来。

### 11.2 craft 能不能承担这个角色

也可以，而且它在“做通用执行壳”这件事上，往往比 Claude Code 更顺手。

原因也有三点：

1. **craft 的中心本来就是 backend / session / event 壳**
   - 它更适合被当成受控下层 runtime
   - 不像 Claude Code 那么偏“完整 coding product”
2. **craft 的第三方 provider 路线更天然**
   - Anthropic 走 ClaudeAgent
   - 第三方 provider 主要走 PiAgent / `pi_compat`
   - 这使它更像多 provider execution shell
3. **craft 更容易被理解成一个 session backend 容器**
   - 顶层去调它，比直接把整个产品壳搬进来更顺

但 craft 的问题也很明确：

1. 它天然是 session-first
2. 它不理解 Antigravity 的 Project / Run / Stage / governance
3. 如果直接拿它当基座，还是会回到“层次错位”问题

所以 craft 适合当：

1. 下层 execution shell
2. provider compatibility substrate

而不适合直接做顶层主系统。

### 11.3 如果是“顶层调用下层”，谁更合适

要分两类目标看。

#### 目标 A：先尽快拿到一个能干活的第三方执行器

更偏向 Claude Code。

原因：

1. 它本地 coding executor 能力更强
2. 工作区内文件修改、命令执行、工具调用已经更完整
3. 只要顶层愿意通过 CLI 或 server 去调它，就能很快形成可用链路

#### 目标 B：做长期可扩展的多 provider 下层执行壳

更偏向 craft。

原因：

1. 它的 backend / session / event 思路更干净
2. 本来就更接近“被控制的下层 runtime”
3. 对第三方 provider 的路线也更自然

#### 目标 C：顶层继续保留 Antigravity，只是补第三方执行能力

最稳的路线不是二选一，而是：

1. 顶层仍然是 Antigravity
2. 下层可以先接 Claude Code executor
3. 后续如果要做长期多 provider runtime，再抽象到类似 craft 的 execution shell 形态

这条路线最符合当前工程现实。

### 11.4 最现实的系统分工

如果按“顶层调用下层”来设计，最合理的分工是：

1. **Antigravity 顶层负责**
   - Project
   - Run
   - Stage
   - review-loop
   - artifact 真相源
   - scheduler / CEO / approval / governance
2. **Claude Code 或 craft 下层负责**
   - 在给定 workspace 内执行任务
   - 走自身的权限控制和工具调用
   - 把 started / completed / failed / cancelled 之类的事件或结果交回顶层

这就意味着：

1. 它们不会替代 Antigravity 的业务真相源
2. 它们会成为 Antigravity 的叶子执行器

### 11.5 我的建议

如果你的研究课题是：

> “为了支持第三方 API，顶层是否可以直接调用 Craft 或 Claude Code 这类 workspace-based 执行器？”

我的建议是：

1. **答案是可以**
2. **而且这比整体迁基座更合理**
3. **短期优先顺序应是：Claude Code executor first，craft-style runtime later**

原因：

1. Claude Code 更容易先形成可运行的被调度执行链
2. craft 更适合作为长期下层 runtime 设计参考，甚至后续再替换 Claude Code adapter 背后的执行壳
3. 不管选谁，顶层都不该放弃 Antigravity 自己的 `Project / Run / Stage` 主系统
