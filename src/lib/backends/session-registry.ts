import type { AgentSession } from './types';

export interface ActiveAgentSessionRecord {
  runId: string;
  providerId: AgentSession['providerId'];
  handle: string;
  session: AgentSession;
  cancelRequested: boolean;
  terminalSeen: boolean;
  registeredAt: string;
}

const globalForAgentSessions = globalThis as unknown as {
  __AGENT_SESSION_REGISTRY__?: Map<string, ActiveAgentSessionRecord>;
};

const sessionRegistry = globalForAgentSessions.__AGENT_SESSION_REGISTRY__ || new Map<string, ActiveAgentSessionRecord>();

if (process.env.NODE_ENV !== 'production') {
  globalForAgentSessions.__AGENT_SESSION_REGISTRY__ = sessionRegistry;
}

export function registerAgentSession(session: AgentSession): ActiveAgentSessionRecord {
  const record: ActiveAgentSessionRecord = {
    runId: session.runId,
    providerId: session.providerId,
    handle: session.handle,
    session,
    cancelRequested: false,
    terminalSeen: false,
    registeredAt: new Date().toISOString(),
  };
  sessionRegistry.set(session.runId, record);
  return record;
}

export function getAgentSession(runId: string): ActiveAgentSessionRecord | null {
  return sessionRegistry.get(runId) ?? null;
}

export function listAgentSessions(): ActiveAgentSessionRecord[] {
  return Array.from(sessionRegistry.values());
}

export function markAgentSessionCancelRequested(runId: string): ActiveAgentSessionRecord | null {
  const record = sessionRegistry.get(runId);
  if (!record) return null;
  record.cancelRequested = true;
  return record;
}

export function markAgentSessionTerminalSeen(runId: string): ActiveAgentSessionRecord | null {
  const record = sessionRegistry.get(runId);
  if (!record) return null;
  record.terminalSeen = true;
  return record;
}

export function removeAgentSession(runId: string): boolean {
  return sessionRegistry.delete(runId);
}

export function clearAgentSessions(): void {
  sessionRegistry.clear();
}