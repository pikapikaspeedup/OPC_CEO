# AI 调用面与 Codex 模型配置旅程审计（2026-04-28）

日期：2026-04-28  
状态：只读洞察，未实施修复  
范围：AI 调用主链、模型选择入口、`Codex` 配置旅程、provider/model 断裂点

## 一句话结论

当前系统已经有可见的 `Provider + Model` 配置能力，但还没有形成一条统一、可信、端到端生效的执行链。

更具体地说：

1. 真正稳定调用模型的主链有 6 条。
2. 用户在多个地方“可以选模型”，但这些入口没有共享一个单一真相源。
3. `Settings -> Codex` 的配置旅程前半段是通的，后半段在聊天、Projects、CEO 指令、Pipeline 生成、Knowledge 上存在不同程度断裂。
4. 当前最核心的问题不是“有没有模型选择 UI”，而是“选择之后，执行层是否真的按同一对 `provider + model` 跑”。

---

## 1. 这次审计要回答的问题

本次只回答两个问题：

1. 现在到底有几个大的环节会真实调用 AI，是否支持选择模型。
2. 用户在配置 `Codex` 时，旅程是否闭环，哪里存在断裂点。

这不是实现文档，不涉及代码修改；目的是给后续 `provider/model` 收敛和 `pi-ai` 接入提供依据。

---

## 1.1 相关文档地图

这份文档的职责是“只读审计与断裂点说明”，不替代现有设计或指南文档。

相关真相源分工如下：

1. `docs/design/pi-ai-transport-and-visual-config-plan-2026-04-28.md`
   - 负责 `pi-ai` 接入方案、transport 边界、Settings 配置方向
2. `docs/guide/gateway-api.md`
   - 负责 API 当前行为真相
3. `docs/guide/agent-user-guide.md`
   - 负责用户可见配置和操作说明
4. `ARCHITECTURE.md`
   - 负责系统层结构和模块关系
5. 本文
   - 负责回答“哪些地方真实调用 AI、哪里能选模型、Codex 配置旅程哪里断了”

因此，后续如果要推进实现：

1. 本文用于确定修复优先级
2. `design` 文档用于确定方案边界
3. `guide` 与 `ARCHITECTURE` 用于在功能落地后更新对外/对内真相

---

## 2. 当前真实 AI 调用主链

如果只统计“当前稳定会触发模型调用”的主链，而不是把所有看起来像 AI 的页面都算进去，当前共有 6 条。

### 2.1 Conversations / CEO 线程聊天

入口：

- `src/app/api/conversations/route.ts`
- `src/app/api/conversations/[id]/send/route.ts`

作用：

1. 打开新的本地 provider conversation
2. 将用户消息派发到本地 provider 或 Antigravity runtime
3. 返回流式或轮询结果

关键证据：

- `src/app/api/conversations/route.ts` 会按 `resolveProvider('execution', workspacePath)` 创建本地 provider conversation。
- `src/app/api/conversations/[id]/send/route.ts` 会将 `model` 直接传给 `runApiConversationTurn()` 或 `executor.executeTask()/appendMessage()`。

这条链是当前最直接、最常用的 AI 交互入口。

### 2.2 Prompt Run

入口：

- `src/server/runtime/agent-runs-dispatch.ts`
- `src/lib/agents/prompt-executor.ts`

作用：

1. 从手动 dispatch 或某些流程触发 prompt mode run
2. 解析 runtime contract / execution profile
3. 选择 provider 和 model
4. 创建 run 记录并执行

关键证据：

- `agent-runs-dispatch.ts` 会把 `body.model` 透传给 `executePrompt()`
- `prompt-executor.ts` 会通过 `resolveCapabilityAwareProvider()` 决定最终 provider/model

这条链是当前 runtime 主线里最完整的一条“可显式带模型”的执行路径。

### 2.3 Template / Stage Run

入口：

- `src/lib/agents/group-runtime.ts`

作用：

1. 模板派发
2. pipeline stage 执行
3. run 创建与状态推进

关键证据：

- `group-runtime.ts` 中 `resolveDepartmentExecutionProvider()` 决定 provider 路由
- `finalModel = input.model || providerRouting.model || group.defaultModel || 'MODEL_PLACEHOLDER_M26'`

这是 Projects / Template / Pipeline 运行时最核心的 AI 主链。

