import { handleApiKeysTestPost } from '@/server/control-plane/routes/settings';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

// POST /api/api-keys/test — 测试 provider key 是否有效
export async function POST(request: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(request);
  }
  return handleApiKeysTestPost(request);
}
