import { NextResponse } from 'next/server';
import { deleteScheduledJob, getScheduledJob, updateScheduledJob } from '@/lib/agents/scheduler';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getScheduledJob(id);
  if (!job) {
    return NextResponse.json({ error: `Scheduled job not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json(job);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleted = deleteScheduledJob(id);
  if (!deleted) {
    return NextResponse.json({ error: `Scheduled job not found: ${id}` }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
