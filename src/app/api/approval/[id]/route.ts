/**
 * Approval Detail API — Get & Respond
 *
 * GET   /api/approval/[id]           — Get request details
 * PATCH /api/approval/[id]           — CEO responds (approve/reject/feedback)
 *
 * Body (PATCH):
 *   { action: 'approved' | 'rejected' | 'feedback', message: string }
 */

import { NextResponse } from 'next/server';
import { getApprovalRequest } from '@/lib/approval/request-store';
import { handleApprovalResponse } from '@/lib/approval/handler';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/approval/[id]
export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params;
  const request = getApprovalRequest(id);
  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }
  return NextResponse.json({ request });
}

// PATCH /api/approval/[id]
export async function PATCH(req: Request, { params }: RouteParams) {
  const { id } = await params;

  let body: { action: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validActions = ['approved', 'rejected', 'feedback'];
  if (!body.action || !validActions.includes(body.action)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
      { status: 400 },
    );
  }

  const updated = await handleApprovalResponse(
    id,
    body.action as 'approved' | 'rejected' | 'feedback',
    body.message || '',
    'web', // channel
  );

  if (!updated) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }

  return NextResponse.json({ request: updated });
}
