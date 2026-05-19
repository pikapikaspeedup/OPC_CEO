import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/mcp/tools');

export async function GET(req: Request = DEFAULT_REQUEST) {
  return runControlPlaneRoute(req, async () => {
    const { handleMcpToolsGet } = await import('@/server/control-plane/routes/settings');
    return handleMcpToolsGet();
  })
}
