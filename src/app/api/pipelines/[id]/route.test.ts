import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TemplateDefinition } from '@/lib/agents/pipeline-types';

// ---- Mocks (must be before imports) ----

const mockGetTemplate = vi.fn();
const mockReloadTemplates = vi.fn();
vi.mock('@/lib/agents/asset-loader', () => ({
  AssetLoader: {
    getTemplate: (...args: any[]) => mockGetTemplate(...args),
    reloadTemplates: (...args: any[]) => mockReloadTemplates(...args),
    resolveWorkflowContent: vi.fn((w: string) => `content-of-${w}`),
  },
}));

vi.mock('@/lib/agents/ops-audit', () => ({
  appendAuditEvent: vi.fn(),
}));

vi.mock('@/lib/agents/gateway-home', () => ({
  GLOBAL_ASSETS_DIR: '/tmp/test-assets',
}));

vi.mock('@/lib/agents/graph-compiler', () => ({
  validateGraphPipeline: vi.fn(() => []),
}));

vi.mock('@/lib/agents/pipeline-graph', () => ({
  validateTemplatePipeline: vi.fn(() => []),
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    unlinkSync: vi.fn(),
  },
}));

import { GET, PUT, DELETE, POST } from '@/app/api/pipelines/[id]/route';

// ---- Helpers ----

const baseGroup = {
  title: 'Dev',
  description: 'dev group',
  executionMode: 'review-loop' as const,
  roles: [{ id: 'worker', workflow: '/dev-worker', timeoutMs: 600000, autoApprove: false }],
};

function makeTemplate(overrides?: Partial<TemplateDefinition>): TemplateDefinition {
  return {
    id: 'test-tmpl',
    kind: 'template',
    title: 'Test Template',
    description: 'A test template',
    groups: { dev: baseGroup },
    pipeline: [{ groupId: 'dev' }],
    ...overrides,
  };
}

function makeRequest(body?: any): Request {
  return new Request('http://localhost/api/pipelines/test-tmpl', {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ---- Tests ----

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/pipelines/[id]', () => {
  it('returns 404 when template not found', async () => {
    mockGetTemplate.mockReturnValue(undefined);
    const res = await GET(new Request('http://localhost'), params('no-exist'));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain('not found');
  });

  it('returns template with resolved workflow content', async () => {
    mockGetTemplate.mockReturnValue(makeTemplate());
    const res = await GET(new Request('http://localhost'), params('test-tmpl'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('test-tmpl');
    expect(json.groups.dev.roles[0].workflowContent).toBe('content-of-/dev-worker');
  });
});

describe('PUT /api/pipelines/[id]', () => {
  it('returns 404 when template not found', async () => {
    mockGetTemplate.mockReturnValue(undefined);
    const res = await PUT(makeRequest({ title: 'New' }), params('no-exist'));
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid body', async () => {
    mockGetTemplate.mockReturnValue(makeTemplate());
    const req = new Request('http://localhost', {
      method: 'PUT',
      body: 'not json!',
    });
    const res = await PUT(req, params('test-tmpl'));
    expect(res.status).toBe(400);
  });

  it('preserves id and kind on update', async () => {
    const fs = (await import('fs')).default;
    mockGetTemplate.mockReturnValue(makeTemplate());
    const res = await PUT(
      makeRequest({ title: 'Updated', id: 'hacked-id', kind: 'hacked' }),
      params('test-tmpl'),
    );
    expect(res.status).toBe(200);
    // Verify writeFileSync was called with correct id
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const savedTemplate = JSON.parse(writeCall[1] as string);
    expect(savedTemplate.id).toBe('test-tmpl');
    expect(savedTemplate.kind).toBe('template');
    expect(savedTemplate.title).toBe('Updated');
  });

  it('returns 422 when validation fails', async () => {
    const { validateGraphPipeline } = await import('@/lib/agents/graph-compiler');
    vi.mocked(validateGraphPipeline).mockReturnValue(['edge to unknown node']);
    mockGetTemplate.mockReturnValue(makeTemplate({
      graphPipeline: {
        nodes: [{ id: 'a', kind: 'stage', groupId: 'dev' }],
        edges: [{ from: 'a', to: 'missing' }],
      },
    }));
    const res = await PUT(
      makeRequest({ graphPipeline: { nodes: [], edges: [{ from: 'a', to: 'missing' }] } }),
      params('test-tmpl'),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.errors).toContain('edge to unknown node');
  });
});

describe('DELETE /api/pipelines/[id]', () => {
  it('returns 404 when template not found', async () => {
    mockGetTemplate.mockReturnValue(undefined);
    const res = await DELETE(new Request('http://localhost'), params('no'));
    expect(res.status).toBe(404);
  });

  it('deletes template and reloads cache', async () => {
    const fs = (await import('fs')).default;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    mockGetTemplate.mockReturnValue(makeTemplate());
    const res = await DELETE(new Request('http://localhost'), params('test-tmpl'));
    expect(res.status).toBe(200);
    expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalled();
    expect(mockReloadTemplates).toHaveBeenCalled();
  });
});

describe('POST /api/pipelines/[id] (clone)', () => {
  it('returns 404 when source not found', async () => {
    mockGetTemplate.mockReturnValue(undefined);
    const res = await POST(makeRequest({ newId: 'cloned' }), params('no'));
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing newId', async () => {
    mockGetTemplate.mockReturnValue(makeTemplate());
    const res = await POST(makeRequest({}), params('test-tmpl'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid newId format', async () => {
    mockGetTemplate.mockReturnValue(makeTemplate());
    const res = await POST(makeRequest({ newId: '../traversal' }), params('test-tmpl'));
    expect(res.status).toBe(400);
  });

  it('returns 409 when newId already exists', async () => {
    mockGetTemplate.mockImplementation((id: string) => {
      if (id === 'test-tmpl') return makeTemplate();
      if (id === 'existing') return makeTemplate({ id: 'existing' });
      return undefined;
    });
    const res = await POST(makeRequest({ newId: 'existing' }), params('test-tmpl'));
    expect(res.status).toBe(409);
  });

  it('clones template with new id and title', async () => {
    const fs = (await import('fs')).default;
    mockGetTemplate.mockImplementation((id: string) => {
      if (id === 'test-tmpl') return makeTemplate();
      return undefined;
    });
    const res = await POST(
      makeRequest({ newId: 'my-clone', newTitle: 'Cloned Template' }),
      params('test-tmpl'),
    );
    expect(res.status).toBe(201);
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const saved = JSON.parse(writeCall[1] as string);
    expect(saved.id).toBe('my-clone');
    expect(saved.title).toBe('Cloned Template');
  });
});
