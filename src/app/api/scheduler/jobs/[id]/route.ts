import { NextResponse } from 'next/server';
import { deleteScheduledJob, getScheduledJob, isProtectedBuiltInScheduledJob, updateScheduledJob } from '@/lib/agents/scheduler';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(_req);
  }

  const { id } = await params;
  const job = getScheduledJob(id);
  if (!job) {
    return NextResponse.json({ error: `Scheduled job not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json(job);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  try {
    const { id } = await params;
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const job = updateScheduledJob(id, body);
    if (!job) {
      return NextResponse.json({ error: `Scheduled job not found: ${id}` }, { status: 404 });
    }
    return NextResponse.json(job);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid scheduled job update' },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(_req);
  }

  const { id } = await params;
  // 内置 builtin 任务不允许删除（删了下次 ensure 也会重建，提前拦截给出友好提示）
  if (isProtectedBuiltInScheduledJob(id)) {
    return NextResponse.json(
      {
        code: 'BUILTIN_JOB_PROTECTED',
        error: 'Built-in scheduled job cannot be deleted. Use enabled=false to disable it instead.',
        jobId: id,
      },
      { status: 403 },
    );
  }
  const deleted = deleteScheduledJob(id);
  if (!deleted) {
    return NextResponse.json({ error: `Scheduled job not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
