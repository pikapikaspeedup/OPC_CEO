import { NextResponse } from 'next/server';
import { getOwnerConnection, grpc, resolveConversationRecord } from '@/lib/bridge/gateway';
import { inferLocalProviderFromConversation } from '@/lib/local-provider-conversations';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: cascadeId } = await params;
  const { artifactUri, model } = await req.json();
  const localProvider = inferLocalProviderFromConversation(cascadeId, resolveConversationRecord(cascadeId)?.provider);
  if (localProvider) {
    return NextResponse.json({
      ok: true,
      data: {
        status: 'not_applicable',
        provider: localProvider,
        artifactUri,
        model,
      },
    });
  }
  const conn = await getOwnerConnection(cascadeId);
  if (!conn) return NextResponse.json({ error: 'No server available' }, { status: 503 });
  try {
    const data = await grpc.proceedArtifact(conn.port, conn.csrf, conn.apiKey, cascadeId, artifactUri, model);
    return NextResponse.json({ ok: true, data });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
