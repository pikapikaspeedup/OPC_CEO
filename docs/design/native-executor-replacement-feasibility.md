# Native Executor 平替可行性判定

日期：2026-04-09  
状态：研究结论 / 严格口径

## 一句话结论

如果问题是：

> 现在有没有一个现成的外部系统，可以不改平台真相源、又能直接平替当前 Antigravity Native Executor，并继续支持 Template、定时任务、Prompt Mode、干预链路这些现有产品能力？

我的结论是：

1. **今天没有现成的 raw drop-in replacement**
2. **但可以做到不再被 Native Executor 绑死**
3. **实现方式不是“挑一个产品壳当新底座”，而是由 Antigravity 自己拥有 execution runtime contract，再把 Claude Code、Direct Open API backend、未来 craft-style runtime 挂到这个合同后面**

也就是说：

1. 如果你要的是“现成平替品”，当前答案是否
2. 如果你要的是“架构上可脱钩、以后可替换”，当前答案是肯定，而且这才是正确目标

---

## 1. 先把问题问对

之前很容易把问题问成：

1. Claude Code 能不能当 executor
2. craft 能不能当 executor

但你现在真正关心的是更严格的问题：

> 有没有一种替代路径，能让 Antigravity Platform 不再依赖当前 Native Executor，且现有产品面上的 Template、定时任务、Prompt、Run、Stage、干预、artifact 都还能继续成立。

这个问题的关键不是“它会不会写代码”，而是：

1. 它能不能承接完整 execution plane 责任
2. 它能不能在不污染 control plane 的前提下承接这些责任

---

## 2. 平替当前 Native Executor 的严格标准

如果标准只是“能跑一次代码任务”，那很多系统都能凑合。

但如果标准是“平替当前 Native Executor”，至少要满足下面 8 条：

1. **Template 继续可执行**
  - 不是只跑 Prompt Mode
  - 而是 template stage 仍能正常派发
2. **Scheduler / 定时任务继续可执行**
  - 定时 job 触发后，仍能稳定落到 run / project / stage
3. **Prompt Mode 继续可执行**
4. **multi-role 主链继续成立**
  - 至少 isolated review-loop / delivery 这类现有主链不能直接报废
5. **干预链路继续成立**
  - nudge
  - restart_role
  - evaluate
  - cancel
6. **artifact / result / run 状态继续是平台真相源**
7. **不再依赖当前 Native language server / owner routing / gRPC transport 才能跑通主路径**
8. **以后可以继续替换 provider / backend，而不是从 Antigravity 换绑到另一个外部产品上**

只有满足这 8 条，才算真正的“平替 execution 层”，而不是“加了一个新玩具 executor”。

---

## 3. 哪些能力其实不是 blocker

这里最容易误判的一点，是把 Template 和定时任务也当成“执行器原生能力”。

实际上它们不是。

### 3.1 Template 不是执行器原生能力

Template / Stage / review-loop / source contract 属于控制层。

它们主要由下面这些层维护：

1. `src/lib/agents/dispatch-service.ts`
2. `src/lib/agents/group-runtime.ts`
3. `src/lib/agents/run-registry.ts`
4. `src/lib/agents/project-registry.ts`

所以外部执行器并不需要“自己理解 Template”。

它只需要做到：

1. 在某个 workspace 里执行一轮指定 prompt
2. 回传 terminal status 和结果
3. 在能力允许时支持 append / cancel / attach

换句话说：

> Template 能不能继续工作，关键不在于外部执行器有没有 template engine，而在于 Antigravity Platform 能不能继续逐 stage 驱动它。

### 3.2 定时任务也不是执行器原生能力

Scheduler 本质上只是：

1. 在某个时间触发 dispatch
2. 让平台创建对应 run
3. 再把这个 run 交给 execution plane

所以定时任务是否继续成立，关键也不在于外部执行器原不原生支持 cron，而在于：

1. 它能不能稳定承接被触发后的那次 stage execution
2. 并把结果回到平台真相源

这意味着：

1. **Template 不是 blocker**
2. **Scheduler 不是 blocker**

