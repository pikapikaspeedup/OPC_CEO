import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempRoot = path.join('/tmp', `ag-platform-engineering-${process.pid}-${Date.now()}`);
const tempGatewayHome = path.join(tempRoot, 'gateway-home');

let previousGatewayHome: string | undefined;

async function loadModule() {
  return import('./platform-engineering');
}

describe('platform engineering bootstrap', () => {
  beforeEach(() => {
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.AG_GATEWAY_HOME = tempGatewayHome;
    delete (globalThis as { __AG_GATEWAY_DB__?: unknown }).__AG_GATEWAY_DB__;
    vi.resetModules();
    fs.rmSync(tempRoot, { recursive: true, force: true });
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

  it('creates the built-in platform engineering workspace skeleton', async () => {
    const mod = await loadModule();
    const result = mod.ensurePlatformEngineeringWorkspaceSkeleton();

    expect(result.workspacePath).toContain(path.join('system-workspaces', 'platform-engineering'));
    expect(fs.existsSync(path.join(result.workspacePath, '.department', 'config.json'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspacePath, '.department', 'rules', 'guarded-core-dev.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspacePath, '.department', 'memory', 'shared', 'platform-engineering-decisions.md'))).toBe(true);
    expect(fs.existsSync(path.join(result.workspacePath, '.department', 'memory', 'codex', 'platform-engineering.md'))).toBe(true);

    const config = JSON.parse(
      fs.readFileSync(path.join(result.workspacePath, '.department', 'config.json'), 'utf-8'),
    ) as { departmentId?: string; name?: string; executionPolicy?: { contextDocumentPaths?: string[] } };

    expect(config.departmentId).toBe('department:platform-engineering');
    expect(config.name).toBe('平台工程部');
    expect(config.executionPolicy?.contextDocumentPaths?.length).toBeGreaterThan(0);
  });
});
