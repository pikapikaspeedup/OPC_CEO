import { beforeEach, describe, expect, it } from 'vitest';

import { applyBeforeRunMemoryHooks, clearMemoryHooks, registerMemoryHook } from '../memory-hooks';
import type { BackendRunConfig } from '../types';

type RuntimeContract = {
  workspaceRoot: string;
  additionalWorkingDirectories: string[];
  readRoots: string[];
  writeRoots: string[];
  artifactRoot: string;
  executionClass: 'review-loop' | 'delivery';
  toolset: 'coding' | 'research' | 'safe' | 'full';
  permissionMode: 'default' | 'dontAsk' | 'acceptEdits' | 'bypassPermissions';
  requiredArtifacts: Array<{
    path: string;
    required: boolean;
    format?: 'md' | 'json' | 'txt';
  }>;
};

type RuntimeAwareBackendRunConfig = BackendRunConfig & {
  runtimeContract?: RuntimeContract;
  toolset?: string;
  permissionMode?: string;
  additionalWorkingDirectories?: string[];
  allowedWriteRoots?: string[];
  requiredArtifacts?: RuntimeContract['requiredArtifacts'];
};

function makeConfig(): RuntimeAwareBackendRunConfig {
  return {
    runId: 'runtime-config-pass-through',
    workspacePath: '/tmp/department-runtime-workspace',
    prompt: 'Run the department delivery workflow',
    memoryContext: {
      projectMemories: [{
        type: 'project',
        name: 'existing-memory',
        content: 'Keep prior project memory entries intact.',
        updatedAt: '2026-04-19T00:00:00.000Z',
      }],
      departmentMemories: [],
      userPreferences: [],
    },
    runtimeContract: {
      workspaceRoot: '/tmp/department-runtime-workspace',
      additionalWorkingDirectories: [
        '/tmp/department-runtime-workspace/docs',
        '/tmp/department-runtime-workspace/specs',
      ],
      readRoots: [
        '/tmp/department-runtime-workspace',
        '/tmp/department-runtime-workspace/shared',
      ],
      writeRoots: [
        '/tmp/department-runtime-workspace/src',
        '/tmp/department-runtime-workspace/delivery',
      ],
      artifactRoot: '/tmp/department-runtime-workspace/.ag/runs/runtime-config-pass-through',
      executionClass: 'delivery',
      toolset: 'coding',
      permissionMode: 'acceptEdits',
      requiredArtifacts: [{
        path: 'delivery/acceptance-summary.md',
        required: true,
        format: 'md',
      }],
    },
    toolset: 'coding',
    permissionMode: 'acceptEdits',
    additionalWorkingDirectories: [
      '/tmp/department-runtime-workspace/docs',
      '/tmp/department-runtime-workspace/specs',
    ],
    allowedWriteRoots: [
      '/tmp/department-runtime-workspace/src',
      '/tmp/department-runtime-workspace/delivery',
    ],
    requiredArtifacts: [{
      path: 'delivery/acceptance-summary.md',
      required: true,
      format: 'md',
    }],
  };
}

describe('backend memory hooks runtime contract passthrough', () => {
  beforeEach(() => {
    clearMemoryHooks();
  });

  it('preserves department runtime fields while merging memory context', async () => {
    const config = makeConfig();

    registerMemoryHook({
      id: 'runtime-contract-test-hook',
      beforeRun: () => ({
        projectMemories: [{
          type: 'project',
          name: 'hook-memory',
          content: 'Inject hook-owned project memory.',
          updatedAt: '2026-04-19T00:01:00.000Z',
        }],
      }),
    });

    const enriched = await applyBeforeRunMemoryHooks(
      'claude-api' as never,
      config as BackendRunConfig,
    ) as RuntimeAwareBackendRunConfig;

    expect(enriched.runtimeContract).toEqual(config.runtimeContract);
    expect(enriched.toolset).toBe('coding');
    expect(enriched.permissionMode).toBe('acceptEdits');
    expect(enriched.additionalWorkingDirectories).toEqual([
      '/tmp/department-runtime-workspace/docs',
      '/tmp/department-runtime-workspace/specs',
    ]);
    expect(enriched.allowedWriteRoots).toEqual([
      '/tmp/department-runtime-workspace/src',
      '/tmp/department-runtime-workspace/delivery',
    ]);
    expect(enriched.requiredArtifacts).toEqual([{
      path: 'delivery/acceptance-summary.md',
      required: true,
      format: 'md',
    }]);
    expect(enriched.memoryContext?.projectMemories.map((entry) => entry.name)).toEqual([
      'existing-memory',
      'hook-memory',
    ]);
  });
});
