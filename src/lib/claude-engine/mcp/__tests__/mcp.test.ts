import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { describe, expect, test, vi } from 'vitest';

import type { ToolContext } from '../../types';
import {
  createIdGenerator,
  isNotification,
  parseResponse,
  serializeRequest,
} from '../json-rpc';
import { McpClient } from '../client';
import { McpManager } from '../manager';
import { StdioTransport } from '../stdio-transport';
import type {
  McpCapabilities,
  McpServerConfig,
  McpToolResult,
} from '../types';

function createToolContext(): ToolContext {
  return {
    workspacePath: '/workspace',
    abortSignal: new AbortController().signal,
    readFile: async () => '',
    writeFile: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
}

function createMockChildProcess(): {
  child: ChildProcess & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: {
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    kill: ReturnType<typeof vi.fn>;
  };
  writes: string[];
} {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const writes: string[] = [];
  const stdin = {
    write: vi.fn((chunk: string | Buffer) => {
      writes.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk);
      return true;
    }),
    end: vi.fn(),
  };
  const kill = vi.fn(() => {
    emitter.emit('exit', 0, null);
    return true;
  });

  const child = Object.assign(emitter, {
    stdout,
    stderr,
    stdin,
    kill,
  }) as ChildProcess & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: typeof stdin;
    kill: typeof kill;
  };

  return { child, writes };
}

function createMockSdkClient(overrides: Record<string, unknown> = {}) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    getServerCapabilities: vi.fn().mockReturnValue({
      tools: {},
      resources: {},
      prompts: {},
    }),
    listTools: vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'echo',
          description: 'Echo input',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          },
        },
      ],
    }),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    }),
    listResources: vi.fn().mockResolvedValue({
      resources: [
        {
          uri: 'file:///config.json',
          name: 'config',
          description: 'Runtime config',
          mimeType: 'application/json',
        },
      ],
    }),
    readResource: vi.fn().mockResolvedValue({
      contents: [
        {
          uri: 'file:///config.json',
          text: '{"ok":true}',
          mimeType: 'application/json',
        },
      ],
    }),
    ...overrides,
  };
}

function createServerConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    name: 'demo',
    type: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { TEST_ENV: '1' },
    ...overrides,
  };
}

function createMockManagedClient(overrides: Record<string, unknown> = {}) {
  const capabilities: McpCapabilities = {
    tools: true,
    resources: true,
    prompts: false,
  };

  return {
    connect: vi.fn().mockResolvedValue(capabilities),
    disconnect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([
      {
        name: 'echo',
        description: 'Echo input',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
      },
    ]),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'echoed' }],
      isError: false,
    } satisfies McpToolResult),
    getState: vi.fn().mockReturnValue({
      status: 'connected',
      capabilities,
    }),
    getConfig: vi.fn().mockReturnValue(createServerConfig()),
    ...overrides,
  };
}

describe('JsonRpc', () => {
  test('serializeRequest produces valid JSON-RPC', () => {
    const serialized = serializeRequest('tools/list', { cursor: 'abc' }, 7);

    expect(JSON.parse(serialized)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/list',
      params: { cursor: 'abc' },
    });
  });

  test('parseResponse handles result', () => {
    const parsed = parseResponse(
      '{"jsonrpc":"2.0","id":3,"result":{"ok":true}}',
    );

    expect(parsed).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { ok: true },
    });
  });

  test('parseResponse handles error', () => {
    const parsed = parseResponse(
      '{"jsonrpc":"2.0","id":9,"error":{"code":-32000,"message":"boom"}}',
    );

    expect(parsed).toEqual({
      jsonrpc: '2.0',
      id: 9,
      error: { code: -32000, message: 'boom' },
    });
  });

  test('isNotification distinguishes notifications', () => {
    expect(
      isNotification({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    ).toBe(true);
    expect(
      isNotification({
        jsonrpc: '2.0',
        id: 1,
        result: {},
      }),
    ).toBe(false);
  });

  test('createIdGenerator generates sequential ids', () => {
    const nextId = createIdGenerator();

    expect(nextId()).toBe(1);
    expect(nextId()).toBe(2);
    expect(nextId()).toBe(3);
  });
});

