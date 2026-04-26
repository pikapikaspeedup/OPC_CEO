import {
  handleCEOSetupGet,
  handleCEOSetupPost,
} from '@/server/control-plane/routes/ceo';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/ceo/setup');

export async function GET(req: Request = DEFAULT_REQUEST) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleCEOSetupGet();
}

export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleCEOSetupPost(req);
}
