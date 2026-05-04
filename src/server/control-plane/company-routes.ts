import {
  methodNotAllowedResponse,
  type RouteDefinition,
} from '@/server/shared/http-server';

function idParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: decodeURIComponent(id) }) };
}

function runIdParams(runId: string): { params: Promise<{ runId: string }> } {
  return { params: Promise.resolve({ runId: decodeURIComponent(runId) }) };
}

export function createCompanyControlPlaneRoutes(): RouteDefinition[] {
  return [
    {
      pattern: /^\/api\/company\/run-capsules$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/run-capsules/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/run-capsules\/([^/]+)$/,
      handler: async (req, match) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/run-capsules/[runId]/route');
          return GET(req, runIdParams(match[1]));
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/memory-candidates$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/memory-candidates/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/memory-candidates\/([^/]+)\/promote$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/memory-candidates/[id]/promote/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/memory-candidates\/([^/]+)\/reject$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/memory-candidates/[id]/reject/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/memory-candidates\/([^/]+)$/,
      handler: async (req, match) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/memory-candidates/[id]/route');
          return GET(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/signals$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/signals/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/signals\/([^/]+)\/dismiss$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/signals/[id]/dismiss/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/signals\/([^/]+)$/,
      handler: async (req, match) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/signals/[id]/route');
          return GET(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/agenda$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/agenda/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/agenda\/([^/]+)\/dismiss$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/agenda/[id]/dismiss/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/agenda\/([^/]+)\/snooze$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/agenda/[id]/snooze/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/agenda\/([^/]+)\/dispatch-check$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/agenda/[id]/dispatch-check/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/agenda\/([^/]+)\/dispatch$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/agenda/[id]/dispatch/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/agenda\/([^/]+)$/,
      handler: async (req, match) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/agenda/[id]/route');
          return GET(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/operating-day$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/operating-day/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/budget\/policies$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/budget/policies/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/budget\/policies\/([^/]+)$/,
      handler: async (req, match) => {
        const params = idParams(match[1]);
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/budget/policies/[id]/route');
          return GET(req, params);
        }
        if (req.method === 'PUT') {
          const { PUT } = await import('@/app/api/company/budget/policies/[id]/route');
          return PUT(req, params);
        }
        return methodNotAllowedResponse(['GET', 'PUT']);
      },
    },
    {
      pattern: /^\/api\/company\/budget\/ledger$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/budget/ledger/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/circuit-breakers$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/circuit-breakers/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/circuit-breakers\/([^/]+)\/reset$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/circuit-breakers/[id]/reset/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/growth\/proposals$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/growth/proposals/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/growth\/proposals\/generate$/,
      handler: async (req) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/growth/proposals/generate/route');
          return POST(req);
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/growth\/proposals\/([^/]+)\/evaluate$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/growth/proposals/[id]/evaluate/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/growth\/proposals\/([^/]+)\/approve$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/growth/proposals/[id]/approve/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/growth\/proposals\/([^/]+)\/reject$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/growth/proposals/[id]/reject/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/growth\/proposals\/([^/]+)\/publish$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/growth/proposals/[id]/publish/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/growth\/proposals\/([^/]+)\/dry-run$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/growth/proposals/[id]/dry-run/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/growth\/proposals\/([^/]+)$/,
      handler: async (req, match) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/growth/proposals/[id]/route');
          return GET(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/growth\/observations$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/growth/observations/route');
          return GET(req);
        }
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/growth/observations/route');
          return POST(req);
        }
        return methodNotAllowedResponse(['GET', 'POST']);
      },
    },
    {
      pattern: /^\/api\/company\/loops\/notification-targets$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/loops/notification-targets/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/loops\/policies$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/loops/policies/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/loops\/policies\/([^/]+)$/,
      handler: async (req, match) => {
        const params = idParams(match[1]);
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/loops/policies/[id]/route');
          return GET(req, params);
        }
        if (req.method === 'PUT') {
          const { PUT } = await import('@/app/api/company/loops/policies/[id]/route');
          return PUT(req, params);
        }
        return methodNotAllowedResponse(['GET', 'PUT']);
      },
    },
    {
      pattern: /^\/api\/company\/loops\/runs$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/loops/runs/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/loops\/runs\/([^/]+)\/retry$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/loops/runs/[id]/retry/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/loops\/runs\/([^/]+)$/,
      handler: async (req, match) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/loops/runs/[id]/route');
          return GET(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/loops\/run-now$/,
      handler: async (req) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/loops/run-now/route');
          return POST(req);
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/loops\/digests$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/loops/digests/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/loops\/digests\/([^/]+)$/,
      handler: async (req, match) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/loops/digests/[id]/route');
          return GET(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/self-improvement\/signals$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/self-improvement/signals/route');
          return GET(req);
        }
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/self-improvement/signals/route');
          return POST(req);
        }
        return methodNotAllowedResponse(['GET', 'POST']);
      },
    },
    {
      pattern: /^\/api\/company\/self-improvement\/proposals$/,
      handler: async (req) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/self-improvement/proposals/route');
          return GET(req);
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
    {
      pattern: /^\/api\/company\/self-improvement\/proposals\/generate$/,
      handler: async (req) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/self-improvement/proposals/generate/route');
          return POST(req);
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/self-improvement\/proposals\/([^/]+)\/evaluate$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/self-improvement/proposals/[id]/evaluate/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/self-improvement\/proposals\/([^/]+)\/approve$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/self-improvement/proposals/[id]/approve/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/self-improvement\/proposals\/([^/]+)\/run-codex$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/self-improvement/proposals/[id]/run-codex/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/self-improvement\/proposals\/([^/]+)\/release-gate$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/self-improvement/proposals/[id]/release-gate/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/self-improvement\/proposals\/([^/]+)\/reject$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/self-improvement/proposals/[id]/reject/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/self-improvement\/proposals\/([^/]+)\/attach-test-evidence$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/self-improvement/proposals/[id]/attach-test-evidence/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/self-improvement\/proposals\/([^/]+)\/observe$/,
      handler: async (req, match) => {
        if (req.method === 'POST') {
          const { POST } = await import('@/app/api/company/self-improvement/proposals/[id]/observe/route');
          return POST(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['POST']);
      },
    },
    {
      pattern: /^\/api\/company\/self-improvement\/proposals\/([^/]+)$/,
      handler: async (req, match) => {
        if (req.method === 'GET') {
          const { GET } = await import('@/app/api/company/self-improvement/proposals/[id]/route');
          return GET(req, idParams(match[1]));
        }
        return methodNotAllowedResponse(['GET']);
      },
    },
  ];
}
