import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const execFileSyncMock = vi.fn(() => 'codex-cli 0.128.0');

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    pid?: number;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 4242;
  proc.kill = vi.fn();
  return proc;
}

describe('codex exec adapter', () => {
  afterEach(() => {
    spawnMock.mockReset();
    execFileSyncMock.mockClear();
    vi.resetModules();
  });

  it('pipes the prompt over stdin instead of embedding the full prompt in argv', async () => {
    const proc = createMockProcess();
    let stdinPayload = '';
    proc.stdin.on('data', (chunk) => {
      stdinPayload += chunk.toString();
    });
    spawnMock.mockReturnValue(proc);

    const { codexExec } = await import('./codex-adapter');
    const promise = codexExec('Reply with exactly OK', {
      cwd: '/tmp/platform-worktree',
      model: 'gpt-5.4',
      sandbox: 'workspace-write',
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      ['exec', '--cd', '/tmp/platform-worktree', '--sandbox', 'workspace-write', '--model', 'gpt-5.4', '-'],
      expect.objectContaining({
        cwd: '/tmp/platform-worktree',
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );

    proc.stdout.write('OK');
    proc.emit('close', 0);

    await expect(promise).resolves.toBe('OK');
    expect(stdinPayload).toBe('Reply with exactly OK');
  });

  it('returns a cancellable handle for one-shot exec', async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const { startCodexExec } = await import('./codex-adapter');
    const handle = startCodexExec('Reply with exactly OK', {
      cwd: '/tmp/platform-worktree',
    });

    expect(handle.pid).toBe(4242);
    handle.cancel('cancelled_by_user');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    proc.emit('close', 0);
    await expect(handle.completion).resolves.toBe('');
  });
});
