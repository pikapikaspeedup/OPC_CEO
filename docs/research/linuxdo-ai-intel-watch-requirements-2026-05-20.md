# Linux Do AI 情报监测能力需求与机制研究

日期：2026-05-20

## 本轮边界

本轮只做需求细化、责任边界评估、现有系统机制盘点和通用化设计。

本轮不实现抓取代码，不创建 scheduler job，不修改 AI 情报工作室配置，不修改 `src/server/workers/**`、`src/lib/agents/scheduler.ts`、`src/app/page.tsx` 或任何运行时主链路。

## 责任边界评估

这个意图本身不违反责任边界，前提是目标被限定为：

- 公开来源的 OSINT 监测。
- 识别 AI 产品被异常使用、薅额度、绕过付费、代理转卖、灰产滥用等风险信号。
- 为 AI 公司做负责任披露或风险通报。
- 输出面向阅读、分级、溯源和防御处置的情报。

必须明确禁止的边界：

- 不帮助注册、批量创建账号、绕过风控、复现套利步骤或验证“能不能薅到”。
- 不输出可直接执行的滥用教程、脚本、prompt、接口、代理地址、邀请码、密钥、账号池、支付绕过路径。
- 不优化攻击成功率，不提供“怎么更快获得更多 AI 额度”的操作建议。
- 不把原帖全文或敏感步骤搬运到公开文档；只保留必要的引用链接、风险摘要和防御线索。
- 对外报告前必须做人审，报告内容应按最小必要原则描述影响、证据链接、复现条件的高层级轮廓和建议修复方向。

结论：可以建设，但系统默认产物必须是“安全情报与负责任披露材料”，不是“AI 资源套利攻略集合”。

## 当前机制事实

bb-browser 环境已经可用，`bb-browser site list` 中已有 Linux Do 适配器：

- `linuxdo/latest`：读取 `https://linux.do/latest.json`。
- `linuxdo/hot`：读取 `https://linux.do/top.json?period=...`，失败时回退 latest。
- `linuxdo/topic`：读取 `https://linux.do/t/{id}.json` 或 topic fallback。

Linux Do 当前表现为 Discourse 站点。公开 JSON 中可用于本需求的关键字段包括：

- topic：`id`、`title`、`url`、`created_at`、`bumped_at`、`last_posted_at`、`category_id`、`tags`、`views`、`like_count`、`posters`。
- user：`id`、`username`、`trust_level`、`flair_name`。
- topic detail：首帖 `post_stream.posts[0].trust_level` 可直接用于判断发帖人 LV1-LV3。

现有 AI 情报工作室目录为 `/Users/darrel/Documents/baogaoai`，`.department/config.json` 已声明：

- 部门名：`AI情报工作室`。
- provider：`native-codex`。
- 已有能力：`/ai_digest` 与 `/ai_bigevent`。

当前调度系统已经支持每 2 小时任务：

- `ScheduledJob.type = "interval"`。
- `intervalMs = 7200000`。
- `action.kind = "dispatch-execution-profile"` 且 `executionProfile.kind = "workflow-run"` 更适合接 canonical workflow runtime hooks。
- MCP 当前未暴露 `dispatch-execution-profile` 创建参数；创建这类任务时优先走 REST/GUI。
- 现有 Native Codex patrol 样本只是普通 `dispatch-prompt` interval job，不是可复用的采集 runtime profile。

当前知识库机制已经支持沉淀：

- `POST /api/knowledge` 可创建部门知识。
- `src/lib/knowledge/store.ts` 会将知识 mirror 到 `~/.gemini/antigravity/knowledge/<id>/artifacts/content.md`。
- Knowledge UI 可按 workspace、category、tag、status、query 检索。
- `knowledge`、`workspace/.department/memory`、Obsidian vault 目前是三条并行 sink；现有 `department-memory-bridge` 偏向执行前读取，不负责把新知识反向写入 vault。

Obsidian 相关现状：

- 仓库里有 Obsidian 插件文档和插件源码，当前插件主要用于在 Obsidian 里和 Gateway 对话。
- `/Users/darrel/Documents/baogaoai` 还没有发现 `.obsidian` 目录，但它可以作为普通 Markdown vault 打开。
- baogaoai 项目已有“知识花园”概念，模型强调“知识卡片而不是文章摘要”，这适合复用为情报知识卡片抽取原则。
- 仓库中未发现 Gateway 级“写 Obsidian vault / 双向同步”的稳定 API；如果要落 Obsidian，第一版应由 workflow script 写 Markdown 文件，而不是假设插件会自动同步。

