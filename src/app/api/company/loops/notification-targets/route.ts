import { NextResponse } from 'next/server';

import { getCompanyLoopNotificationTargets } from '@/lib/company-kernel/company-loop-notification-targets';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  return NextResponse.json({
    items: getCompanyLoopNotificationTargets(),
  });
}
