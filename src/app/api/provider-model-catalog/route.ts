import {
  handleProviderModelCatalogGet,
  handleProviderModelCatalogPost,
} from '@/server/control-plane/routes/settings';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

const DEFAULT_REQUEST = new Request('http://localhost/api/provider-model-catalog');

export async function GET(req: Request = DEFAULT_REQUEST) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleProviderModelCatalogGet(req);
}

export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleProviderModelCatalogPost(req);
}
