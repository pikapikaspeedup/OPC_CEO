import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyAfterRunMemoryHooks,
  applyBeforeRunMemoryHooks,
  clearMemoryHooks,
  registerMemoryHook,
} from './index';
import type { BackendRunConfig, CompletedAgentEvent } from './types';

function makeConfig(): BackendRunConfig {
  return {
    runId: 'run-1',
    workspacePath: '/tmp/workspace',
    prompt: '执行任务',
    metadata: {
      stageId: 'prompt-mode',
      roleId: 'prompt-executor',
      executorKind: 'prompt',
    },
  };
}

describe('memory-hooks', () => {
  beforeEach(() => {
    clearMemoryHooks();
  });

  it('keeps before-run memory application as a pass-through', async () => {
    const config = makeConfig();
    const result = await applyBeforeRunMemoryHooks('codex', makeConfig());

    expect(result).toEqual(config);
    expect(result).not.toBe(config);
  });

  it('runs afterRun hooks only for matching providers', async () => {
    const codexAfter = vi.fn();
    const antigravityAfter = vi.fn();

    registerMemoryHook({
      id: 'codex-only',
      providers: ['codex'],
      afterRun: codexAfter,
    });
    registerMemoryHook({
      id: 'antigravity-only',
      providers: ['antigravity'],
      afterRun: antigravityAfter,
    });

    const event: CompletedAgentEvent = {
      kind: 'completed',
      runId: 'run-1',
      providerId: 'codex',
      handle: 'codex-run-1',
      finishedAt: '2026-04-08T00:00:00.000Z',
      result: {
        status: 'completed',
        summary: 'done',
        changedFiles: [],
        blockers: [],
        needsReview: [],
      },
    };

    await applyAfterRunMemoryHooks('codex', makeConfig(), event);

    expect(codexAfter).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'codex',
      config: expect.objectContaining({ runId: 'run-1' }),
      event,
    }));
    expect(antigravityAfter).not.toHaveBeenCalled();
  });
});
