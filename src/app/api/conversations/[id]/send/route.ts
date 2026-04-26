import { NextResponse } from 'next/server';
import {
  getOwnerConnection,
  refreshOwnerMap,
  convOwnerMap,
  ownerMapAge,
  grpc,
  resolveConversationRecord,
  updateLocalConversation,
} from '@/lib/bridge/gateway';
import { getExecutor } from '@/lib/providers';
import { createLogger } from '@/lib/logger';
import {
  appendLocalProviderConversationTurn,
  inferLocalProviderFromConversation,
} from '@/lib/local-provider-conversations';
import {
  isApiConversationProvider,
  readApiConversationSteps,
  runApiConversationTurn,
} from '@/lib/api-provider-conversations';
import { findRunRecordByConversationRef } from '@/lib/storage/gateway-db';
import {
  proxyToRuntime,
  shouldProxyRuntimeRequest,
} from '@/server/shared/proxy';

const log = createLogger('SendMsg');

export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyRuntimeRequest()) {
    return proxyToRuntime(req);
  }

  const { id: cascadeId } = await params;
  const body = await req.json() as {
    text?: string;
    model?: string;
    agenticMode?: boolean;
    attachments?: { items?: Array<Record<string, unknown>> };
  };
  let text = body.text || '';
  const model = body.model;
  const agenticMode = body.agenticMode ?? true;
  const attachments = body.attachments || {};

  attachments.items = attachments.items || [];

  // Parse @[path/to/file] mentions
  const fileRegex = /@\[(.*?)\]/g;
  let match;
  let lastIndex = 0;
  const originalText = text;
  text = ""; // Clear text so grpc.ts doesn't duplicate

  const targetConv = resolveConversationRecord(cascadeId);
  const localProvider = inferLocalProviderFromConversation(cascadeId, targetConv?.provider);
  if (localProvider) {
    const backingRun = findRunRecordByConversationRef({
      sessionHandles: [cascadeId, targetConv?.sessionHandle].filter(Boolean) as string[],
      conversationIds: [cascadeId, targetConv?.id].filter(Boolean) as string[],
    });
    const localWorkspace = targetConv?.workspace?.replace(/^file:\/\//, '')
      || backingRun?.workspace.replace(/^file:\/\//, '')
      || process.cwd();
    const sessionHandle = targetConv?.sessionHandle || backingRun?.sessionProvenance?.handle || '';
    const conversationId = targetConv?.id || cascadeId;

    log.info({ cascadeId, provider: localProvider, workspace: localWorkspace }, 'Routing to local provider conversation');

    try {
      let result;
      if (isApiConversationProvider(localProvider)) {
        result = await runApiConversationTurn(
          localProvider,
          localWorkspace,
          originalText,
          model,
          sessionHandle || undefined,
          cascadeId,
        );
      } else {
        const executor = getExecutor(localProvider);
        if (sessionHandle) {
          try {
            result = await executor.appendMessage(sessionHandle, {
              prompt: originalText,
              workspace: localWorkspace,
              model,
            });
          } catch (appendErr: unknown) {
            log.warn({ cascadeId, provider: localProvider, err: getErrorMessage(appendErr) }, 'Append failed; starting a fresh local provider session');
            result = await executor.executeTask({
              prompt: originalText,
              workspace: localWorkspace,
              model,
            });
          }
        } else {
          result = await executor.executeTask({
            prompt: originalText,
            workspace: localWorkspace,
            model,
          });
        }
      }

      if ('status' in result && result.status === 'failed') {
        const failureMessage = result.content || `${localProvider} execution failed`;
        log.error({ cascadeId, provider: localProvider, err: failureMessage }, 'Local provider reported failed status');
        return NextResponse.json({ error: failureMessage }, { status: 502 });
      }

      const steps = isApiConversationProvider(localProvider)
        ? await readApiConversationSteps(result.handle)
        : appendLocalProviderConversationTurn(conversationId, originalText, result.content || '');
      if (targetConv) {
        updateLocalConversation(targetConv.id, {
          provider: localProvider,
          sessionHandle: result.handle,
          stepCount: steps.length,
        });
      }

      return NextResponse.json({ ok: true, data: { cascadeId, state: 'idle', provider: localProvider } });
    } catch (error: unknown) {
      log.error({ err: getErrorMessage(error), cascadeId, provider: localProvider }, 'Send message to local provider failed');
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
  }

  const conn = await getOwnerConnection(cascadeId);
  if (!conn) {
    log.error({ cascadeId, ownerMapSize: convOwnerMap.size }, 'No server available — possibly a routing issue for new conversation');
    return NextResponse.json({ error: 'No server available', cascadeId }, { status: 503 });
  }

  const workspacePath = conn.workspace?.replace(/^file:\/\//, '') || process.cwd();

  while ((match = fileRegex.exec(originalText)) !== null) {
    // Push text before the match
    if (match.index > lastIndex) {
      attachments.items.push({ text: originalText.substring(lastIndex, match.index) });
    }

    const rawPath = match[1];
    const absoluteUri = rawPath.startsWith('/') ? `file://${rawPath}` : `file://${workspacePath}/${rawPath}`;
    
    // We omit workspaceUrisToRelativePaths because absoluteUri is sufficient 
    // for the Gateway to resolve the file reference in most setups.
    attachments.items.push({
      item: {
        file: {
          absoluteUri
        }
      }
    });

    lastIndex = fileRegex.lastIndex;
  }

  // Push remaining text
  if (lastIndex < originalText.length) {
    attachments.items.push({ text: originalText.substring(lastIndex) });
  }

  log.info({ cascadeId, ownerMapHas: convOwnerMap.has(cascadeId), ownerMapAgeMs: Date.now() - ownerMapAge, mode: agenticMode ? 'planning' : 'fast', port: conn.port, workspace: conn.workspace }, 'Send message');

  if (!convOwnerMap.has(cascadeId) || Date.now() - ownerMapAge > 30_000) {
    await refreshOwnerMap();
    log.debug({ cascadeId, ownerMapHas: convOwnerMap.has(cascadeId) }, 'OwnerMap refreshed');
  }

  log.debug({ port: conn.port, model: model || 'default', itemCount: attachments?.items?.length }, 'Routing to server');
  try {
    // We pass `text=""` because we packed all text and file mentions into attachments.items
    const data = await grpc.sendMessage(conn.port, conn.csrf, conn.apiKey, cascadeId, text, model, agenticMode, attachments);
    // Check for gRPC-level errors in the response
    if (data?.error) {
      log.warn({ cascadeId, error: data.error, port: conn.port }, 'gRPC response contains error');
      // Retry once on "agent state not found" — cascade may need a LoadTrajectory warm-up
      if (typeof data.error?.message === 'string' && data.error.message.includes('agent state') && data.error.message.includes('not found')) {
        log.info({ cascadeId, port: conn.port }, 'Agent state not found — attempting LoadTrajectory warm-up and retry');
        try {
          await grpc.loadTrajectory(conn.port, conn.csrf, cascadeId);
          await new Promise(r => setTimeout(r, 500));
          const retryData = await grpc.sendMessage(conn.port, conn.csrf, conn.apiKey, cascadeId, text, model, agenticMode, attachments);
          if (retryData?.error) {
            log.error({ cascadeId, error: retryData.error, port: conn.port }, 'Retry also failed');
            return NextResponse.json({ error: retryData.error.message || 'Send failed after retry' }, { status: 500 });
          }
          log.info({ cascadeId }, 'Retry succeeded after LoadTrajectory warm-up');
          return NextResponse.json({ ok: true, data: retryData });
        } catch (retryErr: unknown) {
          log.error({ err: getErrorMessage(retryErr), cascadeId }, 'Retry send failed');
          return NextResponse.json({ error: getErrorMessage(retryErr) }, { status: 500 });
        }
      }
    }
    return NextResponse.json({ ok: true, data });
  } catch (error: unknown) {
    log.error({ err: getErrorMessage(error), cascadeId }, 'Send message failed');
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
