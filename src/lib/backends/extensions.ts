import type { AgentBackend } from './types';

export interface GetRecentStepsOptions {
  limit?: number;
}

export interface AgentBackendDiagnosticsExtension {
  getRecentSteps(handle: string, options?: GetRecentStepsOptions): Promise<unknown[]>;
}

export interface AgentBackendSessionMetadataExtension {
  annotateSession(handle: string, annotations: Record<string, unknown>): Promise<void>;
}

export interface AgentBackendRuntimeResolverExtension {
  resolveWorkspaceRuntime(
    workspacePath: string,
    workspaceUri: string,
  ): Promise<{ port: number; csrf: string; workspace?: string; apiKey: string }> | { port: number; csrf: string; workspace?: string; apiKey: string };
}

export function getBackendDiagnosticsExtension(
  backend: AgentBackend,
): AgentBackendDiagnosticsExtension | null {
  if (typeof (backend as AgentBackend & Partial<AgentBackendDiagnosticsExtension>).getRecentSteps === 'function') {
    return backend as AgentBackend & AgentBackendDiagnosticsExtension;
  }

  return null;
}

export function getBackendSessionMetadataExtension(
  backend: AgentBackend,
): AgentBackendSessionMetadataExtension | null {
  if (typeof (backend as AgentBackend & Partial<AgentBackendSessionMetadataExtension>).annotateSession === 'function') {
    return backend as AgentBackend & AgentBackendSessionMetadataExtension;
  }

  return null;
}

export function getBackendRuntimeResolverExtension(
  backend: AgentBackend,
): AgentBackendRuntimeResolverExtension | null {
  if (typeof (backend as AgentBackend & Partial<AgentBackendRuntimeResolverExtension>).resolveWorkspaceRuntime === 'function') {
    return backend as AgentBackend & AgentBackendRuntimeResolverExtension;
  }

  return null;
}