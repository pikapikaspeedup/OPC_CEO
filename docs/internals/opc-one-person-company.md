# OPC — One Person Company：以 IDE 为核心的 AI 自治运营框架

> 将 Antigravity Multi-Agent 系统进化为 OPC——一个人（CEO）+ AI 团队自治运营多种业务。  
> 经过 18 轮正反辩论沉淀。

---

## 1. 核心定位

### 1.1 范式

```
当前:    人类 → Template → Pipeline → Stage → Role → Run
OPC:     人类 CEO + AI CEO → Department → Template → Role(有名字) → Run
```

### 1.2 关键设计决策（辩论结论）

1. **Employee 不是独立实体**——是 Role 的展示层属性（displayName + avatar）。名字不影响核心逻辑。
2. **记忆是组织级的**——存在 Workspace 的 rules/knowledge/workflows 中，不是个人级别。
3. **CEO 分配任务给 Department**——不是给具体员工。Department 自己选合适的 Template 执行。
4. **核心执行引擎不改**——DagIR / Pipeline / Review Engine / Checkpoint 全部保持。
5. **Workflow 保留**——Skill 是 Workflow 的轻量封装（+产出规范+元数据），共存不替代。
6. **Playbook 从必选变可选**——Coordinated 任务用 Playbook，Ad-hoc/Strategic/Reactive 不需要。

### 1.3 现有系统覆盖率

| 能力 | 状态 |
|------|------|
| 按 Playbook 多人协作 (Template + Pipeline/DAG + DagIR) | ✅ 已有 |
| 修改工作流程 (Workflow .md / 换 Template) | ✅ 已有 |
| 激活/停用团队 (Project create/pause/cancel) | ✅ 已有 |
| 不同 Workspace 不同流程 | ✅ 已有 |
| Gate 审批 + Review Engine + StageContract | ✅ 已有 |
| Checkpoint / Journal / Resource Policy | ✅ 已有 |
| 角色拟人化展示（displayName/avatar） | ❌ 需新增（纯展示层） |
| 单人临时任务 (Ad-hoc) | ❌ 需新增 |
| 持续/定时任务 (Cron) | ❌ 需新增 |
| CEO 汇总报告 + 日报 | ❌ 需新增 |
| AI CEO 智能分配 | ❌ 需新增 |

**结论：核心引擎不需重设计。加展示层 + 任务调度层 + 报告层。**

---

## 2. 概念体系

### 2.1 任务流转

```
人类 CEO: "做一个竞品分析"
  → AI CEO: 判断类型 → 分配给调研部 (Department/Workspace)
    → 调研部: 选择"竞品分析" Template
      → Pipeline 执行: Role "研究员"(displayName:"王五") 按 Workflow 工作
        → 产出 Deliverable → 日报汇总 → 返回 CEO
```

### 2.2 概念层级

```
┌──────────────────────────────────────────────────┐
│  CEO Layer                                        │
│  人类 CEO ←→ AI CEO（战略 + 任务分配）             │
├──────────────────────────────────────────────────┤
│  Department Layer (= Workspace)                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐    │
│  │ 产研部     │ │ 调研部      │ │ 运营部      │    │
│  │ Type: Build│ │ Type: Rsrch│ │ Type: Ops   │    │
│  │ Templates: │ │ Templates: │ │ Templates:  │    │
│  │  全栈开发   │ │  竞品分析   │ │  SEO 监控   │    │
│  │  需求评审   │ │  技术调研   │ │  设备巡检   │    │
│  │ Knowledge: │ │ Knowledge: │ │ Knowledge:  │    │
│  │  编码规范   │ │  行业资料   │ │  运营手册   │    │
│  └────────────┘ └────────────┘ └─────────────┘   │
├──────────────────────────────────────────────────┤
│  Execution Layer (现有系统，不改)                   │
│  Template → Pipeline/DagIR → Stage → Role → Run   │
│  Role 增加 displayName/avatar (纯展示)             │
└──────────────────────────────────────────────────┘
```

### 2.3 概念映射表

