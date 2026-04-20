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
    knowledgeStore: await import('../../knowledge/store'),
    gatewayDb: await import('../../storage/gateway-db'),
    generator: await import('../generator'),
  };
}

describe('evolution generator', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-generator-'));
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

  it('creates proposals from knowledge signals and repeated prompt runs', async () => {
    const { knowledgeStore, gatewayDb, generator } = await loadModules();

    knowledgeStore.upsertKnowledgeAsset({
      id: 'knowledge-proposal-1',
      scope: 'department',
      workspaceUri: 'file:///tmp/research',
      category: 'workflow-proposal',
      title: 'phase5 digest routine',
      content: 'Reason: This digest task repeats every day.\nSource: skill',
      source: { type: 'run', runId: 'run-knowledge-1' },
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      status: 'proposal',
    });

    const repeatedPrompts = [
      'Summarize frontend incidents digest today leadership team update blockers',
      'Summarize frontend incidents digest today leadership team update followups',
      'Summarize frontend incidents digest today leadership team update summary',
    ];
    repeatedPrompts.forEach((prompt, index) => {
      gatewayDb.upsertRunRecord({
        runId: `run-repeat-${index}`,
        stageId: 'prompt',
        workspace: 'file:///tmp/research',
        status: 'completed',
        createdAt: `2026-04-19T0${index}:00:00.000Z`,
        prompt,
        executorKind: 'prompt',
        executionTarget: { kind: 'prompt' },
      } as AgentRunState);
    });

    const proposals = generator.generateEvolutionProposals();
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'draft',
        sourceKnowledgeIds: ['knowledge-proposal-1'],
      }),
      expect.objectContaining({
        status: 'draft',
        evidence: expect.arrayContaining([
          expect.objectContaining({ source: 'repeated-runs', count: 3 }),
        ]),
      }),
    ]));
  });
});
