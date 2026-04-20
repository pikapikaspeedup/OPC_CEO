import { describe, test, expect } from 'vitest';

import { getGitContext, type ExecFn } from '../git-context';
import {
  loadClaudeMdFiles,
  aggregateClaudeMdContent,
  stripHtmlComments,
  collectAncestorDirs,
  extractIncludePaths,
  parseFrontmatterGlobs,
  type MemoryFileInfo,
} from '../claudemd-loader';
import { buildContext, formatContextForPrompt } from '../context-builder';

function createMockExec(
  responses: Record<string, { stdout: string; exitCode: number }>,
): ExecFn {
  return async (cmd: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) {
        return {
          stdout: response.stdout,
          stderr: '',
          exitCode: response.exitCode,
        };
      }
    }

    return {
      stdout: '',
      stderr: 'command not found',
      exitCode: 1,
    };
  };
}

describe('getGitContext', () => {
  test('returns non-git-repo context for non-git directory', async () => {
    const exec = createMockExec({});
    const ctx = await getGitContext('/tmp/test', exec);

    expect(ctx.isGitRepo).toBe(false);
    expect(ctx.branch).toBeNull();
  });

  test('returns full context for git repo', async () => {
    const exec = createMockExec({
      'rev-parse --is-inside-work-tree': { stdout: 'true\n', exitCode: 0 },
      'rev-parse --abbrev-ref HEAD': { stdout: 'main\n', exitCode: 0 },
      'symbolic-ref refs/remotes/origin/HEAD': {
        stdout: 'refs/remotes/origin/main\n',
        exitCode: 0,
      },
      'log -1 --format=%H %s': {
        stdout: 'abc123 Initial commit\n',
        exitCode: 0,
      },
      'status --porcelain': { stdout: 'M file.ts\nA new.ts\n', exitCode: 0 },
      'config user.name': { stdout: 'Test User\n', exitCode: 0 },
      'remote get-url origin': {
        stdout: 'https://github.com/test/repo.git\n',
        exitCode: 0,
      },
    });

    const ctx = await getGitContext('/workspace', exec);

    expect(ctx.isGitRepo).toBe(true);
    expect(ctx.branch).toBe('main');
    expect(ctx.defaultBranch).toBe('main');
    expect(ctx.lastCommit).toBe('abc123 Initial commit');
    expect(ctx.status).toBe('M file.ts\nA new.ts');
    expect(ctx.userName).toBe('Test User');
    expect(ctx.remoteUrl).toBe('https://github.com/test/repo.git');
  });

  test('handles partial git info gracefully', async () => {
    const exec = createMockExec({
      'rev-parse --is-inside-work-tree': { stdout: 'true\n', exitCode: 0 },
      'rev-parse --abbrev-ref HEAD': { stdout: 'feature/x\n', exitCode: 0 },
      'rev-parse --verify main': { stdout: 'abc\n', exitCode: 0 },
    });

    const ctx = await getGitContext('/workspace', exec);

    expect(ctx.isGitRepo).toBe(true);
    expect(ctx.branch).toBe('feature/x');
    expect(ctx.defaultBranch).toBe('main');
    expect(ctx.remoteUrl).toBeNull();
  });
});