```
现有概念                  OPC 概念              变化程度
──────────────────────────────────────────────────────
Workspace              → Department           轻装饰 (加 type/OKR/名称)
Template               → Playbook             概念名更清晰，逻辑不变
Agent Group            → (不变)               无变化
Role                   → Role + displayName   加展示字段，逻辑不变
Workflow .md           → Skill.method         Skill 封装 Workflow
Pipeline / DagIR       → (不变)               执行引擎不动
Project                → Project              增加 type 字段
Run                    → WorkSession          概念名
Execution Journal      → WorkLog              汇总为日报的数据源
StageContract          → DeliverableSpec      拟人化包装
Resource Policy        → (不变)               不变
──────────────────────────────────────────────────────
```

---

## 3. Role 展示层

Role 是既有概念。OPC 只增加展示属性，不改执行逻辑。

```typescript
interface RoleDisplay {
  displayName: string;         // "张三" / "PM Leader"
  avatar: string;              // "📋" / "💻"
  statusText?: string;         // "正在撰写PRD..."
}

// 前端 helper——roleKey 模式匹配图标
function resolveRoleAvatar(roleKey: string): string {
  if (/pm|product/i.test(roleKey)) return '📋';
  if (/dev|engineer|code/i.test(roleKey)) return '💻';
  if (/qa|test/i.test(roleKey)) return '🧪';
  if (/design/i.test(roleKey)) return '🎨';
  if (/review|lead/i.test(roleKey)) return '👔';
  if (/research|analyst/i.test(roleKey)) return '🔍';
  if (/ops|monitor/i.test(roleKey)) return '⚙️';
  return '🤖';
}
```

名字来源：
- 确定性哈希 roleId → 固定名字（同一 Role 总是同一个名字）
- 或在 Template `roles[].displayName` 中自定义

---

## 4. Skill（技能）= Workflow 的轻量封装

```typescript
interface Skill {
  skillId: string;
  name: string;                    // "PRD撰写" / "代码审查"
  category: string;                // "产品" / "工程" / "测试"
  difficulty: 'junior' | 'mid' | 'senior';
  defaultMethod: string;           // → Workflow .md 路径 (1:1)
  alternativeMethods?: string[];   // Phase 2+: 同技能多种方法
  deliverableSpec?: {
    format: string;
    schema?: string;
    qualityCriteria?: string[];
  };
}
```

- Skill **属于 Department**（部门级能力），不属于个人
- Workflow .md 保持不变，Skill 是其上层元数据封装
- 当 CEO 说"谁能做竞品分析？"→ AI CEO 查找哪些 Department 有该 Skill

---

## 5. Department（部门 = Workspace）

### 5.1 三种部门原型

| 类型 | 工作模式 | Playbook? | 报告形式 | 对应执行场景 |
|------|---------|-----------|---------|------------|
| **Build** (产研) | 多人协作，按 Pipeline | ✅ 必要 | 项目进度 + 产出物 | Coordinated |
| **Research** (调研) | 单人/少人，自主调研 | ❌ | 调研报告 + 建议 | Ad-hoc |
| **Operations** (运营) | 常态化监控 | ❌ | 指标日报 + 异常警报 | Cron/Scheduled |

### 5.2 Department 定义

```typescript
interface Department {
  departmentId: string;
  name: string;
  type: 'build' | 'research' | 'operations'; // 实际实现已扩展为 string + typeIcon，支持自定义类型
  workspaceUri: string;
  skills: string[];                // 部门拥有的 Skill ID
  knowledgeBase: string[];         // 参考资料路径
  okr?: {
    objectives: Array<{
      title: string;
      keyResults: Array<{ description: string; target: number; current: number }>;
    }>;
    period: string;
  };
}
```

### 5.3 Workspace 物理结构

```
workspace/ (= Department)
├── .department/
│   ├── config.json              # 部门配置、type、OKR
│   ├── skills/                  # Skill 定义（YAML frontmatter + Workflow ref）
│   │   ├── prd-writing.yaml
│   │   └── code-review.yaml
│   └── knowledge/               # 部门知识库
│       ├── style-guide.md
│       └── api-standards.md
├── (workspace files...)
```

---

## 6. 四种执行场景

