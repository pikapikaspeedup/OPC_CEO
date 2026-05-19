import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/workspace-catalog', () => ({
  getKnownWorkspace: vi.fn(),
  listKnownWorkspaces: vi.fn(),
}));

import { getKnownWorkspace } from '@/lib/workspace-catalog';
import { createControlPlaneRoutes } from '@/server/control-plane/server';
import { DELETE, GET, PUT } from './route';

const tempRoot = path.join('/tmp', `ag-department-rules-route-${process.pid}-${Date.now()}`);
const tempWorkspace = path.join(tempRoot, 'workspace');
const workspaceUri = `file://${tempWorkspace}`;

function writeRule(relativeDir: '.department/rules' | '.agents/rules', name: string, content: string) {
  const dir = path.join(tempWorkspace, relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), content);
}

async function callControlPlaneRoute(pathWithQuery: string, init?: RequestInit): Promise<Response> {
  const url = new URL(pathWithQuery, 'http://localhost');
  const routes = createControlPlaneRoutes({ includeHealth: false });
  const route = routes.find((candidate) => candidate.pattern.test(url.pathname));
  expect(route).toBeDefined();
  const match = url.pathname.match(route!.pattern);
  expect(match).toBeTruthy();
  return route!.handler(new Request(url, init), match!);
}

describe('/api/departments/rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempWorkspace, { recursive: true });
    vi.mocked(getKnownWorkspace).mockImplementation((uri: string) => {
      if (uri !== workspaceUri) return null;
      return {
        uri: workspaceUri,
        path: tempWorkspace,
        name: 'workspace',
        kind: 'folder',
        sourceKind: 'manual-import',
        status: 'active',
        createdAt: '2026-05-13T10:00:00.000Z',
        updatedAt: '2026-05-13T10:00:00.000Z',
      };
    });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('lists effective rules with department rules overriding legacy agents rules', async () => {
    writeRule('.agents/rules', 'agent', '# Legacy Agent');
    writeRule('.agents/rules', 'rules', '# Legacy Rules');
    writeRule('.department/rules', 'agent', '# Department Agent');
    writeRule('.department/rules', 'department-identity', '# Reserved');

    const res = await GET(new Request(`http://localhost/api/departments/rules?workspace=${encodeURIComponent(workspaceUri)}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspace).toBe(workspaceUri);
    expect(body.rules).toEqual([
      expect.objectContaining({
        name: 'agent',
        content: '# Department Agent',
        source: 'department',
        editable: true,
      }),
      expect.objectContaining({
        name: 'rules',
        content: '# Legacy Rules',
        source: 'legacy-agents',
        editable: false,
      }),
    ]);
  });

  it('creates and updates department rules only under .department/rules', async () => {
    const createRes = await PUT(new Request(`http://localhost/api/departments/rules?workspace=${encodeURIComponent(workspaceUri)}&name=engineering_rule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Engineering Rule' }),
    }));

    expect(createRes.status).toBe(200);
    expect(fs.readFileSync(path.join(tempWorkspace, '.department', 'rules', 'engineering_rule.md'), 'utf-8')).toBe('# Engineering Rule');
    expect(fs.existsSync(path.join(tempWorkspace, '.agents', 'rules', 'engineering_rule.md'))).toBe(false);

    const updateRes = await PUT(new Request(`http://localhost/api/departments/rules?workspace=${encodeURIComponent(workspaceUri)}&name=engineering_rule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Updated Rule' }),
    }));

    expect(updateRes.status).toBe(200);
    expect(fs.readFileSync(path.join(tempWorkspace, '.department', 'rules', 'engineering_rule.md'), 'utf-8')).toBe('# Updated Rule');
  });

  it('registers department rules in the split control-plane route table', async () => {
    writeRule('.agents/rules', 'agent', '# Legacy Agent');

    const res = await callControlPlaneRoute(
      `/api/departments/rules?workspace=${encodeURIComponent(workspaceUri)}`,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      workspace: workspaceUri,
      rules: [
        expect.objectContaining({
          name: 'agent',
          content: '# Legacy Agent',
          source: 'legacy-agents',
          editable: false,
        }),
      ],
    }));
  });

  it('deletes department overrides without deleting legacy agents rules', async () => {
    writeRule('.agents/rules', 'agent', '# Legacy Agent');
    writeRule('.department/rules', 'agent', '# Department Agent');

    const deleteRes = await DELETE(new Request(`http://localhost/api/departments/rules?workspace=${encodeURIComponent(workspaceUri)}&name=agent`, {
      method: 'DELETE',
    }));

    expect(deleteRes.status).toBe(200);
    expect(fs.existsSync(path.join(tempWorkspace, '.department', 'rules', 'agent.md'))).toBe(false);
    expect(fs.readFileSync(path.join(tempWorkspace, '.agents', 'rules', 'agent.md'), 'utf-8')).toBe('# Legacy Agent');

    const listRes = await GET(new Request(`http://localhost/api/departments/rules?workspace=${encodeURIComponent(workspaceUri)}`));
    expect((await listRes.json()).rules).toEqual([
      expect.objectContaining({
        name: 'agent',
        content: '# Legacy Agent',
        source: 'legacy-agents',
        editable: false,
      }),
    ]);
  });

  it('rejects deleting legacy-only rules, reserved names, invalid names, and unknown workspaces', async () => {
    writeRule('.agents/rules', 'legacy_only', '# Legacy Only');

    const legacyDeleteRes = await DELETE(new Request(`http://localhost/api/departments/rules?workspace=${encodeURIComponent(workspaceUri)}&name=legacy_only`, {
      method: 'DELETE',
    }));
    expect(legacyDeleteRes.status).toBe(409);
    expect(fs.existsSync(path.join(tempWorkspace, '.agents', 'rules', 'legacy_only.md'))).toBe(true);

    const reservedRes = await PUT(new Request(`http://localhost/api/departments/rules?workspace=${encodeURIComponent(workspaceUri)}&name=department-identity`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Reserved' }),
    }));
    expect(reservedRes.status).toBe(400);

    const invalidRes = await PUT(new Request(`http://localhost/api/departments/rules?workspace=${encodeURIComponent(workspaceUri)}&name=-bad`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# Bad' }),
    }));
    expect(invalidRes.status).toBe(400);

    const missingWorkspaceRes = await GET(new Request('http://localhost/api/departments/rules'));
    expect(missingWorkspaceRes.status).toBe(400);

    const unknownWorkspaceRes = await GET(new Request('http://localhost/api/departments/rules?workspace=file:///tmp/unknown'));
    expect(unknownWorkspaceRes.status).toBe(403);
  });
});
