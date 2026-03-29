import { describe, expect, it } from 'vitest';
import {
  buildInlineCompletionPrompt,
  detectInlineCompletionMode,
  normalizeInlineCompletion,
} from '../inline-completion';

describe('detectInlineCompletionMode', () => {
  it('detects yaml frontmatter', () => {
    expect(detectInlineCompletionMode('---\ntitle: Demo', '\n---\nbody')).toBe('yaml-frontmatter');
  });

  it('detects fenced code blocks', () => {
    expect(detectInlineCompletionMode('```ts\nconst total = ', '\n```')).toBe('code-block');
  });

  it('detects task lists and headings', () => {
    expect(detectInlineCompletionMode('- [ ] Finish ', '',)).toBe('task-list');
    expect(detectInlineCompletionMode('## Product ', '',)).toBe('heading');
  });
});

describe('buildInlineCompletionPrompt', () => {
  it('builds a structured prompt with mode and cursor context', () => {
    const prompt = buildInlineCompletionPrompt('## Product Stra', 'tegy\n\nNext line');
    expect(prompt.mode).toBe('heading');
    expect(prompt.user).toContain('Mode: heading');
    expect(prompt.user).toContain('Current line before cursor:');
    expect(prompt.user).toContain('Current line after cursor:');
    expect(prompt.user).toContain('<<<PREFIX>>>');
    expect(prompt.user).toContain('<<<SUFFIX>>>');
  });
});

describe('normalizeInlineCompletion', () => {
  it('strips echoed prefix and overlapping suffix text', () => {
    const normalized = normalizeInlineCompletion('world and beyond', 'Hello world', ' and beyond tomorrow');
    expect(normalized).toBe('');
  });

  it('removes markdown fences and cursor markers', () => {
    const normalized = normalizeInlineCompletion('```markdown\nnew text<CURSOR/>\n```', 'prefix', 'suffix');
    expect(normalized).toBe('new text');
  });
});