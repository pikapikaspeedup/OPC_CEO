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

const log = createLogger('LLM-Oneshot');

const DEFAULT_MODEL = 'MODEL_PLACEHOLDER_M47'; // Gemini 3 Flash
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Send a prompt to the LLM and return the text response.
 * Creates a temporary cascade conversation, sends the prompt, polls for
 * the response, and returns the raw text.
 *
 * @param prompt The prompt text
 * @param model Optional model override (defaults to M47)
 * @returns The LLM's text response
 * @throws If no language server is available or the call times out
 */
export async function callLLMOneshot(prompt: string, model?: string): Promise<string> {
  const servers = discoverLanguageServers();
  const apiKey = getApiKey();

  if (!apiKey || servers.length === 0) {
    throw new Error(
      'No language server available. Ensure the application is running with an active server connection.',
    );
  }

  const server = servers[0];
  const targetModel = model || DEFAULT_MODEL;

  // Start a temporary cascade conversation
  // Use a generic workspace URI — the prompt doesn't need file access
  const startResult = await grpc.startCascade(server.port, server.csrf, apiKey, 'file:///tmp');
  const cascadeId = startResult?.cascadeId;

  if (!cascadeId) {
    throw new Error('Failed to start cascade for LLM call');
  }

  log.debug({ cascadeId: cascadeId.slice(0, 8), model: targetModel, promptLen: prompt.length }, 'Sending one-shot prompt');

  // Mark as hidden system task
  try {
    await grpc.updateConversationAnnotations(server.port, server.csrf, apiKey, cascadeId, {
      'antigravity.task.hidden': 'true',
      'antigravity.task.type': 'llm-oneshot',
    });
  } catch {
    // Non-critical — annotations may fail on some server versions
  }

  // Get initial step count before sending
  const preResp = await grpc.getTrajectorySteps(server.port, server.csrf, apiKey, cascadeId);
  const preStepCount = (preResp?.steps || []).filter((s: any) => s != null).length;

  // Send the prompt
  await grpc.sendMessage(
    server.port, server.csrf, apiKey, cascadeId,
    prompt, targetModel,
    false, // non-agentic mode (no tool calls)
    undefined,
    'ARTIFACT_REVIEW_MODE_TURBO',
  );

  // Poll for response
  const pollStart = Date.now();
  let responseText = '';

  while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const stepsResp = await grpc.getTrajectorySteps(server.port, server.csrf, apiKey, cascadeId);
      const steps = (stepsResp?.steps || []).filter((s: any) => s != null);

      // Look for planner response steps after our prompt
      for (let j = steps.length - 1; j >= preStepCount; j--) {
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
