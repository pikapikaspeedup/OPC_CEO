import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';

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
});