describe('StdioTransport', () => {
  test('connect spawns child process', async () => {
    const { child } = createMockChildProcess();
    const spawnMock = vi.fn(() => child);
    const transport = new StdioTransport(
      {
        command: 'node',
        args: ['server.js'],
        env: { TEST_ENV: '1' },
        cwd: '/workspace',
      },
      { spawn: spawnMock },
    );

    await transport.connect();

    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      ['server.js'],
      expect.objectContaining({
        cwd: '/workspace',
        env: expect.objectContaining({ TEST_ENV: '1' }),
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
  });

  test('request sends and receives response', async () => {
    const { child, writes } = createMockChildProcess();
    const transport = new StdioTransport(
      { command: 'node' },
      { spawn: vi.fn(() => child) },
    );

    await transport.connect();
    const resultPromise = transport.request('tools/list', { cursor: 'abc' });

    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? '')).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { cursor: 'abc' },
    });

    child.stdout.write(
      '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"echo"}]}}\n',
    );

    await expect(resultPromise).resolves.toEqual({
      tools: [{ name: 'echo' }],
    });
  });

  test('notify sends without expecting response', async () => {
    const { child, writes } = createMockChildProcess();
    const transport = new StdioTransport(
      { command: 'node' },
      { spawn: vi.fn(() => child) },
    );

    await transport.connect();
    transport.notify('notifications/initialized', { ready: true });

    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0] ?? '')).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: { ready: true },
    });
  });

  test('close kills child process', async () => {
    const { child } = createMockChildProcess();
    const transport = new StdioTransport(
      { command: 'node' },
      { spawn: vi.fn(() => child) },
    );

    await transport.connect();
    await transport.close();

    expect(child.kill).toHaveBeenCalledOnce();
  });

  test('handles buffer splitting', async () => {
    const { child } = createMockChildProcess();
    const transport = new StdioTransport(
      { command: 'node' },
      { spawn: vi.fn(() => child) },
    );

    await transport.connect();
    const resultPromise = transport.request('ping');

    child.stdout.write('{"jsonrpc":"2.0","id":1,"result":{"ok":');
    child.stdout.write('true}}\n');

    await expect(resultPromise).resolves.toEqual({ ok: true });
  });
});

describe('McpClient', () => {
  test('connect performs initialize handshake', async () => {
    const mockTransport = { close: vi.fn().mockResolvedValue(undefined) };
    const mockClient = createMockSdkClient();
    const client = new McpClient(createServerConfig(), {
      createSdkClient: () => mockClient,
      createSdkTransport: vi.fn(() => mockTransport),
    });

    await expect(client.connect()).resolves.toEqual({
      tools: true,
      resources: true,
      prompts: true,
    });

    expect(mockClient.connect).toHaveBeenCalledWith(mockTransport);
    expect(client.getState()).toEqual({
      status: 'connected',
      capabilities: {
        tools: true,
        resources: true,
        prompts: true,
      },
    });
  });

  test('listTools returns tool list', async () => {
    const mockClient = createMockSdkClient();
    const client = new McpClient(createServerConfig(), {
      createSdkClient: () => mockClient,
      createSdkTransport: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
    });

    await client.connect();

    await expect(client.listTools()).resolves.toEqual([
      {
        name: 'echo',
        description: 'Echo input',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string' } },
          required: ['message'],
        },
      },
    ]);
  });

  test('callTool sends and returns result', async () => {
    const mockClient = createMockSdkClient({
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'done' }],
        isError: false,
      }),
    });
    const client = new McpClient(createServerConfig(), {
      createSdkClient: () => mockClient,
      createSdkTransport: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
    });

    await client.connect();

    await expect(
      client.callTool('echo', { message: 'hello' }),
    ).resolves.toEqual({
      content: [{ type: 'text', text: 'done' }],
      isError: false,
    });
    expect(mockClient.callTool).toHaveBeenCalledWith({
      name: 'echo',
      arguments: { message: 'hello' },
    });
  });

  test('listResources returns resources', async () => {
    const mockClient = createMockSdkClient();
    const client = new McpClient(createServerConfig(), {
      createSdkClient: () => mockClient,
      createSdkTransport: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
    });

    await client.connect();

    await expect(client.listResources()).resolves.toEqual([
      {
        uri: 'file:///config.json',
        name: 'config',
        description: 'Runtime config',
        mimeType: 'application/json',
      },
    ]);
  });

  test('readResource returns content', async () => {
    const mockClient = createMockSdkClient({
      readResource: vi.fn().mockResolvedValue({
        contents: [
          {
            uri: 'file:///config.json',
            text: '{"ok":true}',
            mimeType: 'application/json',
          },
          {
            uri: 'file:///blob.bin',
            blob: 'AAEC',
            mimeType: 'application/octet-stream',
          },
        ],
      }),
    });
    const client = new McpClient(createServerConfig(), {
      createSdkClient: () => mockClient,
      createSdkTransport: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
    });

    await client.connect();

    await expect(client.readResource('file:///config.json')).resolves.toEqual([
      {
        uri: 'file:///config.json',
        text: '{"ok":true}',
        mimeType: 'application/json',
      },
      {
        uri: 'file:///blob.bin',
        blob: 'AAEC',
        mimeType: 'application/octet-stream',
      },
    ]);
  });

  test('getState reflects connection status', async () => {
    const mockClient = createMockSdkClient();
    const client = new McpClient(createServerConfig(), {
      createSdkClient: () => mockClient,
      createSdkTransport: () => ({ close: vi.fn().mockResolvedValue(undefined) }),
    });

    expect(client.getState()).toEqual({ status: 'disconnected' });

    await client.connect();

    expect(client.getState()).toEqual({
      status: 'connected',
      capabilities: {
        tools: true,
        resources: true,
        prompts: true,
      },
    });
  });

  test('disconnect cleans up', async () => {
    const mockTransport = { close: vi.fn().mockResolvedValue(undefined) };
    const mockClient = createMockSdkClient();
    const client = new McpClient(createServerConfig(), {
      createSdkClient: () => mockClient,
      createSdkTransport: () => mockTransport,
    });

    await client.connect();
    await client.disconnect();

    expect(mockClient.close).toHaveBeenCalledOnce();
    expect(client.getState()).toEqual({ status: 'disconnected' });
  });
});

