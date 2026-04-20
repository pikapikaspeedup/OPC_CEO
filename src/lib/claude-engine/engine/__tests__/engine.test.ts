import { performance } from 'node:perf_hooks';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Tool, ToolContext } from '../../types';
import type { APIMessage, StreamEvent, TokenUsage } from '../../api/types';
import { PermissionChecker } from '../../permissions/checker';
import {
  attachDepartmentRuntimeContext,
  type DepartmentRuntimePolicy,
} from '../tool-executor';

const { mockStreamQuery } = vi.hoisted(() => ({
  mockStreamQuery: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  streamQuery: (...args: unknown[]) => mockStreamQuery(...args),
}));

import { ClaudeEngine, ToolExecutor, queryLoop } from '..';

function createToolContext(): ToolContext {
  return {
    workspacePath: '/workspace',
    abortSignal: new AbortController().signal,
    readFile: async () => '',
    writeFile: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
}

function createTool(options: {
  name: string;
  handler?: (input: Record<string, unknown>) => Promise<unknown> | unknown;
  isConcurrencySafe?: boolean;
  isReadOnly?: boolean;
  getPath?: (input: Record<string, unknown>) => string;
}): Tool<Record<string, unknown>, unknown> {
  return {
    name: options.name,
    inputSchema: z.object({}).passthrough(),
    description: () => options.name,
    call: async (input) => ({
      data: options.handler ? await options.handler(input) : input,
    }),
    isEnabled: () => true,
    isReadOnly: () => options.isReadOnly ?? false,
    isConcurrencySafe: () => options.isConcurrencySafe ?? false,
    maxResultSizeChars: 10_000,
    ...(options.getPath ? { getPath: options.getPath } : {}),
  };
}

function createDepartmentPolicy(
  toolNames: string[],
  overrides: Partial<DepartmentRuntimePolicy> = {},
): DepartmentRuntimePolicy {
  const checker = new PermissionChecker({
    mode: overrides.permissionMode ?? 'default',
    cwd: '/workspace',
  });
  for (const toolName of toolNames) {
    checker.addSessionRule(toolName, 'allow');
  }
  if (overrides.allowSubAgents === false) {
    checker.addRule({
      source: 'session',
      behavior: 'deny',
      value: { toolName: 'AgentTool' },
    });
  }
  return {
    permissionMode: overrides.permissionMode ?? 'default',
    permissionChecker: checker,
    readRoots: overrides.readRoots ?? ['/workspace'],
    writeRoots: overrides.writeRoots ?? ['/workspace'],
    additionalWorkingDirectories: overrides.additionalWorkingDirectories ?? [],
    artifactRoot: overrides.artifactRoot,
    requiredArtifacts: overrides.requiredArtifacts ?? [],
    allowSubAgents: overrides.allowSubAgents ?? true,
  };
}

function createMockStreamEvents(options: {
  textContent?: string;
  toolUse?: { id: string; name: string; input: Record<string, unknown> };
  usage?: TokenUsage;
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens';
}): StreamEvent[] {
  const usage = options.usage ?? { input_tokens: 0, output_tokens: 0 };
  const stopReason = options.stopReason ?? (options.toolUse ? 'tool_use' : 'end_turn');
  const events: StreamEvent[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg_test',
        usage,
      },
    },
  ];

  if (options.textContent !== undefined) {
    events.push({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'text',
        text: '',
      },
    });
    events.push({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: options.textContent,
      },
    });
    events.push({
      type: 'content_block_stop',
      index: 0,
    });
  }

  if (options.toolUse) {
    events.push({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: options.toolUse.id,
        name: options.toolUse.name,
        input: {},
      },
    });
    events.push({
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: JSON.stringify(options.toolUse.input),
      },
    });
    events.push({
      type: 'content_block_stop',
      index: 0,
    });
  }

  events.push({
    type: 'message_delta',
    delta: {
      stop_reason: stopReason,
    },
    usage,
  });
  events.push({ type: 'message_stop' });

  return events;
}

function streamFromEvents(events: StreamEvent[]) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}

