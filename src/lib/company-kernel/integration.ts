import type { AgentRunState } from '../agents/group-types';
import { getRun } from '../agents/run-registry';
import { buildRunCapsuleFromRun } from './run-capsule';
import { getRunCapsuleByRunId, upsertRunCapsule } from './run-capsule-store';
import type { RunCapsule } from './contracts';

export function captureRunCapsuleSnapshot(run: AgentRunState): RunCapsule {
  const existing = getRunCapsuleByRunId(run.runId);
  const capsule = buildRunCapsuleFromRun(run, existing);
  return upsertRunCapsule(capsule);
}

export function finalizeRunCapsuleForRun(runId: string): RunCapsule | null {
  const run = getRun(runId);
  if (!run) return null;
  return captureRunCapsuleSnapshot(run);
}

