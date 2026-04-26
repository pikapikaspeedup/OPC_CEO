import { handleCEOProfileFeedbackPost } from '@/server/control-plane/routes/ceo';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleCEOProfileFeedbackPost(req);
}
