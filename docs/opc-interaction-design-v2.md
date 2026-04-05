# OPC 交互设计说明书 v2.0

> Antigravity Mobility CLI — AI 公司运营控制台重构方案
> 日期: 2026-04-04

---

## 一、现状分析

### 1.1 当前信息架构

```
┌─ Header ──────────────────────────────────────────┐
│ Logo  │  Title  │              │ Logs │ Export     │
└───────────────────────────────────────────────────┘
┌─ Sidebar ─────────┬─ Main Content ────────────────┐
│ User Card          │                               │
│ ─────────────────  │  根据 section 切换:           │
│ Tabs:              │                               │
│   💬 Chats         │  conversations → Chat 对话    │
│   📁 Projects ←──  │  projects → OPC Dashboard     │
│   🤖 Agents       │  agents → Run Dispatch+Detail │
│   📚 Knowledge    │  knowledge → 知识库           │
│   ⚙️ Ops          │  operations → 分析仪表盘      │
│ ─────────────────  │                               │
│ Workspace Picker   │                               │
│ Conv/Run List      │                               │
└────────────────────┴───────────────────────────────┘
```

### 1.2 核心问题

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| P1 | **OPC 不是默认首页** | 🔴 致命 | CEO 进入应用看到的是空白 Chat 界面，而非公司运营全景。OPC 被降级为 "Projects" 标签的子内容 |
| P2 | **审批/Events/Runs 占满主视图** | 🔴 致命 | CEO Dashboard 中，审批队列和事件流占 30%+ 的纵向空间，推挤了真正的业务信息（部门、项目进度） | 
| P3 | **Agents 与 Projects 割裂** | 🟡 高 | CEO 视角下 "谁在运行什么任务" 与 "项目进度" 是一体的，但被拆到两个独立标签页 |
| P4 | **命令框位置不稳定** | 🟡 高 | 命令输入只在 CEO Dashboard 内可用，切到其他标签页就消失了。CEO 应该随时能下达指令 |
| P5 | **Operations 信息分散** | 🟢 中 | Token 配额、MCP 状态、隧道、Codex 分散在单独的 operations 标签页，与 CEO 的管理决策脱节 |
| P6 | **无全局状态感知** | 🟢 中 | Header 只有 Logo+标题+日志按钮，CEO 无法一眼看到"有多少审批待处理、多少任务在跑" |
| P7 | **5 个标签页过多** | 🟢 中 | 移动端/窄屏下 5 个标签页挤压空间，且 agents/operations 使用频率低 |

### 1.3 用户角色与使用频率

| 场景 | 频率 | 当前入口 | 应有优先级 |
|------|------|----------|-----------|
| 查看公司全景（部门状态、进度） | 每日 5-10 次 | Projects 标签 | **首页** |
| 下达 CEO 指令（创建任务、查询状态） | 每日 3-8 次 | Projects 标签内底部 | **全局可用** |
| 审批请求处理 | 每日 1-5 次 | Projects 标签内滚动找 | **通知触发** |
| 查看执行中任务 | 每日 2-6 次 | Projects 标签内滚动 / Agents 标签 | **随时可见** |
| 处理告警/异常 | 事件触发 | Projects 标签内滚动 | **通知触发** |
| 与 Agent 对话 | 偶尔 | Chats 标签 | 二级入口 |
| 查看报表/日报 | 每日 1 次 | Projects 标签底部 | 二级入口 |
| 知识库管理 | 低频 | Knowledge 标签 | 三级入口 |
| 运维查看（Token/MCP/隧道） | 低频 | Operations 标签 | 三级入口 |

---

## 二、设计原则

### 2.1 CEO 优先（Executive-First）

> CEO 打开应用的第一眼，应该看到公司的运营全景，而不是一个空白的聊天窗口。

- **入口 = 决策** — 最常用的操作放在最近的位置
- **通知不占主内容** — 审批、告警、运行状态通过指示器+侧滑展示，不在主视图堆叠
- **指令随时可达** — CEO 命令框始终在全局 Header，无需翻页

### 2.2 信息密度分层

| 层级 | 内容 | 交互方式 |
|------|------|----------|
| **L0 — 常驻可见** | 命令框、通知 badge、状态指示灯 | Header 固定区域 |
| **L1 — 首屏聚焦** | 部门网格、项目进度、近期交付 | 主内容区首页 |
| **L2 — 按需展开** | 审批详情、事件列表、Run 日志 | 侧滑抽屉 / 弹窗 |
| **L3 — 独立工作区** | Chat 对话、知识库编辑、运维仪表盘 | 左侧标签切换 |

