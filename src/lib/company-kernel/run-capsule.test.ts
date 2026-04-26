import { describe, expect, it } from 'vitest';

import type { AgentRunState } from '../agents/group-types';
import { buildRunCapsuleFromRun } from './run-capsule';

describe('buildRunCapsuleFromRun', () => {
  it('extracts checkpoints, evidence, decisions, and quality signals from a completed run', () => {
    const run: AgentRunState = {
      runId: 'run-capsule-1',
      stageId: 'prompt',
      workspace: 'file:///tmp/workspace',
      prompt: 'Create report',
      status: 'completed',
      createdAt: '2026-04-25T10:00:00.000Z',
      startedAt: '2026-04-25T10:01:00.000Z',
      finishedAt: '2026-04-25T10:02:00.000Z',
      provider: 'native-codex',
      result: {
        status: 'completed',
        summary: 'We decided to use SQLite for durable run capsules.',
        changedFiles: ['src/lib/company-kernel/run-capsule.ts'],
        blockers: [],
        needsReview: [],
      },
      resultEnvelope: {
        runId: 'run-capsule-1',
        status: 'completed',
        summary: 'Capsule completed',
        outputArtifacts: [{
          id: 'artifact-1',
          kind: 'result-envelope',
          title: 'Result Envelope',
          path: 'demolong/runs/run-capsule-1/result-envelope.json',
          format: 'json',
        }],
      },
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    };

    const capsule = buildRunCapsuleFromRun(run);

    expect(capsule.runId).toBe('run-capsule-1');
    expect(capsule.providerId).toBe('native-codex');
    expect(capsule.decisions).toEqual(['decided to use SQLite for durable run capsules.']);
    expect(capsule.changedFiles).toEqual(['src/lib/company-kernel/run-capsule.ts']);
    expect(capsule.outputArtifacts).toEqual([
      expect.objectContaining({
        type: 'artifact',
        artifactPath: 'demolong/runs/run-capsule-1/result-envelope.json',
      }),
    ]);
    expect(capsule.qualitySignals).toEqual(expect.objectContaining({
      resultStatus: 'completed',
      hasResultEnvelope: true,
    }));
    expect(capsule.checkpoints.map((checkpoint) => checkpoint.kind)).toEqual(expect.arrayContaining([
      'run-created',
      'run-started',
      'result-discovered',
      'artifact-discovered',
      'run-completed',
    ]));
  });

  it.each([
    ['blocked', 'run-blocked'],
    ['failed', 'run-failed'],
    ['cancelled', 'run-cancelled'],
  ] as const)('captures terminal checkpoint and blockers for %s runs', (status, checkpointKind) => {
    const run: AgentRunState = {
      runId: `run-capsule-${status}`,
      stageId: 'prompt',
      workspace: 'file:///tmp/workspace',
      prompt: 'Recover job',
      status,
      createdAt: '2026-04-25T10:00:00.000Z',
      startedAt: '2026-04-25T10:01:00.000Z',
      finishedAt: '2026-04-25T10:02:00.000Z',
      ...(status === 'cancelled' ? { lastError: 'User cancelled run' } : {}),
      result: {
        status,
        summary: `Run ended as ${status}`,
        changedFiles: [],
        blockers: status === 'blocked' ? ['Waiting for approval'] : [],
        needsReview: status === 'failed' ? ['Inspect failure'] : [],
      },
    };

    const capsule = buildRunCapsuleFromRun(run);

    expect(capsule.status).toBe(status);
    expect(capsule.qualitySignals.resultStatus).toBe(status);
    expect(capsule.checkpoints.map((checkpoint) => checkpoint.kind)).toContain(checkpointKind);
    if (status === 'blocked') {
      expect(capsule.blockers).toContain('Waiting for approval');
    }
    if (status === 'cancelled') {
      expect(capsule.blockers).toContain('User cancelled run');
    }
  });
});
