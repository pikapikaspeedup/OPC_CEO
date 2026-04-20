import { ClaudeEngine } from './claude-engine/engine/claude-engine';
import { TranscriptStore, type TranscriptEntry, type UUID } from './claude-engine/engine/transcript-store';
import type { APIContentBlock, APIMessage } from './claude-engine/api/types';
import {
  buildClaudeEngineSystemPrompt,
  createClaudeEngineToolContext,
  resolveApiBackedModelConfig,
} from './backends/claude-engine-backend';
import type { BackendRunConfig } from './backends';
import type { LocalProviderId } from './local-provider-conversations';
import { buildAssistantStep, buildUserStep } from './local-provider-conversations';
import type { Step } from './types';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

export type ApiConversationProvider =
  | 'claude-api'
  | 'openai-api'
  | 'gemini-api'
  | 'grok-api'
  | 'custom';

const API_CONVERSATION_PROVIDERS: ApiConversationProvider[] = [
  'claude-api',
  'openai-api',
  'gemini-api',
  'grok-api',
  'custom',
];

export function isApiConversationProvider(provider: LocalProviderId | null | undefined): provider is ApiConversationProvider {
  return API_CONVERSATION_PROVIDERS.includes(provider as ApiConversationProvider);
}

const globalForApiConversationRequests = globalThis as unknown as {
  __AG_API_CONVERSATION_REQUESTS__?: Map<string, AbortController>;
};
const activeRequests = globalForApiConversationRequests.__AG_API_CONVERSATION_REQUESTS__ || new Map<string, AbortController>();
if (process.env.NODE_ENV !== 'production') {
  globalForApiConversationRequests.__AG_API_CONVERSATION_REQUESTS__ = activeRequests;
}

export function buildApiConversationHandle(provider: ApiConversationProvider, sessionId: UUID): string {
  return `${provider}-${sessionId}`;
}

export function parseApiConversationHandle(handle: string): { provider: ApiConversationProvider; sessionId: UUID } | null {
  for (const provider of API_CONVERSATION_PROVIDERS) {
    const prefix = `${provider}-`;
    if (handle.startsWith(prefix)) {
      return { provider, sessionId: handle.slice(prefix.length) };
    }
  }
  return null;
}

function flattenApiMessageContent(content: APIMessage['content']): string {
  if (typeof content === 'string') return content;

  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push(block.text);
      continue;
    }
    if (block.type === 'tool_use') {
      parts.push(`[tool_use:${block.name}]`);
      continue;
    }
    if (block.type === 'tool_result') {
      const nested = typeof block.content === 'string'
        ? block.content
        : flattenApiContentBlocks(block.content);
      parts.push(`[tool_result] ${nested}`.trim());
      continue;
    }
    if (block.type === 'thinking') {
      parts.push(block.thinking);
    }
  }

  return parts.join('\n').trim();
}

function flattenApiContentBlocks(content: APIContentBlock[]): string {
  return flattenApiMessageContent(content);
}

function toConversationSteps(messages: APIMessage[]): Step[] {
  const steps: Step[] = [];
  for (const message of messages) {
    const text = flattenApiMessageContent(message.content);
    if (!text.trim()) continue;
    if (message.role === 'user') {
      steps.push(buildUserStep(text));
      continue;
    }
    steps.push(buildAssistantStep(text));
  }
  return steps;
}

function getTranscriptSessionPath(sessionId: UUID): string {
  return path.join(os.homedir(), '.claude-engine', 'sessions', `${sessionId}.jsonl`);
}

function sliceTranscriptEntries(entries: TranscriptEntry[], stepIndex: number): TranscriptEntry[] {
  if (stepIndex < 0) return [];

  const kept: TranscriptEntry[] = [];
  let retainedMessageCount = 0;
  for (const entry of entries) {
    if (entry.type === 'user' || entry.type === 'assistant') {
      if (retainedMessageCount > stepIndex) {
        break;
      }
      retainedMessageCount += 1;
    }
    kept.push(entry);
  }
  return kept;
}

function buildConversationConfig(provider: ApiConversationProvider, workspacePath: string, model?: string): BackendRunConfig {
  return {
    runId: `local-${provider}-${Date.now()}`,
    workspacePath,
    prompt: '',
    model,
    executionTarget: { kind: 'prompt' },
  };
}

export async function runApiConversationTurn(
  provider: ApiConversationProvider,
  workspacePath: string,
  prompt: string,
  model?: string,
  sessionHandle?: string,
  conversationId?: string,
): Promise<{ handle: string; content: string }> {
  const resume = sessionHandle ? parseApiConversationHandle(sessionHandle) : null;
  const controller = new AbortController();
  if (conversationId) {
    activeRequests.set(conversationId, controller);
  }
  const config = buildConversationConfig(provider, workspacePath, model);
  const engine = new ClaudeEngine({
    model: resolveApiBackedModelConfig(provider, model),
    systemPrompt: buildClaudeEngineSystemPrompt(config),
    toolContext: createClaudeEngineToolContext(workspacePath, controller.signal),
    maxTurns: 30,
    ...(resume ? { resumeSessionId: resume.sessionId } : {}),
  });

  try {
    await engine.init();
    const content = await engine.chatSimple(prompt);
    const sessionId = engine.getSessionId();
    if (!sessionId) {
      throw new Error('API conversation created no session id');
    }
    return {
      handle: buildApiConversationHandle(provider, sessionId),
      content,
    };
  } finally {
    if (conversationId) {
      activeRequests.delete(conversationId);
    }
    await engine.close();
  }
}

export async function readApiConversationSteps(handle: string): Promise<Step[]> {
  const parsed = parseApiConversationHandle(handle);
  if (!parsed) return [];

  const store = new TranscriptStore();
  try {
    const messages = await store.loadMessagesForResume(parsed.sessionId);
    return toConversationSteps(messages);
  } finally {
    await store.close();
  }
}

export function cancelApiConversationRequest(conversationId: string): boolean {
  const controller = activeRequests.get(conversationId);
  if (!controller) {
    return false;
  }
  controller.abort();
  activeRequests.delete(conversationId);
  return true;
}

export async function previewApiConversationSteps(handle: string, stepIndex: number): Promise<Step[]> {
  const steps = await readApiConversationSteps(handle);
  if (stepIndex < 0) return [];
  return steps.slice(0, stepIndex + 1);
}

export async function revertApiConversation(handle: string, stepIndex: number): Promise<Step[]> {
  const parsed = parseApiConversationHandle(handle);
  if (!parsed) return [];

  const store = new TranscriptStore();
  try {
    const session = await store.loadSession(parsed.sessionId);
    if (!session) return [];

    const keptEntries = sliceTranscriptEntries(session.entries, stepIndex);
    const filePath = getTranscriptSessionPath(parsed.sessionId);
    const content = keptEntries.map((entry) => JSON.stringify(entry)).join('\n');
    await fs.writeFile(filePath, content ? `${content}\n` : '', 'utf-8');
    const keptMessages = keptEntries
      .filter((entry) => entry.message && (entry.type === 'user' || entry.type === 'assistant'))
      .map((entry) => entry.message as APIMessage);
    return toConversationSteps(keptMessages);
  } finally {
    await store.close();
  }
}
