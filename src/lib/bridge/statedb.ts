import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import path from 'path';
import {
  findConversationRecordBySessionHandle as findStoredConversationRecordBySessionHandle,
  getConversationProjectionById,
  getConversationRecordById as getStoredConversationRecordById,
  listConversationProjections,
  LocalConversationRecord,
  upsertConversationRecord,
} from '../storage/gateway-db';

const STATE_DB_PATH = path.join(
  homedir(),
  'Library/Application Support/Antigravity/User/globalStorage/state.vscdb'
);

export interface ConversationInfo extends LocalConversationRecord {
  id: string;
  title: string;
  workspace: string;
  stepCount: number;
  createdAt?: string;
}

export function addLocalConversation(
  id: string,
  workspace: string,
  title: string = 'New conversation',
  extras: Partial<LocalConversationRecord> = {},
) {
  if (getConversationRecord(id)) return;
  upsertConversationRecord({
    id,
    title,
    workspace,
    stepCount: 0,
    createdAt: new Date().toISOString(),
    ...extras,
  });
}

export function updateLocalConversationTitle(id: string, title: string) {
  const conv = getConversationRecord(id);
  if (conv) {
    upsertConversationRecord({
      ...conv,
      title,
    });
  }
}

export function getConversationRecord(id: string): ConversationInfo | null {
  return getConversationProjectionById(id) ?? getStoredConversationRecordById(id);
}

export function findConversationRecordBySessionHandle(sessionHandle: string): ConversationInfo | null {
  return findStoredConversationRecordBySessionHandle(sessionHandle);
}

export function resolveConversationRecord(idOrHandle: string): ConversationInfo | null {
  return getConversationRecord(idOrHandle) ?? findConversationRecordBySessionHandle(idOrHandle);
}

function normalizeConversationTitle(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Conversation';
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

export function ensureConversationRecordForSession(input: {
  sessionHandle: string;
  workspace: string;
  title: string;
  provider?: LocalConversationRecord['provider'];
  stepCount?: number;
}): ConversationInfo {
  const existing = findConversationRecordBySessionHandle(input.sessionHandle);
  const nextTitle = normalizeConversationTitle(input.title);
  const nextStepCount = input.stepCount ?? existing?.stepCount ?? 0;

  if (existing) {
    const next: ConversationInfo = {
      ...existing,
      title: nextTitle || existing.title,
      workspace: input.workspace || existing.workspace,
      provider: input.provider || existing.provider,
      sessionHandle: input.sessionHandle,
      stepCount: Math.max(existing.stepCount || 0, nextStepCount),
    };
    upsertConversationRecord(next);
    return next;
  }

  const created: ConversationInfo = {
    id: `conversation-${randomUUID()}`,
    title: nextTitle,
    workspace: input.workspace,
    stepCount: nextStepCount,
    createdAt: new Date().toISOString(),
    provider: input.provider,
    sessionHandle: input.sessionHandle,
  };
  upsertConversationRecord(created);
  return created;
}

export function updateLocalConversation(id: string, patch: Partial<LocalConversationRecord>): ConversationInfo | null {
  const existing = getConversationRecord(id);
  if (!existing) return null;

  const next: ConversationInfo = {
    ...existing,
    ...patch,
    id: existing.id,
  };
  upsertConversationRecord(next);
  return next;
}

function queryDb(sql: string): string {
  try {
    return execSync(
      `sqlite3 "${STATE_DB_PATH}" ${escapeShellArg(sql)}`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
  } catch {
    return '';
  }
}

/** Escape a string for safe use as a single shell argument */
function escapeShellArg(arg: string): string {
  // Wrap in single quotes, escape any embedded single quotes
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

export function getApiKey(): string {
  const raw = queryDb("SELECT value FROM ItemTable WHERE key='antigravityAuthStatus';");
  if (!raw) return '';
  try { return JSON.parse(raw).apiKey || ''; } catch { return ''; }
}

export function getUserInfo(): { name: string; email: string; apiKey: string } {
  const raw = queryDb("SELECT value FROM ItemTable WHERE key='antigravityAuthStatus';");
  if (!raw) return { name: '', email: '', apiKey: '' };
  try {
    const data = JSON.parse(raw);
    return { name: data.name || '', email: data.email || '', apiKey: data.apiKey || '' };
  } catch { return { name: '', email: '', apiKey: '' }; }
}

export function getWorkspaces(): Array<{ type: 'folder' | 'workspace'; uri: string }> {
  const raw = queryDb("SELECT value FROM ItemTable WHERE key='history.recentlyOpenedPathsList';");
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return (data.entries || []).map((e: any) => {
      if (e.folderUri) return { type: 'folder' as const, uri: e.folderUri };
      if (e.workspace) return { type: 'workspace' as const, uri: e.workspace.configPath };
      return null;
    }).filter(Boolean);
  } catch { return []; }
}

export function getPlaygrounds(): string[] {
  const playgroundDir = path.join(homedir(), '.gemini/antigravity/playground');
  try {
    const output = execSync(`ls -1 "${playgroundDir}" 2>/dev/null`, { encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean).map(name =>
      `file://${path.join(playgroundDir, name)}`
    );
  } catch { return []; }
}

export function getConversations(): ConversationInfo[] {
  return listConversationProjections().map((record) => ({
    id: record.id,
    title: record.title,
    workspace: record.workspace,
    stepCount: record.stepCount,
    createdAt: record.createdAt,
    provider: record.provider,
    sessionHandle: record.sessionHandle,
  }));
}
