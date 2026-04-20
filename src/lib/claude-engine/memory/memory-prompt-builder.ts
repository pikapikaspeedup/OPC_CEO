import { ENTRYPOINT_NAME } from './memory-paths';

export interface MemoryPromptOptions {
  displayName: string;
  memoryDir: string;
  includeContent?: boolean;
  extraGuidelines?: string[];
}

export function buildMemoryPrompt(
  options: MemoryPromptOptions,
  entrypointContent?: string,
): string {
  const lines: string[] = [
    `# ${options.displayName}`,
    '',
    `You have a persistent, file-based memory directory at ${options.memoryDir}.`,
    'Use it to preserve durable context that will remain useful in future conversations.',
    '',
    '## Types of memory',
    ...buildMemoryTypeGuidance(),
    '',
    '## What not to save',
    ...buildWhatNotToSave(),
    '',
    '## When to access memories',
    '- Read memory when the user references prior conversations or asks you to recall something.',
    '- Re-check current code or docs before trusting stale memory as ground truth.',
    '- Remove or update memories that turn out to be outdated or wrong.',
    '',
    '## Memory directory',
    `- Store memory files under ${options.memoryDir}.`,
    `- Use ${ENTRYPOINT_NAME} as the index for saved memories, not as a place for long-form content.`,
  ];

  if (options.extraGuidelines && options.extraGuidelines.length > 0) {
    lines.push('', '## Extra guidelines', ...options.extraGuidelines);
  }

  if (options.includeContent && entrypointContent?.trim()) {
    lines.push('', `## ${ENTRYPOINT_NAME}`, '', entrypointContent.trim());
  }

  return lines.join('\n');
}

export function buildMemoryTypeGuidance(): string[] {
  return [
    '- user: stable facts about the user, their role, goals, preferences, and level of knowledge.',
    '- feedback: durable guidance on how to work with the user or project, including corrections and validated preferences.',
    '- project: ongoing decisions, deadlines, incidents, and context that is not derivable from the repository itself.',
    '- reference: pointers to external dashboards, trackers, docs, or systems that are useful to revisit later.',
  ];
}

export function buildWhatNotToSave(): string[] {
  return [
    '- Code structure, file paths, and architecture that can be re-derived from the repository.',
    '- Git history, recent diffs, or who changed what.',
    '- Temporary task state that only matters inside the current conversation.',
    '- Content already documented in CLAUDE.md or other durable project docs.',
  ];
}