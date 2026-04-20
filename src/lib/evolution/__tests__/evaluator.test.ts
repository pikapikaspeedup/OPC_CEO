import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentRunState } from '../../agents/group-types';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    gatewayDb: await import('../../storage/gateway-db'),
    store: await import('../store'),
    evaluator: await import('../evaluator'),
  };
}

describe('evolution evaluator', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-evaluator-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('evaluates a proposal against historical runs', async () => {
    const { gatewayDb, store, evaluator } = await loadModules();

    store.upsertEvolutionProposal({
      id: 'proposal-eval-1',
      kind: 'workflow',
      status: 'draft',
      workspaceUri: 'file:///tmp/research',
      title: 'Frontend Incident Digest',
      targetName: 'frontend-incident-digest',
      targetRef: '/frontend-incident-digest',
      rationale: 'Repeated incident digests should become canonical.',
      content: '# Frontend Incident Digest',
      sourceKnowledgeIds: [],
      evidence: [{
        source: 'repeated-runs',
        label: 'Repeated digests',
        detail: 'historical evidence',
        workspaceUri: 'file:///tmp/research',
        runIds: ['run-a', 'run-b', 'run-c'],
        count: 3,
      }],
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
    });

    [
      { runId: 'run-a', status: 'completed' },
      { runId: 'run-b', status: 'completed' },
      { runId: 'run-c', status: 'blocked' },
    ].forEach((run, index) => {
      gatewayDb.upsertRunRecord({
        runId: run.runId,
        stageId: 'prompt',
        workspace: 'file:///tmp/research',
        status: run.status,
        createdAt: `2026-04-19T0${index}:00:00.000Z`,
        prompt: 'Summarize frontend incident digest',
        executorKind: 'prompt',
        executionTarget: { kind: 'prompt' },
      } as AgentRunState);
    });

    const evaluated = evaluator.evaluateEvolutionProposal('proposal-eval-1');
    expect(evaluated?.status).toBe('evaluated');
    expect(evaluated?.evaluation?.sampleSize).toBe(3);
    expect(evaluated?.evaluation?.recommendation).toBe('publish');
    expect(evaluated?.evaluation?.matchedRunIds).toEqual(expect.arrayContaining(['run-a', 'run-b', 'run-c']));
  });
});
