/**
 * Unified server launcher.
 *
 * Roles:
 * - all: legacy all-in-one mode (web + runtime bridge worker + scheduler)
 * - web: Next.js + WS ingress only
 * - control-plane: standalone REST API for hot list/query endpoints
 * - runtime: provider / conversation runtime API + optional bridge worker
 * - scheduler: standalone background services
 *
 * IMPORTANT: Bridge modules remain lazy-loaded so `tsx watch` does not restart
 * on every bridge file edit and collide with `.next/dev/lock`.
 */
import { type ChildProcess } from 'child_process';
import { createServer } from 'http';
import next from 'next';
import { parse } from 'url';
import { WebSocket, WebSocketServer } from 'ws';

import { extractLastTaskBoundary, mergeStepsUpdate } from './src/lib/agents/step-merger';
import { initializeGatewayHome } from './src/lib/agents/gateway-home';
import {
  getGatewayServerRole,
  shouldLaunchBridgeWorker,
  shouldStartSchedulerServices,
} from './src/lib/gateway-role';
import { createLogger } from './src/lib/logger';
import { launchBridgeWorkerProcess } from './src/server/runtime/bridge-worker-process';

const log = createLogger('Server');

const role = getGatewayServerRole(process.env);
const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '3000', 10);

type GatewayModule = typeof import('./src/lib/bridge/gateway');
type GrpcModule = typeof import('./src/lib/bridge/grpc');
type StreamStep = {
  type?: string;
  taskBoundary?: {
    mode?: string;
    taskName?: string;
    taskStatus?: string;
    taskSummary?: string;
  };
} & Record<string, unknown>;

let bridgeLoaded = false;
let gateway: GatewayModule | null = null;
let grpc: GrpcModule | null = null;
let bridgeWorkerProcess: ChildProcess | null = null;
let shuttingDown = false;

async function ensureBridge() {
  if (!bridgeLoaded) {
    gateway = await import('./src/lib/bridge/gateway');
    grpc = await import('./src/lib/bridge/grpc');
    bridgeLoaded = true;
  }
}

function getBridgeModules(): { gateway: GatewayModule; grpc: GrpcModule } {
  if (!gateway || !grpc) {
    throw new Error('Bridge modules have not been loaded');
  }
  return { gateway, grpc };
}

function startBridgeWorker(): void {
  if (!shouldLaunchBridgeWorker(process.env)) {
    if (process.env.AG_DISABLE_BRIDGE_WORKER === '1') {
      log.info('Bridge worker disabled via AG_DISABLE_BRIDGE_WORKER');
    }
    return;
  }

  bridgeWorkerProcess = launchBridgeWorkerProcess(port, process.env);
  bridgeWorkerProcess.on('exit', () => {
    bridgeWorkerProcess = null;
    if (!shuttingDown) {
      setTimeout(() => startBridgeWorker(), 2_000);
    }
  });
}