| 场景 | 编排方式 | 自治度 | 典型例子 | Playbook? | DagIR? |
|------|---------|-------|---------|-----------|--------|
| **Ad-hoc** | 无 Pipeline，直接执行 | ★★★★★ | 修 bug、写文档 | ❌ | ❌ |
| **Coordinated** | Pipeline/DAG 多人协作 | ★★☆☆☆ | 需求→开发→测试 | ✅ | ✅ |
| **Strategic** | 主动思考/定期产出 | ★★★★☆ | 竞品分析、技术调研 | ❌ | ❌ |
| **Reactive** | 跳过流程直接执行 | ★★★★★ | 生产事故修复 | ❌ | ❌ |

**自治的边界：**
- 个人工作范围内 → 高自治（怎么实现由我决定）
- 跨角色/跨部门协作 → 低自治（按 Pipeline/DAG 配合）
- 突发任务 → 完全自治（不走流程）

```typescript
type OPCProject =
  | { type: 'coordinated'; playbookId: string; pipeline: DagIR; }
  | { type: 'adhoc'; goal: string; departmentId: string; skillHint?: string; }
  | { type: 'strategic'; topic: string; departmentId: string; schedule: 'once' | 'daily' | 'weekly'; };
```

---

## 7. AI CEO 与权限体系

```
┌─────────────────────────────────────────┐
│ Human CEO (你)                            │
│   ✅ 审批战略级决策                        │
│   ✅ 设定 Department OKR                  │
│   ✅ 选定 Playbook / 覆盖执行计划          │
├─────────────────────────────────────────┤
│ AI CEO                                    │
│   ✅ 分解目标为 Project                   │
│   ✅ 分配任务给 Department                │
│   ✅ 审批日常产出                          │
│   ⚠️ 跨部门协调（需通知人类）              │
│   ❌ 预算/资源决策（必须人类审批）          │
├─────────────────────────────────────────┤
│ Department (Workspace)                    │
│   ✅ 选择 Template 执行任务               │
│   ✅ 内部工作审查                          │
│   ⚠️ 跨部门请求（上报 AI CEO）            │
├─────────────────────────────────────────┤
│ Role (Agent)                              │
│   ✅ 按 Workflow 执行                     │
│   ✅ 产出 Deliverable                     │
│   ⚠️ 遇到 blocker 上报                   │
└─────────────────────────────────────────┘
```

---

## 8. 记忆与报告

### 8.1 记忆体系

| 层 | 名称 | 粒度 | 来源 | 消费者 |
|----|------|------|------|--------|
| ① | **WorkLog** | 每步操作 | = Execution Journal（已有） | 审计/调试 |
| ② | **DailyDigest** | 每日总结 | WorkLog 自动摘要 | CEO / 部门 |
| ③ | **Insight** | 不定期 | 战略任务产出 | CEO 决策 |
| ④ | **OrgMemory** | 跨项目 | 经验教训沉淀（= Workspace rules/knowledge） | 全部门 |

> 记忆是**组织级**（存在 Workspace 中），而非个人级。

### 8.2 报告分层

```
CEO 视角:    部门日报（Workspace 级汇总）
                ↓ 钻取
部门视角:    角色/任务明细
                ↓ 钻取
             WorkLog（操作原始记录）
```

### 8.3 日报结构

```typescript
interface DailyDigest {
  departmentId: string;
  date: string;
  summary: string;
  tasksCompleted: string[];
  tasksInProgress: string[];
  blockers: string[];
  evidence: Array<{              // 可验证性——关联产出物
    description: string;
    artifactPath?: string;
    workLogEntryIds: string[];
  }>;
  insights?: Array<{             // 战略思考
    topic: string;
    observation: string;
    recommendation: string;
    urgency: 'low' | 'medium' | 'high';
  }>;
}
```

---

## 9. 产出物（Deliverable）

```typescript
interface DeliverableSpec {
  format: string;                  // "markdown" / "code" / "json"
  schema?: string;
  qualityCriteria?: string[];
}

interface Deliverable {
  id: string;
  projectId: string;
  type: 'document' | 'code' | 'data' | 'review';
  format: string;
  content: string | string[];
  quality: {
    reviewResult?: ReviewDecision;
  };
  createdAt: string;
}
```

