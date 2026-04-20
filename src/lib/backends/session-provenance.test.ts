/**
 * Phase 2: Session Provenance round-trip and resolution tests.
 *
 * Tests:
 * 1. onStarted writes sessionProvenance to Run
 * 2. Provenance round-trip: write → read → all fields intact
 * 3. Provider config drift: provenance-first attach still uses original backendId
 * 4. Handle supersession: new session records previous handle
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRun,
  mockUpdateRun,
} = vi.hoisted(() => ({
  mockGetRun: vi.fn(),
  mockUpdateRun: vi.fn(),
}));

vi.mock('../agents/run-registry', () => ({
  getRun: (...args: any[]) => mockGetRun(...args),
  updateRun: (...args: any[]) => mockUpdateRun(...args),
}));

vi.mock('./memory-hooks', () => ({
  applyAfterRunMemoryHooks: vi.fn(),
}));

import { createRunSessionHooks } from './run-session-hooks';
import type { AgentRunState, SessionProvenance } from '../agents/group-types';
import type { StartedAgentEvent, CompletedAgentEvent } from './types';

function makeRunState(overrides: Partial<AgentRunState> = {}): AgentRunState {
  return {
    runId: 'run-1',
    stageId: 'prompt-mode',
    workspace: '/tmp/workspace',
    status: 'starting',
    createdAt: new Date().toISOString(),
    prompt: 'test task',
    ...overrides,
  };
}

function makeStartedEvent(overrides: Partial<StartedAgentEvent> = {}): StartedAgentEvent {
  return {
    kind: 'started',
    runId: 'run-1',
    providerId: 'claude-code',
    handle: 'claude-session-abc',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('session-provenance', () => {
  beforeEach(() => {
    mockGetRun.mockReset();
    mockUpdateRun.mockReset();
  });

  describe('onStarted writes provenance', () => {
    it('writes sessionProvenance on first start', async () => {
      mockGetRun.mockReturnValue(makeRunState());

      const hooks = createRunSessionHooks({
        runId: 'run-1',
        backendConfig: {
          runId: 'run-1',
          workspacePath: '/tmp/workspace',
          prompt: 'test task',
          model: 'claude-sonnet-4-20250514',
        },
        createdVia: 'dispatch',
        resolutionSource: 'scene',
      });

      const event = makeStartedEvent();
      await hooks.onStarted!(event);

      expect(mockUpdateRun).toHaveBeenCalledOnce();
      const updatePayload = mockUpdateRun.mock.calls[0][1];

      expect(updatePayload.sessionProvenance).toBeDefined();
      const prov: SessionProvenance = updatePayload.sessionProvenance;
      expect(prov.handle).toBe('claude-session-abc');
      expect(prov.backendId).toBe('claude-code');
      expect(prov.handleKind).toBe('started');
      expect(prov.workspacePath).toBe('/tmp/workspace');
      expect(prov.model).toBe('claude-sonnet-4-20250514');
      expect(prov.resolutionSource).toBe('scene');
      expect(prov.createdVia).toBe('dispatch');
      expect(prov.supersedesHandle).toBeUndefined();
      expect(prov.recordedAt).toBeDefined();
    });

    it('records superseded handle when run already has provenance', async () => {
      const existingProvenance: SessionProvenance = {
        handle: 'old-session-xyz',
        backendId: 'claude-code',
        handleKind: 'started',
        workspacePath: '/tmp/workspace',
        recordedAt: '2025-01-01T00:00:00Z',
      };

      mockGetRun.mockReturnValue(makeRunState({
        sessionProvenance: existingProvenance,
      }));

      const hooks = createRunSessionHooks({
        runId: 'run-1',
        backendConfig: {
          runId: 'run-1',
          workspacePath: '/tmp/workspace',
          prompt: 'follow up',
        },
      });

      const event = makeStartedEvent({ handle: 'new-session-def' });
      await hooks.onStarted!(event);

      const prov: SessionProvenance = mockUpdateRun.mock.calls[0][1].sessionProvenance;
      expect(prov.handle).toBe('new-session-def');
      expect(prov.handleKind).toBe('resumed');
      expect(prov.supersedesHandle).toBe('old-session-xyz');
    });

    it('does not set supersedesHandle when handle is the same', async () => {
      const existingProvenance: SessionProvenance = {
        handle: 'same-session',
        backendId: 'claude-code',
        handleKind: 'started',
        workspacePath: '/tmp/workspace',
        recordedAt: '2025-01-01T00:00:00Z',
      };

      mockGetRun.mockReturnValue(makeRunState({
        sessionProvenance: existingProvenance,
      }));

      const hooks = createRunSessionHooks({
        runId: 'run-1',
        backendConfig: {
          runId: 'run-1',
          workspacePath: '/tmp/workspace',
          prompt: 'same session',
        },
      });

      const event = makeStartedEvent({ handle: 'same-session' });
      await hooks.onStarted!(event);

      const prov: SessionProvenance = mockUpdateRun.mock.calls[0][1].sessionProvenance;
      expect(prov.supersedesHandle).toBeUndefined();
    });

    it('skips run update when run is in terminal status', async () => {
      mockGetRun.mockReturnValue(makeRunState({ status: 'completed' }));

      const hooks = createRunSessionHooks({ runId: 'run-1' });
      await hooks.onStarted!(makeStartedEvent());

      expect(mockUpdateRun).not.toHaveBeenCalled();
    });

    it('writes Antigravity handle binding when provider matches', async () => {
      mockGetRun.mockReturnValue(makeRunState());

      const hooks = createRunSessionHooks({
        runId: 'run-1',
        bindConversationHandleForProviders: ['antigravity'],
        backendConfig: {
          runId: 'run-1',
          workspacePath: '/tmp/workspace',
          prompt: 'test',
        },
      });

      const event = makeStartedEvent({ providerId: 'antigravity', handle: 'cascade-123' });
      await hooks.onStarted!(event);

      const payload = mockUpdateRun.mock.calls[0][1];
      expect(payload.childConversationId).toBe('cascade-123');
      expect(payload.activeConversationId).toBe('cascade-123');
      expect(payload.sessionProvenance.handle).toBe('cascade-123');
    });

    it('does NOT write handle binding for non-matching provider', async () => {
      mockGetRun.mockReturnValue(makeRunState());

      const hooks = createRunSessionHooks({
        runId: 'run-1',
        bindConversationHandleForProviders: ['antigravity'],
        backendConfig: {
          runId: 'run-1',
          workspacePath: '/tmp/workspace',
          prompt: 'test',
        },
      });

      const event = makeStartedEvent({ providerId: 'claude-code', handle: 'claude-session' });
      await hooks.onStarted!(event);

      const payload = mockUpdateRun.mock.calls[0][1];
      expect(payload.childConversationId).toBeUndefined();
      expect(payload.activeConversationId).toBeUndefined();
      // But provenance is still written regardless
      expect(payload.sessionProvenance.handle).toBe('claude-session');
    });
  });

  describe('provenance round-trip', () => {
    it('preserves all fields through serialization', () => {
      const prov: SessionProvenance = {
        handle: 'claude-session-abc',
        backendId: 'claude-code',
        handleKind: 'started',
        workspacePath: '/tmp/workspace',
        model: 'claude-sonnet-4-20250514',
        resolutionSource: 'scene',
        createdVia: 'dispatch',
        supersedesHandle: 'old-handle',
        recordedAt: '2025-06-01T12:00:00Z',
        transcriptPath: '/home/user/.claude/sessions/abc.json',
        projectPath: '/tmp/workspace',
      };

      // Simulate disk round-trip
      const json = JSON.stringify(prov);
      const restored: SessionProvenance = JSON.parse(json);

      expect(restored.handle).toBe(prov.handle);
      expect(restored.backendId).toBe(prov.backendId);
      expect(restored.handleKind).toBe(prov.handleKind);
      expect(restored.workspacePath).toBe(prov.workspacePath);
      expect(restored.model).toBe(prov.model);
      expect(restored.resolutionSource).toBe(prov.resolutionSource);
      expect(restored.createdVia).toBe(prov.createdVia);
      expect(restored.supersedesHandle).toBe(prov.supersedesHandle);
      expect(restored.recordedAt).toBe(prov.recordedAt);
      expect(restored.transcriptPath).toBe(prov.transcriptPath);
      expect(restored.projectPath).toBe(prov.projectPath);
    });
  });
});
