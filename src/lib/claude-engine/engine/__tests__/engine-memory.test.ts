import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import type { ToolContext } from '../../types';
import type { StreamEvent, TokenUsage } from '../../api/types';
import { MemoryStore } from '../../memory/memory-store';

const { mockStreamQuery } = vi.hoisted(() => ({
  mockStreamQuery: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  streamQuery: (...args: unknown[]) => mockStreamQuery(...args),
}));

import { ClaudeEngine } from '../claude-engine';

function createToolContext(): ToolContext {
  return {
    workspacePath: '/workspace',
    abortSignal: new AbortController().signal,
    readFile: async () => '',
    writeFile: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
}

function createMockStreamEvents(options: {
  textContent?: string;
  usage?: TokenUsage;
}): StreamEvent[] {
  const usage = options.usage ?? { input_tokens: 10, output_tokens: 5 };
  const events: StreamEvent[] = [
    {
      type: 'message_start',
      message: { id: 'msg_test', usage },
    },
  ];

  if (options.textContent !== undefined) {
    events.push(
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: options.textContent },
      },
      { type: 'content_block_stop', index: 0 },
    );
  }

  events.push({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 5 },
  });

  return events;
}

async function* mockAsyncIterator(events: StreamEvent[]) {
  for (const event of events) {
    yield event;
  }
}

