import { describe, expect, it } from 'vitest';
import type { APIMessage } from '../../api/types';
import { compactMessages, estimateTokenCount } from '../compactor';

function makeTextMsg(role: 'user' | 'assistant', text: string): APIMessage {
  return { role, content: [{ type: 'text', text }] };
}

function makeToolUseMsg(): APIMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'toolu_1', name: 'FileRead', input: { path: '/test.ts' } },
    ],
  };
}

function makeToolResultMsg(content: string): APIMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content }],
  };
}

describe('estimateTokenCount', () => {
  it('estimates string content', () => {
    const messages: APIMessage[] = [
      { role: 'user', content: 'Hello world' }, // 11 chars → ceil(11/4) = 3
    ];
    expect(estimateTokenCount(messages)).toBe(3);
  });

  it('estimates array content with text blocks', () => {
    const messages = [makeTextMsg('user', 'a'.repeat(100))]; // 100/4 = 25
    expect(estimateTokenCount(messages)).toBe(25);
  });

  it('estimates tool_use blocks', () => {
    const messages = [makeToolUseMsg()];
    const count = estimateTokenCount(messages);
    expect(count).toBeGreaterThan(0);
  });

  it('estimates tool_result blocks', () => {
    const messages = [makeToolResultMsg('result data here')];
    const count = estimateTokenCount(messages);
    expect(count).toBeGreaterThan(0);
  });

  it('sums across multiple messages', () => {
    const messages = [
      makeTextMsg('user', 'a'.repeat(80)),
      makeTextMsg('assistant', 'b'.repeat(120)),
    ];
    expect(estimateTokenCount(messages)).toBe(50); // (80+120)/4
  });

  it('handles empty messages', () => {
    expect(estimateTokenCount([])).toBe(0);
  });
});

describe('compactMessages', () => {
  it('returns unchanged when message count <= keepLastN + 1', async () => {
    const messages = [
      makeTextMsg('user', 'question'),
      makeTextMsg('assistant', 'answer'),
    ];

    const result = await compactMessages(messages, { keepLastN: 6 });

    expect(result.removedCount).toBe(0);
    expect(result.compacted).toEqual(messages);
  });

  it('compacts middle messages when exceeding threshold', async () => {
    const messages: APIMessage[] = [];
    // First message (kept)
    messages.push(makeTextMsg('user', 'Initial question'));
    // 10 middle messages (will be compacted)
    for (let i = 0; i < 10; i++) {
      messages.push(makeTextMsg('assistant', `Answer ${i}`));
      messages.push(makeTextMsg('user', `Follow-up ${i}`));
    }
    // 4 recent messages (kept)
    messages.push(makeTextMsg('user', 'Recent 1'));
    messages.push(makeTextMsg('assistant', 'Recent 2'));
    messages.push(makeTextMsg('user', 'Recent 3'));
    messages.push(makeTextMsg('assistant', 'Recent 4'));

    const result = await compactMessages(messages, { keepLastN: 4 });

    // Should have: first + summary + 4 recent = 6
    expect(result.compacted.length).toBe(6);
    expect(result.removedCount).toBeGreaterThan(0);
    // First message preserved
    expect(result.compacted[0]).toEqual(messages[0]);
    // Summary message inserted
    expect(typeof result.compacted[1].content).toBe('string');
    expect((result.compacted[1].content as string)).toContain('[Compacted context');
    // Recent messages preserved
    expect(result.compacted[2]).toEqual(messages[messages.length - 4]);
  });

  it('uses extractive summary when no API key provided', async () => {
    const messages = [
      makeTextMsg('user', 'Start'),
      makeTextMsg('assistant', 'Middle 1'),
      makeTextMsg('user', 'Middle 2'),
      makeTextMsg('assistant', 'Middle 3'),
      makeTextMsg('user', 'Recent 1'),
      makeTextMsg('assistant', 'Recent 2'),
      makeTextMsg('user', 'Recent 3'),
      makeTextMsg('assistant', 'Recent 4'),
    ];

    const result = await compactMessages(messages, { keepLastN: 4 });

    expect(result.removedCount).toBe(3); // 3 middle messages removed
    // Summary should contain extractive text
    const summaryContent = result.compacted[1].content as string;
    expect(summaryContent).toContain('Middle');
  });

  it('preserves tool_use and tool_result in extractive summary', async () => {
    const messages = [
      makeTextMsg('user', 'Start'),
      makeToolUseMsg(),
      makeToolResultMsg('file content here'),
      makeTextMsg('assistant', 'Analysis done'),
      makeTextMsg('user', 'Recent 1'),
      makeTextMsg('assistant', 'Recent 2'),
    ];

    const result = await compactMessages(messages, { keepLastN: 2 });

    expect(result.removedCount).toBe(3);
    const summaryContent = result.compacted[1].content as string;
    expect(summaryContent).toContain('tool_use: FileRead');
    expect(summaryContent).toContain('tool_result');
  });

  it('returns positive summaryTokens on compaction', async () => {
    const messages: APIMessage[] = [makeTextMsg('user', 'Start')];
    for (let i = 0; i < 10; i++) {
      messages.push(makeTextMsg('assistant', `Long answer ${i}: ${'x'.repeat(200)}`));
      messages.push(makeTextMsg('user', `Follow-up ${i}`));
    }
    messages.push(makeTextMsg('user', 'Recent 1'));
    messages.push(makeTextMsg('assistant', 'Recent 2'));

    const result = await compactMessages(messages, { keepLastN: 2 });

    expect(result.summaryTokens).toBeGreaterThan(0);
  });
});
