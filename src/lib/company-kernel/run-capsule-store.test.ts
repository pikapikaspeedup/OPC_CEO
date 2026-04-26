import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentRunState } from '../agents/group-types';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    capsuleBuilder: await import('./run-capsule'),
    capsuleStore: await import('./run-capsule-store'),
  };
}

function makeRun(overrides: Partial<AgentRunState> = {}): AgentRunState {
  return {
    runId: 'run-1',
    stageId: 'prompt',
    workspace: 'file:///tmp/workspace-a',
    prompt: 'Build capsule',
    status: 'completed',
    createdAt: '2026-04-25T10:00:00.000Z',
    finishedAt: '2026-04-25T10:01:00.000Z',
    result: {
      status: 'completed',
      summary: 'Run completed.',
      changedFiles: [],
      blockers: [],
      needsReview: [],
    },
    ...overrides,
  };
}

describe('run capsule store', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'run-capsule-store-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
    vi.resetModules();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('persists and paginates run capsules in SQLite', async () => {
    const { capsuleBuilder, capsuleStore } = await loadModules();
    const baseRun = makeRun();

    capsuleStore.upsertRunCapsule(capsuleBuilder.buildRunCapsuleFromRun(baseRun));
    capsuleStore.upsertRunCapsule(capsuleBuilder.buildRunCapsuleFromRun({
      ...baseRun,
      runId: 'run-2',
      workspace: 'file:///tmp/workspace-b',
      createdAt: '2026-04-25T11:00:00.000Z',
      finishedAt: '2026-04-25T11:01:00.000Z',
    }));

    expect(capsuleStore.countRunCapsules()).toBe(2);
    expect(capsuleStore.countRunCapsules({ workspaceUri: 'file:///tmp/workspace-a' })).toBe(1);
    expect(capsuleStore.getRunCapsuleByRunId('run-1')?.workspaceUri).toBe('file:///tmp/workspace-a');
    expect(capsuleStore.listRunCapsules({ limit: 1, offset: 0 })).toHaveLength(1);
  });

  it('keeps appended checkpoints when rebuilding a run capsule from run state', async () => {
    const { capsuleStore } = await loadModules();
    const run = makeRun({
      status: 'running',
      startedAt: '2026-04-25T10:00:20.000Z',
    });

    const appended = capsuleStore.appendWorkingCheckpoint({
      run,
      kind: 'result-discovered',
      summary: 'Manual checkpoint from lifecycle hook',
      metadata: { source: 'test' },
    });

    expect(appended.checkpoints.some((checkpoint) => checkpoint.summary === 'Manual checkpoint from lifecycle hook')).toBe(true);

    const rebuilt = capsuleStore.rebuildRunCapsuleFromRun(makeRun({
      startedAt: '2026-04-25T10:00:20.000Z',
    }));

    expect(rebuilt.status).toBe('completed');
    expect(rebuilt.checkpoints.some((checkpoint) => checkpoint.summary === 'Manual checkpoint from lifecycle hook')).toBe(true);
    expect(rebuilt.checkpoints.some((checkpoint) => checkpoint.kind === 'run-completed')).toBe(true);
  });
});
