import * as fs from 'fs/promises';
import * as path from 'path';

import {
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_BYTES,
  MAX_ENTRYPOINT_LINES,
  getEntrypointPath,
  getMemoryDir,
  isMemoryPath,
  type MemoryPathConfig,
  validateMemoryPath,
} from './memory-paths';
import {
  parseFrontmatter,
  scanMemoryFiles,
} from './memory-scanner';
import type {
  MemoryFrontmatter,
  MemoryHeader,
} from './memory-types';

export interface MemoryEntry {
  header: MemoryHeader;
  content: string;
}

export interface MemoryStoreOptions {
  pathConfig: MemoryPathConfig;
}

export class MemoryStore {
  private readonly pathConfig: MemoryPathConfig;

  constructor(options: MemoryStoreOptions) {
    this.pathConfig = options.pathConfig;
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.getMemoryDir(), { recursive: true });
  }

  async scan(signal?: AbortSignal): Promise<MemoryHeader[]> {
    return scanMemoryFiles(this.getMemoryDir(), signal);
  }

  async read(filename: string): Promise<MemoryEntry | null> {
    const filePath = this.resolveFilePath(filename);

    if (!filePath) {
      return null;
    }

    try {
      const [content, stats] = await Promise.all([
        fs.readFile(filePath, 'utf8'),
        fs.stat(filePath),
      ]);
      const frontmatter = parseFrontmatter(content.split(/\r?\n/).slice(0, 30));

      return {
        header: {
          filename: path.relative(this.getMemoryDir(), filePath),
          filePath,
          mtimeMs: stats.mtimeMs,
          description: frontmatter.description ?? null,
          type: frontmatter.type,
        },
        content,
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw error;
    }
  }

  async write(
    filename: string,
    content: string,
    frontmatter?: MemoryFrontmatter,
  ): Promise<void> {
    const filePath = this.requireFilePath(filename);
    const serialized = frontmatter
      ? serializeMemoryFile(content, frontmatter)
      : content;

    await this.ensureDir();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, serialized, 'utf8');
  }

  async remove(filename: string): Promise<boolean> {
    const filePath = this.resolveFilePath(filename);

    if (!filePath) {
      return false;
    }

    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if (isMissingFileError(error)) {
        return false;
      }

      throw error;
    }
  }

  async readEntrypoint(): Promise<string | null> {
    try {
      return await fs.readFile(getEntrypointPath(this.pathConfig), 'utf8');
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw error;
    }
  }

  async writeEntrypoint(content: string): Promise<void> {
    await this.ensureDir();

    const truncated = this.truncateEntrypoint(content);
    await fs.writeFile(
      getEntrypointPath(this.pathConfig),
      truncated.content,
      'utf8',
    );
  }

  truncateEntrypoint(raw: string): {
    content: string;
    wasTruncated: boolean;
  } {
    const trimmed = raw.trim();

    if (!trimmed) {
      return { content: '', wasTruncated: false };
    }

    const originalLines = trimmed.split(/\r?\n/);
    let truncated = originalLines.slice(0, MAX_ENTRYPOINT_LINES).join('\n');
    let wasTruncated = originalLines.length > MAX_ENTRYPOINT_LINES;

    if (Buffer.byteLength(trimmed, 'utf8') > MAX_ENTRYPOINT_BYTES) {
      wasTruncated = true;
      truncated = truncateByBytes(truncated, MAX_ENTRYPOINT_BYTES);
    }

    if (Buffer.byteLength(truncated, 'utf8') > MAX_ENTRYPOINT_BYTES) {
      truncated = truncateByBytes(truncated, MAX_ENTRYPOINT_BYTES);
    }

    return {
      content: truncated,
      wasTruncated,
    };
  }

  getMemoryDir(): string {
    return getMemoryDir(this.pathConfig);
  }

  isValidPath(absolutePath: string): boolean {
    return isMemoryPath(absolutePath, this.pathConfig);
  }

  private resolveFilePath(filename: string): string | null {
    const safePath = validateMemoryPath(filename);

    if (!safePath || path.isAbsolute(safePath)) {
      return null;
    }

    const absolutePath = path.resolve(this.getMemoryDir(), safePath);

    if (!this.isValidPath(absolutePath)) {
      return null;
    }

    if (path.basename(absolutePath) === ENTRYPOINT_NAME && filename !== ENTRYPOINT_NAME) {
      return null;
    }

    return absolutePath;
  }

  private requireFilePath(filename: string): string {
    const filePath = this.resolveFilePath(filename);

    if (!filePath) {
      throw new Error('Invalid memory path');
    }

    return filePath;
  }
}

function serializeMemoryFile(
  content: string,
  frontmatter: MemoryFrontmatter,
): string {
  const body = stripLeadingFrontmatter(content).trim();
  const lines = ['---'];

  if (frontmatter.name) {
    lines.push(`name: ${frontmatter.name}`);
  }

  if (frontmatter.description) {
    lines.push(`description: ${frontmatter.description}`);
  }

  if (frontmatter.type) {
    lines.push(`type: ${frontmatter.type}`);
  }

  lines.push('---', '');

  if (body) {
    lines.push(body);
  }

  return lines.join('\n');
}

function stripLeadingFrontmatter(content: string): string {
  const lines = content.split(/\r?\n/);

  if (lines[0]?.trim() !== '---') {
    return content;
  }

  for (let index = 1; index < Math.min(lines.length, 32); index += 1) {
    if (lines[index]?.trim() === '---') {
      return lines.slice(index + 1).join('\n').replace(/^\n+/, '');
    }
  }

  return content;
}

function truncateByBytes(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }

  let low = 0;
  let high = value.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);

    if (Buffer.byteLength(value.slice(0, mid), 'utf8') <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  let truncated = value.slice(0, low);
  const lastNewline = truncated.lastIndexOf('\n');

  if (lastNewline > 0) {
    truncated = truncated.slice(0, lastNewline);
  }

  return truncated;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === 'ENOENT'
  );
}