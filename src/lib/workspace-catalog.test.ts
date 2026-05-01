import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempRoot = path.join('/tmp', `ag-workspace-catalog-${process.pid}-${Date.now()}`);
const tempGatewayHome = path.join(tempRoot, 'gateway-home');
const tempRecentWorkspace = path.join(tempRoot, 'recent-workspace');
const tempManualWorkspace = path.join(tempRoot, 'manual-workspace');
const tempCeoWorkspace = path.join(tempRoot, 'ceo-workspace');
const tempSystemWorkspace = path.join(tempGatewayHome, 'system-workspaces', 'platform-engineering');

let previousGatewayHome: string | undefined;

vi.mock('./bridge/statedb', () => ({
  getWorkspaces: vi.fn(() => [
    { type: 'folder', uri: `file://${tempRecentWorkspace}` },
  ]),
}));

vi.mock('./agents/ceo-environment', () => ({
  getCEOWorkspacePath: vi.fn(() => tempCeoWorkspace),
}));

async function loadModule() {
  return import('./workspace-catalog');
}

describe('workspace-catalog', () => {
  beforeEach(() => {
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.AG_GATEWAY_HOME = tempGatewayHome;
    delete (globalThis as { __AG_GATEWAY_DB__?: unknown }).__AG_GATEWAY_DB__;
    vi.resetModules();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRecentWorkspace, { recursive: true });
    fs.mkdirSync(tempManualWorkspace, { recursive: true });
    fs.mkdirSync(tempCeoWorkspace, { recursive: true });
  });

  afterEach(() => {
    delete (globalThis as { __AG_GATEWAY_DB__?: unknown }).__AG_GATEWAY_DB__;
    vi.resetModules();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (previousGatewayHome === undefined) {
      delete process.env.AG_GATEWAY_HOME;
    } else {
      process.env.AG_GATEWAY_HOME = previousGatewayHome;
    }
  });

  it('registers manual workspaces and resolves them by URI', async () => {
    const catalog = await loadModule();
    const normalized = catalog.normalizeWorkspaceIdentity(tempManualWorkspace);

    const registered = catalog.registerWorkspace({
      workspace: tempManualWorkspace,
      sourceKind: 'manual-import',
    });

    expect(registered).toEqual(expect.objectContaining({
      uri: normalized.uri,
      path: normalized.path,
      name: 'manual-workspace',
      sourceKind: 'manual-import',
    }));
    expect(catalog.getKnownWorkspace(normalized.uri)).toEqual(expect.objectContaining({
      path: normalized.path,
      name: 'manual-workspace',
    }));
  });

  it('lists known workspaces from recent Antigravity entries plus CEO bootstrap', async () => {
    const catalog = await loadModule();
    const recentWorkspace = catalog.normalizeWorkspaceIdentity(tempRecentWorkspace);
    const ceoWorkspace = catalog.normalizeWorkspaceIdentity(tempCeoWorkspace);

    const workspaces = catalog.listKnownWorkspaces();
    const workspaceUris = workspaces.map((workspace) => workspace.uri);

    expect(workspaceUris).toEqual(expect.arrayContaining([
      recentWorkspace.uri,
      ceoWorkspace.uri,
    ]));
    expect(workspaceUris.some((workspaceUri) => workspaceUri.endsWith('/gateway-home/system-workspaces/platform-engineering'))).toBe(true);
  });
});
