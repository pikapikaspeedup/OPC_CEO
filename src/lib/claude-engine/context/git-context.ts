/**
 * Git 上下文提取
 * 精简自 claude-code/src/utils/git.ts
 */

import type { ExecResult } from '../types';

export type GitContext = {
  isGitRepo: boolean;
  branch: string | null;
  defaultBranch: string | null;
  lastCommit: string | null;
  status: string | null;
  userName: string | null;
  remoteUrl: string | null;
};

export type ExecFn = (
  cmd: string,
  opts?: { cwd?: string },
) => Promise<ExecResult>;

const EMPTY_GIT_CONTEXT: GitContext = {
  isGitRepo: false,
  branch: null,
  defaultBranch: null,
  lastCommit: null,
  status: null,
  userName: null,
  remoteUrl: null,
};

export async function getGitContext(
  workspacePath: string,
  exec: ExecFn,
): Promise<GitContext> {
  const isGitRepo = await checkIsGitRepo(workspacePath, exec);

  if (!isGitRepo) {
    return { ...EMPTY_GIT_CONTEXT };
  }

  const [branch, defaultBranch, lastCommit, status, userName, remoteUrl] =
    await Promise.all([
      execGitSafe(exec, workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD']),
      getDefaultBranch(exec, workspacePath),
      execGitSafe(exec, workspacePath, ['log', '-1', '--format=%H %s']),
      execGitSafe(exec, workspacePath, ['status', '--porcelain']),
      execGitSafe(exec, workspacePath, ['config', 'user.name']),
      execGitSafe(exec, workspacePath, ['remote', 'get-url', 'origin']),
    ]);

  return {
    isGitRepo: true,
    branch,
    defaultBranch,
    lastCommit,
    status,
    userName,
    remoteUrl,
  };
}

async function checkIsGitRepo(cwd: string, exec: ExecFn): Promise<boolean> {
  try {
    const result = await exec('git rev-parse --is-inside-work-tree', { cwd });

    return result.exitCode === 0 && result.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function execGitSafe(
  exec: ExecFn,
  cwd: string,
  args: string[],
): Promise<string | null> {
  try {
    const result = await exec(`git ${args.join(' ')}`, { cwd });

    if (result.exitCode !== 0) {
      return null;
    }

    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getDefaultBranch(exec: ExecFn, cwd: string): Promise<string | null> {
  const remoteHead = await execGitSafe(exec, cwd, [
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
  ]);

  if (remoteHead) {
    return remoteHead.replace('refs/remotes/origin/', '');
  }

  for (const name of ['main', 'master']) {
    try {
      const result = await exec(`git rev-parse --verify ${name}`, { cwd });

      if (result.exitCode === 0) {
        return name;
      }
    } catch {
      continue;
    }
  }

  return null;
}