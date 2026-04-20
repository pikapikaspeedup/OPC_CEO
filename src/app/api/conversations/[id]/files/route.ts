import { NextResponse } from 'next/server';
import { getOwnerConnection, resolveConversationRecord } from '@/lib/bridge/gateway';
import { inferLocalProviderFromConversation } from '@/lib/local-provider-conversations';
import { createLogger } from '@/lib/logger';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { findRunRecordByConversationRef } from '@/lib/storage/gateway-db';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const q = url.searchParams.get('q') || '';
  const maxResults = 25;
  const conversationRecord = resolveConversationRecord(id);
  const localProvider = inferLocalProviderFromConversation(id, conversationRecord?.provider);
  const conn = localProvider ? null : await getOwnerConnection(id);
  const backingRun = findRunRecordByConversationRef({
    sessionHandles: [id, conversationRecord?.sessionHandle].filter(Boolean) as string[],
    conversationIds: [id, conversationRecord?.id].filter(Boolean) as string[],
  });

  const workspacePath = conversationRecord?.workspace?.replace(/^file:\/\//, '')
    || conn?.workspace?.replace(/^file:\/\//, '')
    || backingRun?.workspace.replace(/^file:\/\//, '')
    || process.cwd();
  
  try {
    // Sanitize query to prevent injection — only allow alphanumeric, dots, dashes, underscores
    const safeQ = q.replace(/[^a-zA-Z0-9._\-]/g, '');
    
    // Use execFile with args array to prevent shell injection
    const { stdout } = await execFileAsync('find', [
      workspacePath,
      '-type', 'd', '(',
      '-name', 'node_modules', '-o',
      '-name', '.git', '-o',
      '-name', '.next', '-o',
      '-name', 'dist', '-o',
      '-name', 'out',
      ')', '-prune', '-o',
      '-type', 'f',
      '-iname', `*${safeQ}*`,
      '-print'
    ]);
    const lines = stdout.split('\n').filter(Boolean).slice(0, maxResults);
    
    const files = lines.map(f => {
      let relativePath = f.replace(workspacePath + '/', '');
      if (relativePath === f) {
        // if workspacePath wasn't matched (edge case), just try string replace
        relativePath = f.replace(workspacePath, '').replace(/^\//, '');
      }
      return {
        absolutePath: f,
        relativePath,
        name: f.split('/').pop() || ''
      };
    });
    
    return NextResponse.json({ files });
  } catch (error: unknown) {
    const log = createLogger('FileSearch');
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ err: message }, 'Error running find command');
    return NextResponse.json({ files: [], error: message });
  }
}
