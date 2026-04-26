import { mkdirSync, readFileSync, writeFileSync } from 'fs';

import { createLogger } from '@/lib/logger';
import { getPlaygrounds } from '@/lib/bridge/gateway';
import { GATEWAY_HOME, HIDDEN_WS_FILE } from '@/lib/agents/gateway-home';
import { minimizeAntigravityWindow } from '@/lib/window-control';
import { listKnownWorkspaces, registerWorkspace } from '@/lib/workspace-catalog';

const log = createLogger('WorkspaceRoutes');

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function readHidden(): string[] {
  try {
    return JSON.parse(readFileSync(HIDDEN_WS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeHidden(list: string[]): void {
  mkdirSync(GATEWAY_HOME, { recursive: true });
  writeFileSync(HIDDEN_WS_FILE, JSON.stringify(list, null, 2));
}

export async function handleWorkspacesGet(): Promise<Response> {
  return json({
    workspaces: listKnownWorkspaces().map((workspace) => ({
      name: workspace.name,
      uri: workspace.uri,
    })),
    playgrounds: getPlaygrounds(),
  });
}

export async function handleWorkspacesImportPost(req: Request): Promise<Response> {
  const { workspace } = await req.json();
  if (!workspace || typeof workspace !== 'string') {
    return json({ error: 'Missing workspace path' }, { status: 400 });
  }

  try {
    const registered = registerWorkspace({
      workspace,
      sourceKind: 'manual-import',
    });
    return json({
      ok: true,
      workspace: {
        name: registered.name,
        uri: registered.uri,
      },
    });
  } catch (error: any) {
    return json({ error: error.message || 'Failed to import workspace' }, { status: 400 });
  }
}

export async function handleWorkspacesClosePost(req: Request): Promise<Response> {
  const { workspace } = await req.json();
  if (!workspace) {
    return json({ error: 'Missing workspace' }, { status: 400 });
  }

  const hidden = readHidden();
  if (!hidden.includes(workspace)) {
    hidden.push(workspace);
    writeHidden(hidden);
  }

  log.info({ workspace }, 'Hidden workspace from UI (server still running)');
  const windowMinimized = await minimizeAntigravityWindow(workspace);
  if (windowMinimized) {
    log.info({ workspace }, 'Minimized Antigravity window');
  }

  return json({ ok: true, hidden: true, windowMinimized });
}

export async function handleWorkspacesCloseGet(): Promise<Response> {
  return json(readHidden());
}

export async function handleWorkspacesCloseDelete(req: Request): Promise<Response> {
  const { workspace } = await req.json();
  if (!workspace) {
    return json({ error: 'Missing workspace' }, { status: 400 });
  }

  writeHidden(readHidden().filter((item) => item !== workspace));
  log.info({ workspace }, 'Unhidden workspace');
  return json({ ok: true, hidden: false });
}