### 2.3 减少标签、增加层次

将原来的 5 个平级标签减少为 3 个核心入口：

```
旧: Chats │ Projects │ Agents │ Knowledge │ Ops  (5个平级)
新: 🏢 OPC │ 💬 Chat │ 📚 更多                  (3个分层)
```

---

## 三、新版信息架构

### 3.1 全局布局

```
┌─ Global Header ───────────────────────────────────────────────┐
│ 🏢 Logo │ [  CEO 指令输入框...  🚀]  │ 🔔3 │ ⚡1 │ ▶2 │ ⚙  │
└───────────────────────────────────────────────────────────────┘
┌─ Nav Rail ─┬─ Main Content ───────────────────────────────────┐
│            │                                                  │
│  🏢 OPC   │  (默认) OPC 运营全景                             │
│  (首页)    │                                                  │
│            │  ┌─────────────────────────────────────────┐     │
│  💬 Chat  │  │ 部门网格 (3列) + 状态指示               │     │
│            │  ├─────────────────────────────────────────┤     │
│  📚 知识  │  │ 跨部门对比 │ 近期交付 │ Scheduler       │     │
│            │  ├─────────────────────────────────────────┤     │
│  ⚙️ 运维  │  │ 日/周/月报 │ 审计日志                    │     │
│            │  └─────────────────────────────────────────┘     │
│            │                                                  │
│  (折叠)    │  点击部门卡片 → 部门详情 Drawer               │
│            │  点击项目 → 项目工作台 (内嵌 DAG + Runs)       │
│            │                                                  │
└────────────┴──────────────────────────────────────────────────┘

侧滑抽屉 (从右侧弹出):
  🔔 审批抽屉 — 待审批列表，逐条 approve/reject
  ⚡ 事件抽屉 — 近期事件流 + 行动按钮
  ▶  运行抽屉 — Active Runs 列表 + 快速干预按钮
```

### 3.2 Header 设计

```
┌────────────────────────────────────────────────────────────────┐
│  🏢 Antigravity     [  说点什么...  📋 🚀]    🔔³ ⚡¹ ▶² ⚙  │
│                     ↑ CEO 命令框                   ↑ 通知区    │
└────────────────────────────────────────────────────────────────┘
```

#### 命令框 (Command Bar)

- **位置**: Header 中央，宽度占 40%-50%
- **功能**: CEO 自然语言指令输入
- **快捷键**: `Cmd+K` 聚焦
- **交互**:
  - 输入文字 → 按 Enter 或点击 🚀 发送指令
  - 点击 📋 → 展开模板快捷菜单（最多 5 个常用模板）
  - 指令结果以 toast 形式展示（成功/失败），不占用主内容
- **执行反馈**: 底部出现 3 秒淡入/淡出的 toast 通知

#### 通知指示器

| 指示器 | 含义 | Badge | 点击行为 |
|--------|------|-------|----------|
| 🔔 | 待审批请求 | 红色数字 | 展开审批侧滑抽屉 |
| ⚡ | 异常/告警事件 | 橙色数字 | 展开事件侧滑抽屉 |
| ▶ | 运行中任务 | 蓝色数字 | 展开 Active Runs 侧滑抽屉 |
| ⚙ | 设置/日志 | 无 | 打开系统面板 |

**Badge 规则**:
- 0 条 → 不显示 badge
- 1-9 条 → 显示具体数字
- 10+ → 显示 "9+"
- 有 critical 事件 → ⚡ 指示器加红色脉冲动画

### 3.3 侧滑抽屉（Notification Drawers）

从屏幕右侧滑出，宽度 400px，背景半透明模糊。同时只能打开一个。

#### 🔔 审批抽屉

```
┌─ 审批请求 ───────────────────────────── ✕ ─┐
│                                             │
│  ┌─ 请求 #1 ──────────────────────────────┐ │
│  │ 🏗️ 研发部 · data-pipeline              │ │
│  │ "请求使用 file_write 写入配置文件"       │ │
│  │ 上下文: stage 2/5 · 5 分钟前            │ │
│  │                                        │ │
│  │            [拒绝]  [✓ 批准]            │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ┌─ 请求 #2 ──────────────────────────────┐ │
│  │ ...                                    │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  [全部批准]                 x/y 条待处理    │
└─────────────────────────────────────────────┘
```

