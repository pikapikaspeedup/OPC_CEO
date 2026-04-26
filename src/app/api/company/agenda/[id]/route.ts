import { NextResponse } from 'next/server';

import { getOperatingAgendaItem } from '@/lib/company-kernel/agenda-store';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { id } = await params;
  const item = getOperatingAgendaItem(id);
  if (!item) {
    return NextResponse.json({ error: 'Operating agenda item not found' }, { status: 404 });
  }
  return NextResponse.json(item);
}