真正的 blocker 在别处。

---

## 4. 真正的 blocker 是什么

真正难的不是“有没有模板”和“有没有 cron”，而是下面这 5 组 execution contract。

### 4.1 session lifecycle

平台需要稳定拿到：

1. started
2. completed / failed / cancelled
3. 可追踪 handle 或 session 标识

### 4.2 intervention contract

如果现有产品要继续支持：

1. nudge
2. restart_role
3. evaluate
4. cancel

那外部执行器至少要让平台拥有下面这些能力中的一部分：

1. append
2. attach / resume
3. cancel
4. 最少限度的诊断读取

### 4.3 artifact / result contract

平台必须继续掌握：

1. changedFiles
2. result text
3. artifactDir 落点
4. run status

### 4.4 workspace contract

外部执行器必须接受：

1. 指定 workspacePath
2. 指定 artifactDir
3. 指定 timeout / model / metadata

### 4.5 anti-lock-in contract

最关键的一条是：

> 新执行器接进来以后，平台不能只是从“绑死在 Native Executor”变成“绑死在 Claude Code”或“绑死在 craft”。

所以平台必须自己拥有 execution contract，而不是把 contract 让给外部产品。

---

## 5. 按这个严格标准看 Claude Code

## 5.1 它能不能承接很大一部分 execution 责任

能。

Claude Code 的现实优势很明显：

1. 本地 workspace 内写代码、改文件、跑命令很强
2. 对 coding task 的即时执行力很强
3. 当前逆向仓库已经明确支持 OpenAI、Gemini、Grok 等多 provider compatibility layers
4. 已存在可编程入口
  - CLI headless 面
  - stream-json 输入输出
  - remote-control / bridge / RCS 方向

这意味着它完全可以成为：

1. Prompt Mode executor
2. 单 stage coding executor
3. future open API coding backend 的第一实现

## 5.2 它能不能今天就直接 raw drop-in 平替 Native Executor

不能。

主要原因不是能力太弱，而是边界不对：

1. 当前这份仓库是 reverse-engineered / decompiled 版本
2. provider 层成熟度明显高于 session / control 面成熟度
3. 一部分入口仍受 feature flag、stub 或未完全恢复实现影响
4. 它本质上还是一个 coding product，不是为 Antigravity control plane 定制的 execution substrate

所以更准确的判断是：

1. **它是很强的第一适配目标**
2. **但不是今天就能直接无缝平替的现成标准执行层**

## 5.3 如果目标是不再被 Native Executor 绑死，Claude Code 值不值得接

值得。

因为它至少能证明一件事：

> 平台的 execution plane 不必继续唯一依赖 Native Executor 才能完成真实 coding task。

所以 Claude Code 的正确角色是：

1. **第一代外部 executor adapter**
2. **不是新的平台基座**

---

## 6. 按这个严格标准看 craft

## 6.1 它是不是更接近长期执行层形态

是。

craft 更有价值的不是“它也是 coding agent”，而是：

1. session / backend / event 分层更像 execution substrate
2. provider 差异下沉思路更接近长期统一 runtime
3. capability-driven 模型更适合多 backend 共存

所以如果你的问题是：

1. 未来什么更像长期 execution shell 方向

那 craft 风格比 Claude Code 更接近答案。

## 6.2 它能不能今天就直接 raw drop-in 平替 Native Executor

也不能。

原因同样在层次不对：

1. craft 是 session-first / workspace-first 产品壳
2. Antigravity 已经有自己的 Project / Run / Stage / governance 真相源
3. 如果直接拿 craft 当基座，会把控制层重新压扁到 session 语义上

所以 craft 最稳的定位不是：

1. 直接平替当前 Native Executor 的现成成品

而是：

1. 长期 execution shell 参考方向
2. 未来可能的可选 backend / runtime 壳

---

## 7. 真正能让你不被绑死的方案是什么

如果目标真的是：

> 不再被当前 Native Executor 绑死，而且以后也不被 Claude Code 或 craft 绑死。

那唯一正确的对象不是外部产品，而是：

