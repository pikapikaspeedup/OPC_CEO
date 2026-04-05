---
description: 派发多 Agent 团队任务。选择团队类型、配置目标、创建 Project 并 dispatch 到 Agent 运行时。输入 /team-dispatch 即可启动。
---

# 团队任务派发（Team Dispatch）

> 本 Workflow 用于在对话中快速派发一个多 Agent 团队任务。
> 系统内置了一套 **Multi-Agent 自治协作引擎**，能自动串联产品→架构→开发→交付的完整链路，也支持独立的 UX 评审和快速编码。

---

## Step 1: 确认用户意图

在派发之前，必须和用户确认以下信息，**让用户感受到这套系统有多有意思**：

1. **目标 (goal)**：你想让 AI 团队完成什么？描述越具体越好。
2. **选择派发模式**：
   - **模式 A — 全链 Template 派发**（推荐）：选一个 Template，系统自动安排多团队依次协作。你什么都不用管，坐等全链产出。
   - **模式 B — 单组派发**：只启动一个团队，适合简单任务。
3. **是否创建 Project**：大型任务建议创建 Project 统一归档全部 Run 和产物。

向用户展示下方的可选项，帮他们选择：

---

## 模式 A — 全链 Template 派发（推荐 🚀）

只需传一个 `templateId`，**不用指定 `groupId`**，系统自动从第 0 个阶段开始，每个阶段完成并 approved 之后自动触发下一阶段。全程 AI Supervisor 看护。

### 可用 Templates

| Template ID | 标题 | 自动串联的团队 | 一句话场景 |
|:------------|:-----|:--------------|:----------|
| `development-template-1` | 🏭 完整产研链 | 产品规格 → 架构设计 → 自主开发 | 大型功能从 0 到 1：给一个需求，自动出需求文档→技术方案→代码 |
| `ux-driven-dev-template` | 🎨 交互驱动产研 | UX 评审 → 产品规格 → 架构设计 → 自主开发 | 改善体验：先让 AI 审计当前 UI，再自动进入产研链 |
| `design-review-template` | 🔍 产品体验评审 | UX 评审（独立） | 单纯做一次交互评审，产出审计报告和改进方案 |
| `coding-basic-template` | ⚡ 简单编码 | Coding Worker（独立） | 快速修 Bug、小改动、重构 |

### 派发命令

```bash
// turbo
curl -X POST http://localhost:3000/api/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "<templateId>",
    "workspace": "file:///path/to/your/workspace",
    "projectId": "<projectId>",
    "prompt": "<目标描述>"
  }'
```

> 就这么简单。无需 `groupId`、无需 `pipelineStageIndex`、无需手动 `sourceRunIds`。全自动。

---

## 模式 B — 单组派发

只启动一个团队完成特定任务。适合不需要全链协作的简单场景。

| Group ID | 用途 | 上游依赖 |
|:---------|:-----|:---------|
| `coding-basic` | 快速编码（修 Bug、小功能、重构） | 无 |
| `product-spec` | 独立起草产品需求规格（3 轮对抗审查） | 无 |
| `architecture-advisory` | 独立设计技术架构方案（3 轮对抗审查） | 需要 `sourceRunIds` 指向一个 approved 的 product-spec run |

### 派发命令

```bash
// turbo
curl -X POST http://localhost:3000/api/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "<groupId>",
    "workspace": "file:///path/to/your/workspace",
    "projectId": "<projectId>",
    "prompt": "<目标描述>"
  }'
```

如果 Group 有上游依赖，加上 `"sourceRunIds": ["<上游 runId>"]`。

---

## 模式 C — 通用批量任务 (Fan-out 模式)

专门用于需要将一件重复的事情（如爬取 40 个不同网页、批量翻译文档、分析竞品）无脑分发给 N 个平行 Agent 同时处理的情况。

> **核心极简理念**：你这辈子只需要这个唯一的模板，**不用为新的爬虫或翻译任务再写一行规则代码**。

工作流会自动：
1. 阅读你的长 `prompt`，切片成 N 个独立的子任务。
2. 以安全并发上限（防 API 阻断）同时唤醒 `research-worker` 通用打工人。
3. **输出隔离 (Dual-Write)**：
   - AI 通信所需的中间态文件（`result.json`、状态锁等）会被严格沙盒化到当前 Project 的独享空间（如你配置的 `demolong/projects/...`），规避所有高并发覆写导致的冲突崩溃。
   - 人类需要看的**最终研究交付物**，会被打工人起个通顺的名字，统一汇总到工作区根目录的 `/research/[主题].md`。你可以一口气审阅全部成果而不用翻找沙盒抽屉。

### 派发命令

```bash
// turbo
curl -X POST http://localhost:3000/api/agent-runs \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "universal-batch-template",
    "workspace": "file:///path/to/your/workspace",
    "projectId": "<projectId>",
    "prompt": "<目标：你要批量干什么？包含你要处理的长长的数据清单 (例如 40 个 URL)>"
  }'
```

---

## Step 2: 创建 Project（推荐）

```bash
// turbo
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "name": "<项目名称>",
    "goal": "<项目目标>",
    "workspace": "file:///path/to/your/workspace"
  }'
```

### Step 3: 执行 Dispatch

使用上方模式 A 或模式 B 的命令。

### Step 4: 跟踪进度

```bash
// turbo
curl http://localhost:3000/api/agent-runs/<runId>
```

或在前端 **Projects / Agents** 面板查看（包含 Supervisor AI 实时审查状态）。


# 注意：
1、如果用户让你检查进度，你发现进度异常，你需要先检查为什么是进度异常。 
2、在没有用户允许的情况下，你不得随意的修改配置，重启任务，新建任务，除非用户明确让你这么做了。
3、你的目的是要检查进度异常的原因，并且把这个原因告诉用户，减少 bug。

4、模型的选择有：|---------------|----------|------|------|------|
| `MODEL_PLACEHOLDER_M37` | Gemini 3.1 Pro (High) | ✅ | ⭐ | Gemini 旗舰，支持 PDF/音频/视频 |
| `MODEL_PLACEHOLDER_M36` | Gemini 3.1 Pro (Low) | ✅ | ⭐ | Gemini 旗舰低配额版 |
| `MODEL_PLACEHOLDER_M47` | Gemini 3 Flash | ✅ | ⭐ | 快速模型，支持 PDF/音频/视频 |
| `MODEL_PLACEHOLDER_M35` | Claude Sonnet 4.6 (Thinking) | ✅ | ⭐ | Claude 思考模型 |
| `MODEL_PLACEHOLDER_M26` | Claude Opus 4.6 (Thinking) | ✅ | ⭐ | Claude 最强模型 |