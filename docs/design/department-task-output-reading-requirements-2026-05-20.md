# 部门任务产出物阅读能力需求手册

日期：2026-05-20

## 1. 结论

方案有效。

在现有系统里，Department 已经以 Workspace + `.department/config.json` 的方式存在，Project 已经承担任务/项目分组，Run 已经承担执行记录，KnowledgeAsset 已经承担结构化知识沉淀，CEO Office 已经承担经营视角入口。

因此，新增“部门可阅读产出物”不应该推翻现有模型，也不应该把部门目录直接变成普通文件浏览器。

最终方案是：

> Projects 的部门视图是完整阅读主入口；部门内容视图同时提供文件目录树和产出物重组目录树；CEO 首页只保留轻量摘要、异常提醒和跳转入口。

这意味着阅读结构应当是：

```
部门
  任务 / Routine / Project
    内容视图
      文件目录树
        Markdown 原文
      产出物重组目录树
        最新简报
        正式报告
        待复核材料
        关联 Run / Knowledge / Project
```

而不是：

```
部门
  所有文件
    所有 Markdown
```

前者符合 CEO 视角和 OPC 经营模型，后者会退化成噪声很高的文件管理器。

## 2. 当前系统判断

### 2.1 已经成立的基础

当前系统已经有几个关键支点：

- DepartmentConfig 已经定义部门身份、类型、技能、OKR、Provider、workspaceBindings 和 executionPolicy。
- Department API 已经能读取和写入 `.department/config.json`，并能读取 rules、memory、digest、quota。
- Projects 页面已经按 Department/Workspace 聚合项目和 projectless runs。
- Department Detail Drawer 已经展示部门经营指标、项目、日报、配额、风险。
- Knowledge API 已经支持 workspace、category、tag、scope、source、confidence 等结构化索引。
- Knowledge 镜像已经会把结构化知识写到本地 Markdown artifact。
- Run resultEnvelope 已经有 outputArtifacts，可作为产出物重组目录树的输入源。

这些基础说明：系统不缺“内容存储”，缺的是“部门内容阅读面”和“部门产出物的重组读模型”。

### 2.2 当前缺口

当前缺口不是 Markdown 文件不够多，而是 Markdown 文件没有被稳定转成可阅读对象。

具体表现：

- 部门文件夹里的 Markdown 可能是规则、记忆、研究、模板、日志、草稿、最终报告，系统无法自动判断哪些值得展示。
- `.department/memory` 是 Agent 记忆，不是完整文档库。
- Knowledge 是知识库，不是按部门任务组织的产出物 inbox。
- Deliverables 绑定 Project/Stage，不覆盖部门 routine 和长期监控类输出。
- CEO Office 看到的是经营状态和 digest，还缺少跳转到部门内容视图的轻量产出物入口。
- 现有文件结构没有任务级索引，导致同一部门下多个长期任务的产出容易混在一起。

所以目标应围绕两个阅读对象收口：文件目录树展示真实文件结构，产出物重组目录树展示由产出物记录生成的虚拟结构。

## 3. 设计原则

### 3.1 不重建部门模型

部门继续以现有 Workspace + DepartmentConfig 为主，不新增一套独立部门系统。

任何新能力都应当能从 workspaceUri 和 departmentId 推导归属。

### 3.2 双视图是部门内容面的基础

部门内容面需要两个并列视图：

- 文件目录树：忠实展示部门 workspace 中允许阅读的文件结构。
- 产出物重组目录树：不按真实路径展示，而是按部门、任务、时间窗口、产出类型和状态，把已有产出物记录重新组织成目录。

文件目录树解决“完整性”和“可追溯”；产出物重组目录树解决“可读性”和“可管理”。

这两个视图不互相替代。

### 3.3 产出物记录驱动重组 View

如果系统已经有 Run outputArtifacts、Project Deliverables、KnowledgeAsset 或后续 DepartmentOutput 记录，产出物重组目录树应围绕这些记录组织。

文件夹负责保存内容，产出物记录负责进入阅读流。

产出物记录至少要支持：

- 属于哪个部门。
- 属于哪个任务。
- 是否给 CEO 看。
- 是否需要复核。
- 摘要和关键结论是什么。
- Markdown 正文在哪里。
- 来源 Run、Project、Scheduler Job 或 Knowledge 是什么。

