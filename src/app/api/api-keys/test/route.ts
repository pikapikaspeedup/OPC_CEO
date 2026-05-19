import { runControlPlaneRoute } from '@/server/shared/proxy';

// POST /api/api-keys/test — 测试 provider key 是否有效
export async function POST(request: Request) {
  return runControlPlaneRoute(request, async () => {
    const { handleApiKeysTestPost } = await import('@/server/control-plane/routes/settings');
    return handleApiKeysTestPost(request);
  })
}
