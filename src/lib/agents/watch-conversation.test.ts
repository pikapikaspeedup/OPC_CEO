import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStreamAgentState, mockGetTrajectorySteps } = vi.hoisted(() => ({
  mockStreamAgentState: vi.fn(),
  mockGetTrajectorySteps: vi.fn(),
}));

vi.mock('../bridge/grpc', () => ({
  streamAgentState: (...args: any[]) => mockStreamAgentState(...args),
  getTrajectorySteps: (...args: any[]) => mockGetTrajectorySteps(...args),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { watchConversation } from './watch-conversation';

describe('watch-conversation characterization', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockStreamAgentState.mockReset();
    mockGetTrajectorySteps.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits stream-driven updates with step count and idle transition', () => {
    let onStreamUpdate: ((update: any) => void) | undefined;

    mockStreamAgentState.mockImplementation((_port: number, _csrf: string, _cascadeId: string, onUpdate: any) => {
      onStreamUpdate = onUpdate;
      return vi.fn();
    });

    const states: any[] = [];
    const stop = watchConversation(
      { port: 1, csrf: 'csrf' },
      'cascade-1',
      (state) => states.push(state),
      undefined,
      'api-key',
    );

    onStreamUpdate?.({
      status: 'CASCADE_RUN_STATUS_RUNNING',
      mainTrajectoryUpdate: {
        stepsUpdate: {
          steps: [
            {
              type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
              status: 'CORTEX_STEP_STATUS_DONE',
            },
          ],
        },
      },
    });

    onStreamUpdate?.({
      status: 'CASCADE_RUN_STATUS_IDLE',
      mainTrajectoryUpdate: {},
    });

    expect(states).toHaveLength(2);
    expect(states[0]).toEqual(expect.objectContaining({
      cascadeStatus: 'running',
      isActive: true,
      stepCount: 1,
      lastStepType: 'PLANNER_RESPONSE',
    }));
    expect(states[1]).toEqual(expect.objectContaining({
      cascadeStatus: 'idle',
      isActive: false,
      stepCount: 1,
    }));

    stop();
  });

  it('treats error steps as inactive even when cascade status is still running', () => {
    let onStreamUpdate: ((update: any) => void) | undefined;

    mockStreamAgentState.mockImplementation((_port: number, _csrf: string, _cascadeId: string, onUpdate: any) => {
      onStreamUpdate = onUpdate;
      return vi.fn();
    });

    const states: any[] = [];
    const stop = watchConversation(
      { port: 1, csrf: 'csrf' },
      'cascade-1',
      (state) => states.push(state),
    );

    onStreamUpdate?.({
      status: 'CASCADE_RUN_STATUS_RUNNING',
      mainTrajectoryUpdate: {
        stepsUpdate: {
          steps: [
            {
              type: 'CORTEX_STEP_TYPE_APPLY_PATCH',
              status: 'CORTEX_STEP_STATUS_ERROR',
            },
          ],
        },
      },
    });

    expect(states[0]).toEqual(expect.objectContaining({
      cascadeStatus: 'running',
      hasErrorSteps: true,
      isActive: false,
    }));

    stop();
  });

  it('uses heartbeat polling when apiKey is available and the stream goes silent', async () => {
    mockStreamAgentState.mockImplementation(() => vi.fn());
    mockGetTrajectorySteps.mockResolvedValue({
      steps: [
        {
          type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
          status: 'CORTEX_STEP_STATUS_DONE',
        },
      ],
    });

    const states: any[] = [];
    const stop = watchConversation(
      { port: 1, csrf: 'csrf' },
      'cascade-1',
      (state) => states.push(state),
      undefined,
      'api-key',
    );

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockGetTrajectorySteps).toHaveBeenCalledWith(1, 'csrf', 'api-key', 'cascade-1');
    expect(states[0]).toEqual(expect.objectContaining({
      stepCount: 1,
      lastStepType: 'PLANNER_RESPONSE',
    }));

    stop();
  });
});