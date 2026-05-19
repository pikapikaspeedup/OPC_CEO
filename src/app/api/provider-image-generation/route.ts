import { runControlPlaneRoute } from '@/server/shared/proxy';

export async function POST(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleProviderImageGenerationPost } = await import('@/server/control-plane/routes/settings');
    return handleProviderImageGenerationPost(req);
  })
}
