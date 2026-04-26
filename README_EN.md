# Antigravity Gateway

> Turn Antigravity into a remotely accessible gateway platform with provider routing, agent orchestration, and a split backend runtime.

**[中文文档 →](README.md)**

---

## What It Is

From the product view, this is still:

1. one frontend
2. one Gateway backend

From the deployment view, the system runs as two same-device services:

| Service | Responsibility |
|------|----------------|
| `opc-web` | page rendering, browser entry, HTTP API proxy |
| `opc-api` | projects, CEO, departments, approvals, settings, conversations, runs, models, workspaces, optional scheduler work |

The backend still keeps internal control-plane / runtime / scheduler module boundaries, but those are not the default deployment concepts.

---

## Current Capabilities

- Web UI for Home, CEO Office, Settings, Projects, Conversations, Knowledge, and Operations
- Conversation shell for both Antigravity conversations and local-provider conversations
- Multi-provider routing:
  `antigravity`, `codex`, `native-codex`, `claude-api`, `openai-api`, `gemini-api`, `grok-api`, `custom`
- Public orchestration contract is now `templateId + stageId`
- Projects, approvals, departments, scheduler, deliverables, journal
- MCP Server, CLI, WeChat, Obsidian integrations
- Paginated list APIs for conversations, projects, runs, scheduler jobs, and other heavy collections

---

## Quick Start

### Prerequisites

- Node.js 20+
- macOS Apple Silicon is the primary supported environment
- If you want the `antigravity` provider path, Antigravity should be installed, logged in, and have at least one workspace opened

### Default Local Start

```bash
git clone https://github.com/pikapikaspeedup/Antigravity-Mobility-CLI.git
cd Antigravity-Mobility-CLI

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The default dev flow starts two services on the same machine:

1. `opc-api`: `http://127.0.0.1:3101`
2. `opc-web`: `http://127.0.0.1:3000`

The backend stays on the host machine so it can access Antigravity IDE, Language Server, local workspaces, `~/.gemini`, and SQLite. `opc-api` owns the cron scheduler by default, so recurring jobs such as the AI digest run on schedule. The bridge worker and scheduler companion background services stay disabled by default to avoid fan-out/approval/consumer recovery noise and CPU amplification.

### Separate Start

```bash
npm run dev:api
npm run dev:web
```

For same-device production:

```bash
npm run start:api
npm run start:web
```

### Optional Desktop Shell

When native macOS folder selection is required, open the Tauri desktop shell on top of the default local services:

```bash
npm run dev
npm run desktop:dev
```

`desktop:dev` only opens the desktop WebView and loads `http://127.0.0.1:3000`; it does not start another Node backend. The current desktop shell is mainly used by CEO Office department creation to pick a local folder. The import still goes through `/api/workspaces/import` and does not automatically launch Antigravity or a Language Server.

Docker is not the recommended default deployment path because this project is deeply coupled to the host filesystem, Antigravity IDE, Language Server, workspaces, and local state. Docker can be added later as an advanced option.

---

## Basic Verification

```bash
curl http://localhost:3000/api/me
curl http://localhost:3000/api/models
curl "http://localhost:3000/api/workspaces?page=1&pageSize=20"
curl "http://localhost:3000/api/conversations?page=1&pageSize=20"
curl "http://localhost:3000/api/agent-runs?page=1&pageSize=20"
curl "http://localhost:3000/api/projects?page=1&pageSize=20"
```

---

## Common Examples

### Create a Conversation

```bash
CID=$(curl -sX POST http://localhost:3000/api/conversations \
  -H 'Content-Type: application/json' \
  -d '{"workspace":"file:///path/to/project"}' | jq -r .cascadeId)

curl -sX POST "http://localhost:3000/api/conversations/$CID/send" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Explain the architecture of this project"}'
```

### Dispatch a Run

```bash
curl -X POST http://localhost:3000/api/agent-runs \
  -H 'Content-Type: application/json' \
  -d '{
    "templateId": "coding-basic-template",
    "workspace": "file:///path/to/project",
    "prompt": "Fix the login token refresh bug"
  }'
```

---

## Runtime Data Directory

Main runtime state lives under `~/.gemini/antigravity/gateway/`:

| Path | Purpose |
|------|---------|
| `storage.sqlite` | main SQLite database |
| `assets/templates/` | templates |
| `assets/workflows/` | workflows |
| `runs/` | run histories and artifacts |
| `projects/` | project state, journal, checkpoints |

---

## Documentation Map

- [ARCHITECTURE.md](ARCHITECTURE.md): current system architecture and split-role boundaries
- [docs/guide/agent-user-guide.md](docs/guide/agent-user-guide.md): agent, template, stage, and department guide
- [docs/guide/gateway-api.md](docs/guide/gateway-api.md): public API reference
- [docs/guide/cli-api-reference.md](docs/guide/cli-api-reference.md): orchestration API reference
- [docs/guide/mcp-server.md](docs/guide/mcp-server.md): MCP Server usage
- [docs/guide/remote-access.md](docs/guide/remote-access.md): Cloudflare Tunnel setup
- [docs/README.md](docs/README.md): full documentation index

---

## Compatibility Notes

- Split mode does not change the public API surface; it only separates backend roles internally
- The Antigravity compatibility path remains non-invasive: no writes to `state.vscdb`, no deletion of IDE-owned `.pb` or `brain` files
- In split mode, `web` is intentionally just the shell and ingress layer

---

## Disclaimer

This is an unofficial interoperability project:

- it does not bypass paywalls or authentication
- it depends on a legitimate local Antigravity installation
- it is not affiliated with or endorsed by Google DeepMind

## License

MIT
