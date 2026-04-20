import { z } from 'zod';
import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { Tool, ToolResult } from '../types';

const DEFAULT_SESSIONS_DIR = join(homedir(), '.claude-engine', 'sessions');

const inputSchema = z.object({
  query: z.string().describe('Search query — matches against message text content'),
  sessionId: z.string().optional().describe('Optional: limit search to a specific session ID'),
  limit: z.number().optional().default(20).describe('Max results to return (default: 20)'),
});

type Input = z.infer<typeof inputSchema>;

type SearchHit = {
  sessionId: string;
  timestamp: string;
  role: 'user' | 'assistant';
  snippet: string;
  matchContext: string;
};

/**
 * Extract text content from an API message.
 */
function extractText(message: { role: string; content: unknown }): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((b: Record<string, unknown>) => b.type === 'text' && typeof b.text === 'string')
      .map((b: Record<string, unknown>) => b.text as string)
      .join('\n');
  }
  return '';
}

/**
 * Build a snippet around the match for context.
 */
function buildSnippet(text: string, queryLower: string, contextChars = 120): string {
  const idx = text.toLowerCase().indexOf(queryLower);
  if (idx === -1) return text.slice(0, contextChars * 2);
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + queryLower.length + contextChars);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = `...${snippet}`;
  if (end < text.length) snippet = `${snippet}...`;
  return snippet;
}

async function searchSessions(input: Input): Promise<ToolResult> {
  const sessionsDir = DEFAULT_SESSIONS_DIR;
  const queryLower = input.query.toLowerCase();
  const limit = input.limit ?? 20;
  const hits: SearchHit[] = [];

  try {
    let files: string[];
    if (input.sessionId) {
      files = [`${input.sessionId}.jsonl`];
    } else {
      files = (await readdir(sessionsDir)).filter(f => f.endsWith('.jsonl'));
    }

    for (const file of files) {
      if (hits.length >= limit) break;
      const filePath = join(sessionsDir, file);
      const sessionId = basename(file, '.jsonl');

      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);

        for (const line of lines) {
          if (hits.length >= limit) break;
          try {
            const entry = JSON.parse(line);
            if (entry.type !== 'user' && entry.type !== 'assistant') continue;
            if (!entry.message) continue;

            const text = extractText(entry.message);
            if (!text) continue;

            if (text.toLowerCase().includes(queryLower)) {
              hits.push({
                sessionId,
                timestamp: entry.timestamp ?? '',
                role: entry.type as 'user' | 'assistant',
                snippet: buildSnippet(text, queryLower),
                matchContext: `${entry.type} message at ${entry.timestamp ?? 'unknown time'}`,
              });
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
  } catch (error) {
    return {
      data: `No sessions directory found at ${sessionsDir}. No search results.`,
    };
  }

  if (hits.length === 0) {
    return {
      data: `No results found for query "${input.query}" across ${input.sessionId ? '1 session' : 'all sessions'}.`,
    };
  }

  const formatted = hits.map((h, i) =>
    `[${i + 1}] Session: ${h.sessionId.slice(0, 8)}... | ${h.role} | ${h.timestamp}\n    ${h.snippet}`
  ).join('\n\n');

  return {
    data: `Found ${hits.length} result(s) for "${input.query}":\n\n${formatted}`,
  };
}

export const sessionSearchTool: Tool = {
  name: 'SessionSearchTool',
  description: () => 'Search across all past conversation sessions for relevant messages. Useful for finding previously discussed topics, decisions, or code patterns.',
  aliases: ['session_search'],
  inputSchema,
  isEnabled: () => true,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,
  maxResultSizeChars: 24_000,
  call: async (input: Input) => searchSessions(input),
};
