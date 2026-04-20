import { describe, expect, it } from 'vitest';

import { buildConversationErrorDisplay } from './conversation-error';

describe('buildConversationErrorDisplay', () => {
  it('extracts user-facing and technical details from structured conversation errors', () => {
    const display = buildConversationErrorDisplay({
      shouldShowUser: true,
      error: {
        userErrorMessage: 'Our servers are experiencing high traffic right now, please try again in a minute.',
        modelErrorMessage: 'UNAVAILABLE (code 503): No capacity available for model gemini-3-flash-agent on the server',
        shortError: 'UNAVAILABLE (code 503): No capacity available for model gemini-3-flash-agent on the server',
        fullError: 'HTTP 503 Service Unavailable\nTraceID: 0xa6e8f6e971ec72a',
        errorCode: 503,
        details: '{"error":{"status":"UNAVAILABLE"}}',
        rpcErrorDetails: ['{"reason":"MODEL_CAPACITY_EXHAUSTED"}'],
      },
    });

    expect(display.title).toBe('Our servers are experiencing high traffic right now, please try again in a minute.');
    expect(display.summary).toBe('UNAVAILABLE (code 503): No capacity available for model gemini-3-flash-agent on the server');
    expect(display.code).toBe('503');
    expect(display.technicalDetails).toContain('HTTP 503 Service Unavailable');
    expect(display.technicalDetails).toContain('MODEL_CAPACITY_EXHAUSTED');
  });

  it('falls back to legacy flat error messages', () => {
    const display = buildConversationErrorDisplay({
      message: 'Module not found',
    });

    expect(display).toEqual({
      title: 'Module not found',
      summary: undefined,
      code: undefined,
      technicalDetails: undefined,
    });
  });
});