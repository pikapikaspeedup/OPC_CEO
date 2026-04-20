/**
 * Transcript Store (Session Persistence) Tests
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TranscriptStore,
  type TranscriptEntry,
} from '../transcript-store';
import type { APIMessage } from '../../api/types';

// ── Helpers ─────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'transcript-test-'));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function createStore(overrides = {}) {
  return new TranscriptStore({
    baseDir: testDir,
    flushIntervalMs: 0, // Immediate flush for tests
    ...overrides,
  });
}

// ── Session Lifecycle ───────────────────────────────────────────────

describe('TranscriptStore session lifecycle', () => {
  test('createSession returns a UUID', async () => {
    const store = createStore();
    const sessionId = await store.createSession();

    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    await store.close();
  });

  test('createSession with metadata persists to disk', async () => {
    const store = createStore();
    const sessionId = await store.createSession({ model: 'claude-sonnet', provider: 'anthropic' });
    await store.close();

    const filePath = join(testDir, `${sessionId}.jsonl`);
    const content = await readFile(filePath, 'utf-8');
    const entry = JSON.parse(content.trim());

    expect(entry.type).toBe('metadata');
    expect(entry.meta.model).toBe('claude-sonnet');
    expect(entry.meta.provider).toBe('anthropic');
  });

  test('deleteSession removes the file', async () => {
    const store = createStore();
    const sessionId = await store.createSession({ test: true });
    await store.close();

    const deleted = await store.deleteSession(sessionId);
    expect(deleted).toBe(true);

    // Verify file is gone
    const files = await readdir(testDir);
    expect(files).not.toContain(`${sessionId}.jsonl`);
  });

  test('deleteSession returns false for non-existent session', async () => {
    const store = createStore();
    const deleted = await store.deleteSession('non-existent-id');
    expect(deleted).toBe(false);
    await store.close();
  });
});

// ── Message Persistence ─────────────────────────────────────────────

describe('TranscriptStore message persistence', () => {
  test('appendMessage writes a JSONL entry', async () => {
    const store = createStore();
    const sessionId = await store.createSession({ init: true });

    const message: APIMessage = { role: 'user', content: 'Hello' };
    const uuid = await store.appendMessage(sessionId, message);
    await store.close();

    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);

    const filePath = join(testDir, `${sessionId}.jsonl`);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    // metadata (from createSession with meta) + user message
    expect(lines.length).toBe(2);

    const entry = JSON.parse(lines[1]!);
    expect(entry.type).toBe('user');
    expect(entry.message.content).toBe('Hello');
    expect(entry.sessionId).toBe(sessionId);
    expect(entry.parentUuid).toBeNull();
  });

  test('appendMessageChain links messages with parentUuid', async () => {
    const store = createStore();
    const sessionId = await store.createSession();

    const messages: APIMessage[] = [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' },
      { role: 'user', content: 'What about 3+3?' },
      { role: 'assistant', content: '6' },
    ];

    const uuids = await store.appendMessageChain(sessionId, messages);
    await store.close();

    expect(uuids).toHaveLength(4);

    // Verify chain linkage
    const filePath = join(testDir, `${sessionId}.jsonl`);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    // 4 messages (no metadata from createSession without args)
    expect(lines.length).toBe(4);

    const entries = lines.map(l => JSON.parse(l)) as TranscriptEntry[];

    // First message has null parent
    expect(entries[0]!.parentUuid).toBeNull();
    // Each subsequent message points to the previous
    expect(entries[1]!.parentUuid).toBe(entries[0]!.uuid);
    expect(entries[2]!.parentUuid).toBe(entries[1]!.uuid);
    expect(entries[3]!.parentUuid).toBe(entries[2]!.uuid);
  });

  test('appendSummary creates a summary entry', async () => {
    const store = createStore();
    const sessionId = await store.createSession();

    const uuid = await store.appendMessage(sessionId, { role: 'user', content: 'Hi' });
    await store.appendSummary(sessionId, 'User greeted the assistant', uuid);
    await store.close();

    const filePath = join(testDir, `${sessionId}.jsonl`);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const lastEntry = JSON.parse(lines[lines.length - 1]!);

    expect(lastEntry.type).toBe('summary');
    expect(lastEntry.summaryText).toBe('User greeted the assistant');
    expect(lastEntry.parentUuid).toBe(uuid);
  });
});

// ── Load Session ────────────────────────────────────────────────────

describe('TranscriptStore loadSession', () => {
  test('loads all entries from a session', async () => {
    const store = createStore();
    const sessionId = await store.createSession();

    await store.appendMessage(sessionId, { role: 'user', content: 'Hello' });
    await store.appendMessage(sessionId, { role: 'assistant', content: 'World' });
    await store.close();

    const session = await store.loadSession(sessionId);

    expect(session).not.toBeNull();
    expect(session!.sessionId).toBe(sessionId);
    expect(session!.messages).toHaveLength(2);
    expect(session!.messages[0]!.role).toBe('user');
    expect(session!.messages[1]!.role).toBe('assistant');
    expect(session!.entries.length).toBeGreaterThanOrEqual(2); // 2 messages (no metadata when createSession has no args)
  });

  test('returns null for non-existent session', async () => {
    const store = createStore();
    const session = await store.loadSession('non-existent');
    expect(session).toBeNull();
    await store.close();
  });

  test('accumulates metadata from multiple entries', async () => {
    const store = createStore();
    const sessionId = await store.createSession({ model: 'opus' });
    await store.appendMetadata(sessionId, { temperature: 0.7 });
    await store.close();

    const session = await store.loadSession(sessionId);

    expect(session!.metadata).toEqual(
      expect.objectContaining({
        model: 'opus',
        temperature: 0.7,
      }),
    );
  });

  test('throws for oversized session files', async () => {
    const store = createStore({ maxFileSizeBytes: 100 });
    const sessionId = await store.createSession();

    // Write enough data to exceed the limit
    const bigContent = 'x'.repeat(200);
    await store.appendMessage(sessionId, { role: 'user', content: bigContent });
    await store.close();

    await expect(store.loadSession(sessionId)).rejects.toThrow('too large');
  });
});

// ── Load Messages for Resume ────────────────────────────────────────

describe('TranscriptStore loadMessagesForResume', () => {
  test('loads messages in chain order', async () => {
    const store = createStore();
    const sessionId = await store.createSession();

    await store.appendMessageChain(sessionId, [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Response 1' },
      { role: 'user', content: 'Second' },
      { role: 'assistant', content: 'Response 2' },
    ]);
    await store.close();

    const messages = await store.loadMessagesForResume(sessionId);

    expect(messages).toHaveLength(4);
    expect(messages[0]!.content).toBe('First');
    expect(messages[1]!.content).toBe('Response 1');
    expect(messages[2]!.content).toBe('Second');
    expect(messages[3]!.content).toBe('Response 2');
  });

  test('returns empty for non-existent session', async () => {
    const store = createStore();
    const messages = await store.loadMessagesForResume('non-existent');
    expect(messages).toEqual([]);
    await store.close();
  });

  test('filters unresolved tool_use from last assistant message', async () => {
    const store = createStore();
    const sessionId = await store.createSession();

    // User message
    const userUuid = await store.appendMessage(sessionId, {
      role: 'user',
      content: 'Search for files',
    });

    // Assistant with unresolved tool_use (no matching tool_result)
    await store.appendMessage(
      sessionId,
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me search...' },
          { type: 'tool_use', id: 'tc_1', name: 'GlobTool', input: { pattern: '*.ts' } },
        ],
      },
      userUuid,
    );
    await store.close();

    const messages = await store.loadMessagesForResume(sessionId);

    // Should have user + filtered assistant (tool_use removed)
    expect(messages).toHaveLength(2);
    const lastMsg = messages[1]!;
    expect(Array.isArray(lastMsg.content)).toBe(true);
    const blocks = lastMsg.content as Array<{ type: string }>;
    // Only text remains, tool_use filtered out
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('text');
  });

  test('keeps resolved tool_use in messages', async () => {
    const store = createStore();
    const sessionId = await store.createSession();

    await store.appendMessageChain(sessionId, [
      { role: 'user', content: 'Search' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Searching...' },
          { type: 'tool_use', id: 'tc_1', name: 'GlobTool', input: { pattern: '*.ts' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tc_1', content: 'file1.ts\nfile2.ts' },
        ],
      },
      { role: 'assistant', content: 'Found 2 files.' },
    ]);
    await store.close();

    const messages = await store.loadMessagesForResume(sessionId);

    expect(messages).toHaveLength(4);
    // The middle assistant message should keep tool_use since it has a result
    const assistantMsg = messages[1]!;
    expect(Array.isArray(assistantMsg.content)).toBe(true);
    const blocks = assistantMsg.content as Array<{ type: string }>;
    expect(blocks).toHaveLength(2); // text + tool_use (resolved)
  });
});

// ── List Sessions ───────────────────────────────────────────────────

describe('TranscriptStore listSessions', () => {
  test('lists all sessions sorted by most recent', async () => {
    const store = createStore();

    const id1 = await store.createSession();
    await store.appendMessage(id1, { role: 'user', content: 'Session 1' });

    // Small delay to ensure different timestamps
    await new Promise(r => setTimeout(r, 10));

    const id2 = await store.createSession();
    await store.appendMessage(id2, { role: 'user', content: 'Session 2' });
    await store.close();

    const sessions = await store.listSessions();

    expect(sessions).toHaveLength(2);
    // Most recent first
    expect(sessions[0]!.sessionId).toBe(id2);
    expect(sessions[1]!.sessionId).toBe(id1);
  });

  test('includes preview from first user message', async () => {
    const store = createStore();
    const sessionId = await store.createSession();
    await store.appendMessage(sessionId, { role: 'user', content: 'Write a function to sort arrays' });
    await store.close();

    const sessions = await store.listSessions();
    expect(sessions[0]!.preview).toBe('Write a function to sort arrays');
  });

  test('counts messages correctly', async () => {
    const store = createStore();
    const sessionId = await store.createSession();
    await store.appendMessageChain(sessionId, [
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
    ]);
    await store.close();

    const sessions = await store.listSessions();
    expect(sessions[0]!.messageCount).toBe(3);
  });

  test('returns empty array when no sessions', async () => {
    const store = createStore();
    const sessions = await store.listSessions();
    expect(sessions).toEqual([]);
    await store.close();
  });
});

// ── Disabled Store ──────────────────────────────────────────────────

describe('TranscriptStore disabled mode', () => {
  test('appendMessage does nothing when disabled', async () => {
    const store = createStore({ disabled: true });

    expect(store.isDisabled()).toBe(true);

    // Should not throw
    await store.appendEntry({
      type: 'user',
      uuid: 'test',
      parentUuid: null,
      sessionId: 'test',
      timestamp: new Date().toISOString(),
      cwd: '/tmp',
      message: { role: 'user', content: 'ignored' },
    });

    await store.close();

    // No files should be created
    const files = await readdir(testDir);
    expect(files).toHaveLength(0);
  });
});

// ── Project-scoped Sessions ─────────────────────────────────────────

describe('TranscriptStore project scoping', () => {
  test('uses project subdirectory when projectId is set', async () => {
    const store = new TranscriptStore({
      baseDir: testDir,
      projectId: 'my-project',
      flushIntervalMs: 0,
    });

    const sessionId = await store.createSession();
    await store.appendMessage(sessionId, { role: 'user', content: 'Hello' });
    await store.close();

    const expectedDir = join(testDir, 'my-project');
    const files = await readdir(expectedDir);
    expect(files).toContain(`${sessionId}.jsonl`);
  });

  test('sanitizes projectId for filesystem safety', async () => {
    const store = new TranscriptStore({
      baseDir: testDir,
      projectId: '/Users/darrel/my project (v2)',
      flushIntervalMs: 0,
    });

    // Should not throw
    const sessionId = await store.createSession();
    await store.close();

    // Directory should exist with sanitized name
    const baseDir = store.getBaseDir();
    expect(baseDir).not.toContain(' ');
    expect(baseDir).not.toContain('(');
  });
});

// ── JSONL Format Validation ─────────────────────────────────────────

describe('TranscriptStore JSONL format', () => {
  test('each line is valid JSON', async () => {
    const store = createStore();
    const sessionId = await store.createSession();
    await store.appendMessageChain(sessionId, [
      { role: 'user', content: 'Hello\nworld' },
      { role: 'assistant', content: 'Hi "there"' },
    ]);
    await store.close();

    const filePath = join(testDir, `${sessionId}.jsonl`);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test('entries contain required fields', async () => {
    const store = createStore();
    const sessionId = await store.createSession();
    await store.appendMessage(sessionId, { role: 'user', content: 'Test' });
    await store.close();

    const filePath = join(testDir, `${sessionId}.jsonl`);
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const messageEntry = JSON.parse(lines[0]!); // First line is the user message (no meta)

    expect(messageEntry).toHaveProperty('type');
    expect(messageEntry).toHaveProperty('uuid');
    expect(messageEntry).toHaveProperty('sessionId');
    expect(messageEntry).toHaveProperty('timestamp');
    expect(messageEntry).toHaveProperty('cwd');
    expect(messageEntry).toHaveProperty('message');
  });
});
