/**
 * Inline Completion Engine for Obsidian
 *
 * Provides Copilot-like ghost text in the editor using CodeMirror 6.
 * Supports GitHub Copilot API and any OpenAI-compatible endpoint.
 *
 * Architecture:
 * - Ghost Text: CM6 ViewPlugin + Decoration.widget for transparent text overlay
 * - Provider: Abstracted completion API (Copilot / OpenAI / Ollama)
 * - Trigger: Debounced on document changes (configurable delay)
 * - Accept: Tab (full) / Right Arrow (word) / Escape (dismiss)
 */

import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
  keymap,
} from '@codemirror/view';
import { StateField, StateEffect, Prec } from '@codemirror/state';
import { requestUrl } from 'obsidian';
import { ensureFreshCopilotToken, type CopilotCredentials } from './copilot-auth';

// ── Types ──

export type CompletionProvider = 'copilot' | 'openai' | 'ollama' | 'custom';

export interface InlineCompletionConfig {
  enabled: boolean;
  provider: CompletionProvider;
  // Copilot credentials (managed externally)
  copilotCredentials?: CopilotCredentials;
  // OpenAI-compatible settings
  apiKey?: string;
  apiBaseUrl?: string;
  model?: string;
  // Behavior
  triggerDelay: number;     // ms to wait after typing (default 500)
  maxPrefixChars: number;   // chars before cursor for context (default 3000)
  maxSuffixChars: number;   // chars after cursor for context (default 1000)
  maxTokens: number;        // max tokens to generate (default 128)
  temperature: number;      // 0-1 (default 0.1)
  systemPrompt?: string;
  // Callbacks
  onCredentialsRefreshed?: (creds: CopilotCredentials) => void;
}

export type InlineCompletionMode =
  | 'yaml-frontmatter'
  | 'code-block'
  | 'task-list'
  | 'list'
  | 'heading'
  | 'blockquote'
  | 'table'
  | 'paragraph';

export const DEFAULT_INLINE_COMPLETION_SYSTEM_PROMPT = `You are a precise inline completion engine for Obsidian Markdown notes.

Complete only the missing text at the cursor.

Hard requirements:
- Return only the text to insert at the cursor, with no explanation.
- Continue seamlessly from the prefix and fit naturally into the suffix.
- Never repeat text already present before the cursor.
- Never include text that is already present after the cursor.
- Preserve the existing language, tone, tense, indentation, markdown syntax, and local writing style.
- Prefer a genuinely helpful continuation, not the shortest possible one.
- For normal prose, finish the current thought and continue into the next sentence when the topic is clear.
- For structured content, match the local unit: one heading fragment, one list item, one task item, one table cell continuation, or one code fragment.
- If the cursor is inside YAML frontmatter, output only valid YAML.
- If the cursor is inside a code block, output only code or code comments that match the block.
- If the cursor is inside a bullet list or task list, continue the current list style instead of switching formats.
- If the cursor is inside a heading, output only heading text.
- If the best completion is empty, return an empty string.`;

function isInsideFrontmatter(prefix: string): boolean {
  const lines = prefix.split('\n');
  if (lines.length === 0 || lines[0].trim() !== '---') return false;
  return !lines.slice(1).some((line) => line.trim() === '---');
}

function countFenceStarts(text: string, fence: '```' | '~~~'): number {
  const pattern = new RegExp(`(^|\\n)${fence.replace(/[`~]/g, '\\$&')}`, 'g');
  return [...text.matchAll(pattern)].length;
}

function isInsideCodeFence(prefix: string): boolean {
  return countFenceStarts(prefix, '```') % 2 === 1 || countFenceStarts(prefix, '~~~') % 2 === 1;
}

function getCurrentLineBeforeCursor(prefix: string): string {
  return prefix.split('\n').at(-1) || '';
}

function getCurrentLineAfterCursor(suffix: string): string {
  return suffix.split('\n')[0] || '';
}