function registerProcessCleanup(cleanup: () => void): void {
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

function attachWebSocketIngress(wss: WebSocketServer): void {
  const WS_PING_INTERVAL_MS = 25_000;
  const wsAliveMap = new WeakMap<WebSocket, boolean>();

  const pingInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (wsAliveMap.get(ws) === false) {
        log.debug('WS keepalive: terminating dead connection');
        ws.terminate();
        continue;
      }
      wsAliveMap.set(ws, false);
      ws.ping();
    }
  }, WS_PING_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  wss.on('connection', (ws: WebSocket) => {
    wsAliveMap.set(ws, true);
    ws.on('pong', () => {
      wsAliveMap.set(ws, true);
    });

    const activeStreams = new Map<string, { abort: () => void; fullSteps: StreamStep[] }>();

    function startStreamForId(cascadeId: string, conn: { port: number; csrf: string }) {
      const { grpc: grpcModule, gateway: gatewayModule } = getBridgeModules();
      const existing = activeStreams.get(cascadeId);
      if (existing) {
        existing.abort();
        activeStreams.delete(cascadeId);
      }

      let fullSteps: StreamStep[] = [];

      const abort = grpcModule.streamAgentState(
        conn.port,
        conn.csrf,
        cascadeId,
        (update: { mainTrajectoryUpdate?: { stepsUpdate?: { steps?: StreamStep[]; indices?: number[]; totalLength?: number } }; status?: string }) => {
          const stepsUpdate = update?.mainTrajectoryUpdate?.stepsUpdate;
          const status = update?.status || '';
          const isActive = status !== 'CASCADE_RUN_STATUS_IDLE';
          const cascadeStatus = status.replace('CASCADE_RUN_STATUS_', '').toLowerCase();

          if (stepsUpdate?.steps?.length) {
            fullSteps = mergeStepsUpdate(fullSteps, stepsUpdate);
            const lastTaskBoundary = extractLastTaskBoundary(fullSteps);
            const cleanSteps = fullSteps.filter((step) => step != null);
            ws.send(JSON.stringify({
              type: 'steps',
              cascadeId,
              data: { steps: cleanSteps },
              isActive,
              cascadeStatus,
              totalLength: stepsUpdate.totalLength || cleanSteps.length,
              lastTaskBoundary,
            }));
          } else {
            const lastTaskBoundary = extractLastTaskBoundary(fullSteps);
            ws.send(JSON.stringify({
              type: 'status',
              cascadeId,
              isActive,
              cascadeStatus,
              stepCount: fullSteps.filter((step) => step != null).length,
              lastTaskBoundary,
            }));
          }
        },
        async () => {
          setTimeout(async () => {
            if (ws.readyState === ws.OPEN) {
              await ensureBridge();
              await gatewayModule.refreshOwnerMap();
              const newOwner = await gatewayModule.getOwnerConnection(cascadeId);
              if (newOwner) {
                startStreamForId(cascadeId, newOwner);
              }
            }
          }, 2_000);
        },
      );

      activeStreams.set(cascadeId, { abort, fullSteps });
    }

    ws.on('message', async (raw: Buffer) => {
      try {
        await ensureBridge();
        const { gateway: gatewayModule } = getBridgeModules();
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          cascadeId?: string;
          cascadeIds?: string[];
        };

        if (msg.type === 'subscribe' && msg.cascadeId) {
          const cascadeId = msg.cascadeId;
          for (const [, stream] of activeStreams) {
            stream.abort();
          }
          activeStreams.clear();

          if (!gatewayModule.convOwnerMap.has(cascadeId) || Date.now() - gatewayModule.ownerMapAge > 30_000) {
            await gatewayModule.refreshOwnerMap();
          }

          const owner = await gatewayModule.getOwnerConnection(cascadeId);
          if (!owner) {
            ws.send(JSON.stringify({ type: 'error', message: 'No server found for this conversation' }));
            return;
          }
          startStreamForId(cascadeId, owner);
        }

        if (msg.type === 'multi-subscribe' && Array.isArray(msg.cascadeIds)) {
          if (Date.now() - gatewayModule.ownerMapAge > 30_000) {
            await gatewayModule.refreshOwnerMap();
          }
          for (const cascadeId of msg.cascadeIds) {
            if (activeStreams.has(cascadeId)) continue;
            const owner = await gatewayModule.getOwnerConnection(cascadeId);
            if (owner) {
              startStreamForId(cascadeId, owner);
            }
          }
        }

        if (msg.type === 'unsubscribe') {
          if (msg.cascadeId) {
            const stream = activeStreams.get(msg.cascadeId);
            if (stream) {
              stream.abort();
              activeStreams.delete(msg.cascadeId);
            }
          } else {
            for (const [, stream] of activeStreams) {
              stream.abort();
            }
            activeStreams.clear();
          }
        }
      } catch {
        // ignore malformed WS frames
      }
    });

    ws.on('close', () => {
      for (const [, stream] of activeStreams) {
        stream.abort();
      }
      activeStreams.clear();
    });
  });
}

async function startWebServer(options: { enableBackgroundServices: boolean }): Promise<void> {
  initializeGatewayHome({ syncAssets: options.enableBackgroundServices });

  const app = next({ dev, hostname, port, turbopack: false });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = parse(req.url || '', true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });
  attachWebSocketIngress(wss);

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url || '', true);
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  server.listen(port, hostname, async () => {
    log.info({ hostname, port, role }, 'Gateway web ingress running');
    if (options.enableBackgroundServices && shouldLaunchBridgeWorker(process.env)) {
      startBridgeWorker();
    }
    if (options.enableBackgroundServices && shouldStartSchedulerServices(process.env)) {
      const { startSchedulerWorker } = await import('./src/server/workers/scheduler-worker');
      await startSchedulerWorker();
    }
  });

  registerProcessCleanup(() => {
    shuttingDown = true;
    bridgeWorkerProcess?.kill('SIGTERM');
    void import('./src/server/workers/scheduler-worker')
      .then(({ stopSchedulerWorker }) => stopSchedulerWorker())
      .finally(() => process.exit(0));
  });
}

async function startStandaloneRole(): Promise<void> {
  initializeGatewayHome({ syncAssets: role === 'runtime' });

  if (role === 'control-plane') {
    const { startControlPlaneServer } = await import('./src/server/control-plane/server');
    startControlPlaneServer({ port, hostname });
    registerProcessCleanup(() => process.exit(0));
    return;
  }

  if (role === 'runtime') {
    const { startRuntimeServer } = await import('./src/server/runtime/server');
    startRuntimeServer({ port, hostname });
    startBridgeWorker();
    registerProcessCleanup(() => {
      shuttingDown = true;
      bridgeWorkerProcess?.kill('SIGTERM');
      process.exit(0);
    });
    return;
  }

  if (role === 'scheduler') {
    if (shouldStartSchedulerServices(process.env)) {
      const { startSchedulerWorker } = await import('./src/server/workers/scheduler-worker');
      await startSchedulerWorker();
    } else {
      log.info('Scheduler role started with AG_ENABLE_SCHEDULER=0; staying idle');
    }
    registerProcessCleanup(() => {
      void import('./src/server/workers/scheduler-worker')
        .then(({ stopSchedulerWorker }) => stopSchedulerWorker())
        .finally(() => process.exit(0));
    });
  }
}

async function main(): Promise<void> {
  if (role === 'all') {
    await startWebServer({ enableBackgroundServices: true });
    return;
  }

  if (role === 'web') {
    await startWebServer({ enableBackgroundServices: false });
    return;
  }

  await startStandaloneRole();
}

void main().catch((error: unknown) => {
  log.error({ err: error instanceof Error ? error.message : String(error), role }, 'Server startup failed');
  process.exit(1);
});
