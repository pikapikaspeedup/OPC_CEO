import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/ceo/setup');

export async function GET(req: Request = DEFAULT_REQUEST) {
  return runControlPlaneRoute(req, async () => {
    const { handleCEOSetupGet } = await import('@/server/control-plane/routes/ceo');
    return handleCEOSetupGet();
  })
}

export async function POST(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleCEOSetupPost } = await import('@/server/control-plane/routes/ceo');
    return handleCEOSetupPost(req);
  })
}
