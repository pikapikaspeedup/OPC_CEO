import * as fs from 'fs/promises';
import * as path from 'path';

import { ENTRYPOINT_NAME } from './memory-paths';
import { memoryAge } from './memory-age';
import {
  parseMemoryType,
  type MemoryFrontmatter,
  type MemoryHeader,
} from './memory-types';

const MAX_FILES = 200;
const FRONTMATTER_LINES = 30;

export async function scanMemoryFiles(
  memoryDir: string,
  signal?: AbortSignal,
): Promise<MemoryHeader[]> {
  if (signal?.aborted) {
    return [];
  }

  try {
    const entries = await fs.readdir(memoryDir, { withFileTypes: true });
    const markdownFiles = entries.filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.md') &&
        entry.name !== ENTRYPOINT_NAME,
    );

    const headers = await Promise.all(
      markdownFiles.map(async (entry) => {
        if (signal?.aborted) {
          return null;
        }

        const filePath = path.join(memoryDir, entry.name);
        const [content, stats] = await Promise.all([
          fs.readFile(filePath, 'utf8'),
          fs.stat(filePath),
        ]);
        const frontmatter = parseFrontmatter(
          content.split(/\r?\n/).slice(0, FRONTMATTER_LINES),
        );

        return {
          filename: entry.name,
          filePath,
          mtimeMs: stats.mtimeMs,
          description: frontmatter.description ?? null,
          type: frontmatter.type,
        } satisfies MemoryHeader;
      }),
    );

    return headers
      .filter((header): header is MemoryHeader => header !== null)
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, MAX_FILES);
  } catch {
    return [];
  }
}

export function parseFrontmatter(lines: string[]): MemoryFrontmatter {
  if (lines[0]?.trim() !== '---') {
    return {};
  }

  const frontmatter: MemoryFrontmatter = {};

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim();

    if (!line) {
      continue;
    }

    if (line === '---') {
      break;
    }

    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);

    if (!match) {
      continue;
    }

    const key = match[1];
    const rawValue = stripYamlQuotes(match[2]?.trim() ?? '');

    if (!rawValue) {
      continue;
    }

    if (key === 'name') {
      frontmatter.name = rawValue;
      continue;
    }

    if (key === 'description') {
      frontmatter.description = rawValue;
      continue;
    }

    if (key === 'type') {
      const parsedType = parseMemoryType(rawValue);

      if (parsedType) {
        frontmatter.type = parsedType;
      }
    }
  }

  return frontmatter;
}

export function formatMemoryManifest(memories: MemoryHeader[]): string {
  return memories
    .map((memory) => {
      const typeLabel = memory.type ? ` (type: ${memory.type})` : '';
      const descriptionLabel = memory.description
        ? ` — ${memory.description}`
        : '';

      return `- ${memory.filename}${typeLabel}${descriptionLabel} [${memoryAge(memory.mtimeMs)}]`;
    })
    .join('\n');
}

function stripYamlQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}