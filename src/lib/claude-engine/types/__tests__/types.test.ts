import { describe, test, expect } from 'vitest';
import type { z } from 'zod';

import {
  toolMatchesName,
  findToolByName,
  type Tool,
  type ToolContext,
  type ToolResult,
  type ValidationResult,
  type PermissionMode,
  type PermissionRule,
  type PermissionChecker,
  type PermissionAllowDecision,
  type PermissionDenyDecision,
  type PermissionAskDecision,
  type PermissionUpdate,
  type AdditionalWorkingDirectory,
} from '..';
import {
  PERMISSION_MODES,
} from '../permissions';
import {
  type UserMessage,
  type AssistantMessage,
  type ContentBlock,
  type TextBlock,
  type ToolUseBlock,
  type ToolResultBlock,
  type ToolResultContentBlock,
  type StreamEvent,
  type TokenUsage,
} from '../message';

describe('toolMatchesName', () => {
  test('matches by name', () => {
    expect(toolMatchesName({ name: 'FileRead' }, 'FileRead')).toBe(true);
  });

  test('does not match different name', () => {
    expect(toolMatchesName({ name: 'FileRead' }, 'FileWrite')).toBe(false);
  });

  test('matches by alias', () => {
    expect(
      toolMatchesName({ name: 'FileRead', aliases: ['Read', 'Cat'] }, 'Cat'),
    ).toBe(true);
  });

  test('does not match non-existent alias', () => {
    expect(
      toolMatchesName({ name: 'FileRead', aliases: ['Read'] }, 'Cat'),
    ).toBe(false);
  });

  test('handles undefined aliases', () => {
    expect(toolMatchesName({ name: 'FileRead' }, 'Read')).toBe(false);
  });
});

describe('findToolByName', () => {
  const mockTool: Tool = {
    name: 'FileRead',
    aliases: ['Read'],
    inputSchema: undefined as unknown as z.ZodType<Record<string, unknown>>,
    description: () => 'Reads a file',
    call: async () => ({ data: 'content' }),
    isEnabled: () => true,
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    maxResultSizeChars: 10000,
  };

  test('finds by name', () => {
    expect(findToolByName([mockTool], 'FileRead')).toBe(mockTool);
  });

  test('finds by alias', () => {
    expect(findToolByName([mockTool], 'Read')).toBe(mockTool);
  });

  test('returns undefined for unknown', () => {
    expect(findToolByName([mockTool], 'Unknown')).toBeUndefined();
  });

  test('returns undefined for empty tools', () => {
    expect(findToolByName([], 'FileRead')).toBeUndefined();
  });
});

describe('Message types', () => {
  test('UserMessage structure', () => {
    const msg: UserMessage = { role: 'user', content: 'hello' };
    expect(msg.role).toBe('user');
  });

  test('AssistantMessage with content blocks', () => {
    const textBlock: TextBlock = { type: 'text', text: 'hello' };
    const toolUse: ToolUseBlock = {
      type: 'tool_use',
      id: 'tu_1',
      name: 'FileRead',
      input: { path: '/test.ts' },
    };
    const msg: AssistantMessage = {
      role: 'assistant',
      content: [textBlock, toolUse],
    };
    expect(msg.role).toBe('assistant');
    expect(Array.isArray(msg.content)).toBe(true);
    expect((msg.content as ContentBlock[]).length).toBe(2);
  });

  test('ToolResultBlock', () => {
    const result: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: 'tu_1',
      content: 'file content here',
    };
    expect(result.type).toBe('tool_result');
    expect(result.is_error).toBeUndefined();
  });

  test('ToolResultBlock with error', () => {
    const result: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: 'tu_1',
      content: 'error message',
      is_error: true,
    };
    expect(result.is_error).toBe(true);
  });

  test('TokenUsage', () => {
    const usage: TokenUsage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 10,
      cache_read_input_tokens: 20,
    };
    expect(usage.input_tokens + usage.output_tokens).toBe(150);
  });
});

