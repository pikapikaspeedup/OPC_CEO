import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSpawn = vi.fn();
const mockResolve = vi.fn();
const mockInitializeGatewayHome = vi.fn();
const mockWarn = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

vi.mock('module', () => ({
  createRequire: () => ({
    resolve: (...args: any[]) => mockResolve(...args),
  }),
}));

vi.mock('@/lib/agents/gateway-home', () => ({
  initializeGatewayHome: (...args: any[]) => mockInitializeGatewayHome(...args),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    warn: (...args: any[]) => mockWarn(...args),
  }),
}));

import { launchBridgeWorkerProcess } from './bridge-worker-process';

describe('launchBridgeWorkerProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockReturnValue('/tmp/node_modules/tsx/package.json');
    mockSpawn.mockReturnValue({
      on: vi.fn(),
    });
  });

  it('initializes gateway home before spawning the bridge worker', () => {
    launchBridgeWorkerProcess(4317, { AG_GATEWAY_HOME: '/tmp/gateway-home' });

    expect(mockInitializeGatewayHome).toHaveBeenCalledWith({ syncAssets: true });
    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['/tmp/node_modules/tsx/dist/cli.mjs']),
      expect.objectContaining({
        env: expect.objectContaining({
          AG_GATEWAY_HOME: '/tmp/gateway-home',
          AG_PROCESS_ROLE: 'bridge-worker',
          PORT: '4317',
        }),
        stdio: 'inherit',
      }),
    );
  });
});
