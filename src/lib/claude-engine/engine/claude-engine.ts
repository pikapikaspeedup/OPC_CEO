import type { APIContentBlock, APIMessage, ModelConfig, TokenUsage } from '../api/types';
import { UsageTracker } from '../api/usage';
import type { Tool, ToolContext } from '../types';
import { createDefaultRegistry, ToolRegistry } from '../tools/registry';
import { MemoryStore } from '../memory/memory-store';
import { buildMemoryPrompt } from '../memory/memory-prompt-builder';
import { scanMemoryFiles, formatMemoryManifest } from '../memory/memory-scanner';

import { queryLoop } from './query-loop';
import type { EngineEvent } from './types';
import { TranscriptStore, type TranscriptStoreConfig, type UUID } from './transcript-store';
import { SkillStore } from './skill-store';
import {
  attachDepartmentRuntimeContext,
  type DepartmentRuntimePolicy,
} from './tool-executor';

export type MemoryConfig = {
  /** MemoryStore instance to use */
  store: MemoryStore;
  /** Automatically inject MEMORY.md + manifest into context (default: true) */
  autoInject?: boolean;
  /** Include file manifest in user context (default: true) */
  includeManifest?: boolean;
  /** Display name for memory section header */
  displayName?: string;
};

export type ClaudeEngineOptions = {
  model: ModelConfig;
  systemPrompt?: string;
  tools?: Tool[];
  toolContext: ToolContext;
  departmentRuntime?: DepartmentRuntimePolicy;
  toolset?: string;
  maxTurns?: number;
  maxTokenBudget?: number;
  /** Max estimated context tokens before triggering auto-compact */
  maxContextTokens?: number;
  /** Model config for compaction summarization (defaults to Haiku) */
  compactModel?: ModelConfig;
  /** Max output truncation retries */
  maxContinuationRetries?: number;
  /** Transcript persistence config. Set { disabled: true } to disable. */
  transcript?: TranscriptStoreConfig;
  /** Session ID for resuming a previous session */
  resumeSessionId?: UUID;
  /** Memory system configuration */
  memory?: MemoryConfig;
};

export class ClaudeEngine {
  private registry: ToolRegistry;
  private usageTracker: UsageTracker;
  private conversationMessages: APIMessage[] = [];
  private transcriptStore: TranscriptStore;
  private sessionId: UUID | null = null;
  private lastEntryUuid: UUID | null = null;

  constructor(private options: ClaudeEngineOptions) {
    this.registry = options.tools
      ? createRegistry(options.tools)
      : createDefaultRegistry();
    this.usageTracker = new UsageTracker();
    this.transcriptStore = new TranscriptStore(options.transcript);
    if (options.departmentRuntime) {
      attachDepartmentRuntimeContext(
        this.options.toolContext,
        options.departmentRuntime,
      );
    }
  }

  /**
   * Initialize the engine. If resumeSessionId is set, load previous messages.
   */
  async init(): Promise<void> {
    if (this.options.resumeSessionId) {
      const messages = await this.transcriptStore.loadMessagesForResume(
        this.options.resumeSessionId,
      );
      this.conversationMessages = messages;
      this.sessionId = this.options.resumeSessionId;
    }

    if (!this.sessionId) {
      this.sessionId = await this.transcriptStore.createSession({
        model: this.options.model.model,
        provider: this.options.model.provider ?? 'anthropic',
      });
    }
  }

