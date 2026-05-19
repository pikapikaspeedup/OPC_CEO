import { NextResponse } from 'next/server';
import { getOwnerConnection, grpc, resolveConversationRecord } from '@/lib/bridge/gateway';
import { inferLocalProviderFromConversation } from '@/lib/local-provider-conversations';
import { cancelApiConversationRequest, isApiConversationProvider } from '@/lib/api-provider-conversations';
import {
  getProviderSessionHandle,
  type ProviderNeutralConversationRecord,
} from '@/lib/conversation-runtime';
import {
  proxyToRuntime,
  shouldProxyRuntimeRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(_req);
  }

  const { id: cascadeId } = await params;
  const conversationRecord = resolveConversationRecord(cascadeId);
  const localProvider = inferLocalProviderFromConversation(cascadeId, conversationRecord?.provider);
  if (localProvider) {
    const businessConversationId = conversationRecord?.id || cascadeId;
    const sessionHandle = getProviderSessionHandle(
      conversationRecord as ProviderNeutralConversationRecord | null,
      localProvider,
    ) || conversationRecord?.sessionHandle;
    const cancelled = isApiConversationProvider(localProvider)
      ? cancelApiConversationRequest(businessConversationId)
        || (sessionHandle ? cancelApiConversationRequest(sessionHandle) : false)
        || cancelApiConversationRequest(cascadeId)
      : false;
    return NextResponse.json({
      ok: true,
      data: {
        status: cancelled ? 'cancelled' : 'not_running',
        provider: localProvider,
      },
    });
  }
  const runtimeCascadeId = getProviderSessionHandle(
    conversationRecord as ProviderNeutralConversationRecord | null,
    'antigravity',
  ) || (conversationRecord?.provider === 'antigravity' ? conversationRecord.sessionHandle : undefined) || cascadeId;
  const conn = await getOwnerConnection(runtimeCascadeId);
  if (!conn) return NextResponse.json({ error: 'No server available' }, { status: 503 });
  try {
    const data = await grpc.cancelCascade(conn.port, conn.csrf, conn.apiKey, runtimeCascadeId);
    return NextResponse.json({ ok: true, data });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
