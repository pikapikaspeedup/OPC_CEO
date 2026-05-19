import { describe, expect, it } from 'vitest';

import { getConversationProvider, pickDefaultCeoConversation } from './ceo-conversation-selection';

describe('CEO conversation selection', () => {
  it('infers Antigravity from imported projection source kind', () => {
    expect(getConversationProvider({
      id: 'cascade-1',
      sourceKind: 'antigravity-live',
    })).toBe('antigravity');
  });

  it('prefers the configured execution provider over a newer Antigravity thread', () => {
    const conversations = [
      { id: 'cascade-latest', sourceKind: 'antigravity-live' },
      { id: 'local-native-codex-older' },
    ];

    expect(pickDefaultCeoConversation(conversations, 'native-codex')?.id).toBe('local-native-codex-older');
  });

  it('returns no default thread when the configured provider has no CEO conversation yet', () => {
    const conversations = [
      { id: 'cascade-latest', sourceKind: 'antigravity-live' },
    ];

    expect(pickDefaultCeoConversation(conversations, 'native-codex')).toBeNull();
  });
});