### 2.4 CEO 指令解析

入口：

- `src/lib/agents/ceo-agent.ts`
- `src/lib/agents/llm-oneshot.ts`

作用：

1. 将自然语言 CEO 指令解析为结构化调度/派发意图
2. 如果解析成功，再进一步派发项目或 prompt run

关键证据：

- `parseCEOCommandWithLLM()` 调 `callLLMOneshot(prompt, undefined, 'executive')`
- `callLLMOneshot()` 会先 `resolveProvider(layer, wsPath)` 再选 executor

这条链是真调用模型的，但配置与执行一致性较差，后文会单独说明。

### 2.5 Pipeline 生成

入口：

- `src/app/api/pipelines/generate/route.ts`
- `src/lib/agents/pipeline-generator.ts`

作用：

1. 根据目标自动生成 graph pipeline draft
2. 通过 one-shot LLM 返回 JSON 草案

关键证据：

- `/api/pipelines/generate` 接收 `model`
- `generatePipeline()` 调 `callLLM(prompt, input.model)`

这条链具备“API 可传模型”的能力，但当前 UI 暴露不足。

### 2.6 Supervisor / Evaluate

入口：

- `src/lib/agents/supervisor.ts`
- `src/lib/agents/group-runtime.ts`

作用：

1. 阶段评审
2. output review / evaluate
3. 监督性或收口性模型调用

这条链真实存在，但当前没有显式用户级模型选择入口，更多依赖 layer/scene/provider 配置。

---

## 3. 哪些名字看起来像 AI，但当前不算稳定模型主链

下面这些区域的命名有明显 AI 气质，但当前多数并不是稳定的模型调用主链：

1. `Knowledge`
2. `Growth`
3. `Evolution`
4. `Company Loop`

当前更接近：

1. 规则驱动
2. 存储与索引驱动
3. workflow / proposal / memory candidate 驱动

结论：

- 这些系统可能“会消费 AI 结果”
- 但现在还不能把它们视为与 Conversations、Prompt Run、Template Run 同等级的稳定模型调用主链

这意味着后续在“配置 Codex 后 Knowledge 是否真的会走它”这个问题上，还需要补完整旅程，而不是默认认为已经接通。

---

## 3.1 为什么没有出现 GenericAgent 式的自动进化

这个问题不能简单回答成“我们还没做”，因为当前仓库里其实已经有大量对应组件。

更准确的结论是：

> 我们已经有 `RunCapsule / WorkingCheckpoint / MemoryCandidate / GrowthProposal / EvolutionProposal / Company Loop / SystemImprovementProposal` 这些部件，但它们还没有成为所有 AI 主链的默认热路径。

也就是说，当前缺的不是“有没有自进化模块”，而是：

1. 它们没有像 `GenericAgent` 一样嵌进核心 loop 协议。
2. 它们主要挂在 run 后处理、治理 API、company loop 或 proposal review 上。
3. 因此用户看到的是“系统有增长子系统”，而不是“每条 AI 流程都会自然学到东西”。

### 3.1.1 GenericAgent 的自动进化机制本质

根据已有研究文档 `docs/research/genericagent-design-essence-code-analysis-2026-04-25.md`，`GenericAgent` 的自动进化不是一个旁路系统，而是 loop 协议的一部分。

它的关键点是：

1. 每轮强制产出工作摘要和 working memory。
2. loop 内就内置 `update_working_checkpoint` / `start_long_term_update` 这类能力。
3. 长期能力增长优先进入 memory / SOP / skill / asset，而不是继续膨胀核心代码。
4. 自主性总是带摩擦：cooldown、ask_user、verify、report、schedule lock。

所以 `GenericAgent` 的“自动进化”看起来更连续，是因为：

- 记录
- 结晶
- 提案
- 复用

这几步没有被拆成完全分离的产品面，而是从 loop 一开始就被当作默认协议。

### 3.1.2 OPC 里已经存在的对应组件

当前 OPC 并不是没有对标能力，对应关系其实很清楚：

1. `RunCapsule / WorkingCheckpoint`
   - `src/lib/company-kernel/contracts.ts`
   - `src/lib/company-kernel/run-capsule-store.ts`
   - `src/lib/company-kernel/working-checkpoint.ts`
