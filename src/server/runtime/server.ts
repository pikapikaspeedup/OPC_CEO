import { createLogger } from '@/lib/logger';
import { DELETE as deleteAgentRun } from '@/app/api/agent-runs/[id]/route';
import { POST as postAgentRunIntervene } from '@/app/api/agent-runs/[id]/intervene/route';
import { GET as getAgentRunStream } from '@/app/api/agent-runs/[id]/stream/route';
import { POST as postConversations } from '@/app/api/conversations/route';
import { GET as getConversationSteps } from '@/app/api/conversations/[id]/steps/route';
import { POST as postConversationSend } from '@/app/api/conversations/[id]/send/route';
import { POST as postConversationCancel } from '@/app/api/conversations/[id]/cancel/route';
import { POST as postProjectResume } from '@/app/api/projects/[id]/resume/route';
import { handleRuntimeAgentRunDispatch } from '@/server/runtime/agent-runs-dispatch';
import {
  jsonResponse,
  methodNotAllowedResponse,
  startRouteServer,
} from '@/server/shared/http-server';

const log = createLogger('RuntimeServer');

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

export function startRuntimeServer(options: {
  port: number;
  hostname?: string;
}) {
  const server = startRouteServer({
    name: 'runtime',
    port: options.port,
    hostname: options.hostname,
    routes: [
      {
        pattern: /^\/health$/,
        handler: async () => jsonResponse({ ok: true, role: 'runtime' }),
      },
      {
        pattern: /^\/internal\/runtime\/agent-runs$/,
        handler: async (req) => {
          if (req.method === 'POST') {
            return handleRuntimeAgentRunDispatch(req);
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/internal\/runtime\/language-servers$/,
        handler: async (req) => {
          if (req.method !== 'GET') {
            return methodNotAllowedResponse(['GET']);
          }
          const { discoverLanguageServers } = await import('@/lib/bridge/gateway');
          return jsonResponse(await discoverLanguageServers());
        },
      },
      {
        pattern: /^\/internal\/runtime\/conversations\/([^/]+)\/owner$/,
        handler: async (req, match) => {
          if (req.method !== 'GET') {
            return methodNotAllowedResponse(['GET']);
          }
          const { getOwnerConnection } = await import('@/lib/bridge/gateway');
          return jsonResponse(await getOwnerConnection(decodeURIComponent(match[1])));
        },
      },
      {
        pattern: /^\/internal\/runtime\/conversations\/([^/]+)\/steps$/,
        handler: async (req, match) => {
          if (req.method === 'GET') {
            return getConversationSteps(req, params(decodeURIComponent(match[1])));
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/agent-runs\/([^/]+)$/,
        handler: async (req, match) => {
          if (req.method === 'DELETE') {
            return deleteAgentRun(req, params(decodeURIComponent(match[1])));
          }
          return methodNotAllowedResponse(['DELETE']);
        },
      },
      {
        pattern: /^\/api\/agent-runs\/([^/]+)\/intervene$/,
        handler: async (req, match) => {
          if (req.method === 'POST') {
            return postAgentRunIntervene(req, params(decodeURIComponent(match[1])));
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/agent-runs\/([^/]+)\/stream$/,
        handler: async (req, match) => {
          if (req.method === 'GET') {
            return getAgentRunStream(req as any, params(decodeURIComponent(match[1])));
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/conversations$/,
        handler: async (req) => {
          if (req.method === 'POST') {
            return postConversations(req);
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/conversations\/([^/]+)\/steps$/,
        handler: async (req, match) => {
          if (req.method === 'GET') {
            return getConversationSteps(req, params(decodeURIComponent(match[1])));
          }
          return methodNotAllowedResponse(['GET']);
        },
      },
      {
        pattern: /^\/api\/conversations\/([^/]+)\/send$/,
        handler: async (req, match) => {
          if (req.method === 'POST') {
            return postConversationSend(req, params(decodeURIComponent(match[1])));
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/conversations\/([^/]+)\/cancel$/,
        handler: async (req, match) => {
          if (req.method === 'POST') {
            return postConversationCancel(req, params(decodeURIComponent(match[1])));
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
      {
        pattern: /^\/api\/projects\/([^/]+)\/resume$/,
        handler: async (req, match) => {
          if (req.method === 'POST') {
            return postProjectResume(req, params(decodeURIComponent(match[1])));
          }
          return methodNotAllowedResponse(['POST']);
        },
      },
    ],
  });

  log.info({ port: options.port }, 'Runtime server started');
  return server;
}