> 与现有 StageContract (V4.4) 重叠。DeliverableSpec 是 StageContract 的 OPC 层包装。

---

## 10. 可视化（早期草案，已被 §13 取代）

> **注：§10 是早期讨论产物，保留供对比参考。实际设计以 §13 SimCity 三层架构为准。**

### 10.1 CEO Dashboard（早期版 → 见 §13.3）

```
┌─────────────────────────────────────────────┐
│  🏢 My Company                      [设置]  │
├──────────┬──────────────────────────────────┤
│ 部门     │  📊 今日简报                      │
│          │  👥 6 角色在岗 · 📋 3 项目进行中  │
│ 📦 产研部│  ✅ 2 待审批 · ⚠️ 1 风险预警      │
│          │                                  │
│ 🔍 调研部│  ──── 团队动态 ────              │
│          │  🟢 张三(PM) 正在撰写PRD...       │
│ ⚙️ 运营部│  🟢 李四(Dev) 正在编码...         │
│          │  🟡 赵六(QA) 等待上游...          │
│          │                                  │
│          │  ──── 待您决策 ────              │
│          │  📌 PRD v2 是否批准?             │
│          │     [查看] [批准] [退回]          │
└──────────┴──────────────────────────────────┘
```

### 10.2 部门视图（早期版 → 见 §13.5）

```
┌─────────────────────────────────────────────┐
│  📦 产研部                   [← 返回公司]    │
├─────────────────────────────────────────────┤
│  🎯 OKR                                     │
│  ├── O1: 用户反馈系统 ████████░░ 80%        │
│  └── O2: API <200ms ██████░░░░ 60%          │
│                                              │
│  📋 进行中的项目                              │
│  ├── "用户反馈系统" (Coordinated)             │
│  │   Stage 2/4: 💻李四 编码中 → 🧪赵六 待测  │
│  └── "修复登录 bug" (Ad-hoc)                 │
│      💻李四 → 预计今天完成                    │
│                                              │
│  📊 部门日报                                  │
│  ├── PRD v2 初稿完成，等待审阅               │
│  ├── API 模块 3/5，测试覆盖 72%              │
│  └── 待上游提交后开始测试                     │
└─────────────────────────────────────────────┘
```

---

## 11. 差距分析

### 11.1 特性差距（Feature Gaps）

| ID | 需求 | 现有状态 | 缺失 | 体量 | Phase |
|----|------|---------|------|------|-------|
| F1 | Role displayName/avatar | 匿名 roleId | 展示字段 + 名字生成器 | S | 0 |
| F2 | Skill 实体 | Workflow .md 裸文件 | Skill = Workflow + metadata | S | 1 |
| F3 | Department 配置 | Workspace = 纯 URI | type / OKR / skills[] | S | 1 |
| F4 | Ad-hoc 任务 | 必须走 Template | 新 Project type（无 Pipeline） | M | 2 |
| F5 | Daily Digest | Journal 原始条目 | WorkLog → 自动摘要 API | M | 3 |
| F6 | Deliverable 追踪 | Run.changedFiles[] | Deliverable 实体 + 验收 | M | 3 |
| F7 | Cron / 定时触发 | 无调度 | Scheduler + Trigger | M | 4 |
| F8 | AI CEO Agent | 无 | CEO Agent + 任务分配 + 决策链 | L | 5 |
| F9 | 动态 Pipeline | DagIR 预编译 | 运行时渐进 DAG 构建 | XL | 6 |

### 11.2 可视化差距（Visualization Gaps）

| ID | 需求 | 现有 UI | 差距 | 体量 | Phase |
|----|------|---------|------|------|-------|
| V1 | 角色名片（名字+头像） | roleId 灰文字 | Role Card 渲染 | S | 0 |
| V2 | 工作状态文案 | status badge | "🟢 正在编码..." | S | 0 |
| V3 | Stage 内角色并排 | 垂直列表 | 水平 flex，Loop 左右排列 | S | 0 |
| V4 | 角色图标映射 | 无 | PM→📋 Dev→💻 QA→🧪 | S | 0 |
| V5 | 团队概览摘要 | 无 | "👥 3 角色工作中 · 1 待审阅" | S | 0 |
| V6 | Skill 浏览 | Workflows 扁平列表 | Skill 卡片 + category | M | 1 |
| V7 | 部门视图 | Workspace dropdown | OKR + 项目 + 日报 | M | 1 |
| V8 | 快速任务入口 | 只能从 Template 建 Project | Ad-hoc 输入框 | S | 2 |
| V9 | CEO Dashboard | 无 | 简报 + 动态 + 待决策 | M | 3 |
| V10 | 日报视图 | 无 | 日报卡片 + evidence 钻取 | M | 3 |
| V11 | 决策审批面板 | Gate 藏在 StageDetail | CEO 顶层待决策列表 | S | 3 |

