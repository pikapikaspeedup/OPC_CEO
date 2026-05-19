import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentRunState } from '../../agents/group-types';
import type { MemoryCandidate, RunCapsule } from '../../company-kernel/contracts';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    candidateStore: await import('../../company-kernel/memory-candidate-store'),
    knowledgeStore: await import('../../knowledge/store'),
    gatewayDb: await import('../../storage/gateway-db'),
    generator: await import('../generator'),
    runCapsuleStore: await import('../../company-kernel/run-capsule-store'),
  };
}

function makeMemoryCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: 'candidate-skill-1',
    workspaceUri: 'file:///tmp/research',
    sourceRunId: 'run-candidate-1',
    sourceCapsuleId: 'capsule-candidate-1',
    kind: 'skill-proposal',
    title: 'Research digest quality checker',
    content: 'Reusable quality checks for research digests.',
    evidenceRefs: [],
    volatility: 'stable',
    score: {
      total: 82,
      evidence: 80,
      reuse: 90,
      specificity: 80,
      stability: 80,
      novelty: 70,
      risk: 20,
    },
    reasons: ['Repeated review steps were successful.', 'The checks are reusable across digests.'],
    conflicts: [],
    status: 'promoted',
    promotedKnowledgeId: 'knowledge-skill-source',
    createdAt: '2026-04-19T00:00:00.000Z',
    updatedAt: '2026-04-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeRunCapsule(index: number, overrides: Partial<RunCapsule> = {}): RunCapsule {
  return {
    capsuleId: `capsule-script-${index}`,
    runId: `run-script-${index}`,
    workspaceUri: 'file:///tmp/research',
    goal: 'Automate daily report publishing',
    prompt: 'Create daily report automation script with approval policy',
    status: 'completed',
    checkpoints: [],
    verifiedFacts: ['Result status: completed'],
    decisions: ['Must keep approval before publishing reports.'],
    reusableSteps: ['Automate daily report script with approval rule'],
    blockers: [],
    changedFiles: [],
    outputArtifacts: [{
      id: `artifact-${index}`,
      type: 'file',
      label: 'Automation script',
      runId: `run-script-${index}`,
      filePath: `scripts/report-${index}.sh`,
      createdAt: '2026-04-19T00:00:00.000Z',
    }],
    qualitySignals: {
      resultStatus: 'completed',
      verificationPassed: true,
      hasResultEnvelope: true,
      hasArtifactManifest: false,
      hasDeliveryPacket: false,
    },
    sourceRunUpdatedAt: '2026-04-19T00:00:00.000Z',
    createdAt: '2026-04-19T00:00:00.000Z',
    updatedAt: '2026-04-19T00:00:00.000Z',
    ...overrides,
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

  it('crystallizes memory candidates and reusable run capsules into business evolution proposals', async () => {
    const { candidateStore, generator, runCapsuleStore } = await loadModules();

    candidateStore.upsertMemoryCandidate(makeMemoryCandidate());
    [0, 1, 2].forEach((index) => {
      runCapsuleStore.upsertRunCapsule(makeRunCapsule(index));
    });

    const proposals = generator.generateEvolutionProposals({ workspaceUri: 'file:///tmp/research', limit: 10 });
    const kinds = proposals.map((proposal) => proposal.kind);

    expect(kinds).toEqual(expect.arrayContaining(['skill', 'workflow', 'script', 'rule']));
    expect(proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'skill',
        evidence: expect.arrayContaining([
          expect.objectContaining({ source: 'memory-candidate', candidateIds: ['candidate-skill-1'] }),
        ]),
      }),
      expect.objectContaining({
        kind: 'script',
        evidence: expect.arrayContaining([
          expect.objectContaining({ source: 'run-capsules', count: 3 }),
        ]),
      }),
    ]));
  });
});