describe('ToolExecutor', () => {
  let context: ToolContext;

  beforeEach(() => {
    context = createToolContext();
  });

  it('executes single tool', async () => {
    const tool = createTool({
      name: 'EchoTool',
      handler: async (input) => `echo:${String(input.value)}`,
    });
    const executor = new ToolExecutor(new Map([[tool.name, tool]]), context);

    const results = await collectAsync(
      executor.executeTools([
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'EchoTool',
          input: { value: 'hello' },
        },
      ]),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      toolUseId: 'toolu_1',
      toolName: 'EchoTool',
      input: { value: 'hello' },
      result: { data: 'echo:hello' },
      isError: false,
    });
  });

  it('handles tool error gracefully', async () => {
    const tool = createTool({
      name: 'BrokenTool',
      handler: async () => {
        throw new Error('boom');
      },
    });
    const executor = new ToolExecutor(new Map([[tool.name, tool]]), context);

    const [result] = await collectAsync(
      executor.executeTools([
        {
          type: 'tool_use',
          id: 'toolu_2',
          name: 'BrokenTool',
          input: {},
        },
      ]),
    );

    expect(result?.isError).toBe(true);
    expect(String(result?.result.data)).toContain('boom');
  });

  it('handles unknown tool name', async () => {
    const executor = new ToolExecutor(new Map(), context);

    const [result] = await collectAsync(
      executor.executeTools([
        {
          type: 'tool_use',
          id: 'toolu_3',
          name: 'MissingTool',
          input: {},
        },
      ]),
    );

    expect(result?.isError).toBe(true);
    expect(String(result?.result.data)).toContain('Unknown tool');
  });

  it('measures execution duration', async () => {
    const tool = createTool({
      name: 'SlowTool',
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return 'done';
      },
    });
    const executor = new ToolExecutor(new Map([[tool.name, tool]]), context);

    const [result] = await collectAsync(
      executor.executeTools([
        {
          type: 'tool_use',
          id: 'toolu_4',
          name: 'SlowTool',
          input: {},
        },
      ]),
    );

    expect(result?.durationMs).toBeGreaterThanOrEqual(20);
  });

  it('enforces department read roots for read tools', async () => {
    const tool = createTool({
      name: 'FileReadTool',
      isReadOnly: true,
      getPath: (input) => String(input.file_path),
      handler: async () => 'content',
    });
    attachDepartmentRuntimeContext(
      context,
      createDepartmentPolicy([tool.name], {
        readRoots: ['/workspace/allowed'],
      }),
    );
    const executor = new ToolExecutor(new Map([[tool.name, tool]]), context);

    const [result] = await collectAsync(
      executor.executeTools([
        {
          type: 'tool_use',
          id: 'toolu_read_denied',
          name: 'FileReadTool',
          input: { file_path: '/workspace/blocked/notes.md' },
        },
      ]),
    );

    expect(result?.isError).toBe(true);
    expect(String(result?.result.data)).toContain('allowed read roots');
  });

  it('enforces department write roots for mutating tools', async () => {
    const tool = createTool({
      name: 'FileWriteTool',
      isReadOnly: false,
      getPath: (input) => String(input.file_path),
      handler: async () => 'written',
    });
    attachDepartmentRuntimeContext(
      context,
      createDepartmentPolicy([tool.name], {
        writeRoots: ['/workspace/artifacts'],
      }),
    );
    const executor = new ToolExecutor(new Map([[tool.name, tool]]), context);

    const [result] = await collectAsync(
      executor.executeTools([
        {
          type: 'tool_use',
          id: 'toolu_write_denied',
          name: 'FileWriteTool',
          input: { file_path: '/workspace/src/output.md' },
        },
      ]),
    );

    expect(result?.isError).toBe(true);
    expect(String(result?.result.data)).toContain('allowed write roots');
  });

  it('enforces department permission mode before tool execution', async () => {
    const tool = createTool({
      name: 'FileWriteTool',
      isReadOnly: false,
      getPath: (input) => String(input.file_path),
      handler: async () => 'written',
    });
    attachDepartmentRuntimeContext(
      context,
      createDepartmentPolicy([tool.name], {
        permissionMode: 'plan',
      }),
    );
    const executor = new ToolExecutor(new Map([[tool.name, tool]]), context);

    const [result] = await collectAsync(
      executor.executeTools([
        {
          type: 'tool_use',
          id: 'toolu_plan_denied',
          name: 'FileWriteTool',
          input: { file_path: '/workspace/plan.txt' },
        },
      ]),
    );

    expect(result?.isError).toBe(true);
    expect(String(result?.result.data)).toContain('Denied by plan mode');
  });

  it('executes concurrent-safe tools in parallel', async () => {
    const startedAt: number[] = [];
    const toolA = createTool({
      name: 'ParallelA',
      isConcurrencySafe: true,
      handler: async () => {
        startedAt.push(performance.now());
        await new Promise((resolve) => setTimeout(resolve, 40));
        return 'a';
      },
    });
    const toolB = createTool({
      name: 'ParallelB',
      isConcurrencySafe: true,
      handler: async () => {
        startedAt.push(performance.now());
        await new Promise((resolve) => setTimeout(resolve, 40));
        return 'b';
      },
    });
    const executor = new ToolExecutor(
      new Map([
        [toolA.name, toolA],
        [toolB.name, toolB],
      ]),
      context,
    );

    const results = await collectAsync(
      executor.executeTools([
        {
          type: 'tool_use',
          id: 'toolu_5',
          name: 'ParallelA',
          input: {},
        },
        {
          type: 'tool_use',
          id: 'toolu_6',
          name: 'ParallelB',
          input: {},
        },
      ]),
    );

    expect(results).toHaveLength(2);
    expect(Math.abs(startedAt[0] - startedAt[1])).toBeLessThan(20);
  });
});

