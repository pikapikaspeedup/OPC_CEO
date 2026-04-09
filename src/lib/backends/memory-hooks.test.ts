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

  it('merges beforeRun memory context patches in registration order', async () => {
    registerMemoryHook({
      id: 'project-hook',
      providers: ['codex'],
      beforeRun: () => ({
        projectMemories: [{ type: 'project', name: 'p', content: 'project', updatedAt: '2026-04-08T00:00:00.000Z' }],
      }),
    });
    registerMemoryHook({
      id: 'user-hook',
      beforeRun: () => ({
        userPreferences: [{ type: 'user', name: 'u', content: 'pref', updatedAt: '2026-04-08T00:00:00.000Z' }],
      }),
    });

    const result = await applyBeforeRunMemoryHooks('codex', makeConfig());

    expect(result.memoryContext).toEqual({
      projectMemories: [{ type: 'project', name: 'p', content: 'project', updatedAt: '2026-04-08T00:00:00.000Z' }],
      departmentMemories: [],
      userPreferences: [{ type: 'user', name: 'u', content: 'pref', updatedAt: '2026-04-08T00:00:00.000Z' }],
    });
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
