import { streamQueryWithRetry, type RetryEvent } from '../api/retry';
import type { APIContentBlock, APIMessage, ContentDelta, StreamEvent, TokenUsage } from '../api/types';
import { toolsToAPISchemas } from '../api/tool-schema';
import { UsageTracker } from '../api/usage';
import { PromptCacheMonitor } from '../api/prompt-cache-monitor';

import { compactMessages, estimateTokenCount } from './compactor';
import { ToolExecutor } from './tool-executor';
import type { EngineConfig, EngineEvent, StopReason, ToolCallResult, ToolUseBlock, TurnResult }  from './types';
import { resolveToolset } from '../tools/toolsets';

/**
 * 核心查询循环 — AsyncGenerator
 * 每次迭代 = 一个 Turn（API 调用 + 工具执行）
 */
export async function* queryLoop(
  config: EngineConfig,
): AsyncGenerator<EngineEvent> {
  const messages = config.messages ?? [];
  const usageTracker = new UsageTracker();
  const cacheMonitor = new PromptCacheMonitor();
  let tools = config.tools ?? [];

  // Apply toolset filter if specified
  if (config.toolset) {
    const allowedNames = new Set(resolveToolset(config.toolset));
    const allowDynamicMcpTools = config.toolset === 'full';
    tools = tools.filter((tool) =>
      allowedNames.has(tool.name) ||
      (allowDynamicMcpTools && tool.name.startsWith('mcp__')),
    );
  }

  const apiTools = toolsToAPISchemas(tools);
  const toolExecutor = new ToolExecutor(buildToolsMap(tools), config.toolContext);
  let completedTurns = 0;
  let continuationAttempts = 0;
  let budgetWarningIssued = false;

  while (true) {
    if (config.toolContext.abortSignal.aborted) {
      yield completeEvent(completedTurns, usageTracker.getTotal(), 'aborted');
      return;
    }

    if (config.maxTurns !== undefined && completedTurns >= config.maxTurns) {
      yield completeEvent(completedTurns, usageTracker.getTotal(), 'max_turns');
      return;
    }

    // Iteration Budget: inject wrap-up nudge when 80% of turns used
    if (config.maxTurns !== undefined && !budgetWarningIssued) {
      const threshold = Math.floor(config.maxTurns * 0.8);
      if (completedTurns >= threshold && completedTurns > 0) {
        budgetWarningIssued = true;
        const remaining = config.maxTurns - completedTurns;
        yield {
          type: 'budget_warning',
          turnsUsed: completedTurns,
          turnsRemaining: remaining,
          maxTurns: config.maxTurns,
        };
        // Inject system-level nudge into messages
        messages.push({
          role: 'user',
          content: `[System notice: You have used ${completedTurns}/${config.maxTurns} turns. Only ${remaining} turns remain. Please start wrapping up your work — provide a summary of what you've done and what remains.]`,
        });
      }
    }

    // Pre-turn context window check — compact if needed
    if (config.maxContextTokens !== undefined) {
      const estimatedTokens = estimateTokenCount(messages);
      const threshold = config.compactThreshold ?? 0.85;
      if (estimatedTokens > config.maxContextTokens * threshold) {
        const before = estimatedTokens;
        const { compacted, removedCount, summaryTokens } = await compactMessages(
          messages,
          {
            model: config.compactModel ?? config.model,
            keepLastN: 6,
            signal: config.toolContext.abortSignal,
          },
        );
        if (removedCount > 0) {
          messages.length = 0;
          messages.push(...compacted);
          const after = estimateTokenCount(messages);
          cacheMonitor.notifyCompaction();
          yield {
            type: 'compaction',
            removedMessages: removedCount,
            estimatedTokensBefore: before,
            estimatedTokensAfter: after,
          };
        }
      }
    }

    const turnNumber = completedTurns + 1;
    yield { type: 'turn_start', turnNumber };

    const assistantBlocks: Array<APIContentBlock | undefined> = [];
    const toolInputBuffers = new Map<number, string>();
    let rawStopReason: string | null = null;
    let turnUsage = createEmptyUsage();

    // Phase 1: Record prompt state for cache break detection
    cacheMonitor.recordPromptState(
      config.systemPrompt ?? '',
      apiTools,
      config.model.model,
    );

    try {
      for await (const event of streamQueryWithRetry({
        model: config.model,
        systemPrompt: config.systemPrompt ?? '',
        messages,
        tools: apiTools,
        thinking: config.thinking,
        signal: config.toolContext.abortSignal,
      })) {
        // Forward retry events as EngineEvents
        if ((event as RetryEvent).type === 'retry') {
          const retryEvent = event as RetryEvent;
          yield {
            type: 'retry',
            attempt: retryEvent.attempt,
            maxAttempts: retryEvent.maxAttempts,
            delayMs: retryEvent.delayMs,
            statusCode: retryEvent.statusCode,
            errorMessage: retryEvent.errorMessage,
          };
          continue;
        }

        const streamEvent = event as StreamEvent;
        yield { type: 'stream_event', event: streamEvent };

        switch (streamEvent.type) {
          case 'message_start': {
            turnUsage = mergeUsage(turnUsage, streamEvent.message.usage);
            break;
          }

          case 'content_block_start': {
            assistantBlocks[streamEvent.index] = cloneContentBlock(streamEvent.content_block);
            break;
          }

          case 'content_block_delta': {
            const block = assistantBlocks[streamEvent.index];

            if (!block) {
              break;
            }

            applyDelta(block, streamEvent.delta, toolInputBuffers, streamEvent.index);

            if (streamEvent.delta.type === 'text_delta') {
              yield { type: 'text_delta', text: streamEvent.delta.text };
            }

            if (streamEvent.delta.type === 'thinking_delta') {
              yield { type: 'thinking_delta', thinking: streamEvent.delta.thinking };
            }

            break;
          }

          case 'content_block_stop': {
            finalizeToolInput(assistantBlocks[streamEvent.index], toolInputBuffers, streamEvent.index);
            break;
          }

          case 'message_delta': {
            rawStopReason = streamEvent.delta.stop_reason;
            turnUsage = mergeUsage(turnUsage, streamEvent.usage);

            // Phase 2: Check for cache break after receiving usage data
            if (streamEvent.usage) {
              const cacheBreak = cacheMonitor.checkForCacheBreak(
                streamEvent.usage.cache_read_input_tokens ?? 0,
                streamEvent.usage.cache_creation_input_tokens ?? 0,
                streamEvent.usage.input_tokens ?? turnUsage.input_tokens,
              );
              if (cacheBreak) {
                yield { type: 'cache_break', event: cacheBreak };
              }
            }
            break;
          }

          case 'message_stop': {
            break;
          }

          case 'error': {
            yield completeEvent(turnNumber, usageTracker.getTotal(), 'error');
            return;
          }
        }
      }
    } catch (error) {
      if (isAbortError(error) || config.toolContext.abortSignal.aborted) {
        yield completeEvent(turnNumber, usageTracker.getTotal(), 'aborted');
        return;
      }

      // Reactive compaction: 413 / prompt_too_long → compact and retry the turn
      if (isPromptTooLongError(error) && messages.length > 4) {
        const before = estimateTokenCount(messages);
        const { compacted, removedCount } = await compactMessages(
          messages,
          {
            model: config.compactModel ?? config.model,
            keepLastN: 4,
            signal: config.toolContext.abortSignal,
          },
        );
        if (removedCount > 0) {
          messages.length = 0;
          messages.push(...compacted);
          const after = estimateTokenCount(messages);
          cacheMonitor.notifyCompaction();
          yield {
            type: 'compaction',
            removedMessages: removedCount,
            estimatedTokensBefore: before,
            estimatedTokensAfter: after,
          };
          // Retry the turn (don't increment completedTurns, loop will re-enter)
          continue;
        }
      }

      yield completeEvent(turnNumber, usageTracker.getTotal(), 'error');
      return;
    }

    try {
      for (const [index] of toolInputBuffers) {
        finalizeToolInput(assistantBlocks[index], toolInputBuffers, index);
      }
    } catch {
      yield completeEvent(turnNumber, usageTracker.getTotal(), 'error');
      return;
    }

    const finalizedAssistantBlocks = assistantBlocks.filter(
      (block): block is APIContentBlock => Boolean(block),
    );

    usageTracker.add(turnUsage);

    const assistantMessage: APIMessage = {
      role: 'assistant',
      content: finalizedAssistantBlocks,
    };
    messages.push(assistantMessage);

    const toolUseBlocks = finalizedAssistantBlocks.filter(
      (block): block is ToolUseBlock => block.type === 'tool_use',
    );

    // max_tokens truncation recovery: inject "continue working" message
    if (rawStopReason === 'max_tokens' && toolUseBlocks.length === 0) {
      const maxContinuationRetries = config.maxContinuationRetries ?? 3;
      continuationAttempts += 1;
      if (continuationAttempts <= maxContinuationRetries) {
        yield { type: 'continuation', attempt: continuationAttempts, maxAttempts: maxContinuationRetries };
        messages.push({
          role: 'user',
          content: 'Your response was truncated. Continue your work from where you left off.',
        });
        completedTurns = turnNumber;
        continue;
      }
      // Exhausted continuation retries
      yield completeEvent(turnNumber, usageTracker.getTotal(), 'continuation_exhausted');
      return;
    }

    if (toolUseBlocks.length === 0 || rawStopReason === 'end_turn') {
      completedTurns = turnNumber;

      const turnResult: TurnResult = {
        turnNumber,
        assistantMessage,
        toolResults: [],
        usage: turnUsage,
        stopReason: 'end_turn',
      };

      yield { type: 'turn_end', turnResult };
      yield completeEvent(completedTurns, usageTracker.getTotal(), 'end_turn');
      return;
    }

    if (config.toolContext.abortSignal.aborted) {
      yield completeEvent(turnNumber, usageTracker.getTotal(), 'aborted');
      return;
    }

    for (const block of toolUseBlocks) {
      yield {
        type: 'tool_start',
        toolUseId: block.id,
        toolName: block.name,
        input: block.input,
      };
    }

    const toolResults: ToolCallResult[] = [];
    const toolResultBlocks: APIContentBlock[] = [];

    for await (const result of toolExecutor.executeTools(toolUseBlocks)) {
      toolResults.push(result);

      yield {
        type: 'tool_end',
        toolUseId: result.toolUseId,
        toolName: result.toolName,
        result: result.result,
        isError: result.isError,
        durationMs: result.durationMs,
      };

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: result.toolUseId,
        content: serializeToolResult(result.result.data),
        ...(result.isError ? { is_error: true } : {}),
      });
    }

    messages.push({
      role: 'user',
      content: toolResultBlocks,
    });

    completedTurns = turnNumber;

    const turnResult: TurnResult = {
      turnNumber,
      assistantMessage,
      toolResults,
      usage: turnUsage,
      stopReason: 'tool_use',
    };
    yield { type: 'turn_end', turnResult };

    if (config.maxTokenBudget !== undefined) {
      const totalUsage = usageTracker.getTotal();

      if (
        totalUsage.input_tokens + totalUsage.output_tokens >=
        config.maxTokenBudget
      ) {
        yield completeEvent(completedTurns, totalUsage, 'token_budget');
        return;
      }
    }
  }
}

