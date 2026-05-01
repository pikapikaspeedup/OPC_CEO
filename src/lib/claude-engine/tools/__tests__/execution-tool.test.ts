import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '../../types';

const {
  mockGetExecutor,
  mockGetProviderInventory,
  mockCodexExecutor,
  mockClaudeCodeExecutor,
} = vi.hoisted(() => ({
  mockGetExecutor: vi.fn(),
  mockGetProviderInventory: vi.fn(),
  mockCodexExecutor: {
    executeTask: vi.fn(),
    appendMessage: vi.fn(),
    cancel: vi.fn(),
    capabilities: vi.fn(() => ({
      supportsStreaming: false,
      supportsMultiTurn: true,
      supportsIdeSkills: false,
      supportsSandbox: true,
      supportsCancel: false,
      supportsStepWatch: false,
    })),
  },
  mockClaudeCodeExecutor: {
    executeTask: vi.fn(),
    appendMessage: vi.fn(),
    cancel: vi.fn(),
    capabilities: vi.fn(() => ({
      supportsStreaming: false,
      supportsMultiTurn: true,
      supportsIdeSkills: false,
      supportsSandbox: false,
      supportsCancel: true,
      supportsStepWatch: false,
    })),
  },
}));

vi.mock('../../../providers', () => ({
  getExecutor: mockGetExecutor,
}));

vi.mock('../../../providers/provider-inventory', () => ({
  getProviderInventory: mockGetProviderInventory,
}));

import {
  bindExecutionToolRuntime,
  createDefaultExecutionToolRuntime,
  executionTool,
  getExecutionToolRuntime,
} from '../execution-tool';

function createContext(workspacePath = '/workspace'): ToolContext {
  return {
    workspacePath,
    abortSignal: new AbortController().signal,
    readFile: async () => '',
    writeFile: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
}

describe('ExecutionTool', () => {
  beforeEach(() => {
    mockGetExecutor.mockImplementation((provider: string) => {
      if (provider === 'codex') return mockCodexExecutor;
      if (provider === 'claude-code') return mockClaudeCodeExecutor;
      throw new Error(`Unexpected executor request: ${provider}`);
    });
    mockGetProviderInventory.mockReturnValue({
      anthropic: { set: false },
      openai: { set: false },
      gemini: { set: false },
      grok: { set: false },
      providers: {
        codex: { installed: true },
        nativeCodex: { installed: true, loggedIn: true, authFilePath: '/tmp/auth.json' },
        claudeCode: { installed: true, loginDetected: true, command: 'claude', installSource: 'global' },
      },
    });
    mockCodexExecutor.executeTask.mockReset();
    mockCodexExecutor.appendMessage.mockReset();
    mockClaudeCodeExecutor.executeTask.mockReset();
    mockClaudeCodeExecutor.appendMessage.mockReset();
  });

  it('lists available execution tools through the unified tool contract', async () => {
    const context = createContext();
    bindExecutionToolRuntime(context, createDefaultExecutionToolRuntime());

    const result = await executionTool.call({ action: 'list' }, context);
    const parsed = JSON.parse(result.data) as {
      tools: Array<{ id: string; available: boolean; supportsMultiTurn: boolean }>;
    };

    expect(parsed.tools).toEqual([
      { id: 'codex', label: 'Codex CLI', available: true, supportsMultiTurn: true },
      { id: 'claude-code', label: 'Claude Code CLI', available: true, supportsMultiTurn: true },
    ]);
    expect(getExecutionToolRuntime(context)).not.toBeNull();
  });

  it('starts a new execution tool run with executeTask', async () => {
    mockCodexExecutor.executeTask.mockResolvedValue({
      handle: 'codex-thread-1',
      content: 'patched files',
      steps: [],
      changedFiles: ['src/app.ts'],
      status: 'completed',
    });

    const context = createContext('/repo');
    bindExecutionToolRuntime(context, createDefaultExecutionToolRuntime());

    const result = await executionTool.call(
      {
        action: 'run',
        tool: 'codex',
        prompt: 'fix the failing test',
        workingDirectory: 'packages/app',
        model: 'o4-mini',
      },
      context,
    );

    expect(mockCodexExecutor.executeTask).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/repo/packages/app',
      prompt: 'fix the failing test',
      model: 'o4-mini',
    }));
    expect(JSON.parse(result.data)).toMatchObject({
      tool: 'codex',
      handle: 'codex-thread-1',
      mode: 'multi-turn',
      status: 'completed',
      changedFiles: ['src/app.ts'],
    });
  });

  it('continues an existing execution tool session with appendMessage', async () => {
    mockClaudeCodeExecutor.appendMessage.mockResolvedValue({
      handle: 'claude-session-2',
      content: 'continued work',
      steps: [],
      changedFiles: ['src/feature.ts'],
      status: 'completed',
    });

    const context = createContext('/repo');
    bindExecutionToolRuntime(context, createDefaultExecutionToolRuntime());

    const result = await executionTool.call(
      {
        action: 'run',
        tool: 'claude-code',
        prompt: 'continue the refactor',
        sessionHandle: 'claude-session-1',
      },
      context,
    );

    expect(mockClaudeCodeExecutor.appendMessage).toHaveBeenCalledWith(
      'claude-session-1',
      expect.objectContaining({
        prompt: 'continue the refactor',
        workspace: '/repo',
      }),
    );
    expect(JSON.parse(result.data)).toMatchObject({
      tool: 'claude-code',
      handle: 'claude-session-2',
      mode: 'multi-turn',
      status: 'completed',
    });
  });
});