## 目标用户故事

### 来源监测

- [支持] 作为 AI 情报负责人，我可以用现有 `linuxdo/latest`、`linuxdo/hot`、`linuxdo/topic` 获取 Linux Do 最新帖、热门帖和帖内正文。
- [支持] 作为 AI 情报负责人，我可以从 Discourse 字段里判断发帖人或首帖作者的 trust level，并筛出 LV1-LV3。
- [不支持] 作为 AI 情报负责人，我还不能直接运行一个“Linux Do AI 风险监测”专用命令，自动完成时间窗口、LV 过滤、关键词初筛、去重和详情补全。

### 风险识别

- [不支持] 作为 AI 情报负责人，我还不能让系统自动把帖子归类为免费注册/额度滥用、异常渠道、攻略复用、代理转售、疑似泄露、普通资讯或无关内容。
- [不支持] 作为 AI 情报负责人，我还不能让系统在摘要中自动移除可执行滥用步骤，只保留风险模式、影响对象、置信度和来源链接。
- [不支持] 作为 AI 情报负责人，我还不能基于供应商名称、模型名、产品名自动聚合多条相关线索。

### 阅读与沉淀

- [支持] 作为 AI 情报负责人，我可以把结果沉淀为 Knowledge Asset 并在现有 Knowledge 页面检索。
- [不支持] 作为 AI 情报负责人，我还不能以 Obsidian vault 的方式阅读每 2 小时的监测结果、按供应商/风险类型双链组织、维护人工批注。
- [不支持] 作为 AI 情报负责人，我还不能在同一个阅读面里同时看到“本轮新增”“连续出现”“需要报告”“已报告/忽略”。

### 报告流转

- [不支持] 作为 AI 情报负责人，我还不能从一组线索自动生成 AI 公司可接收的负责任披露草稿。
- [不支持] 作为 AI 情报负责人，我还不能维护报告状态、联系人、发送时间、回执和后续跟进记录。

## 推荐能力形态

不要把这个能力做成单纯的“论坛爬虫”。推荐抽象为通用的 `Intel Watch` 能力，Linux Do 只是第一个 source provider。

第一层是来源适配：

- 继续复用 bb-browser Site Adapter 做取数，因为 Linux Do 的数据抓取本质是“给参数，拿 JSON”。
- 新增或扩展一个 `linuxdo/ai-watch` adapter，返回归一化后的 topic 列表，而不是只返回原始 latest。
- 参数建议包括 `hours`、`levels`、`limit`、`includeHot`、`keywords`、`tags`、`categoryIds`。
- Linux Do `/new.json` 默认会混入“旧帖新回复”；应使用 `new.json?ascending=false&order=created`，并以 `created_at` 作为默认时间窗口依据。只有明确做“热帖/回复追踪”时，才按 `last_posted_at` 或 `bumped_at` 计算。

第二层是确定性预处理：

- 在 workflow script 中调用 `bb-browser site linuxdo/latest`、`linuxdo/hot`、`linuxdo/topic`。
- 维护 seen state，按 topic id、url、title hash 去重。
- 只对命中关键词、tag、category 或异常热度阈值的帖子补拉正文。
- 对正文做脱敏预处理，删掉疑似密钥、邀请码、代理地址、具体 prompt、命令片段和代码块。

第三层是 AI Native 情报判断：

- 让 Native Codex 读取预处理上下文。
- 输出结构化 JSON 和可读 Markdown。
- 核心任务是判断风险模式、影响对象、置信度、是否值得报告、需要人工复核点。
- 明确禁止生成或补全滥用步骤。
- 如果希望 preflight/finalize 自动运行，必须新增 `runtimeProfile` 并修改 `src/lib/agents/workflow-runtime-hooks.ts` 的 profile 白名单与 prepare/finalize 分支；只写 workflow frontmatter 不会自动触发脚本。

第四层是沉淀与阅读：

- 写入 AI 情报工作室 Obsidian vault。
- 同步创建 Knowledge Asset，tags 至少包含 `linuxdo`、`ai-abuse-watch`、风险类型、供应商或模型名。
- 对“可报告”线索生成单独的报告草稿，但默认不自动发送。

