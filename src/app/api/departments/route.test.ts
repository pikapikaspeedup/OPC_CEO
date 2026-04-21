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

describe('/api/departments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempWorkspace, { recursive: true });
    vi.mocked(getKnownWorkspace).mockReturnValue({
      uri: `file://${tempWorkspace}`,
      path: tempWorkspace,
      name: 'workspace',
      kind: 'folder',
      sourceKind: 'manual-import',
      status: 'active',
      createdAt: '2026-04-20T10:00:00.000Z',
      updatedAt: '2026-04-20T10:00:00.000Z',
    });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('returns default department config for a known workspace without config file', async () => {
    const res = await GET(new Request(`http://localhost/api/departments?workspace=${encodeURIComponent(`file://${tempWorkspace}`)}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      name: 'workspace',
      type: 'build',
      skills: [],
      okr: null,
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
      name: 'Research',
      type: 'research',
      skills: [],
      okr: null,
    });
  });
});
