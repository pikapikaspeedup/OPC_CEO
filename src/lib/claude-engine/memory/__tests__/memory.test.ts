import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { buildMemoryPrompt, buildWhatNotToSave } from '../memory-prompt-builder';
import { memoryAge, memoryAgeDays, memoryFreshnessNote } from '../memory-age';
import {
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_BYTES,
  MAX_ENTRYPOINT_LINES,
  getMemoryDir,
  isMemoryPath,
  sanitizePathForDir,
  validateMemoryPath,
} from '../memory-paths';
import {
  formatMemoryManifest,
  parseFrontmatter,
  scanMemoryFiles,
} from '../memory-scanner';
import { MemoryStore } from '../memory-store';
import { MEMORY_TYPES, parseMemoryType } from '../memory-types';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeTestFile(
  dirPath: string,
  filename: string,
  content: string,
  mtimeMs?: number,
): Promise<string> {
  const filePath = path.join(dirPath, filename);
  await fs.writeFile(filePath, content, 'utf8');

  if (mtimeMs !== undefined) {
    const stamp = new Date(mtimeMs);
    await fs.utimes(filePath, stamp, stamp);
  }

  return filePath;
}

describe('memory-types', () => {
  test('parseMemoryType returns valid memory types', () => {
    for (const type of MEMORY_TYPES) {
      expect(parseMemoryType(type)).toBe(type);
    }
  });

  test('parseMemoryType returns undefined for invalid input', () => {
    expect(parseMemoryType('invalid')).toBeUndefined();
    expect(parseMemoryType(123)).toBeUndefined();
    expect(parseMemoryType(null)).toBeUndefined();
  });

  test('MEMORY_TYPES contains exactly four memory types', () => {
    expect(MEMORY_TYPES).toEqual([
      'user',
      'feedback',
      'project',
      'reference',
    ]);
  });
});

describe('memory-paths', () => {
  test('getMemoryDir returns customDir when provided', () => {
    expect(
      getMemoryDir({
        baseDir: '/base/.claude',
        projectRoot: '/workspace/project',
        customDir: '/tmp/custom-memory',
      }),
    ).toBe('/tmp/custom-memory');
  });

  test('getMemoryDir builds path from baseDir and sanitized project root', () => {
    const baseDir = '/base/.claude';
    const projectRoot = '/workspace/project';

    expect(
      getMemoryDir({
        baseDir,
        projectRoot,
      }),
    ).toBe(
      path.join(baseDir, 'projects', sanitizePathForDir(projectRoot), 'memory'),
    );
  });

  test('sanitizePathForDir replaces path separators', () => {
    expect(sanitizePathForDir('/Users/magic/cat/project')).toBe(
      'Users-magic-cat-project',
    );
  });

  test('validateMemoryPath rejects null bytes', () => {
    expect(validateMemoryPath('bad\0path.md')).toBeUndefined();
  });

  test('validateMemoryPath rejects path traversal', () => {
    expect(validateMemoryPath('../secrets.md')).toBeUndefined();
    expect(validateMemoryPath('nested/../../secrets.md')).toBeUndefined();
  });

  test('isMemoryPath detects whether a path belongs to the memory directory', () => {
    const config = {
      baseDir: '/base/.claude',
      projectRoot: '/workspace/project',
    };
    const memoryDir = getMemoryDir(config);

    expect(isMemoryPath(path.join(memoryDir, 'user.md'), config)).toBe(true);
    expect(isMemoryPath('/base/.claude/projects/other/memory/user.md', config)).toBe(
      false,
    );
  });
});

describe('memory-scanner', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await createTempDir('claude-engine-memory-scanner-');
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('scanMemoryFiles returns files sorted by mtime descending', async () => {
    const now = Date.UTC(2026, 3, 10, 0, 0, 0);

    await writeTestFile(tempDir, 'older.md', '# older', now - 3 * 86_400_000);
    await writeTestFile(tempDir, 'newer.md', '# newer', now - 86_400_000);

    const scanned = await scanMemoryFiles(tempDir);

    expect(scanned.map((entry) => entry.filename)).toEqual([
      'newer.md',
      'older.md',
    ]);
  });

  test('scanMemoryFiles parses frontmatter fields', async () => {
    await writeTestFile(
      tempDir,
      'project.md',
      [
        '---',
        'name: Build policy',
        'description: Keep CI green',
        'type: feedback',
        '---',
        '',
        'Always fix CI before merging.',
      ].join('\n'),
    );

    const scanned = await scanMemoryFiles(tempDir);

    expect(scanned).toHaveLength(1);
    expect(scanned[0]?.description).toBe('Keep CI green');
    expect(scanned[0]?.type).toBe('feedback');
  });

  test('parseFrontmatter parses standard YAML frontmatter', () => {
    expect(
      parseFrontmatter([
        '---',
        'name: Project context',
        'description: Key decision history',
        'type: project',
        '---',
        '',
        'Body starts here.',
      ]),
    ).toEqual({
      name: 'Project context',
      description: 'Key decision history',
      type: 'project',
    });
  });

  test('formatMemoryManifest returns the expected display format', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:00:00.000Z'));

    const manifest = formatMemoryManifest([
      {
        filename: 'alpha.md',
        filePath: '/tmp/alpha.md',
        mtimeMs: Date.UTC(2026, 3, 10, 0, 0, 0),
        description: 'Alpha note',
        type: 'project',
      },
    ]);

    expect(manifest).toBe('- alpha.md (type: project) — Alpha note [today]');
  });
});

