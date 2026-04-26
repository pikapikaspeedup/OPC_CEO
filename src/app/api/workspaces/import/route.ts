import { handleWorkspacesImportPost } from '@/server/control-plane/routes/workspaces';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// POST /api/workspaces/import — Register a workspace without launching Antigravity.
export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleWorkspacesImportPost(req);
}
