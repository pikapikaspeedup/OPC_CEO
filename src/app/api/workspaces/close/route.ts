import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

/**
 * POST /api/workspaces/close — Hide a workspace from the React UI sidebar.
 * 
 * IMPORTANT: This does NOT kill the language_server process.
 * The server stays running in the background (same behavior as Agent Manager's "Keep in Background").
 * The workspace is simply hidden from the React frontend's server list.
 */
export async function POST(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleWorkspacesClosePost } = await import('@/server/control-plane/routes/workspaces');
    return handleWorkspacesClosePost(req);
  })
}

/**
 * GET /api/workspaces/close — List currently hidden workspaces
 */
const DEFAULT_REQUEST = new Request('http://localhost/api/workspaces/close');

export async function GET(req: Request = DEFAULT_REQUEST) {
  return runControlPlaneRoute(req, async () => {
    const { handleWorkspacesCloseGet } = await import('@/server/control-plane/routes/workspaces');
    return handleWorkspacesCloseGet();
  })
}

/**
 * DELETE /api/workspaces/close — Unhide a workspace (show it again in sidebar)
 */
export async function DELETE(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleWorkspacesCloseDelete } = await import('@/server/control-plane/routes/workspaces');
    return handleWorkspacesCloseDelete(req);
  })
}