describe('memory-age', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('memoryAgeDays calculates elapsed days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:00:00.000Z'));

    expect(memoryAgeDays(Date.UTC(2026, 3, 7, 12, 0, 0))).toBe(2);
  });

  test('memoryAge returns today, yesterday, or N days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:00:00.000Z'));

    expect(memoryAge(Date.UTC(2026, 3, 10, 0, 0, 0))).toBe('today');
    expect(memoryAge(Date.UTC(2026, 3, 9, 0, 0, 0))).toBe('yesterday');
    expect(memoryAge(Date.UTC(2026, 3, 7, 0, 0, 0))).toBe('3 days ago');
  });

  test('memoryFreshnessNote warns when memory is older than one day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T00:00:00.000Z'));

    expect(memoryFreshnessNote(Date.UTC(2026, 3, 8, 0, 0, 0))).toBe(
      '<system-reminder>This memory was last updated 2 days ago. Verify before relying on it.</system-reminder>',
    );
    expect(memoryFreshnessNote(Date.UTC(2026, 3, 9, 0, 0, 0))).toBe('');
  });
});

describe('memory-store', () => {
  let tempBaseDir = '';
  let store: MemoryStore;

  beforeEach(async () => {
    tempBaseDir = await createTempDir('claude-engine-memory-store-');
    store = new MemoryStore({
      pathConfig: {
        baseDir: tempBaseDir,
        projectRoot: '/workspace/project',
      },
    });
  });

  afterEach(async () => {
    if (tempBaseDir) {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    }
  });

  test('ensureDir creates the memory directory', async () => {
    await store.ensureDir();

    const stats = await fs.stat(store.getMemoryDir());
    expect(stats.isDirectory()).toBe(true);
  });

  test('write and read roundtrip a memory file', async () => {
    await store.write('user.md', 'Prefers Bun over npm.', {
      name: 'Tooling preference',
      description: 'Use Bun in this repo',
      type: 'user',
    });

    const entry = await store.read('user.md');

    expect(entry).not.toBeNull();
    expect(entry?.content).toContain('Prefers Bun over npm.');
    expect(entry?.header.description).toBe('Use Bun in this repo');
    expect(entry?.header.type).toBe('user');
  });

  test('read returns null for a missing memory file', async () => {
    await store.ensureDir();

    expect(await store.read('missing.md')).toBeNull();
  });

  test('remove deletes a memory file', async () => {
    await store.write('obsolete.md', 'Remove me');

    expect(await store.remove('obsolete.md')).toBe(true);
    expect(await store.read('obsolete.md')).toBeNull();
  });

  test('truncateEntrypoint truncates oversized content', () => {
    const raw = Array.from(
      { length: MAX_ENTRYPOINT_LINES + 25 },
      (_, index) => `line ${index} ${'x'.repeat(180)}`,
    ).join('\n');

    const truncated = store.truncateEntrypoint(raw);

    expect(truncated.wasTruncated).toBe(true);
    expect(truncated.content.split('\n').length).toBeLessThanOrEqual(
      MAX_ENTRYPOINT_LINES,
    );
    expect(Buffer.byteLength(truncated.content, 'utf8')).toBeLessThanOrEqual(
      MAX_ENTRYPOINT_BYTES,
    );
  });

  test('isValidPath rejects traversal outside the memory directory', () => {
    expect(
      store.isValidPath(path.resolve(store.getMemoryDir(), '..', 'evil.md')),
    ).toBe(false);
  });
});

describe('memory-prompt-builder', () => {
  test('buildMemoryPrompt includes memory type guidance', () => {
    const prompt = buildMemoryPrompt({
      displayName: 'project memory',
      memoryDir: '/tmp/memory',
    });

    expect(prompt).toContain('user');
    expect(prompt).toContain('feedback');
    expect(prompt).toContain('project');
    expect(prompt).toContain('reference');
    expect(prompt).toContain('/tmp/memory');
  });

  test('buildMemoryPrompt appends MEMORY.md content when requested', () => {
    const prompt = buildMemoryPrompt(
      {
        displayName: 'project memory',
        memoryDir: '/tmp/memory',
        includeContent: true,
      },
      '- [Alpha](alpha.md) - Key note',
    );

    expect(prompt).toContain(`## ${ENTRYPOINT_NAME}`);
    expect(prompt).toContain('- [Alpha](alpha.md) - Key note');
  });

  test('buildWhatNotToSave returns a non-empty list', () => {
    expect(buildWhatNotToSave().length).toBeGreaterThan(0);
  });
});