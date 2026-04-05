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

// Mock GATEWAY_HOME to a temp dir
const TEST_AUDIT_DIR = path.join(import.meta.dirname ?? __dirname, '__test_audit__');

vi.mock('./gateway-home', () => ({
  GATEWAY_HOME: path.join(import.meta.dirname ?? __dirname, '__test_audit_home__'),
}));

import { appendAuditEvent, queryAuditEvents } from './ops-audit';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  // Clean up test audit directory
  const auditDir = path.join(import.meta.dirname ?? __dirname, '__test_audit_home__', 'ops_audit');
  if (fs.existsSync(auditDir)) {
    fs.rmSync(auditDir, { recursive: true });
  }
});

afterEach(() => {
  const homeDir = path.join(import.meta.dirname ?? __dirname, '__test_audit_home__');
  if (fs.existsSync(homeDir)) {
    fs.rmSync(homeDir, { recursive: true });
  }
});

describe('appendAuditEvent', () => {
  it('creates daily file and appends event', () => {
    appendAuditEvent({
      kind: 'stage:completed',
      projectId: 'p-1',
      stageId: 'dev',
      message: 'Stage dev completed',
    });

    const auditDir = path.join(import.meta.dirname ?? __dirname, '__test_audit_home__', 'ops_audit');
    const expectedFile = path.join(auditDir, `ops_audit_${today()}.jsonl`);
    expect(fs.existsSync(expectedFile)).toBe(true);

    const content = fs.readFileSync(expectedFile, 'utf-8').trim();
    const event = JSON.parse(content);
    expect(event.kind).toBe('stage:completed');
    expect(event.projectId).toBe('p-1');
    expect(event.stageId).toBe('dev');
    expect(event.timestamp).toBeDefined();
  });

  it('appends multiple events to the same file', () => {
    appendAuditEvent({ kind: 'stage:completed', projectId: 'p-1', message: 'First' });
    appendAuditEvent({ kind: 'project:reconciled', projectId: 'p-1', message: 'Second' });

    const auditDir = path.join(import.meta.dirname ?? __dirname, '__test_audit_home__', 'ops_audit');
    const expectedFile = path.join(auditDir, `ops_audit_${today()}.jsonl`);
    const lines = fs.readFileSync(expectedFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).kind).toBe('stage:completed');
    expect(JSON.parse(lines[1]).kind).toBe('project:reconciled');
  });

  it('includes optional meta field', () => {
    appendAuditEvent({
      kind: 'project:reconciled',
      projectId: 'p-1',
      message: 'Dry run',
      meta: { actionsCount: 3 },
    });

    const auditDir = path.join(import.meta.dirname ?? __dirname, '__test_audit_home__', 'ops_audit');
    const expectedFile = path.join(auditDir, `ops_audit_${today()}.jsonl`);
    const event = JSON.parse(fs.readFileSync(expectedFile, 'utf-8').trim());
    expect(event.meta).toEqual({ actionsCount: 3 });
  });
});

describe('queryAuditEvents', () => {
  it('returns empty array when no audit files exist', () => {
    const events = queryAuditEvents();
    expect(events).toEqual([]);
  });

  it('returns all events without filters', () => {
    appendAuditEvent({ kind: 'stage:completed', projectId: 'p-1', message: 'First' });
    appendAuditEvent({ kind: 'project:reconciled', projectId: 'p-1', message: 'Second' });

    const events = queryAuditEvents();
    expect(events).toHaveLength(2);
  });

  it('filters by kind', () => {
    appendAuditEvent({ kind: 'stage:completed', projectId: 'p-1', message: 'One' });
    appendAuditEvent({ kind: 'project:reconciled', projectId: 'p-1', message: 'Two' });
    appendAuditEvent({ kind: 'stage:completed', projectId: 'p-2', message: 'Three' });

    const events = queryAuditEvents({ kind: 'stage:completed' });
    expect(events).toHaveLength(2);
    expect(events.every(e => e.kind === 'stage:completed')).toBe(true);
  });

  it('filters by projectId', () => {
    appendAuditEvent({ kind: 'stage:completed', projectId: 'p-1', message: 'One' });
    appendAuditEvent({ kind: 'stage:completed', projectId: 'p-2', message: 'Two' });

    const events = queryAuditEvents({ projectId: 'p-1' });
    expect(events).toHaveLength(1);
    expect(events[0].projectId).toBe('p-1');
  });

  it('respects limit parameter', () => {
    appendAuditEvent({ kind: 'stage:completed', projectId: 'p-1', message: 'One' });
    appendAuditEvent({ kind: 'stage:completed', projectId: 'p-1', message: 'Two' });
    appendAuditEvent({ kind: 'stage:completed', projectId: 'p-1', message: 'Three' });

    const events = queryAuditEvents({ limit: 2 });
    expect(events).toHaveLength(2);
  });
});
