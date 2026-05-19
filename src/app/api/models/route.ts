import { runRuntimeRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/models');

export async function GET(req: Request = DEFAULT_REQUEST) {
  return runRuntimeRoute(req, async () => {
    const { handleModelsGet } = await import('@/server/runtime/routes/user');
    return handleModelsGet();
  })
}
