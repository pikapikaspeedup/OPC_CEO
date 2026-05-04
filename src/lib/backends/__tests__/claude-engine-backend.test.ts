import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const importGatewayHome = fsSync.mkdtempSync(path.join(os.tmpdir(), 'claude-engine-backend-import-home-'));
const previousImportGatewayHome = process.env.AG_GATEWAY_HOME;
process.env.AG_GATEWAY_HOME = importGatewayHome;

const {
  mockEngineInstances,
  mockChatImpl,
} = vi.hoisted(() => ({
  mockEngineInstances: [] as Array<{ options: Record<string, unknown> }>,
  mockChatImpl: {
    current: null as null | (() => AsyncGenerator<Record<string, unknown>>),
  },
}));

import {
  buildClaudeEngineSystemPrompt,
  ClaudeEngineAgentBackend,
  createClaudeEngineToolContext,
} from '../claude-engine-backend';
import { agentTool } from '../../claude-engine/tools/agent';
import { getExecutionToolRuntime } from '../../claude-engine/tools/execution-tool';
import { listMcpResourcesTool } from '../../claude-engine/tools/mcp-resources';
import type { ToolContext } from '../../claude-engine/types';
import type { BackendRunConfig } from '../types';

// Mock the ClaudeEngine to avoid real API calls
vi.mock('../../claude-engine/engine/claude-engine', () => {
  class MockClaudeEngine {
    constructor(public options: Record<string, unknown>) {
      mockEngineInstances.push(this);
    }

    async init() {}

    getSessionId() {
      return 'session-123';
    }

    async close() {}

    async *chat() {
      if (mockChatImpl.current) {
        yield* mockChatImpl.current();
        return;
      }
      yield { type: 'turn_start', turnNumber: 1 };
      yield { type: 'text_delta', text: 'Hello from ' };
      yield { type: 'text_delta', text: 'mock engine' };
      yield {
        type: 'tool_end',
        toolUseId: 't1',
        toolName: 'FileWriteTool',
        result: { data: 'Wrote 3 lines to /tmp/test/output.ts' },
        isError: false,
        durationMs: 10,
      };
      yield {
        type: 'complete',
        totalTurns: 1,
        totalUsage: { input_tokens: 100, output_tokens: 50 },
        stopReason: 'end_turn',
      };
    }
  }

  return { ClaudeEngine: MockClaudeEngine };
});

function makeConfig(
  overrides?: Partial<BackendRunConfig> & {
    executionProfile?: Record<string, unknown>;
    runtimeContract?: Record<string, unknown>;
  },
): BackendRunConfig {
  return {
    runId: 'test-run-001',
    workspacePath: '/tmp/test-workspace',
    prompt: 'Write a hello world',
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  } as BackendRunConfig;
}

