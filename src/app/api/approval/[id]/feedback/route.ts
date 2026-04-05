/**
 * Approval Feedback API — One-Click Approval via Signed Link
 *
 * POST /api/approval/[id]/feedback?action=approve&token=<hmac>
 * GET  /api/approval/[id]/feedback?action=approve&token=<hmac>
 *
 * This endpoint is accessed from one-click approval links sent via IM/Webhook.
 * The token is an HMAC signature that validates the action without login.
 *
 * Supports both GET (browser click) and POST (API call).
 *
 * Security:
 * - HMAC token verification (24h TTL)
 * - Action must match token
 * - Request must be in 'pending' or 'feedback' status
 */

import { NextResponse } from 'next/server';
import { getApprovalRequest } from '@/lib/approval/request-store';
import {
  handleApprovalResponse,
  verifyApprovalToken,
} from '@/lib/approval/handler';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>
}

async function handleFeedback(req: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const token = url.searchParams.get('token');
  const message = url.searchParams.get('message') || '';

  // Validate params
  if (!action || !token) {
    return NextResponse.json(
      { error: 'Missing required params: action, token' },
      { status: 400 },
    );
  }

  const validActions = ['approve', 'reject', 'feedback'];
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
      { status: 400 },
    );
  }

  // Verify HMAC token
  if (!verifyApprovalToken(id, action, token)) {
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 403 },
    );
  }

  // Check request exists
  const existing = getApprovalRequest(id);
  if (!existing) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }

  // Map URL action to response action
  const responseAction = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'feedback';

  const updated = await handleApprovalResponse(id, responseAction, message, 'link');

  if (!updated) {
    return NextResponse.json({ error: 'Failed to process response' }, { status: 500 });
  }

  // For GET requests (browser click), return a simple HTML page
  if (req.method === 'GET') {
    const statusEmoji = responseAction === 'approved' ? '✅' : responseAction === 'rejected' ? '❌' : '💬';
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>审批完成</title></head>
<body style="font-family: system-ui; text-align: center; padding: 60px;">
  <h1>${statusEmoji} 审批已处理</h1>
  <p>请求: ${existing.title}</p>
  <p>操作: ${responseAction}</p>
  <p style="color: #666; margin-top: 20px;">此窗口可以关闭。</p>
</body></html>`;
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return NextResponse.json({ request: updated });
}

// Both GET and POST use the same logic
export async function GET(req: Request, ctx: RouteParams) {
  return handleFeedback(req, ctx);
}

export async function POST(req: Request, ctx: RouteParams) {
  return handleFeedback(req, ctx);
}
