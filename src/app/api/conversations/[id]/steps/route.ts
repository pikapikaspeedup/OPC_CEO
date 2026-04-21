import { NextResponse } from 'next/server';
import { getAllConnections, grpc, resolveConversationRecord } from '@/lib/bridge/gateway';
import { createLogger } from '@/lib/logger';
import {
  inferLocalProviderFromConversation,
  readLocalProviderConversationSteps,
} from '@/lib/local-provider-conversations';
import {
  isApiConversationProvider,
  readApiConversationSteps,
} from '@/lib/api-provider-conversations';
import {
  buildStepsFromTranscriptMessages,
  readLocalProviderTranscriptMessages,
} from '@/lib/run-conversation-transcript';
import { findRunRecordByConversationRef } from '@/lib/storage/gateway-db';
import {
  proxyToRuntime,
  shouldProxyRuntimeRequest,
} from '@/server/shared/proxy';

const log = createLogger('StepsAPI');

export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(_req);
  }

  const { id: cascadeId } = await params;
  try {
    const conversationRecord = resolveConversationRecord(cascadeId);
    const localProvider = inferLocalProviderFromConversation(cascadeId, conversationRecord?.provider);
    if (localProvider) {
      if (isApiConversationProvider(localProvider)) {
        const apiSteps = await readApiConversationSteps(conversationRecord?.sessionHandle || cascadeId);
        return NextResponse.json({ cascadeId, steps: apiSteps });
      }

      const conversationId = conversationRecord?.id || cascadeId;
      const localSteps = readLocalProviderConversationSteps(conversationId);
      if (localSteps.length > 0) {
        return NextResponse.json({ cascadeId, steps: localSteps });
      }

      const sessionHandle = conversationRecord?.sessionHandle || cascadeId;
      const backingRun = findRunRecordByConversationRef({
        sessionHandles: [sessionHandle],
        conversationIds: [sessionHandle, conversationId],
      });
      const transcript = readLocalProviderTranscriptMessages(localProvider, sessionHandle, backingRun);
      const transcriptSteps = transcript ? buildStepsFromTranscriptMessages(transcript) : [];
      return NextResponse.json({ cascadeId, steps: transcriptSteps });
    }

    const conns = await getAllConnections();
    log.info({ cascadeId: cascadeId.slice(0,8), serverCount: conns.length }, 'Steps request');
    let checkpointData: { steps?: unknown[] } | null = null;
    for (const conn of conns) {
      try {
        await grpc.loadTrajectory(conn.port, conn.csrf, cascadeId);
        const data = await grpc.getTrajectorySteps(conn.port, conn.csrf, conn.apiKey, cascadeId);
        if (data?.steps?.length) {
          log.info({ cascadeId: cascadeId.slice(0,8), port: conn.port, steps: data.steps.length }, 'Steps found');
          checkpointData = data;
          break;
        } else {
          log.warn({ cascadeId: cascadeId.slice(0,8), port: conn.port, dataKeys: data ? Object.keys(data) : 'null' }, 'No steps from server');
        }
      } catch (innerErr: unknown) {
        log.warn({ cascadeId: cascadeId.slice(0,8), port: conn.port, err: getErrorMessage(innerErr) }, 'Server attempt failed');
      }
    }

    if (!checkpointData) {
      log.error({ cascadeId: cascadeId.slice(0,8), serversChecked: conns.length, ports: conns.map(c => c.port) }, 'Conversation not found on any server');
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    return NextResponse.json(checkpointData);
  } catch (error: unknown) {
    log.error({ cascadeId: cascadeId.slice(0,8), err: getErrorMessage(error) }, 'Steps request error');
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
