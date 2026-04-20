import type { AgentRunState } from './agents/group-types';
import { readRunHistory } from './agents/run-history';
import { getCodexConversation } from './providers/codex-executor';
import { getNativeCodexConversation } from './providers/native-codex-executor';
import {
  buildConversationStepsFromMessages,
  type LocalProviderId,
} from './local-provider-conversations';
import type { Step } from './types';

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function buildStepsFromTranscriptMessages(messages: TranscriptMessage[]): Step[] {
  return buildConversationStepsFromMessages(messages);
}

export function readTranscriptFromRunHistory(
  run: Pick<AgentRunState, 'runId' | 'prompt'> | null | undefined,
  handle?: string | null,
): TranscriptMessage[] | null {
  if (!run) return null;
  const history = readRunHistory(run.runId);
  if (history.length === 0) return null;

  const messages: TranscriptMessage[] = [];
  let firstUserInjected = false;

  for (const entry of history) {
    if (handle && entry.sessionHandle && entry.sessionHandle !== handle) {
      continue;
    }
    if (entry.eventType !== 'conversation.message.user' && entry.eventType !== 'conversation.message.assistant') {
      continue;
    }

    const content = typeof entry.details.content === 'string' ? entry.details.content : '';
    if (!content.trim()) continue;

    if (entry.eventType === 'conversation.message.user') {
      messages.push({
        role: 'user',
        content: !firstUserInjected && run.prompt ? run.prompt : content,
      });
      firstUserInjected = true;
      continue;
    }

    messages.push({
      role: 'assistant',
      content,
    });
  }

  return messages.length > 0 ? messages : null;
}

export function readLocalProviderTranscriptMessages(
  provider: LocalProviderId,
  handle: string,
  run?: Pick<AgentRunState, 'runId' | 'prompt'> | null,
): TranscriptMessage[] | null {
  if (provider === 'native-codex') {
    const messages = getNativeCodexConversation(handle);
    if (messages?.length) return messages;
  }

  if (provider === 'codex') {
    const messages = getCodexConversation(handle);
    if (messages?.length) return messages;
  }

  return readTranscriptFromRunHistory(run, handle);
}
