/**
 * CLAUDE.md 文件发现和加载
 * 增强版 — 支持递归目录上溯 + @include + frontmatter + Managed 层
 * 精简自 claude-code/src/utils/claudemd.ts
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export type MemoryType = 'Managed' | 'User' | 'Project' | 'Local' | 'Rules';

export type MemoryFileInfo = {
  path: string;
  type: MemoryType;
  content: string;
  parent?: string;           // @include 来源文件
  globs?: string[];          // frontmatter 中的 glob 模式
};

export type ClaudeMdLoaderOptions = {
  workspacePath: string;
  homeDir?: string;
  cwd?: string;              // 当前工作目录（递归上溯起点）
  readFile?: (filePath: string) => Promise<string>;
  fileExists?: (filePath: string) => Promise<boolean>;
  readDir?: (dirPath: string) => Promise<string[]>;
  maxIncludeDepth?: number;   // @include 最大递归深度（默认 5）
};

// ── Constants ──────────────────────────────────────────────────────

const MAX_INCLUDE_DEPTH = 5;
const INCLUDE_PATTERN = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---/;

// ── Main loader ────────────────────────────────────────────────────

export async function loadClaudeMdFiles(
  options: ClaudeMdLoaderOptions,
): Promise<MemoryFileInfo[]> {
  const {
    workspacePath,
    homeDir = os.homedir(),
    cwd = workspacePath,
    readFile = (filePath: string) => fs.readFile(filePath, 'utf-8'),
    fileExists = async (filePath: string) => {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    },
    readDir = (dirPath: string) => fs.readdir(dirPath),
    maxIncludeDepth = MAX_INCLUDE_DEPTH,
  } = options;

  const files: MemoryFileInfo[] = [];
  const processedPaths = new Set<string>();

  const io = { readFile, fileExists, readDir };

  // ── 1. Managed (system-wide) ───────────────────────────────────
  const managedDir = '/etc/claude-code';
  await tryLoadWithIncludes(
    files, processedPaths, io,
    path.join(managedDir, 'CLAUDE.md'),
    'Managed', maxIncludeDepth,
  );
  await loadRulesDir(
    files, processedPaths, io,
    path.join(managedDir, '.claude', 'rules'),
    'Managed', maxIncludeDepth,
  );

  // ── 2. User (home directory) ───────────────────────────────────
  await tryLoadWithIncludes(
    files, processedPaths, io,
    path.join(homeDir, '.claude', 'CLAUDE.md'),
    'User', maxIncludeDepth,
  );
  await loadRulesDir(
    files, processedPaths, io,
    path.join(homeDir, '.claude', 'rules'),
    'Rules', maxIncludeDepth,
  );

  // ── 3. Recursive directory traversal (CWD → root) ─────────────
  const dirs = collectAncestorDirs(cwd);

  for (const dir of dirs) {
    // Project-level CLAUDE.md
    await tryLoadWithIncludes(
      files, processedPaths, io,
      path.join(dir, 'CLAUDE.md'),
      'Project', maxIncludeDepth,
    );

    // .claude/CLAUDE.md
    await tryLoadWithIncludes(
      files, processedPaths, io,
      path.join(dir, '.claude', 'CLAUDE.md'),
      'Project', maxIncludeDepth,
    );

    // .claude/rules/*.md
    await loadRulesDir(
      files, processedPaths, io,
      path.join(dir, '.claude', 'rules'),
      'Rules', maxIncludeDepth,
    );

    // CLAUDE.local.md (per-directory)
    await tryLoadWithIncludes(
      files, processedPaths, io,
      path.join(dir, 'CLAUDE.local.md'),
      'Local', maxIncludeDepth,
    );
  }

  return files;
}

// ── Directory traversal ────────────────────────────────────────────

/**
 * Collect directories from CWD up to filesystem root.
 * Returns them in root-first order (root → ... → CWD).
 */
export function collectAncestorDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let dir = path.resolve(cwd);

  while (true) {
    dirs.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }

  // Reverse: root first → CWD last (lower priority → higher priority)
  return dirs.reverse();
}

// ── @include resolution ────────────────────────────────────────────

/**
 * Extract @include paths from CLAUDE.md content.
 * Matches @path patterns (not inside code blocks).
 */
