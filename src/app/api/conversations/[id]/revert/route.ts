import { NextResponse } from 'next/server';
import { getOwnerConnection, grpc, resolveConversationRecord, updateLocalConversation } from '@/lib/bridge/gateway';
import {
  inferLocalProviderFromConversation,
  revertLocalProviderConversationSteps,
  writeLocalProviderConversationSteps,
} from '@/lib/local-provider-conversations';
import {
  isApiConversationProvider,
  revertApiConversation,
} from '@/lib/api-provider-conversations';
import {
  getProviderSessionHandle,
  updateProviderSessionState,
  type ProviderNeutralConversationRecord,
} from '@/lib/conversation-runtime';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: cascadeId } = await params;
  const { stepIndex, model } = await req.json();
  const conversationRecord = resolveConversationRecord(cascadeId);
  const localProvider = inferLocalProviderFromConversation(cascadeId, conversationRecord?.provider);
  if (localProvider) {
    const conversationId = conversationRecord?.id || cascadeId;
    const providerSessionHandle = getProviderSessionHandle(
      conversationRecord as ProviderNeutralConversationRecord | null,
      localProvider,
    ) || conversationRecord?.sessionHandle || cascadeId;
    let steps = revertLocalProviderConversationSteps(conversationId, stepIndex);
    if (isApiConversationProvider(localProvider)) {
      const providerSteps = await revertApiConversation(providerSessionHandle, stepIndex);
      if (steps.length === 0 && providerSteps.length > 0) {
        steps = writeLocalProviderConversationSteps(conversationId, providerSteps);
      }
    }
    if (conversationRecord) {
      updateLocalConversation(conversationRecord.id, {
        stepCount: steps.length,
        providerSessions: updateProviderSessionState(
          conversationRecord as ProviderNeutralConversationRecord,
          localProvider,
          providerSessionHandle,
          steps.length,
        ),
      });
    }
    return NextResponse.json({ ok: true, data: { cascadeId, stepIndex, model, stepCount: steps.length } });
  }
  const runtimeCascadeId = getProviderSessionHandle(
    conversationRecord as ProviderNeutralConversationRecord | null,
    'antigravity',
  ) || (conversationRecord?.provider === 'antigravity' ? conversationRecord.sessionHandle : undefined) || cascadeId;
  const conn = await getOwnerConnection(runtimeCascadeId);
  if (!conn) return NextResponse.json({ error: 'No server available' }, { status: 503 });
  try {
    const data = await grpc.revertToStep(conn.port, conn.csrf, conn.apiKey, runtimeCascadeId, stepIndex, model);
    return NextResponse.json({ ok: true, data });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
