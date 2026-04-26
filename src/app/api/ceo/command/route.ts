import { handleCEOCommandPost } from '@/server/control-plane/routes/ceo';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

// POST /api/ceo/command
export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }
  return handleCEOCommandPost(req);
}
