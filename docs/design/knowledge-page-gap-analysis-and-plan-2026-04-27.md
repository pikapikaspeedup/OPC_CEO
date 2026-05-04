# Knowledge 页面与新设计稿差距及实施计划

日期：2026-04-27

## 1. 参考基线

- 用户提供的新设计稿：Knowledge 浏览优先工作台
- 现有参考文档：
  - `docs/design/apple-reference-pages-2026-04-23.md`
  - `docs/design/ux-shell-convergence-2026-04-23.md`
- 实际运行页面：
  - `http://127.0.0.1:3000/?section=knowledge`
  - `http://127.0.0.1:3000/?section=knowledge&knowledge=<id>`

## 2. 当前实现现状

### 2.1 页面壳层

当前 Knowledge 页已经接入统一壳层，但仍是旧业务组件直接挂载：

- `src/app/page.tsx`
  - `Knowledge` 页面头部只有标题、两个 badge、两张 metric 卡
  - 主体是 `KnowledgeWorkspace + DepartmentMemoryPanel`
- 这意味着壳层统一了，但页面内部信息架构没有按新稿重做

对应代码：

- `src/app/page.tsx:1387`
- `src/app/page.tsx:1405`
- `src/app/page.tsx:1409`

### 2.2 主工作面

`KnowledgeWorkspace` 当前仍是两套旧模式：

1. 未选中知识时：
   - 空态大卡
   - `Recent Additions / High Reuse / Stale / Proposal Signals`
   - `候选记忆` 审核板
   - `增长提案` 审核板
2. 选中知识时：
   - 左栏是 metadata + artifact 列表 + references + linked growth
   - 中间是 markdown preview / edit
   - 页面没有“目录栏 + 知识列表 + 正文 + 右侧上下文栏”的浏览型结构

对应代码：

- `src/components/knowledge-panel.tsx:401`
- `src/components/knowledge-panel.tsx:454`
- `src/components/knowledge-panel.tsx:497`
- `src/components/knowledge-panel.tsx:570`
- `src/components/knowledge-panel.tsx:675`

### 2.3 数据契约

当前前端拿到的知识数据过于扁平：

- `KnowledgeItem` 只有：
  - `title / summary / references / timestamps / artifactFiles / workspaceUri / category / status / usageCount / lastAccessedAt`
- `KnowledgeDetail` 只是在此基础上增加 `artifacts`

对应代码：

- `src/lib/types.ts:1567`
- `src/lib/types.ts:1581`

API 现状：

- 列表接口只支持 `workspace / category / limit`
- 详情接口只返回镜像 metadata 和 artifact 文本
- 不提供：
  - tags
  - source detail
  - evidence
  - promotion
  - related projects
  - version history
  - review queue summary

对应代码：

- `src/app/api/knowledge/route.ts:41`
- `src/app/api/knowledge/route.ts:90`
- `src/app/api/knowledge/[id]/route.ts:45`
- `src/app/api/knowledge/[id]/route.ts:62`

### 2.4 隐含数据没有被页面利用

底层 `KnowledgeAsset` 其实已经有更丰富的结构：

- `source`
- `confidence`
- `tags`
- `evidence`
- `promotion`

但这些字段没有进当前 FE 契约，而且 mirror metadata 写盘时也被压缩掉了。

对应代码：

- `src/lib/knowledge/contracts.ts:23`
- `src/lib/knowledge/contracts.ts:30`
- `src/lib/knowledge/contracts.ts:35`
- `src/lib/knowledge/contracts.ts:38`
- `src/lib/knowledge/store.ts:87`
- `src/lib/knowledge/store.ts:150`

结论：现在不是“完全没数据”，而是“页面和接口把结构化语义丢掉了”。

## 3. 与新设计稿的核心差距

### 3.1 页面定位错位

新稿是“浏览与引用优先”的知识工作台。

当前实现更像“知识治理与审核后台”：

