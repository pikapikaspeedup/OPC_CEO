import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleCEOEventsGet } = await import('@/server/control-plane/routes/ceo');
    return handleCEOEventsGet(req);
  })
}
