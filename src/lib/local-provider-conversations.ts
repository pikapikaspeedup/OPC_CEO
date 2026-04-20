import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import type { Step } from './types';

export type LocalProviderId =
  | 'codex'
  | 'native-codex'
  | 'claude-api'
  | 'openai-api'
  | 'gemini-api'
  | 'grok-api'
  | 'custom';

const LOCAL_PROVIDER_IDS: LocalProviderId[] = [
  'codex',
  'native-codex',
  'claude-api',
  'openai-api',
  'gemini-api',
  'grok-api',
  'custom',
];

const CONVERSATIONS_DIR = path.join(os.homedir(), '.gemini', 'antigravity', 'conversations');

function ensureConversationsDir() {
  fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
}

export function buildUserStep(prompt: string): Step {
  return {
    type: 'CORTEX_STEP_TYPE_USER_INPUT',
    status: 'CORTEX_STEP_STATUS_DONE',
    userInput: {
      items: [{ text: prompt }],
      media: [],
    },
  };
}

export function buildAssistantStep(content: string): Step {
  return {
    type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
    status: 'CORTEX_STEP_STATUS_DONE',
    plannerResponse: {
      response: content,
    },
  };
}

export function buildConversationStepsFromMessages(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): Step[] {
  const steps: Step[] = [];
  for (const message of messages) {
    const content = message.content?.trim();
    if (!content) continue;
    steps.push(
      message.role === 'user'
        ? buildUserStep(content)
        : buildAssistantStep(content),
    );
  }
  return steps;
}

function normalizeLegacySteps(rawSteps: unknown[]): Step[] {
  const normalized: Step[] = [];
  for (const raw of rawSteps) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.type === 'string') {
      normalized.push(record as unknown as Step);
      continue;
    }

    const assistantMessage = record.assistantMessage;
    const prompt = typeof assistantMessage === 'object' && assistantMessage
      ? (assistantMessage as { prompt?: { text?: string } }).prompt?.text
      : undefined;
    if (typeof prompt === 'string' && prompt.trim()) {
      normalized.push(buildUserStep(prompt));
      continue;
    }

    const response = typeof assistantMessage === 'object' && assistantMessage
      ? (assistantMessage as { response?: { text?: string } }).response?.text
      : undefined;
    if (typeof response === 'string') {
      normalized.push(buildAssistantStep(response));
    }
  }
  return normalized;
}

export function isSupportedLocalProvider(provider: string | null | undefined): provider is LocalProviderId {
  return LOCAL_PROVIDER_IDS.includes(provider as LocalProviderId);
}

export function buildLocalProviderConversationId(provider: LocalProviderId): string {
  return `local-${provider}-${randomUUID()}`;
}

export function isLocalProviderConversationId(id: string): boolean {
  return LOCAL_PROVIDER_IDS.some((provider) => (
    id.startsWith(`local-${provider}-`) || id.startsWith(`${provider}-`)
  ));
}

export function inferLocalProviderFromConversation(id: string, provider?: string | null): LocalProviderId | null {
  if (isSupportedLocalProvider(provider)) return provider;
  for (const candidate of LOCAL_PROVIDER_IDS) {
    if (id.startsWith(`local-${candidate}-`) || id.startsWith(`${candidate}-`)) {
      return candidate;
    }
  }
  return null;
}

function getTranscriptPath(conversationId: string): string {
  ensureConversationsDir();
  return path.join(CONVERSATIONS_DIR, `${conversationId}.local.json`);
}

function getLegacyCodexTranscriptPath(conversationId: string): string {
  ensureConversationsDir();
  return path.join(CONVERSATIONS_DIR, `${conversationId}.codex.json`);
}

export function readLocalProviderConversationSteps(conversationId: string): Step[] {
  const transcriptPath = getTranscriptPath(conversationId);
  if (fs.existsSync(transcriptPath)) {
    try {
      const steps = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
      if (Array.isArray(steps)) return normalizeLegacySteps(steps);
    } catch {
      return [];
    }
  }

  const legacyPath = getLegacyCodexTranscriptPath(conversationId);
  if (fs.existsSync(legacyPath)) {
    try {
      const steps = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
      if (Array.isArray(steps)) return normalizeLegacySteps(steps);
    } catch {
      return [];
    }
  }

  return [];
}

export function writeLocalProviderConversationSteps(conversationId: string, steps: Step[]): Step[] {
  ensureConversationsDir();
  fs.writeFileSync(getTranscriptPath(conversationId), JSON.stringify(steps, null, 2));
  return steps;
}

export function appendLocalProviderConversationTurn(conversationId: string, prompt: string, response: string): Step[] {
  const nextSteps = [
    ...readLocalProviderConversationSteps(conversationId),
    buildUserStep(prompt),
    buildAssistantStep(response),
  ];
  return writeLocalProviderConversationSteps(conversationId, nextSteps);
}

export function previewLocalProviderConversationSteps(conversationId: string, stepIndex: number): Step[] {
  const steps = readLocalProviderConversationSteps(conversationId);
  if (stepIndex < 0) return [];
  return steps.slice(0, stepIndex + 1);
}

export function revertLocalProviderConversationSteps(conversationId: string, stepIndex: number): Step[] {
  return writeLocalProviderConversationSteps(
    conversationId,
    previewLocalProviderConversationSteps(conversationId, stepIndex),
  );
}
