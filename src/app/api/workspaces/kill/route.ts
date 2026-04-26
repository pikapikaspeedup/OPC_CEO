import { handleWorkspacesKillPost } from '@/server/runtime/routes/workspaces';
import {
  proxyToRuntime,
  shouldProxyRuntimeRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workspaces/kill — Actually stop a workspace's language_server process.
 * 
 * ⚠️ WARNING: This kills the language_server process. If the workspace is also
 * open in Agent Manager, Agent Manager will lose connection and show errors.
 * Use POST /api/workspaces/close (hide) if you just want to remove it from the sidebar.
 */
export async function POST(req: Request) {
  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(req);
  }
  return handleWorkspacesKillPost(req);
}
