import { NextResponse } from 'next/server';
import { createScheduledJob, listScheduledJobsEnriched } from '@/lib/agents/scheduler';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(listScheduledJobsEnriched());
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (typeof body.createdBy !== 'string') {
      body.createdBy = 'api';
    }
    const job = createScheduledJob(body);
    return NextResponse.json(job, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