export function detectInlineCompletionMode(prefix: string, suffix: string): InlineCompletionMode {
  if (isInsideFrontmatter(prefix)) return 'yaml-frontmatter';
  if (isInsideCodeFence(prefix)) return 'code-block';

  const lineBefore = getCurrentLineBeforeCursor(prefix);
  const lineAfter = getCurrentLineAfterCursor(suffix);
  const fullLine = `${lineBefore}${lineAfter}`;

  if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(lineBefore) || /^\s*[-*+]\s+\[[ xX]\]\s/.test(fullLine)) {
    return 'task-list';
  }
  if (
    /^\s*[-*+]\s+/.test(lineBefore)
    || /^\s*\d+[.)]\s+/.test(lineBefore)
    || /^\s*[-*+]\s+/.test(fullLine)
    || /^\s*\d+[.)]\s+/.test(fullLine)
  ) {
    return 'list';
  }
  if (/^\s{0,3}#{1,6}\s/.test(lineBefore) || /^\s{0,3}#{1,6}\s/.test(fullLine)) {
    return 'heading';
  }
  if (/^\s*>\s?/.test(lineBefore) || /^\s*>\s?/.test(fullLine)) {
    return 'blockquote';
  }
  if (fullLine.includes('|') && /^\s*\|?[^|]+\|/.test(fullLine)) {
    return 'table';
  }

  return 'paragraph';
}

function getModeGuidance(mode: InlineCompletionMode): string {
  switch (mode) {
    case 'yaml-frontmatter':
      return 'The cursor is inside YAML frontmatter. Continue with valid YAML only.';
    case 'code-block':
      return 'The cursor is inside a fenced code block. Continue with code only, not prose.';
    case 'task-list':
      return 'The cursor is inside a markdown task list. Preserve the checkbox style and indentation.';
    case 'list':
      return 'The cursor is inside a markdown list. Preserve the bullet or numbered list style and indentation.';
    case 'heading':
      return 'The cursor is inside a markdown heading. Output only the heading text.';
    case 'blockquote':
      return 'The cursor is inside a markdown blockquote. Preserve the quote style.';
    case 'table':
      return 'The cursor is inside a markdown table. Preserve the column structure and pipe syntax.';
    default:
      return 'The cursor is inside normal note prose. Continue naturally and concisely.';
  }
}

function shortestWindow(text: string, chars: number, fromEnd: boolean): string {
  if (text.length <= chars) return text;
  return fromEnd ? text.slice(-chars) : text.slice(0, chars);
}

function extractRecentHeadings(prefix: string, limit = 3): string[] {
  return prefix
    .split('\n')
    .filter((line) => /^\s{0,3}#{1,6}\s/.test(line))
    .slice(-limit);
}

function extractActiveParagraph(prefix: string): string {
  const lines = prefix.split('\n');
  const paragraph: string[] = [];
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (!line.trim()) break;
    paragraph.unshift(line);
    if (/^\s{0,3}#{1,6}\s/.test(line)) break;
  }
  return paragraph.join('\n');
}

export function buildInlineCompletionPrompt(
  prefix: string,
  suffix: string,
  systemPrompt = DEFAULT_INLINE_COMPLETION_SYSTEM_PROMPT,
): { system: string; user: string; mode: InlineCompletionMode } {
  const mode = detectInlineCompletionMode(prefix, suffix);
  const lineBefore = getCurrentLineBeforeCursor(prefix);
  const lineAfter = getCurrentLineAfterCursor(suffix);
  const recentHeadings = extractRecentHeadings(prefix);
  const activeParagraph = extractActiveParagraph(prefix);
  const indent = lineBefore.match(/^\s*/)?.[0].length ?? 0;

  const user = [
    `Mode: ${mode}`,
    getModeGuidance(mode),
    `Indentation before cursor: ${indent} spaces`,
    'Recent headings:',
    recentHeadings.length > 0 ? recentHeadings.join('\n') : '(none)',
    'Active paragraph before cursor:',
    activeParagraph || '(none)',
    'Current line before cursor:',
    lineBefore || '(empty line)',
    'Current line after cursor:',
    lineAfter || '(empty line)',
    'Recent context before cursor:',
    '<<<PREFIX>>>',
    prefix || '(empty prefix)',
    '<<<CURSOR>>>',
    'Upcoming context after cursor:',
    '<<<SUFFIX>>>',
    suffix || '(empty suffix)',
    'Return only the missing text that should be inserted at <<<CURSOR>>>.',
  ].join('\n');

  return {
    system: systemPrompt,
    user,
    mode,
  };
}

function overlapLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  for (let len = max; len > 0; len--) {
    if (left.slice(-len) === right.slice(0, len)) {
      return len;
    }
  }
  return 0;
}