export function extractIncludePaths(
  content: string,
  basePath: string,
): string[] {
  const includes: string[] = [];
  const lines = content.split('\n');

  let inCodeBlock = false;

  for (const line of lines) {
    // Track fenced code blocks
    if (/^```/.test(line.trimStart())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    // Match @path patterns
    let match: RegExpExecArray | null;
    const regex = new RegExp(INCLUDE_PATTERN.source, 'g');
    while ((match = regex.exec(line)) !== null) {
      let includePath = match[1];
      // Unescape spaces
      includePath = includePath.replace(/\\ /g, ' ');
      // Skip fragment-only references like @heading
      if (includePath.startsWith('#')) continue;
      // Skip common false positives
      if (includePath.startsWith('http://') || includePath.startsWith('https://')) continue;
      if (includePath.startsWith('//')) continue;

      // Resolve relative path
      const baseDir = path.dirname(basePath);
      const resolved = includePath.startsWith('/')
        ? includePath
        : includePath.startsWith('~/')
          ? path.join(os.homedir(), includePath.slice(2))
          : path.resolve(baseDir, includePath);

      includes.push(resolved);
    }
  }

  return includes;
}

// ── Frontmatter parsing ────────────────────────────────────────────

/**
 * Extract glob patterns from YAML-like frontmatter.
 * Supports simple `globs:` list format.
 */
export function parseFrontmatterGlobs(content: string): {
  globs: string[];
  bodyContent: string;
} {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { globs: [], bodyContent: content };
  }

  const frontmatter = match[1];
  const bodyContent = content.slice(match[0].length).trimStart();

  const globs: string[] = [];

  // Simple YAML parsing for globs: list
  const globsMatch = frontmatter.match(/^globs:\s*$/m);
  if (globsMatch) {
    const afterGlobs = frontmatter.slice(
      (globsMatch.index ?? 0) + globsMatch[0].length,
    );
    const lines = afterGlobs.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        // Remove quotes
        const val = trimmed.slice(2).replace(/^["']|["']$/g, '').trim();
        if (val) globs.push(val);
      } else if (trimmed && !trimmed.startsWith('#')) {
        // Hit the next key; stop
        break;
      }
    }
  }

  // Also support inline: globs: ["*.ts", "*.md"]
  const inlineMatch = frontmatter.match(
    /^globs:\s*\[([^\]]+)\]/m,
  );
  if (inlineMatch && globs.length === 0) {
    const items = inlineMatch[1].split(',');
    for (const item of items) {
      const val = item.trim().replace(/^["']|["']$/g, '');
      if (val) globs.push(val);
    }
  }

  return { globs, bodyContent };
}

// ── Core loading helpers ───────────────────────────────────────────

type IO = {
  readFile: (filePath: string) => Promise<string>;
  fileExists: (filePath: string) => Promise<boolean>;
  readDir: (dirPath: string) => Promise<string[]>;
};

async function tryLoadWithIncludes(
  files: MemoryFileInfo[],
  processedPaths: Set<string>,
  io: IO,
  filePath: string,
  type: MemoryType,
  maxDepth: number,
  parent?: string,
  depth = 0,
): Promise<void> {
  const normalizedPath = path.resolve(filePath);

  if (processedPaths.has(normalizedPath)) return;
  if (depth > maxDepth) return;
  if (!(await safeExists(io.fileExists, normalizedPath))) return;

  processedPaths.add(normalizedPath);

  try {
    const raw = await io.readFile(normalizedPath);
    const { globs, bodyContent } = parseFrontmatterGlobs(raw);
    const content = stripHtmlComments(bodyContent);

    if (!content.trim()) return;

    const info: MemoryFileInfo = {
      path: normalizedPath,
      type,
      content,
    };
    if (parent) info.parent = parent;
    if (globs.length > 0) info.globs = globs;

    files.push(info);

    // Resolve @include references
    if (depth < maxDepth) {
      const includePaths = extractIncludePaths(content, normalizedPath);
      for (const includePath of includePaths) {
        await tryLoadWithIncludes(
          files, processedPaths, io,
          includePath, type, maxDepth,
          normalizedPath, depth + 1,
        );
      }
    }
  } catch {
    // File unreadable — skip silently
  }
}

async function loadRulesDir(
  files: MemoryFileInfo[],
  processedPaths: Set<string>,
  io: IO,
  rulesDir: string,
  type: MemoryType,
  maxDepth: number,
): Promise<void> {
  if (!(await safeExists(io.fileExists, rulesDir))) return;

  try {
    const entries = await io.readDir(rulesDir);
    const markdownFiles = entries
      .filter((entry) => entry.endsWith('.md'))
      .sort((left, right) => left.localeCompare(right));

    for (const markdownFile of markdownFiles) {
      await tryLoadWithIncludes(
        files, processedPaths, io,
        path.join(rulesDir, markdownFile),
        type, maxDepth,
      );
    }
  } catch {
    // Rules dir unreadable — skip silently
  }
}

// ── Aggregation ────────────────────────────────────────────────────

export function aggregateClaudeMdContent(
  files: MemoryFileInfo[],
  filter?: (type: MemoryType) => boolean,
): string {
  const selectedFiles = filter ? files.filter((file) => filter(file.type)) : files;

  if (selectedFiles.length === 0) {
    return '';
  }

  return selectedFiles
    .map((file) => {
      const typeLabel = getTypeLabel(file.type);
      const header = `# ${typeLabel} (${file.path})`;
      return `${header}\n\n${file.content}`;
    })
    .join('\n\n---\n\n');
}

function getTypeLabel(type: MemoryType): string {
  switch (type) {
    case 'Managed': return 'System instructions';
    case 'User': return 'User instructions';
    case 'Project': return 'Project instructions';
    case 'Local': return 'Local instructions';
    case 'Rules': return 'Rules';
  }
}

// ── Utilities ──────────────────────────────────────────────────────

export function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, '');
}

async function safeExists(
  fileExists: (filePath: string) => Promise<boolean>,
  filePath: string,
): Promise<boolean> {
  try {
    return await fileExists(filePath);
  } catch {
    return false;
  }
}