只有具备这些信息的内容，才适合进入产出物重组目录树；其中 audience 为 CEO 或明确升级的内容，才适合进入 CEO 首页摘要。

### 3.4 任务作为第一阅读分组

CEO 和部门负责人理解工作的方式通常是“这件事有什么结果”，不是“哪个文件夹里有什么 Markdown”。

因此，产出物阅读入口的第一层分组应当是任务：

- 项目型任务优先复用 Project。
- 周期型任务优先映射为 Routine 或 Scheduler Job。
- 无项目的一次性执行可以暂时归入 projectless task group。
- 长期监控类任务应有稳定 taskKey，例如 `linuxdo-ai-watch`。

### 3.5 文件夹是事实源之一，但不是唯一索引

部门文件夹应当能保存和打开 Markdown 原文，但 UI 的主查询不应依赖临时扫描文件系统。

正确关系是：

- 文件系统保存正文和可被 Obsidian 阅读的材料。
- 文件目录树读取受控 reading roots，不全盘扫描 workspace。
- 数据库/Knowledge/Output Registry 保存索引、状态、摘要、标签和归属。
- 产出物重组目录树和 CEO 首页读取索引，不从文件系统临时推断业务语义。

### 3.6 CEO 首页只做轻量承接

CEO Office 不应该展示所有 Markdown 文件，也不应该承接每个部门的完整任务产出树。

CEO 首页只展示：

- 最近高价值产出物的少量摘要。
- 需要 CEO 阅读或决策的异常项。
- 跨部门今日重点。
- 跳转到部门内容视图的入口。

完整文件目录树和产出物重组目录树应放在 Projects 的部门视图，或者部门详情页/任务详情页，而不是 CEO 首屏。

### 3.7 不污染代码仓库根目录

有些部门 workspace 本身就是代码仓库。如果强制把所有任务输出放在根目录，会污染项目结构。

因此，默认系统管理输出可以放在 `.department/outputs/` 之下；如果某个部门本身就是 Obsidian vault 或纯知识部门，可以通过配置增加可见阅读根，例如 `outputs/`、`briefs/`、`research/`。

## 4. 目标能力

### 4.1 Projects 部门内容视图

Projects 已经有部门分组能力，因此部门内容阅读的主入口应优先放在 Projects 的部门视图中，而不是 CEO 首页。

当用户在 Projects 中选中一个部门时，应能直接查看：

- 部门经营概览。
- 项目和运行记录。
- 文件目录树。
- 产出物重组目录树。
- 当前部门最近值得阅读的内容。

这能让 CEO 首页保持轻量，同时让部门层具备完整阅读能力。

### 4.2 文件目录树

文件目录树是部门内容面的刚需。

它展示真实文件结构，但只展示允许阅读的根目录。

默认可读范围：

- `.department/outputs/`
- 配置声明的 reading roots
- Project/Run 明确登记的 artifact path

可折叠系统上下文：

- `.department/memory/`
- `.department/rules/`
- `.agents/rules/`

默认不展示：

- `.git/`
- `node_modules/`
- build/cache/log 临时目录
- 未登记的 raw dump
- 含密钥、cookie、session、token 的文件

文件目录树需要支持：

- 浏览目录。
- 打开 Markdown。
- 区分系统目录、输出目录、研究目录和原始材料目录。
- 显示文件更新时间和大小。
- 对敏感目录和大体积目录做默认隐藏。
- 从文件跳转到关联产出物记录。

### 4.3 产出物重组目录树

产出物重组目录树是从产出物记录生成的虚拟树。

它不要求真实文件系统长成同样结构。

示例：

```text
AI 情报部门
  Linux Do AI 情报监控
    今日
      10:00 简报.md
      12:00 简报.md
    待复核
      账号/额度异常线索.md
    本周汇总
      2026-W21 周报.md
  AI 注册与免费额度监控
    今日
      平台规则变化.md
```

这棵树的节点来自 Run outputArtifacts、Project Deliverables、KnowledgeAsset 或 DepartmentOutput，而不是直接来自 `readdir`。

### 4.4 任务阅读页

任务是部门内容的第一层。

任务页展示：

- 任务目标和状态。
- 最近简报或报告。
- 该任务下的产出物列表。
- 关联 Run、Project、Scheduler Job。
- 关联 KnowledgeAsset。
- 文件夹中的 Markdown 结构。

