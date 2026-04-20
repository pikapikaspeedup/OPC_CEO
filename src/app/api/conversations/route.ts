import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import path from 'path';
import { readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { execSync } from 'child_process';
import {
  getAllConnections, getConversations, addLocalConversation,
  refreshOwnerMap, convOwnerMap, preRegisterOwner, getApiKey,
  discoverLanguageServers, getLanguageServer, generatePlaygroundName,
  PLAYGROUND_DIR_PATH, grpc,
} from '@/lib/bridge/gateway';
import { mkdirSync } from 'fs';
import { resolveProvider } from '@/lib/providers';
import {
  buildLocalProviderConversationId,
  isSupportedLocalProvider,
} from '@/lib/local-provider-conversations';
import { listChildConversationIdsFromRuns } from '@/lib/storage/gateway-db';

export const dynamic = 'force-dynamic';

const log = createLogger('NewConv');
const CEO_WORKSPACE_URI = 'file:///Users/darrel/.gemini/antigravity/ceo-workspace';
const PROVIDER_TITLES: Record<string, string> = {
  codex: 'Codex',
  'native-codex': 'Native Codex',
  'claude-api': 'Claude API',
  'openai-api': 'OpenAI API',
  'gemini-api': 'Gemini API',
  'grok-api': 'Grok API',
  custom: 'Custom API',
};

const CONVERSATIONS_DIR = path.join(homedir(), '.gemini/antigravity/conversations');

interface ConvCache { id: string; title: string; workspace: string; mtime: number; steps: number; }
interface TrajectorySummary {
  summary?: string;
  workspaces?: Array<{ workspaceFolderAbsoluteUri?: string }>;
  stepCount?: number;
}

let convCache: ConvCache[] = [];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// GET /api/conversations — list conversations
export async function GET(req: Request) {
  // Optional workspace filter: ?workspace=file:///path/to/dir
  const url = new URL(req.url);
  const filterWorkspace = url.searchParams.get('workspace') || '';

  try {
    const files = readdirSync(CONVERSATIONS_DIR)
      .filter(f => f.endsWith('.pb'))
      .map(f => {
        const id = f.replace('.pb', '');
        const stat = statSync(path.join(CONVERSATIONS_DIR, f));
        return { id, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime);

    await refreshOwnerMap();

    const allConversations = getConversations();
    const sqliteMap = new Map<string, (typeof allConversations)[number]>();
    allConversations.forEach((conversation) => sqliteMap.set(conversation.id, conversation));

    const oldCacheMap = new Map<string, ConvCache>();
    convCache.forEach(c => oldCacheMap.set(c.id, c));

    const conns = await getAllConnections();
    const serverTrajectories = new Map<string, Map<string, TrajectorySummary>>();
    for (const conn of conns) {
      try {
        const data = await grpc.getAllCascadeTrajectories(conn.port, conn.csrf);
        const summaries = data?.trajectorySummaries || {};
        serverTrajectories.set(String(conn.port), new Map(Object.entries(summaries)));
      } catch { }
    }

    // Get hidden child conversation IDs from run registry
    const hiddenChildIds = new Set(listChildConversationIdsFromRuns());

    const results: ConvCache[] = [];
    const seenIds = new Set<string>();

    for (const file of files) {
      // Filter out hidden child conversations
      if (hiddenChildIds.has(file.id)) continue;

      let title = '';
      let workspace = '';
      let steps = 0;

      const owner = convOwnerMap.get(file.id);
      if (owner) {
        const ownerTraj = serverTrajectories.get(String(owner.port));
        const live = ownerTraj?.get(file.id);
        if (live) {
          title = live.summary || '';
          const liveWorkspaces = live.workspaces || [];
          if (liveWorkspaces.length > 0) {
            workspace = liveWorkspaces[0].workspaceFolderAbsoluteUri || '';
          }
          steps = live.stepCount || 0;
        }
      }

      if (!title) {
        const lc = oldCacheMap.get(file.id);
        if (lc?.title) { title = lc.title; workspace = workspace || lc.workspace; steps = Math.max(steps, lc.steps); }
      }

      const sqliteEntry = sqliteMap.get(file.id);
      if (!title && sqliteEntry?.title && sqliteEntry.title !== 'Untitled') {
        title = sqliteEntry.title; workspace = workspace || sqliteEntry.workspace || '';
        steps = Math.max(steps, sqliteEntry.stepCount || 0);
      }

      workspace = workspace || sqliteEntry?.workspace || '';
      results.push({ id: file.id, title: title || `Conversation ${file.id.slice(0, 8)}`, workspace, mtime: file.mtime, steps });
      seenIds.add(file.id);
    }

    for (const conversation of allConversations) {
      if (hiddenChildIds.has(conversation.id) || seenIds.has(conversation.id)) continue;
      results.push({
        id: conversation.id,
        title: conversation.title || `Conversation ${conversation.id.slice(0, 8)}`,
        workspace: conversation.workspace || '',
        mtime: conversation.createdAt ? new Date(conversation.createdAt).getTime() : 0,
        steps: conversation.stepCount || 0,
      });
    }

    results.sort((a, b) => b.mtime - a.mtime);
    convCache = results;

    // Apply workspace filter if provided
    const filtered = filterWorkspace
      ? results.filter(c => {
          if (!c.workspace) return false;
          // Match if either is a prefix of the other (vault may be nested in workspace or vice versa)
          return c.workspace.startsWith(filterWorkspace) || filterWorkspace.startsWith(c.workspace);
        })
      : results;

    return NextResponse.json(filtered);
  } catch {
    const conversations = getConversations();
    return NextResponse.json(conversations);
  }
}

// POST /api/conversations — create new conversation
export async function POST(req: Request) {
  let workspace = 'playground';
  try {
    const body = await req.json();
    if (body?.workspace) workspace = body.workspace;
  } catch {}

  const apiKey = getApiKey();

  // --- Playground flow ---
  if (workspace === 'playground') {
    if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 503 });
    const name = generatePlaygroundName();
    const folderPath = path.join(PLAYGROUND_DIR_PATH, name);
    mkdirSync(folderPath, { recursive: true });

    let servers = await discoverLanguageServers();
    let pgServer = servers.find(s => s.workspace?.endsWith('/playground') || s.workspace?.includes('/playground/'));

    if (!pgServer) {
      log.info('No Playground server found, auto-launching...');
      try {
        const ANTIGRAVITY_CLI = '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity';
        execSync(`"${ANTIGRAVITY_CLI}" --new-window "${PLAYGROUND_DIR_PATH}"`, {
          timeout: 5000,
          stdio: 'ignore',
        });
        
        // Wait up to 5 seconds for the language server to register
        let retries = 10;
        while (retries > 0 && !pgServer) {
          await new Promise(r => setTimeout(r, 500));
          servers = await discoverLanguageServers();
          pgServer = servers.find(s => s.workspace?.endsWith('/playground') || s.workspace?.includes('/playground/'));
          retries--;
        }
      } catch (error: unknown) {
        log.error({ err: getErrorMessage(error) }, 'Failed to launch Playground');
      }
    }

    if (!pgServer) return NextResponse.json({ error: 'No Playground language_server found (failed to auto-launch)' }, { status: 503 });

    try {
      await grpc.addTrackedWorkspace(pgServer.port, pgServer.csrf, folderPath);
      const wsUri = `file://${folderPath}`;
      const data = await grpc.startCascade(pgServer.port, pgServer.csrf, apiKey, wsUri);
      if (data.cascadeId) {
        addLocalConversation(data.cascadeId, wsUri, `Playground: ${name}`);
        // Mimic Agent Manager: add view time annotation so it tracks properly
        await grpc.updateConversationAnnotations(pgServer.port, pgServer.csrf, apiKey, data.cascadeId, {
          lastUserViewTime: new Date().toISOString()
        }).catch(() => { });
        // Pre-register owner (was missing — caused routing failures on first send)
        preRegisterOwner(data.cascadeId, {
          port: pgServer.port,
          csrf: pgServer.csrf,
          apiKey,
          stepCount: 0,
        });
        // Warm up agent state
        try {
          await grpc.loadTrajectory(pgServer.port, pgServer.csrf, data.cascadeId);
        } catch { /* non-fatal */ }
      }
      return NextResponse.json(data);
    } catch (error: unknown) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
  }

  // --- Normal workspace flow ---
  const wsUri = workspace;
  log.info({ workspace, wsUri }, 'New conversation started');
  log.debug({ rawWorkspace: workspace, resolvedUri: wsUri }, 'Request details');

  const workspacePath = wsUri.replace(/^file:\/\//, '');
  const providerInfo = resolveProvider('execution', workspacePath);

  if (isSupportedLocalProvider(providerInfo.provider)) {
    const cascadeId = buildLocalProviderConversationId(providerInfo.provider);
    const wsName = wsUri.split('/').pop() || 'conversation';
    const title = wsUri === CEO_WORKSPACE_URI
      ? 'CEO Office'
      : `${PROVIDER_TITLES[providerInfo.provider] || providerInfo.provider}: ${wsName}`;

    addLocalConversation(cascadeId, wsUri, title, {
      provider: providerInfo.provider,
      sessionHandle: '',
    });
    log.info({ cascadeId, provider: providerInfo.provider, workspacePath }, 'Created local provider conversation without IDE');
    return NextResponse.json({ cascadeId, state: 'idle', provider: providerInfo.provider });
  }

  if (!apiKey) return NextResponse.json({ error: 'No API key' }, { status: 503 });

  // Find a matching server for this workspace (Antigravity mode)
  const srv = await getLanguageServer(wsUri);
  const isMatch = !!srv && (srv.workspace === wsUri || srv.workspace?.includes(wsUri) || wsUri.includes(srv.workspace || '\0'));

  if (!srv || !isMatch) {
    log.warn({ wsUri }, 'No matching server — workspace needs to be opened first');
    return NextResponse.json({
      error: 'workspace_not_running',
      message: `Workspace is not running. Please open it in Antigravity first.`,
      workspace: wsUri,
    }, { status: 503 });
  }

  log.info({ port: srv.port, pid: srv.pid, workspace: srv.workspace }, 'Matched server');

  try {
    // Step 1: AddTrackedWorkspace
    const workspacePath = wsUri.replace(/^file:\/\//, '');
    log.debug({ port: srv.port, workspacePath }, 'Step1 AddTrackedWorkspace');
    const addResult = await grpc.addTrackedWorkspace(srv.port, srv.csrf, workspacePath);
    log.debug({ response: addResult }, 'Step1 Response');

    // Step 2: StartCascade
    log.debug({ port: srv.port, wsUri, serverWorkspace: srv.workspace }, 'Step2 StartCascade');
    const data = await grpc.startCascade(srv.port, srv.csrf, apiKey, wsUri);
    log.info({ cascadeId: data.cascadeId, wsUri, port: srv.port, startCascadeResponse: JSON.stringify(data).slice(0, 500) }, 'Step2 Response');

    // Step 2.5: LoadTrajectory — warm up agent state to prevent "agent state not found" on first send
    if (data.cascadeId) {
      try {
        await grpc.loadTrajectory(srv.port, srv.csrf, data.cascadeId);
        log.debug({ cascadeId: data.cascadeId }, 'Step2.5 LoadTrajectory warm-up done');
        } catch (error: unknown) {
          log.warn({ cascadeId: data.cascadeId, err: getErrorMessage(error) }, 'Step2.5 LoadTrajectory warm-up failed (non-fatal)');
        }
      }

    // Step 3: UpdateConversationAnnotations + local tracking
    if (data.cascadeId) {
      const wsName = wsUri.split('/').pop() || 'conversation';
      addLocalConversation(data.cascadeId, wsUri, `New: ${wsName}`);

      log.debug({ cascadeId: data.cascadeId }, 'Step3 UpdateAnnotations');
      const nowTs = new Date().toISOString();
      const annotResult = await grpc.updateConversationAnnotations(srv.port, srv.csrf, apiKey, data.cascadeId, {
        lastUserViewTime: nowTs,
        summary: `Antigravity Web: ${wsName} (${new Date().toLocaleTimeString()})`
      }).catch((error: unknown) => { log.error({ err: getErrorMessage(error) }, 'Step3 Error'); return null; });
      log.debug({ response: annotResult }, 'Step3 Response');

      // Pre-register in ownerMap — survives refreshOwnerMap() clears for 60s
      preRegisterOwner(data.cascadeId, {
        port: srv.port,
        csrf: srv.csrf,
        apiKey,
        stepCount: 0,
      });
    }
    log.info({ cascadeId: data.cascadeId }, 'Conversation created successfully');
    return NextResponse.json(data);
  } catch (error: unknown) {
    log.error({ err: getErrorMessage(error) }, 'Conversation creation failed');
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
