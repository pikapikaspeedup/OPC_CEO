import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Parse markdown to sanitised HTML.
 * Single source-of-truth — replaces per-component copies.
 */
export function renderMarkdown(text: string): string {
  try {
    const raw = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(raw);
  } catch {
    return text;
  }
}
