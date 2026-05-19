import { describe, expect, it } from 'vitest';

import type { AgentRunState } from './group-types';
import {
  buildLegacyConversationHandleBinding,
  collectRunChildConversationIds,
  isAuthoritativeSessionHandle,
  resolvePrimaryConversationId,
  resolveRunSessionHandle,
} from './session-handle';

function makeRun(overrides: Partial<AgentRunState> = {}): AgentRunState {
  return {
    runId: 'run-1',
    stageId: 'stage-1',
    workspace: '/tmp/workspace',
    status: 'running',
    createdAt: '2026-05-10T00:00:00.000Z',
    prompt: 'test task',
    ...overrides,
  };
}

describe('session-handle helpers', () => {
  it('prefers session provenance handle over legacy run fields', () => {
    const run = makeRun({
      sessionProvenance: {
        handle: 'prov-123',
        backendId: 'claude-code',
        handleKind: 'started',
        workspacePath: '/tmp/workspace',
        recordedAt: '2026-05-10T00:00:00.000Z',
      },
      activeConversationId: 'active-legacy',
      childConversationId: 'child-legacy',
    });

    expect(resolveRunSessionHandle(run)).toBe('prov-123');
  });

  it('falls back to role progress handle when no run-level handle exists', () => {
    const run = makeRun({
      roles: [
        { roleId: 'author', round: 1, childConversationId: 'author-1', status: 'completed' },
        { roleId: 'reviewer', round: 1, childConversationId: 'reviewer-1', status: 'running' },
      ],
      childConversationId: 'run-child',
    });

    expect(resolveRunSessionHandle(run, 'reviewer')).toBe('reviewer-1');
  });

  it('mirrors a legacy binding from a single handle', () => {
    expect(buildLegacyConversationHandleBinding('cascade-1')).toEqual({
      childConversationId: 'cascade-1',
      activeConversationId: 'cascade-1',
    });
    expect(buildLegacyConversationHandleBinding(undefined)).toEqual({});
  });

  it('uses provenance-first authority checks for superseded branches', () => {
    const run = makeRun({
      sessionProvenance: {
        handle: 'current-session',
        backendId: 'claude-code',
        handleKind: 'resumed',
        workspacePath: '/tmp/workspace',
        recordedAt: '2026-05-10T00:00:00.000Z',
      },
      activeConversationId: 'stale-legacy',
    });

    expect(isAuthoritativeSessionHandle(run, 'current-session')).toBe(true);
    expect(isAuthoritativeSessionHandle(run, 'stale-legacy')).toBe(false);
  });

  it('resolves primary conversation ids with active-first fallback to child', () => {
    expect(resolvePrimaryConversationId(makeRun({
      activeConversationId: 'active-1',
      childConversationId: 'child-1',
    }))).toBe('active-1');

    expect(resolvePrimaryConversationId(makeRun({
      childConversationId: 'child-only',
    }))).toBe('child-only');
  });

  it('collects run and role child conversation ids without duplicates', () => {
    const run = makeRun({
      childConversationId: 'cascade-1',
      roles: [
        { roleId: 'author', round: 1, childConversationId: 'cascade-1', status: 'completed' },
        { roleId: 'reviewer', round: 1, childConversationId: 'cascade-2', status: 'running' },
      ],
    });

    expect(collectRunChildConversationIds(run)).toEqual(['cascade-1', 'cascade-2']);
  });
});