### 11.3 分阶段差距地图

```
Phase   Feature Gaps          Visualization Gaps         说明
──────────────────────────────────────────────────────────
0       F1 (displayName)      V1 V2 V3 V4 V5            纯前端，零后端
1       F2 F3 (Skill/Dept)    V6 V7                      轻量后端
2       F4 (Ad-hoc)           V8                          新任务类型
3       F5 F6 (报告/产出物)    V9 V10 V11                 CEO Dashboard
4       F7 (Cron)             (运营面板)                   定时任务
5       F8 (AI CEO)           (CEO对话)                   核心智能
6       F9 (动态Pipeline)     (自由编排可视化)              长期愿景
```

> **Phase 0 快赢**：V1-V5 共 5 项纯前端小改动 → 从"监控仪表盘"变为"团队管理界面"。

---

## 12. 开放问题

1. **Department 配置存储**——Workspace 内 `.department/config.json` 还是集中存储？
2. ~~**跨 Workspace 协作**~~——暂不考虑，每个项目隔离，后续再设计。
3. **AI CEO 形态**——常驻 Agent 还是按需唤醒？（思考链路已在 §15 定义，形态留 open）
4. **成本控制**——OPC 自治运行时如何控制 API 调用成本？
5. **事件流技术结构**——Events（Gate 审批、超时、交付）的来源、格式、推送 vs 轮询？

---

## 13. CEO 控制面板：SimCity 式设计

> 核心理念：城市自己跑，市长只在关键时刻拍板。

### 13.1 设计哲学

CEO 控制面板应像 SimCity 而非 RPG：

| 维度 | RPG 式（❌） | SimCity 式（✅） |
|------|-------------|-----------------|
| 操控粒度 | 指挥每个任务 | 规划区域，城市自己跑 |
| 界面 | 任务板 + 队列 + 对话… | **一张俯瞰图 + 事件浮窗** |
| 管理方式 | 微观管理 | 宏观治理 |
| 角色 | 将军 | 市长 |

### 13.2 三层缩放（唯一架构）

```
第一层: 俯瞰 — 部门区块 + 事件流 + 输入框  （CEO 日常只看这一层）
第二层: 放大 — 点击部门 → 内部项目和进度
第三层: 细节 — 点击项目 → Pipeline / Stage（= 现有 Workbench）
```

### 13.3 第一层：CEO 俯瞰图

```
┌────────────────────────────────────────────────────────┐
│  🏙️ 我的公司                             💰 ░░░░ 健康  │
│                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ 🔵 产研部     │  │ 🟢 调研部     │  │ 🟡 运营部     │ │
│  │  ██████░░░   │  │  ████████░░  │  │  █████░░░░░  │ │
│  │  繁忙        │  │  活跃        │  │  正常        │ │
│  │  3 项目进行中 │  │  1 项目进行中 │  │  2 项目进行中 │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│                                                        │
│  ⚡ 事件                                               │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 🚨 产研部"支付模块"超时 2 天 → [查看] [暂置]       │ │
│  │ 🔔 调研部竞品报告已交付 → [查看报告]               │ │
│  │ ✅ 登录 bug 修复完成                               │ │
│  └───────────────────────────────────────────────────┘ │
│                                                        │
│  ┌──────────────────────────────┐                      │
│  │ 说点什么…              [→]  │  ← 唯一的输入口       │
│  └──────────────────────────────┘                      │
└────────────────────────────────────────────────────────┘
```