### 4.5 Markdown 阅读器

系统应该能直接渲染部门产出物 Markdown。

阅读器需要支持：

- 标题、正文、列表、引用、代码块。
- 本地文件路径和 artifact 路径。
- 原文打开入口。
- 关联元数据展示。
- 长文摘要和正文切换。

### 4.6 产出物登记

凡是要进入平台阅读面的文档，都应被登记为产出物。

登记信息至少包含：

```yaml
type: department-output
departmentId: department:file:///...
workspaceUri: file:///...
taskKey: linuxdo-ai-watch
taskTitle: Linux Do AI 情报监控
kind: intel-brief
audience: ceo
status: active
visibility: department
createdAt: 2026-05-20T10:00:00Z
source:
  type: scheduler-run
  runId: run-...
content:
  title: Linux Do AI 情报简报
  summary: 本轮发现 3 条需要复核的 AI 获取异常线索
  markdownPath: .department/outputs/linuxdo-ai-watch/2026-05-20-1000.md
tags:
  - ai-intel
  - linuxdo
  - ai-abuse-watch
```

这份登记可以先复用 KnowledgeAsset 的 tags/source/workspace/category 字段承载；后续再升级为 DepartmentOutput Registry。

### 4.7 Knowledge 联动

长期有价值的产出物应该能进入 Knowledge。

关系应当是：

- 产出物是一次任务结果。
- Knowledge 是可复用沉淀。
- 同一份 Markdown 可以先作为产出物展示，再被提炼为 Knowledge。

例如 Linux Do 监控每两小时生成一份 Intel Brief；其中反复出现的风险模式，才进入 Knowledge 作为 AI 滥用风险模式。

### 4.8 CEO Office 联动

CEO Office 需要一个轻量“最新产出物”入口。

这个入口不展示完整任务过程，也不展示完整目录树，只展示结果摘要和跳转：

- 产出物标题。
- 来源部门和任务。
- 生成时间。
- 一段可读摘要。
- 最多三条关键结论。
- 是否需要复核或决策。
- 点击跳转到部门内容视图中的对应 Markdown。

当产出物很多时，CEO Office 应显示聚合，而不是列表堆叠：

- 今日新增多少份。
- 需要关注多少份。
- 每个部门最重要的一份。
- 每类风险最重要的一条。

### 4.9 产出物编排

产出物编排是第一阶段的核心能力。

它不负责重新生成内容，而负责把已有产出物整理成适合 CEO 阅读的形态。

编排规则包括：

- 按 audience 过滤，只让 `ceo` 或明确升级的产出物进入 CEO Office。
- 按 department 和 taskKey 分组，避免跨任务混杂。
- 按 createdAt/updatedAt 排序，优先展示最近结果。
- 按 status 提权，`needs-review` 高于普通 `active`。
- 按 tags 聚合，例如 `ai-intel`、`risk`、`reportable`。
- 对同一任务同一时间窗口的产出物去重，只保留最适合阅读的版本。
- 对多份产出物生成日内聚合，只展示重点，不堆列表。

CEO 首页看到的不是文件，也不是 run，而是被编排后的阅读单元。

## 5. 用户旅程与支持状态

### 5.1 CEO 查看最新产出

[不支持] CEO 打开 CEO Office 后，看到少量跨部门最新产出摘要、异常提醒和跳转入口。

当前系统有 digest、Knowledge、部门详情和项目入口，但缺少轻量产出物摘要流，以及跳转到部门内容视图的入口。

### 5.2 CEO 在 Projects 查看部门内容

[不支持] CEO 在 Projects 中点击 AI 情报部门后，可以直接进入部门内容视图，并在文件目录树和产出物重组目录树之间切换。

当前 Projects 已有部门分组，Department Detail Drawer 有经营指标、项目、日报、配额，但没有部门内容视图、文件目录树和产出物重组目录树。

### 5.3 CEO 阅读 Linux Do AI 情报简报

[不支持] Linux Do AI 情报监控每两小时生成一份可分享 Markdown 简报，CEO 在平台内看到摘要，点击阅读全文，并能追溯原始来源和任务。

当前可以用外部 bb-browser adapter 抓取和生成内容，但系统内还没有登记、展示和阅读闭环。

### 5.4 部门成员查看完整文件结构

[不支持] 部门成员进入任务页后，可以按文件树浏览该任务的 briefs、research、outputs、raw，并直接渲染 Markdown。

