/**
 * One-shot LLM call — thin API-backed wrapper for non-interactive prompts
 * such as pipeline generation or knowledge summarization.
 */

import {
  buildClaudeEngineSystemPrompt,
  createClaudeEngineToolContext,
  resolveApiBackedModelConfig,
} from '../backends/claude-engine-backend';
import { ClaudeEngine } from '../claude-engine/engine/claude-engine';
import { createLogger } from '../logger';
import { resolveProvider } from '../providers';
import type { AIProviderId, AILayer, AIScene } from '../providers/types';
import { getCEOWorkspacePath } from './ceo-environment';

const log = createLogger('LLM-Oneshot');

const DEFAULT_MODEL = 'MODEL_PLACEHOLDER_M47'; // Gemini 3 Flash
const POLL_TIMEOUT_MS = 120_000; // 2 minutes

const API_BACKED_PROVIDERS = new Set<AIProviderId>([
  'native-codex',
  'claude-api',
  'openai-api',
  'gemini-api',
  'grok-api',
  'custom',
]);



/**
 * Send a prompt to the LLM and return the text response.
 * Integrates with the Provider Architecture to support different models/providers.
 *
 * @param prompt The prompt text
 * @param model Optional model override
 * @param layer Optional AI Layer (defaults to 'executive')
 * @returns The LLM's text response
 */
export async function callLLMOneshot(
  prompt: string, 
  model?: string, 
  layer: AILayer | AIScene = 'executive'
): Promise<string> {
  const wsPath = getCEOWorkspacePath();
  const { provider, model: resolvedModel, source } = resolveProvider(layer, wsPath);
  const targetModel = model || resolvedModel || DEFAULT_MODEL;

  log.info({ provider, targetModel, source, promptLen: prompt.length }, 'callLLMOneshot dispatching via provider');

  if (API_BACKED_PROVIDERS.has(provider)) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
    const engine = new ClaudeEngine({
      model: resolveApiBackedModelConfig(provider, targetModel),
      systemPrompt: buildClaudeEngineSystemPrompt({
        runId: `oneshot-${provider}-${Date.now()}`,
        workspacePath: wsPath,
        prompt,
        model: targetModel,
        executionTarget: { kind: 'prompt' },
      }),
      toolContext: createClaudeEngineToolContext(wsPath, controller.signal),
      maxTurns: 8,
    });

    try {
      await engine.init();
      return await engine.chatSimple(prompt);
    } finally {
      clearTimeout(timeoutId);
      await engine.close();
    }
  }

  throw new Error(`callLLMOneshot only supports API-backed providers; got: ${provider}`);
}
