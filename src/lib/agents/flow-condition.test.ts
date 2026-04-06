import { describe, expect, it } from 'vitest';
import { evaluateCondition, resolveFieldPath } from './flow-condition';
import type { FlowCondition } from './pipeline/dag-ir-types';
import type { ConditionContext } from './flow-condition';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctx(outputs: Record<string, unknown>): ConditionContext {
  return { upstreamOutputs: outputs };
}

// ---------------------------------------------------------------------------
// resolveFieldPath
// ---------------------------------------------------------------------------

describe('resolveFieldPath', () => {
  it('resolves top-level field', () => {
    expect(resolveFieldPath({ status: 'ok' }, 'status')).toEqual({ found: true, value: 'ok' });
  });

  it('resolves nested field', () => {
    expect(resolveFieldPath({ a: { b: { c: 42 } } }, 'a.b.c')).toEqual({ found: true, value: 42 });
  });

  it('returns found=false for missing field', () => {
    expect(resolveFieldPath({ a: 1 }, 'b')).toEqual({ found: false, value: undefined });
  });

  it('returns found=false for missing nested field', () => {
    expect(resolveFieldPath({ a: { x: 1 } }, 'a.b.c')).toEqual({ found: false, value: undefined });
  });

  it('handles null intermediate', () => {
    expect(resolveFieldPath({ a: null }, 'a.b')).toEqual({ found: false, value: undefined });
  });

  it('enforces max depth 10', () => {
    const deepPath = Array.from({ length: 11 }, (_, i) => `k${i}`).join('.');
    expect(resolveFieldPath({}, deepPath)).toEqual({ found: false, value: undefined });
  });
});

// ---------------------------------------------------------------------------
// evaluateCondition: always
// ---------------------------------------------------------------------------

describe('evaluateCondition — always', () => {
  it('always returns true', () => {
    const result = evaluateCondition({ type: 'always' }, ctx({}));
    expect(result.matched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateCondition: field-exists
// ---------------------------------------------------------------------------

describe('evaluateCondition — field-exists', () => {
  it('matches when field exists', () => {
    const result = evaluateCondition(
      { type: 'field-exists', field: 'review.outcome' },
      ctx({ review: { outcome: 'approved' } }),
    );
    expect(result.matched).toBe(true);
    expect(result.actualValue).toBe('approved');
  });

  it('does not match when field is missing', () => {
    const result = evaluateCondition(
      { type: 'field-exists', field: 'review.outcome' },
      ctx({ review: {} }),
    );
    expect(result.matched).toBe(false);
  });

  it('returns false when no field specified', () => {
    const result = evaluateCondition({ type: 'field-exists' }, ctx({}));
    expect(result.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateCondition: field-match
// ---------------------------------------------------------------------------

describe('evaluateCondition — field-match', () => {
  it('matches string value', () => {
    const result = evaluateCondition(
      { type: 'field-match', field: 'status', value: 'approved' },
      ctx({ status: 'approved' }),
    );
    expect(result.matched).toBe(true);
  });

  it('does not match different value', () => {
    const result = evaluateCondition(
      { type: 'field-match', field: 'status', value: 'approved' },
      ctx({ status: 'rejected' }),
    );
    expect(result.matched).toBe(false);
  });

  it('matches number value', () => {
    const result = evaluateCondition(
      { type: 'field-match', field: 'count', value: 5 },
      ctx({ count: 5 }),
    );
    expect(result.matched).toBe(true);
  });

  it('matches boolean value', () => {
    const result = evaluateCondition(
      { type: 'field-match', field: 'ok', value: true },
      ctx({ ok: true }),
    );
    expect(result.matched).toBe(true);
  });

  it('returns false for missing field', () => {
    const result = evaluateCondition(
      { type: 'field-match', field: 'missing', value: 'x' },
      ctx({}),
    );
    expect(result.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateCondition: field-compare
// ---------------------------------------------------------------------------

describe('evaluateCondition — field-compare', () => {
  it('eq: matches equal values', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'score', operator: 'eq', value: 100 },
      ctx({ score: 100 }),
    );
    expect(result.matched).toBe(true);
  });

  it('neq: matches non-equal values', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'score', operator: 'neq', value: 100 },
      ctx({ score: 50 }),
    );
    expect(result.matched).toBe(true);
  });

  it('gt: matches greater than', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'points', operator: 'gt', value: 20 },
      ctx({ points: 25 }),
    );
    expect(result.matched).toBe(true);
  });

  it('gt: does not match equal', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'points', operator: 'gt', value: 20 },
      ctx({ points: 20 }),
    );
    expect(result.matched).toBe(false);
  });

  it('lt: matches less than', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'points', operator: 'lt', value: 20 },
      ctx({ points: 15 }),
    );
    expect(result.matched).toBe(true);
  });

  it('gte: matches greater or equal', () => {
    const r1 = evaluateCondition(
      { type: 'field-compare', field: 'x', operator: 'gte', value: 10 },
      ctx({ x: 10 }),
    );
    const r2 = evaluateCondition(
      { type: 'field-compare', field: 'x', operator: 'gte', value: 10 },
      ctx({ x: 11 }),
    );
    expect(r1.matched).toBe(true);
    expect(r2.matched).toBe(true);
  });

  it('lte: matches less or equal', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'x', operator: 'lte', value: 10 },
      ctx({ x: 10 }),
    );
    expect(result.matched).toBe(true);
  });

  it('contains: matches substring', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'msg', operator: 'contains', value: 'hello' },
      ctx({ msg: 'say hello world' }),
    );
    expect(result.matched).toBe(true);
  });

  it('contains: does not match non-string', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'msg', operator: 'contains', value: 'hello' },
      ctx({ msg: 123 }),
    );
    expect(result.matched).toBe(false);
  });

  it('matches: regex pattern', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'version', operator: 'matches', pattern: '^v\\d+\\.\\d+' },
      ctx({ version: 'v2.1.0' }),
    );
    expect(result.matched).toBe(true);
  });

  it('matches: invalid regex → false', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'x', operator: 'matches', pattern: '[invalid' },
      ctx({ x: 'test' }),
    );
    expect(result.matched).toBe(false);
    expect(result.explanation).toContain('Invalid regex');
  });

  it('returns false for missing field', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'missing', operator: 'eq', value: 1 },
      ctx({}),
    );
    expect(result.matched).toBe(false);
  });

  it('returns false for missing operator', () => {
    const result = evaluateCondition(
      { type: 'field-compare', field: 'x' } as FlowCondition,
      ctx({ x: 1 }),
    );
    expect(result.matched).toBe(false);
    expect(result.explanation).toContain('requires an operator');
  });
});

// ---------------------------------------------------------------------------
// Unknown condition type
// ---------------------------------------------------------------------------

describe('evaluateCondition — unknown type', () => {
  it('returns false with explanation', () => {
    const result = evaluateCondition(
      { type: 'magic' as any },
      ctx({}),
    );
    expect(result.matched).toBe(false);
    expect(result.explanation).toContain('Unknown condition type');
  });
});
