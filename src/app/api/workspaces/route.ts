import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/workspaces');

export async function GET(req: Request = DEFAULT_REQUEST) {
  return runControlPlaneRoute(req, async () => {
    const { handleWorkspacesGet } = await import('@/server/control-plane/routes/workspaces');
    return handleWorkspacesGet();
  })
}