export function normalizeInlineCompletion(raw: string, prefix: string, suffix: string): string {
  let text = raw
    .replace(/^```(?:[\w-]+)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/<CURSOR\s*\/?\s*>/gi, '')
    .trimEnd();

  const prefixTail = shortestWindow(prefix, 200, true);
  const prefixEcho = overlapLength(prefixTail, text);
  if (prefixEcho > 0) {
    text = text.slice(prefixEcho);
  }

  const suffixHead = shortestWindow(suffix, 200, false);
  const suffixEcho = overlapLength(text, suffixHead);
  if (suffixEcho > 0) {
    text = text.slice(0, -suffixEcho);
  }

  return text.trimEnd();
}

// ── Ghost Text Widget ──

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) { super(); }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'ag-ghost-text';
    span.textContent = this.text;
    return span;
  }

  eq(other: GhostTextWidget): boolean {
    return this.text === other.text;
  }
}

// ── State Effects ──

const setSuggestion = StateEffect.define<string | null>();

const suggestionField = StateField.define<{ text: string; pos: number } | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSuggestion)) {
        if (e.value === null) return null;
        return { text: e.value, pos: tr.state.selection.main.head };
      }
    }
    // Clear on any document change or cursor movement
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
});

const suggestionDecoration = EditorView.decorations.compute([suggestionField], (state) => {
  const suggestion = state.field(suggestionField);
  if (!suggestion) return Decoration.none;

  const widget = Decoration.widget({
    widget: new GhostTextWidget(suggestion.text),
    side: 1,
  });
  return Decoration.set([widget.range(suggestion.pos)]);
});

// ── Completion Request ──

let activeAbort: AbortController | null = null;

async function requestCompletion(
  config: InlineCompletionConfig,
  prefix: string,
  suffix: string,
): Promise<string | null> {
  activeAbort?.abort();
  const abort = new AbortController();
  activeAbort = abort;

  try {
    if (config.provider === 'copilot' && config.copilotCredentials) {
      return await requestCopilotCompletion(config, prefix, suffix);
    }
    if (config.provider === 'copilot' && !config.copilotCredentials) {
      console.warn('[AG-Inline] Copilot selected but no credentials');
      return null;
    }
    return await requestOpenAICompletion(config, prefix, suffix);
  } catch (e: any) {
    if (e.name === 'AbortError') return null;
    console.warn('[AG-Inline] Completion failed:', e.message, e);
    return null;
  } finally {
    if (activeAbort === abort) activeAbort = null;
  }
}

async function requestCopilotCompletion(
  config: InlineCompletionConfig,
  prefix: string,
  suffix: string,
): Promise<string | null> {
  if (!config.copilotCredentials) return null;

  // Refresh token if needed
  const creds = await ensureFreshCopilotToken(config.copilotCredentials);
  if (creds !== config.copilotCredentials) {
    config.copilotCredentials = creds;
    config.onCredentialsRefreshed?.(creds);
  }

  const url = `${creds.apiBaseUrl}/chat/completions`;
  const prompt = buildInlineCompletionPrompt(prefix, suffix, config.systemPrompt || DEFAULT_INLINE_COMPLETION_SYSTEM_PROMPT);
  const body = {
    model: config.model || 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: prompt.system,
      },
      {
        role: 'user',
        content: prompt.user,
      },
    ],
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    stream: false,
  };

  console.debug('[AG-Inline] Copilot request:', url, { model: body.model, prefixLen: prefix.length });

  // Use fetch instead of requestUrl to capture error response body
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.copilotToken}`,
      'Content-Type': 'application/json',
      'Editor-Version': 'vscode/1.96.2',
      'User-Agent': 'GitHubCopilotChat/0.22.2',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[AG-Inline] Copilot API error:', res.status, errText);
    return null;
  }

  const json = await res.json();
  const normalized = normalizeInlineCompletion(json.choices?.[0]?.message?.content?.trim() || '', prefix, suffix);
  return normalized || null;
}

