import { runRuntimeRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/me');

export async function GET(req: Request = DEFAULT_REQUEST) {
  return runRuntimeRoute(req, async () => {
    const { handleMeGet } = await import('@/server/runtime/routes/user');
    return handleMeGet();
  })
}