#### ⚡ 事件抽屉

```
┌─ 事件 ─────────────────────────────── ✕ ─┐
│                                           │
│  🔴 critical · 研发部运行超时              │
│      data-pipeline stage 3 连续失败 2 次    │
│      [查看] [重试]                 2m ago   │
│  ─────────────────────────                 │
│  🟡 warning · Token 消耗达 80%             │
│      research 部 24h 内消耗 120k tokens     │
│      [查看配额]                    15m ago  │
│  ─────────────────────────                 │
│  ⚪ info · 任务完成                         │
│      运营部 weekly-report 已交付            │
│                                    1h ago   │
└───────────────────────────────────────────┘
```

#### ▶ Active Runs 抽屉

```
┌─ Active Runs ──────────────────────── ✕ ─┐
│                                           │
│  ● data-pipeline (研发部)                  │
│    Stage 3/5 · Round 2/10 · 8m32s          │
│    claude-sonnet-4-20250514                        │
│    [跳过] [重试] [取消]                    │
│  ─────────────────────────                 │
│  ● weekly-analysis (运营部)                │
│    Stage 1/3 · Round 1/5 · 2m10s           │
│    [跳过] [重试] [取消]                    │
│  ─────────────────────────                 │
│                                           │
│  最近完成 (3):                             │
│  ✓ test-coverage   完成 · 15m ago         │
│  ✓ doc-gen         完成 · 1h ago          │
│  ✗ deploy-check    失败 · 2h ago          │
└───────────────────────────────────────────┘
```

### 3.4 左侧导航栏 (Nav Rail)

将原来的 5 个平级标签页改为 **图标导航条** (nav rail 模式)，减少侧边栏占用：

```
┌──────────┐
│          │
│  🏢     │  ← OPC (默认首页，高亮)
│          │
│  💬     │  ← Chat
│          │
│  📚     │  ← Knowledge
│          │
│  ⚙️     │  ← Operations
│          │
│          │
│  ───    │  ← 分隔线
│          │
│  👤     │  ← User/Settings
│          │
└──────────┘
```

- 每个标签只显示图标（悬停显示 tooltip）
- 当前选中项高亮（左侧边框 accent 色）
- 宽度 60px，节省主内容空间
- 不再有 Agents 独立标签 — Agent Runs 通过 Header ▶ 指示器和 OPC 内项目详情访问

### 3.5 OPC 主内容区 (默认首页)

**核心理念**: OPC 是 CEO 的"指挥中心"，首屏展示最重要的决策信息，不需要滚动就能获得运营全景。

#### 首屏布局 (Above the fold)

