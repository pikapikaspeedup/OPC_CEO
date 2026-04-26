import { handleWorkspacesLaunchPost } from '@/server/runtime/routes/workspaces';
import {
  proxyToRuntime,
  shouldProxyRuntimeRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workspaces/launch — Open a workspace in Antigravity (triggers language_server start)
 */
export async function POST(req: Request) {
  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(req);
  }
  return handleWorkspacesLaunchPost(req);
}
