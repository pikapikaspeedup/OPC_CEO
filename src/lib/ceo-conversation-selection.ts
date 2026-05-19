import type { Conversation } from './types';

const LOCAL_PROVIDER_PREFIXES = [
  'codex',
  'native-codex',
  'claude-api',
  'openai-api',
  'gemini-api',
  'grok-api',
  'custom',
];

type ConversationProviderHint = Pick<Conversation, 'id'> & {
  provider?: string | null;
  sourceKind?: string | null;
};

export function getConversationProvider(conversation: ConversationProviderHint): string | undefined {
  if (conversation.provider) {
    return conversation.provider;
  }

  if (conversation.sourceKind?.startsWith('antigravity')) {
    return 'antigravity';
  }

  for (const provider of LOCAL_PROVIDER_PREFIXES) {
    if (conversation.id.startsWith(`local-${provider}-`) || conversation.id.startsWith(`${provider}-`)) {
      return provider;
    }
  }

  return undefined;
}

export function pickDefaultCeoConversation<T extends ConversationProviderHint>(
  conversations: T[],
  executionProvider?: string | null,
): T | null {
  if (!executionProvider || executionProvider === 'antigravity') {
    return conversations[0] ?? null;
  }

  return conversations.find((conversation) => getConversationProvider(conversation) === executionProvider) ?? null;
}
