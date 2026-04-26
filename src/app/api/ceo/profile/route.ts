import {
  handleCEOProfileGet,
  handleCEOProfilePatch,
} from '@/server/control-plane/routes/ceo';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/ceo/profile');

export async function GET(req: Request = DEFAULT_REQUEST) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleCEOProfileGet();
}

export async function PATCH(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleCEOProfilePatch(req);
}