describe('queryLoop', () => {
  let toolContext: ToolContext;
  let messages: APIMessage[];

  beforeEach(() => {
    mockStreamQuery.mockReset();
    toolContext = createToolContext();
    messages = [{ role: 'user', content: 'Hello' }];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('completes when no tool_use in response', async () => {
    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(
        createMockStreamEvents({
          textContent: 'Done',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      ),
    );

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
      }),
    );

    expect(events.find((event) => event.type === 'text_delta')).toMatchObject({
      type: 'text_delta',
      text: 'Done',
    });
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      totalTurns: 1,
      stopReason: 'end_turn',
      totalUsage: { input_tokens: 10, output_tokens: 5 },
    });
  });

  it('executes tools and loops when tool_use present', async () => {
    const tool = createTool({
      name: 'EchoTool',
      handler: async (input) => `echo:${String(input.value)}`,
    });
    const turns = [
      createMockStreamEvents({
        toolUse: { id: 'toolu_1', name: 'EchoTool', input: { value: 'hi' } },
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
      createMockStreamEvents({
        textContent: 'All done',
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    ];
    mockStreamQuery.mockImplementation(() => streamFromEvents(turns.shift() ?? []));

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        tools: [tool],
        toolContext,
        messages,
      }),
    );

    expect(mockStreamQuery).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.type === 'turn_start')).toHaveLength(2);
    expect(events.find((event) => event.type === 'tool_end')).toMatchObject({
      type: 'tool_end',
      toolName: 'EchoTool',
      isError: false,
    });
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      totalTurns: 2,
      stopReason: 'end_turn',
      totalUsage: { input_tokens: 15, output_tokens: 5 },
    });
  });

  it('respects maxTurns limit', async () => {
    const tool = createTool({
      name: 'EchoTool',
      handler: async () => 'ok',
    });
    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(
        createMockStreamEvents({
          toolUse: { id: 'toolu_1', name: 'EchoTool', input: {} },
          usage: { input_tokens: 4, output_tokens: 1 },
        }),
      ),
    );

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        tools: [tool],
        toolContext,
        messages,
        maxTurns: 1,
      }),
    );

    expect(mockStreamQuery).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      totalTurns: 1,
      stopReason: 'max_turns',
    });
  });

  it('handles error events', async () => {
    mockStreamQuery.mockImplementation(() =>
      streamFromEvents([
        {
          type: 'error',
          error: { type: 'api_error', message: 'bad gateway' },
        },
      ]),
    );

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      stopReason: 'error',
    });
  });

  it('yields text_delta events', async () => {
    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(createMockStreamEvents({ textContent: 'hello world' })),
    );

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
      }),
    );

    expect(events).toContainEqual({ type: 'text_delta', text: 'hello world' });
  });

  it('yields turn_start and turn_end events', async () => {
    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(createMockStreamEvents({ textContent: 'done' })),
    );

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
      }),
    );

    expect(events[0]).toMatchObject({ type: 'turn_start', turnNumber: 1 });
    expect(events.find((event) => event.type === 'turn_end')).toMatchObject({
      type: 'turn_end',
      turnResult: {
        turnNumber: 1,
        stopReason: 'end_turn',
      },
    });
  });

  it('accumulates usage across turns', async () => {
    const tool = createTool({
      name: 'EchoTool',
      handler: async () => 'ok',
    });
    const turns = [
      createMockStreamEvents({
        toolUse: { id: 'toolu_1', name: 'EchoTool', input: {} },
        usage: { input_tokens: 7, output_tokens: 2 },
      }),
      createMockStreamEvents({
        textContent: 'done',
        usage: { input_tokens: 3, output_tokens: 4 },
      }),
    ];
    mockStreamQuery.mockImplementation(() => streamFromEvents(turns.shift() ?? []));

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        tools: [tool],
        toolContext,
        messages,
      }),
    );

    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      totalUsage: { input_tokens: 10, output_tokens: 6 },
    });
  });

  it('respects token budget', async () => {
    const tool = createTool({
      name: 'EchoTool',
      handler: async () => 'ok',
    });
    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(
        createMockStreamEvents({
          toolUse: { id: 'toolu_1', name: 'EchoTool', input: {} },
          usage: { input_tokens: 8, output_tokens: 7 },
        }),
      ),
    );

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        tools: [tool],
        toolContext,
        messages,
        maxTokenBudget: 15,
      }),
    );

    expect(mockStreamQuery).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      totalTurns: 1,
      stopReason: 'token_budget',
    });
  });
});