describe('McpManager', () => {
  test('addServer connects and tracks', async () => {
    const mockClient = createMockManagedClient();
    const manager = new McpManager({
      createClient: () => mockClient,
    });

    await manager.addServer(createServerConfig({ name: 'alpha' }));

    expect(mockClient.connect).toHaveBeenCalledOnce();
    expect(manager.getServers()).toEqual([
      {
        name: 'alpha',
        state: {
          status: 'connected',
          capabilities: {
            tools: true,
            resources: true,
            prompts: false,
          },
        },
      },
    ]);
  });

  test('removeServer disconnects and removes', async () => {
    const mockClient = createMockManagedClient();
    const manager = new McpManager({
      createClient: () => mockClient,
    });

    await manager.addServer(createServerConfig({ name: 'alpha' }));
    await manager.removeServer('alpha');

    expect(mockClient.disconnect).toHaveBeenCalledOnce();
    expect(manager.getServers()).toEqual([]);
  });

  test('getAllTools aggregates from all servers', async () => {
    const alphaClient = createMockManagedClient({
      listTools: vi.fn().mockResolvedValue([
        {
          name: 'echo',
          description: 'Echo input',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
          },
        },
      ]),
      getConfig: vi.fn().mockReturnValue(createServerConfig({ name: 'alpha' })),
    });
    const betaClient = createMockManagedClient({
      listTools: vi.fn().mockResolvedValue([
        {
          name: 'sum',
          description: 'Sum numbers',
          inputSchema: {
            type: 'object',
            properties: { a: { type: 'number' }, b: { type: 'number' } },
            required: ['a', 'b'],
          },
        },
      ]),
      getConfig: vi.fn().mockReturnValue(createServerConfig({ name: 'beta' })),
    });
    const manager = new McpManager({
      createClient: (config) =>
        config.name === 'alpha'
          ? alphaClient
          : betaClient,
    });

    await manager.addServer(createServerConfig({ name: 'alpha' }));
    await manager.addServer(createServerConfig({ name: 'beta' }));

    const tools = await manager.getAllTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'mcp__alpha__echo',
      'mcp__beta__sum',
    ]);

    const alphaTool = tools.find((tool) => tool.name === 'mcp__alpha__echo');
    expect(alphaTool?.inputJSONSchema).toEqual({
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    });
    expect(alphaTool?.isEnabled()).toBe(true);

    const toolResult = await alphaTool?.call(
      { message: 'hello' },
      createToolContext(),
    );

    expect(alphaClient.callTool).toHaveBeenCalledWith('echo', {
      message: 'hello',
    });
    expect(toolResult?.data).toEqual({
      content: [{ type: 'text', text: 'echoed' }],
      isError: false,
    });
  });

  test('callTool routes to correct server', async () => {
    const alphaClient = createMockManagedClient({
      getConfig: vi.fn().mockReturnValue(createServerConfig({ name: 'alpha' })),
    });
    const betaClient = createMockManagedClient({
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'pong' }],
        isError: false,
      }),
      getConfig: vi.fn().mockReturnValue(createServerConfig({ name: 'beta' })),
    });
    const manager = new McpManager({
      createClient: (config) =>
        config.name === 'alpha'
          ? alphaClient
          : betaClient,
    });

    await manager.addServer(createServerConfig({ name: 'alpha' }));
    await manager.addServer(createServerConfig({ name: 'beta' }));

    await expect(
      manager.callTool('mcp__beta__ping', { ok: true }),
    ).resolves.toEqual({
      content: [{ type: 'text', text: 'pong' }],
      isError: false,
    });
    expect(betaClient.callTool).toHaveBeenCalledWith('ping', { ok: true });
    expect(alphaClient.callTool).not.toHaveBeenCalled();
  });

  test('parseMcpToolName parses format', () => {
    expect(McpManager.parseMcpToolName('mcp__alpha__echo')).toEqual({
      serverName: 'alpha',
      toolName: 'echo',
    });
    expect(McpManager.parseMcpToolName('echo')).toBeNull();
    expect(McpManager.parseMcpToolName('mcp__alpha')).toBeNull();
  });

  test('buildMcpToolName creates format', () => {
    expect(McpManager.buildMcpToolName('alpha', 'echo')).toBe(
      'mcp__alpha__echo',
    );
  });

  test('loadFromConfig adds multiple servers', async () => {
    const createdClients: ReturnType<typeof createMockManagedClient>[] = [];
    const manager = new McpManager({
      createClient: () => {
        const client = createMockManagedClient();
        createdClients.push(client);
        return client;
      },
    });

    await manager.loadFromConfig({
      alpha: { type: 'stdio', command: 'node', args: ['alpha.js'] },
      beta: { type: 'stdio', command: 'node', args: ['beta.js'] },
    });

    expect(createdClients).toHaveLength(2);
    expect(manager.getServers().map((server) => server.name).sort()).toEqual([
      'alpha',
      'beta',
    ]);
  });

  test('disconnectAll cleans up all', async () => {
    const alphaClient = createMockManagedClient({
      getConfig: vi.fn().mockReturnValue(createServerConfig({ name: 'alpha' })),
    });
    const betaClient = createMockManagedClient({
      getConfig: vi.fn().mockReturnValue(createServerConfig({ name: 'beta' })),
    });
    const manager = new McpManager({
      createClient: (config) =>
        config.name === 'alpha'
          ? alphaClient
          : betaClient,
    });

    await manager.addServer(createServerConfig({ name: 'alpha' }));
    await manager.addServer(createServerConfig({ name: 'beta' }));
    await manager.disconnectAll();

    expect(alphaClient.disconnect).toHaveBeenCalledOnce();
    expect(betaClient.disconnect).toHaveBeenCalledOnce();
    expect(manager.getServers()).toEqual([]);
  });
});

