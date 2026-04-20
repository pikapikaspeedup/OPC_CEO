import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempGatewayHome = path.join('/tmp', `ag-gateway-db-${process.pid}-${Date.now()}`);
let previousGatewayHome: string | undefined;

async function loadModule() {
  return import('./gateway-db');
}

describe('gateway-db conversation projections', () => {
  beforeEach(() => {
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.AG_GATEWAY_HOME = tempGatewayHome;
    delete (globalThis as { __AG_GATEWAY_DB__?: unknown }).__AG_GATEWAY_DB__;
    vi.resetModules();
    fs.rmSync(tempGatewayHome, { recursive: true, force: true });
  });

  afterEach(() => {
    delete (globalThis as { __AG_GATEWAY_DB__?: unknown }).__AG_GATEWAY_DB__;
    vi.resetModules();
    fs.rmSync(tempGatewayHome, { recursive: true, force: true });
    if (previousGatewayHome === undefined) {
      delete process.env.AG_GATEWAY_HOME;
    } else {
      process.env.AG_GATEWAY_HOME = previousGatewayHome;
    }
  });

  it('materializes run conversation links and hidden child visibility', async () => {
    const db = await loadModule();

    db.upsertRunRecord({
      runId: 'run-1',
      stageId: 'implement',
      workspace: 'file:///tmp/workspace',
      prompt: 'fix bug',
      status: 'running',
      createdAt: '2026-04-20T10:00:00.000Z',
      childConversationId: 'cascade-child',
      roles: [
        {
          roleId: 'reviewer',
          round: 1,
          childConversationId: 'cascade-role',
          status: 'running',
        },
      ],
      sessionProvenance: {
        handle: 'session-1',
        backendId: 'native-codex',
        handleKind: 'started',
        workspacePath: '/tmp/workspace',
        recordedAt: '2026-04-20T10:00:00.000Z',
      },
    });

    expect(db.findRunRecordByConversationRef({ conversationIds: ['cascade-child'] })?.runId).toBe('run-1');
    expect(db.findRunRecordByConversationRef({ sessionHandles: ['session-1'] })?.runId).toBe('run-1');
    expect(db.listChildConversationIdsFromRuns().sort()).toEqual(['cascade-child', 'cascade-role']);
  });

  it('lists conversations from the projection-first table', async () => {
    const db = await loadModule();

    db.upsertConversationProjection({
      id: 'cascade-1',
      title: 'Projection Conversation',
      workspace: 'file:///tmp/workspace',
      stepCount: 7,
      updatedAt: '2026-04-20T10:10:00.000Z',
      lastActivityAt: '2026-04-20T10:11:00.000Z',
      sourceKind: 'antigravity-live',
      isLocalOnly: false,
    });

    db.upsertConversationProjection({
      id: 'cascade-hidden',
      title: 'Hidden Conversation',
      workspace: 'file:///tmp/workspace',
      stepCount: 1,
      updatedAt: '2026-04-20T10:00:00.000Z',
      sourceKind: 'local-cache',
      isLocalOnly: false,
    });

    db.upsertRunRecord({
      runId: 'run-2',
      stageId: 'review',
      workspace: 'file:///tmp/workspace',
      prompt: 'review',
      status: 'running',
      createdAt: '2026-04-20T10:12:00.000Z',
      childConversationId: 'cascade-hidden',
    });

    expect(db.listConversationProjections({ workspace: 'file:///tmp/workspace' }).map((row) => row.id)).toEqual(['cascade-1']);
    expect(db.listConversationProjections({ workspace: 'file:///tmp/workspace', includeHidden: true }).map((row) => row.id)).toEqual([
      'cascade-1',
      'cascade-hidden',
    ]);
  });

  it('counts and paginates filtered run records from SQLite', async () => {
    const db = await loadModule();

    db.upsertRunRecord({
      runId: 'run-1',
      stageId: 'product-spec',
      workspace: 'file:///tmp/workspace',
      prompt: 'spec',
      status: 'completed',
      createdAt: '2026-04-20T10:00:00.000Z',
      reviewOutcome: 'approved',
      triggerContext: { schedulerJobId: 'job-1' },
    });

    db.upsertRunRecord({
      runId: 'run-2',
      stageId: 'product-spec',
      workspace: 'file:///tmp/workspace',
      prompt: 'spec 2',
      status: 'completed',
      createdAt: '2026-04-20T11:00:00.000Z',
      reviewOutcome: 'approved',
      triggerContext: { schedulerJobId: 'job-1' },
    });

    db.upsertRunRecord({
      runId: 'run-3',
      stageId: 'architecture-advisory',
      workspace: 'file:///tmp/workspace',
      prompt: 'arch',
      status: 'completed',
      createdAt: '2026-04-20T12:00:00.000Z',
      reviewOutcome: 'rejected',
      triggerContext: { schedulerJobId: 'job-2' },
    });

    expect(db.countRunRecordsByFilter({ schedulerJobId: 'job-1', reviewOutcome: 'approved' })).toBe(2);
    expect(
      db.listRunRecordsByFilter(
        { schedulerJobId: 'job-1', reviewOutcome: 'approved' },
        { limit: 1, offset: 0 },
      ).map((row) => row.runId),
    ).toEqual(['run-2']);
    expect(
      db.listRunRecordsByFilter(
        { schedulerJobId: 'job-1', reviewOutcome: 'approved' },
        { limit: 1, offset: 1 },
      ).map((row) => row.runId),
    ).toEqual(['run-1']);
  });
});
