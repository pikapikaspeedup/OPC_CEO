/**
 * Result parsing — extract TaskResult from steps or result.json.
 *
 * Extracted from group-runtime.ts to keep the runtime orchestrator focused.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';
import type { TaskResult, GroupRoleDefinition } from './group-types';

const log = createLogger('ResultParser');

// ---------------------------------------------------------------------------
// getResultJsonCandidates
// ---------------------------------------------------------------------------

/**
 * V3: Try to read a structured result.json from the artifact directory.
 * Returns a TaskResult if found and valid, or null if not found or malformed.
 */
export function getResultJsonCandidates(
  artifactAbsDir: string,
  roleConfig?: GroupRoleDefinition,
): string[] {
  const candidates: string[] = [];

  if (roleConfig?.id.includes('author')) {
    const outputDir = roleConfig.id.includes('architect') ? 'architecture' : 'specs';
    candidates.push(path.join(artifactAbsDir, outputDir, 'result.json'));
  }

  candidates.push(path.join(artifactAbsDir, 'result.json'));

  return [...new Set(candidates)];
}

// ---------------------------------------------------------------------------
// tryReadResultJson
// ---------------------------------------------------------------------------

export function tryReadResultJson(
  artifactAbsDir: string,
  roleConfig?: GroupRoleDefinition,
): TaskResult | null {
  try {
    for (const resultPath of getResultJsonCandidates(artifactAbsDir, roleConfig)) {
      if (!fs.existsSync(resultPath)) continue;

      const raw = fs.readFileSync(resultPath, 'utf-8');
      const data = JSON.parse(raw);

      // Validate required fields
      if (!data.status || !data.summary) {
        log.warn({ resultPath, keys: Object.keys(data) }, 'result.json exists but missing required fields (status/summary)');
        continue;
      }

      const validStatuses = ['completed', 'blocked', 'failed'];
      const status = validStatuses.includes(data.status) ? data.status : 'completed';

      log.info({
        resultPath: path.relative(artifactAbsDir, resultPath) || 'result.json',
        artifactAbsDir: artifactAbsDir.split('/').slice(-3).join('/'),
        status,
        changedFiles: (data.changedFiles || []).length,
        summaryLength: data.summary.length,
      }, 'result.json found — using structured result');

      return {
        status,
        summary: data.summary,
        changedFiles: data.changedFiles || [],
        blockers: data.blockedReason ? [data.blockedReason] : [],
        needsReview: data.outputArtifacts || [],
      };
    }

    return null;
  } catch (err: any) {
    log.warn({ artifactAbsDir, err: err.message }, 'result.json exists but failed to parse');
    return null;
  }
}

// ---------------------------------------------------------------------------
// compactCodingResult
// ---------------------------------------------------------------------------

export function compactCodingResult(
  steps: any[],
  artifactAbsDir?: string,
  roleConfig?: GroupRoleDefinition,
): TaskResult {
  // V3: Try structured result.json first
  if (artifactAbsDir) {
    const jsonResult = tryReadResultJson(artifactAbsDir, roleConfig);
    if (jsonResult) return jsonResult;
    log.debug({ artifactAbsDir: artifactAbsDir.split('/').slice(-3).join('/') }, 'No result.json found — falling back to step parsing');
  }

  let summary = '';
  const changedFiles = new Set<string>();
  const blockers: string[] = [];
  const needsReview: string[] = [];
  let hasErrorMessage = false;

  // V2.5.1: Check for ERROR_MESSAGE steps — only mark failed if the agent
  // did NOT recover (i.e. no successful PLANNER_RESPONSE or CODE_ACTION after the last error)
  let lastErrorIndex = -1;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]?.type === 'CORTEX_STEP_TYPE_ERROR_MESSAGE') {
      lastErrorIndex = i;
    }
  }
  if (lastErrorIndex >= 0) {
    // Check if agent recovered after the last error
    let recovered = false;
    for (let i = lastErrorIndex + 1; i < steps.length; i++) {
      const t = steps[i]?.type;
      if (t === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE' || t === 'CORTEX_STEP_TYPE_CODE_ACTION') {
        recovered = true;
        break;
      }
    }
    hasErrorMessage = !recovered;
  }

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.type !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') continue;

    const planner = step.plannerResponse || step.response || {};
    const plannerStatus = planner.status || step.status || '';

    if (plannerStatus === 'DONE' || plannerStatus === 'STATUS_DONE') {
      const text = planner.modifiedResponse || planner.response || '';
      if (text.trim()) {
        summary = text.trim();
        break;
      }
    }
  }

  if (!summary) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step?.type !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') continue;
      const planner = step.plannerResponse || step.response || {};
      const text = planner.modifiedResponse || planner.response || '';
      if (text.trim()) {
        summary = text.trim();
        break;
      }
    }
  }

  for (const step of steps) {
    if (step?.type === 'CORTEX_STEP_TYPE_CODE_ACTION') {
      const action = step.codeAction || step.actionSpec || {};
      const spec = action.actionSpec || action;

      for (const key of Object.keys(spec)) {
        const sub = spec[key];
        if (sub?.absoluteUri) {
          changedFiles.add(sub.absoluteUri.replace(/^file:\/\//, ''));
        }
        if (sub?.uri) {
          changedFiles.add(sub.uri.replace(/^file:\/\//, ''));
        }
      }

      if (action.absoluteUri) {
        changedFiles.add(action.absoluteUri.replace(/^file:\/\//, ''));
      }
    }
  }

  for (const step of steps) {
    if (step?.type !== 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') continue;

    const planner = step.plannerResponse || step.response || {};
    if (planner.isBlocking && !step._autoApproved) {
      const blockerText = planner.modifiedResponse || planner.response || 'Blocking notification';
      blockers.push(blockerText.slice(0, 200));
    }

    if (planner.reviewAbsoluteUris?.length) {
      needsReview.push(...planner.reviewAbsoluteUris);
    }
    if (planner.pathsToReview?.length) {
      needsReview.push(...planner.pathsToReview);
    }
  }

  return {
    status: hasErrorMessage ? 'failed' : (blockers.length > 0 ? 'blocked' : 'completed'),
    summary: summary || (hasErrorMessage ? 'Task failed due to an error in the child conversation' : 'Task completed (no summary extracted)'),
    changedFiles: [...changedFiles],
    blockers,
    needsReview: [...new Set(needsReview)],
  };
}
