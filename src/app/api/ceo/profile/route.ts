import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

const DEFAULT_REQUEST = new Request('http://localhost/api/ceo/profile');

export async function GET(req: Request = DEFAULT_REQUEST) {
  return runControlPlaneRoute(req, async () => {
    const { handleCEOProfileGet } = await import('@/server/control-plane/routes/ceo');
    return handleCEOProfileGet();
  })
}

export async function PATCH(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleCEOProfilePatch } = await import('@/server/control-plane/routes/ceo');
    return handleCEOProfilePatch(req);
  })
}
