import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunCapsule } from './contracts';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    promotion: await import('./memory-promotion'),
    candidateStore: await import('./memory-candidate-store'),
    knowledgeStore: await import('../knowledge/store'),
  };
}

function makeCapsule(overrides: Partial<RunCapsule> = {}): RunCapsule {
  return {
    capsuleId: 'capsule-run-1',
    runId: 'run-1',
    workspaceUri: 'file:///tmp/workspace',
    goal: 'Improve workflow',
    prompt: 'Improve workflow',
    status: 'completed',
    checkpoints: [],
    verifiedFacts: ['Result status: completed'],
    decisions: ['decided to use deterministic memory promotion.'],
    reusableSteps: ['Resolved workflow: /daily_digest'],
    blockers: [],
    changedFiles: [],
    outputArtifacts: [{
      id: 'ev-1',
      type: 'result-envelope',
      label: 'Result Envelope',
      runId: 'run-1',
      artifactPath: 'demolong/runs/run-1/result-envelope.json',
      createdAt: '2026-04-25T10:00:00.000Z',
    }],
    qualitySignals: {
      resultStatus: 'completed',
      hasResultEnvelope: true,
      hasArtifactManifest: false,
      hasDeliveryPacket: false,
    },
    sourceRunUpdatedAt: '2026-04-25T10:00:00.000Z',
    createdAt: '2026-04-25T10:00:00.000Z',
    updatedAt: '2026-04-25T10:00:00.000Z',
    ...overrides,
  };
}

