import * as path from 'path';

export interface MemoryPathConfig {
  baseDir: string;
  projectRoot: string;
  customDir?: string;
}

export const ENTRYPOINT_NAME = 'MEMORY.md';
export const MAX_ENTRYPOINT_LINES = 200;
export const MAX_ENTRYPOINT_BYTES = 25_000;

export function getMemoryDir(config: MemoryPathConfig): string {
  const customDir = validateMemoryPath(config.customDir);

  if (customDir) {
    return customDir;
  }

  return path.join(
    config.baseDir,
    'projects',
    sanitizePathForDir(config.projectRoot),
    'memory',
  );
}

export function getEntrypointPath(config: MemoryPathConfig): string {
  return path.join(getMemoryDir(config), ENTRYPOINT_NAME);
}

export function isMemoryPath(
  absolutePath: string,
  config: MemoryPathConfig,
): boolean {
  const candidate = validateMemoryPath(absolutePath);

  if (!candidate || !path.isAbsolute(candidate)) {
    return false;
  }

  const resolvedPath = path.resolve(candidate);
  const memoryDir = path.resolve(getMemoryDir(config));

  return (
    resolvedPath === memoryDir ||
    resolvedPath.startsWith(`${memoryDir}${path.sep}`)
  );
}

export function sanitizePathForDir(rawPath: string): string {
  const normalized = rawPath
    .normalize('NFC')
    .replace(/^~[\\/]+/, '')
    .replace(/^[\\/]+/, '')
    .replace(/^([A-Za-z]):/, '$1');

  const sanitized = normalized
    .replace(/[\\/]+/g, '-')
    .replace(/:+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized || 'root';
}

export function validateMemoryPath(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  if (raw.includes('\0')) {
    return undefined;
  }

  if (raw.startsWith('\\\\') || raw.startsWith('//')) {
    return undefined;
  }

  const traversalPattern = /(^|[\\/])\.\.([\\/]|$)/;

  if (traversalPattern.test(raw)) {
    return undefined;
  }

  const normalized = path.normalize(raw).normalize('NFC');

  if (traversalPattern.test(normalized)) {
    return undefined;
  }

  return normalized;
}