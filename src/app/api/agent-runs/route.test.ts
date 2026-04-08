import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/agents/dispatch-service', () => ({
  executeDispatch: vi.fn(async () => ({ runId: 'template-run' })),
  DispatchError: class DispatchError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/agents/prompt-executor', () => ({
  executePrompt: vi.fn(async () => ({ runId: 'prompt-run' })),
  PromptExecutionError: class PromptExecutionError extends Error {
    statusCode: number;

    constructor(message: string, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/agents/run-registry', () => ({
  listRuns: vi.fn(() => []),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { executeDispatch } from '@/lib/agents/dispatch-service';
import { executePrompt } from '@/lib/agents/prompt-executor';
import { POST } from './route';

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/agent-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/agent-runs', () => {
  beforeEach(() => {
    vi.mocked(executeDispatch).mockClear();
    vi.mocked(executePrompt).mockClear();
  });

  it('keeps legacy template dispatch compatibility', async () => {
    const res = await POST(makeRequest({
      workspace: 'file:///tmp/backend',
      prompt: '修复登录接口',
      templateId: 'coding-basic-template',
    }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ runId: 'template-run', status: 'starting' });
    expect(vi.mocked(executeDispatch)).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'file:///tmp/backend',
      prompt: '修复登录接口',
      templateId: 'coding-basic-template',
    }));
    expect(vi.mocked(executePrompt)).not.toHaveBeenCalled();
  });

  it('routes prompt execution targets to PromptExecutor', async () => {
    const res = await POST(makeRequest({
      workspace: 'file:///tmp/ai-news',
      prompt: '整理今天 AI 资讯重点',
      executionTarget: {
        kind: 'prompt',
        promptAssetRefs: ['daily-digest'],
        skillHints: ['research'],
      },
      triggerContext: {
        source: 'ceo-command',
      },
    }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ runId: 'prompt-run', status: 'starting' });
    expect(vi.mocked(executePrompt)).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'file:///tmp/ai-news',
      prompt: '整理今天 AI 资讯重点',
      executionTarget: {
        kind: 'prompt',
        promptAssetRefs: ['daily-digest'],
        skillHints: ['research'],
      },
      triggerContext: { source: 'ceo-command' },
    }));
    expect(vi.mocked(executeDispatch)).not.toHaveBeenCalled();
  });

  it('supports explicit template executionTarget requests', async () => {
    const res = await POST(makeRequest({
      workspace: 'file:///tmp/backend',
      prompt: '修复登录接口',
      executionTarget: {
        kind: 'template',
        templateId: 'coding-basic-template',
        stageId: 'implement',
      },
    }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ runId: 'template-run', status: 'starting' });
    expect(vi.mocked(executeDispatch)).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'coding-basic-template',
      stageId: 'implement',
    }));
    expect(vi.mocked(executePrompt)).not.toHaveBeenCalled();
  });

  it('rejects unsupported execution targets', async () => {
    const res = await POST(makeRequest({
      workspace: 'file:///tmp/ops',
      executionTarget: { kind: 'project-only' },
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unsupported execution target: project-only' });
  });
});