import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/workspace-catalog', () => ({
  getKnownWorkspace: vi.fn(),
  listKnownWorkspaces: vi.fn(() => []),
}));

vi.mock('@/server/shared/proxy', () => ({
  runControlPlaneRoute: vi.fn(async (_req: Request, handler: () => Promise<Response> | Response) => handler()),
}));

vi.mock('@/lib/storage/gateway-db', () => ({
  listRunRecordsByFilter: vi.fn(() => []),
  listProjectRecords: vi.fn(() => []),
  listDeliverableRecordsByProject: vi.fn(() => []),
}));

vi.mock('@/lib/knowledge', () => ({
  listKnowledgeAssets: vi.fn(() => []),
}));

import { listKnowledgeAssets } from '@/lib/knowledge';
import {
  listDeliverableRecordsByProject,
  listProjectRecords,
  listRunRecordsByFilter,
} from '@/lib/storage/gateway-db';
import { getKnownWorkspace } from '@/lib/workspace-catalog';
import { GET } from './route';

const tempRoot = path.join('/tmp', `ag-department-content-${process.pid}-${Date.now()}`);
const workspacePath = path.join(tempRoot, 'ai-intel');
const workspaceUri = `file://${workspacePath}`;

describe('/api/departments/content', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(workspacePath, '.department', 'outputs', 'linuxdo-ai-watch', 'briefs'), { recursive: true });
    fs.writeFileSync(
      path.join(workspacePath, '.department', 'outputs', 'linuxdo-ai-watch', 'briefs', '2026-05-21-1000.md'),
      '# Linux Do AI 情报简报\n\n- 本轮发现 1 条需要复核的线索。\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(workspacePath, '.department', 'config.json'),
      JSON.stringify({
        name: 'AI 情报部门',
        type: 'research',
        skills: [],
        okr: null,
        executionPolicy: { contextDocumentPaths: [] },
      }),
      'utf-8',
    );
    vi.mocked(getKnownWorkspace).mockReturnValue({
      uri: workspaceUri,
      path: workspacePath,
      name: 'ai-intel',
      kind: 'folder',
      sourceKind: 'manual-import',
      status: 'active',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('returns file tree, selected markdown and output tree from local outputs', async () => {
    const res = await GET(new Request(`http://localhost/api/departments/content?workspace=${encodeURIComponent(workspaceUri)}&path=${encodeURIComponent('.department/outputs/linuxdo-ai-watch/briefs/2026-05-21-1000.md')}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceUri).toBe(workspaceUri);
    expect(body.selectedFile).toEqual(expect.objectContaining({
      path: '.department/outputs/linuxdo-ai-watch/briefs/2026-05-21-1000.md',
      content: expect.stringContaining('Linux Do AI 情报简报'),
    }));
    expect(body.fileTree.length).toBeGreaterThan(0);
    expect(body.outputTree[0]).toEqual(expect.objectContaining({
      id: 'linuxdo-ai-watch',
      type: 'group',
    }));
  });

  it('merges run artifacts, deliverables and knowledge assets into output tree', async () => {
    vi.mocked(listRunRecordsByFilter).mockReturnValue([
      {
        runId: 'run-1',
        stageId: 'stage-1',
        workspace: workspaceUri,
        status: 'completed',
        createdAt: '2026-05-21T08:00:00.000Z',
        finishedAt: '2026-05-21T08:02:00.000Z',
        prompt: 'collect',
        resultEnvelope: {
          runId: 'run-1',
          status: 'completed',
          summary: '发现新简报',
          outputArtifacts: [{
            id: 'artifact-1',
            kind: 'brief',
            title: '08:00 简报',
            path: '.department/outputs/linuxdo-ai-watch/briefs/2026-05-21-0800.md',
            format: 'md',
            metadata: { taskKey: 'linuxdo-ai-watch', audience: 'ceo' },
          }],
        },
      },
    ] as never);
    vi.mocked(listProjectRecords).mockReturnValue([
      {
        projectId: 'project-1',
        name: 'Linux Do AI 情报监控',
        goal: '',
        status: 'active',
        workspace: workspaceUri,
        createdAt: '2026-05-21T00:00:00.000Z',
        updatedAt: '2026-05-21T00:00:00.000Z',
      },
    ] as never);
    vi.mocked(listDeliverableRecordsByProject).mockReturnValue([
      {
        id: 'deliverable-1',
        projectId: 'project-1',
        stageId: 'stage-1',
        sourceRunId: 'run-1',
        type: 'document',
        title: '项目简报',
        artifactPath: '.department/outputs/linuxdo-ai-watch/briefs/project.md',
        createdAt: '2026-05-21T09:00:00.000Z',
        quality: {},
      },
    ] as never);
    vi.mocked(listKnowledgeAssets).mockReturnValue([
      {
        id: 'knowledge-1',
        scope: 'department',
        workspaceUri,
        category: 'domain-knowledge',
        title: '风险模式',
        content: '可复用风险模式',
        source: { type: 'manual', artifactPath: '.department/outputs/linuxdo-ai-watch/briefs/risk.md' },
        tags: ['department-output', 'task:linuxdo-ai-watch', 'audience:ceo'],
        status: 'active',
        createdAt: '2026-05-21T09:30:00.000Z',
        updatedAt: '2026-05-21T09:30:00.000Z',
      },
    ] as never);

    const res = await GET(new Request(`http://localhost/api/departments/content?workspace=${encodeURIComponent(workspaceUri)}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    const serialized = JSON.stringify(body.outputTree);
    expect(serialized).toContain('08:00 简报');
    expect(serialized).toContain('项目简报');
    expect(serialized).toContain('风险模式');
  });
});
