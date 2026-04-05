import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockGetDraft = vi.fn();
const mockConfirmDraft = vi.fn();
vi.mock('@/lib/agents/pipeline-generator', () => ({
  getDraft: (...args: any[]) => mockGetDraft(...args),
  confirmDraft: (...args: any[]) => mockConfirmDraft(...args),
}));

vi.mock('@/lib/agents/ops-audit', () => ({
  appendAuditEvent: vi.fn(),
}));

vi.mock('@/lib/agents/gateway-home', () => ({
  GLOBAL_ASSETS_DIR: '/tmp/test-assets',
}));

const mockReloadTemplates = vi.fn();
vi.mock('@/lib/agents/asset-loader', () => ({
  AssetLoader: {
    reloadTemplates: (...args: any[]) => mockReloadTemplates(...args),
  },
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
  },
}));

import { POST } from '@/app/api/pipelines/generate/[draftId]/confirm/route';

function params(draftId: string) {
  return { params: Promise.resolve({ draftId }) };
}

function makeRequest(body?: any): Request {
  return new Request('http://localhost/api/pipelines/generate/draft1/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

const mockDraft = {
  graphPipeline: {
    nodes: [
      { id: 'dev', kind: 'stage', groupId: 'dev', label: 'Development' },
      { id: 'review', kind: 'gate', groupId: 'review', label: 'Code Review' },
      { id: 'deploy', kind: 'stage', groupId: 'dev', label: 'Deploy' },
    ],
    edges: [
      { from: 'dev', to: 'review' },
      { from: 'review', to: 'deploy' },
    ],
  },
  templateMeta: {
    title: 'Dev Pipeline',
    description: 'A simple pipeline',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/pipelines/generate/[draftId]/confirm', () => {
  it('returns 404 when draft not found', async () => {
    mockGetDraft.mockReturnValue(undefined);
    const res = await POST(makeRequest(), params('no-exist'));
    expect(res.status).toBe(404);
  });

  it('returns 422 when validation fails', async () => {
    mockGetDraft.mockReturnValue(mockDraft);
    mockConfirmDraft.mockResolvedValue({
      saved: false,
      validationErrors: ['nodes must not be empty'],
    });
    const res = await POST(makeRequest(), params('draft1'));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.validationErrors).toContain('nodes must not be empty');
  });

  it('saves template and deduplicates groups', async () => {
    const fs = (await import('fs')).default;
    mockGetDraft.mockReturnValue(mockDraft);
    mockConfirmDraft.mockResolvedValue({
      saved: true,
      templateId: 'ai-dev-pipeline',
    });

    const res = await POST(makeRequest(), params('draft1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.saved).toBe(true);
    expect(json.templateId).toBe('ai-dev-pipeline');

    // Verify the saved template has deduplicated groups
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const saved = JSON.parse(writeCall[1] as string);
    // 'dev' groupId appears twice in nodes, but should be deduplicated
    expect(Object.keys(saved.groups)).toHaveLength(2); // 'dev' and 'review'
    expect(saved.groups.dev).toBeDefined();
    expect(saved.groups.review).toBeDefined();
    // Each group should have a default worker role
    expect(saved.groups.dev.roles).toHaveLength(1);
    expect(saved.groups.dev.roles[0].id).toBe('worker');
    expect(saved.groups.review.roles).toHaveLength(1);
  });

  it('builds correct template shape', async () => {
    const fs = (await import('fs')).default;
    mockGetDraft.mockReturnValue(mockDraft);
    mockConfirmDraft.mockResolvedValue({ saved: true, templateId: 'test-out' });

    await POST(makeRequest(), params('draft1'));

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const saved = JSON.parse(writeCall[1] as string);
    expect(saved.kind).toBe('template');
    expect(saved.title).toBe('Dev Pipeline');
    expect(saved.graphPipeline).toBeDefined();
    expect(saved.graphPipeline.nodes).toHaveLength(3);
    expect(saved.graphPipeline.edges).toHaveLength(2);
  });

  it('reloads template cache after save', async () => {
    mockGetDraft.mockReturnValue(mockDraft);
    mockConfirmDraft.mockResolvedValue({ saved: true, templateId: 'x' });

    await POST(makeRequest(), params('draft1'));
    expect(mockReloadTemplates).toHaveBeenCalled();
  });
});