2. `MemoryCandidate / Memory Promotion`
   - `src/lib/company-kernel/memory-candidate.ts`
   - `src/lib/company-kernel/memory-promotion.ts`
3. `GrowthProposal / Company Loop`
   - `src/lib/company-kernel/crystallizer.ts`
   - `src/lib/company-kernel/company-loop-executor.ts`
4. `EvolutionProposal`
   - `src/lib/evolution/generator.ts`
5. `SystemImprovementProposal`
   - `src/lib/company-kernel/self-improvement-planner.ts`

从系统资产角度看，我们已经比 `GenericAgent` 更重：

1. 有预算
2. 有审批
3. 有观察态
4. 有 growth / evolution / self-improvement 三层治理

问题不在“能力缺失”，而在“接缝没有统一”。

同时还要补一个更细的判断：

1. OPC 在治理壳上已经明显重于 `GenericAgent`
2. 但在回合级 working memory 协议上仍然弱于 `GenericAgent`

原因是：

1. `GenericAgent` 把每轮 `<summary>` / working memory 当成 loop 强制合同
2. OPC 当前更多是通过 run 结束后或 run 状态变化后重建 `RunCapsule`
3. 也就是说，OPC 更强的是治理和发布约束，不是执行中记忆协议

### 3.1.3 真正的断点：它们是 sidecar，不是主链默认协议

当前这些能力主要通过下面几条 sidecar 链进入系统：

1. `run-registry` 在 create/update 时持久化 `RunCapsule`
   - `src/lib/agents/run-registry.ts`
2. `persistKnowledgeForRun()` 在 prompt run 和部分 finalized workflow run 后做 memory promotion
   - `src/lib/knowledge/index.ts`
   - `src/lib/agents/prompt-executor.ts`
   - `src/lib/agents/finalization.ts`
3. `generateGrowthProposals()` 主要由手动 API 或 company loop growth-review 驱动
   - `src/app/api/company/growth/proposals/generate/route.ts`
   - `src/lib/company-kernel/company-loop-executor.ts`
4. `generateEvolutionProposals()` 主要由手动 API/CEO Dashboard 驱动
   - `src/app/api/evolution/proposals/generate/route.ts`
   - `src/components/ceo-dashboard.tsx`

这意味着当前的增长机制更像：

```text
先执行
再落 run capsule
再提 memory candidate
再人工或 loop 触发 proposal 生成
再审批/发布/观察
```

而不是：

```text
执行时就带着工作记忆与长期更新协议
执行后自然进入统一的增长闭环
```

### 3.1.4 为什么 6 条 AI 主链没有统一进入这个闭环

下面按主链分别看。

#### A. Conversations / CEO 线程聊天

问题：

1. 本地 provider conversation 主要是 transcript 存储，不是 run-based execution。
2. 它不会创建 `AgentRunState`，也就没有统一的 `RunCapsule`、`resultEnvelope`、`WorkingCheckpoint`。

证据：

- `src/lib/local-provider-conversations.ts`
- `src/lib/api-provider-conversations.ts`
- `src/app/api/conversations/[id]/send/route.ts`

结果：

- 聊天可以调用模型
- 但默认不会自然进入 company-kernel 的记忆/增长链

#### B. Prompt Run

现状：

1. 这是当前接入自增长最完整的一条主链。
2. run 创建后会进 `run-registry`
3. 完成后会 `persistKnowledgeForRun()`

证据：

- `src/lib/agents/prompt-executor.ts`
- `src/lib/agents/run-registry.ts`
- `src/lib/knowledge/index.ts`

结果：

- Prompt Run 已经具备 `RunCapsule -> MemoryCandidate` 链
- 但 proposal 生成仍不是 inline 自动，而是后续治理动作

#### C. Template / Stage Run

现状：

1. 它也会进入 `run-registry`
2. advisory / delivery finalize 时会触发 `persistKnowledgeForRun()`

证据：

- `src/lib/agents/finalization.ts`

结果：

- 这条链也是“部分接通”
- 但依赖 finalize 产物、result envelope、workflow finalization 质量
- 不是每个 stage 都稳定产出高质量可结晶输入

#### D. CEO command parsing

问题：

1. 这是 one-shot 解析工具链
2. 不创建 run capsule
3. 只负责把命令翻译成结构化派发意图

