import { createLogger } from '@/lib/logger';
import { createControlPlaneRoutes } from '@/server/control-plane/server';
import { createRuntimeRoutes } from '@/server/runtime/server';
import {
  jsonResponse,
  startRouteServer,
} from '@/server/shared/http-server';

const log = createLogger('ApiServer');

export function startApiServer(options: {
  port: number;
  hostname?: string;
}) {
  const server = startRouteServer({
    name: 'api',
    port: options.port,
    hostname: options.hostname,
    routes: [
      {
        pattern: /^\/health$/,
        handler: async () => jsonResponse({ ok: true, role: 'api' }),
      },
      ...createControlPlaneRoutes({ includeHealth: false }),
      ...createRuntimeRoutes({ includeHealth: false }),
    ],
  });

  log.info({ port: options.port }, 'API server started');
  return server;
}
