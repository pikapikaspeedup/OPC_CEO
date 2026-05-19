import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/mcp');

export async function GET(req: Request = DEFAULT_REQUEST) {
  return runControlPlaneRoute(req, async () => {
    const { handleMcpConfigGet } = await import('@/server/control-plane/routes/settings');
    return handleMcpConfigGet();
  })
}