  async *chat(userMessage: string): AsyncGenerator<EngineEvent> {
    // Ensure session is initialized
    if (!this.sessionId) {
      await this.init();
    }

    // Build memory context (mechanics prompt + content block)
    const memoryContext = await this.buildMemoryContext();

    // Merge system prompt: original + memory mechanics
    let effectiveSystemPrompt = this.options.systemPrompt ?? '';
    if (memoryContext.mechanicsPrompt) {
      effectiveSystemPrompt = effectiveSystemPrompt
        ? `${effectiveSystemPrompt}\n\n${memoryContext.mechanicsPrompt}`
        : memoryContext.mechanicsPrompt;
    }

    // Inject skills summary into system prompt
    try {
      const skillStore = new SkillStore(this.options.toolContext.workspacePath);
      const skillsSummary = await skillStore.buildSkillsSummary();
      if (skillsSummary) {
        effectiveSystemPrompt = effectiveSystemPrompt
          ? `${effectiveSystemPrompt}\n\n${skillsSummary}`
          : skillsSummary;
      }
    } catch { /* graceful degradation */ }

    const userApiMessage: APIMessage = {
      role: 'user',
      content: userMessage,
    };
    this.conversationMessages.push(userApiMessage);

    // Persist user message
    this.lastEntryUuid = await this.transcriptStore.appendMessage(
      this.sessionId!,
      userApiMessage,
      this.lastEntryUuid,
    );

    // Inject memory content as a system-reminder before user messages
    // Only inject on first turn (when there's exactly 1 user message)
    const messagesForQuery = [...this.conversationMessages];
    if (memoryContext.contentBlock && this.conversationMessages.length === 1) {
      messagesForQuery.unshift({
        role: 'user',
        content: `<memory-context>\n${memoryContext.contentBlock}\n</memory-context>`,
      });
      // Insert matching assistant ack to keep alternation valid
      messagesForQuery.splice(1, 0, {
        role: 'assistant',
        content: 'Memory context loaded.',
      });
    }

    let assistantMessage: APIMessage | null = null;

    for await (const event of queryLoop({
      model: this.options.model,
      tools: this.registry.getAll(),
      systemPrompt: effectiveSystemPrompt || undefined,
      toolset: this.options.toolset,
      maxTurns: this.options.maxTurns,
      maxTokenBudget: this.options.maxTokenBudget,
      maxContextTokens: this.options.maxContextTokens,
      compactModel: this.options.compactModel,
      maxContinuationRetries: this.options.maxContinuationRetries,
      toolContext: this.options.toolContext,
      messages: messagesForQuery,
    })) {
      if (event.type === 'complete') {
        this.usageTracker.add(event.totalUsage);
      }

      // Capture assistant message from turn_end for persistence
      if (event.type === 'turn_end') {
        assistantMessage = event.turnResult.assistantMessage;
      }

      yield event;
    }

    // Sync back any compaction changes to conversation messages
    // (messagesForQuery may have been modified by compactor)
    if (memoryContext.contentBlock && this.conversationMessages.length === 1) {
      // Remove the memory-context prefix messages, keep the rest
      const offset = 2; // memory-context user + assistant ack
      this.conversationMessages.length = 0;
      this.conversationMessages.push(...messagesForQuery.slice(offset));
    } else {
      this.conversationMessages.length = 0;
      this.conversationMessages.push(...messagesForQuery);
    }

    // Persist assistant response
    if (assistantMessage) {
      this.lastEntryUuid = await this.transcriptStore.appendMessage(
        this.sessionId!,
        assistantMessage,
        this.lastEntryUuid,
      );
    }
  }

  async chatSimple(userMessage: string): Promise<string> {
    let finalText = '';

    for await (const event of this.chat(userMessage)) {
      if (event.type === 'text_delta') {
        finalText += event.text;
      }
    }

    return finalText;
  }

  getMessages(): APIMessage[] {
    return this.conversationMessages.map(cloneMessage);
  }

  clearMessages(): void {
    this.conversationMessages = [];
  }

  getUsage(): TokenUsage {
    return this.usageTracker.getTotal();
  }

  getSessionId(): UUID | null {
    return this.sessionId;
  }

  getTranscriptStore(): TranscriptStore {
    return this.transcriptStore;
  }

  async close(): Promise<void> {
    await this.transcriptStore.close();
  }

  /**
   * Build memory context: mechanics prompt (for system prompt) + content block (for user context).
   * Returns empty strings if memory is not configured or autoInject is false.
   */
  private async buildMemoryContext(): Promise<{
    mechanicsPrompt: string;
    contentBlock: string;
  }> {
    const memCfg = this.options.memory;
    if (!memCfg || memCfg.autoInject === false) {
      return { mechanicsPrompt: '', contentBlock: '' };
    }

    const store = memCfg.store;
    const displayName = memCfg.displayName ?? 'Memory';
    const memoryDir = store.getMemoryDir();

    // Read MEMORY.md entrypoint
    let entrypointContent: string | null = null;
    try {
      entrypointContent = await store.readEntrypoint();
    } catch {
      // Graceful degradation — memory dir may not exist yet
    }

    // Build mechanics prompt (injected into system prompt)
    const mechanicsPrompt = buildMemoryPrompt(
      { displayName, memoryDir, includeContent: false },
    );

    // Build content block (injected into user context)
    const contentParts: string[] = [];

    if (entrypointContent?.trim()) {
      contentParts.push(`## MEMORY.md\n\n${entrypointContent.trim()}`);
    }

    if (memCfg.includeManifest !== false) {
      try {
        const headers = await store.scan();
        if (headers.length > 0) {
          const manifest = formatMemoryManifest(headers);
          contentParts.push(`## Memory files\n\n${manifest}`);
        }
      } catch {
        // Graceful degradation — scan may fail if dir doesn't exist
      }
    }

    return {
      mechanicsPrompt,
      contentBlock: contentParts.join('\n\n'),
    };
  }
}

function createRegistry(tools: Tool[]): ToolRegistry {
  const registry = new ToolRegistry();

  for (const tool of tools) {
    registry.register(tool);
  }

  return registry;
}

function cloneMessage(message: APIMessage): APIMessage {
  return {
    role: message.role,
    content: Array.isArray(message.content)
      ? message.content.map(cloneContentBlock)
      : message.content,
  };
}

function cloneContentBlock(block: APIContentBlock): APIContentBlock {
  if (block.type === 'text') {
    return { ...block };
  }

  if (block.type === 'thinking') {
    return { ...block };
  }

  if (block.type === 'tool_use') {
    return {
      ...block,
      input: { ...block.input },
    };
  }

  return {
    ...block,
    content: Array.isArray(block.content)
      ? block.content.map(cloneContentBlock)
      : block.content,
  };
}