describe('ClaudeEngine — Memory Integration', () => {
  let tmpDir: string;
  let memoryDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-mem-'));
    memoryDir = path.join(tmpDir, 'projects', 'workspace-project', 'memory');
    await fs.mkdir(memoryDir, { recursive: true });

    mockStreamQuery.mockReset();
    mockStreamQuery.mockReturnValue(
      mockAsyncIterator(createMockStreamEvents({ textContent: 'Hello!' })),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function createStore(): MemoryStore {
    return new MemoryStore({
      pathConfig: { baseDir: tmpDir, projectRoot: '/workspace/project' },
    });
  }

  it('should accept memory config in constructor', () => {
    const store = createStore();
    const engine = new ClaudeEngine({
      model: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      toolContext: createToolContext(),
      memory: { store },
      transcript: { disabled: true },
    });
    expect(engine).toBeDefined();
  });

  it('should inject mechanics prompt into system prompt', async () => {
    const store = createStore();
    const engine = new ClaudeEngine({
      model: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      systemPrompt: 'You are helpful.',
      toolContext: createToolContext(),
      memory: { store },
      transcript: { disabled: true },
    });

    const events: unknown[] = [];
    for await (const e of engine.chat('hi')) {
      events.push(e);
    }

    // Verify streamQuery was called with system prompt containing memory mechanics
    expect(mockStreamQuery).toHaveBeenCalled();
    const callArgs = mockStreamQuery.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain('You are helpful.');
    expect(callArgs.systemPrompt).toContain('persistent, file-based memory directory');
  });

  it('should inject MEMORY.md content as memory-context message', async () => {
    const store = createStore();
    await store.writeEntrypoint('- User prefers TypeScript strict mode');

    const engine = new ClaudeEngine({
      model: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      toolContext: createToolContext(),
      memory: { store },
      transcript: { disabled: true },
    });

    for await (const _e of engine.chat('hi')) {
      // drain
    }

    const callArgs = mockStreamQuery.mock.calls[0][0];
    // Messages start with memory-context user + assistant ack + actual user
    // (queryLoop may append assistant response afterward, so check by content)
    expect(callArgs.messages[0].role).toBe('user');
    expect(callArgs.messages[0].content).toContain('<memory-context>');
    expect(callArgs.messages[0].content).toContain('User prefers TypeScript strict mode');
    expect(callArgs.messages[1].role).toBe('assistant');
    expect(callArgs.messages[1].content).toBe('Memory context loaded.');
    expect(callArgs.messages[2].role).toBe('user');
    expect(callArgs.messages[2].content).toBe('hi');
  });

  it('should include file manifest when includeManifest is true', async () => {
    const store = createStore();
    await store.write('coding-style.md', 'Use 2-space indent', {
      name: 'coding-style',
      description: 'Coding conventions',
      type: 'project',
    });

    const engine = new ClaudeEngine({
      model: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      toolContext: createToolContext(),
      memory: { store, includeManifest: true },
      transcript: { disabled: true },
    });

    for await (const _e of engine.chat('hi')) {
      // drain
    }

    const callArgs = mockStreamQuery.mock.calls[0][0];
    const memoryMsg = callArgs.messages[0].content;
    expect(memoryMsg).toContain('Memory files');
    expect(memoryMsg).toContain('coding-style.md');
  });

  it('should not inject memory when autoInject is false', async () => {
    const store = createStore();
    await store.writeEntrypoint('- Some memory');

    const engine = new ClaudeEngine({
      model: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      systemPrompt: 'Plain prompt.',
      toolContext: createToolContext(),
      memory: { store, autoInject: false },
      transcript: { disabled: true },
    });

    for await (const _e of engine.chat('hi')) {
      // drain
    }

    const callArgs = mockStreamQuery.mock.calls[0][0];
    expect(callArgs.systemPrompt).toBe('Plain prompt.');
    // First user message should be the actual input (no memory-context prefix)
    expect(callArgs.messages[0].content).toBe('hi');
  });

  it('should work without memory config (backwards compatible)', async () => {
    const engine = new ClaudeEngine({
      model: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      systemPrompt: 'Hello.',
      toolContext: createToolContext(),
      transcript: { disabled: true },
    });

    for await (const _e of engine.chat('hi')) {
      // drain
    }

    const callArgs = mockStreamQuery.mock.calls[0][0];
    expect(callArgs.systemPrompt).toBe('Hello.');
    // First message is the user input, no memory prefix
    expect(callArgs.messages[0].content).toBe('hi');
  });

  it('should gracefully degrade when memory dir does not exist', async () => {
    const store = new MemoryStore({
      pathConfig: { baseDir: '/nonexistent/base', projectRoot: '/nonexistent/path' },
    });

    const engine = new ClaudeEngine({
      model: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      toolContext: createToolContext(),
      memory: { store },
      transcript: { disabled: true },
    });

    // Should not throw
    for await (const _e of engine.chat('hi')) {
      // drain
    }

    const callArgs = mockStreamQuery.mock.calls[0][0];
    // Mechanics prompt is still injected (it's static template)
    expect(callArgs.systemPrompt).toContain('persistent, file-based memory directory');
    // No memory-context message (MEMORY.md absent, no manifest files)
    expect(callArgs.messages[0].content).toBe('hi');
  });

  it('should not inject memory-context on second chat call', async () => {
    const store = createStore();
    await store.writeEntrypoint('- Memory item');

    const engine = new ClaudeEngine({
      model: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      toolContext: createToolContext(),
      memory: { store },
      transcript: { disabled: true },
    });

    // First call — should have memory-context prefix
    for await (const _e of engine.chat('first')) {
      // drain
    }
    expect(mockStreamQuery.mock.calls[0][0].messages[0].content).toContain('<memory-context>');
    expect(mockStreamQuery.mock.calls[0][0].messages[2].content).toBe('first');

    // Reset mock for second call
    mockStreamQuery.mockReturnValue(
      mockAsyncIterator(createMockStreamEvents({ textContent: 'World!' })),
    );

    // Second call — should NOT inject memory-context again (not first turn)
    for await (const _e of engine.chat('second')) {
      // drain
    }
    const secondCallArgs = mockStreamQuery.mock.calls[1][0];
    // First message should NOT be memory-context (conversation already has history)
    expect(secondCallArgs.messages[0].content).not.toContain('<memory-context>');
  });

  it('should use custom displayName in mechanics prompt', async () => {
    const store = createStore();
    const engine = new ClaudeEngine({
      model: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      toolContext: createToolContext(),
      memory: { store, displayName: 'Project Notes' },
      transcript: { disabled: true },
    });

    for await (const _e of engine.chat('hi')) {
      // drain
    }

    const callArgs = mockStreamQuery.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain('# Project Notes');
  });

  it('should work when MEMORY.md is empty but manifest has files', async () => {
    const store = createStore();
    // No entrypoint, but has a topic file
    await store.write('api-style.md', 'Use RESTful conventions', {
      name: 'api-style',
      description: 'API design guidelines',
      type: 'project',
    });

    const engine = new ClaudeEngine({
      model: { model: 'claude-sonnet-4-20250514', provider: 'anthropic' },
      toolContext: createToolContext(),
      memory: { store },
      transcript: { disabled: true },
    });

    for await (const _e of engine.chat('hi')) {
      // drain
    }

    const callArgs = mockStreamQuery.mock.calls[0][0];
    // Should still inject manifest as memory-context
    expect(callArgs.messages[0].content).toContain('<memory-context>');
    expect(callArgs.messages[0].content).toContain('api-style.md');
  });
});