当前系统没有通用部门文件树阅读器，也没有 reading roots 契约。

### 5.5 部门成员查看产出物重组目录树

[不支持] 部门成员进入部门内容视图后，可以看到按任务、时间、状态和类型重组后的产出物目录树，并点击打开对应 Markdown。

当前系统有 Run outputArtifacts、Project Deliverables 和 KnowledgeAsset，但没有把它们编排成统一虚拟目录树。

### 5.6 Agent 写入正式产出物

[不支持] Agent 完成任务后，能够把 Markdown 写入任务输出目录，并自动登记为部门产出物。

当前 Run outputArtifacts 和 KnowledgeAsset 分别存在，但没有统一 DepartmentOutput 写入协议。

### 5.7 Agent 沉淀可复用知识

[支持] Agent 或系统可以把有价值内容沉淀为 KnowledgeAsset，并按 workspace/category/tag 查询。

但这只是知识沉淀，不等于部门任务产出物阅读闭环。

### 5.8 部门规则和记忆管理

[支持] 系统已经支持 `.department/config.json`、rules、memory、digest、quota 等部门基础能力。

这些能力应继续保留，不应被产出物阅读能力替代。

### 5.9 任意 Markdown 自动出现在 CEO Office

[不支持] 任意 Markdown 文件被创建后自动出现在 CEO Office。

这个场景不应该作为目标能力。它会把草稿、规则、日志和原始数据混入 CEO 阅读面，破坏信息质量。

## 6. 推荐目录协议

### 6.1 系统默认协议

对代码仓库型部门，默认使用 `.department/outputs/` 存放系统管理产出：

```text
workspace/
  .department/
    config.json
    rules/
    memory/
    outputs/
      linuxdo-ai-watch/
        briefs/
          2026-05-20-1000.md
        research/
        raw/
        index.json
```

### 6.2 Obsidian 友好协议

对知识工作室型部门，可以允许配置可见阅读根：

```text
workspace/
  tasks/
    linuxdo-ai-watch/
      briefs/
      research/
      raw/
  shared/
    taxonomy.md
    sources.md
  .department/
    config.json
```

系统不应强制所有 workspace 使用这个可见结构，但应允许它作为 reading root。

### 6.3 任务目录内容

任务目录建议包含：

```text
task/
  README.md       # 任务说明，人和 AI 都能读
  briefs/         # 周期简报
  outputs/        # 正式产出
  research/       # 研究过程
  decisions/      # 决策记录
  raw/            # 原始材料，默认不进 CEO 视图
```

其中 `raw/` 可以被任务页访问，但默认不进入 CEO Office。

## 7. 数据模型建议

短期不必新增完整模型，可以先复用 KnowledgeAsset：

- `scope = department`
- `workspaceUri = 部门 workspace`
- `category = domain-knowledge` 或 `lesson`
- `tags` 增加 `department-output`、`task:<taskKey>`、`audience:ceo`
- `source.type = run/system`
- `source.artifactPath = Markdown 路径`

这只是过渡承载方式，不能把目标模型命名成 Knowledge。产品和 UI 仍应使用“部门产出物”和“产出物重组目录树”。

中期应新增 DepartmentOutput：

