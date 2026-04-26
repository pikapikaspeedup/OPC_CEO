import {
  handleApiKeysGet,
  handleApiKeysPut,
} from '@/server/control-plane/routes/settings';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

// GET /api/api-keys — 返回已设置状态（不返回 key 值）
const DEFAULT_REQUEST = new Request('http://localhost/api/api-keys');

export async function GET(req: Request = DEFAULT_REQUEST) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleApiKeysGet();
}

// PUT /api/api-keys — 保存 key（做 trim，不做其他处理）
export async function PUT(request: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(request);
  }
  return handleApiKeysPut(request);
}
