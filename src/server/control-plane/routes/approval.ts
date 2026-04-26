import { getRequestSummary, getApprovalRequest, listApprovalRequests } from '@/lib/approval/request-store';
import { handleApprovalResponse, submitApprovalRequest, verifyApprovalToken } from '@/lib/approval/handler';
import type { CreateApprovalInput } from '@/lib/approval/types';

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export async function handleApprovalListGet(req: Request): Promise<Response> {
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
  return json(response);
}

export async function handleApprovalCreatePost(req: Request): Promise<Response> {
  let body: CreateApprovalInput;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.title || !body.description || !body.type || !body.workspace) {
    return json(
      { error: 'Missing required fields: title, description, type, workspace' },
      { status: 400 },
    );
  }

  const request = await submitApprovalRequest(body);
  return json({ request }, { status: 201 });
}

export async function handleApprovalDetailGet(id: string): Promise<Response> {
  const request = getApprovalRequest(id);
  if (!request) {
    return json({ error: 'Request not found' }, { status: 404 });
  }
  return json({ request });
}

export async function handleApprovalDetailPatch(req: Request, id: string): Promise<Response> {
  let body: { action: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validActions = ['approved', 'rejected', 'feedback'];
  if (!body.action || !validActions.includes(body.action)) {
    return json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` }, { status: 400 });
  }

  const updated = await handleApprovalResponse(
    id,
    body.action as 'approved' | 'rejected' | 'feedback',
    body.message || '',
    'web',
  );
  if (!updated) {
    return json({ error: 'Request not found' }, { status: 404 });
  }

  return json({ request: updated });
}

export async function handleApprovalFeedback(req: Request, id: string): Promise<Response> {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const token = url.searchParams.get('token');
  const message = url.searchParams.get('message') || '';

  if (!action || !token) {
    return json({ error: 'Missing required params: action, token' }, { status: 400 });
  }

  const validActions = ['approve', 'reject', 'feedback'];
  if (!validActions.includes(action)) {
    return json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}` }, { status: 400 });
  }

  if (!verifyApprovalToken(id, action, token)) {
    return json({ error: 'Invalid or expired token' }, { status: 403 });
  }

  const existing = getApprovalRequest(id);
  if (!existing) {
    return json({ error: 'Request not found' }, { status: 404 });
  }

  const responseAction = action === 'approve'
    ? 'approved'
    : action === 'reject'
      ? 'rejected'
      : 'feedback';
  const updated = await handleApprovalResponse(id, responseAction, message, 'link');
  if (!updated) {
    return json({ error: 'Failed to process response' }, { status: 500 });
  }

  if (req.method === 'GET') {
    const statusEmoji = responseAction === 'approved'
      ? '✅'
      : responseAction === 'rejected'
        ? '❌'
        : '💬';
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

  return json({ request: updated });
}