describe('ClaudeEngine', () => {
  beforeEach(() => {
    mockStreamQuery.mockReset();
  });

  it('chat sends user message and yields events', async () => {
    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(
        createMockStreamEvents({
          textContent: 'Hello back',
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
      ),
    );
    const engine = new ClaudeEngine({
      model: { model: 'claude-test', apiKey: 'test-key' },
      toolContext: createToolContext(),
    });

    const events = await collectAsync(engine.chat('Hi there'));

    expect(events.some((event) => event.type === 'text_delta')).toBe(true);
    expect(engine.getMessages()).toEqual([
      { role: 'user', content: 'Hi there' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello back' }] },
    ]);
  });

  it('chatSimple returns final text', async () => {
    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(
        createMockStreamEvents({
          textContent: 'Simple reply',
          usage: { input_tokens: 2, output_tokens: 2 },
        }),
      ),
    );
    const engine = new ClaudeEngine({
      model: { model: 'claude-test', apiKey: 'test-key' },
      toolContext: createToolContext(),
    });

    await expect(engine.chatSimple('Ping')).resolves.toBe('Simple reply');
  });

  it('maintains conversation history', async () => {
    const turns = [
      createMockStreamEvents({
        textContent: 'First answer',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      createMockStreamEvents({
        textContent: 'Second answer',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    ];
    mockStreamQuery.mockImplementation(() => streamFromEvents(turns.shift() ?? []));
    const engine = new ClaudeEngine({
      model: { model: 'claude-test', apiKey: 'test-key' },
      toolContext: createToolContext(),
    });

    await collectAsync(engine.chat('First question'));
    await collectAsync(engine.chat('Second question'));

    expect(engine.getMessages()).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: [{ type: 'text', text: 'Second answer' }] },
    ]);
  });

  it('clearMessages resets history', async () => {
    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(createMockStreamEvents({ textContent: 'Done' })),
    );
    const engine = new ClaudeEngine({
      model: { model: 'claude-test', apiKey: 'test-key' },
      toolContext: createToolContext(),
    });

    await collectAsync(engine.chat('Question'));
    engine.clearMessages();

    expect(engine.getMessages()).toEqual([]);
  });

  it('getUsage returns accumulated usage', async () => {
    const turns = [
      createMockStreamEvents({
        textContent: 'One',
        usage: { input_tokens: 4, output_tokens: 1 },
      }),
      createMockStreamEvents({
        textContent: 'Two',
        usage: { input_tokens: 6, output_tokens: 3 },
      }),
    ];
    mockStreamQuery.mockImplementation(() => streamFromEvents(turns.shift() ?? []));
    const engine = new ClaudeEngine({
      model: { model: 'claude-test', apiKey: 'test-key' },
      toolContext: createToolContext(),
    });

    await collectAsync(engine.chat('First'));
    await collectAsync(engine.chat('Second'));

    expect(engine.getUsage()).toEqual({
      input_tokens: 10,
      output_tokens: 4,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });
});

// ===========================================================================
// D1-D3 Integration Tests: Retry, Compaction, Continuation
// ===========================================================================

/** Helper: create error with statusCode (mimics APIClientError without importing mocked module) */
function createApiError(message: string, statusCode: number): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

describe('queryLoop — retry integration (D1)', () => {
  let toolContext: ToolContext;
  let messages: APIMessage[];

  beforeEach(() => {
    mockStreamQuery.mockReset();
    toolContext = createToolContext();
    messages = [{ role: 'user', content: 'Hello' }];
  });

  it('retries on 429 and yields retry event', async () => {
    let callCount = 0;
    mockStreamQuery.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        throw createApiError('Rate limited', 429);
      }
      return streamFromEvents(
        createMockStreamEvents({
          textContent: 'Success after retry',
          usage: { input_tokens: 5, output_tokens: 3 },
        }),
      );
    });

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
      }),
    );

    const retryEvents = events.filter((e) => e.type === 'retry');
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0]).toMatchObject({
      type: 'retry',
      attempt: 1,
      statusCode: 429,
    });

    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      stopReason: 'end_turn',
    });
  });

  it('retries on 503 and succeeds', async () => {
    let callCount = 0;
    mockStreamQuery.mockImplementation(() => {
      callCount += 1;
      if (callCount <= 2) {
        throw createApiError('Service unavailable', 503);
      }
      return streamFromEvents(
        createMockStreamEvents({ textContent: 'OK', usage: { input_tokens: 1, output_tokens: 1 } }),
      );
    });

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
      }),
    );

    const retryEvents = events.filter((e) => e.type === 'retry');
    expect(retryEvents).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: 'complete', stopReason: 'end_turn' });
  });

  it('fails after exhausting retries on non-retryable error', async () => {
    mockStreamQuery.mockImplementation(() => {
      throw createApiError('Bad request', 400);
    });

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
      }),
    );

    expect(events.filter((e) => e.type === 'retry')).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      stopReason: 'error',
    });
  });
});