describe('loadClaudeMdFiles', () => {
  test('loads project CLAUDE.md', async () => {
    const mockFs: Record<string, string> = {
      '/workspace/CLAUDE.md': '# Project Rules\nBe concise.',
    };

    const files = await loadClaudeMdFiles({
      workspacePath: '/workspace',
      homeDir: '/nonexistent-home',
      readFile: async (filePath) => {
        if (mockFs[filePath]) {
          return mockFs[filePath];
        }

        throw new Error('ENOENT');
      },
      fileExists: async (filePath) => filePath in mockFs,
      readDir: async () => [],
    });

    expect(files.length).toBe(1);
    expect(files[0].type).toBe('Project');
    expect(files[0].content).toContain('Be concise');
  });

  test('loads multiple levels in order', async () => {
    const mockFs: Record<string, string> = {
      '/home/.claude/CLAUDE.md': 'User level',
      '/workspace/CLAUDE.md': 'Project level',
      '/workspace/CLAUDE.local.md': 'Local level',
    };

    const files = await loadClaudeMdFiles({
      workspacePath: '/workspace',
      homeDir: '/home',
      readFile: async (filePath) => {
        if (mockFs[filePath]) {
          return mockFs[filePath];
        }

        throw new Error('ENOENT');
      },
      fileExists: async (filePath) => filePath in mockFs,
      readDir: async () => [],
    });

    expect(files.length).toBe(3);
    expect(files[0].type).toBe('User');
    expect(files[1].type).toBe('Project');
    expect(files[2].type).toBe('Local');
  });

  test('loads rules directory', async () => {
    const mockFs: Record<string, string> = {
      '/workspace/.claude/rules': '',
      '/workspace/.claude/rules/a-rule.md': 'Rule A',
      '/workspace/.claude/rules/b-rule.md': 'Rule B',
    };

    const files = await loadClaudeMdFiles({
      workspacePath: '/workspace',
      homeDir: '/nonexistent',
      readFile: async (filePath) => {
        if (mockFs[filePath] !== undefined) {
          return mockFs[filePath];
        }

        throw new Error('ENOENT');
      },
      fileExists: async (filePath) => filePath in mockFs,
      readDir: async (dirPath) => {
        if (dirPath === '/workspace/.claude/rules') {
          return ['a-rule.md', 'b-rule.md', 'README.txt'];
        }

        return [];
      },
    });

    expect(files.length).toBe(2);
    expect(files[0].type).toBe('Rules');
    expect(files[1].type).toBe('Rules');
    expect(files[0].content).toBe('Rule A');
    expect(files[1].content).toBe('Rule B');
  });

  test('skips empty files', async () => {
    const files = await loadClaudeMdFiles({
      workspacePath: '/workspace',
      homeDir: '/home',
      readFile: async () => '   \n  ',
      fileExists: async (filePath) => filePath.endsWith('CLAUDE.md'),
      readDir: async () => [],
    });

    expect(files.length).toBe(0);
  });

  test('skips unreadable files gracefully', async () => {
    const files = await loadClaudeMdFiles({
      workspacePath: '/workspace',
      homeDir: '/home',
      readFile: async () => {
        throw new Error('Permission denied');
      },
      fileExists: async () => true,
      readDir: async () => [],
    });

    expect(files.length).toBe(0);
  });
});

describe('aggregateClaudeMdContent', () => {
  const files: MemoryFileInfo[] = [
    { path: '/home/.claude/CLAUDE.md', type: 'User', content: 'User rules' },
    {
      path: '/workspace/CLAUDE.md',
      type: 'Project',
      content: 'Project rules',
    },
    {
      path: '/workspace/CLAUDE.local.md',
      type: 'Local',
      content: 'Local rules',
    },
  ];

  test('aggregates all files', () => {
    const result = aggregateClaudeMdContent(files);

    expect(result).toContain('User rules');
    expect(result).toContain('Project rules');
    expect(result).toContain('Local rules');
  });

  test('filters by type', () => {
    const result = aggregateClaudeMdContent(files, (type) => type === 'Project');

    expect(result).toContain('Project rules');
    expect(result).not.toContain('User rules');
    expect(result).not.toContain('Local rules');
  });

  test('returns empty string for no files', () => {
    expect(aggregateClaudeMdContent([])).toBe('');
  });
});

describe('stripHtmlComments', () => {
  test('strips single comment', () => {
    expect(stripHtmlComments('before <!-- comment --> after')).toBe(
      'before  after',
    );
  });

  test('strips multiline comment', () => {
    const input = 'start\n<!-- multi\nline\ncomment -->end';

    expect(stripHtmlComments(input)).toBe('start\nend');
  });

  test('preserves content without comments', () => {
    expect(stripHtmlComments('no comments here')).toBe('no comments here');
  });
});

