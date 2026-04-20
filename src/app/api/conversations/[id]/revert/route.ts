import { NextResponse } from 'next/server';
import { getOwnerConnection, grpc, resolveConversationRecord, updateLocalConversation } from '@/lib/bridge/gateway';
import {
  inferLocalProviderFromConversation,
  revertLocalProviderConversationSteps,
} from '@/lib/local-provider-conversations';
import {
  isApiConversationProvider,
  revertApiConversation,
} from '@/lib/api-provider-conversations';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: cascadeId } = await params;
  const { stepIndex, model } = await req.json();
  const conversationRecord = resolveConversationRecord(cascadeId);
  const localProvider = inferLocalProviderFromConversation(cascadeId, conversationRecord?.provider);
  if (localProvider) {
    const steps = isApiConversationProvider(localProvider)
      ? await revertApiConversation(conversationRecord?.sessionHandle || cascadeId, stepIndex)
      : revertLocalProviderConversationSteps(conversationRecord?.id || cascadeId, stepIndex);
    if (conversationRecord) {
      updateLocalConversation(conversationRecord.id, { stepCount: steps.length });
    }
    return NextResponse.json({ ok: true, data: { cascadeId, stepIndex, model, stepCount: steps.length } });
  }
  const conn = await getOwnerConnection(cascadeId);
  if (!conn) return NextResponse.json({ error: 'No server available' }, { status: 503 });
  try {
    const data = await grpc.revertToStep(conn.port, conn.csrf, conn.apiKey, cascadeId, stepIndex, model);
    return NextResponse.json({ ok: true, data });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