describe('queryLoop — reactive compaction on 413 (D2)', () => {
  let toolContext: ToolContext;

  beforeEach(() => {
    mockStreamQuery.mockReset();
    toolContext = createToolContext();
  });

  it('compacts messages and retries on 413 error', async () => {
    const messages: APIMessage[] = [
      { role: 'user', content: 'Initial question' },
    ];
    // Build up enough messages to allow compaction
    for (let i = 0; i < 12; i++) {
      messages.push({ role: 'assistant', content: [{ type: 'text', text: `Answer ${i}: ${'x'.repeat(500)}` }] });
      messages.push({ role: 'user', content: `Follow-up ${i}` });
    }

    let callCount = 0;
    mockStreamQuery.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        throw createApiError('Prompt too long', 413);
      }
      return streamFromEvents(
        createMockStreamEvents({
          textContent: 'Compacted success',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      );
    });

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
      }),
    );

    const compactionEvents = events.filter((e) => e.type === 'compaction');
    expect(compactionEvents).toHaveLength(1);
    expect(compactionEvents[0]).toMatchObject({
      type: 'compaction',
      removedMessages: expect.any(Number),
      estimatedTokensBefore: expect.any(Number),
      estimatedTokensAfter: expect.any(Number),
    });
    expect((compactionEvents[0] as any).removedMessages).toBeGreaterThan(0);

    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      stopReason: 'end_turn',
    });

    // Verify messages were actually compacted (fewer than original)
    expect(messages.length).toBeLessThan(25);
  });

  it('does not compact when too few messages for 413', async () => {
    const messages: APIMessage[] = [
      { role: 'user', content: 'Short' },
      { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
    ];

    mockStreamQuery.mockImplementation(() => {
      throw createApiError('Prompt too long', 413);
    });

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
      }),
    );

    expect(events.filter((e) => e.type === 'compaction')).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'complete', stopReason: 'error' });
  });
});

