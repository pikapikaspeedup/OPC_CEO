/**
 * Flow Condition Evaluator — V5.2c
 *
 * Safe, deterministic condition evaluation.
 * No eval(), no Function(), no LLM calls.
 * Only field extraction + literal comparison.
 */

import type { FlowCondition } from './dag-ir-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConditionContext {
  /** Structured output data from upstream stages, keyed by stageId or field path */
  upstreamOutputs: Record<string, unknown>;
  /** Current loop iteration count (if applicable) */
  iterationCount?: number;
  /** Current project status */
  projectStatus?: string;
}

export interface ConditionEvalResult {
  /** Whether the condition matched */
  matched: boolean;
  /** Human-readable explanation of the evaluation (for audit) */
  explanation: string;
  /** The actual value extracted from the context */
  actualValue?: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FIELD_DEPTH = 10;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a FlowCondition against a context.
 * Deterministic, no side effects.
 */
export function evaluateCondition(
  condition: FlowCondition,
  context: ConditionContext,
): ConditionEvalResult {
  switch (condition.type) {
    case 'always':
      return { matched: true, explanation: 'Type is "always" — unconditionally true' };

    case 'field-exists':
      return evaluateFieldExists(condition, context);

    case 'field-match':
      return evaluateFieldMatch(condition, context);

    case 'field-compare':
      return evaluateFieldCompare(condition, context);

    default:
      return {
        matched: false,
        explanation: `Unknown condition type: '${(condition as any).type}'`,
      };
  }
}

// ---------------------------------------------------------------------------
// Field path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-notation field path against the upstream outputs.
 * Returns { found, value }.
 * Max depth: 10 levels.
 */
export function resolveFieldPath(
  obj: Record<string, unknown>,
  fieldPath: string,
): { found: boolean; value: unknown } {
  const parts = fieldPath.split('.');
  if (parts.length > MAX_FIELD_DEPTH) {
    return { found: false, value: undefined };
  }

  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return { found: false, value: undefined };
    }
    if (!(part in (current as Record<string, unknown>))) {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[part];
  }

  return { found: true, value: current };
}

// ---------------------------------------------------------------------------
// Evaluators
// ---------------------------------------------------------------------------

function evaluateFieldExists(
  condition: FlowCondition,
  context: ConditionContext,
): ConditionEvalResult {
  if (!condition.field) {
    return { matched: false, explanation: 'field-exists requires a field path' };
  }
  const { found, value } = resolveFieldPath(context.upstreamOutputs, condition.field);
  return {
    matched: found,
    explanation: found
      ? `Field '${condition.field}' exists (value: ${JSON.stringify(value)})`
      : `Field '${condition.field}' does not exist`,
    actualValue: value,
  };
}

function evaluateFieldMatch(
  condition: FlowCondition,
  context: ConditionContext,
): ConditionEvalResult {
  if (!condition.field) {
    return { matched: false, explanation: 'field-match requires a field path' };
  }
  const { found, value } = resolveFieldPath(context.upstreamOutputs, condition.field);
  if (!found) {
    return {
      matched: false,
      explanation: `Field '${condition.field}' not found — cannot match`,
      actualValue: undefined,
    };
  }

  // Equality comparison (loose for string/number coercion)
  const matched = value === condition.value || String(value) === String(condition.value);
  return {
    matched,
    explanation: matched
      ? `Field '${condition.field}' matches: ${JSON.stringify(value)} === ${JSON.stringify(condition.value)}`
      : `Field '${condition.field}' does not match: ${JSON.stringify(value)} !== ${JSON.stringify(condition.value)}`,
    actualValue: value,
  };
}

function evaluateFieldCompare(
  condition: FlowCondition,
  context: ConditionContext,
): ConditionEvalResult {
  if (!condition.field) {
    return { matched: false, explanation: 'field-compare requires a field path' };
  }
  if (!condition.operator) {
    return { matched: false, explanation: 'field-compare requires an operator' };
  }
  const { found, value } = resolveFieldPath(context.upstreamOutputs, condition.field);
  if (!found) {
    return {
      matched: false,
      explanation: `Field '${condition.field}' not found — cannot compare`,
      actualValue: undefined,
    };
  }

  const op = condition.operator;
  let matched = false;
  let explanation = '';

  switch (op) {
    case 'eq':
      matched = value === condition.value || String(value) === String(condition.value);
      break;
    case 'neq':
      matched = value !== condition.value && String(value) !== String(condition.value);
      break;
    case 'gt':
      matched = Number(value) > Number(condition.value);
      break;
    case 'lt':
      matched = Number(value) < Number(condition.value);
      break;
    case 'gte':
      matched = Number(value) >= Number(condition.value);
      break;
    case 'lte':
      matched = Number(value) <= Number(condition.value);
      break;
    case 'contains':
      matched = typeof value === 'string' && typeof condition.value === 'string'
        && value.includes(condition.value);
      break;
    case 'matches':
      if (condition.pattern && typeof value === 'string') {
        try {
          matched = new RegExp(condition.pattern).test(value);
        } catch {
          return {
            matched: false,
            explanation: `Invalid regex pattern: '${condition.pattern}'`,
            actualValue: value,
          };
        }
      }
      break;
    default:
      return {
        matched: false,
        explanation: `Unknown operator: '${op}'`,
        actualValue: value,
      };
  }

  explanation = `Field '${condition.field}' ${op} ${JSON.stringify(condition.value ?? condition.pattern)}: ${JSON.stringify(value)} → ${matched}`;

  return { matched, explanation, actualValue: value };
}
