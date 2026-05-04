import { NextResponse } from 'next/server';

import {
  ensureCcConnectConfig,
  getCcConnectLocalState,
  startCcConnect,
  stopCcConnect,
} from '@/lib/cc-connect-local';

export const dynamic = 'force-dynamic';

type ManageAction = 'prepare-config' | 'start' | 'stop';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { action?: ManageAction };
  const action = body.action || 'start';

  try {
    if (action === 'prepare-config') {
      const result = ensureCcConnectConfig();
      const state = await getCcConnectLocalState();
      return NextResponse.json({
        ok: true,
        action,
        changed: result.changed,
        data: state,
      });
    }

    if (action === 'stop') {
      const state = await stopCcConnect();
      return NextResponse.json({
        ok: true,
        action,
        data: state,
      });
    }

    const state = await startCcConnect();
    return NextResponse.json({
      ok: true,
      action: 'start',
      data: state,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to manage cc-connect',
      },
      { status: 400 },
    );
  }
}