证据：

- `src/lib/agents/ceo-agent.ts`
- `src/lib/agents/llm-oneshot.ts`

结果：

- 它本身不会进入增长闭环
- 真正进入增长闭环的是它后续派发出来的 run，而不是“解析动作本身”

#### E. Pipeline generation

问题：

1. 也是 one-shot 生成链
2. 当前直接返回 graph draft，不走统一 run capsule / memory promotion

证据：

- `src/app/api/pipelines/generate/route.ts`
- `src/lib/agents/pipeline-generator.ts`

结果：

- 生成结果可以被人使用
- 但“生成 pipeline 的过程经验”不会自动变成 memory/growth 资产

#### F. Supervisor / Evaluate

问题：

1. 它是诊断型 AI 链
2. 本质是 review / observe，不是产能主链
3. 当前没有把它的判断稳定沉淀为 memory candidate 或 system improvement signal

证据：

- `src/lib/agents/supervisor.ts`

结果：

- 它能发现问题
- 但不会自然把问题转成统一 proposal 资产

### 3.1.5 第二个断点：proposal 生成是“治理动作”，不是“执行默认后处理”

当前 proposal 体系分成两层：

1. `company-kernel/growth`
2. `evolution`

而且两层都更接近治理动作，不是默认 inline 自动动作。

`growth` 的特点：

1. 从 `MemoryCandidate / RunCapsule / KnowledgeAsset` 生成 `GrowthProposal`
2. 受 budget gate 和 company loop review 驱动

证据：

- `src/lib/company-kernel/crystallizer.ts`
- `src/app/api/company/growth/proposals/generate/route.ts`
- `src/lib/company-kernel/company-loop-executor.ts`

`evolution` 的特点：

1. 主要从 `workflow-proposal / skill-proposal knowledge` 和 repeated prompt runs 生成 `EvolutionProposal`
2. 更像旧提案链，主要靠手动 generate

证据：

- `src/lib/evolution/generator.ts`
- `src/app/api/evolution/proposals/generate/route.ts`

结果：

1. 系统有提案能力
2. 但提案能力被拆成了多层治理系统
3. 执行链无法自然给用户形成“它每做一件事都会越来越会做”的连续感

### 3.1.6 第三个断点：不是每个 run 都满足结晶条件

即使进入 run-based 主链，也不等于一定会自进化。

原因是当前 memory/growth 机制有明显质量门槛：

1. `MemoryCandidate` 依赖 evidenceRefs、stability、novelty、conflict、volatility 评分
2. `GrowthProposal` 依赖 reusable pattern、workflow suggestion、run cluster、knowledge promotion
3. 高风险 proposal 还要经过审批、dry-run、observe

证据：

- `src/lib/company-kernel/memory-candidate.ts`
- `src/lib/company-kernel/memory-promotion.ts`
- `src/lib/company-kernel/crystallizer.ts`
- `src/lib/company-kernel/self-improvement-planner.ts`

这其实是对的，因为它比 `GenericAgent` 更偏真实组织治理。

但副作用是：

- 用户不会感觉到“每个 AI 流程都在自动进化”
- 因为系统在刻意避免低质量、无证据、无审计的自动沉淀

### 3.1.7 第四个断点：增长机制当前是双轨并存

当前仓库里并不是只有一套增长链，而是两套并行：

1. 新主线：`RunCapsule -> MemoryCandidate -> GrowthProposal / SystemImprovement`
2. 旧主线：`EvolutionProposal`

旧 `evolution` 的输入更偏：

1. `KnowledgeAsset(status=proposal)`
2. repeated prompt runs

证据：

- `src/lib/evolution/generator.ts`

新 `company-kernel` 的输入更偏：

1. `RunCapsule`
2. `MemoryCandidate`
3. promoted knowledge
4. operating signal / agenda / budget / approval

证据：

- `src/lib/company-kernel/crystallizer.ts`
- `src/lib/company-kernel/self-improvement-planner.ts`

这带来的直接结果是：

1. 新 kernel 更接近 `GenericAgent` 的“执行经验驱动增长”
2. 旧 evolution 更像模板化 proposal 系统
3. 用户视角会感觉系统“好像有增长，但不是一条完整统一的增长链”

### 3.1.8 一个更准确的判断

所以，当前状态不是：

