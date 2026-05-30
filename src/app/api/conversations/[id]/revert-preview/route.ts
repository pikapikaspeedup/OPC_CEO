import { NextResponse } from 'next/server';
import { getOwnerConnection, grpc, resolveConversationRecord } from '@/lib/bridge/gateway';
import {
  inferLocalProviderFromConversation,
  previewLocalProviderConversationSteps,
} from '@/lib/local-provider-conversations';
import {
  isApiConversationProvider,
  previewApiConversationSteps,
} from '@/lib/api-provider-conversations';
import {
  getProviderSessionHandle,
  type ProviderNeutralConversationRecord,
} from '@/lib/conversation-runtime';
import {
  proxyToRuntime,
  shouldProxyRuntimeRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(req);
  }

  const { id: cascadeId } = await params;
  const { searchParams } = new URL(req.url);
  const stepIndex = parseInt(searchParams.get('stepIndex') || '0');
  const model = searchParams.get('model') || '';
  const conversationRecord = resolveConversationRecord(cascadeId);
  const localProvider = inferLocalProviderFromConversation(cascadeId, conversationRecord?.provider);
  if (localProvider) {
    const conversationId = conversationRecord?.id || cascadeId;
    const canonicalSteps = previewLocalProviderConversationSteps(conversationId, stepIndex);
    const steps = isApiConversationProvider(localProvider) && canonicalSteps.length === 0
      ? await previewApiConversationSteps(
        getProviderSessionHandle(
          conversationRecord as ProviderNeutralConversationRecord | null,
          localProvider,
        ) || conversationRecord?.sessionHandle || cascadeId,
        stepIndex,
      )
      : canonicalSteps;
    return NextResponse.json({ cascadeId, stepIndex, model, steps });
  }
  const runtimeCascadeId = getProviderSessionHandle(
    conversationRecord as ProviderNeutralConversationRecord | null,
    'antigravity',
  ) || (conversationRecord?.provider === 'antigravity' ? conversationRecord.sessionHandle : undefined) || cascadeId;
  const conn = await getOwnerConnection(runtimeCascadeId);
  if (!conn) return NextResponse.json({ error: 'No server available' }, { status: 503 });
  try {
    const data = await grpc.getRevertPreview(conn.port, conn.csrf, conn.apiKey, runtimeCascadeId, stepIndex, model);
    return NextResponse.json(data);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
