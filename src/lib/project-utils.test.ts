import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  getErrorMessage,
  summarizeFailureText,
  looksLikeCompletionText,
  deriveRunFailureReason,
  normalizeProject,
} from './project-utils';
import type { AgentRunState } from '@/lib/agents/group-types';

const mockedGetRun = vi.fn<(runId: string) => AgentRunState | undefined>();

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getErrorMessage
// ---------------------------------------------------------------------------
describe('getErrorMessage', () => {
  it('extracts message from Error', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error values', () => {
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage('str')).toBe('str');
  });
});

// ---------------------------------------------------------------------------
// summarizeFailureText
// ---------------------------------------------------------------------------
describe('summarizeFailureText', () => {
  it('returns undefined for falsy input', () => {
    expect(summarizeFailureText(undefined)).toBeUndefined();
    expect(summarizeFailureText('')).toBeUndefined();
  });

  it('strips markdown headings', () => {
    expect(summarizeFailureText('## Error Details\nSomething broke')).toBe('Error Details');
  });

  it('returns first meaningful line', () => {
    expect(summarizeFailureText('\n\nFirst line\nSecond')).toBe('First line');
  });

  it('truncates to 240 chars', () => {
    const long = 'A'.repeat(300);
    const result = summarizeFailureText(long)!;
    expect(result.length).toBe(240);
    expect(result.endsWith('...')).toBe(true);
  });

  it('returns short text as-is', () => {
    expect(summarizeFailureText('Short')).toBe('Short');
  });
});

// ---------------------------------------------------------------------------
// looksLikeCompletionText
// ---------------------------------------------------------------------------
describe('looksLikeCompletionText', () => {
  it.each(['completed', 'done', 'finished', 'ready', '任务完成'])('detects "%s"', (text) => {
    expect(looksLikeCompletionText(text)).toBe(true);
  });

  it.each(['running', 'failed', 'blocked', undefined])('rejects "%s"', (text) => {
    expect(looksLikeCompletionText(text as string | undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveRunFailureReason
// ---------------------------------------------------------------------------
describe('deriveRunFailureReason', () => {
  it('returns undefined for null run', () => {
    expect(deriveRunFailureReason(null as any)).toBeUndefined();
  });

  it('returns lastError when present', () => {
    const run = { lastError: 'timeout', result: null, roles: [], status: 'failed' };
    expect(deriveRunFailureReason(run as any)).toBe('timeout');
  });

  it('returns first blocker', () => {
    const run = { lastError: '', result: { blockers: ['no quota'] }, roles: [], status: 'failed' };
    expect(deriveRunFailureReason(run as any)).toBe('no quota');
  });

  it('returns failed role summary', () => {
    const run = {
      lastError: '',
      result: { blockers: [] },
      roles: [{ result: { status: 'failed', summary: 'Role crashed' } }],
      status: 'failed',
    };
    expect(deriveRunFailureReason(run as any)).toBe('Role crashed');
  });
});

// ---------------------------------------------------------------------------
// normalizeProject
// ---------------------------------------------------------------------------
describe('normalizeProject', () => {
  it('collects runIds from stages', () => {
    mockedGetRun.mockReturnValue(undefined as any);
    const project = {
      runIds: ['r1'],
      pipelineState: {
        stages: [
          { runId: 'r2', status: 'completed', branches: [] },
          { runId: 'r1', status: 'completed', branches: [] },
        ],
      },
    };
    const result = normalizeProject(project, { getRunById: mockedGetRun });
    expect(result.runIds).toEqual(expect.arrayContaining(['r1', 'r2']));
    expect(result.runIds.length).toBe(2);
  });

  it('collects childProjectIds from branches', () => {
    mockedGetRun.mockReturnValue(undefined as any);
    const project = {
      runIds: [],
      pipelineState: {
        stages: [
          { status: 'completed', branches: [{ subProjectId: 'p1' }, { subProjectId: 'p2' }] },
        ],
      },
    };
    const result = normalizeProject(project, { getRunById: mockedGetRun });
    expect((result as any).childProjectIds).toEqual(expect.arrayContaining(['p1', 'p2']));
  });

  it('derives lastError for failed stage from run', () => {
    mockedGetRun.mockReturnValue({
      lastError: 'model error',
      result: null,
      roles: [],
      status: 'failed',
    } as any);
    const project = {
      runIds: [],
      pipelineState: {
        stages: [{ runId: 'r1', status: 'failed', branches: [] }],
      },
    };
    const result = normalizeProject(project, { getRunById: mockedGetRun });
    expect(result.pipelineState!.stages[0].lastError).toBe('model error');
  });

  it('does not overwrite existing lastError', () => {
    mockedGetRun.mockReturnValue({ lastError: 'new error' } as any);
    const project = {
      runIds: [],
      pipelineState: {
        stages: [{ runId: 'r1', status: 'failed', lastError: 'original', branches: [] }],
      },
    };
    const result = normalizeProject(project, { getRunById: mockedGetRun });
    expect(result.pipelineState!.stages[0].lastError).toBe('original');
  });

  it('handles project without pipelineState', () => {
    const project = { runIds: ['r1'] };
    const result = normalizeProject(project as any);
    expect(result.runIds).toEqual(['r1']);
    expect(result.pipelineState).toBeUndefined();
  });
});