- “我们没有参考 GenericAgent”

而是：

- “我们参考了，并且已经造了更重的治理壳”
- “但这些能力主要停留在 company-kernel / growth / evolution / self-improvement 子系统里”
- “还没有把它们变成所有 AI 主链共同遵守的默认协议”
- “而且旧 evolution 和新 company-kernel 增长链还没有完全收口到一套统一主线”

因此用户会看到两个现实同时成立：

1. 系统里已经有大量自增长基础设施
2. 但大部分 AI 流程还没有表现出 GenericAgent 那种连续、自然、自解释的学习感

---

## 4. 当前模型选择入口盘点

当前系统有多个“看起来能选模型”的入口，但它们不统一。

### 4.1 聊天 / CEO 线程

入口：

- `src/components/chat-input.tsx`

现状：

1. 用户能从 dropdown 选模型
2. 也能选 `MODEL_AUTO`
3. 发送时把 `currentModel` 传给 `api.sendMessage(...)`

结论：

- UI 能选
- 但它使用的是页面态 `currentModel`，不是 Settings 的唯一真相源

### 4.2 Prompt Run / Stage Dispatch

入口：

- `src/components/agent-runs-panel.tsx`

现状：

1. 支持 `follow-header`
2. 支持显式模型
3. 支持 group default

结论：

- 这是当前最接近“显式控制 run 模型”的入口
- 但它仍然会受 provider fallback 和 layer/default 逻辑影响

### 4.3 Settings：组织默认 / layer / scene

入口：

- `src/components/settings-panel.tsx`
- `src/lib/providers/ai-config.ts`

现状：

1. 能设置组织默认 provider
2. 能设置组织默认 model
3. 能设置 scene 覆盖
4. 已能配置 `native-codex` 的 `Codex Transport`
5. 已能刷新 provider model catalog

结论：

- 配置入口已经很强
- 但消费侧还没有完全统一按这里执行

### 4.4 Department

现状：

1. 当前 department override 只覆盖 provider
2. 不覆盖 model

证据：

- `resolveProvider()` 在 department 分支直接返回 `model: config.defaultModel`

结论：

- Department 现在不能表达“这个部门固定用某个模型”

### 4.5 CEO scheduler command

现状：

1. API 暴露了 `model?: string`
2. 后端 `processCEOCommand()` 实际忽略 `_options`

结论：

- 这是假的模型透传能力

### 4.6 Pipeline generate

现状：

1. API 可以传 `model`
2. 当前主要 UI 没把它明确暴露出来

结论：

- 能力在
- 旅程不完整

### 4.7 Supervisor / Evaluate

现状：

1. 没有显式用户级模型选择
2. 主要依赖 layer/scene/provider 解析

结论：

- 可配置性弱
- 很容易和用户对“我已经设置了 Codex”的心理预期脱节

---

## 5. Codex 配置旅程审计

## 5.1 用户能完成的前半段

当前用户要配置 Codex，大致旅程是：

1. 打开 `Settings`
2. 进入 `Provider 配置`
3. 将组织默认 provider 或某个 layer/scene provider 设为 `native-codex`
4. 看到 `Codex Transport`
5. 看到 provider-aware model picker
6. 保存到 `~/.gemini/antigravity/ai-config.json`

关键落点：

- `src/components/settings-panel.tsx`
- `src/server/control-plane/routes/settings.ts`
- `src/lib/providers/ai-config.ts`

结论：

- 就“配置页面能不能选 Codex / Transport / 模型”来说，答案是能

## 5.2 旅程在后半段的断裂

问题在于，用户完成配置之后，执行层并没有全链路一致消费这份配置。

当前断裂主要发生在：

1. 新建聊天
2. 已有聊天
3. Projects/Template run
4. CEO 指令解析
5. Pipeline 生成
6. Knowledge 后续生成动作

换句话说：

- 用户能配置 Codex
- 但不能确信“我刚才选的 provider/model，就是系统真正执行时用的那一对”

---

## 6. 核心断裂点矩阵

下面是当前最关键的断裂点。

### 6.1 Settings model 不是唯一真相源

问题：

- 聊天发送走页面级 `currentModel`
- 不直接以 `ai-config.defaultModel/layer.model/scene.model` 为单一真相

证据：

- `src/app/page.tsx` 中 `handleSend()` 使用 `currentModel`

