/**
 * One-shot LLM call — sends a prompt to the language server and returns the text response.
 *
 * Uses the same cascade infrastructure as group-runtime but in a simplified
 * fire-and-poll pattern suitable for non-interactive prompts (e.g. pipeline generation).
 */

import {
  discoverLanguageServers,
  getApiKey,
  grpc,
} from '../bridge/gateway';
import { createLogger } from '../logger';
import { resolveProvider, getExecutor } from '../providers';
import type { AILayer, AIScene } from '../providers/types';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { getCEOWorkspacePath } from './ceo-environment';

const log = createLogger('LLM-Oneshot');

const DEFAULT_MODEL = 'MODEL_PLACEHOLDER_M47'; // Gemini 3 Flash
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 120_000; // 2 minutes



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

  const executor = getExecutor(provider);

  // If the provider supports synchronous blocking execution (e.g., Codex)
  if (provider === 'codex' || provider !== 'antigravity') {
    const res = await executor.executeTask({
      workspace: wsPath,
      prompt,
      model: targetModel,
      timeout: POLL_TIMEOUT_MS,
    });
    return res.content;
  }

  // Fallback for antigravity (requires manual polling since executeTask returns immediately in Phase 1)
  const servers = await discoverLanguageServers();
  const apiKey = getApiKey();

  if (!apiKey || servers.length === 0) {
    throw new Error(
      'No language server available. Ensure the application is running with an active server connection.',
    );
  }

  const server = servers[0];

  // Try to use the executor to create the child cascade (standardizes dispatch)
  const dispatchRes = await executor.executeTask({
    workspace: wsPath,
    prompt,
    model: targetModel,
    timeout: POLL_TIMEOUT_MS,
  });

  const cascadeId = dispatchRes.handle;
  if (!cascadeId) throw new Error('Execution failed to return a handle for polling');

  // Poll for response
  const pollStart = Date.now();
  let responseText = '';

  while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const stepsResp = await grpc.getTrajectorySteps(server.port, server.csrf, apiKey, cascadeId);
      const steps = (stepsResp?.steps || []).filter((s: any) => s != null);

      // Look for planner response steps after our prompt
      for (let j = steps.length - 1; j >= 0; j--) {
        const step = steps[j];
        if (step?.type === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
          const planner = step.plannerResponse || step.response || {};
          const text = planner.modifiedResponse || planner.response || '';
          if (text) {
            responseText = text;
            break;
          }
        }
      }

      if (responseText) break;
    } catch (err) {
      log.warn({ cascadeId: cascadeId.slice(0, 8), err }, 'Poll error');
    }
  }

  if (!responseText) {
    throw new Error('LLM call timed out — no response received within 2 minutes');
  }

  log.info({ cascadeId: cascadeId.slice(0, 8), responseLen: responseText.length }, 'One-shot LLM call completed');

  return responseText;
}
