import {
  handleAIConfigGet,
  handleAIConfigPut,
} from '@/server/control-plane/routes/settings';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

const DEFAULT_REQUEST = new Request('http://localhost/api/ai-config');

export async function GET(req: Request = DEFAULT_REQUEST) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleAIConfigGet();
}

export async function PUT(request: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(request);
  }
  return handleAIConfigPut(request);
}
