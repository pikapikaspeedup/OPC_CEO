import { spawn, type ChildProcess } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

import { createLogger } from '@/lib/logger';

const log = createLogger('BridgeWorkerProcess');
const require = createRequire(import.meta.url);

export function launchBridgeWorkerProcess(port: number, env: NodeJS.ProcessEnv = process.env): ChildProcess {
  const tsxPackagePath = require.resolve('tsx/package.json');
  const tsxCliPath = path.join(path.dirname(tsxPackagePath), 'dist', 'cli.mjs');
  const workerEntry = fileURLToPath(new URL('../../lib/bridge/worker-entry.ts', import.meta.url));

  const child = spawn(process.execPath, [tsxCliPath, workerEntry], {
    env: {
      ...env,
      PORT: String(port),
    },
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    log.warn({ code, signal }, 'Bridge worker exited');
  });

  return child;
}