> **Antigravity 自己拥有的 Standard Execution Runtime Contract**

这个合同至少应该由平台自己定义并持有：

1. run lifecycle
2. session handle 语义
3. append / attach / cancel 语义
4. terminal semantics
5. changedFiles / artifact / result 回传合同
6. capability matrix

然后再把不同 executor 挂到它后面：

1. Adapter A：Native Executor
2. Adapter B：Claude Code
3. Adapter C：Direct Open API backend
4. Adapter D：未来 craft-style runtime

一旦做到这一步，平台就不会再被某个单一执行器绑死。

## 7.1 为什么不能直接换绑到 Claude Code 或 craft

如果你的意思是：

1. 选一个外部产品当默认执行底座
2. 以后大部分任务都优先走它

那答案其实是：

1. **可以，完全可以**

我真正反对的不是“选一个”，而是下面这件事：

1. **把平台自己的 execution contract 也一起交给它**

原因不在于它是不是开源，也不在于它是不是大厂产品，更不在于它支不支持很多 API。

真正的问题只有一个：

> 绑不绑死，从来不是由“源码开不开”决定，而是由“谁拥有运行时合同”决定。

即使 Claude Code 或 craft 是开源且 provider 很多，你仍然可能被它们下面这些东西反向约束：

1. session 模型
2. 中断 / append / attach 的控制面
3. 事件格式和 terminal 语义
4. workspace 生命周期
5. 权限与工具调用边界
6. 版本升级节奏与破坏性变更

一旦这些合同由外部产品定义，Antigravity 的 Template、Scheduler、Run、Stage、intervention 迟早会被迫去适配外部产品，而不是外部产品来适配平台。

这时平台虽然不再绑在 Native Executor 上，却会改成绑在 Claude Code 或 craft 上。

所以最稳的路线不是：

1. 不许选 Claude Code 或 craft

而是：

1. **可以选一个当默认执行底座**
2. **但必须由 Antigravity 自己拥有上层 execution contract**
3. **外部产品只能是 adapter / backend，而不能是合同拥有者**

换句话说：

1. **选一个，没问题**
2. **换绑，不是解绑**

如果你今天倾向 Claude Code，这个选择我认为完全合理。

更准确的表述应该是：

> Antigravity Platform 以 Claude Code 作为第一默认 execution substrate，但平台仍然自己拥有 run lifecycle、artifact contract、intervention semantics 和 routing policy。

这才是真正既能用上 Claude Code 的成熟度，又不把平台主权交出去的做法。

---

## 8. 最现实的路线

### Phase 1

先完成 Task B，把 Native transport 残留继续从 orchestration 层往下压。

### Phase 2

把 execution runtime contract 正式写死，而不是继续让 `group-runtime.ts` 事实性决定合同。

### Phase 3

先做 Claude Code adapter PoC，验证：

1. Prompt Mode
2. legacy-single
3. 单 stage template execution
4. scheduler 触发后的 run

这四条能不能在不依赖 Native Executor 的情况下跑通。

### Phase 4

补齐 intervention contract：

1. cancel
2. append / nudge
3. attach / restart_role
4. evaluate 的替代诊断面

### Phase 5

只有在前面跑通以后，再决定：

1. 是否继续朝 craft-style runtime 收口
2. 还是直接继续扩自有 runtime + 多 adapter

---

## 9. 最终判定

如果把这次问题压缩成最直接的话，答案如下：

1. **如果你要问“现在哪个外部系统可以直接无痛平替当前 Native Executor”，答案是：没有。**
2. **如果你要问“能不能把当前 Native Executor 从平台唯一依赖中拿掉”，答案是：可以，而且必须靠自有 execution runtime contract，而不是换绑到另一个外部产品。**
3. **在这个过程中，Claude Code 更适合做第一代可落地 adapter，craft 更适合做长期 execution shell 方向参考。**

一句话总结：

> 真正的平替对象不是另一个产品壳，而是你自己拥有的 execution runtime 标准层；只有先把这一层做成，Antigravity Platform 才真正不会被任何单一执行器绑死。