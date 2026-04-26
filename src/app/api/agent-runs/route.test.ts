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

vi.mock('@/lib/storage/gateway-db', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage/gateway-db')>('@/lib/storage/gateway-db');
  return {
    ...actual,
    countRunRecordsByFilter: vi.fn(() => 0),
    listRunRecordsByFilter: vi.fn(() => []),
  };
});

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
import { countRunRecordsByFilter, getGatewayDb, listRunRecordsByFilter } from '@/lib/storage/gateway-db';
import { listBudgetLedgerEntries, summarizeBudgetLedger } from '@/lib/company-kernel/budget-ledger-store';
import { GET, POST } from './route';

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
    vi.mocked(countRunRecordsByFilter).mockClear();
    vi.mocked(listRunRecordsByFilter).mockClear();
    const db = getGatewayDb();
    db.prepare('DELETE FROM budget_ledger').run();
    db.prepare('DELETE FROM budget_policies').run();
  });

  it('keeps legacy template dispatch compatibility', async () => {
    const res = await POST(makeRequest({
      workspace: 'file:///tmp/backend',
      prompt: '修复登录接口',
      templateId: 'coding-basic-template',
      triggerContext: {
        source: 'scheduler',
        schedulerJobId: 'job-1',
      },
    }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ runId: 'template-run', status: 'starting' });
    expect(vi.mocked(executeDispatch)).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'file:///tmp/backend',
      prompt: '修复登录接口',
      templateId: 'coding-basic-template',
      triggerContext: {
        source: 'scheduler',
        schedulerJobId: 'job-1',
      },
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

  it('records manual prompt dispatch in the budget ledger without autonomous dispatch quota', async () => {
    const workspace = 'file:///tmp/manual-budget-route';
    const res = await POST(makeRequest({
      workspace,
      prompt: '整理今天 AI 资讯重点',
      executionTarget: {
        kind: 'prompt',
      },
      triggerContext: {
        source: 'ceo-command',
      },
    }));

    expect(res.status).toBe(201);
    const entries = listBudgetLedgerEntries({
      scope: 'department',
      scopeId: workspace,
      decision: 'reserved',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].runId).toBe('prompt-run');
    expect(entries[0].metadata?.operationKind).toBe('manual.prompt');
    expect(summarizeBudgetLedger(entries).dispatches).toBe(0);
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

  it('supports workflow-run executionProfile requests', async () => {
    const res = await POST(makeRequest({
      workspace: 'file:///tmp/ai-news',
      prompt: '整理今天 AI 资讯重点',
      executionProfile: {
        kind: 'workflow-run',
        workflowRef: '/ai_digest',
        skillHints: ['research'],
      },
    }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ runId: 'prompt-run', status: 'starting' });
    expect(vi.mocked(executePrompt)).toHaveBeenCalledWith(expect.objectContaining({
      executionTarget: {
        kind: 'prompt',
        promptAssetRefs: ['/ai_digest'],
        skillHints: ['research'],
      },
    }));
    expect(vi.mocked(executeDispatch)).not.toHaveBeenCalled();
  });

  it('embeds runtime carrier into prompt taskEnvelope payloads', async () => {
    const executionProfile = {
      kind: 'workflow-run' as const,
      workflowRef: '/ai_digest',
      skillHints: ['research'],
    };
    const departmentRuntimeContract = {
      workspaceRoot: '/tmp/ai-news',
      toolset: 'research',
      additionalWorkingDirectories: ['/tmp/shared-context'],
      readRoots: ['/tmp/reference'],
    };

    const res = await POST(makeRequest({
      workspace: 'file:///tmp/ai-news',
      prompt: '整理今天 AI 资讯重点',
      executionProfile,
      departmentRuntimeContract,
    }));

    expect(res.status).toBe(201);
    expect(vi.mocked(executePrompt)).toHaveBeenCalledWith(expect.objectContaining({
      executionTarget: {
        kind: 'prompt',
        promptAssetRefs: ['/ai_digest'],
        skillHints: ['research'],
      },
      taskEnvelope: expect.objectContaining({
        executionProfile,
        departmentRuntimeContract,
      }),
    }));
    expect(vi.mocked(executeDispatch)).not.toHaveBeenCalled();
  });

  it('supports dag-orchestration executionProfile requests', async () => {
    const res = await POST(makeRequest({
      workspace: 'file:///tmp/backend',
      prompt: '修复登录接口',
      executionProfile: {
        kind: 'dag-orchestration',
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
  });

  it('supports review-flow executionProfile requests', async () => {
    const res = await POST(makeRequest({
      workspace: 'file:///tmp/backend',
      prompt: '评审设计方案',
      executionProfile: {
        kind: 'review-flow',
        templateId: 'spec-review-template',
        stageId: 'author-review',
        reviewPolicyId: 'default-strict',
      },
    }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ runId: 'template-run', status: 'starting' });
    expect(vi.mocked(executeDispatch)).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'spec-review-template',
      stageId: 'author-review',
    }));
  });

  it('embeds runtime carrier into template taskEnvelope payloads', async () => {
    const executionProfile = {
      kind: 'dag-orchestration' as const,
      templateId: 'coding-basic-template',
      stageId: 'implement',
    };
    const departmentRuntimeContract = {
      workspaceRoot: '/tmp/backend',
      artifactRoot: '.artifacts/run-1',
      toolset: 'coding',
      additionalWorkingDirectories: ['/tmp/shared-code'],
      writeRoots: ['/tmp/backend', '/tmp/shared-code'],
    };

    const res = await POST(makeRequest({
      workspace: 'file:///tmp/backend',
      prompt: '修复登录接口',
      executionProfile,
      departmentRuntimeContract,
    }));

    expect(res.status).toBe(201);
    expect(vi.mocked(executeDispatch)).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'coding-basic-template',
      stageId: 'implement',
      taskEnvelope: expect.objectContaining({
        executionProfile,
        departmentRuntimeContract,
      }),
    }));
    expect(vi.mocked(executePrompt)).not.toHaveBeenCalled();
  });

  it('forwards scheduler triggerContext to template dispatches', async () => {
    const res = await POST(makeRequest({
      workspace: 'file:///tmp/backend',
      prompt: '修复登录接口',
      templateId: 'coding-basic-template',
      triggerContext: {
        source: 'scheduler',
        schedulerJobId: 'job-1',
      },
    }));

    expect(res.status).toBe(201);
    expect(vi.mocked(executeDispatch)).toHaveBeenCalledWith(expect.objectContaining({
      triggerContext: {
        source: 'scheduler',
        schedulerJobId: 'job-1',
      },
    }));
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

describe('GET /api/agent-runs', () => {
  it('supports filtering by schedulerJobId', async () => {
    const req = new Request('http://localhost/api/agent-runs?schedulerJobId=job-1');
    await GET(req);

    expect(vi.mocked(countRunRecordsByFilter)).toHaveBeenCalledWith({ schedulerJobId: 'job-1' });
    expect(vi.mocked(listRunRecordsByFilter)).toHaveBeenCalledWith(
      { schedulerJobId: 'job-1' },
      { limit: 50, offset: 0 },
    );
  });

  it('returns paginated list items without heavyweight detail envelopes', async () => {
    vi.mocked(countRunRecordsByFilter).mockReturnValue(1);
    vi.mocked(listRunRecordsByFilter).mockReturnValue([
      {
        runId: 'run-1',
        stageId: 'product-spec',
        pipelineStageId: 'product-spec',
        workspace: 'file:///tmp/workspace',
        prompt: 'Write a product spec',
        status: 'completed',
        createdAt: '2026-04-20T10:00:00.000Z',
        taskEnvelope: {
          goal: 'Write a product spec',
          successCriteria: ['complete'],
        },
        promptResolution: {
          mode: 'workflow',
          requestedWorkflowRefs: [],
          requestedSkillHints: [],
          matchedWorkflowRefs: ['/product/spec'],
          matchedSkillRefs: [],
          resolutionReason: 'matched workflow',
        },
        result: {
          status: 'completed',
          summary: 'Spec created',
          changedFiles: ['docs/spec.md'],
          blockers: [],
          needsReview: [],
          promptResolution: {
            mode: 'workflow',
            requestedWorkflowRefs: [],
            requestedSkillHints: [],
            matchedWorkflowRefs: ['/product/spec'],
            matchedSkillRefs: [],
            resolutionReason: 'matched workflow',
          },
        },
        resultEnvelope: {
          runId: 'run-1',
          status: 'completed',
          summary: 'Spec created',
          outputArtifacts: [],
          promptResolution: {
            mode: 'workflow',
            requestedWorkflowRefs: [],
            requestedSkillHints: [],
            matchedWorkflowRefs: ['/product/spec'],
            matchedSkillRefs: [],
            resolutionReason: 'matched workflow',
          },
        },
        sessionProvenance: {
          handle: 'session-1',
          backendId: 'native-codex',
          handleKind: 'started',
          workspacePath: '/tmp/workspace',
          recordedAt: '2026-04-20T10:00:00.000Z',
          transcriptPath: '/tmp/transcript.jsonl',
        },
      } as never,
    ]);

    const res = await GET(new Request('http://localhost/api/agent-runs?pageSize=1'));
    const payload = await res.json();

    expect(payload).toEqual({
      items: [
        {
          runId: 'run-1',
          stageId: 'product-spec',
          pipelineStageId: 'product-spec',
          status: 'completed',
          workspace: 'file:///tmp/workspace',
          prompt: 'Write a product spec',
          createdAt: '2026-04-20T10:00:00.000Z',
          result: {
            status: 'completed',
            summary: 'Spec created',
            changedFiles: ['docs/spec.md'],
            blockers: [],
            needsReview: [],
          },
          resultEnvelope: {
            runId: 'run-1',
            status: 'completed',
            summary: 'Spec created',
            outputArtifacts: [],
          },
          sessionProvenance: {
            handle: 'session-1',
            backendId: 'native-codex',
            handleKind: 'started',
            workspacePath: '/tmp/workspace',
            recordedAt: '2026-04-20T10:00:00.000Z',
          },
        },
      ],
      page: 1,
      pageSize: 1,
      total: 1,
      hasMore: false,
    });
  });
});
