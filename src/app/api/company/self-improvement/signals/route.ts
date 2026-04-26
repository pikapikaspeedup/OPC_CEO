import { NextResponse } from 'next/server';

import { buildPaginatedResponse, parsePaginationSearchParams } from '@/lib/pagination';
import type {
  SystemImprovementSeverity,
  SystemImprovementSignalSource,
} from '@/lib/company-kernel/contracts';
import { createSystemImprovementSignal } from '@/lib/company-kernel/self-improvement-signal';
import {
  countSystemImprovementSignals,
  listSystemImprovementSignals,
} from '@/lib/company-kernel/self-improvement-store';
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
    defaultPageSize: 20,
    maxPageSize: 100,
  });
  const query = {
    ...(searchParams.get('source') ? { source: searchParams.get('source') as SystemImprovementSignalSource } : {}),
    ...(searchParams.get('severity') ? { severity: searchParams.get('severity') as SystemImprovementSeverity } : {}),
  };
  const total = countSystemImprovementSignals(query);
  const items = listSystemImprovementSignals({
    ...query,
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return NextResponse.json(buildPaginatedResponse(items, total, pagination));
}

export async function POST(req: Request) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== 'object' || typeof (body as { title?: unknown }).title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  if (typeof (body as { summary?: unknown }).summary !== 'string') {
    return NextResponse.json({ error: 'summary is required' }, { status: 400 });
  }
  const signal = createSystemImprovementSignal(body as Parameters<typeof createSystemImprovementSignal>[0]);
  return NextResponse.json({ signal }, { status: 201 });
}
