# Knowledge Management API

Knowledge Items (KI) are Antigravity's persistent knowledge base.

当前实现采用双轨持久化：

1. **结构化主存储**：`storage.sqlite` 中的 `knowledge_assets` 表
2. **兼容镜像目录**：`~/.gemini/antigravity/knowledge/`

这样可以同时满足：

- 后端结构化检索与回流
- 现有 Knowledge 面板 / artifact 编辑器 的文件兼容性

## Data Structure

```
knowledge/{ki_id}/
├── metadata.json       ← {title, summary, references[], tags[], source*, ...}
├── timestamps.json     ← {created, modified, accessed}
└── artifacts/          ← Markdown knowledge files
    ├── overview.md
    └── features/
        └── some_topic.md
```

KIs 当前主要由以下链路自动生成：

- prompt/workflow run 结束后的结构化知识提取
- advisory/delivery run 完成后的知识沉淀

后续执行前，系统会优先从结构化知识资产中检索相关上下文。

---

## API Endpoints

### List All Knowledge Items

```
GET /api/knowledge
```

**Query Params**:

- `workspace`：可选，按 workspace URI 过滤
- `category`：可选，按知识分类过滤
- `status`：可选，按知识状态过滤
- `scope`：可选，按 `department / organization` 过滤
- `tag`：可选，按单个标签过滤
- `q`：可选，按标题 / 摘要 / 标签 / 来源 / workspace 模糊搜索
- `sort`：可选，`recent / created / updated / alpha / reuse`
- `limit`：可选，限制返回数量

**Response**: `KnowledgeItem[]`

```json
[
  {
    "id": "aitrend_frontend",
    "title": "AI Trend Frontend Project",
    "summary": "Comprehensive knowledge item...",
    "references": [
      { "type": "workspace", "value": "/path/to/project" },
      { "type": "url", "value": "https://example.com" },
      { "type": "conversation_id", "value": "uuid" }
    ],
    "timestamps": {
      "created": "2026-03-08T23:44:01Z",
      "modified": "2026-03-09T00:27:20Z",
      "accessed": "2026-03-20T14:32:15Z"
    },
    "artifactFiles": ["overview.md", "features/detail.md"],
    "workspaceUri": "file:///path/to/project",
    "category": "decision",
    "status": "active",
    "tags": ["frontend", "decision"],
    "scope": "department",
    "sourceType": "run",
    "sourceRunId": "run-123",
    "confidence": 0.93,
    "evidenceCount": 2,
    "promotionLevel": "l2-fact"
  }
]
```

---

### Create Knowledge Item

```
POST /api/knowledge
Content-Type: application/json
```

**Body** (all fields optional):

```json
{
  "title": "Manual note",
  "summary": "Short summary",
  "content": "# Manual note\n\nBody",
  "workspaceUri": "file:///path/to/project",
  "category": "domain-knowledge",
  "tags": ["manual", "draft"]
}
```

**行为**:

- 创建 `manual` source 的结构化 `KnowledgeAsset`
- 同步写入 filesystem mirror
- 默认 artifact 为 `content.md`

**Response**: `201 Created`，返回新建后的 `KnowledgeDetail`

---

### Get Knowledge Item Detail

```
GET /api/knowledge/:id
```

Returns full KI with all artifact file contents.

**Response**: `KnowledgeDetail` (extends `KnowledgeItem`)

```json
{
  "id": "aitrend_frontend",
  "title": "AI Trend Frontend Project",
  "summary": "...",
  "references": [...],
  "timestamps": {...},
  "artifactFiles": ["overview.md"],
  "tags": ["frontend", "decision"],
  "scope": "department",
  "sourceType": "run",
  "sourceRunId": "run-123",
  "confidence": 0.93,
  "evidenceCount": 2,
  "artifacts": {
    "overview.md": "# Full markdown content..."
  }
}
```

---

### Update Knowledge Item Metadata

```
PUT /api/knowledge/:id
Content-Type: application/json
```

**Body** (all fields optional):

```json
{
  "title": "New Title",
  "summary": "Updated summary"
}
```

**Response**: `{ "ok": true, "title": "...", "summary": "..." }`

对于结构化知识资产：

- 会同步更新 SQLite 中对应的 `KnowledgeAsset`
- 并更新文件镜像的 `metadata.json`

对于旧版 filesystem-only 知识条目：

- 仍按旧逻辑直接更新镜像文件

---

### Generate AI Summary

```
POST /api/knowledge/:id/summary
```

**功能**:

- 读取指定 Knowledge 条目
- 通过 `resolveProvider('knowledge-summary', workspacePath)` 解析当前 provider/model
- 调用统一 provider transport 生成结构化摘要
- 将结果回写到 Knowledge metadata 的 `summary`

**Response**:

```json
{
  "ok": true,
  "summary": "本文适合用于判断 AI 从单点模型竞争转向 Agent 系统落地的行业趋势。",
  "provider": "native-codex",
  "model": "gpt-5.4",
  "source": "department",
  "scene": "knowledge-summary"
}
```

说明：

- `provider` / `model` 来自当前组织级 provider routing，而不是 Knowledge 自己维护第二套配置。
- 若当前 scene/provider 未配置，接口会返回错误，不再伪造摘要结果。

---

### Delete Knowledge Item

```
DELETE /api/knowledge/:id
```

**Response**: `{ "ok": true, "deleted": "ki_id" }`

⚠️ **Permanently deletes**:

- SQLite 中的结构化知识资产（如果存在）
- 对应的 knowledge 镜像目录及 artifacts

This cannot be undone.

---

### Get Artifact Content

```
GET /api/knowledge/:id/artifacts/:path
```

`:path` supports nested paths (e.g., `features/detail.md`).

**Response**: `{ "path": "overview.md", "content": "# Markdown..." }`

---

### Update Artifact Content

```
PUT /api/knowledge/:id/artifacts/:path
Content-Type: application/json
```

**Body**:

```json
{
  "content": "# Updated markdown content..."
}
```

**Response**: `{ "ok": true, "path": "overview.md" }`

Creates parent directories if needed. Updates `timestamps.modified`.

当更新的是结构化知识资产对应的 `content.md` 时：

- 会同步回写 SQLite 中的 `KnowledgeAsset.content`

---

## Frontend

The Knowledge panel is accessible from the sidebar's **KI** tab.

**Features**:
- 默认进入 browse-first 工作台：目录 / 列表 / 正文 / 右侧上下文栏
- 支持浏览态与治理态切换；治理态保留候选记忆、增长提案和部门记忆
- 顶部支持知识搜索与手动新建知识项
- 点击任意 KI 可查看详情：metadata、references、projects、timeline、artifacts
- 详情页支持 `AI 摘要`，直接复用 `knowledge-summary` scene 调用当前 provider
- 支持标题、摘要、artifact Markdown 编辑与保存
- 删除 KI 时带确认弹窗

**Responsive**: Works on both desktop and mobile (full-screen overlay).
