import { runRuntimeRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workspaces/kill — Actually stop a workspace's language_server process.
 * 
 * ⚠️ WARNING: This kills the language_server process. If the workspace is also
 * open in Agent Manager, Agent Manager will lose connection and show errors.
 * Use POST /api/workspaces/close (hide) if you just want to remove it from the sidebar.
 */
export async function POST(req: Request) {
  return runRuntimeRoute(req, async () => {
    const { handleWorkspacesKillPost } = await import('@/server/runtime/routes/workspaces');
    return handleWorkspacesKillPost(req);
  })
}