```typescript
interface DepartmentOutput {
  id: string;
  departmentId: string;
  workspaceUri: string;
  taskKey: string;
  taskTitle: string;
  kind: 'brief' | 'report' | 'research' | 'decision' | 'deliverable' | 'raw';
  audience: 'ceo' | 'department' | 'agent';
  status: 'active' | 'needs-review' | 'archived';
  title: string;
  summary: string;
  markdownPath: string;
  sourceRunId?: string;
  sourceProjectId?: string;
  sourceSchedulerJobId?: string;
  knowledgeId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

DepartmentOutput 的职责是阅读和分发，KnowledgeAsset 的职责是长期复用知识。两者可以互相关联，但不应混为一个概念。

## 8. Linux Do AI 情报任务示例

AI 情报部门下应有一个长期任务：

```text
taskKey: linuxdo-ai-watch
taskTitle: Linux Do AI 情报监控
cadence: every 2 hours
source: https://linux.do/new
audience: ceo
```

每次运行生成一份简报：

```text
.department/outputs/linuxdo-ai-watch/briefs/2026-05-20-1000.md
```

同时登记为部门产出物：

- kind: `brief`
- audience: `ceo`
- tags: `ai-intel`、`linuxdo`、`ai-abuse-watch`
- sourceRunId: 本次 scheduler run
- summary: 本轮高价值内容摘要
- markdownPath: 简报文件路径

CEO Office 只显示一张卡片：

- Linux Do AI 情报监控
- 10:00 简报
- 本轮发现的高价值线索数量
- 最重要的三条结论
- 是否需要人工复核
- 打开全文

原始帖子、抓取结果和详细材料可以保留在任务目录，但不直接进入 CEO 首屏。

## 9. 实施顺序建议

第一步，在 Projects 的部门视图中建立内容入口。

这个入口先不进入 CEO 首页承载大量内容，而是在用户点开某个部门时提供“内容”视图。该视图至少包含两个切换入口：文件目录树和产出物重组目录树。

第二步，建设文件目录树的最小闭环。

文件目录树读取声明过的 reading roots，默认包含 `.department/outputs/` 和显式登记的 artifact path。`.department/memory/`、`.department/rules/`、`.agents/rules/` 放进可折叠的系统上下文区，避免把执行记忆和业务产出混在一起。文件树需要能浏览目录、打开 Markdown、隐藏敏感目录，并显示文件基础元数据。

第三步，建设产出物重组目录树。

已有 Run outputArtifacts、Project Deliverables、KnowledgeAsset 可以先作为输入源。系统先把这些记录归一到同一个部门产出物重组 feed：按部门、任务、audience、status、tags、时间窗口筛选和排序。这里的 feed 是内部编排层，不直接把底层对象名称暴露给 CEO。

第四步，先用 KnowledgeAsset 过渡承接部门产出物索引。

已有 Knowledge API 支持 workspace、tag、category、source，足够支撑最小闭环。Linux Do 情报任务可以先把每份 Intel Brief 写成 Markdown，再创建带 `department-output` 和 `task:linuxdo-ai-watch` 标签的 KnowledgeAsset。但这只是技术过渡，UI 不应把它呈现为普通 Knowledge 条目。

第五步，在 CEO Office 增加轻量“最新产出物”摘要区。

它只读取 audience 为 CEO 的产出物，按更新时间排序，并做当天聚合。CEO 首页只展示少量摘要和跳转到部门内容视图的入口。

第六步，在 Department Detail Drawer 或 Projects 部门详情中增加“任务产出”tab。

这个 tab 按 taskKey 分组，展示每个任务的最新产出、历史产出和 Markdown 阅读入口。

第七步，再补 DepartmentOutput Registry。

当 KnowledgeAsset 被证明不足以表达产出物状态、阅读状态、任务归属和文件树关系时，再新增专用表和 API。

## 10. 风险与约束

### 10.1 不要把所有 Markdown 都当产出物

部门里会有规则、记忆、草稿、模板、日志和原始数据。全部展示会降低阅读质量。

必须通过登记或 reading root 过滤。

### 10.2 不要让 `.department/memory` 变成报告库

memory 是执行记忆，output 是业务产出。两者可以互相引用，但不能混用。

### 10.3 不要跳过 Project / Routine

任务层应尽量复用现有 Project 和 Scheduler/Routine，否则会出现部门里一套任务、项目里一套任务的割裂。

### 10.4 不要过早强制新目录结构

不同部门 workspace 差异很大。代码仓库、知识库、自动化任务仓库不应被同一套可见根目录强行改造。

更稳的做法是先支持 `.department/outputs/`，再允许配置 reading roots。

## 11. 评审问题

评审时建议先确认下面几个问题：

1. Projects 的部门视图是否作为完整阅读主入口，而不是 CEO 首页？
2. 部门内容视图是否必须同时包含文件目录树和产出物重组目录树？
3. CEO Office 是否只展示轻量摘要、异常提醒和跳转入口？
4. 任务第一层是否优先复用 Project/Routine，而不是新增独立任务系统？
5. Linux Do AI 情报任务是否作为第一个试点？
6. 第一阶段是否接受复用 KnowledgeAsset 承载产出物索引？
7. 部门文件阅读是否只开放 reading roots，而不是全盘文件浏览？
8. `.department/outputs/` 是否可作为代码仓库型部门的默认输出位置？
9. Obsidian 友好目录是否作为可选配置，而不是全局强制目录？