async function requestOpenAICompletion(
  config: InlineCompletionConfig,
  prefix: string,
  suffix: string,
): Promise<string | null> {
  const baseUrl = config.apiBaseUrl || 'https://api.openai.com/v1';
  const model = config.model || 'gpt-4o-mini';
  const apiKey = config.apiKey;
  if (!apiKey) return null;
  const prompt = buildInlineCompletionPrompt(prefix, suffix, config.systemPrompt || DEFAULT_INLINE_COMPLETION_SYSTEM_PROMPT);

  const res = await requestUrl({
    url: `${baseUrl}/chat/completions`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: prompt.system,
        },
        {
          role: 'user',
          content: prompt.user,
        },
      ],
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      stream: false,
    }),
  });

  const json = res.json;
  const normalized = normalizeInlineCompletion(json.choices?.[0]?.message?.content?.trim() || '', prefix, suffix);
  return normalized || null;
}

// ── Keymap: Tab/RightArrow/Escape ──

function acceptFullSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(suggestionField);
  if (!suggestion) return false;

  view.dispatch({
    changes: { from: suggestion.pos, insert: suggestion.text },
    selection: { anchor: suggestion.pos + suggestion.text.length },
    effects: setSuggestion.of(null),
  });
  return true;
}

function acceptWordSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(suggestionField);
  if (!suggestion) return false;

  // Extract first word (up to next space or end)
  const match = suggestion.text.match(/^\S+\s?/);
  if (!match) return false;

  const word = match[0];
  const remaining = suggestion.text.slice(word.length);

  view.dispatch({
    changes: { from: suggestion.pos, insert: word },
    effects: setSuggestion.of(remaining || null),
    selection: { anchor: suggestion.pos + word.length },
  });
  return true;
}

function dismissSuggestion(view: EditorView): boolean {
  const suggestion = view.state.field(suggestionField);
  if (!suggestion) return false;

  view.dispatch({ effects: setSuggestion.of(null) });
  return true;
}

const inlineCompletionKeymap = Prec.highest(
  keymap.of([
    { key: 'Tab', run: acceptFullSuggestion },
    { key: 'ArrowRight', run: acceptWordSuggestion },
    { key: 'Escape', run: dismissSuggestion },
  ]),
);

// ── ViewPlugin: trigger completions on typing ──

function createInlineCompletionPlugin(getConfig: () => InlineCompletionConfig) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return ViewPlugin.fromClass(
    class {
      constructor(private view: EditorView) {}

      update(update: ViewUpdate) {
        const config = getConfig();
        if (!config.enabled) {
          return;
        }

        // Only trigger on document changes (user typing)
        if (!update.docChanged) return;

        // Clear previous debounce
        if (debounceTimer) clearTimeout(debounceTimer);

        console.debug('[AG-Inline] Doc changed, scheduling completion in', config.triggerDelay, 'ms');

        debounceTimer = setTimeout(() => {
          this.triggerCompletion(config);
        }, config.triggerDelay);
      }

      async triggerCompletion(config: InlineCompletionConfig) {
        const state = this.view.state;
        const pos = state.selection.main.head;
        const doc = state.doc.toString();

        const prefix = doc.slice(Math.max(0, pos - config.maxPrefixChars), pos);
        const suffix = doc.slice(pos, Math.min(doc.length, pos + config.maxSuffixChars));

        // Skip if prefix is too short or cursor at very start
        if (prefix.trim().length < 3) {
          console.debug('[AG-Inline] Skipped: prefix too short');
          return;
        }

        console.debug('[AG-Inline] Requesting completion...', {
          provider: config.provider,
          prefixLen: prefix.length,
          suffixLen: suffix.length,
          hasCreds: !!config.copilotCredentials,
        });

        const result = await requestCompletion(config, prefix, suffix);
        console.debug('[AG-Inline] Completion result:', result ? `"${result.slice(0, 80)}..."` : 'null');

        if (!result) return;

        // Only apply if cursor hasn't moved since we started
        if (this.view.state.selection.main.head === pos) {
          console.debug('[AG-Inline] Applying suggestion at pos', pos);
          this.view.dispatch({ effects: setSuggestion.of(result) });
        } else {
          console.debug('[AG-Inline] Cursor moved, discarding suggestion');
        }
      }

      destroy() {
        if (debounceTimer) clearTimeout(debounceTimer);
      }
    },
  );
}

// ── Public API ──

/**
 * Create CodeMirror extensions for inline completion.
 * Returns an array of extensions to register with `registerEditorExtension`.
 */
export function createInlineCompletionExtensions(
  getConfig: () => InlineCompletionConfig,
) {
  return [
    suggestionField,
    suggestionDecoration,
    createInlineCompletionPlugin(getConfig),
    inlineCompletionKeymap,
  ];
}
