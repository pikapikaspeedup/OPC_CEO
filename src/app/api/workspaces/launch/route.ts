import { runRuntimeRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workspaces/launch — Open a workspace in Antigravity (triggers language_server start)
 */
export async function POST(req: Request) {
  return runRuntimeRoute(req, async () => {
    const { handleWorkspacesLaunchPost } = await import('@/server/runtime/routes/workspaces');
    return handleWorkspacesLaunchPost(req);
  })
}
