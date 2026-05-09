# AGENTS.md

## 工作方式要求（最高优先级）

- 🐱 每次对话开始必须先称呼"大哥"
- 📖 **每次开始新任务前，必须先阅读 `docs/PROJECT_PROGRESS.md`**，- 📝 **只有在功能/代码修改已完成、已测试验证、可验收时，才更新 `docs/PROJECT_PROGRESS.md`**，其他按照功能改动大小，记录一个独立的跟踪文档，确保避免上下文压缩后丢失信息。 可以 `docs/project/.
- 研究类、讨论类、约束类文档，写在本地 `docs/design/` 或 `docs/research/`.
- 你要积极使用 subagent，但只在任务可明确拆成互不冲突、边界清晰、输出独立的子问题时使用；不要为了并行而拆散本应由主线统一判断的问题。

- 除非用户明确要求，不要顺手修改需求范围之外的代码、文档、配置或文案，不要随手修改任何其他逻辑。
- 🌐 **需要浏览器自动化/截图时优先使用 `bb-browser`，不要优先使用 Playwright；浏览器验收不是每轮任务的必选项**

1. **端到端完成** - 不要做一半让用户来测试/验收
2. **主动测试验证** - 完成功能后自己主动测试，不要让用户来测


### 变更边界锁定

开始实现前，必须先明确写出：

1. 本轮要修什么
2. 本轮不改什么
3. 允许修改的模块边界
4. 不允许触碰的主链路


### Multi-Agent Work Mode（强制）

- 目标：subagent 用来降低主线程上下文污染，不用来把同一条主链路拆成多人同时盲改。主线程始终保留边界锁定、方案决策、结果合并、最终验收和对用户汇报的 ownership。
- 项目级 Codex agent 统一放在 `.codex/agents/`。如果这些 agent 已存在，优先使用项目级 agent；没有命中时再回退到内置 `explorer` / `worker`。
- 项目默认并发配置写在 `.codex/config.toml`：`max_threads = 4`、`max_depth = 1`。默认不要上调；只有用户明确要求更激进 fan-out，且确认不会污染共享运行态时，才允许单次提高。

#### 1. 什么时候启动
- 只有当子问题边界清楚、输入输出独立、可以指定唯一 write owner 时，才允许拉起 subagent。
- 这个仓库适合 fan-out 的边界只有五类：
  1. 展示层：`src/app/**`、`src/components/**`
  2. control-plane / API：`src/app/api/**`、`src/server/control-plane/**`
  3. 执行/运行时：`src/lib/company-kernel/**`、`src/lib/agents/**`、`src/lib/providers/**`、`src/lib/bridge/**`
  4. 测试与验收
  5. 文档同步
- 以下情况默认不要启用 multi-agent：
  1. 根因还没判断清楚属于执行层、治理层、展示层哪一层
  2. 多个子任务会同时改 `server.ts`、`src/app/page.tsx`、`src/lib/types.ts`、`src/lib/api.ts`、`src/server/control-plane/server.ts`、`src/server/workers/**` 或跨层公共 contract
  3. 验收依赖同一套本地服务、同一份 SQLite 状态、同一个 scheduler/worker 进程
  4. 只是为了并行而并行

#### 2. 推荐角色
- `repo_mapper`：只读代码勘探。负责入口、状态回写点、测试位置、相关文件清单；不提修复方案、不改代码。
- `runtime_investigator`：只读运行时排障。负责 `agent-runs`、control-plane/runtime、Codex bridge、company-kernel/self-improvement 的链路复盘、日志归因、定向测试入口定位。
- `ui_debugger`：页面与交互证据采集。负责复现、DOM / console / network 证据、对应 API 对照；不改应用代码。需要浏览器验证时优先 `bb-browser`。
- `change_worker`：唯一可写实现代理。只在主线程拿到 mapper / investigator / ui_debugger 的结论后出手，做最小改动并跑最相关验证。

#### 3. 角色分工
- 主线程：读取进度、锁定“本轮改什么/不改什么”、拆分任务、分配 ownership、收口结论、合并结果、跑最终验证、更新文档和 `docs/PROJECT_PROGRESS.md`。
- Read-only agent：只看代码、盘点影响面、识别副作用和测试入口；不写文件、不改配置、不启动长期进程。
- Write-capable agent：只处理一个独立模块或一组明确文件，自带最小验证，不自行扩大范围。
- 高风险链路可以加一个 fresh verifier，但 verifier 必须只读，不能和实现 worker 共用上下文。

#### 4. 拆分方式
- 先用只读 agent 并行收集证据，再由主线程一次性定最终拆分；不要边探索边让多个 write agent 直接开写。
- 优先按真实代码边界拆，不按“前后端”口号硬拆。默认按 `展示层 / control-plane / runtime / scheduler / docs&tests` 组织任务。
- 如果多个改动共享同一个状态回写点、同一个 API contract、同一个验收环境，就不要拆成多个 write agent。

#### 5. Write-Scope Ownership
- 同一时刻一个文件只能有一个 writer。
- 主线程默认保留以下写权限，不并行下放：`docs/PROJECT_PROGRESS.md`、`package.json`、`server.ts`、`src/app/page.tsx`、`src/lib/types.ts`、`src/lib/api.ts`、`src/server/control-plane/server.ts`、`src/server/workers/**`、任何 scheduler / bridge worker / approval / self-improvement 的总入口文件。
- `change_worker` 一旦发现要跨出已分配目录、修改共享 contract、或碰到别的 worker 的文件，必须停下并回报主线程，不得自行扩边界。
- 如果当前环境不能给 write-capable worker 独立 worktree，则同一时刻只允许一个可写 worker，其余全部退回只读 agent。

#### 6. 等待规则
- 只读 agent 可以并行；write agent 开写前，主线程必须先收齐只读结论并锁定拆分方案。
- write agent 开写后，主线程和其他 worker 不得同时修改其 ownership 范围。
- 一个 worker 的半成品不能直接作为另一个 worker 的输入；必须先由主线程收口、确认接口，再发起下一跳。
- 浏览器回放、live replay、重启服务、全链路验收必须等所有写入完成并合并后再统一执行，避免被旧 bundle、旧 route manifest 或 scheduler/worker 副作用污染。

#### 7. 验证规则
- 每个 write agent 必须先完成自己边界内的最小验证，并回传真实命令和结果。
- 主线程必须在合并后做一次最终验证；至少覆盖受影响链路的 `eslint`、`tsc`、相关 `vitest`。API / 页面验收按变更影响面决定，不是每轮必选项。
- 涉及 `scheduler`、`worker`、`company-kernel`、`approval`、`provider`、`bridge`、`self-improvement` 时，不接受“子任务各自通过”作为完成条件，必须做一次 fresh integrated validation。
- 需要页面验收时优先 `bb-browser`；只有工具不可用或任务确实依赖 Playwright 时才回退，并在汇报里说明原因。若本轮变更可由静态检查、单元测试、集成测试或 API 验证充分覆盖，可以不做浏览器验收，但需在汇报里说明未执行浏览器验收的原因。
- 验收过程中不要同时拉多套本地服务；确需隔离环境时，先复用现有 API，再显式禁用 `scheduler / companions / bridge worker`，任务结束后立即回收进程并确认端口释放。

#### 8. 主线程上下文清洁
- `repo_mapper` / `runtime_investigator` / `ui_debugger` 回传格式固定为：`边界 / 事实 / 风险 / 建议下一步`；不要回贴整段日志、整文件摘录或长链路思维过程。
- `change_worker` 回传只保留：修改范围、实际改动、验证命令、失败点/遗留风险。
- 主线程只保留最终决策所需的结论和证据路径，不搬运 subagent 全量上下文。
- 研究、对比、约束说明写 `docs/design/` 或 `docs/research/`；不要把 subagent 讨论过程写进 `docs/PROJECT_PROGRESS.md`。
- 每轮收口后都以当前工作树和当前验证结果为唯一事实源，主动丢弃旧假设，再决定是否继续 fan-out。

### 用户需求整理规范
- 整理用户需求/用户场景时，按模块或用户旅程分组，只写用户故事和 `[支持] / [不支持]`。
- 不写表格、ID、当前证据、优先级建议、可验收清单；除非用户明确要求。
- 不使用“部分支持”：没有形成完整可用闭环的场景统一记为 `[不支持]`，描述要尽量详细但简洁。

### 前端可见文案约束
- You should not use visible, in-app text to describe the application's features, functionality, keyboard shortcuts, styling, visual elements, or how to use the application.
- 不要把内部设计说明、结构解释、实现意图、交互引导语写成用户可见文案；界面上只保留业务事实、状态、风险、结果和当前动作。

### 完成任务的标准（必须满足）
每完成一个功能，必须：
1. ✅ 自己测试验证通过（有实际测试输出）
2. ✅ 确认受影响流程能跑通
3. ✅ 有测试证据（日志/输出；截图仅在需要页面验收时提供）
4. ✅ 再告诉用户完成情况

非编程任务（如需求整理、用户场景索引、研究/讨论/约束文档）不需要测试验证，也不需要为验证而启动服务；完成文档修改后直接汇报修改位置即可。

> 这是强制工作流程，避免重复劳动和信息脱节。



## 文档同步规则（强制）

### 原则
> **代码改了 → 文档必须改。不是"之后再补"，是当场改。**

### `PROJECT_PROGRESS.md` 使用边界（强制）

`docs/PROJECT_PROGRESS.md` 只用于记录：

1. 已完成并通过验证的实现
2. 已完成并有验收证据的修复
3. 已落地的系统行为变化

不要写入：

1. 纯讨论
2. 方案推演
3. 约束说明
4. 研究笔记
5. 尚未落地、尚未验收的设计结论

这些内容应写到：

1. `docs/design/`
2. `docs/research/`

### 代码变更 → 文档动作

| 代码变更 | 必须同步更新的文档 |
|:---------|:-----------------|
| 新增/修改 `src/app/api/` route.ts | `gateway-api.md` + `cli-api-reference.md` + `ARCHITECTURE.md` API 表 |
| 新增 `src/lib/` 目录（新子系统） | `ARCHITECTURE.md` 新增章节 + 模块依赖图 + `agent-user-guide.md` 新增节 |
| 重构/拆分模块 | `ARCHITECTURE.md` 关键文件表 |
| 修改数据模型（types.ts） | `agent-user-guide.md` 字段表 |
| 新增配置项/环境变量 | `agent-user-guide.md` 配置示例 |

### 文档同步分级

代码改动后，只同步更新与本轮真实行为变化直接相关的文档。

1. 外部 API / 用户可见行为变化：更新 `guide + ARCHITECTURE`
2. 内部实现细节变化但外部行为不变：优先更新 `ARCHITECTURE` 或 `docs/design/`
3. 纯测试、重构、命名清理：默认不扩散更新多份用户文档
