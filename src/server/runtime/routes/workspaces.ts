import { spawnSync } from 'child_process';

import { discoverLanguageServers } from '@/lib/bridge/gateway';
import { createLogger } from '@/lib/logger';
import { registerWorkspace } from '@/lib/workspace-catalog';
import { closeAntigravityWindow } from '@/lib/window-control';

const log = createLogger('RuntimeWorkspaceRoutes');
const ANTIGRAVITY_CLI = '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity';

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export async function handleWorkspacesLaunchPost(req: Request): Promise<Response> {
  const { workspace } = await req.json();
  if (!workspace) {
    return json({ error: 'Missing workspace path' }, { status: 400 });
  }

  let workspacePath = workspace.replace(/^file:\/\//, '');
  try {
    const registered = registerWorkspace({
      workspace: workspacePath,
      sourceKind: 'manual-import',
    });
    workspacePath = registered.path;
  } catch (error: any) {
    return json({ error: error.message }, { status: 400 });
  }

  log.info({ workspacePath }, 'Opening workspace');
  try {
    spawnSync(ANTIGRAVITY_CLI, ['--new-window', workspacePath], {
      timeout: 5000,
      stdio: 'ignore',
    });
    log.info({ workspacePath }, 'Antigravity CLI executed');
    return json({ ok: true, launched: workspacePath });
  } catch (error: any) {
    log.error({ err: error.message, workspacePath }, 'Launch failed');
    return json({ error: error.message }, { status: 500 });
  }
}

export async function handleWorkspacesKillPost(req: Request): Promise<Response> {
  const { workspace } = await req.json();
  if (!workspace) {
    return json({ error: 'Missing workspace' }, { status: 400 });
  }

  const servers = await discoverLanguageServers();
  const target = servers.find((server) =>
    server.workspace === workspace
    || server.workspace?.includes(workspace)
    || workspace.includes(server.workspace || '\0'));

  if (!target) {
    return json({ error: 'No server found for this workspace' }, { status: 404 });
  }

  log.info({ workspace }, 'Trying to close Antigravity window');
  try {
    const success = await closeAntigravityWindow(workspace);
    if (!success) {
      log.warn({ pid: target.pid }, 'Window not found via AppleScript, falling back to process.kill');
      process.kill(target.pid, 'SIGTERM');
    }
    return json({
      ok: true,
      killed: {
        pid: target.pid,
        port: target.port,
        windowClosed: success,
      },
    });
  } catch (error: any) {
    log.error({ err: error.message, workspace }, 'Failed to clean up workspace');
    return json({ error: error.message }, { status: 500 });
  }
}
