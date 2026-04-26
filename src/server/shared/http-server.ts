import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';

export interface RouteDefinition {
  method?: string;
  pattern: RegExp;
  handler: (req: Request, match: RegExpMatchArray) => Promise<Response> | Response;
}

function hasRequestBody(method?: string): boolean {
  return !!method && method !== 'GET' && method !== 'HEAD';
}

async function toFetchRequest(
  req: IncomingMessage,
  origin: string,
): Promise<Request> {
  const url = new URL(req.url || '/', origin);
  const chunks: Buffer[] = [];

  if (hasRequestBody(req.method)) {
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  }

  return new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
  });
}

async function writeFetchResponse(
  res: ServerResponse,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;

  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => {
          res.once('drain', resolve);
        });
      }
    }
  } finally {
    reader.releaseLock();
  }
  res.end();
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

export function methodNotAllowedResponse(allowed: string[]): Response {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: {
      Allow: allowed.join(', '),
      'Content-Type': 'application/json',
    },
  });
}

export function notFoundResponse(): Response {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

export function startRouteServer(options: {
  name: string;
  port: number;
  hostname?: string;
  routes: RouteDefinition[];
}): Server {
  const hostname = options.hostname || '0.0.0.0';
  const server = createServer(async (req, res) => {
    try {
      const request = await toFetchRequest(req, `http://${hostname}:${options.port}`);
      const pathname = new URL(request.url).pathname;
      const routes = options.routes.filter((candidate) => {
        if (candidate.method && candidate.method !== request.method) {
          return false;
        }
        return candidate.pattern.test(pathname);
      });

      if (!routes.length) {
        await writeFetchResponse(res, notFoundResponse());
        return;
      }

      let methodNotAllowed: Response | null = null;
      for (const route of routes) {
        const match = pathname.match(route.pattern);
        if (!match) {
          continue;
        }

        const response = await route.handler(request, match);
        if (response.status !== 405) {
          await writeFetchResponse(res, response);
          return;
        }

        methodNotAllowed = methodNotAllowed || response;
      }

      await writeFetchResponse(res, methodNotAllowed || notFoundResponse());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await writeFetchResponse(res, jsonResponse({ error: message }, { status: 500 }));
    }
  });

  server.listen(options.port, hostname);
  return server;
}
