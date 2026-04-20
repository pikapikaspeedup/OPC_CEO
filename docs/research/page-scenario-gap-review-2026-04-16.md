# 页面缺失场景复审（2026-04-16）

## 范围

本轮只审查当前 Header 五个一级入口及其挂载页面：

- `CEO Office`
- `OPC`
- `对话`
- `知识`
- `Ops`
- 以及 `Settings` 作为右上角工具区页面

方法：

1. 对照 `src/app/page.tsx` 的真实挂载关系
2. 逐页检查“入口存在但行为不闭环”的场景
3. 只记录当前仍存在的缺口，不重复已修复项

---

## Findings

### 1. Chat 页面缺少“拒绝审批”闭环

- 文件：`src/components/chat.tsx`
- 证据：阻塞型 `notify_user` 卡片里同时渲染了 `Proceed` 和 `Reject` 两个按钮，但 `Reject` 按钮没有 `onClick`
- 影响场景：
  - Agent 要求人工审核文件时，用户只能继续，不能明确拒绝
  - UI 呈现为“有拒绝能力”，实际没有任何行为，属于假闭环
- 风险：
  - 用户误以为已拒绝，但运行不会收到任何 rejection 信号
  - 阻塞审批类场景无法形成完整的人机分支

### 2. Knowledge 页面详情加载失败会落入假 loading

- 文件：`src/components/knowledge-panel.tsx`
- 证据：
  - `loadDetail()` 失败时只做 `setDetail(null)`
  - 渲染层 `if (detailLoading || !detail)` 统一显示 loading empty state
- 影响场景：
  - 知识条目被删除、接口 404、网络失败时，页面不会显示错误，也不会回到可操作空态
  - 用户会看到“加载中”样式长期停留，误判为前端仍在请求
- 风险：
  - 无法区分“真的在加载”和“已经失败”
  - 知识详情页出现不可恢复的假死体验

### 3. CEO Office 配置页保存失败会被当成成功

- 文件：`src/components/ceo-office-settings.tsx`
- 证据：
  - `handleSave()` 直接 `await fetch(...)`，但不检查 `res.ok`
  - 请求只要没抛网络异常，就会更新 `originalIdentity/originalPlaybook`
  - catch 分支没有任何错误提示
- 影响场景：
  - `/api/ceo/setup` 返回 4xx/5xx 时，按钮会恢复为“已保存”状态
  - 用户看到 diff 消失，以为 Persona/Playbook 已落盘
- 风险：
  - 配置丢失但前端显示成功
  - 这是管理面配置页中的“静默失败 + 伪成功”问题，风险高于普通 toast 缺失

### 4. Ops 左栏的 Assets 列表是可点击假入口

- 文件：`src/components/sidebar.tsx`
- 证据：Ops 左栏 `Assets` 区域里，skills/workflows/rules 三类 `RailItem` 的 `onClick` 全部是空函数
- 影响场景：
  - 用户从左栏看到“最近技能 / 工作流 / 规则”，视觉上可点击，但点下去无任何跳转、筛选或定位
  - 这与右侧主视图 `AssetsManager` 的存在形成预期错位
- 风险：
  - 典型的“信息入口存在但行为未接线”
  - 会让 Ops 左栏变成噪音，而不是上下文导航

### 5. Ops 资产编辑在详情读取失败时会打开空编辑器

- 文件：`src/components/assets-manager.tsx`
- 证据：
  - `handleEdit()` 如果 detail API 失败，catch 分支会直接 `setEditing({ ..., content: '' })`
  - 用户随后保存会把原有 workflow/skill/rule 覆盖为空内容
- 影响场景：
  - 详情接口临时失败、文件读取失败、后端异常时，用户仍可进入编辑态
  - 从 UI 上看像是“这个资产本来就没有内容”
- 风险：
  - 存在直接覆盖原内容的数据风险
  - 属于高风险缺口，不只是缺少错误提示

---

## 建议优先级

### P1

1. `chat.tsx` 审批卡片补全 reject 行为
2. `assets-manager.tsx` 编辑前读取失败时阻止进入编辑态
3. `ceo-office-settings.tsx` 保存逻辑按 `res.ok` 判断成功，并给出失败反馈

### P2

4. `knowledge-panel.tsx` 区分 loading / load failed / empty 三种状态
5. `sidebar.tsx` Ops Assets 左栏补导航行为，至少要能跳到主区并定位对应资产

---

## 备注

- 本轮是 review，不包含修复提交
- 相关结论已同步到 `docs/PROJECT_PROGRESS.md`
