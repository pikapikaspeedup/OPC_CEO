import { NextResponse } from 'next/server';
import {
  addLocalConversation,
  getOwnerConnection,
  refreshOwnerMap,
  convOwnerMap,
  ownerMapAge,
  grpc,
  resolveConversationRecord,
  updateLocalConversation,
  getLanguageServer,
  getApiKey,
  preRegisterOwner,
} from '@/lib/bridge/gateway';
import { getExecutor } from '@/lib/providers';
import { createLogger } from '@/lib/logger';
import {
  appendLocalProviderConversationTurn,
  getLocalProviderTitle,
  inferLocalProviderFromConversation,
} from '@/lib/local-provider-conversations';
import {
  getProviderSessionHandle,
  resolveConversationProviderForTurn,
  updateProviderSessionState,
  type ProviderNeutralConversationRecord,
} from '@/lib/conversation-runtime';
import {
  isApiConversationProvider,
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
    provider?: string;
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
  const backingRun = findRunRecordByConversationRef({
    sessionHandles: [cascadeId, targetConv?.sessionHandle].filter(Boolean) as string[],
    conversationIds: [cascadeId, targetConv?.id].filter(Boolean) as string[],
  });
  const localWorkspace = targetConv?.workspace?.replace(/^file:\/\//, '')
    || backingRun?.workspace.replace(/^file:\/\//, '')
    || process.cwd();
  const conversationId = targetConv?.id || cascadeId;
  const targetProvider = resolveConversationProviderForTurn({
    requestedProvider: body.provider,
    workspacePath: localWorkspace,
    fallbackProvider: targetConv?.provider ?? null,
  });
  const localProvider = inferLocalProviderFromConversation(
    targetProvider ? '' : cascadeId,
    targetProvider ?? targetConv?.provider,
  );
  if (localProvider) {
    const providerSessionHandle = getProviderSessionHandle(
      targetConv as ProviderNeutralConversationRecord | null,
      localProvider,
    ) || backingRun?.sessionProvenance?.handle || '';

    log.info({ cascadeId, provider: localProvider, workspace: localWorkspace }, 'Routing to local provider conversation');

    try {
      let result;
      if (isApiConversationProvider(localProvider)) {
        result = await runApiConversationTurn(
          localProvider,
          localWorkspace,
          originalText,
          model,
          providerSessionHandle || undefined,
          conversationId,
        );
      } else {
        const executor = getExecutor(localProvider);
        if (providerSessionHandle) {
          try {
            result = await executor.appendMessage(providerSessionHandle, {
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

      const steps = appendLocalProviderConversationTurn(conversationId, originalText, result.content || '');
      const providerSessions = updateProviderSessionState(
        targetConv as ProviderNeutralConversationRecord | null,
        localProvider,
        result.handle,
        steps.length,
      );
      if (targetConv) {
        updateLocalConversation(targetConv.id, {
          provider: localProvider,
          sessionHandle: result.handle,
          stepCount: steps.length,
          providerSessions,
        });
      } else {
        const workspaceUri = backingRun?.workspace || `file://${localWorkspace}`;
        const workspaceName = localWorkspace.split('/').pop() || 'conversation';
        addLocalConversation(
          conversationId,
          workspaceUri,
          `${getLocalProviderTitle(localProvider)}: ${workspaceName}`,
          {
            provider: localProvider,
            sessionHandle: result.handle,
            stepCount: steps.length,
            providerSessions,
          },
        );
      }

      return NextResponse.json({ ok: true, data: { cascadeId, state: 'idle', provider: localProvider } });
    } catch (error: unknown) {
      log.error({ err: getErrorMessage(error), cascadeId, provider: localProvider }, 'Send message to local provider failed');
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
  }

  let antigravityCascadeId = targetProvider === 'antigravity'
    ? getProviderSessionHandle(targetConv as ProviderNeutralConversationRecord | null, 'antigravity')
      || (targetConv?.provider === 'antigravity' ? targetConv.sessionHandle : undefined)
      || (!targetConv ? cascadeId : undefined)
    : cascadeId;

  if (!antigravityCascadeId && targetProvider === 'antigravity' && targetConv) {
    const apiKey = getApiKey();
    if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 503 });
    const workspaceUri = targetConv.workspace || `file://${localWorkspace}`;
    const srv = await getLanguageServer(workspaceUri);
    if (!srv) {
      return NextResponse.json({
        error: 'workspace_not_running',
        message: 'Workspace is not running. Please open it in Antigravity first.',
        workspace: workspaceUri,
      }, { status: 503 });
    }

    const workspacePath = workspaceUri.replace(/^file:\/\//, '');
    await grpc.addTrackedWorkspace(srv.port, srv.csrf, workspacePath);
    const data = await grpc.startCascade(srv.port, srv.csrf, apiKey, workspaceUri);
    antigravityCascadeId = data.cascadeId;
    if (!antigravityCascadeId) {
      return NextResponse.json({ error: 'Antigravity did not return a cascade id' }, { status: 500 });
    }
    preRegisterOwner(antigravityCascadeId, {
      port: srv.port,
      csrf: srv.csrf,
      apiKey,
      stepCount: 0,
      workspace: workspaceUri,
    });
    const providerSessions = updateProviderSessionState(
      targetConv as ProviderNeutralConversationRecord,
      'antigravity',
      antigravityCascadeId,
      0,
    );
    updateLocalConversation(targetConv.id, {
      provider: 'antigravity',
      sessionHandle: antigravityCascadeId,
      providerSessions,
    });
  }

  const runtimeCascadeId = antigravityCascadeId || cascadeId;
  const conn = await getOwnerConnection(runtimeCascadeId);
  if (!conn) {
    log.error({ cascadeId: runtimeCascadeId, ownerMapSize: convOwnerMap.size }, 'No server available — possibly a routing issue for new conversation');
    return NextResponse.json({ error: 'No server available', cascadeId: runtimeCascadeId }, { status: 503 });
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

  log.info({ cascadeId: runtimeCascadeId, ownerMapHas: convOwnerMap.has(runtimeCascadeId), ownerMapAgeMs: Date.now() - ownerMapAge, mode: agenticMode ? 'planning' : 'fast', port: conn.port, workspace: conn.workspace }, 'Send message');

  if (!convOwnerMap.has(runtimeCascadeId) || Date.now() - ownerMapAge > 30_000) {
    await refreshOwnerMap();
    log.debug({ cascadeId: runtimeCascadeId, ownerMapHas: convOwnerMap.has(runtimeCascadeId) }, 'OwnerMap refreshed');
  }

  log.debug({ port: conn.port, model: model || 'default', itemCount: attachments?.items?.length }, 'Routing to server');
  try {
    // We pass `text=""` because we packed all text and file mentions into attachments.items
    const data = await grpc.sendMessage(conn.port, conn.csrf, conn.apiKey, runtimeCascadeId, text, model, agenticMode, attachments);
    // Check for gRPC-level errors in the response
    if (data?.error) {
      log.warn({ cascadeId: runtimeCascadeId, error: data.error, port: conn.port }, 'gRPC response contains error');
      // Retry once on "agent state not found" — cascade may need a LoadTrajectory warm-up
      if (typeof data.error?.message === 'string' && data.error.message.includes('agent state') && data.error.message.includes('not found')) {
        log.info({ cascadeId: runtimeCascadeId, port: conn.port }, 'Agent state not found — attempting LoadTrajectory warm-up and retry');
        try {
          await grpc.loadTrajectory(conn.port, conn.csrf, runtimeCascadeId);
          await new Promise(r => setTimeout(r, 500));
          const retryData = await grpc.sendMessage(conn.port, conn.csrf, conn.apiKey, runtimeCascadeId, text, model, agenticMode, attachments);
          if (retryData?.error) {
            log.error({ cascadeId: runtimeCascadeId, error: retryData.error, port: conn.port }, 'Retry also failed');
            return NextResponse.json({ error: retryData.error.message || 'Send failed after retry' }, { status: 500 });
          }
          log.info({ cascadeId: runtimeCascadeId }, 'Retry succeeded after LoadTrajectory warm-up');
          return NextResponse.json({ ok: true, data: retryData });
        } catch (retryErr: unknown) {
          log.error({ err: getErrorMessage(retryErr), cascadeId: runtimeCascadeId }, 'Retry send failed');
          return NextResponse.json({ error: getErrorMessage(retryErr) }, { status: 500 });
        }
      }
    }
    return NextResponse.json({ ok: true, data });
  } catch (error: unknown) {
    log.error({ err: getErrorMessage(error), cascadeId: runtimeCascadeId }, 'Send message failed');
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