四大元素：
1. **部门区块**——每个部门是一个"区域"，显示忙碌度 + 项目数 + 健康色
2. **事件流**——系统主动浮上来的通知，不需要 CEO 主动翻看
3. **输入框**——说人话就行（"优化支付流程"），AI CEO 自动分析、推荐、派发
4. **全局健康**——一个指标条概括公司整体状况

### 13.4 事件分级

| 级别 | 图标 | 含义 | CEO 操作 |
|------|------|------|---------|
| Critical | 🚨 | 需要立刻处理（Gate 审批、紧急事故） | 必须动作 |
| Warning | ⚠️ | 需要关注（超时、风险） | 可暂置 |
| Info | 🔔 | 通知（完成、交付） | 可查看 |
| Done | ✅ | 已完成 | 自动消失 |

### 13.5 第二层：部门放大（Zoom In）

点击部门区块 → **原地展开**（不跳新页面）：

```
┌──────────────────────────────────────────────────┐
│ 🔵 产研部                              [缩小 ↗] │
│                                                  │
│  项目                         状态               │
│  ├─ 用户反馈系统 v2           ██████░░ Stage 3/4  │
│  │   └─ feature/dark-mode    ███░░░░░ Stage 1/3  │
│  ├─ 支付流程优化              ██░░░░░░ Stage 1/4  │
│  └─ 登录模块重构              ████████ ✅ 完成    │
│                                                  │
│  能力: PM · Dev · QA · Design                    │
│  Playbook: 全栈开发 · 支付优化 · Bug修复          │
└──────────────────────────────────────────────────┘
```

### 13.6 输入 → 派发（自然语言）

```
CEO: "优化支付流程"
  → AI CEO 分析 → 推荐部门（产研部）+ Playbook
  → 自动派发
  → 事件流出现 "🔔 已创建：支付流程优化 → 产研部"
  → CEO 不需要再做任何事（有问题系统会弹事件问你）
```

不需要"创建任务 → 选部门 → 选模板 → 确认"的冗长流程。

---

## 14. Star-Office-UI 集成分析

