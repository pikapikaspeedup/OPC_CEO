import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DOMPurify — it requires a DOM; in Node we verify it's called correctly
const sanitizeMock = vi.fn((html: string) => html);
vi.mock('dompurify', () => ({
  default: { sanitize: (...args: unknown[]) => sanitizeMock(...(args as [string])) },
}));

// marked works fine in Node
import { renderMarkdown } from './render-markdown';

beforeEach(() => {
  sanitizeMock.mockClear();
  // Default: pass-through
  sanitizeMock.mockImplementation((html: string) => html);
});

describe('renderMarkdown', () => {
  it('converts markdown to HTML', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
  });

  it('converts headings', () => {
    const html = renderMarkdown('# Title');
    expect(html).toContain('<h1>Title</h1>');
  });

  it('converts inline code', () => {
    expect(renderMarkdown('`code`')).toContain('<code>code</code>');
  });

  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('preserves safe HTML elements', () => {
    const html = renderMarkdown('<em>emphasis</em>');
    expect(html).toContain('<em>emphasis</em>');
  });

  // Verify sanitize is called on every render
  it('passes parsed HTML through DOMPurify.sanitize', () => {
    renderMarkdown('hello');
    expect(sanitizeMock).toHaveBeenCalledTimes(1);
    // The argument should be parsed HTML, not raw markdown
    expect(sanitizeMock.mock.calls[0][0]).toContain('<p>hello</p>');
  });

  it('returns sanitized output (strips dangerous content)', () => {
    // Simulate DOMPurify stripping a script tag
    sanitizeMock.mockImplementation((html: string) =>
      html.replace(/<script[\s\S]*?<\/script>/gi, ''),
    );
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain('<script');
  });

  it('strips event handlers via DOMPurify', () => {
    sanitizeMock.mockImplementation((html: string) =>
      html.replace(/\s+on\w+="[^"]*"/gi, ''),
    );
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });
});