function buildToolsMap(tools: EngineConfig['tools']): Map<string, import('../types').Tool> {
  const map = new Map<string, import('../types').Tool>();

  for (const tool of tools ?? []) {
    map.set(tool.name, tool);

    for (const alias of tool.aliases ?? []) {
      map.set(alias, tool);
    }
  }

  return map;
}

function completeEvent(
  totalTurns: number,
  totalUsage: TokenUsage,
  stopReason: StopReason,
): EngineEvent {
  return {
    type: 'complete',
    totalTurns,
    totalUsage,
    stopReason,
  };
}

function createEmptyUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
  };
}

function mergeUsage(current: TokenUsage, next?: TokenUsage): TokenUsage {
  if (!next) {
    return current;
  }

  return {
    input_tokens: next.input_tokens ?? current.input_tokens,
    output_tokens: next.output_tokens ?? current.output_tokens,
    ...(next.cache_creation_input_tokens !== undefined
      ? { cache_creation_input_tokens: next.cache_creation_input_tokens }
      : current.cache_creation_input_tokens !== undefined
        ? { cache_creation_input_tokens: current.cache_creation_input_tokens }
        : {}),
    ...(next.cache_read_input_tokens !== undefined
      ? { cache_read_input_tokens: next.cache_read_input_tokens }
      : current.cache_read_input_tokens !== undefined
        ? { cache_read_input_tokens: current.cache_read_input_tokens }
        : {}),
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

function applyDelta(
  block: APIContentBlock,
  delta: ContentDelta,
  toolInputBuffers: Map<number, string>,
  index: number,
): void {
  if (block.type === 'text' && delta.type === 'text_delta') {
    block.text += delta.text;
    return;
  }

  if (block.type === 'thinking' && delta.type === 'thinking_delta') {
    block.thinking += delta.thinking;
    return;
  }

  if (block.type === 'tool_use' && delta.type === 'input_json_delta') {
    const current = toolInputBuffers.get(index) ?? '';
    toolInputBuffers.set(index, `${current}${delta.partial_json}`);
  }
}

function finalizeToolInput(
  block: APIContentBlock | undefined,
  toolInputBuffers: Map<number, string>,
  index: number,
): void {
  if (!block || block.type !== 'tool_use') {
    return;
  }

  const partialJson = toolInputBuffers.get(index);

  if (!partialJson) {
    return;
  }

  block.input = JSON.parse(partialJson) as Record<string, unknown>;
  toolInputBuffers.delete(index);
}

function serializeToolResult(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isPromptTooLongError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    if ('statusCode' in error && (error as { statusCode: number }).statusCode === 413) {
      return true;
    }
    if (error instanceof Error && /prompt.*(too long|too large)/i.test(error.message)) {
      return true;
    }
  }
  return false;
}