// ─── SSE Transport ──────────────────────────────────────────────────

describe('McpClient SSE transport', () => {
  test('connects via SSE transport', async () => {
    const mockSseTransport = { close: vi.fn().mockResolvedValue(undefined) };
    const createSseTransport = vi.fn().mockReturnValue(mockSseTransport);
    const mockClient = createMockSdkClient();

    const client = new McpClient(
      createServerConfig({
        type: 'sse',
        url: 'https://mcp.example.com/sse',
        command: undefined,
      }),
      {
        createSdkClient: () => mockClient,
        createSseTransport,
      },
    );

    const caps = await client.connect();

    expect(createSseTransport).toHaveBeenCalledWith(
      new URL('https://mcp.example.com/sse'),
      expect.any(Object),
    );
    expect(mockClient.connect).toHaveBeenCalledWith(mockSseTransport);
    expect(caps.tools).toBe(true);
  });

  test('SSE transport passes custom headers', async () => {
    const createSseTransport = vi.fn().mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    });

    const client = new McpClient(
      createServerConfig({
        type: 'sse',
        url: 'https://mcp.example.com/sse',
        command: undefined,
        headers: { Authorization: 'Bearer tok-123' },
      }),
      {
        createSdkClient: () => createMockSdkClient(),
        createSseTransport,
      },
    );

    await client.connect();

    const opts = createSseTransport.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.requestInit).toEqual({
      headers: { Authorization: 'Bearer tok-123' },
    });
    expect(opts.eventSourceInit).toBeDefined();
  });

  test('SSE transport requires url', async () => {
    const client = new McpClient(
      createServerConfig({
        type: 'sse',
        url: undefined,
        command: undefined,
      }),
      { createSdkClient: () => createMockSdkClient() },
    );

    await expect(client.connect()).rejects.toThrow('URL is required');
  });
});