describe('queryLoop — proactive compaction (D2)', () => {
  let toolContext: ToolContext;

  beforeEach(() => {
    mockStreamQuery.mockReset();
    toolContext = createToolContext();
  });

  it('proactively compacts when context exceeds 85% threshold', async () => {
    const messages: APIMessage[] = [
      { role: 'user', content: 'Initial' },
    ];
    // Create enough messages to exceed 85% of a low maxContextTokens
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'assistant', content: [{ type: 'text', text: `Long response ${i}: ${'y'.repeat(200)}` }] });
      messages.push({ role: 'user', content: `Q${i}` });
    }

    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(
        createMockStreamEvents({ textContent: 'Done', usage: { input_tokens: 5, output_tokens: 2 } }),
      ),
    );

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
        maxContextTokens: 500, // Low threshold to trigger compaction
      }),
    );

    const compactionEvents = events.filter((e) => e.type === 'compaction');
    expect(compactionEvents.length).toBeGreaterThanOrEqual(1);
    expect(compactionEvents[0]).toMatchObject({
      type: 'compaction',
      removedMessages: expect.any(Number),
    });

    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      stopReason: 'end_turn',
    });
  });

  it('skips compaction when context is within threshold', async () => {
    const messages: APIMessage[] = [
      { role: 'user', content: 'Hello' },
    ];

    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(
        createMockStreamEvents({ textContent: 'Hi', usage: { input_tokens: 2, output_tokens: 1 } }),
      ),
    );

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
        maxContextTokens: 100_000, // Very high threshold
      }),
    );

    expect(events.filter((e) => e.type === 'compaction')).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: 'complete', stopReason: 'end_turn' });
  });
});

describe('queryLoop — max_tokens continuation (D3)', () => {
  let toolContext: ToolContext;
  let messages: APIMessage[];

  beforeEach(() => {
    mockStreamQuery.mockReset();
    toolContext = createToolContext();
    messages = [{ role: 'user', content: 'Generate a long response' }];
  });

  it('injects continuation message and retries on max_tokens', async () => {
    let callCount = 0;
    mockStreamQuery.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return streamFromEvents(
          createMockStreamEvents({
            textContent: 'Partial response...',
            stopReason: 'max_tokens',
            usage: { input_tokens: 5, output_tokens: 10 },
          }),
        );
      }
      return streamFromEvents(
        createMockStreamEvents({
          textContent: 'Completed!',
          usage: { input_tokens: 8, output_tokens: 3 },
        }),
      );
    });

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
      }),
    );

    const continuationEvents = events.filter((e) => e.type === 'continuation');
    expect(continuationEvents).toHaveLength(1);
    expect(continuationEvents[0]).toMatchObject({
      type: 'continuation',
      attempt: 1,
      maxAttempts: 3,
    });

    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      stopReason: 'end_turn',
    });

    // Verify the continuation message was injected
    const continuationMsg = messages.find(
      (m) => typeof m.content === 'string' && m.content.includes('Continue your work'),
    );
    expect(continuationMsg).toBeDefined();
  });

  it('exhausts continuation retries after maxContinuationRetries', async () => {
    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(
        createMockStreamEvents({
          textContent: 'Truncated...',
          stopReason: 'max_tokens',
          usage: { input_tokens: 3, output_tokens: 5 },
        }),
      ),
    );

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
        maxContinuationRetries: 2,
      }),
    );

    const continuationEvents = events.filter((e) => e.type === 'continuation');
    expect(continuationEvents).toHaveLength(2);
    expect(continuationEvents[0]).toMatchObject({ attempt: 1, maxAttempts: 2 });
    expect(continuationEvents[1]).toMatchObject({ attempt: 2, maxAttempts: 2 });

    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      stopReason: 'continuation_exhausted',
    });
  });

  it('default maxContinuationRetries is 3', async () => {
    mockStreamQuery.mockImplementation(() =>
      streamFromEvents(
        createMockStreamEvents({
          textContent: 'Truncated',
          stopReason: 'max_tokens',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      ),
    );

    const events = await collectAsync(
      queryLoop({
        model: { model: 'claude-test', apiKey: 'test-key' },
        toolContext,
        messages,
      }),
    );

    const continuationEvents = events.filter((e) => e.type === 'continuation');
    expect(continuationEvents).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({
      type: 'complete',
      stopReason: 'continuation_exhausted',
    });
  });
});
