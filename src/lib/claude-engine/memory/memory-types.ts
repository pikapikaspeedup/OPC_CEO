export const MEMORY_TYPES = [
  'user',
  'feedback',
  'project',
  'reference',
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }

  return MEMORY_TYPES.find((type) => type === raw);
}

export interface MemoryHeader {
  filename: string;
  filePath: string;
  mtimeMs: number;
  description: string | null;
  type: MemoryType | undefined;
}

export interface MemoryFrontmatter {
  name?: string;
  description?: string;
  type?: MemoryType;
}