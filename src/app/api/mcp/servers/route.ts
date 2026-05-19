import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleMcpServersPost } = await import('@/server/control-plane/routes/settings');
    return handleMcpServersPost(req);
  })
}

export async function DELETE(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleMcpServersDelete } = await import('@/server/control-plane/routes/settings');
    return handleMcpServersDelete(req);
  })
}
