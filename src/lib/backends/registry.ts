import type { ProviderId } from '../providers';
import type { AgentBackend } from './types';

const globalForAgentBackends = globalThis as unknown as {
  __AGENT_BACKEND_REGISTRY__?: Map<ProviderId, AgentBackend>;
};

const backendRegistry = globalForAgentBackends.__AGENT_BACKEND_REGISTRY__ || new Map<ProviderId, AgentBackend>();

if (process.env.NODE_ENV !== 'production') {
  globalForAgentBackends.__AGENT_BACKEND_REGISTRY__ = backendRegistry;
}

export function registerAgentBackend(backend: AgentBackend): AgentBackend {
  backendRegistry.set(backend.providerId, backend);
  return backend;
}

export function hasAgentBackend(providerId: ProviderId): boolean {
  return backendRegistry.has(providerId);
}

export function getAgentBackend(providerId: ProviderId): AgentBackend {
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