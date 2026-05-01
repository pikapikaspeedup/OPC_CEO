import type { AgentBackendId } from '../providers';
import type { AgentBackend } from './types';

const globalForAgentBackends = globalThis as unknown as {
  __AGENT_BACKEND_REGISTRY__?: Map<AgentBackendId, AgentBackend>;
};

const backendRegistry = globalForAgentBackends.__AGENT_BACKEND_REGISTRY__ || new Map<AgentBackendId, AgentBackend>();

if (process.env.NODE_ENV !== 'production') {
  globalForAgentBackends.__AGENT_BACKEND_REGISTRY__ = backendRegistry;
}

export function registerAgentBackend(backend: AgentBackend): AgentBackend {
  backendRegistry.set(backend.providerId, backend);
  return backend;
}

export function hasAgentBackend(providerId: AgentBackendId): boolean {
  return backendRegistry.has(providerId);
}

export function getAgentBackend(providerId: AgentBackendId): AgentBackend {
  const backend = backendRegistry.get(providerId);
  if (!backend) {
    throw new Error(`AgentBackend not registered for provider: ${providerId}`);
  }
  return backend;
}

export function listAgentBackends(): AgentBackend[] {
  return Array.from(backendRegistry.values());
}

export function clearAgentBackends(): void {
  backendRegistry.clear();
}
