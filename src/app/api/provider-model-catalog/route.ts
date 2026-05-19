import { runControlPlaneRoute } from '@/server/shared/proxy';

const DEFAULT_REQUEST = new Request('http://localhost/api/provider-model-catalog');

export async function GET(req: Request = DEFAULT_REQUEST) {
  return runControlPlaneRoute(req, async () => {
    const { handleProviderModelCatalogGet } = await import('@/server/control-plane/routes/settings');
    return handleProviderModelCatalogGet(req);
  })
}

export async function POST(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleProviderModelCatalogPost } = await import('@/server/control-plane/routes/settings');
    return handleProviderModelCatalogPost(req);
  })
}
