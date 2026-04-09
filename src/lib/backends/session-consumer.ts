import {
  getAgentSession,
  markAgentSessionTerminalSeen,
  removeAgentSession,
} from './session-registry';
import type {
  AgentEvent,
  AgentSession,
  CancelledAgentEvent,
  CompletedAgentEvent,
  FailedAgentEvent,
  LiveStateAgentEvent,
  StartedAgentEvent,
} from './types';

export interface BackendSessionConsumerHooks {
  onStarted?(event: StartedAgentEvent): Promise<void> | void;
  onLiveState?(event: LiveStateAgentEvent): Promise<void> | void;
  onCompleted?(event: CompletedAgentEvent): Promise<void> | void;
  onFailed?(event: FailedAgentEvent): Promise<void> | void;
  onCancelled?(event: CancelledAgentEvent): Promise<void> | void;
}

export interface ConsumeAgentSessionOptions {
  releaseOnTerminal?: boolean;
}

export interface ConsumeAgentSessionResult {
  terminalEvent: AgentEvent | null;
  ignoredEventCount: number;
  processedKinds: AgentEvent['kind'][];
}

function isTerminalEvent(event: AgentEvent): event is CompletedAgentEvent | FailedAgentEvent | CancelledAgentEvent {
  return event.kind === 'completed' || event.kind === 'failed' || event.kind === 'cancelled';
}

async function runHook(hooks: BackendSessionConsumerHooks, event: AgentEvent): Promise<void> {
  switch (event.kind) {
    case 'started':
      await hooks.onStarted?.(event);
      return;
    case 'live_state':
      await hooks.onLiveState?.(event);
      return;
    case 'completed':
      await hooks.onCompleted?.(event);
      return;
    case 'failed':
      await hooks.onFailed?.(event);
      return;
    case 'cancelled':
      await hooks.onCancelled?.(event);
      return;
  }
}

export async function consumeAgentSession(
  runId: string,
  session: AgentSession,
  hooks: BackendSessionConsumerHooks = {},
  options: ConsumeAgentSessionOptions = {},
): Promise<ConsumeAgentSessionResult> {
  let terminalEvent: AgentEvent | null = null;
  let ignoredEventCount = 0;
  const processedKinds: AgentEvent['kind'][] = [];

  for await (const event of session.events()) {
    const record = getAgentSession(runId);

    if (record?.terminalSeen) {
      ignoredEventCount += 1;
      continue;
    }

    if (record?.cancelRequested && event.kind === 'completed') {
      ignoredEventCount += 1;
      continue;
    }

    processedKinds.push(event.kind);

    if (isTerminalEvent(event)) {
      markAgentSessionTerminalSeen(runId);
      terminalEvent = event;
    }

    await runHook(hooks, event);

    if (isTerminalEvent(event)) {
      if (options.releaseOnTerminal !== false) {
        removeAgentSession(runId);
      }
      break;
    }
  }

  return {
    terminalEvent,
    ignoredEventCount,
    processedKinds,
  };
}