import { runControlPlaneRoute } from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return runControlPlaneRoute(req, async () => {
    const { handleCEOProfileFeedbackPost } = await import('@/server/control-plane/routes/ceo');
    return handleCEOProfileFeedbackPost(req);
  })
}