```
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  部门网格 (3-4 列)                                            │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  │
│  │ 🏗️ 研发部 │  │ 🔬 研究部 │  │ 📡 运营部 │  │ 👔 CEO    │  │
│  │ 3 active  │  │ 1 active  │  │ 2 active  │  │ 0 active  │  │
│  │ 2 done    │  │ 0 done    │  │ 1 done    │  │ 1 done    │  │
│  │ 🎯 OKR... │  │ 🎯 OKR... │  │ 🎯 OKR... │  │ 🎯 OKR... │  │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  │
│                                                               │
│  跨部门对比             │  近期交付                            │
│  ┌──────────────────────┤──────────────────────────────────┐  │
│  │ 部门  任务  完成率   │  ✓ test-coverage (研发) · 15m    │  │
│  │ 研发   6    67%     │  ✓ weekly-report (运营) · 1h     │  │
│  │ 研究   1    0%      │  ✓ doc-gen       (研发) · 2h     │  │
│  │ 运营   3    33%     │                                  │  │
│  └──────────────────────┴──────────────────────────────────┘  │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

#### 折叠区域 (Below the fold, 可折叠)

```
▸ Scheduler (3 active jobs)
▸ 日/周/月报
▸ 审计日志
```

每个区域标题可折叠，默认折叠，点击展开。这样首屏只有最核心的部门+项目信息。

#### 部门卡片交互

点击部门卡片 → 打开 **部门详情 Drawer**（从右侧 500px 宽度滑出）:
- 部门配置（名称、OKR、Skills）
- 该部门所有项目列表
- 该部门的 Agent Runs（内联，不跳转到 Agents 标签）
- 操作按钮：启动新任务、关闭工作区、杀死进程

#### 项目卡片交互

在部门详情中点击具体项目 → 展开 **项目工作台**（替换主内容区，顶部面包屑导航返回）:

```
OPC > 研发部 > data-pipeline
┌───────────────────────────────────────────────────────────────┐
│  项目: data-pipeline                           状态: active   │
│  ──────────────────────────────────────────────────────────── │
│  Pipeline DAG 视图                                           │
│  [Stage1 ✓] → [Stage2 ✓] → [Stage3 ▶] → [Stage4 ⏳] → [Stage5 ⏳]│
│  ──────────────────────────────────────────────────────────── │
│  Stage 3: 数据处理                                           │
│  Run: #abc123 · Round 3/10 · 5m32s · claude-sonnet-4-20250514          │
│  [查看日志] [跳过] [重试] [取消]                             │
│  ──────────────────────────────────────────────────────────── │
│  执行日志 (实时):                                            │
│  > Processing data chunk 45/100...                           │
│  > Writing intermediate results...                           │
└───────────────────────────────────────────────────────────────┘
```

---

## 四、导航与路由映射

### 4.1 标签 → 内容映射

| 标签 | 路由标识 | 主内容 | 来源组件 |
|------|----------|--------|----------|
| 🏢 OPC | `opc` (默认) | 运营全景 → 部门网格 + 对比 + 交付 | `ceo-dashboard.tsx` (精简版) |
| 💬 Chat | `conversations` | 对话界面 | `chat.tsx` + `chat-input.tsx` |
| 📚 Know | `knowledge` | 知识库 + 部门记忆 | `knowledge-panel.tsx` + `department-memory-panel.tsx` |
| ⚙️ Ops | `operations` | 分析 + Token + MCP + Tunnel + Codex | 现有不变 |

### 4.2 原 Agents 标签去向

不再有独立的 Agents 标签页。AgentRuns 的功能被拆解到：

| 功能 | 新位置 |
|------|--------|
| 查看活跃 Runs | Header ▶ 通知指示器 → Active Runs 抽屉 |
| Dispatch 新 Run | OPC 命令框 / 项目工作台内 Dispatch 按钮 |
| Run 详情 + 日志 | 项目工作台内联展示 |
| Run 快速干预 | Active Runs 抽屉内的按钮 |

### 4.3 面包屑导航

当 CEO 从 OPC 首页钻取到具体项目时，使用面包屑导航：

```
🏢 OPC  ›  研发部  ›  data-pipeline
```

点击任意层级可返回该视图。

---

## 五、组件重构清单

### 5.1 新组件

| 组件 | 描述 | 来源 |
|------|------|------|
| `GlobalCommandBar` | Header 中央的命令输入框 | 从 `ceo-dashboard.tsx` 提取命令框逻辑 |
| `NotificationIndicators` | Header 右侧的 🔔⚡▶ 指示器组 | 新建 |
| `ApprovalDrawer` | 审批侧滑抽屉 | 从 `approval-panel.tsx` 重构 |
| `EventsDrawer` | 事件侧滑抽屉 | 从 `ceo-dashboard.tsx` 事件流提取 |
| `RunsDrawer` | Active Runs 侧滑抽屉 | 从 `ceo-dashboard.tsx` Active Runs 提取 |
| `NavRail` | 左侧图标导航条 | 替代 sidebar 的标签部分 |
| `ProjectBreadcrumb` | OPC > 部门 > 项目 面包屑 | 新建 |

### 5.2 重构组件

| 组件 | 变更 |
|------|------|
| `ceo-dashboard.tsx` | 移除命令框(→Header)、审批(→抽屉)、Events(→抽屉)、Active Runs(→抽屉)。只保留部门网格+对比+交付+Scheduler+报表+审计 |
| `sidebar.tsx` | 移除 ModeTabs 5 标签，改为 NavRail 4 图标。移除 agents 标签所有代码 |
| `page.tsx` | 默认 section 改为 `'opc'`，移除 `agents` section 的渲染分支，新增 Header 组件集成 |
| `projects-panel.tsx` | 可能拆分为 OPC 首页视图 + 项目工作台视图 |
| `approval-panel.tsx` | 从嵌入式面板改为 Dialog/Drawer 形态 |

### 5.3 保持不变

| 组件 | 原因 |
|------|------|
| `chat.tsx`, `chat-input.tsx` | Chat 功能保持原样 |
| `knowledge-panel.tsx` | 知识库保持原样 |
| `analytics-dashboard.tsx`, 运维组件 | Ops 标签保持原样 |
| `dag-view.tsx`, `pipeline-*.tsx` | 项目工作台内使用，不变 |
| `department-detail-drawer.tsx` | 部门详情，功能增强 |
| `department-setup-dialog.tsx` | 不变 |
| `onboarding-wizard.tsx` | 不变 |

---

## 六、交互流程详解

### 6.1 CEO 首次打开应用

```
1. 进入应用 → 自动进入 OPC 首页
2. 首屏: 部门网格 + 跨部门对比 + 近期交付
3. Header: 命令框 (空) + 通知指示器 (显示审批数、事件数、运行数)
4. 如果检测到部门未配置 → 显示 Onboarding 引导条
```

### 6.2 CEO 下达一条指令

```
1. 点击 Header 命令框 或按 Cmd+K
2. 输入 "让研发部做一个数据分析模块"
3. 按 Enter 发送
4. → ceo-agent 解析意图，匹配部门，创建项目
5. → Header 旁边出现 Toast: "✅ 已在研发部创建项目 data-analysis"
6. → ▶ 指示器数字 +1 (新 Run 开始)
7. CEO 可以点击 ▶ 查看运行详情，也可以继续其他操作
```

### 6.3 CEO 处理审批

```
1. Header 🔔 显示红色数字 "3"
2. 点击 🔔
3. → 右侧滑出审批抽屉 (400px, 半透明背景)
4. 看到 3 条待审批请求，每条有上下文 + 批准/拒绝按钮
5. 逐条处理 或 点击"全部批准"
6. 处理完成 → 🔔 badge 消失
7. 关闭抽屉 → 回到之前的页面
```

### 6.4 CEO 查看部门详情

```
1. 在 OPC 首页看到"研发部"有 3 个 active 项目
2. 点击"研发部"卡片
3. → 右侧滑出部门详情 Drawer (500px)
4. 看到: 部门 OKR、项目列表、运行状态、Token 消耗
5. 点击某个项目 "data-pipeline"
6. → 主内容区切换到项目工作台视图
7. → 面包屑: OPC > 研发部 > data-pipeline
8. 看到 Pipeline DAG + 当前 Stage 运行状态 + 日志
9. 点击面包屑 "OPC" → 返回首页
```

### 6.5 CEO 处理突发告警

```
1. ⚡ 指示器出现红色脉冲 + badge "1"
2. 点击 ⚡
3. → 右侧滑出事件抽屉
4. 看到: "🔴 critical · 研发部 data-pipeline stage 3 连续失败"
5. 点击 [重试] 按钮
6. → 直接触发该 stage 的重试
7. 或点击 [查看] → 跳转到项目工作台查看详情
```

### 6.6 CEO 查看日/周/月报

```
1. 在 OPC 首页滚动到折叠区域
2. 点击 "▸ 日/周/月报" 展开
3. → 显示周期选择器 (日/周/月) + 部门选择
4. 查看聚合数据: 任务完成 / 进行中 / 阻塞 + Token 消耗
```

---

## 七、视觉设计规范

### 7.1 Header

- **背景**: `rgba(9,17,27,0.90)` + backdrop-blur-xl
- **高度**: 56px (桌面) / 48px (移动)
- **命令框**: rounded-full, 内发光边框, 聚焦时 ring-2 ring-sky-500/30
- **通知 badge**: 绝对定位于图标右上角, 红色 (#ef4444), 尺寸 16x16, 文字 10px

### 7.2 侧滑抽屉

- **宽度**: 400px (审批/事件) / 480px (Runs)
- **背景**: `rgba(9,17,27,0.96)` + backdrop-blur
- **阴影**: 左侧 box-shadow: `-20px 0 60px rgba(0,0,0,0.4)`
- **动画**: translate-x 300ms ease-out
- **遮罩**: 主内容区覆盖半透明 overlay `rgba(0,0,0,0.3)`, 点击关闭

### 7.3 NavRail

- **宽度**: 60px
- **背景**: 与 sidebar 背景一致
- **选中态**: 左侧 3px accent 边框 (sky-400)
- **图标**: 24x24, 未选中 text-white/40, 选中 text-white/90
- **Tooltip**: 悬停 200ms 后显示, 右侧 offset 8px

### 7.4 部门卡片

- 保持现有设计, 增加 hover 时的微发光效果
- Active 项目数使用脉冲动画圆点
- 点击时 scale(0.98) + 0.1s transition

### 7.5 Toast 反馈

- **位置**: Header 下方居中
- **样式**: rounded-full, border, backdrop-blur
- **动画**: slide-down 200ms + 3s 显示 + slide-up 200ms 淡出
- **颜色**: 成功 emerald, 失败 red, 信息 sky

---

## 八、响应式适配

### 桌面 (≥1024px)

```
[NavRail 60px] [Main Content 100%]
Header: 全部展示
命令框: 宽度 400-600px
```

### 平板 (768-1023px)

```
[NavRail 可折叠] [Main Content 100%]
Header: 命令框缩短, 通知图标保留
部门网格: 2 列
```

### 手机 (< 768px)

```
[底部 Tab Bar] [Main Content 100%]
Header: 命令框变为图标, 点击展开全屏输入
部门网格: 1 列
侧滑抽屉: 全屏
```

---

## 九、实施路径

### Phase 1: Header 改造 (预计影响: 3 个文件)

1. 新建 `GlobalCommandBar` 组件
2. 新建 `NotificationIndicators` 组件 + 3 个 Drawer
3. 修改 `page.tsx` Header 区域
4. `ceo-dashboard.tsx` 移除命令框、审批、Events、Active Runs

### Phase 2: 导航重构 (预计影响: 2 个文件)

1. 修改 `sidebar.tsx` — ModeTabs 改为 NavRail
2. 修改 `page.tsx` — 默认 section 改为 `'opc'`，移除 agents 分支

### Phase 3: OPC 首页精简 (预计影响: 2 个文件)

1. `ceo-dashboard.tsx` — 折叠区域 (Scheduler/报表/审计)
2. `projects-panel.tsx` — 项目工作台视图 + 面包屑

### Phase 4: 整合验证

1. 端到端走通 7 个 CEO 旅程
2. 响应式测试
3. Build + 全量测试

---

## 十、不做清单 (Explicit Non-Goals)

- ❌ 不改后端 API — 纯前端交互重构
- ❌ 不改 Chat 功能 — Chat 标签页保持原样
- ❌ 不改 Knowledge 功能 — 知识库保持原样
- ❌ 不改 Operations 功能 — 运维标签保持原样
- ❌ 不添加新的后端功能 — 仅重新组织已有数据的展示方式
- ❌ 不做动画库引入 — 只用 CSS transition/animation
- ❌ 不做 i18n 扩展 — 新增文案暂用中文，后续补 i18n

---

## 附录 A: 组件依赖关系

```
page.tsx
  ├── GlobalCommandBar (新)
  ├── NotificationIndicators (新)
  │   ├── ApprovalDrawer (新, 实际用 approval-panel 的逻辑)
  │   ├── EventsDrawer (新, 从 ceo-dashboard 事件流提取)
  │   └── RunsDrawer (新, 从 ceo-dashboard Active Runs 提取)
  ├── NavRail (从 sidebar 精简)
  │   └── Sidebar content (depending on section)
  ├── OPC section (默认)
  │   ├── ceo-dashboard.tsx (精简版)
  │   │   ├── 部门网格
  │   │   ├── DepartmentComparisonWidget
  │   │   ├── 近期交付
  │   │   ├── Scheduler (折叠)
  │   │   ├── 日/周/月报 (折叠)
  │   │   └── 审计日志 (折叠)
  │   ├── department-detail-drawer.tsx
  │   ├── projects-panel.tsx (项目工作台)
  │   └── onboarding-wizard.tsx
  ├── Chat section
  │   ├── chat.tsx
  │   └── chat-input.tsx
  ├── Knowledge section
  │   ├── knowledge-panel.tsx
  │   └── department-memory-panel.tsx
  └── Operations section
      ├── analytics-dashboard.tsx
      ├── token-quota-widget.tsx
      ├── mcp-status-widget.tsx
      ├── tunnel-status-widget.tsx
      └── codex-widget.tsx
```

## 附录 B: 数据流

```
API Polling (5s interval):
  ├── projects → OPC 部门网格 + 近期交付 + 项目工作台
  ├── agentRuns → Header ▶ badge + RunsDrawer
  ├── approvals → Header 🔔 badge + ApprovalDrawer
  ├── events → Header ⚡ badge + EventsDrawer
  ├── departments → OPC 部门卡片 + 详情 Drawer
  └── workspaces → OPC 部门发现

CEO Command Flow:
  GlobalCommandBar.onSubmit(text)
    → processCEOCommand(text, workspaces, departments)
    → api.ceoCreateProject() / api.interveneRun() / etc.
    → Toast 反馈
    → Polling 自动更新 UI
```
