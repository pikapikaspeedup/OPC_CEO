import { createLogger } from '@/lib/logger';
import { getPlaygrounds } from '@/lib/bridge/gateway';
import { addHiddenWorkspace, listHiddenWorkspaces, removeHiddenWorkspace } from '@/lib/storage/gateway-db';
import { minimizeAntigravityWindow } from '@/lib/window-control';
import { listKnownWorkspaces, registerWorkspace } from '@/lib/workspace-catalog';

const log = createLogger('WorkspaceRoutes');

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
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
  } catch (error: unknown) {
    return json({ error: error instanceof Error ? error.message : 'Failed to import workspace' }, { status: 400 });
  }
}

export async function handleWorkspacesClosePost(req: Request): Promise<Response> {
  const { workspace } = await req.json();
  if (!workspace) {
    return json({ error: 'Missing workspace' }, { status: 400 });
  }

  addHiddenWorkspace(workspace);

  log.info({ workspace }, 'Hidden workspace from UI (server still running)');
  const windowMinimized = await minimizeAntigravityWindow(workspace);
  if (windowMinimized) {
    log.info({ workspace }, 'Minimized Antigravity window');
  }

  return json({ ok: true, hidden: true, windowMinimized });
}

export async function handleWorkspacesCloseGet(): Promise<Response> {
  return json(listHiddenWorkspaces());
}

export async function handleWorkspacesCloseDelete(req: Request): Promise<Response> {
  const { workspace } = await req.json();
  if (!workspace) {
    return json({ error: 'Missing workspace' }, { status: 400 });
  }

  removeHiddenWorkspace(workspace);
  log.info({ workspace }, 'Unhidden workspace');
  return json({ ok: true, hidden: false });
}