describe('memory promotion', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-promotion-'));
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

  it('stores memory candidates without auto-promoting by default', async () => {
    const { promotion, candidateStore, knowledgeStore } = await loadModules();

    const result = promotion.processRunCapsuleForMemory(makeCapsule());

    expect(result.promotedAssets).toHaveLength(0);
    expect(candidateStore.listMemoryCandidates()).toHaveLength(2);
    expect(knowledgeStore.listKnowledgeAssets()).toHaveLength(0);
  });

  it('promotes and rejects memory candidates explicitly', async () => {
    const { promotion, candidateStore, knowledgeStore } = await loadModules();
    const { candidates } = promotion.processRunCapsuleForMemory(makeCapsule());
    const promoted = promotion.promoteMemoryCandidate({
      candidateId: candidates[0].id,
      promotedBy: 'ceo',
    });

    expect(promoted.evidence?.refs).toHaveLength(1);
    expect(promoted.promotion?.sourceCandidateId).toBe(candidates[0].id);
    expect(candidateStore.getMemoryCandidate(candidates[0].id)?.status).toBe('promoted');
    expect(knowledgeStore.getKnowledgeAsset(promoted.id)?.id).toBe(promoted.id);

    const rejected = promotion.rejectMemoryCandidate({
      candidateId: candidates[1].id,
      reason: 'Not reusable enough',
      rejectedBy: 'ceo',
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectedReason).toContain('Not reusable enough');
  });

  it('does not allow closed candidates to be promoted or rejected again', async () => {
    const { promotion, candidateStore } = await loadModules();
    const { candidates } = promotion.processRunCapsuleForMemory(makeCapsule());
    const promoted = promotion.promoteMemoryCandidate({
      candidateId: candidates[0].id,
      promotedBy: 'ceo',
    });
    const rejected = promotion.rejectMemoryCandidate({
      candidateId: candidates[1].id,
      reason: 'Not reusable enough',
      rejectedBy: 'ceo',
    });

    expect(() => promotion.promoteMemoryCandidate({
      candidateId: rejected.id,
      promotedBy: 'ceo',
    })).toThrow(/from status rejected/);
    expect(() => promotion.rejectMemoryCandidate({
      candidateId: candidates[0].id,
      reason: 'Rollback',
      rejectedBy: 'ceo',
    })).toThrow(/from status promoted/);

    const reprocessed = promotion.processRunCapsuleForMemory(makeCapsule());
    expect(reprocessed.candidates.find((candidate) => candidate.id === candidates[0].id)?.status).toBe('promoted');
    expect(candidateStore.getMemoryCandidate(candidates[0].id)?.promotedKnowledgeId).toBe(promoted.id);
  });

  it('marks volatile candidates as non-auto-promotable', async () => {
    const { promotion } = await loadModules();
    const { candidates } = promotion.processRunCapsuleForMemory(makeCapsule({
      decisions: ['decided current API latency today is 1200ms.'],
      reusableSteps: [],
    }));

    expect(candidates[0].volatility).toBe('volatile');
    expect(promotion.shouldAutoPromoteCandidate(candidates[0])).toBe(false);
  });

  it('does not auto-promote candidates without evidence even when score is high', async () => {
    const { promotion } = await loadModules();
    const { candidates } = promotion.processRunCapsuleForMemory(makeCapsule({
      outputArtifacts: [],
    }));
    const highScoreWithoutEvidence = {
      ...candidates[0],
      evidenceRefs: [],
      score: {
        ...candidates[0].score,
        evidence: 0,
        total: 90,
      },
    };

    expect(promotion.shouldAutoPromoteCandidate(highScoreWithoutEvidence)).toBe(false);
  });

  it('keeps high-conflict candidates in review even when auto-promotion is requested', async () => {
    const { promotion, knowledgeStore } = await loadModules();
    knowledgeStore.upsertKnowledgeAsset({
      id: 'knowledge-conflict-1',
      scope: 'department',
      workspaceUri: 'file:///tmp/workspace',
      category: 'decision',
      title: 'Deterministic memory promotion decision',
      content: 'decided to use deterministic memory promotion.',
      source: { type: 'manual' },
      status: 'active',
      createdAt: '2026-04-25T09:00:00.000Z',
      updatedAt: '2026-04-25T09:00:00.000Z',
    });

    const result = promotion.processRunCapsuleForMemory(makeCapsule(), { autoPromote: true });
    const conflicted = result.candidates.find((candidate) => candidate.kind === 'decision');

    expect(conflicted?.conflicts.some((conflict) => conflict.severity === 'high')).toBe(true);
    expect(conflicted?.status).toBe('pending-review');
    expect(result.promotedAssets).toHaveLength(0);
  });

  it('feeds promoted workflow candidates into evolution proposal generation', async () => {
    const { promotion } = await loadModules();
    const generator = await import('../evolution/generator');
    const capsule = makeCapsule({
      decisions: [],
      reusableSteps: [],
      promptResolution: {
        mode: 'prompt',
        requestedWorkflowRefs: [],
        requestedSkillHints: ['research'],
        matchedWorkflowRefs: [],
        matchedSkillRefs: ['research'],
        resolutionReason: 'Prompt can become a reusable workflow.',
        workflowSuggestion: {
          shouldCreateWorkflow: true,
          source: 'prompt',
          title: 'Customer research digest workflow',
          reason: 'Repeated research digest request.',
          recommendedScope: 'department',
          evidence: {
            requestedWorkflowRefs: [],
            requestedSkillHints: ['research'],
            matchedWorkflowRefs: [],
            matchedSkillRefs: ['research'],
          },
        },
      },
    });
    const { candidates } = promotion.processRunCapsuleForMemory(capsule);
    const workflowCandidate = candidates.find((candidate) => candidate.kind === 'workflow-proposal');

    expect(workflowCandidate).toBeDefined();
    const knowledge = promotion.promoteMemoryCandidate({
      candidateId: workflowCandidate!.id,
      promotedBy: 'ceo',
    });
    const proposals = generator.generateEvolutionProposals({ limit: 10 });

    expect(knowledge.status).toBe('proposal');
    expect(proposals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'workflow',
        sourceKnowledgeIds: [knowledge.id],
      }),
    ]));
  });
});