canonical sink 建议：

- 结构化主存：`KnowledgeAsset`。
- 人类阅读镜像：Obsidian Markdown。
- 运行时状态：source provider 自己的 `seen-state.json`、`topics.jsonl`。
- 不建议把 `.department/memory` 作为主写入点；它更适合保存部门长期规则、经验和执行记忆，不适合承载每 2 小时一批的外部情报流。

## Obsidian Vault 协议

建议把 `/Users/darrel/Documents/baogaoai` 本身升级为 AI 情报部门 vault，或者在其下新增 `Intel Vault/` 作为 Obsidian 可打开目录。

推荐目录：

```text
Intel Vault/
  Inbox/
    LinuxDo/
      2026/
        05/
          2026-05-20-22.md
  Signals/
    Free-Tier-Abuse/
    Abnormal-Access/
    AI-Playbooks/
    Vendor-Risk/
  Vendors/
    OpenAI/
    Anthropic/
    Google/
    xAI/
    Other/
  Reports/
    Drafts/
    Submitted/
    Closed/
  Sources/
    LinuxDo/
      topics.jsonl
      seen-state.json
  Restricted Raw/
```

每轮监测 Markdown 建议使用 frontmatter：

```yaml
---
type: intel-watch
source: linuxdo
window_start: 2026-05-20T18:00:00+08:00
window_end: 2026-05-20T20:00:00+08:00
levels: [1, 2, 3]
status: needs-review
redaction: safe-summary
---
```

正文只保留：

- 一屏可读的执行摘要：本轮新话题数、有效线索数、值得 CEO 看的一句话结论。
- 可分享线索卡：标题、来源、LV、风险标签、涉及厂商/模型、压缩后的可安全转述细节、原帖链接。
- 受限细节标记：只说明命中了域名/凭据/命令/账号/绕过等受限类型，不展开具体路径。
- 内部核验维度：注册/支付/额度/API 中转/账号转售/身份认证/模型访问等。
- 归档与状态：`new`、`reviewed`、`reportable`、`ignored`、`reported`。

`Restricted Raw/` 只在确有需要时保存最小化原始摘录，并默认不进入 Knowledge Asset、不进入日报、不对外发布。

## CEO 阅读面建议

当前平台已经有三个相关入口：

- CEO Office 首页：已有“最新部门日报”和“今日关注”，适合放一张“最新情报产出”卡。
- Knowledge 页面：已有知识列表、搜索、artifact 预览/编辑，适合做详情页和长期归档。
- Project/Run deliverables：适合工程交付追踪，不适合 CEO 每两小时看情报摘要。

推荐产品路径：

1. 每两小时生成一份 `Intel Brief`，不是每条帖子生成一个 CEO 卡片。
2. `Intel Brief` 同时写入 Obsidian Markdown 与 Knowledge Asset，Knowledge tags 包含 `ai-intel`、`linuxdo`、`ai-abuse-watch`、风险类型。
3. CEO Office 新增“最新情报产出”模块，只显示最近 3-5 份 Brief：标题、时间窗口、有效线索数、最高风险标签、前三条可分享线索。
4. 点击 Brief 进入 Knowledge artifact 详情；需要看任务过程时再去 Ops/Run，而不是默认展示过程。
5. 如果产出物很多，CEO Office 只展示“今日聚合”：按 `reportable/review/watch/ignored` 计数，列出 Top 3；其余进入 Knowledge 的筛选列表。

这能满足“CEO 只看产出物，不关注任务过程”的使用方式：运行记录仍在 scheduler/run 体系里，阅读入口只承载结果。

## 通用化设计

通用 source provider 应输出统一结构：

```json
{
  "source": "linuxdo",
  "sourceItemId": "topic:123",
  "url": "https://linux.do/t/topic/123",
  "title": "redacted or original title",
  "authorLevel": 3,
  "createdAt": "2026-05-20T13:00:00Z",
  "updatedAt": "2026-05-20T15:00:00Z",
  "tags": ["人工智能"],
  "signals": ["free-tier", "abnormal-access"],
  "excerpt": "safe excerpt",
  "contentHash": "sha256:...",
  "rawRef": "optional local restricted path"
}
```

这样未来可以接入其他来源：

