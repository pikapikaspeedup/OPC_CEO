import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Mock codex-adapter ──

const mockStartSession = vi.fn();
const mockReply = vi.fn();
const mockStart = vi.fn();

vi.mock('../bridge/codex-adapter', () => ({
  CodexMCPClient: vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: vi.fn(),
    startSession: mockStartSession,
    reply: mockReply,
  })),
}));

import { CodexExecutor } from './codex-executor';
import { getExecutor } from './index';
import type { TaskExecutor } from './types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-test-'));
  vi.clearAllMocks();
  mockStart.mockResolvedValue(undefined);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// CodexExecutor
// ---------------------------------------------------------------------------

describe('CodexExecutor', () => {
  it('implements TaskExecutor interface', () => {
    const executor = new CodexExecutor();
    expect(executor.providerId).toBe('codex');
    expect(typeof executor.executeTask).toBe('function');
    expect(typeof executor.appendMessage).toBe('function');
    expect(typeof executor.cancel).toBe('function');
    expect(typeof executor.capabilities).toBe('function');
  });

  it('capabilities returns correct values', () => {
    const executor = new CodexExecutor();
    const caps = executor.capabilities();
    expect(caps.supportsStreaming).toBe(false);
    expect(caps.supportsMultiTurn).toBe(true);
    expect(caps.supportsIdeSkills).toBe(false);
    expect(caps.supportsSandbox).toBe(true);
    expect(caps.supportsCancel).toBe(false);
    expect(caps.supportsStepWatch).toBe(false);
  });

  it('executeTask calls CodexMCPClient.startSession and returns result', async () => {
    mockStartSession.mockResolvedValue({
      threadId: 'thread-abc',
      content: 'Task completed successfully',
    });

    const executor = new CodexExecutor();
    const result = await executor.executeTask({
      workspace: tmpDir,
      prompt: 'Write a test file',
      model: 'o3',
      runId: 'run-12345678',
      roleId: 'coding-author',
    });

    expect(result.handle).toBe('thread-abc');
    expect(result.content).toBe('Task completed successfully');
    expect(result.status).toBe('completed');
    expect(result.steps).toEqual([]);
    expect(mockStartSession).toHaveBeenCalledWith(
      'Write a test file',
      expect.objectContaining({
        cwd: tmpDir,
        sandbox: 'workspace-write',
        approvalPolicy: 'never',
        model: 'o3',
      }),
    );
  });

  it('executeTask detects changed files from artifact dir', async () => {
    // Create some files in artifact dir
    const artifactDir = 'artifacts/run-1/';
    const absArtifactDir = path.join(tmpDir, artifactDir);
    fs.mkdirSync(absArtifactDir, { recursive: true });
    fs.writeFileSync(path.join(absArtifactDir, 'output.ts'), 'export const x = 1;');

    mockStartSession.mockResolvedValue({
      threadId: 'thread-def',
      content: 'Done',
    });

    const executor = new CodexExecutor();
    const result = await executor.executeTask({
      workspace: tmpDir,
      prompt: 'Do something',
      artifactDir,
    });

    expect(result.changedFiles.length).toBeGreaterThan(0);
    expect(result.changedFiles.some(f => f.includes('output.ts'))).toBe(true);
  });

  it('appendMessage calls CodexMCPClient.reply', async () => {
    // First execute to register the thread
    mockStartSession.mockResolvedValue({ threadId: 'thread-xyz', content: 'First' });
    const executor = new CodexExecutor();
    await executor.executeTask({ workspace: tmpDir, prompt: 'Start' });

    mockReply.mockResolvedValue({ threadId: 'thread-xyz', content: 'Follow-up done' });
    const result = await executor.appendMessage('thread-xyz', { prompt: 'Continue' });

    expect(result.handle).toBe('thread-xyz');
    expect(result.content).toBe('Follow-up done');
    expect(mockReply).toHaveBeenCalledWith('thread-xyz', 'Continue');
  });

  it('cancel is a no-op (does not throw)', async () => {
    const executor = new CodexExecutor();
    await expect(executor.cancel('thread-123')).resolves.not.toThrow();
  });

  it('uses baseInstructions when provided', async () => {
    mockStartSession.mockResolvedValue({ threadId: 't1', content: 'ok' });
    const executor = new CodexExecutor();

    await executor.executeTask({
      workspace: tmpDir,
      prompt: 'Do work',
      baseInstructions: 'Custom org memory',
    });

    expect(mockStartSession).toHaveBeenCalledWith(
      'Do work',
      expect.objectContaining({
        baseInstructions: 'Custom org memory',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getExecutor factory
// ---------------------------------------------------------------------------

describe('getExecutor', () => {
  it('returns CodexExecutor for "codex"', () => {
    const executor = getExecutor('codex');
    expect(executor.providerId).toBe('codex');
  });

  it('returns AntigravityExecutor for "antigravity"', () => {
    const executor = getExecutor('antigravity');
    expect(executor.providerId).toBe('antigravity');
  });

  it('rejects native-codex because the direct executor path has been removed', () => {
    expect(() => getExecutor('native-codex' as never)).toThrow('Unknown provider');
  });

  it('returns singleton instances', () => {
    const a1 = getExecutor('codex');
    const a2 = getExecutor('codex');
    expect(a1).toBe(a2);
  });

  it('throws for unknown provider', () => {
    expect(() => getExecutor('unknown' as never)).toThrow('Unknown provider');
  });
});

// ---------------------------------------------------------------------------
// Type compliance checks
// ---------------------------------------------------------------------------

describe('TaskExecutor type compliance', () => {
  it('CodexExecutor satisfies TaskExecutor', () => {
    const executor: TaskExecutor = new CodexExecutor();
    expect(executor.providerId).toBe('codex');
  });
});
