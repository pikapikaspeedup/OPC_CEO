# 常用 AI IDE 记忆与自定义指令 (Memory & Custom Instructions) 机制全指北

为了防止遗忘不同编辑器或系统平台中针对 AI 的“项目人设”和“长效记忆”如何配置，特汇总各大主流 AI IDE 的机制与踩坑点。在对不同的项目做定制化 AI 调教时，请严格参考下表及目录路径设置。

---

## 1. Antigravity IDE (当前使用的系统)
Antigravity 拥有区分明确的两套体系：**规则 (Rules)** 和 **工作流 (Workflows)**。理解两者的应用场景至关重要。

### A. 规则 (Rules) - 负责注入“持久人设”与“常驻上下文”
**【机制位置】**：
- **全局规则**：`~/.gemini/GEMINI.md` (应用于所有工作区)
- **工作区局部规则**：`.agents/rules/` 文件夹下 (向后兼容 `.agent/rules/`)。

**【激活方式与避坑点】**：
规则文件（Markdown后缀）**必须**包含 YAML Frontmatter 才能定义其激活策略，否则将失效。支持以下策略：
1. `trigger: always_on` (始终启用：打造 Agent 灵魂人设的必备选项)
2. `trigger: manual` (手动在对话输入框 @ 提及该文件才激活)
3. `trigger: auto` (模型基于对规则描述的理解，自行决定是否应用)
4. `globs: ["*.js", "src/**/*.ts"]` (针对特定文件时自动触发应用)

*进阶技巧：你可以在规则文件中使用 `@` 符号提及其他文件，Antigravity 支持绝对路径、相对路径以及以代码仓库根目录作为解析基准的智能索引。*

### B. 工作流 (Workflows) - 负责引导“结构化任务步骤”
**【机制位置】**：
- **全局工作流**：在自定义面板添加后，所有项目均可用，由 `/workflow-name` 触发。
- **工作区局部工作流**：项目根目录的 `.agents/workflows/` (向后兼容 `.agent/workflows/`)。

**【核心特点】**：
工作流不需要 `trigger` 配置，只要把含有标题、描述、步骤的 Markdown 文件放在 `workflows` 下，系统即可注册一个长命令。在 Agent 的输入框中键入 `/你的文件名` 即可触发。而且，工作流之间支持**无限套娃调用**（如在 `/A` 的步骤中要求触发 `/B`）。

---

## 2. 总结与最佳实践
在 Antigravity 平台中塑造具有“长期记忆”、“明确身份（人设）”和“公司级大局观”的 Agent 体系时：
1. **严格遵守官方工作区规范**：确立规则必须落在 `.agents/rules/`。
2. **警惕 YAML 首部标签**：漏写 `trigger` 会导致系统级规则静默失效。
3. **关键参考文档强引导**：除了隐式规则，始终保留 **`PROJECT_PROGRESS.md`** 和 **`ARCHITECTURE.md`** 作为实体上下文锚点。

---

## 附录：本系统架构底层的 Memory 注入逻辑深度扒谱 (Code Review)

经过对当前我们项目中 `src/lib/providers/` 连接层（Executor）的代码深度审查，发现在代码级（Node.js 端）各大引擎对于 Memory 的处理方式大相径庭。理解这一层级有利于排查“为什么有时大模型像个失忆症”。

### 1. 原生 Antigravity IDE 引擎 (`antigravity-executor.ts`)
**【机制特点】：无状态网关传递，语言服务器自动拦截与组装。**
当你观察后台代码时，会发现 `antigravity-executor.ts` 完全没有哪怕一行读取 `.agents/rules/*.md` 的代码。它只负责调用 `grpc.startCascade()` 建立任务流。
**原因**：Antigravity 原生扩展的 Language Server 极其强大。它拦截了所有送往模型的 System Prompt 拼装环节。当它收到任务请求时，底层插件环境会自动去扫描 `workspace` 下的规则系统并挂载。所以 Node 端完全解耦，做到了极其优雅的架构。

### 2. Codex / 纯 API 模型直连 (`codex-executor.ts`)
**【机制特点】： Node 端粗暴硬编码兜底、全局污染危险。**
纯净的 API 接口（或者类似 Cursor API / OpenAI 原生接口）没有本地 Language Server 帮它读盘。如果强行把请求发给它们，它们必然会“失忆”。
在扒看 `codex-executor.ts` 第 42 行的源码时，我们可以看到由于 Codex 没有环境扫描能力，我们的代码写死了一个强行兜底补库：
```typescript
function readOrgMemory(): string {
  const memoryDir = path.join(process.env.HOME || '~', '.gemini', 'antigravity', 'memory');
  if (!fs.existsSync(memoryDir)) return '';
  // ... reads all .md files and concatenates them ...
}
```
并且在 `client.startSession()` 时直接塞进了 `baseInstructions` 里。
**⚠️ 严重架构踩坑警告**：这种做法目前读取的是本地家目录 `~/.gemini/antigravity/memory/`（属于全公司组织级的通用记忆），**而不是具体某个业务 Workspace 的独立记忆**！如果业务流不幸触发被分发去了使用纯 API 或 Codex 组件的 Provider 上，不管你在这个业务自身的 `.agents/rules` 写了多么漂亮的人设，在目前的硬编码机制下都会失效，全部降级成了干瘪的组织级全局记忆。

**总结**：如果我们要完全使用分布式的记忆和人设体系，必须依赖原生的 Antigravity 运行引擎，否则就必须全面重构诸如 Codex 那一侧的代码，让它们具备扫描相应工作区目录的嗅探能力。
