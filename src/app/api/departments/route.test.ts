import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/workspace-catalog', () => ({
  getKnownWorkspace: vi.fn(),
}));

import { getKnownWorkspace } from '@/lib/workspace-catalog';
import { GET, PUT } from './route';

const tempRoot = path.join('/tmp', `ag-departments-route-${process.pid}-${Date.now()}`);
const tempWorkspace = path.join(tempRoot, 'workspace');
const tempWorkspaceTwo = path.join(tempRoot, 'shared-docs');

describe('/api/departments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempWorkspace, { recursive: true });
    fs.mkdirSync(tempWorkspaceTwo, { recursive: true });
    vi.mocked(getKnownWorkspace).mockImplementation((workspaceUri: string) => {
      if (workspaceUri === `file://${tempWorkspace}`) {
        return {
          uri: `file://${tempWorkspace}`,
          path: tempWorkspace,
          name: 'workspace',
          kind: 'folder',
          sourceKind: 'manual-import',
          status: 'active',
          createdAt: '2026-04-20T10:00:00.000Z',
          updatedAt: '2026-04-20T10:00:00.000Z',
        };
      }
      if (workspaceUri === `file://${tempWorkspaceTwo}`) {
        return {
          uri: `file://${tempWorkspaceTwo}`,
          path: tempWorkspaceTwo,
          name: 'shared-docs',
          kind: 'folder',
          sourceKind: 'manual-import',
          status: 'active',
          createdAt: '2026-04-20T10:00:00.000Z',
          updatedAt: '2026-04-20T10:00:00.000Z',
        };
      }
      return null;
    });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('returns default department config for a known workspace without config file', async () => {
    const res = await GET(new Request(`http://localhost/api/departments?workspace=${encodeURIComponent(`file://${tempWorkspace}`)}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      departmentId: `department:file://${tempWorkspace}`,
      name: 'workspace',
      type: 'build',
      skills: [],
      okr: null,
      workspaceBindings: [
        {
          workspaceUri: `file://${tempWorkspace}`,
          alias: 'workspace',
          role: 'primary',
          writeAccess: true,
        },
      ],
      executionPolicy: {
        defaultWorkspaceUri: `file://${tempWorkspace}`,
        contextDocumentPaths: [],
      },
    });
  });

  it('writes config without implicitly syncing IDE mirrors', async () => {
    const res = await PUT(new Request(`http://localhost/api/departments?workspace=${encodeURIComponent(`file://${tempWorkspace}`)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Research',
        type: 'research',
        skills: [],
        okr: null,
      }),
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, syncPending: true });
    expect(JSON.parse(fs.readFileSync(path.join(tempWorkspace, '.department', 'config.json'), 'utf-8'))).toEqual({
      departmentId: `department:file://${tempWorkspace}`,
      name: 'Research',
      type: 'research',
      skills: [],
      okr: null,
      workspaceBindings: [
        {
          workspaceUri: `file://${tempWorkspace}`,
          alias: 'workspace',
          role: 'primary',
          writeAccess: true,
        },
      ],
      executionPolicy: {
        defaultWorkspaceUri: `file://${tempWorkspace}`,
        contextDocumentPaths: [],
      },
    });
  });

  it('writes the normalized config into every bound workspace', async () => {
    const res = await PUT(new Request(`http://localhost/api/departments?workspace=${encodeURIComponent(`file://${tempWorkspace}`)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'AI 情报工作室',
        type: 'research',
        skills: [],
        okr: null,
        workspaceBindings: [
          { workspaceUri: `file://${tempWorkspace}`, role: 'primary', writeAccess: true },
          { workspaceUri: `file://${tempWorkspaceTwo}`, role: 'context', writeAccess: false },
        ],
        executionPolicy: {
          defaultWorkspaceUri: `file://${tempWorkspace}`,
          contextDocumentPaths: ['docs/context.md'],
        },
      }),
    }));

    expect(res.status).toBe(200);
    const expectedConfig = {
      departmentId: `department:file://${tempWorkspace}`,
      name: 'AI 情报工作室',
      type: 'research',
      skills: [],
      okr: null,
      workspaceBindings: [
        {
          workspaceUri: `file://${tempWorkspace}`,
          role: 'primary',
          writeAccess: true,
        },
        {
          workspaceUri: `file://${tempWorkspaceTwo}`,
          role: 'context',
          writeAccess: false,
        },
      ],
      executionPolicy: {
        defaultWorkspaceUri: `file://${tempWorkspace}`,
        contextDocumentPaths: ['docs/context.md'],
      },
    };

    expect(JSON.parse(fs.readFileSync(path.join(tempWorkspace, '.department', 'config.json'), 'utf-8'))).toEqual(expectedConfig);
    expect(JSON.parse(fs.readFileSync(path.join(tempWorkspaceTwo, '.department', 'config.json'), 'utf-8'))).toEqual(expectedConfig);
  });
});
