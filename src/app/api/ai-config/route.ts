import { runControlPlaneRoute } from '@/server/shared/proxy';

const DEFAULT_REQUEST = new Request('http://localhost/api/ai-config');

export async function GET(req: Request = DEFAULT_REQUEST) {
  return runControlPlaneRoute(req, async () => {
    const { handleAIConfigGet } = await import('@/server/control-plane/routes/settings');
    return handleAIConfigGet();
  })
}

export async function PUT(request: Request) {
  return runControlPlaneRoute(request, async () => {
    const { handleAIConfigPut } = await import('@/server/control-plane/routes/settings');
    return handleAIConfigPut(request);
  })
}
