import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';

import { CORRELATION_ID_HEADER } from '@/lib/request-context';
import {
  jsonResponse,
  methodNotAllowedResponse,
  startRouteServer,
} from './http-server';

const servers: Server[] = [];

function listenForTest(routes: Parameters<typeof startRouteServer>[0]['routes']): Promise<string> {
  const server = startRouteServer({
    name: 'test',
    port: 0,
    hostname: '127.0.0.1',
    routes,
  });
  servers.push(server);

  return new Promise((resolve) => {
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected TCP server address');
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe('startRouteServer', () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
  });

  it('falls through method-not-allowed matches so split control/runtime routes can share a path', async () => {
    const baseUrl = await listenForTest([
      {
        pattern: /^\/api\/conversations$/,
        handler: async (req) => req.method === 'GET'
          ? jsonResponse({ route: 'control-plane' })
          : methodNotAllowedResponse(['GET']),
      },
      {
        pattern: /^\/api\/conversations$/,
        handler: async (req) => req.method === 'POST'
          ? jsonResponse({ route: 'runtime' })
          : methodNotAllowedResponse(['POST']),
      },
    ]);

    const getResponse = await fetch(`${baseUrl}/api/conversations`);
    await expect(getResponse.json()).resolves.toEqual({ route: 'control-plane' });

    const postResponse = await fetch(`${baseUrl}/api/conversations`, { method: 'POST' });
    expect(postResponse.status).toBe(200);
    await expect(postResponse.json()).resolves.toEqual({ route: 'runtime' });
  });

  it('keeps returning 405 when every matching route rejects the method', async () => {
    const baseUrl = await listenForTest([
      {
        pattern: /^\/api\/conversations$/,
        handler: async (req) => req.method === 'GET'
          ? jsonResponse({ route: 'control-plane' })
          : methodNotAllowedResponse(['GET']),
      },
    ]);

    const response = await fetch(`${baseUrl}/api/conversations`, { method: 'DELETE' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    await expect(response.json()).resolves.toEqual({ error: 'Method not allowed' });
  });

  it('generates a correlation id for incoming requests and exposes it to handlers', async () => {
    const baseUrl = await listenForTest([
      {
        pattern: /^\/api\/health$/,
        handler: async (req) => jsonResponse({
          correlationId: req.headers.get(CORRELATION_ID_HEADER),
        }),
      },
    ]);

    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json() as { correlationId?: string };

    expect(response.status).toBe(200);
    expect(body.correlationId).toBeTruthy();
    expect(response.headers.get(CORRELATION_ID_HEADER)).toBe(body.correlationId);
  });

  it('preserves a caller-provided correlation id', async () => {
    const baseUrl = await listenForTest([
      {
        pattern: /^\/api\/health$/,
        handler: async (req) => jsonResponse({
          correlationId: req.headers.get(CORRELATION_ID_HEADER),
        }),
      },
    ]);

    const response = await fetch(`${baseUrl}/api/health`, {
      headers: {
        [CORRELATION_ID_HEADER]: 'corr-test-123',
      },
    });
    const body = await response.json() as { correlationId?: string };

    expect(response.status).toBe(200);
    expect(body.correlationId).toBe('corr-test-123');
    expect(response.headers.get(CORRELATION_ID_HEADER)).toBe('corr-test-123');
  });
});
