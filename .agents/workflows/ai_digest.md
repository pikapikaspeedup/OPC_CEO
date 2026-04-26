---
description: AI 行业日报生成器（V6 自由创作版）。Agent 作为编辑，聚焦几个核心主题讲清楚，视觉设计自由发挥，鼓励信息可视化增强。
trigger: always_on
runtimeProfile: daily-digest
runtimeScriptsDir: ai_digest
---

# AI 每日精选日报生成器 (V6 自由创作版)
## 核心理念
这是一份给**人看的日报**，不是信息汇总。读者读完后的感受应该是"我理解了今天 AI 领域发生了什么"，而不是"我知道了一堆事"。
你的角色是**主编**。聚焦几个事情，讲清楚。
## 创作原则
1. **编辑判断力**：
    * 先分层——哪些值得深度展开，哪些一句话带过。
    * 宁可 3 件事讲透，也不要 10 件事各蹭一下。
2. **自然流畅的写作**：
    * **像人说话**：避免"AI行业在N条主线上同步演进"这种空洞的概括句。
    * **禁止口号式标题**：标题中必须包含具体信息（数字、名称、动词）。
    * **每段话都有存在的理由**：删掉后文章完整性不受影响的段落，就不该存在。
3. **深度优于广度**：
    * 深度部分要有**交叉分析**——不同文章间的关联、对行业的具体影响、数据背后的含义。
    * 必须从文章中提取具体参数、技术细节、人名机构名，拒绝笼统叙述。
## 内容结构（固定）
日报由两个板块组成，顺序固定：
### 1. 深度解读
从当天文章中选出 2-3 个最有认知增量的主题，做深度展开。
选题原则：
- 优先选有**硬数据支撑**的（财报数字、基准测试、成本数据）
- 优先选**多篇文章可交叉印证**的主题
- 技术突破和行业事件并重
每个深度解读需要回答：
1. **发生了什么**（事实，1-2 句）
2. **为什么重要**（背景和意义，这才是主体）
3. **具体细节**（数字、技术参数、人名——区分于泛泛而谈的关键）
### 2. 快讯
覆盖未被深度展开的其余文章。每条 1-2 句，说清它是什么 + 原文链接。不需要分析，高密度信息扫描。
## 视觉设计：自由发挥 + 信息可视化增强
**不预设任何 CSS 类名、配色方案、HTML 组件或布局模板。** 每期的视觉风格由 AI 自主决定。
鼓励在**不影响主体阅读**的前提下，增加信息可视化元素，例如：
- 纯 CSS 数据对比（柱状图、进度条、环形图等）
- 关键数字的突出展示（大字号、色块高亮、数据卡片）
- 时间轴展示事件脉络
- 对比矩阵或参数表格
- 趋势指示器（箭头、涨跌色标）
- 关系图谱或流程示意（纯 CSS 实现）
**原则**：可视化是为了帮助读者更快理解信息，不是装饰。每个可视化元素都应该传递文字难以高效传递的信息。
## 硬性约束
- **纯 HTML + CSS**，禁止 JavaScript
- **自包含**：`<style>` 内联，不依赖外部资源（字体、图片、CDN 等）
- **响应式**：在 375px（移动端）和 780px（桌面端）都可读
- **超链接溯源**：每个被引用的文章必须以超链接形式关联到原文
- **专业美观**：对得起"AI 每日精选"这个品牌
- **标题有料**：必须至少包含一个具体数字或专有名词
- **摘要有密度**：summary 字段 150-300 字，让人想点进来读的钩子，不是目录
## 动态规模约束
文字字数仅计算渲染后的纯文字分析内容（不含 `<style>` 和 HTML 标签）：
| 输入文章数 | 总字数范围 |
|-----------|-----------|
| 5-10 篇 | 800-1200 字 |
| 11-30 篇 | 1500-2500 字 |
| 31-50 篇 | 2500-4000 字 |
## 执行日志
在每个 Step 开始和结束时，向日志文件追加记录：
- 日志文件：`/tmp/baogaoai-skill-digest.log`
- 格式：`[ISO时间戳] [STEP_N] [START|OK|FAIL|SKIP] 简短描述`
- 每次执行开始时先写入分隔符：
    ```bash
    echo "" >> /tmp/baogaoai-skill-digest.log
    echo "=== NEW RUN $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" >> /tmp/baogaoai-skill-digest.log
    ```
## 标准执行流程
### Step 1：智能上下文拉取
日报覆盖时间窗口：**前一天 20:00（北京时间）→ 当天 20:00（北京时间）**，触发时间为每天北京时间 20:00（UTC 12:00）。
```bash
python3 ~/.gemini/antigravity/gateway/assets/workflow-scripts/ai_digest/fetch_context.py \
  --date $(TZ=Asia/Shanghai date +%Y-%m-%d) \
  --limit 50 --max-pages 2 \
  --window-start-hour 20 --window-end-hour 20 \
  --out /tmp/baogaoai-digest-context.json --insecure

执行后检查输出文件：
status 为 skip + digest_already_exists -> 日报已存在，终止流程
status 为 skip + insufficient_articles -> 文章不足，终止流程
status 为 ok -> 记录 recentDigests，继续下一步
recentDigests 包含过去 7 天已发布日报的 title、summary 和 deepDiveTopics。用于去重。
Step 2：创作
读取 /tmp/baogaoai-digest-context.json，执行以下过程：
去重检查：通读 recentDigests 中过去 7 天每篇日报的完整内容（title、summary、contentHtml、deepDiveTopics），凡是已深度展开过的话题、人物、事件，一律不得以相同角度再次展开。判断标准是“读者已经从上周日报里读到过这件事”——标题里提过、正文里分析过，都算。
通读所有文章，选出 2-3 个最有认知增量的主题
确定视觉主题——根据内容调性选择配色、布局和可视化方式
创作深度解读 + 快讯，融入合适的信息可视化元素
如果某主题已在近 7 天深度展开过，要么跳过，要么以进展追踪角度聚焦增量（标题注明“最新进展”，开头交代前情）
将输出保存为 /tmp/baogaoai-digest-output.json：
{
  "title": "具体、有信息量的中文标题（含数字或专有名词）",
  "summary": "150-300字的钩子",
  "contentHtml": "<style>...</style><div>...完整 HTML...</div>",
  "sourceArticleIds": [文章 ID 列表]
}
Step 3：全量上报
python3 ~/.gemini/antigravity/gateway/assets/workflow-scripts/ai_digest/report_digest.py \
  --input /tmp/baogaoai-digest-output.json \
  --context /tmp/baogaoai-digest-context.json \
  --insecure
护栏规则
禁止跨日重复深度分析：近 7 天日报的 title、summary、contentHtml 中出现过的话题、人物、事件，不得以相同角度再次深度展开。仅凭 deepDiveTopics 判断不够，必须通读完整内容。
进展追踪要求：标题含“最新”或“进展”，开头交代前情，正文只聚焦增量。
禁止清单式摘要：summary 中禁止用分号连接 3 个以上不同事件。
禁止浅层复述：换措辞重述原文摘要 ≠ 深度分析。
超链接溯源：引用的文章必须有链接。
快讯精炼：每条不超过 2 句话。
---
以上是完整的 `SKILL.md` 内容。如需同时查看 `fetch_context.py` 或 `report_digest.py` 脚本内容，随时告知。
