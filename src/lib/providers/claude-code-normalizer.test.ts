/**
 * Phase 3: Claude Code Event Normalizer tests.
 *
 * Tests:
 * 1. Event normalization (tool_use, tool_result, assistant_text, thinking, error)
 * 2. Tool classification (file_write → file_write category, BashTool → shell, etc.)
 * 3. Result normalization (summary, changedFiles, status)
 * 4. Token usage extraction
 * 5. Mixed-event scenario (realistic Claude Code output)
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeClaudeCodeEvents,
  extractChangedFilesFromEvents,
  extractTokenUsageFromEvents,
  type ClaudeStreamEvent,
} from './claude-code-normalizer';

function makeToolUse(name: string, input: Record<string, unknown> = {}): ClaudeStreamEvent {
  return { type: 'tool_use', tool_name: name, tool_input: input };
}

function makeToolResult(result: string, isError = false): ClaudeStreamEvent {
  return { type: 'tool_result', tool_result: result, is_error: isError };
}

function makeMessage(content: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown>; thinking?: string }>, usage?: Record<string, number>): ClaudeStreamEvent {
  return {
    type: 'message',
    message: { content, usage: usage as ClaudeStreamEvent['message'] extends infer M ? M extends { usage?: infer U } ? U : never : never },
  };
}

function makeResult(text: string): ClaudeStreamEvent {
  return { type: 'result', result: text };
}

function makeError(message: string): ClaudeStreamEvent {
  return { type: 'error', error: { message } };
}

describe('claude-code-normalizer', () => {
  describe('event normalization', () => {
    it('normalizes tool_use events', () => {
      const events: ClaudeStreamEvent[] = [
        makeToolUse('FileWriteTool', { file_path: 'src/main.ts' }),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].kind).toBe('tool_use');
      expect(result.steps[0].toolCategory).toBe('file_write');
      expect(result.steps[0].toolName).toBe('FileWriteTool');
      expect(result.steps[0].affectedPaths).toEqual(['src/main.ts']);
    });

    it('normalizes tool_result events', () => {
      const events: ClaudeStreamEvent[] = [
        makeToolResult('File written successfully'),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].kind).toBe('tool_result');
      expect(result.steps[0].status).toBe('completed');
    });

    it('marks error tool_results as failed', () => {
      const events: ClaudeStreamEvent[] = [
        makeToolResult('Permission denied', true),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.steps[0].status).toBe('failed');
      expect(result.steps[0].title).toBe('Tool error');
    });

    it('normalizes assistant text from message events', () => {
      const events: ClaudeStreamEvent[] = [
        makeMessage([{ type: 'text', text: 'I will edit the file now.' }]),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].kind).toBe('assistant_text');
      expect(result.steps[0].preview).toBe('I will edit the file now.');
    });

    it('normalizes thinking blocks', () => {
      const events: ClaudeStreamEvent[] = [
        makeMessage([{ type: 'thinking', thinking: 'Let me analyze this carefully...' }]),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].kind).toBe('thinking');
    });

    it('normalizes error events', () => {
      const events: ClaudeStreamEvent[] = [
        makeError('API rate limit exceeded'),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].kind).toBe('error');
      expect(result.steps[0].status).toBe('failed');
      expect(result.status).toBe('failed');
    });
  });

  describe('tool classification', () => {
    const cases: Array<[string, string]> = [
      ['FileReadTool', 'file_read'],
      ['Read', 'file_read'],
      ['FileWriteTool', 'file_write'],
      ['Write', 'file_write'],
      ['FileEditTool', 'file_edit'],
      ['Edit', 'file_edit'],
      ['BashTool', 'shell'],
      ['Bash', 'shell'],
      ['GlobTool', 'search'],
      ['GrepTool', 'search'],
      ['WebFetchTool', 'web'],
      ['WebSearchTool', 'web'],
      ['AgentTool', 'agent'],
      ['EnterPlanModeTool', 'plan'],
      ['UnknownTool', 'other'],
    ];

    for (const [toolName, expectedCategory] of cases) {
      it(`classifies ${toolName} as ${expectedCategory}`, () => {
        const result = normalizeClaudeCodeEvents([makeToolUse(toolName)]);
        expect(result.steps[0].toolCategory).toBe(expectedCategory);
      });
    }
  });

  describe('changedFiles extraction', () => {
    it('extracts file paths from file_write and file_edit tools', () => {
      const events: ClaudeStreamEvent[] = [
        makeToolUse('FileWriteTool', { file_path: 'src/a.ts' }),
        makeToolUse('FileEditTool', { path: 'src/b.ts' }),
        makeToolUse('FileReadTool', { file_path: 'src/c.ts' }),
        makeToolUse('BashTool', {}),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('deduplicates file paths', () => {
      const events: ClaudeStreamEvent[] = [
        makeToolUse('FileWriteTool', { file_path: 'src/same.ts' }),
        makeToolUse('FileEditTool', { path: 'src/same.ts' }),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.changedFiles).toEqual(['src/same.ts']);
    });

    it('extracts from message content tool_use blocks', () => {
      const events: ClaudeStreamEvent[] = [
        makeMessage([
          { type: 'tool_use', name: 'Write', input: { file_path: 'src/new.ts' } },
        ]),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.changedFiles).toEqual(['src/new.ts']);
    });

    it('convenience function works', () => {
      const events: ClaudeStreamEvent[] = [
        makeToolUse('FileWriteTool', { file_path: 'src/x.ts' }),
      ];
      expect(extractChangedFilesFromEvents(events)).toEqual(['src/x.ts']);
    });
  });

  describe('token usage', () => {
    it('accumulates token usage from message events', () => {
      const events: ClaudeStreamEvent[] = [
        makeMessage(
          [{ type: 'text', text: 'Hello' }],
          { input_tokens: 100, output_tokens: 50 },
        ),
        makeMessage(
          [{ type: 'text', text: 'World' }],
          { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 30 },
        ),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.tokenUsage.inputTokens).toBe(300);
      expect(result.tokenUsage.outputTokens).toBe(130);
      expect(result.tokenUsage.cacheReadInputTokens).toBe(30);
    });

    it('returns zero tokens when no usage info', () => {
      const events: ClaudeStreamEvent[] = [
        makeToolUse('BashTool', {}),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.tokenUsage.inputTokens).toBe(0);
      expect(result.tokenUsage.outputTokens).toBe(0);
    });

    it('convenience function works', () => {
      const events: ClaudeStreamEvent[] = [
        makeMessage(
          [{ type: 'text', text: 'x' }],
          { input_tokens: 42, output_tokens: 7 },
        ),
      ];
      const usage = extractTokenUsageFromEvents(events);
      expect(usage.inputTokens).toBe(42);
      expect(usage.outputTokens).toBe(7);
    });
  });

  describe('result normalization', () => {
    it('uses result event text as summary', () => {
      const events: ClaudeStreamEvent[] = [
        makeMessage([{ type: 'text', text: 'intermediate' }]),
        makeResult('Final output text'),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.summary).toBe('Final output text');
      expect(result.status).toBe('completed');
    });

    it('falls back to last assistant text when no result event', () => {
      const events: ClaudeStreamEvent[] = [
        makeMessage([{ type: 'text', text: 'first message' }]),
        makeMessage([{ type: 'text', text: 'final message' }]),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.summary).toBe('final message');
    });

    it('returns failed status when errors present', () => {
      const events: ClaudeStreamEvent[] = [
        makeMessage([{ type: 'text', text: 'partial work' }]),
        makeError('Something went wrong'),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.status).toBe('failed');
    });

    it('returns default summary when no text', () => {
      const events: ClaudeStreamEvent[] = [
        makeToolUse('BashTool', {}),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.summary).toBe('Task completed');
    });
  });

  describe('liveState generation', () => {
    it('builds correct RunLiveState', () => {
      const events: ClaudeStreamEvent[] = [
        makeMessage([{ type: 'text', text: 'Starting...' }]),
        makeToolUse('FileWriteTool', { file_path: 'src/a.ts' }),
        makeToolResult('ok'),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.liveState.cascadeStatus).toBe('completed');
      expect(result.liveState.stepCount).toBe(3);
      expect(result.liveState.lastStepType).toBe('FileWriteTool');
    });

    it('reports failed cascade when errors present', () => {
      const events: ClaudeStreamEvent[] = [
        makeError('boom'),
      ];
      const result = normalizeClaudeCodeEvents(events);
      expect(result.liveState.cascadeStatus).toBe('failed');
    });
  });

  describe('realistic scenario', () => {
    it('normalizes a typical Claude Code coding session', () => {
      const events: ClaudeStreamEvent[] = [
        makeMessage(
          [{ type: 'thinking', thinking: 'I need to read the file first...' }],
          { input_tokens: 1000, output_tokens: 50 },
        ),
        makeMessage(
          [{ type: 'text', text: 'Let me read the file first.' }],
          { input_tokens: 100, output_tokens: 20 },
        ),
        makeToolUse('FileReadTool', { file_path: 'src/main.ts' }),
        makeToolResult('// existing code content...'),
        makeMessage(
          [{ type: 'text', text: 'I see the issue. Let me fix it.' }],
          { input_tokens: 200, output_tokens: 30 },
        ),
        makeToolUse('FileEditTool', { file_path: 'src/main.ts' }),
        makeToolResult('File edited successfully'),
        makeToolUse('BashTool', {}),
        makeToolResult('All tests passed'),
        makeMessage(
          [{ type: 'text', text: 'Done! I fixed the bug in src/main.ts and all tests pass.' }],
          { input_tokens: 150, output_tokens: 25 },
        ),
        makeResult('Done! I fixed the bug in src/main.ts and all tests pass.'),
      ];

      const result = normalizeClaudeCodeEvents(events);

      // Steps
      expect(result.steps.length).toBeGreaterThan(5);

      // Changed files (only file_edit, not file_read)
      expect(result.changedFiles).toEqual(['src/main.ts']);

      // Token usage
      expect(result.tokenUsage.inputTokens).toBe(1450);
      expect(result.tokenUsage.outputTokens).toBe(125);

      // Summary
      expect(result.summary).toBe('Done! I fixed the bug in src/main.ts and all tests pass.');

      // Status
      expect(result.status).toBe('completed');

      // LiveState
      expect(result.liveState.cascadeStatus).toBe('completed');
      expect(result.liveState.stepCount).toBe(result.steps.length);
    });
  });
});
