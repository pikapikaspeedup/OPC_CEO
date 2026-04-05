import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const TEST_HOME = path.join(import.meta.dirname ?? __dirname, '__test_journal_home__');

vi.mock('./gateway-home', () => ({
  GATEWAY_HOME: path.join(import.meta.dirname ?? __dirname, '__test_journal_home__'),
}));

import {
  appendJournalEntry,
  queryJournal,
  getNodeJournal,
} from './execution-journal';

beforeEach(() => {
  const projDir = path.join(TEST_HOME, 'projects');
  if (fs.existsSync(projDir)) {
    fs.rmSync(projDir, { recursive: true });
  }
});

afterEach(() => {
  if (fs.existsSync(TEST_HOME)) {
    fs.rmSync(TEST_HOME, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// appendJournalEntry
// ---------------------------------------------------------------------------

describe('appendJournalEntry', () => {
  it('creates project directory and journal file', () => {
    const entry = appendJournalEntry({
      projectId: 'p-1',
      nodeId: 'dev',
      nodeKind: 'stage',
      eventType: 'node:activated',
      details: { reason: 'upstream completed' },
    });

    expect(entry.entryId).toMatch(/^je-/);
    expect(entry.timestamp).toBeTruthy();
    expect(entry.projectId).toBe('p-1');
    expect(entry.nodeId).toBe('dev');
    expect(entry.eventType).toBe('node:activated');

    const fp = path.join(TEST_HOME, 'projects', 'p-1', 'journal.jsonl');
    expect(fs.existsSync(fp)).toBe(true);

    const raw = fs.readFileSync(fp, 'utf-8').trim();
    const parsed = JSON.parse(raw);
    expect(parsed.entryId).toBe(entry.entryId);
  });

  it('appends multiple entries to the same file', () => {
    appendJournalEntry({
      projectId: 'p-1',
      nodeId: 'dev',
      nodeKind: 'stage',
      eventType: 'node:activated',
      details: {},
    });
    appendJournalEntry({
      projectId: 'p-1',
      nodeId: 'dev',
      nodeKind: 'stage',
      eventType: 'node:completed',
      details: { elapsed: 1234 },
    });

    const fp = path.join(TEST_HOME, 'projects', 'p-1', 'journal.jsonl');
    const lines = fs.readFileSync(fp, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('generates unique entry IDs', () => {
    const e1 = appendJournalEntry({
      projectId: 'p-1',
      nodeId: 'a',
      nodeKind: 'stage',
      eventType: 'node:activated',
      details: {},
    });
    const e2 = appendJournalEntry({
      projectId: 'p-1',
      nodeId: 'b',
      nodeKind: 'gate',
      eventType: 'gate:decided',
      details: {},
    });

    expect(e1.entryId).not.toBe(e2.entryId);
  });
});

// ---------------------------------------------------------------------------
// queryJournal
// ---------------------------------------------------------------------------

describe('queryJournal', () => {
  it('returns empty array for non-existent project', () => {
    expect(queryJournal('nonexistent')).toEqual([]);
  });

  it('returns all entries in chronological order', () => {
    appendJournalEntry({ projectId: 'p-1', nodeId: 'a', nodeKind: 'stage', eventType: 'node:activated', details: {} });
    appendJournalEntry({ projectId: 'p-1', nodeId: 'b', nodeKind: 'stage', eventType: 'node:activated', details: {} });
    appendJournalEntry({ projectId: 'p-1', nodeId: 'a', nodeKind: 'stage', eventType: 'node:completed', details: {} });

    const entries = queryJournal('p-1');
    expect(entries).toHaveLength(3);
    expect(entries[0].nodeId).toBe('a');
    expect(entries[0].eventType).toBe('node:activated');
    expect(entries[2].nodeId).toBe('a');
    expect(entries[2].eventType).toBe('node:completed');
  });

  it('filters by nodeId', () => {
    appendJournalEntry({ projectId: 'p-1', nodeId: 'a', nodeKind: 'stage', eventType: 'node:activated', details: {} });
    appendJournalEntry({ projectId: 'p-1', nodeId: 'b', nodeKind: 'gate', eventType: 'gate:decided', details: {} });
    appendJournalEntry({ projectId: 'p-1', nodeId: 'a', nodeKind: 'stage', eventType: 'node:completed', details: {} });

    const entries = queryJournal('p-1', { nodeId: 'a' });
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.nodeId === 'a')).toBe(true);
  });

  it('filters by eventType', () => {
    appendJournalEntry({ projectId: 'p-1', nodeId: 'a', nodeKind: 'stage', eventType: 'node:activated', details: {} });
    appendJournalEntry({ projectId: 'p-1', nodeId: 'b', nodeKind: 'stage', eventType: 'node:completed', details: {} });
    appendJournalEntry({ projectId: 'p-1', nodeId: 'c', nodeKind: 'gate', eventType: 'node:activated', details: {} });

    const entries = queryJournal('p-1', { eventType: 'node:activated' });
    expect(entries).toHaveLength(2);
  });

  it('respects limit option', () => {
    for (let i = 0; i < 10; i++) {
      appendJournalEntry({ projectId: 'p-1', nodeId: `n-${i}`, nodeKind: 'stage', eventType: 'node:activated', details: {} });
    }

    const entries = queryJournal('p-1', { limit: 3 });
    expect(entries).toHaveLength(3);
    // Should return the LAST 3 entries (most recent)
    expect(entries[0].nodeId).toBe('n-7');
    expect(entries[2].nodeId).toBe('n-9');
  });

  it('combines nodeId and eventType filters', () => {
    appendJournalEntry({ projectId: 'p-1', nodeId: 'a', nodeKind: 'stage', eventType: 'node:activated', details: {} });
    appendJournalEntry({ projectId: 'p-1', nodeId: 'a', nodeKind: 'stage', eventType: 'node:completed', details: {} });
    appendJournalEntry({ projectId: 'p-1', nodeId: 'b', nodeKind: 'stage', eventType: 'node:activated', details: {} });

    const entries = queryJournal('p-1', { nodeId: 'a', eventType: 'node:completed' });
    expect(entries).toHaveLength(1);
    expect(entries[0].nodeId).toBe('a');
    expect(entries[0].eventType).toBe('node:completed');
  });
});

// ---------------------------------------------------------------------------
// getNodeJournal
// ---------------------------------------------------------------------------

describe('getNodeJournal', () => {
  it('returns only entries for the specified node', () => {
    appendJournalEntry({ projectId: 'p-1', nodeId: 'dev', nodeKind: 'stage', eventType: 'node:activated', details: {} });
    appendJournalEntry({ projectId: 'p-1', nodeId: 'review', nodeKind: 'stage', eventType: 'node:activated', details: {} });
    appendJournalEntry({ projectId: 'p-1', nodeId: 'dev', nodeKind: 'stage', eventType: 'node:completed', details: {} });

    const entries = getNodeJournal('p-1', 'dev');
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.nodeId === 'dev')).toBe(true);
  });

  it('returns empty array for unknown node', () => {
    appendJournalEntry({ projectId: 'p-1', nodeId: 'dev', nodeKind: 'stage', eventType: 'node:activated', details: {} });
    expect(getNodeJournal('p-1', 'unknown')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// control-flow event types
// ---------------------------------------------------------------------------

describe('control-flow event types', () => {
  it('records checkpoint:created event', () => {
    appendJournalEntry({
      projectId: 'p-1',
      nodeId: 'loop-start',
      nodeKind: 'loop-start',
      eventType: 'checkpoint:created',
      details: { checkpointId: 'cp-1', iterationIndex: 2 },
    });

    const entries = queryJournal('p-1', { eventType: 'checkpoint:created' });
    expect(entries).toHaveLength(1);
    expect(entries[0].details.checkpointId).toBe('cp-1');
  });

  it('records loop:iteration event', () => {
    appendJournalEntry({
      projectId: 'p-1',
      nodeId: 'loop-end',
      nodeKind: 'loop-end',
      eventType: 'loop:iteration',
      details: { iteration: 3, maxIterations: 5, terminationMet: false },
    });

    const entries = queryJournal('p-1', { eventType: 'loop:iteration' });
    expect(entries).toHaveLength(1);
    expect(entries[0].details.iteration).toBe(3);
  });

  it('records gate:decided event', () => {
    appendJournalEntry({
      projectId: 'p-1',
      nodeId: 'security-gate',
      nodeKind: 'gate',
      eventType: 'gate:decided',
      details: { action: 'approve', approvedBy: 'admin', reason: 'Looks good' },
    });

    const entries = queryJournal('p-1', { eventType: 'gate:decided' });
    expect(entries).toHaveLength(1);
    expect(entries[0].details.action).toBe('approve');
  });
});
