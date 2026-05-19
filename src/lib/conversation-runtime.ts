import { randomUUID } from 'crypto';

import { resolveProvider } from './providers/ai-config';
import type { LocalProviderId } from './local-provider-conversations';
import { isSupportedLocalProvider } from './local-provider-conversations';
import type { LocalConversationRecord } from './storage/gateway-db';

export interface ConversationProviderSession {
  provider: string;
  sessionHandle: string;
  updatedAt: string;
  stepCount?: number;
}

export type ConversationProviderSessions = Record<string, ConversationProviderSession>;

export type ProviderNeutralConversationRecord = LocalConversationRecord & {
  providerSessions?: ConversationProviderSessions;
};

export function buildProviderNeutralConversationId(): string {
  return `conversation-${randomUUID()}`;
}

export function resolveConversationProviderForTurn(input: {
  requestedProvider?: string | null;
  workspacePath?: string;
  fallbackProvider?: string | null;
}): string | null {
  if (input.requestedProvider?.trim()) {
    return input.requestedProvider.trim();
  }

  if (input.workspacePath) {
    return resolveProvider('execution', input.workspacePath).provider;
  }

  return input.fallbackProvider ?? null;
}

export function resolveLocalProviderForTurn(input: {
  requestedProvider?: string | null;
  workspacePath?: string;
  conversationProvider?: string | null;
  idHint?: string;
}): LocalProviderId | null {
  const provider = resolveConversationProviderForTurn({
    requestedProvider: input.requestedProvider,
    workspacePath: input.workspacePath,
    fallbackProvider: input.conversationProvider,
  });

  if (isSupportedLocalProvider(provider)) {
    return provider;
  }

  return null;
}

export function getProviderSessionHandle(
  conversation: ProviderNeutralConversationRecord | null | undefined,
  provider: string,
): string | undefined {
  const providerSession = conversation?.providerSessions?.[provider]?.sessionHandle;
  if (providerSession) {
    return providerSession;
  }

  return conversation?.provider === provider ? conversation.sessionHandle : undefined;
}

export function updateProviderSessionState(
  conversation: ProviderNeutralConversationRecord | null | undefined,
  provider: string,
  sessionHandle: string,
  stepCount?: number,
): ConversationProviderSessions {
  return {
    ...(conversation?.providerSessions ?? {}),
    [provider]: {
      provider,
      sessionHandle,
      updatedAt: new Date().toISOString(),
      ...(stepCount !== undefined ? { stepCount } : {}),
    },
  };
}
