import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import { createLogger } from '../logger';
import { upsertConversationProjection } from '../storage/gateway-db';
import { refreshOwnerMap } from './gateway';

const log = createLogger('ConversationImporter');

const CONVERSATIONS_DIR = path.join(homedir(), '.gemini', 'antigravity', 'conversations');
const BRAIN_DIR = path.join(homedir(), '.gemini', 'antigravity', 'brain');
const STATE_DB_PATH = path.join(
  homedir(),
  'Library/Application Support/Antigravity/User/globalStorage/state.vscdb',
);

type ImportedConversation = {
  id: string;
  title?: string;
  workspace?: string;
  stepCount?: number;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: string;
  mtimeMs?: number;
  sourceKind: string;
};

const globalForImporter = globalThis as unknown as {
  __AG_CONVERSATION_IMPORTER__?: {
    started: boolean;
    running: boolean;
    timer?: ReturnType<typeof setInterval>;
  };
};

const state = globalForImporter.__AG_CONVERSATION_IMPORTER__ || {
  started: false,
  running: false,
  timer: undefined as ReturnType<typeof setInterval> | undefined,
};

if (process.env.NODE_ENV !== 'production') {
  globalForImporter.__AG_CONVERSATION_IMPORTER__ = state;
}

function readHeadingFromMarkdown(filePath: string): string {
  if (!existsSync(filePath)) return '';
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n').slice(0, 8)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#')) {
        return trimmed.replace(/^#+\s*/, '').trim();
      }
      return trimmed;
    }
  } catch {
    return '';
  }
  return '';
}

function importFromPbDirectory(map: Map<string, ImportedConversation>): void {
  if (!existsSync(CONVERSATIONS_DIR)) return;
  for (const entry of readdirSync(CONVERSATIONS_DIR)) {
    if (!entry.endsWith('.pb')) continue;
    const id = entry.slice(0, -3);
    try {
      const stat = statSync(path.join(CONVERSATIONS_DIR, entry));
      const iso = stat.mtime.toISOString();
      const existing = map.get(id);
      map.set(id, {
        id,
        title: existing?.title,
        workspace: existing?.workspace,
        stepCount: existing?.stepCount,
        createdAt: existing?.createdAt || iso,
        updatedAt: iso,
        lastActivityAt: iso,
        mtimeMs: stat.mtimeMs,
        sourceKind: existing?.sourceKind || 'antigravity-pb',
      });
    } catch {
      continue;
    }
  }
}

