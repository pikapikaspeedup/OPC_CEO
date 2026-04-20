import { createLogger } from '../logger';
import { initializeGatewayHome } from '../agents/gateway-home';
import { startConversationProjectionWorker, stopConversationProjectionWorker } from './conversation-importer';
import { pathToFileURL } from 'url';

const log = createLogger('BridgeWorker');

async function maybeStartTunnel(port: number): Promise<void> {
  try {
    const tunnel = await import('./tunnel');
    const config = tunnel.loadTunnelConfig();
    if (config?.autoStart && config.tunnelName) {
      log.info({ tunnelName: config.tunnelName }, 'Auto-starting tunnel from worker');
      const result = await tunnel.startTunnel(port);
      if (result.success) {
        log.info({ url: result.url }, 'Tunnel active');
      } else {
        log.warn({ error: result.error }, 'Tunnel failed');
      }
    }
  } catch (error: unknown) {
    log.warn({ err: error instanceof Error ? error.message : String(error) }, 'Tunnel startup skipped');
  }
}

export async function startBridgeWorker(port: number): Promise<void> {
  initializeGatewayHome({ syncAssets: true });
  startConversationProjectionWorker();
  await maybeStartTunnel(port);
}

export function stopBridgeWorker(): void {
  stopConversationProjectionWorker();
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT || '3000');
  await startBridgeWorker(port);
  log.info({ port }, 'Bridge worker started');
}

const isEntrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false;

if (isEntrypoint) {
  void main();

  const shutdown = () => {
    stopBridgeWorker();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
