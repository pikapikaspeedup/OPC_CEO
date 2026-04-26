import { handleMcpConfigGet } from '@/server/control-plane/routes/settings';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/mcp');

export async function GET(req: Request = DEFAULT_REQUEST) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleMcpConfigGet();
}
