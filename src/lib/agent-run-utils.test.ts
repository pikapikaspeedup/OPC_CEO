import { describe, expect, it } from 'vitest';
import type { AgentRun } from './types';
import { pickDefaultAgentRun, resolveSelectedAgentRunId } from './agent-run-utils';

function makeRun(runId: string, status: AgentRun['status']): AgentRun {
  return {
    runId,
    stageId: 'prompt-mode',
    workspace: 'file:///tmp/workspace',
    status,
    createdAt: '2026-05-08T12:00:00.000Z',
    prompt: `run ${runId}`,
  };
}

describe('pickDefaultAgentRun', () => {
  it('prefers an active run before the newest completed run', () => {
    const runs = [
      makeRun('completed-run', 'completed'),
      makeRun('running-run', 'running'),
    ];

    expect(pickDefaultAgentRun(runs, null)).toBe('running-run');
  });
});

describe('resolveSelectedAgentRunId', () => {
  it('keeps the preferred run when it is still present', () => {
    const runs = [makeRun('run-1', 'completed'), makeRun('run-2', 'completed')];

    expect(resolveSelectedAgentRunId(runs, {
      currentRunId: null,
      preferredRunId: 'run-2',
      allowAutoSelect: false,
    })).toBe('run-2');
  });

  it('keeps the current run in projects mode instead of auto-picking another run', () => {
    const runs = [makeRun('run-1', 'completed'), makeRun('run-2', 'completed')];

    expect(resolveSelectedAgentRunId(runs, {
      currentRunId: 'run-1',
      preferredRunId: null,
      allowAutoSelect: false,
    })).toBe('run-1');
  });

  it('returns null when nothing is explicitly selected and auto-pick is disabled', () => {
    const runs = [makeRun('run-1', 'completed'), makeRun('run-2', 'completed')];

    expect(resolveSelectedAgentRunId(runs, {
      currentRunId: null,
      preferredRunId: null,
      allowAutoSelect: false,
    })).toBeNull();
  });

  it('falls back to the default run when auto-pick is enabled', () => {
    const runs = [makeRun('completed-run', 'completed'), makeRun('running-run', 'running')];

    expect(resolveSelectedAgentRunId(runs, {
      currentRunId: null,
      preferredRunId: null,
      allowAutoSelect: true,
    })).toBe('running-run');
  });
});