// ─── HTTP (Streamable HTTP) Transport ───────────────────────────────

describe('McpClient HTTP transport', () => {
  test('connects via HTTP transport', async () => {
    const mockHttpTransport = { close: vi.fn().mockResolvedValue(undefined) };
    const createHttpTransport = vi.fn().mockReturnValue(mockHttpTransport);
    const mockClient = createMockSdkClient();

    const client = new McpClient(
      createServerConfig({
        type: 'http',
        url: 'https://mcp.example.com/http',
        command: undefined,
      }),
      {
        createSdkClient: () => mockClient,
        createHttpTransport,
      },
    );

    const caps = await client.connect();

    expect(createHttpTransport).toHaveBeenCalledWith(
      new URL('https://mcp.example.com/http'),
      expect.any(Object),
    );
    expect(mockClient.connect).toHaveBeenCalledWith(mockHttpTransport);
    expect(caps.tools).toBe(true);
  });

  test('HTTP transport passes custom headers', async () => {
    const createHttpTransport = vi.fn().mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    });

    const client = new McpClient(
      createServerConfig({
        type: 'http',
        url: 'https://mcp.example.com/http',
        command: undefined,
        headers: { 'X-Api-Key': 'key-456' },
      }),
      {
        createSdkClient: () => createMockSdkClient(),
        createHttpTransport,
      },
    );

    await client.connect();

    const opts = createHttpTransport.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.requestInit).toEqual({
      headers: { 'X-Api-Key': 'key-456' },
    });
  });

  test('HTTP transport requires url', async () => {
    const client = new McpClient(
      createServerConfig({
        type: 'http',
        url: undefined,
        command: undefined,
      }),
      { createSdkClient: () => createMockSdkClient() },
    );

    await expect(client.connect()).rejects.toThrow('URL is required');
  });

  test('HTTP transport with no headers passes empty opts', async () => {
    const createHttpTransport = vi.fn().mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    });

    const client = new McpClient(
      createServerConfig({
        type: 'http',
        url: 'https://mcp.example.com/http',
        command: undefined,
        headers: undefined,
      }),
      {
        createSdkClient: () => createMockSdkClient(),
        createHttpTransport,
      },
    );

    await client.connect();

    const opts = createHttpTransport.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.requestInit).toBeUndefined();
  });
});

// ─── Transport type dispatch ────────────────────────────────────────

describe('McpClient transport dispatch', () => {
  test('stdio type creates stdio transport', async () => {
    const createStdio = vi.fn().mockReturnValue({
      close: vi.fn().mockResolvedValue(undefined),
    });

    const client = new McpClient(
      createServerConfig({ type: 'stdio' }),
      {
        createSdkClient: () => createMockSdkClient(),
        createSdkTransport: createStdio,
      },
    );

    await client.connect();

    expect(createStdio).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'node', args: ['server.js'] }),
    );
  });

  test('unsupported type throws', async () => {
    const client = new McpClient(
      createServerConfig({ type: 'ws' as 'stdio' }),
      { createSdkClient: () => createMockSdkClient() },
    );

    await expect(client.connect()).rejects.toThrow('Unsupported MCP transport');
  });

  test('connected SSE client can list tools', async () => {
    const mockClient = createMockSdkClient();
    const client = new McpClient(
      createServerConfig({
        type: 'sse',
        url: 'https://mcp.example.com/sse',
        command: undefined,
      }),
      {
        createSdkClient: () => mockClient,
        createSseTransport: () => ({
          close: vi.fn().mockResolvedValue(undefined),
        }),
      },
    );

    await client.connect();
    const tools = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('echo');
  });

  test('connected HTTP client can call tools', async () => {
    const mockClient = createMockSdkClient({
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'http-result' }],
        isError: false,
      }),
    });
    const client = new McpClient(
      createServerConfig({
        type: 'http',
        url: 'https://mcp.example.com/http',
        command: undefined,
      }),
      {
        createSdkClient: () => mockClient,
        createHttpTransport: () => ({
          close: vi.fn().mockResolvedValue(undefined),
        }),
      },
    );

    await client.connect();
    const result = await client.callTool('test', { key: 'value' });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'http-result' }],
      isError: false,
    });
  });
});