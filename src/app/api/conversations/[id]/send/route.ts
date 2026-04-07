import { NextResponse } from 'next/server';
import { getOwnerConnection, refreshOwnerMap, convOwnerMap, ownerMapAge, grpc, getConversations } from '@/lib/bridge/gateway';
import { getExecutor } from '@/lib/providers';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from '@/lib/logger';

const log = createLogger('SendMsg');

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: cascadeId } = await params;
  let { text, model, agenticMode = true, attachments } = await req.json();

  attachments = attachments || {};
  attachments.items = attachments.items || [];

  // Parse @[path/to/file] mentions
  const fileRegex = /@\[(.*?)\]/g;
  let match;
  let lastIndex = 0;
  const originalText = text;
  text = ""; // Clear text so grpc.ts doesn't duplicate

  // ---------------------------------------------------------------------------
  // Check if this is a Codex direct session (offline/no-IDE provider)
  // ---------------------------------------------------------------------------
  if (cascadeId.startsWith('codex-')) {
    const allConvs = getConversations();
    const targetConv = allConvs.find((c: any) => c.id === cascadeId);
    let codexWorkspace = targetConv?.workspace?.replace(/^file:\/\//, '') || process.cwd();
    
    log.info({ cascadeId, workspace: codexWorkspace }, 'Routing to Codex provider (no IDE required)');
    
    try {
      const executor = getExecutor('codex');
      // Codex executor appendMessage runs the whole turn and returns the final string and handle
      const result = await executor.appendMessage(cascadeId, { 
        prompt: originalText, 
        workspace: codexWorkspace, 
      });
      
      // Save it locally so the UI step poller can find it
      const convDir = path.join(os.homedir(), '.gemini/antigravity/conversations');
      const codexFile = path.join(convDir, `${cascadeId}.codex.json`);
      
      let pastSteps = [];
      if (fs.existsSync(codexFile)) {
        try { pastSteps = JSON.parse(fs.readFileSync(codexFile, 'utf-8')); } catch {}
      }
      
      // Append user message step
      pastSteps.push({
        id: `u-${Date.now()}`,
        status: 'CORTEX_STEP_STATUS_COMPLETED',
        kind: 'CORTEX_STEP_KIND_MESSAGE',
        assistantMessage: {
          prompt: { text: originalText }
        }
      });
      
      // Append assistant message step
      pastSteps.push({
        id: `a-${Date.now()}`,
        status: 'CORTEX_STEP_STATUS_COMPLETED',
        kind: 'CORTEX_STEP_KIND_MESSAGE',
        assistantMessage: {
          response: { text: result.content }
        }
      });
      
      fs.writeFileSync(codexFile, JSON.stringify(pastSteps, null, 2));

      return NextResponse.json({ ok: true, data: { cascadeId: result.handle, state: 'idle' } });
    } catch (e: any) {
      log.error({ err: e.message, cascadeId }, 'Send message to Codex failed');
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }
  // ---------------------------------------------------------------------------

  const conn = getOwnerConnection(cascadeId);
  if (!conn) return NextResponse.json({ error: 'No server available' }, { status: 503 });

  let workspacePath = conn.workspace?.replace(/^file:\/\//, '') || process.cwd();

  while ((match = fileRegex.exec(originalText)) !== null) {
    // Push text before the match
    if (match.index > lastIndex) {
      attachments.items.push({ text: originalText.substring(lastIndex, match.index) });
    }

    const rawPath = match[1];
    let absoluteUri = rawPath.startsWith('/') ? `file://${rawPath}` : `file://${workspacePath}/${rawPath}`;
    
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

  log.info({ cascadeId, ownerMapHas: convOwnerMap.has(cascadeId), ownerMapAgeMs: Date.now() - ownerMapAge, mode: agenticMode ? 'planning' : 'fast' }, 'Send message');

  if (!convOwnerMap.has(cascadeId) || Date.now() - ownerMapAge > 30_000) {
    await refreshOwnerMap();
    log.debug({ cascadeId, ownerMapHas: convOwnerMap.has(cascadeId) }, 'OwnerMap refreshed');
  }

  log.debug({ port: conn.port, model: model || 'default' }, 'Routing to server');
  try {
    // We pass `text=""` because we packed all text and file mentions into attachments.items
    const data = await grpc.sendMessage(conn.port, conn.csrf, conn.apiKey, cascadeId, text, model, agenticMode, attachments);
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    log.error({ err: e.message, cascadeId }, 'Send message failed');
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
