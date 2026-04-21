import { NextResponse } from 'next/server';
import { createScheduledJob, listScheduledJobsEnriched } from '@/lib/agents/scheduler';
import { paginateArray, parsePaginationSearchParams } from '@/lib/pagination';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const { searchParams } = new URL(req.url);
  const pagination = parsePaginationSearchParams(searchParams, {
    defaultPageSize: 100,
    maxPageSize: 200,
  });
  return NextResponse.json(paginateArray(listScheduledJobsEnriched(), pagination));
}

export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  try {
    const body = await req.json();
    if (typeof body.createdBy !== 'string') {
      body.createdBy = 'api';
    }
    const job = createScheduledJob(body);
    return NextResponse.json(job, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to create scheduled job' },
      { status: 400 },
    );
  }
}