describe('buildContext', () => {
  test('builds full context with git and CLAUDE.md', async () => {
    const exec = createMockExec({
      'rev-parse --is-inside-work-tree': { stdout: 'true\n', exitCode: 0 },
      'rev-parse --abbrev-ref HEAD': { stdout: 'main\n', exitCode: 0 },
      'symbolic-ref refs/remotes/origin/HEAD': {
        stdout: 'refs/remotes/origin/main\n',
        exitCode: 0,
      },
      'log -1 --format=%H %s': { stdout: 'abc123 feat: init\n', exitCode: 0 },
      'status --porcelain': { stdout: '', exitCode: 0 },
      'config user.name': { stdout: 'Dev\n', exitCode: 0 },
      'remote get-url origin': {
        stdout: 'https://github.com/t/r.git\n',
        exitCode: 0,
      },
    });

    const ctx = await buildContext({
      workspacePath: '/workspace',
      exec,
      claudeMdOptions: {
        homeDir: '/nonexistent',
        readFile: async (filePath) => {
          if (filePath === '/workspace/CLAUDE.md') {
            return 'Be helpful';
          }

          throw new Error('ENOENT');
        },
        fileExists: async (filePath) => filePath === '/workspace/CLAUDE.md',
        readDir: async () => [],
      },
    });

    expect(ctx.systemContext['Current date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ctx.systemContext['Git status']).toContain('Branch: main');
    expect(ctx.userContext['CLAUDE.md']).toContain('Be helpful');
    expect(ctx.gitContext?.isGitRepo).toBe(true);
    expect(ctx.claudeMdFiles.length).toBe(1);
  });

  test('builds context without git', async () => {
    const exec = createMockExec({});
    const ctx = await buildContext({
      workspacePath: '/workspace',
      exec,
      includeGit: false,
      includeClaudeMd: false,
    });

    expect(ctx.gitContext).toBeNull();
    expect(ctx.claudeMdFiles).toEqual([]);
    expect(ctx.systemContext['Current date']).toBeDefined();
    expect(ctx.systemContext['Git status']).toBeUndefined();
  });

  test('includes system prompt injection', async () => {
    const exec = createMockExec({});
    const ctx = await buildContext({
      workspacePath: '/workspace',
      exec,
      includeGit: false,
      includeClaudeMd: false,
      systemPromptInjection: 'Custom injection',
    });

    expect(ctx.systemContext['System prompt injection']).toBe(
      'Custom injection',
    );
  });
});

describe('formatContextForPrompt', () => {
  test('formats context as XML-like sections', () => {
    const result = formatContextForPrompt({
      systemContext: {
        'Current date': '2026-04-10',
        'Git status': 'Branch: main',
      },
      userContext: { 'CLAUDE.md': 'Be helpful' },
      gitContext: null,
      claudeMdFiles: [],
    });

    expect(result).toContain('<Current date>');
    expect(result).toContain('2026-04-10');
    expect(result).toContain('</Current date>');
    expect(result).toContain('<Git status>');
    expect(result).toContain('Branch: main');
    expect(result).toContain('<CLAUDE.md>');
    expect(result).toContain('Be helpful');
  });
});

// ─── New: collectAncestorDirs ───────────────────────────────────────

describe('collectAncestorDirs', () => {
  test('collects dirs from cwd to root', () => {
    const dirs = collectAncestorDirs('/a/b/c');
    expect(dirs[0]).toBe('/');
    expect(dirs[1]).toBe('/a');
    expect(dirs[2]).toBe('/a/b');
    expect(dirs[3]).toBe('/a/b/c');
    expect(dirs.length).toBe(4);
  });

  test('root dir returns single element', () => {
    const dirs = collectAncestorDirs('/');
    expect(dirs).toEqual(['/']);
  });
});

// ─── New: extractIncludePaths ───────────────────────────────────────

describe('extractIncludePaths', () => {
  test('extracts @path references', () => {
    const content = 'Load @./config.md for settings\nAlso @docs/rules.md';
    const paths = extractIncludePaths(content, '/workspace/CLAUDE.md');
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('config.md');
    expect(paths[1]).toContain('rules.md');
  });

  test('skips @paths inside code blocks', () => {
    const content = '```\n@should-skip.md\n```\nOutside @include.md';
    const paths = extractIncludePaths(content, '/workspace/CLAUDE.md');
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('include.md');
  });

  test('skips fragment refs (#heading)', () => {
    const content = 'See @#section-name for details';
    const paths = extractIncludePaths(content, '/workspace/CLAUDE.md');
    expect(paths).toHaveLength(0);
  });

  test('skips http URLs', () => {
    const content = 'Visit @https://example.com and @http://other.com';
    const paths = extractIncludePaths(content, '/workspace/CLAUDE.md');
    expect(paths).toHaveLength(0);
  });

  test('resolves paths relative to base file', () => {
    const content = '@../sibling.md';
    const paths = extractIncludePaths(content, '/workspace/sub/CLAUDE.md');
    expect(paths).toHaveLength(1);
    expect(paths[0]).toBe('/workspace/sibling.md');
  });

  test('handles escaped spaces', () => {
    const content = '@my\\ file.md';
    const paths = extractIncludePaths(content, '/workspace/CLAUDE.md');
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('my file.md');
  });

  test('resolves absolute paths', () => {
    const content = '@/etc/claude/rule.md';
    const paths = extractIncludePaths(content, '/workspace/CLAUDE.md');
    expect(paths).toEqual(['/etc/claude/rule.md']);
  });

  test('resolves ~ paths', () => {
    const content = '@~/my-rules.md';
    const paths = extractIncludePaths(content, '/workspace/CLAUDE.md');
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/my-rules\.md$/);
  });
});

// ─── New: parseFrontmatterGlobs ─────────────────────────────────────

describe('parseFrontmatterGlobs', () => {
  test('extracts globs from YAML frontmatter (list)', () => {
    const content = `---\nglobs:\n  - "*.ts"\n  - "src/**/*.tsx"\n---\n# Rules\nBe concise.`;
    const { globs, bodyContent } = parseFrontmatterGlobs(content);
    expect(globs).toEqual(['*.ts', 'src/**/*.tsx']);
    expect(bodyContent).toContain('# Rules');
    expect(bodyContent).not.toContain('---');
  });

  test('extracts globs from inline syntax', () => {
    const content = '---\nglobs: ["*.py", "*.md"]\n---\nContent';
    const { globs, bodyContent } = parseFrontmatterGlobs(content);
    expect(globs).toEqual(['*.py', '*.md']);
    expect(bodyContent).toBe('Content');
  });

  test('returns empty globs when no frontmatter', () => {
    const content = '# Just a normal file\nNo frontmatter here.';
    const { globs, bodyContent } = parseFrontmatterGlobs(content);
    expect(globs).toEqual([]);
    expect(bodyContent).toBe(content);
  });

  test('returns empty globs when no globs key', () => {
    const content = '---\ntitle: Test\nauthor: Dev\n---\nBody';
    const { globs, bodyContent } = parseFrontmatterGlobs(content);
    expect(globs).toEqual([]);
    expect(bodyContent).toBe('Body');
  });
});

// ─── New: @include recursive loading ────────────────────────────────

describe('loadClaudeMdFiles with @include', () => {
  test('resolves @include references', async () => {
    const mockFs: Record<string, string> = {
      '/workspace/CLAUDE.md': 'Load @./extra-rules.md for more.',
      '/workspace/extra-rules.md': 'Extra rule: be brief.',
    };

    const files = await loadClaudeMdFiles({
      workspacePath: '/workspace',
      cwd: '/workspace',
      homeDir: '/nonexistent',
      readFile: async (p) => {
        if (mockFs[p]) return mockFs[p];
        throw new Error('ENOENT');
      },
      fileExists: async (p) => p in mockFs,
      readDir: async () => [],
    });

    const paths = files.map((f) => f.path);
    expect(paths).toContain('/workspace/CLAUDE.md');
    expect(paths).toContain('/workspace/extra-rules.md');
    
    const extra = files.find((f) => f.path === '/workspace/extra-rules.md');
    expect(extra?.parent).toBe('/workspace/CLAUDE.md');
  });

  test('stops at maxIncludeDepth', async () => {
    // Chain: A -> B -> C -> D (depth 3 includes)
    const mockFs: Record<string, string> = {
      '/workspace/CLAUDE.md': '@./b.md',
      '/workspace/b.md': '@./c.md',
      '/workspace/c.md': '@./d.md',
      '/workspace/d.md': 'Final',
    };

    const files = await loadClaudeMdFiles({
      workspacePath: '/workspace',
      cwd: '/workspace',
      homeDir: '/nonexistent',
      readFile: async (p) => {
        if (mockFs[p]) return mockFs[p];
        throw new Error('ENOENT');
      },
      fileExists: async (p) => p in mockFs,
      readDir: async () => [],
      maxIncludeDepth: 2,
    });

    // depth 0: CLAUDE.md, depth 1: b.md, depth 2: c.md (can't include beyond)
    const paths = files.map((f) => f.path);
    expect(paths).toContain('/workspace/CLAUDE.md');
    expect(paths).toContain('/workspace/b.md');
    expect(paths).toContain('/workspace/c.md');
    // d.md should NOT be loaded (depth 3 > maxIncludeDepth 2)
    expect(paths).not.toContain('/workspace/d.md');
  });

  test('handles circular @include references', async () => {
    const mockFs: Record<string, string> = {
      '/workspace/CLAUDE.md': '@./b.md',
      '/workspace/b.md': '@./CLAUDE.md',  // circular
    };

    const files = await loadClaudeMdFiles({
      workspacePath: '/workspace',
      cwd: '/workspace',
      homeDir: '/nonexistent',
      readFile: async (p) => {
        if (mockFs[p]) return mockFs[p];
        throw new Error('ENOENT');
      },
      fileExists: async (p) => p in mockFs,
      readDir: async () => [],
    });

    // Should load both but not loop infinitely
    expect(files.length).toBe(2);
  });
});

// ─── New: recursive directory traversal ─────────────────────────────

describe('loadClaudeMdFiles with directory traversal', () => {
  test('loads CLAUDE.md from parent directories', async () => {
    const mockFs: Record<string, string> = {
      '/project/CLAUDE.md': 'Project root rules',
      '/project/src/CLAUDE.md': 'Source rules',
    };

    const files = await loadClaudeMdFiles({
      workspacePath: '/project/src',
      cwd: '/project/src',
      homeDir: '/nonexistent',
      readFile: async (p) => {
        if (mockFs[p]) return mockFs[p];
        throw new Error('ENOENT');
      },
      fileExists: async (p) => p in mockFs,
      readDir: async () => [],
    });

    const paths = files.map((f) => f.path);
    expect(paths).toContain('/project/CLAUDE.md');
    expect(paths).toContain('/project/src/CLAUDE.md');

    // Root-first order: /project before /project/src
    const rootIdx = paths.indexOf('/project/CLAUDE.md');
    const srcIdx = paths.indexOf('/project/src/CLAUDE.md');
    expect(rootIdx).toBeLessThan(srcIdx);
  });
});

// ─── New: frontmatter in loaded files ───────────────────────────────

describe('loadClaudeMdFiles with frontmatter', () => {
  test('parses frontmatter globs', async () => {
    const mockFs: Record<string, string> = {
      '/workspace/CLAUDE.md': '---\nglobs:\n  - "*.ts"\n---\n# TypeScript rules\nUse strict mode.',
    };

    const files = await loadClaudeMdFiles({
      workspacePath: '/workspace',
      cwd: '/workspace',
      homeDir: '/nonexistent',
      readFile: async (p) => {
        if (mockFs[p]) return mockFs[p];
        throw new Error('ENOENT');
      },
      fileExists: async (p) => p in mockFs,
      readDir: async () => [],
    });

    expect(files).toHaveLength(1);
    expect(files[0].globs).toEqual(['*.ts']);
    expect(files[0].content).toContain('Use strict mode');
    expect(files[0].content).not.toContain('---');
  });
});