- 首屏重点放在 memory candidates / growth proposals
- 选中态重点放在 artifact 编辑器
- 对阅读、筛选、引用、关联的支撑弱

这是最大的方向性偏差。

### 3.2 顶部结构不对

新稿顶部需要：

- `Knowledge / 知识库` 双语标题
- 中央搜索框
- 语音指令/通知/主操作按钮
- 四张业务 KPI

当前只有：

- 单标题
- 状态 badge
- 两张通用 metric
- 没有搜索主入口

### 3.3 主体布局不对

新稿主体是四块并列工作面：

1. 知识目录
2. 知识列表
3. 正文详情
4. 右侧上下文栏

当前主体是：

1. `KnowledgeWorkspace`
2. `DepartmentMemoryPanel`

也就是说，设计稿里的“目录”和“列表”两层浏览路径都还没有实现。

### 3.4 右侧情报栏能力缺失

新稿右侧包含：

- 来源引用
- 关联项目
- 部门记忆
- 版本历史

当前只具备：

- references 原始列表
- linked growth
- department memory 独立面板

缺失项里，`关联项目` 和 `版本历史` 目前没有完整 FE 契约。

### 3.5 视觉密度和交互重心不对

新稿强调：

- 低层级边框
- 业务卡片密排
- 默认选中文档
- 阅读区首屏可见正文

当前默认是空态和治理卡片，阅读路径要多一步进入，且首屏正文不可达。

## 4. 实施原则

1. 保留 `WorkspaceConceptShell`，不重做一级导航壳。
2. 保留现有知识编辑、删除、artifact 编辑能力。
3. 不删除 `候选记忆 / 增长提案 / DepartmentMemoryPanel`，但它们不应继续占据默认首屏主路径。
4. 先把 Knowledge 收口成“浏览优先”，再把治理能力下沉到二级区域。

## 5. 实施计划

### Phase 1：先把页面结构改对

目标：不等新后端字段，也先做出 70% 的设计稿结构。

改动：

- `src/app/page.tsx`
  - 把当前 Knowledge 头部改成：
    - `Knowledge / 知识库`
    - 搜索框
    - 顶部工具动作
    - 四张 KPI
- `src/components/knowledge-panel.tsx`
  - 从“overview/detail 二选一”改成“浏览型常驻三栏/四栏”
  - 默认自动选中最近一条知识
  - 主区拆成：
    - `目录栏`
    - `知识列表`
    - `正文区`
    - `上下文右栏`

这一步允许先用现有字段做占位：

- 目录：按 `category / workspace / status` 组织
- 列表：按最近访问/最近创建排序
- 右栏：先展示 references、workspace、timestamps、usage

### Phase 2：把治理工作面下沉

目标：把当前首屏噪音从主阅读链路移开。

改动：

- `候选记忆`
- `增长提案`
- `DepartmentMemoryPanel`

迁移方案：

- 进入 `治理` 二级 tab，或页面底部 secondary workbench
- 默认首屏不再直接占据知识浏览主区

原则：

- 治理能力保留
- 但默认用户路径必须是“找知识 -> 看知识 -> 引用知识”

### Phase 3：补齐数据契约

目标：让右侧情报栏能真正接近设计稿。

需要扩展：

- `src/lib/types.ts`
  - 扩展 `KnowledgeItem / KnowledgeDetail`
- `src/lib/api.ts`
  - 扩展 list/detail query 和返回结构
- `src/app/api/knowledge/route.ts`
  - 增加 `q / status / scope / tag / sort`
- `src/app/api/knowledge/[id]/route.ts`
  - 增加 richer detail payload

建议新增字段：

- `tags: string[]`
- `sourceSummary`
- `sourceRefs`
- `relatedProjects`
- `relatedDepartments`
- `reviewState`
- `versionHistory`
- `ownerLabel`
- `updatedBy`

其中：

