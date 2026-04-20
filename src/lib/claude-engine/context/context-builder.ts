/**
 * 上下文构建器
 * 精简自 claude-code/src/context.ts
 */

import {
  aggregateClaudeMdContent,
  loadClaudeMdFiles,
  type ClaudeMdLoaderOptions,
  type MemoryFileInfo,
} from './claudemd-loader';
import { getGitContext, type ExecFn, type GitContext } from './git-context';

export type ContextConfig = {
  workspacePath: string;
  exec: ExecFn;
  includeGit?: boolean;
  includeClaudeMd?: boolean;
  systemPromptInjection?: string;
  claudeMdOptions?: Partial<ClaudeMdLoaderOptions>;
};

export type BuiltContext = {
  systemContext: Record<string, string>;
  userContext: Record<string, string>;
  gitContext: GitContext | null;
  claudeMdFiles: MemoryFileInfo[];
};

export async function buildContext(
  config: ContextConfig,
): Promise<BuiltContext> {
  const {
    workspacePath,
    exec,
    includeGit = true,
    includeClaudeMd = true,
    systemPromptInjection,
    claudeMdOptions,
  } = config;

  const [gitContext, claudeMdFiles] = await Promise.all([
    includeGit
      ? getGitContext(workspacePath, exec)
      : Promise.resolve<GitContext | null>(null),
    includeClaudeMd
      ? loadClaudeMdFiles({
          ...claudeMdOptions,
          workspacePath,
        })
      : Promise.resolve<MemoryFileInfo[]>([]),
  ]);

  const systemContext: Record<string, string> = {
    'Current date': new Date().toISOString().split('T')[0] ?? '',
  };

  if (gitContext?.isGitRepo) {
    const parts: string[] = [];

    if (gitContext.branch) {
      parts.push(`Branch: ${gitContext.branch}`);
    }

    if (gitContext.defaultBranch) {
      parts.push(`Default branch: ${gitContext.defaultBranch}`);
    }

    if (gitContext.lastCommit) {
      parts.push(`Last commit: ${gitContext.lastCommit}`);
    }

    if (gitContext.status) {
      const changedFiles = gitContext.status.split('\n').filter(Boolean);
      parts.push(`Changed files: ${changedFiles.length}`);
    }

    if (parts.length > 0) {
      systemContext['Git status'] = parts.join('\n');
    }
  }

  if (systemPromptInjection) {
    systemContext['System prompt injection'] = systemPromptInjection;
  }

  const userContext: Record<string, string> = {};
  const claudeMdContent = aggregateClaudeMdContent(claudeMdFiles);

  if (claudeMdContent) {
    userContext['CLAUDE.md'] = claudeMdContent;
  }

  return {
    systemContext,
    userContext,
    gitContext,
    claudeMdFiles,
  };
}

export function formatContextForPrompt(ctx: BuiltContext): string {
  const sections: string[] = [];

  for (const [key, value] of Object.entries(ctx.systemContext)) {
    sections.push(`<${key}>\n${value}\n</${key}>`);
  }

  for (const [key, value] of Object.entries(ctx.userContext)) {
    sections.push(`<${key}>\n${value}\n</${key}>`);
  }

  return sections.join('\n\n');
}