import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// POST /api/workspaces/import — Register a workspace without launching Antigravity.
export async function POST(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleWorkspacesImportPost } = await import('@/server/control-plane/routes/workspaces');
    return handleWorkspacesImportPost(req);
  })
}