> 参考: [github.com/ringhyacinth/Star-Office-UI](https://github.com/ringhyacinth/Star-Office-UI)  
> 像素风 AI 办公室看板，把 AI 助手工作状态实时可视化为办公室中移动的像素角色。

### 14.1 Star-Office-UI 核心机制

| 机制 | 说明 |
|------|------|
| 状态 → 区域映射 | 6 种状态 (idle/writing/researching/executing/syncing/error) → 3 个办公室区域（休息区/工作区/Bug区） |
| 角色动画 | 像素角色根据状态**走到**对应区域，带动画 + 气泡文字 |
| 昨日小记 | 自动从 memory/*.md 读取工作记录，脱敏展示 |
| 多 Agent | 多人加入同一间办公室，实时看到所有人状态 |
| 桌面宠物 | Electron 透明窗口，办公室变桌面挂件 |

### 14.2 OPC 可借鉴的设计

#### ① Department = 办公室房间

Star-Office-UI 是**单间办公室**。OPC 有多个 Department，自然映射为**多间办公室**：

```
CEO 俯瞰图（第一层）= 公司大楼全景
  ├─ 点击产研部 → 进入产研部办公室（像素场景）
  ├─ 点击调研部 → 进入调研部办公室（像素场景）
  └─ 点击运营部 → 进入运营部办公室（像素场景）
```

每间办公室内：
- Role（张三/PM、李四/Dev）= 像素角色
- 角色状态 = 在办公区域内走动位置
- Stage 进度 = 气泡文字 "正在编写 PRD..."

#### ② 状态映射扩展

Star-Office-UI 的 6 状态太粗。OPC Pipeline Stage 可以提供更细的映射：

| OPC 状态 | Star Office 区域 | 像素场景 |
|----------|-----------------|---------|
| Stage: planning | 📋 白板区 | 角色站在白板前 |
| Stage: coding | 💻 工位区 | 角色坐在电脑前 |
| Stage: testing | 🧪 测试区 | 角色在测试台操作 |
| Stage: reviewing | 👔 会议区 | 角色围坐讨论 |
| Gate: pending | 🚪 门口 | 角色站在门前等待 |
| Idle / 无任务 | 🛋 休息区 | 角色坐沙发 |
| Error / blocked | 🐛 Bug 角 | 角色困惑表情 |

#### ③ 昨日小记 → DailyDigest

Star-Office-UI 的 "yesterday-memo" API 与 OPC 的 DailyDigest (§8) 直接对应：
- Star: `memory/*.md` → 脱敏 → 展示
- OPC: `WorkLog → 自动摘要 → DailyDigest` → 展示为办公室内"公告板"

#### ④ 桌面宠物 → CEO 挂件

Star-Office-UI 的 Electron 桌面宠物概念可作为 CEO 的"随身监控"：
- 透明小窗口显示公司"缩略图"（部门健康色 + 事件数）
- 有紧急事件时闪烁提醒
- 点击展开完整 CEO 俯瞰图

### 14.3 与 SimCity 三层设计的整合

```
SimCity 三层                    Star Office 视觉层
────────────────────────────────────────────────
第一层: 俯瞰         →   公司大楼全景（多间办公室缩略图）
第二层: 放大部门      →   进入某间像素办公室（角色走动 + 气泡）
第三层: 项目细节      →   现有 Workbench（Pipeline/Stage）
桌面挂件             →   Electron 桌面宠物（缩略全景）
```

### 14.4 实施建议

| 阶段 | 内容 | 依赖 |
|------|------|------|
| P0 | 在 CEO 俯瞰图中用 Star Office 的 **状态→区域映射** 思路：部门区块用色彩 + 动态指示而非静态文字 | §13 SimCity 俯瞰图 |
| P1 | 部门 zoom-in 视图可选"办公室模式"——用像素场景渲染 Role 位置 | Star Office 前端资产 (Phaser.js) |
| P2 | DailyDigest 复用 Star Office 的 "yesterday-memo" 展示模式 | F5 DailyDigest API |
| P3 | 桌面宠物模式复用 Electron shell，显示 CEO 缩略图 | Star Office desktop-pet |

> **注意**：Star-Office-UI 的美术资产"禁止商用"（MIT 代码 + 非商用美术）。如需商用 OPC，美术资产需替换为原创素材（见 §14.5）。

### 14.5 商用美术资产策略

Star-Office-UI 使用的 LimeZu **免费版**资产禁止商用。但有多条可商用路径：

#### 方案 A：零成本（CC0 + AI 生成）

| 资产 | 来源 | 许可 | 用途 |
|------|------|------|------|
| 建筑/俯瞰 | [Kenney "Tiny Town"](https://kenney.nl/assets/tiny-town) | CC0 公共领域 | CEO 俯瞰图的部门建筑 |
| 角色 | [Kenney "Roguelike Characters"](https://kenney.nl/assets/roguelike-characters) | CC0 | Role 像素角色 |
| 城市 | [Kenney "Pico-8 City"](https://kenney.nl/assets/pico-8-city) | CC0 | 公司全景 |
| 室内补充 | AI 生成（Stable Diffusion / DALL·E） | 自有 | 定制办公室场景 |

> Kenney.nl 所有资产均为 CC0——可自由使用、修改、商用，无需署名。

#### 方案 B：小预算 ~$30（效果最佳）

| 资产包 | 来源 | 价格 | 用途 |
|--------|------|------|------|
| Modern Interiors | LimeZu (itch.io) 付费版 | ~$10 | 办公桌、电脑、家具 |
| Modern Office | LimeZu (itch.io) 付费版 | ~$10 | 会议室、白板、工位 |
| 角色包 | LimeZu / LPC 付费扩展 | ~$10 | 动画角色 spritesheet |

> LimeZu 付费版可商用。与 Star-Office-UI 的美术风格一致，可无缝替换。

#### 方案 C：完全自主

- 使用 Aseprite 手绘 + AI 辅助
- 或 Stable Diffusion + 像素风 LoRA 训练
- 版权完全自有，风格可完全定制

#### 建议

初期用**方案 A**（Kenney CC0）快速原型，验证 OPC 可视化效果。  
产品化时切换到**方案 B**（LimeZu 付费版）获取高质量办公室场景。

---

## 15. AI CEO 思考机制

> CEO 是路由器，部门是执行者。CEO 不懂怎么做事，只知道事该交给谁。

### 15.1 思考链路

```
人类 CEO 输入: "优化支付流程"
        │
        ▼
 ┌──────────────────────────────┐
 │ Step 1: 扫描在岗部门          │
 │                               │
 │ 读取 CompanyContext:          │
 │  · 产研部 (build)             │
 │    Skills: 全栈开发, 支付优化  │
 │    负载: 高 (3 项目进行中)     │
 │  · 调研部 (research)          │
 │    Skills: 竞品分析, 技术调研  │
 │    负载: 低 (1 项目进行中)     │
 │  · 运营部 (operations)        │
 │    Skills: SEO监控, 设备巡检  │
 │    负载: 中 (2 项目进行中)     │
 └──────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────┐
 │ Step 2: 分类 + 匹配           │
 │                               │
 │ 任务类型: build               │
 │ 匹配 Skill: "支付优化" ✅     │
 │ 目标部门: 产研部              │
 │ 负载: 高 → ⚠️ 通知           │
 │ 建议模式: Coordinated         │
 │ 建议 Playbook: "支付优化"     │
 └──────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────┐
 │ Step 3: 派发                  │
 │                               │
 │ → Project in 产研部           │
 │ → type: coordinated           │
 │ → playbookHint: "支付优化"    │
 │ → 事件: 🔔 已派发             │
 └──────────────────────────────┘
        │
        ▼
 ┌──────────────────────────────┐
 │ Step 4: 部门接收 + Review     │
 │                               │
 │ 检查 Skill 匹配:             │
 │  · 匹配 ✅ → 用现有 Workflow  │
 │  · 模糊 ≈ → 适配现有 Workflow │
 │  · 无匹配 ❌ → 提议新 Workflow │
 │                               │
 │ 选择 Template → 启动执行      │
 └──────────────────────────────┘
```

### 15.2 CompanyContext（CEO 的眼睛）

```typescript
interface CompanyContext {
  departments: Array<{
    id: string;
    name: string;
    type: 'build' | 'research' | 'operations'; // 实际实现已扩展为 string + typeIcon
    skills: string[];             // ["支付优化", "全栈开发"]
    activeProjects: number;
    capacity: 'low' | 'medium' | 'high';
  }>;
}
```

AI CEO 启动时读取所有 Department 配置 → 构建 CompanyContext → 作为 LLM context 用于任务匹配。

### 15.3 三种匹配结果

| 匹配类型 | CEO 行为 | 部门行为 | 人类参与 |
|---------|---------|---------|---------|
| **精确匹配** | 自动派发 | 用现有 Workflow 执行 | 无（事后通知） |
| **模糊匹配** | 派发 + 建议 | 适配现有 Workflow | 通知 |
| **无匹配** | 上报人类 CEO | 提议新 Workflow 或建议转部门 | 必须决策 |

### 15.4 Workflow 进化机制

当部门收到一个无匹配任务时：

```
部门: "我没有'AI伦理审查'的 Workflow。
       但可以基于'需求评审'创建一个新的。
       需要 CEO 批准。"

  → 事件: ⚠️ 产研部提议新 Workflow "AI伦理审查"
  → CEO: [批准] / [调整] / [转给其他部门]
  → 批准 → 新 Workflow 加入部门 Skills
  → 下次同类任务 = 精确匹配
```

系统通过实际任务逐渐积累新能力。

### 15.5 AI CEO System Prompt 骨架

```
你是一家公司的 AI CEO。

## 公司概况
{CompanyContext JSON}

## 你的职责
1. 分析人类 CEO 的指令，判断任务类型
2. 扫描在岗部门的 Skills，找到最匹配的部门
3. 考虑部门负载，避免过载
4. 派发任务，指定建议的执行模式和 Playbook
5. 无法匹配时，上报人类 CEO

## 你不能做的事
- 不能新建/撤销部门（需人类授权）
- 不能修改预算/资源（需人类授权）
- 不能跨部门传递数据（每个项目隔离）

## 你需要记住的
- 优先使用精确匹配的 Skill
- 部门负载高时建议排队或分流
- 每次派发生成一条事件通知
```

---

*经过 18 轮正反辩论沉淀。*
