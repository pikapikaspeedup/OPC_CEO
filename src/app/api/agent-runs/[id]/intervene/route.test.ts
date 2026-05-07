import { describe, expect, it, vi, beforeEach } from 'vitest';

const { mockGetRun, mockCancelPromptRun, mockCancelRun, mockCancelSystemImprovementCodexRun } = vi.hoisted(() => ({
  mockGetRun: vi.fn(),
  mockCancelPromptRun: vi.fn(async () => undefined),
  mockCancelRun: vi.fn(async () => undefined),
  mockCancelSystemImprovementCodexRun: vi.fn(async () => undefined),
}));

vi.mock('@/lib/agents/run-registry', () => ({
  getRun: (...args: unknown[]) => mockGetRun(...args),
}));

vi.mock('@/lib/agents/group-runtime', () => ({
  interveneRun: vi.fn(),
  cancelRun: (...args: unknown[]) => mockCancelRun(...args),
  InterventionConflictError: class InterventionConflictError extends Error {},
}));

vi.mock('@/lib/agents/prompt-executor', () => ({
  cancelPromptRun: (...args: unknown[]) => mockCancelPromptRun(...args),
  evaluatePromptRun: vi.fn(),
}));

vi.mock('@/lib/company-kernel/self-improvement-codex-execution', () => ({
  cancelSystemImprovementCodexRun: (...args: unknown[]) => mockCancelSystemImprovementCodexRun(...args),
  isSystemImprovementCodexTrackingRun: (run: { provider?: string; triggerContext?: { intentSummary?: string } } | null | undefined) =>
    Boolean(run?.provider === 'codex-cli' && run?.triggerContext?.intentSummary?.startsWith('system-improvement-codex:')),
}));

vi.mock('@/server/shared/proxy', () => ({
  proxyToControlPlane: vi.fn(),
  proxyToRuntime: vi.fn(),
  shouldProxyControlPlaneRequest: () => false,
  shouldProxyRuntimeRequest: () => false,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { POST } from './route';

describe('POST /api/agent-runs/:id/intervene', () => {
  beforeEach(() => {
    mockGetRun.mockReset();
    mockCancelPromptRun.mockReset();
    mockCancelRun.mockReset();
    mockCancelSystemImprovementCodexRun.mockReset();
  });

  it('routes self-improvement codex tracking runs to the dedicated cancel path', async () => {
    mockGetRun.mockReturnValue({
      runId: 'run-1',
      provider: 'codex-cli',
      executorKind: 'prompt',
      triggerContext: {
        source: 'api',
        intentSummary: 'system-improvement-codex:proposal-1',
      },
    });

    const req = new Request('http://localhost/api/agent-runs/run-1/intervene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });

    const res = await POST(req, {
      params: Promise.resolve({ id: 'run-1' }),
    });

    expect(res.status).toBe(202);
    expect(mockCancelSystemImprovementCodexRun).toHaveBeenCalledWith('run-1');
    expect(mockCancelPromptRun).not.toHaveBeenCalled();
    expect(mockCancelRun).not.toHaveBeenCalled();
  });
});
