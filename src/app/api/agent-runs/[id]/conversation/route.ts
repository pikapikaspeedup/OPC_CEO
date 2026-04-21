import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { AgentRunState } from '@/lib/agents/group-types';
import { ensureConversationRecordForSession } from '@/lib/bridge/gateway';
import { isSupportedLocalProvider } from '@/lib/local-provider-conversations';
import {
  readLocalProviderTranscriptMessages,
  readTranscriptFromRunHistory,
} from '@/lib/run-conversation-transcript';
import { getRunRecord } from '@/lib/storage/gateway-db';
import {
  proxyToControlPlane,
  shouldProxyControlPlaneRequest,
} from '@/server/shared/proxy';

export const dynamic = 'force-dynamic';

function readAssistantDraftFromArtifacts(run: AgentRunState | null): string | null {
  if (!run?.workspace || !run.artifactDir) return null;
  const workspacePath = run.workspace.replace(/^file:\/\//, '');
  const artifactAbsDir = path.join(workspacePath, run.artifactDir);
  if (!fs.existsSync(artifactAbsDir)) return null;

  const ignored = new Set([
    'result.json',
    'result-envelope.json',
    'task-envelope.json',
    'artifacts.manifest.json',
  ]);

  try {
    const candidates = fs.readdirSync(artifactAbsDir)
      .filter((entry) => entry.endsWith('.md') && !ignored.has(entry))
      .sort();
    if (candidates.length === 0) return null;
    return fs.readFileSync(path.join(artifactAbsDir, candidates[0]), 'utf-8');
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (shouldProxyControlPlaneRequest()) {
    return proxyToControlPlane(_req);
  }

  const { id } = await params;
  const run = getRunRecord(id);
  if (!run) {
    return NextResponse.json({ error: `Run not found: ${id}` }, { status: 404 });
  }

  if (run.childConversationId) {
    return NextResponse.json({
      kind: 'conversation',
      provider: run.provider,
      conversationId: run.childConversationId,
      title: run.prompt,
    });
  }

  const handle = run.sessionProvenance?.handle;
  const localProvider = isSupportedLocalProvider(run.provider) ? run.provider : null;
  if (handle && localProvider) {
    const messages = readLocalProviderTranscriptMessages(localProvider, handle, run);
    const conversationRecord = ensureConversationRecordForSession({
      sessionHandle: handle,
      workspace: run.workspace,
      title: run.prompt || `Run ${run.runId.slice(0, 8)}`,
      provider: localProvider,
      stepCount: messages?.length ?? 0,
    });

    if (messages?.length) {
      return NextResponse.json({
        kind: 'transcript',
        provider: run.provider,
        handle,
        messages,
        viewerConversationId: conversationRecord.id,
        viewerTitle: conversationRecord.title,
      });
    }

    return NextResponse.json({
      kind: 'conversation',
      provider: run.provider,
      conversationId: conversationRecord.id,
      title: conversationRecord.title,
    });
  }

  const historyTranscript = readTranscriptFromRunHistory(run);
  if (historyTranscript?.length) {
    return NextResponse.json({
      kind: 'transcript',
      provider: run.provider,
      handle,
      messages: historyTranscript,
    });
  }

  const assistantDraft = readAssistantDraftFromArtifacts(run);
  if (assistantDraft) {
    return NextResponse.json({
      kind: 'transcript',
      provider: run.provider,
      handle,
      messages: [
        { role: 'user', content: run.prompt },
        { role: 'assistant', content: assistantDraft },
      ],
    });
  }

  return NextResponse.json({
    kind: 'unavailable',
    provider: run.provider,
    reason: '当前 provider 没有可展示的 AI 对话内容。',
  });
}
