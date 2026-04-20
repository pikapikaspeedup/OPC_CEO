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
├── metadata.json       ← {title, summary, references[]}
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
- `limit`：可选，限制返回数量

**Response**: `KnowledgeItem[]` sorted by last accessed / modified (most recent first)

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
    "status": "active"
  }
]
```

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
- List all KIs with title, summary, artifact count, and last access time
- Click any KI to view details: metadata, timestamps, references, artifacts
- Click title or summary to inline-edit and save
- Click any artifact file to open full-screen markdown editor
- Delete KIs with confirmation dialog

**Responsive**: Works on both desktop and mobile (full-screen overlay).
