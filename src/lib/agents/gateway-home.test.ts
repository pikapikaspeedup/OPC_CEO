import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('gateway-home asset sync', () => {
  let tempGatewayHome: string;
  let previousGatewayHome: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    tempGatewayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-gateway-home-'));
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.AG_GATEWAY_HOME = tempGatewayHome;
  });

  afterEach(() => {
    fs.rmSync(tempGatewayHome, { recursive: true, force: true });
    if (previousGatewayHome === undefined) {
      delete process.env.AG_GATEWAY_HOME;
    } else {
      process.env.AG_GATEWAY_HOME = previousGatewayHome;
    }
  });

  it('syncs repo workflow scripts into canonical global assets', async () => {
    const gatewayHome = await import('./gateway-home');

    gatewayHome.syncAssetsToGlobal();

    expect(fs.existsSync(path.join(gatewayHome.GLOBAL_ASSETS_DIR, 'workflows', 'ai_digest.md'))).toBe(true);
    expect(
      fs.existsSync(path.join(gatewayHome.GLOBAL_WORKFLOW_SCRIPTS_DIR, 'ai_digest', 'fetch_context.py')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(gatewayHome.GLOBAL_WORKFLOW_SCRIPTS_DIR, 'ai_digest', 'report_digest.py')),
    ).toBe(true);
  });

  it('falls back to a temp gateway home under Vitest when no explicit env is set', async () => {
    delete process.env.AG_GATEWAY_HOME;
    vi.resetModules();

    const gatewayHome = await import('./gateway-home');

    expect(gatewayHome.GATEWAY_HOME).toContain('antigravity-mobility-cli-vitest');
    expect(gatewayHome.GATEWAY_HOME).toContain('gateway');
  });
});