describe('Permission types', () => {
  test('PERMISSION_MODES contains expected modes', () => {
    expect(PERMISSION_MODES).toContain('default');
    expect(PERMISSION_MODES).toContain('acceptEdits');
    expect(PERMISSION_MODES).toContain('bypassPermissions');
    expect(PERMISSION_MODES).toContain('dontAsk');
    expect(PERMISSION_MODES).toContain('plan');
    expect(PERMISSION_MODES).toContain('auto');
    expect(PERMISSION_MODES.length).toBe(6);
  });

  test('PermissionRule structure', () => {
    const rule: PermissionRule = {
      source: 'projectSettings',
      ruleBehavior: 'allow',
      ruleValue: { toolName: 'FileRead' },
    };
    expect(rule.source).toBe('projectSettings');
    expect(rule.ruleBehavior).toBe('allow');
  });

  test('PermissionAllowDecision', () => {
    const decision: PermissionAllowDecision = {
      behavior: 'allow',
    };
    expect(decision.behavior).toBe('allow');
  });

  test('PermissionDenyDecision', () => {
    const decision: PermissionDenyDecision = {
      behavior: 'deny',
      message: 'Not allowed',
      decisionReason: { type: 'other', reason: 'test' },
    };
    expect(decision.behavior).toBe('deny');
  });

  test('PermissionAskDecision', () => {
    const decision: PermissionAskDecision = {
      behavior: 'ask',
      message: 'Allow this?',
    };
    expect(decision.behavior).toBe('ask');
  });

  test('PermissionChecker interface contract', () => {
    const checker: PermissionChecker = {
      check: () => ({
        behavior: 'allow' as const,
      }),
      getMode: () => 'default' as PermissionMode,
      setMode: () => {},
      addRule: () => {},
      getRules: () => [],
    };
    expect(checker.check('FileRead', {}).behavior).toBe('allow');
    expect(checker.getMode()).toBe('default');
  });
});

describe('StreamEvent types', () => {
  test('message_start event', () => {
    const event: StreamEvent = {
      type: 'message_start',
      message: {
        id: 'msg_1',
        model: 'claude-sonnet-4-20250514',
        role: 'assistant',
        content: [],
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    };
    expect(event.type).toBe('message_start');
    expect(event.message?.model).toBe('claude-sonnet-4-20250514');
  });

  test('content_block_delta event', () => {
    const event: StreamEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    };
    expect(event.delta?.text).toBe('Hello');
  });
});

describe('Review fixes: type safety', () => {
  test('ToolResultContentBlock only allows TextBlock', () => {
    const block: ToolResultContentBlock = { type: 'text', text: 'ok' };
    expect(block.type).toBe('text');
  });

  test('ToolResultBlock with array content uses ToolResultContentBlock', () => {
    const result: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: 'tu_1',
      content: [{ type: 'text', text: 'line1' }],
    };
    expect(Array.isArray(result.content)).toBe(true);
  });

  test('ValidationResult valid case', () => {
    const valid: ValidationResult = { valid: true };
    expect(valid.valid).toBe(true);
  });

  test('ValidationResult invalid case', () => {
    const invalid: ValidationResult = { valid: false, message: 'bad input' };
    expect(invalid.valid).toBe(false);
    expect(invalid.message).toBe('bad input');
  });

  test('PermissionUpdate structure', () => {
    const update: PermissionUpdate = {
      destination: 'project',
      rule: {
        source: 'projectSettings',
        ruleBehavior: 'allow',
        ruleValue: { toolName: 'BashTool' },
      },
    };
    expect(update.destination).toBe('project');
    expect(update.rule.ruleValue.toolName).toBe('BashTool');
  });

  test('AdditionalWorkingDirectory structure', () => {
    const dir: AdditionalWorkingDirectory = {
      path: '/extra/dir',
      source: 'cli',
    };
    expect(dir.path).toBe('/extra/dir');
    expect(dir.source).toBe('cli');
  });

  test('Tool with checkPermissions', () => {
    const tool: Tool = {
      name: 'BashTool',
      inputSchema: undefined as unknown as z.ZodType<Record<string, unknown>>,
      description: () => 'Runs bash',
      call: async () => ({ data: 'output' }),
      isEnabled: () => true,
      isReadOnly: () => false,
      isConcurrencySafe: () => false,
      maxResultSizeChars: 50000,
      checkPermissions: async () => ({ behavior: 'ask', message: 'Allow bash?' }),
      isDestructive: () => true,
    };
    expect(tool.checkPermissions).toBeDefined();
    expect(tool.isDestructive!({ command: 'rm -rf' })).toBe(true);
  });

  test('dontAsk permission mode is valid', () => {
    const mode: PermissionMode = 'dontAsk';
    expect(PERMISSION_MODES).toContain(mode);
  });

  test('PermissionChecker with dontAsk mode', () => {
    const checker: PermissionChecker = {
      check: () => ({ behavior: 'allow' as const }),
      getMode: () => 'dontAsk' as PermissionMode,
      setMode: () => {},
      addRule: () => {},
      getRules: () => [],
    };
    expect(checker.getMode()).toBe('dontAsk');
  });
});