影响：

1. 用户在 Settings 改了模型，不代表当前聊天会话立即使用
2. 聊天 header、Settings、实际执行有三套状态

### 6.2 `MODEL_AUTO` 不是 provider-aware

问题：

- 聊天里的 `MODEL_AUTO` 仍然按 Antigravity placeholder 优先级选模型
- 不是先看当前 provider，再选该 provider 下的默认或推荐模型

证据：

- `src/app/page.tsx` 中 `handleSend()` 对 `MODEL_AUTO` 的硬编码优先级

影响：

1. `openai-api / gemini-api / grok-api / custom / claude-api` 有明显错配风险
2. 只有少数 adapter 会额外做兜底映射

### 6.3 Projects / Template 主链不稳定继承 Settings model

问题：

- Template/Stage run 的最终 model 取值逻辑是：
  - `input.model`
  - `providerRouting.model`
  - `group.defaultModel`
  - placeholder fallback
- 并没有清晰保证“若用户在 Settings 里为当前 provider/layer 配了 model，就一定贯穿到最终执行”

证据：

- `src/lib/agents/group-runtime.ts`

影响：

1. Projects 看起来已支持 provider/model 配置
2. 但运行时仍可能掉回 group default 或 placeholder

### 6.4 `native-codex` 的 `pi-ai/native fallback` 只在本地聊天链路真正生效

问题：

- 当前 `native-codex` 的 `pi-ai transport` 主要接在本地 provider conversation executor 上
- Department runtime 主线里的 `native-codex` 仍经 `ClaudeEngineAgentBackend('native-codex')`

证据：

- `src/lib/backends/builtin-backends.ts`

影响：

1. 用户在 Settings 配置了 `Codex Transport`
2. 但 Projects / agent-runs / department runtime 主线不一定真的走这条 transport

### 6.5 CEO command 的 `model` 参数是假的

问题：

- 前端 `api.ceoCommand(command, { model })` 会传 `model`
- 后端 `processCEOCommand(..., _options)` 直接 `void _options`

证据：

- `src/lib/api.ts`
- `src/lib/agents/ceo-agent.ts`

影响：

1. UI/API 看起来支持模型配置
2. 实际 CEO 指令解析并不消费它

### 6.6 `callLLMOneshot()` 的 provider 解析能力超过了 executor 支持面

问题：

- `callLLMOneshot()` 会按 `resolveProvider(layer, wsPath)` 解析 provider/model
- 但 `getExecutor(provider)` 并不等价支持所有可能 provider 的 one-shot 语义

影响：

1. 一旦把 `executive` 层切到某些 API provider
2. CEO 解析和 Pipeline 生成可能直接断

这不是 UI 断裂，而是 runtime contract 断裂。

### 6.7 provider-aware model catalog 在 UI 层被降成“全局合并模型列表”

问题：

- `buildProviderAwareModelResponse()` 会把多 provider 的模型去重合并成一份列表
- 聊天 dropdown 仍以裸 `model` 字符串选择

证据：

- `src/lib/provider-model-catalog.ts`
- `src/components/chat-input.tsx`

影响：

1. 失去了 `provider + model` 成对关系
2. 同名模型、跨 provider 模型、fallback 模型会变得不可信

### 6.8 capability fallback 会切 provider，但可能保留旧 provider 的显式 model

问题：

- `resolveCapabilityAwareProvider()` 在 fallback 时会切 provider
- 若外部还保留显式 model 字符串，可能出现 provider 已变、model 仍是旧 provider 语义

证据：

- `src/lib/agents/department-execution-resolver.ts`

影响：

1. provider fallback 的可观察结果不稳定
2. 用户很难知道自己最后到底跑了什么

### 6.9 department override 丢掉 layer model

问题：

- `resolveProvider()` 在 department 分支返回：
  - `provider: deptProvider`
  - `model: config.defaultModel`

而不是：

- `layer.model`
- `scene.model`
- department-aware model

影响：

1. 只要命中 department override
2. layer 上的模型选择就会被吃掉

### 6.10 Settings 改动不会迁移已有 conversation

问题：

- 旧会话仍沿用创建时的 provider/session handle 上下文

影响：

1. 用户刚保存 Settings 后，如果继续在旧会话里发消息，看到的可能不是新配置效果
2. 用户体验上会以为“Settings 没生效”

