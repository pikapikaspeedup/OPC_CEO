import { runControlPlaneRoute } from '@/server/shared/proxy';

// GET /api/api-keys — 返回已设置状态（不返回 key 值）
const DEFAULT_REQUEST = new Request('http://localhost/api/api-keys');

export async function GET(req: Request = DEFAULT_REQUEST) {
  return runControlPlaneRoute(req, async () => {
    const { handleApiKeysGet } = await import('@/server/control-plane/routes/settings');
    return handleApiKeysGet();
  })
}

// PUT /api/api-keys — 保存 key（做 trim，不做其他处理）
export async function PUT(request: Request) {
  return runControlPlaneRoute(request, async () => {
    const { handleApiKeysPut } = await import('@/server/control-plane/routes/settings');
    return handleApiKeysPut(request);
  })
}
