import { NextResponse } from 'next/server';
import { getOwnerConnection, grpc, resolveConversationRecord } from '@/lib/bridge/gateway';
import { inferLocalProviderFromConversation } from '@/lib/local-provider-conversations';
import { cancelApiConversationRequest, isApiConversationProvider } from '@/lib/api-provider-conversations';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: cascadeId } = await params;
  const conversationRecord = resolveConversationRecord(cascadeId);
  const localProvider = inferLocalProviderFromConversation(cascadeId, conversationRecord?.provider);
  if (localProvider) {
    const cancelled = isApiConversationProvider(localProvider)
      ? cancelApiConversationRequest(conversationRecord?.sessionHandle || cascadeId)
      : false;
    return NextResponse.json({
      ok: true,
      data: {
        status: cancelled ? 'cancelled' : 'not_running',
        provider: localProvider,
      },
    });
  }
  const conn = await getOwnerConnection(cascadeId);
  if (!conn) return NextResponse.json({ error: 'No server available' }, { status: 503 });
  try {
    const data = await grpc.cancelCascade(conn.port, conn.csrf, conn.apiKey, cascadeId);
    return NextResponse.json({ ok: true, data });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