- 论坛型来源：Linux Do、V2EX、Reddit、Hacker News。
- 社媒型来源：X、微博、即刻。
- 搜索型来源：Google/Bing 关键词巡检。
- 专业来源：漏洞公告、厂商社区、GitHub issue。

通用 pipeline 不应该关心来源页面怎么抓，只关心 normalized item、risk classifier、report writer、vault writer。

## 安全分级建议

建议把线索分为五类：

- `info`：普通资讯或无行动价值。
- `watch`：出现可疑关键词或低置信度线索，需要继续观察。
- `review`：可能影响具体 AI 产品，需要人工读原帖。
- `reportable`：具备明确影响对象、重复出现或有足够证据，可生成披露草稿。
- `restricted`：含敏感步骤、密钥、代码或具体绕过路径，只存本地受限引用，不进入普通阅读稿。

所有对外产物默认最高只能到 `reportable` 的安全摘要，不直接包含 `restricted` 内容。

## 最小实现建议

第一步做最小闭环：

- 新增 `linuxdo/ai-watch` bb-browser site adapter 或 standalone wrapper，输出 LV1-LV3 的候选 topic。
- 新增 `linuxdo_ai_watch` workflow 和 runtime scripts。
- 在 `workflow-runtime-hooks.ts` 中新增 `linuxdo-ai-watch` runtime profile 的 prepare/finalize 分支。
- 新增 AI 情报工作室 skill 声明，例如 `baogaoai-linuxdo-ai-intel-watch`。
- 创建一个 interval scheduler job，每 2 小时以 `dispatch-execution-profile.workflow-run` 运行 `/linuxdo_ai_watch`，workspace 指向 `/Users/darrel/Documents/baogaoai`。
- 输出 Markdown 到 `Intel Vault/Inbox/LinuxDo/YYYY/MM/`。
- 通过 `POST /api/knowledge` 写入一条部门知识，便于现有 Knowledge 页面检索。

第二步做可读性：

- 在 Markdown 中增加“本轮新增 / 重复出现 / 值得报告 / 忽略”四段。
- 生成供应商索引页和风险类型索引页。
- 把 Obsidian wikilink 建出来，例如 `[[Vendors/OpenAI]]`、`[[Signals/Free-Tier-Abuse]]`。

第三步做报告闭环：

- 对 `reportable` 线索生成报告草稿。
- 增加人工审批状态。
- 记录已提交、回执、关闭状态。

## 验证策略

研究阶段已验证：

- `bb-browser` 已安装。
- `linuxdo/latest` adapter 可返回 latest topics。
- Linux Do JSON 中可获得 `trust_level`，topic detail 首帖也包含 `trust_level`。
- `https://linux.do/new` 登录态已验证，`session/current.json` 返回当前用户且 `/new.json` 可带 Cookie 读取。
- 已新增本地私有 adapter：`~/.bb-browser/sites/linuxdo/ai-watch.js`。
- `linuxdo/ai-watch` 已实测可按 LV1-LV3、时间窗口、来源模式输出候选，并只返回标题级安全摘要、风险标签、匹配词、来源链接与受限细节标记。
- `linuxdo/ai-watch` 已修正为默认按新话题创建时间筛选，避免旧帖因新回复进入“新帖子”结果。
- `linuxdo/ai-watch` 已新增 `brief` 输出，包含可分享 `share_text`；含受限路径的帖子只输出高层风险摘要和核验维度，不输出具体操作步骤。

未来实现完成后应验证：

- `bb-browser site linuxdo/ai-watch --json` 返回结构化候选，不包含原始敏感步骤。
- 单元测试覆盖 LV 过滤、关键词评分、去重、redaction、Markdown writer。
- scheduler dry-run 或手动 trigger 能生成一份 Markdown 和一条 Knowledge Asset。
- 对含敏感内容的 fixture，输出只能给风险摘要和来源链接，不能泄露具体执行路径。
- 优先先跑 `src/lib/agents/workflow-runtime-hooks.test.ts` 和 scheduler workflow-run 相关单测；live smoke 建议创建 `enabled=false` job 后手动触发，避免 scheduler worker 启动副作用污染验证。

本地 adapter 验证命令：

```bash
bb-browser site linuxdo/ai-watch 20 --hours 2 --levels 1,2,3 --source new --json
bb-browser site linuxdo/ai-watch 10 --hours 168 --levels 1,2,3 --source latest --minScore 1 --json
```