describe('ClaudeEngineAgentBackend', () => {
  let backend: ClaudeEngineAgentBackend;
  let tempHome: string;

  beforeEach(async () => {
    backend = new ClaudeEngineAgentBackend();
    mockEngineInstances.length = 0;
    mockChatImpl.current = null;
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-engine-backend-'));
  });

  afterEach(async () => {
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(importGatewayHome, { recursive: true, force: true });
    if (previousImportGatewayHome === undefined) {
      delete process.env.AG_GATEWAY_HOME;
    } else {
      process.env.AG_GATEWAY_HOME = previousImportGatewayHome;
    }
  });

  test('providerId is claude-api', () => {
    expect(backend.providerId).toBe('claude-api');
  });

  test('capabilities reports correct values', () => {
    const caps = backend.capabilities();
    expect(caps.supportsAppend).toBe(true);
    expect(caps.supportsCancel).toBe(true);
    expect(caps.emitsStreamingText).toBe(true);
    expect(caps.emitsLiveState).toBe(false);
  });

  test('createClaudeEngineToolContext exposes additional working directories', () => {
    const ctx = createClaudeEngineToolContext(
      '/tmp/test-workspace',
      new AbortController().signal,
      ['/tmp/shared-a', '/tmp/shared-b'],
    );

    expect(ctx.additionalWorkingDirectories).toEqual(['/tmp/shared-a', '/tmp/shared-b']);
  });

  test('createClaudeEngineToolContext rejects exec outside department roots', async () => {
    const ctx = createClaudeEngineToolContext(
      '/tmp/test-workspace',
      new AbortController().signal,
      ['/tmp/shared-a'],
    );

    const result = await ctx.exec('pwd', { cwd: '/tmp/outside-root' });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Execution denied');
  });

  test('buildClaudeEngineSystemPrompt includes execution profile and runtime contract summary', () => {
    const prompt = buildClaudeEngineSystemPrompt(makeConfig({
      executionProfile: {
        kind: 'workflow-run',
        workflowRef: '/ai_digest',
        skillHints: ['research'],
      },
      runtimeContract: {
        workspaceRoot: '/tmp/test-workspace',
        artifactRoot: '.artifacts/runs/test-run-001',
        executionClass: 'department',
        permissionMode: 'workspace-write',
        toolset: 'research',
        additionalWorkingDirectories: ['/tmp/shared-a'],
        readRoots: ['/tmp/reference'],
        writeRoots: ['/tmp/test-workspace'],
        requiredArtifacts: [{
          path: 'summary.md',
          required: true,
          format: 'md',
        }],
      },
    }));

    expect(prompt).toContain('<execution-profile>');
    expect(prompt).toContain('"workflowRef":"/ai_digest"');
    expect(prompt).toContain('Toolset: research');
    expect(prompt).toContain('Additional working directories: /tmp/shared-a');
    expect(prompt).toContain('Required artifacts: summary.md');
  });

  test('start creates session and emits started event', async () => {
    const session = await backend.start(makeConfig());

    expect(session.runId).toBe('test-run-001');
    expect(session.providerId).toBe('claude-api');
    expect(session.handle).toBe('claude-api-session-123');

    const events = [];
    for await (const event of session.events()) {
      events.push(event);
      if (event.kind === 'completed' || event.kind === 'failed') break;
    }

    expect(events[0].kind).toBe('started');
    const completed = events.find((e) => e.kind === 'completed');
    expect(completed).toBeDefined();
    expect(completed!.kind).toBe('completed');
    if (completed!.kind === 'completed') {
      expect(completed.result.status).toBe('completed');
      expect(completed.finalText).toBe('Hello from mock engine');
      expect(completed.result.changedFiles).toContain('/tmp/test/output.ts');
    }
  });

  test('start passes toolset and additional working directories into ClaudeEngine', async () => {
    await backend.start(makeConfig({
      runtimeContract: {
        workspaceRoot: '/tmp/test-workspace',
        toolset: 'research',
        additionalWorkingDirectories: ['shared-a', '/tmp/shared-b', 'shared-a'],
      },
    }));

    expect(mockEngineInstances).toHaveLength(1);
    expect(mockEngineInstances[0]?.options.toolset).toBe('research');
    expect(mockEngineInstances[0]?.options.toolContext).toEqual(expect.objectContaining({
      additionalWorkingDirectories: [
        '/tmp/test-workspace/shared-a',
        '/tmp/shared-b',
      ],
    }));
    expect(mockEngineInstances[0]?.options.departmentRuntime).toEqual(expect.objectContaining({
      permissionMode: 'default',
      writeRoots: expect.arrayContaining(['/tmp/test-workspace']),
    }));
  });

  test('start injects AgentTool handler into runtime tool context', async () => {
    await backend.start(makeConfig({
      runtimeContract: {
        workspaceRoot: '/tmp/test-workspace',
        allowSubAgents: true,
      },
    }));

    const ctx = mockEngineInstances[0]?.options.toolContext as ToolContext;
    const result = await agentTool.call(
      { prompt: 'inspect the workspace and summarize findings' },
      ctx,
    );

    expect(result.data).toContain('Hello from mock engine');
    expect(mockEngineInstances).toHaveLength(2);
  });

  test('start injects MCP resource provider into runtime tool context', async () => {
    await backend.start(makeConfig());

    const ctx = mockEngineInstances[0]?.options.toolContext as ToolContext;
    const result = await listMcpResourcesTool.call({}, ctx);
    expect(result.data).toContain('No resources found');
  });

  test('start injects execution tool runtime and registers ExecutionTool', async () => {
    await backend.start(makeConfig({
      runtimeContract: {
        workspaceRoot: '/tmp/test-workspace',
        toolset: 'coding',
      },
    }));

    const ctx = mockEngineInstances[0]?.options.toolContext as ToolContext;
    const tools = mockEngineInstances[0]?.options.tools as Array<{ name: string }>;

    expect(getExecutionToolRuntime(ctx)).not.toBeNull();
    expect(tools.some((tool) => tool.name === 'ExecutionTool')).toBe(true);
  });

  test('missing required artifacts fails the run', async () => {
    const artifactRoot = path.join(tempHome, 'artifacts');

    const session = await backend.start(makeConfig({
      runtimeContract: {
        workspaceRoot: tempHome,
        artifactRoot,
        requiredArtifacts: [{
          path: 'summary.md',
          required: true,
          format: 'md',
        }],
      },
    }));

    const events = [];
    for await (const event of session.events()) {
      events.push(event);
      if (event.kind === 'completed' || event.kind === 'failed') break;
    }

    const failed = events.find((event) => event.kind === 'failed');
    expect(failed).toBeDefined();
    if (failed?.kind === 'failed') {
      expect(failed.error.message).toContain('summary.md');
    }
  });

  test('accepts providerId native-codex on Claude Engine path', async () => {
    const nativeBackend = new ClaudeEngineAgentBackend('native-codex');
    const session = await nativeBackend.start(makeConfig({
      model: 'gpt-5.4-codex',
    }));

    expect(session.providerId).toBe('native-codex');
    expect(session.handle).toBe('native-codex-session-123');
  });

  test('cancel emits cancelled event', async () => {
    const session = await backend.start(makeConfig());

    // Cancel immediately
    await session.cancel('user requested');

    const events = [];
    for await (const event of session.events()) {
      events.push(event);
      if (
        event.kind === 'cancelled' ||
        event.kind === 'completed' ||
        event.kind === 'failed'
      )
        break;
    }

    const cancelled = events.find((e) => e.kind === 'cancelled');
    expect(cancelled).toBeDefined();
    if (cancelled?.kind === 'cancelled') {
      expect(cancelled.reason).toBe('user requested');
    }
  });
});
