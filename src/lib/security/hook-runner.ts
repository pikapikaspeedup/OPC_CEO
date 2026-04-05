/**
 * Hook Runner — Pre/Post Tool Use Interception
 *
 * Executes registered hooks at defined interception points.
 * Hooks can approve/block tool invocations, modify inputs/outputs,
 * or inject additional context.
 *
 * CCB reference:
 * - src/types/hooks.ts — Hook schema and event types
 * - src/utils/hooks.ts — executePermissionRequestHooks, executePreToolUseHooks
 * - HitCC 02-hook-system/ — Hook lifecycle and timing
 *
 * OPC adaptation:
 * - In-process function hooks (no subprocess hooks in Phase 1)
 * - Simplified event set (5 events vs CCB's 26)
 * - No async hooks (all hooks are synchronous in Phase 1)
 * - No InstructionsLoaded / SubagentStart / FileChanged events (IDE-specific)
 */

import { createLogger } from '../logger';
import type { HookDefinition, HookEvent, HookInput, HookOutput } from './types';

const log = createLogger('HookRunner');

// ---------------------------------------------------------------------------
// Hook Registry
// ---------------------------------------------------------------------------

const hookRegistry: HookDefinition[] = [];

/**
 * Register a hook handler.
 *
 * @param hook The hook definition to register.
 */
export function registerHook(hook: HookDefinition): void {
  // Validate
  if (!hook.id || !hook.event) {
    throw new Error(`Hook must have id and event. Got: id=${hook.id}, event=${hook.event}`);
  }
  if (hook.type === 'function' && !hook.handler) {
    throw new Error(`Function hook "${hook.id}" must have a handler`);
  }
  if (hook.type === 'command' && !hook.command) {
    throw new Error(`Command hook "${hook.id}" must have a command`);
  }

  // Remove existing hook with same id (replace semantics)
  const existing = hookRegistry.findIndex(h => h.id === hook.id);
  if (existing >= 0) {
    hookRegistry.splice(existing, 1);
  }

  hookRegistry.push(hook);
  log.info({ hookId: hook.id, event: hook.event, type: hook.type }, 'Hook registered');
}

/**
 * Unregister a hook by id.
 */
export function unregisterHook(hookId: string): boolean {
  const idx = hookRegistry.findIndex(h => h.id === hookId);
  if (idx >= 0) {
    hookRegistry.splice(idx, 1);
    log.info({ hookId }, 'Hook unregistered');
    return true;
  }
  return false;
}

/**
 * Get all registered hooks for an event.
 */
export function getHooksForEvent(event: HookEvent): HookDefinition[] {
  return hookRegistry.filter(h => h.event === event && h.enabled !== false);
}

/**
 * Clear all registered hooks (for testing).
 */
export function clearHooks(): void {
  hookRegistry.length = 0;
}

// ---------------------------------------------------------------------------
// Hook Execution
// ---------------------------------------------------------------------------

/**
 * Execute all hooks for a given event.
 *
 * Hooks are executed sequentially in registration order.
 * If any hook sets `continue: false`, execution stops and that result is returned.
 * If any PreToolUse hook sets `decision: 'block'`, the tool invocation is blocked.
 *
 * CCB reference:
 * - executePreToolUseHooks: runs hooks, collects decisions
 * - executePermissionRequestHooks: runs hooks that may approve/block
 *
 * @param event The hook event to fire
 * @param input The hook input payload
 * @returns Aggregated hook output
 */
export async function executeHooks(
  event: HookEvent,
  input: HookInput,
): Promise<HookOutput> {
  const hooks = getHooksForEvent(event);
  if (hooks.length === 0) {
    return { continue: true };
  }

  log.debug({ event, hookCount: hooks.length }, 'Executing hooks');

  let aggregated: HookOutput = { continue: true };

  for (const hook of hooks) {
    try {
      const timeout = hook.timeout ?? 30_000;
      let output: HookOutput;

      if (hook.type === 'function' && hook.handler) {
        output = await Promise.race([
          hook.handler(input),
          new Promise<HookOutput>((_, reject) =>
            setTimeout(() => reject(new Error(`Hook "${hook.id}" timed out after ${timeout}ms`)), timeout),
          ),
        ]);
      } else if (hook.type === 'command' && hook.command) {
        output = await executeCommandHook(hook.command, input, timeout);
      } else {
        log.warn({ hookId: hook.id }, 'Hook has no handler or command, skipping');
        continue;
      }

      // Merge results
      if (output.decision) aggregated.decision = output.decision;
      if (output.reason) aggregated.reason = output.reason;
      if (output.updatedInput) {
        aggregated.updatedInput = { ...(aggregated.updatedInput ?? {}), ...output.updatedInput };
      }
      if (output.updatedOutput) aggregated.updatedOutput = output.updatedOutput;
      if (output.additionalContext) {
        aggregated.additionalContext = aggregated.additionalContext
          ? `${aggregated.additionalContext}\n${output.additionalContext}`
          : output.additionalContext;
      }

      // If hook says stop, break the chain
      if (output.continue === false) {
        aggregated.continue = false;
        aggregated.stopReason = output.stopReason ?? `Stopped by hook "${hook.id}"`;
        break;
      }

      log.debug({ hookId: hook.id, decision: output.decision }, 'Hook executed');
    } catch (err: any) {
      log.error({ hookId: hook.id, err: err.message }, 'Hook execution failed');
      // Hook failure doesn't block the pipeline by default
      // (fail-open for availability, fail-closed can be opt-in via strict mode)
    }
  }

  return aggregated;
}

// ---------------------------------------------------------------------------
// Command hook execution (subprocess)
// ---------------------------------------------------------------------------

/**
 * Execute a command-type hook via subprocess.
 *
 * Sends JSON to stdin, reads JSON from stdout.
 *
 * CCB reference: hook execution via child_process.spawn
 */
async function executeCommandHook(
  command: string,
  input: HookInput,
  timeout: number,
): Promise<HookOutput> {
  // TODO: Implement subprocess hook execution in Phase 2
  // For now, log a warning and return pass-through
  log.warn({ command }, 'Command hooks not yet implemented, passing through');
  return { continue: true };
}