### 6.11 Knowledge 还没有完整的 Codex 配置消费旅程

问题：

- 目前 Knowledge 主要是 CRUD / 浏览 / 提案 / 候选治理
- 还没有一条明确的“配置 Codex -> 选择模型 -> 执行 Knowledge 生成动作 -> 可回看 provider/model 证据”的端到端路径

影响：

1. 产品层会误以为 Knowledge 已接入统一模型配置
2. 实际上还没有

---

## 7. 一个更准确的系统现状判断

当前系统不是“完全不能配置模型”，而是下面这个状态：

1. 配置层已经存在
2. model catalog 已开始 provider-aware
3. 部分执行层支持显式 model
4. 但消费层没有统一真相源
5. `provider + model` 没有被当成成对的系统合同来维护

所以用户现在看到的是：

- 到处都可以“选”

但系统内部真实情况是：

- 很多地方只是“传了一个裸 model 字符串”
- 并不能保证这和最终 provider、最终 transport、最终 runtime 行为一致

---

## 8. 修复优先级建议

如果后续要真正收敛 `provider/model`，建议按下面顺序做。

### 8.1 第一优先级：统一模型真相源

目标：

1. 所有执行入口都以 `provider + model` 成对消费
2. `MODEL_AUTO` 改成 provider-aware
3. Settings 成为唯一配置真相源

先做这些：

1. 聊天 header 不再单独持有与 Settings 脱节的 model 真相
2. `MODEL_AUTO` 先 resolve 当前 provider，再选 provider default/recommended model
3. 所有 API 入参由裸 `model` 升级为 `provider + model` 或明确 provider context

### 8.2 第二优先级：把 `native-codex` 的 `pi-ai transport` 接进 runtime 主线

目标：

1. 当前 Settings 中看到的 `Codex Transport`
2. 不只对本地聊天生效，也对 Projects / agent-runs / department runtime 生效

否则当前配置只是“部分生效”。

### 8.3 第三优先级：修复 one-shot 链路

范围：

1. CEO command parsing
2. Pipeline generation

目标：

1. one-shot executor 必须与 `resolveProvider()` 的 provider 解析面一致
2. 否则 executive layer 切 provider 后会出现运行时断裂

### 8.4 第四优先级：补齐 Knowledge 旅程

目标：

1. 明确 Knowledge 哪些动作真正调用模型
2. 让这些动作能够消费统一的 `provider + model`
3. 让结果中可回看“这次用了哪个 provider/model”

### 8.5 第五优先级：把自增长协议前移到主链

目标：

1. 让更多 AI 主链默认进入 `RunCapsule -> MemoryCandidate -> Proposal` 闭环
2. 降低“增长能力只存在于 sidecar 治理子系统”的割裂感

先做这些：

1. 对 conversation / one-shot 链补最小执行快照或可映射的 capsule 形态
2. 把 supervisor / diagnostics 产出的高价值判断转成 `system improvement signal`
3. 统一 `growth / evolution / self-improvement` 的触发口径，避免多套 proposal 生成入口继续分裂

---

## 9. 推荐的最终状态

理想状态不是“到处都能选模型”，而是下面这种：

1. 用户在 Settings 里配置组织默认、layer、scene、provider profile
2. 系统内部统一解析出一对可信的 `provider + model`
3. 聊天、Prompt Run、Template Run、CEO command、Pipeline generation、Knowledge generation 都消费同一合同
4. fallback 如果切 provider，也必须同步切换到合法模型
5. 页面上任何“当前模型”展示，都能对应到真实执行证据

如果做不到这 5 条，`provider/model` 体系就还只是“有配置界面”，而不是“有可信执行闭环”。

---

## 10. 当前建议

当前最务实的下一步不是继续加新模型入口，而是先做这三件事：

1. 统一 `provider + model` 合同，禁止跨 provider 传裸 `model` 字符串。
2. 把 `native-codex` 的 `pi-ai transport` 从 local chat 扩到 agent-runs / Projects / department runtime 主线。
3. 把 `CEO command / Pipeline generation / Knowledge generation` 收到同一套 provider/model 决策流上。

只有这三步做完，`Codex` 配置、模型选择、运行时执行、结果回看才会真正闭环。