- `source / tags / evidence / promotion` 可优先从 `KnowledgeAsset` 现有结构透出
- `relatedProjects` 可先由 `run_id` / `workspaceUri` 派生
- `versionHistory` 若暂时没有真实版本流，先提供最近修改记录占位，再决定是否补真正 revision log

### Phase 4：把右侧栏做成真实业务上下文

目标：不再只是原始 reference dump。

右侧栏建议固定四块：

1. `来源引用`
2. `关联项目`
3. `部门记忆`
4. `版本历史`

替换关系：

- 现有 `references` 区块升级成可读 source cards
- `linked growth` 从默认右栏挪到治理区
- `DepartmentMemoryPanel` 从独立整块改为 Knowledge 上下文的一个 section

### Phase 5：视觉与验收收口

目标：把结构做出来以后，才做密度和交互收口。

验收标准：

1. `?section=knowledge` 默认首屏可见：
   - 顶部搜索
   - 四张 KPI
   - 目录栏
   - 知识列表
   - 已选中文档正文
   - 右侧上下文栏
2. 知识列表与目录筛选联动。
3. 正文区仍支持 artifact preview/edit/save。
4. 删除、metadata 保存不回归。
5. `治理` 能进入 memory candidate / growth proposal。
6. desktop 和 mobile 都无布局重叠。

## 6. 建议文件切分

为了避免 `src/components/knowledge-panel.tsx` 继续膨胀，建议本轮顺手拆分：

- `src/components/knowledge/knowledge-shell.tsx`
- `src/components/knowledge/knowledge-directory-rail.tsx`
- `src/components/knowledge/knowledge-list-pane.tsx`
- `src/components/knowledge/knowledge-detail-pane.tsx`
- `src/components/knowledge/knowledge-context-rail.tsx`
- `src/components/knowledge/knowledge-governance-pane.tsx`

`knowledge-panel.tsx` 保留为 orchestrator，不再承载全部渲染细节。

## 7. 开工顺序建议

建议按下面顺序做，风险最低：

1. 先重排 `Knowledge` 页面头部和主体布局
2. 再下沉治理板块
3. 再扩 list/detail API 契约
4. 最后补右栏高级语义和视觉收口

这样做的好处是：

- 第一轮就能快速接近设计稿
- 不会一开始就被版本历史/关联项目这类数据依赖卡住
- 风险集中在可控的前端重构，不会过早扩散到整个 company kernel

## 8. 当前判断

Knowledge 页当前状态可以定义为：

- 壳层已统一
- 页面内部 IA 未对齐
- 数据契约不足以完整支撑新稿
- 但底层知识模型已经有一部分 richer semantics，可以复用，不需要从零造

所以下一步不是“微调样式”，而是一次明确的 Knowledge browse-first 重构。

## 9. 第二轮视觉收口（已落地）

在 browse-first 重构完成后，页面结构已经对齐，但和设计稿仍有一段明显差距，主要集中在视觉密度和信息编排。

本轮已经收口的点：

1. KPI 卡改成 `图标 + 数值 + 业务说明` 的紧凑结构，不再使用通用渐变卡。
2. 目录栏增加本地搜索与重置入口，目录项从通用列表改成更接近设计稿的企业工作台密排样式。
3. 知识列表头部增加 `(count) + 最近更新`，列表项改为 `标题 / 元信息 / 摘要 / 标签` 的扫描型结构。
4. 正文区头部补齐：
   - 元数据 pills
   - 收藏 / 更多 / 编辑 / 删除动作
   - `结构化摘要 / 核心要点 / 正文内容` 三段式阅读路径
5. 右侧上下文栏改成四块 compact rail：
   - 来源引用
   - 关联项目
   - 部门记忆
   - 版本历史
6. `关联增长` 从默认右栏移除，避免再次把首页重心拉回治理视角。

本轮之后的判断：

- Information architecture 已经基本贴近设计稿
- 视觉密度、边框层级、阅读优先级也已经收口到可验收状态
- 后续如果继续做，只需要针对真实业务数据语义继续增强，不需要再重做首页骨架