function importFromBrainDirectory(map: Map<string, ImportedConversation>): void {
  if (!existsSync(BRAIN_DIR)) return;
  for (const entry of readdirSync(BRAIN_DIR)) {
    if (!entry.includes('-') || entry === 'tempmediaStorage') continue;
    const brainPath = path.join(BRAIN_DIR, entry);
    let stat;
    try {
      stat = statSync(brainPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const title = readHeadingFromMarkdown(path.join(brainPath, 'task.md'))
      || readHeadingFromMarkdown(path.join(brainPath, 'walkthrough.md'));
    const iso = stat.mtime.toISOString();
    const existing = map.get(entry);
    map.set(entry, {
      id: entry,
      title: title || existing?.title,
      workspace: existing?.workspace,
      stepCount: existing?.stepCount,
      createdAt: existing?.createdAt || iso,
      updatedAt: iso,
      lastActivityAt: existing?.lastActivityAt || iso,
      mtimeMs: Math.max(existing?.mtimeMs || 0, stat.mtimeMs),
      sourceKind: existing?.sourceKind || 'antigravity-brain',
    });
  }
}

function importFromStateDb(map: Map<string, ImportedConversation>): void {
  if (!existsSync(STATE_DB_PATH)) return;

  const script = `
import sqlite3, base64, json, os
try:
    import blackboxprotobuf
except Exception:
    print("[]")
    raise SystemExit(0)

db = sqlite3.connect(os.path.expanduser("~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb"))
raw = db.execute("SELECT value FROM ItemTable WHERE key='antigravityUnifiedStateSync.trajectorySummaries';").fetchone()
if not raw or not raw[0]:
    print("[]")
    raise SystemExit(0)

decoded = base64.b64decode(raw[0])
msg, _ = blackboxprotobuf.decode_message(decoded)
trajectories = msg.get("1", [])
if not isinstance(trajectories, list):
    trajectories = [trajectories]

result = []
for t in trajectories:
    cid = t.get("1", b"")
    if isinstance(cid, bytes):
        cid = cid.decode()
    else:
        cid = str(cid)

    title = ""
    workspace = ""
    step_count = 0

    inner = t.get("2", {})
    inner_b64 = inner.get("1", b"")
    if isinstance(inner_b64, bytes):
        inner_b64 = inner_b64.decode()

    try:
        ib = base64.b64decode(inner_b64)
        im, _ = blackboxprotobuf.decode_message(ib)
        rt = im.get("1", b"")
        if isinstance(rt, bytes):
            title = rt.decode("utf-8", errors="replace")
        else:
            title = str(rt)
        sc = im.get("2", 0)
        if isinstance(sc, (int, float)):
            step_count = int(sc)
        ws9 = im.get("9", {})
        ws17 = im.get("17", {})
        if isinstance(ws9, dict):
            w = ws9.get("1", b"")
            if isinstance(w, bytes):
                workspace = w.decode("utf-8", errors="replace")
            elif isinstance(w, dict):
                ww = w.get("1", b"")
                if isinstance(ww, bytes):
                    workspace = ww.decode("utf-8", errors="replace")
        if not workspace and isinstance(ws17, dict):
            w = ws17.get("7", b"")
            if isinstance(w, bytes):
                workspace = w.decode("utf-8", errors="replace")
            elif isinstance(w, str):
                workspace = w
            if not workspace:
                w1 = ws17.get("1", {})
                if isinstance(w1, dict):
                    ww = w1.get("1", b"")
                    if isinstance(ww, bytes):
                        workspace = ww.decode("utf-8", errors="replace")
    except Exception:
        pass
    result.append({"id": cid, "title": title, "workspace": workspace, "stepCount": step_count})
db.close()
print(json.dumps(result, ensure_ascii=False))
`;

  try {
    const output = spawnSync('python3', ['-c', script], {
      encoding: 'utf-8',
      timeout: 15_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const stdout = output.stdout?.trim();
    if (!stdout) return;
    const rows = JSON.parse(stdout) as Array<{
      id: string;
      title?: string;
      workspace?: string;
      stepCount?: number;
    }>;
    const now = new Date().toISOString();
    for (const row of rows) {
      if (!row.id) continue;
      const existing = map.get(row.id);
      map.set(row.id, {
        id: row.id,
        title: row.title || existing?.title,
        workspace: row.workspace || existing?.workspace,
        stepCount: Math.max(row.stepCount || 0, existing?.stepCount || 0),
        createdAt: existing?.createdAt,
        updatedAt: existing?.updatedAt || now,
        lastActivityAt: existing?.lastActivityAt || now,
        mtimeMs: existing?.mtimeMs,
        sourceKind: existing?.sourceKind || 'antigravity-state-db',
      });
    }
  } catch (error: unknown) {
    log.warn({ err: error instanceof Error ? error.message : String(error) }, 'State DB conversation import failed');
  }
}

export async function refreshConversationProjectionOnce(): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const imported = new Map<string, ImportedConversation>();
    importFromPbDirectory(imported);
    importFromStateDb(imported);
    importFromBrainDirectory(imported);

    for (const record of imported.values()) {
      upsertConversationProjection({
        id: record.id,
        title: record.title,
        workspace: record.workspace,
        stepCount: record.stepCount,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt || new Date().toISOString(),
        lastActivityAt: record.lastActivityAt,
        mtimeMs: record.mtimeMs,
        sourceKind: record.sourceKind,
      });
    }

    await refreshOwnerMap();
    log.info({ count: imported.size }, 'Conversation projection refreshed');
  } catch (error: unknown) {
    log.warn({ err: error instanceof Error ? error.message : String(error) }, 'Conversation projection refresh failed');
  } finally {
    state.running = false;
  }
}

export function startConversationProjectionWorker(options: { refreshMs?: number } = {}): void {
  if (state.started) return;
  state.started = true;
  const refreshMs = Math.max(options.refreshMs ?? 30_000, 10_000);
  void refreshConversationProjectionOnce();
  state.timer = setInterval(() => {
    void refreshConversationProjectionOnce();
  }, refreshMs);
}

export function stopConversationProjectionWorker(): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = undefined;
  }
  state.started = false;
}
