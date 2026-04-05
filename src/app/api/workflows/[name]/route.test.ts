import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/agents/gateway-home', () => ({
  GLOBAL_ASSETS_DIR: '/tmp/test-assets',
}));

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();
vi.mock('fs', () => ({
  default: {
    existsSync: (...args: any[]) => mockExistsSync(...args),
    readFileSync: (...args: any[]) => mockReadFileSync(...args),
    writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
    mkdirSync: (...args: any[]) => mockMkdirSync(...args),
  },
}));

import { PUT, GET } from '@/app/api/workflows/[name]/route';

function params(name: string) {
  return { params: Promise.resolve({ name }) };
}

function makeRequest(body: any): Request {
  return new Request('http://localhost/api/workflows/test', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PUT /api/workflows/[name]', () => {
  it('rejects path-traversal name', async () => {
    const res = await PUT(makeRequest({ content: '# Hello' }), params('../etc/passwd'));
    expect(res.status).toBe(400);
  });

  it('rejects name with dots', async () => {
    const res = await PUT(makeRequest({ content: '# Hello' }), params('some.workflow'));
    expect(res.status).toBe(400);
  });

  it('rejects name with slashes', async () => {
    const res = await PUT(makeRequest({ content: '# Hello' }), params('a/b'));
    expect(res.status).toBe(400);
  });

  it('rejects empty name', async () => {
    const res = await PUT(makeRequest({ content: '# Hello' }), params(''));
    expect(res.status).toBe(400);
  });

  it('rejects name longer than 120 chars', async () => {
    const res = await PUT(makeRequest({ content: '# Hello' }), params('a'.repeat(121)));
    expect(res.status).toBe(400);
  });

  it('rejects missing content', async () => {
    const res = await PUT(makeRequest({}), params('dev-worker'));
    expect(res.status).toBe(400);
  });

  it('saves valid workflow content', async () => {
    mockExistsSync.mockReturnValue(false);
    const res = await PUT(makeRequest({ content: '# Dev Worker\nDo the thing.' }), params('dev-worker'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('dev-worker.md'),
      '# Dev Worker\nDo the thing.',
      'utf-8',
    );
  });

  it('accepts name with hyphens and underscores', async () => {
    mockExistsSync.mockReturnValue(false);
    const res = await PUT(makeRequest({ content: 'test' }), params('my-workflow_v2'));
    expect(res.status).toBe(200);
  });
});

describe('GET /api/workflows/[name]', () => {
  it('rejects path-traversal name', async () => {
    const res = await GET(new Request('http://localhost'), params('..%2Fetc'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);
    const res = await GET(new Request('http://localhost'), params('no-exist'));
    expect(res.status).toBe(404);
  });

  it('returns workflow content', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# Hello world');
    const res = await GET(new Request('http://localhost'), params('dev-worker'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('dev-worker');
    expect(json.content).toBe('# Hello world');
  });
});
