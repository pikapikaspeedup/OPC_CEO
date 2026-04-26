import {
  handleMcpServersDelete,
  handleMcpServersPost,
} from '@/server/control-plane/routes/settings';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleMcpServersPost(req);
}

export async function DELETE(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleMcpServersDelete(req);
}
