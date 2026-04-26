import { NextResponse } from 'next/server';

import type { KnowledgeCategory } from '@/lib/knowledge/contracts';
import type { KnowledgePromotionLevel } from '@/lib/company-kernel/contracts';
import { promoteMemoryCandidate } from '@/lib/company-kernel/memory-promotion';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(req);
  }

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as {
      title?: string;
      content?: string;
      category?: KnowledgeCategory;
      level?: KnowledgePromotionLevel;
    };
    const knowledge = promoteMemoryCandidate({
      candidateId: id,
      promotedBy: 'ceo',
      ...(body.title ? { title: body.title } : {}),
      ...(body.content ? { content: body.content } : {}),
      ...(body.category ? { category: body.category } : {}),
      ...(body.level ? { level: body.level } : {}),
    });
    return NextResponse.json({ knowledge }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found') ? 404 : message.startsWith('Cannot ') ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
