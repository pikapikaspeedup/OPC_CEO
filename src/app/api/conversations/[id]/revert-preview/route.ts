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

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: cascadeId } = await params;
  const { searchParams } = new URL(req.url);
  const stepIndex = parseInt(searchParams.get('stepIndex') || '0');
  const model = searchParams.get('model') || '';
  const conversationRecord = resolveConversationRecord(cascadeId);
  const localProvider = inferLocalProviderFromConversation(cascadeId, conversationRecord?.provider);
  if (localProvider) {
    const steps = isApiConversationProvider(localProvider)
      ? await previewApiConversationSteps(conversationRecord?.sessionHandle || cascadeId, stepIndex)
      : previewLocalProviderConversationSteps(conversationRecord?.id || cascadeId, stepIndex);
    return NextResponse.json({ cascadeId, stepIndex, model, steps });
  }
  const conn = await getOwnerConnection(cascadeId);
  if (!conn) return NextResponse.json({ error: 'No server available' }, { status: 503 });
  try {
    const data = await grpc.getRevertPreview(conn.port, conn.csrf, conn.apiKey, cascadeId, stepIndex, model);
    return NextResponse.json(data);
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
