import { discoverLanguageServers, getApiKey } from '../bridge/gateway';

export interface AntigravityRuntimeConnection {
  port: number;
  csrf: string;
  workspace?: string;
  apiKey: string;
}

export async function resolveAntigravityRuntimeConnection(
  workspacePath: string,
  workspaceUri: string,
): Promise<AntigravityRuntimeConnection> {
  const servers = await discoverLanguageServers();
  const server = servers.find(
    (entry) => entry.workspace && (entry.workspace.includes(workspacePath) || workspacePath.includes(entry.workspace)),
  );
  if (!server) {
    throw new Error(`No language_server found for workspace: ${workspaceUri}`);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No API key available');
  }

  return {
    ...server,
    apiKey,
  };
}