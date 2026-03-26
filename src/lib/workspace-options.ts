import type { Server, Workspace } from '@/lib/types';

export interface WorkspaceOption {
  uri: string;
  name: string;
  running: boolean;
  hidden: boolean;
}

export function isWorkspaceHidden(wsUri: string, hiddenWorkspaces: string[]): boolean {
  return hiddenWorkspaces.some(h => wsUri === h || wsUri.includes(h) || h.includes(wsUri));
}

export function buildWorkspaceOptions(
  servers: Server[],
  workspaces: Workspace[],
  hiddenWorkspaces: string[],
): WorkspaceOption[] {
  const allWs = new Map<string, WorkspaceOption>();

  servers.forEach(server => {
    const ws = server.workspace || '';
    if (!ws || ws.includes('/playground/')) return;
    allWs.set(ws, {
      uri: ws,
      name: ws.replace('file://', '').split('/').pop() || ws,
      running: true,
      hidden: isWorkspaceHidden(ws, hiddenWorkspaces),
    });
  });

  workspaces.forEach(workspace => {
    const uri = workspace.uri || '';
    if (!uri || allWs.has(uri) || uri.includes('/playground/')) return;
    allWs.set(uri, {
      uri,
      name: uri.replace('file://', '').split('/').pop() || uri,
      running: false,
      hidden: isWorkspaceHidden(uri, hiddenWorkspaces),
    });
  });

  return [...allWs.values()].sort((a, b) => {
    if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
    if (a.running !== b.running) return a.running ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
