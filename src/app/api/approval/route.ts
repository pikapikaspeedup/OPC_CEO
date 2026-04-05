/**
 * Approval API — List & Create
 *
 * GET  /api/approval                 — List all approval requests (filterable)
 * POST /api/approval                 — Submit a new approval request
 *
 * Query params (GET):
 *   status=pending|approved|rejected|feedback
 *   workspace=<uri>
 *   type=token_increase|tool_access|...
 *
 * Body (POST): CreateApprovalInput
 */

import { NextResponse } from 'next/server';
import {
  listApprovalRequests,
  getRequestSummary,
} from '@/lib/approval/request-store';
import { submitApprovalRequest } from '@/lib/approval/handler';
import type { CreateApprovalInput } from '@/lib/approval/types';

export const dynamic = 'force-dynamic';

// GET /api/approval
export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;
  const workspace = url.searchParams.get('workspace') ?? undefined;
  const type = url.searchParams.get('type') ?? undefined;
  const includeSummary = url.searchParams.get('summary') === 'true';

  const requests = listApprovalRequests({ status, workspace, type });

  const response: Record<string, unknown> = { requests };
  if (includeSummary) {
    response.summary = getRequestSummary();
  }

  return NextResponse.json(response);
}

// POST /api/approval
export async function POST(req: Request) {
  let body: CreateApprovalInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.title || !body.description || !body.type || !body.workspace) {
    return NextResponse.json(
      { error: 'Missing required fields: title, description, type, workspace' },
      { status: 400 },
    );
  }

  const request = await submitApprovalRequest(body);
  return NextResponse.json({ request }, { status: 201 });
}
