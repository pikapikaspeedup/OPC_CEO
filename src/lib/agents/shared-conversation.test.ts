/**
 * V5.5 Shared Conversation Mode — Unit Tests
 *
 * Tests the decision logic for shared vs isolated conversation mode
 * in review-loop execution. Tests are structured as pure logic tests
 * since the actual runtime functions have deep gRPC/registry dependencies.
 */

import { describe, it, expect } from 'vitest';
import type { SharedConversationState } from './group-types';

// ---------------------------------------------------------------------------
// Replicate the core decision logic from group-runtime.ts for isolated testing
// ---------------------------------------------------------------------------

/** Replicates the priority resolution from executeReviewLoop */
function resolveSharedConversation(
  inputConversationMode: 'shared' | 'isolated' | undefined,
  envFlagEnabled: boolean,
): boolean {
  return inputConversationMode === 'shared' || (inputConversationMode !== 'isolated' && envFlagEnabled);
}

/** Replicates the canReuse check from executeReviewRound */
function canReuseConversation(
  sharedState: SharedConversationState | undefined,
  isReviewer: boolean,
  round: number,
): boolean {
  return !!(sharedState?.authorCascadeId && !isReviewer && round > 1);
}

/** Replicates the token safety-valve from executeReviewRound */
function shouldResetSharedState(
  sharedState: SharedConversationState | undefined,
  tokenResetThreshold: number,
): boolean {
  return !!(sharedState && sharedState.estimatedTokens > tokenResetThreshold);
}

// ---------------------------------------------------------------------------
// Tests: Conversation mode resolution (per-run vs env var)
// ---------------------------------------------------------------------------

describe('resolveSharedConversation', () => {
  it('returns false when both input and env are off', () => {
    expect(resolveSharedConversation(undefined, false)).toBe(false);
  });

  it('returns true when env var is enabled and input is undefined', () => {
    expect(resolveSharedConversation(undefined, true)).toBe(true);
  });

  it('returns true when input explicitly requests shared', () => {
    expect(resolveSharedConversation('shared', false)).toBe(true);
  });

  it('returns true when both input and env request shared', () => {
    expect(resolveSharedConversation('shared', true)).toBe(true);
  });

  it('returns false when input explicitly requests isolated, even if env is on', () => {
    expect(resolveSharedConversation('isolated', true)).toBe(false);
  });

  it('returns false when input explicitly requests isolated and env is off', () => {
    expect(resolveSharedConversation('isolated', false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: canReuse decision
// ---------------------------------------------------------------------------

describe('canReuseConversation', () => {
  const withCascade: SharedConversationState = { authorCascadeId: 'cascade-abc', estimatedTokens: 5000 };
  const withoutCascade: SharedConversationState = { estimatedTokens: 0 };

  it('returns false when sharedState is undefined (isolated mode)', () => {
    expect(canReuseConversation(undefined, false, 2)).toBe(false);
  });

  it('returns false on round 1 even when shared state exists', () => {
    expect(canReuseConversation(withCascade, false, 1)).toBe(false);
  });

  it('returns true for author on round 2 with existing cascade', () => {
    expect(canReuseConversation(withCascade, false, 2)).toBe(true);
  });

  it('returns true for author on round 3 with existing cascade', () => {
    expect(canReuseConversation(withCascade, false, 3)).toBe(true);
  });

  it('returns false for reviewer even with existing cascade on round 2', () => {
    expect(canReuseConversation(withCascade, true, 2)).toBe(false);
  });

  it('returns false when sharedState has no authorCascadeId', () => {
    expect(canReuseConversation(withoutCascade, false, 2)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Token safety-valve
// ---------------------------------------------------------------------------

describe('shouldResetSharedState (token safety-valve)', () => {
  const THRESHOLD = 100_000;

  it('returns false when sharedState is undefined', () => {
    expect(shouldResetSharedState(undefined, THRESHOLD)).toBe(false);
  });

  it('returns false when tokens are below threshold', () => {
    expect(shouldResetSharedState({ estimatedTokens: 50_000 }, THRESHOLD)).toBe(false);
  });

  it('returns false when tokens are exactly at threshold', () => {
    expect(shouldResetSharedState({ estimatedTokens: 100_000 }, THRESHOLD)).toBe(false);
  });

  it('returns true when tokens exceed threshold', () => {
    expect(shouldResetSharedState({ estimatedTokens: 100_001 }, THRESHOLD)).toBe(true);
  });

  it('returns true for large overages', () => {
    expect(shouldResetSharedState({ estimatedTokens: 500_000 }, THRESHOLD)).toBe(true);
  });

  it('respects custom threshold', () => {
    expect(shouldResetSharedState({ estimatedTokens: 60_000 }, 50_000)).toBe(true);
    expect(shouldResetSharedState({ estimatedTokens: 40_000 }, 50_000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: SharedConversationState lifecycle
// ---------------------------------------------------------------------------

describe('SharedConversationState lifecycle', () => {
  it('starts with zero estimated tokens', () => {
    const state: SharedConversationState = { estimatedTokens: 0 };
    expect(state.authorCascadeId).toBeUndefined();
    expect(state.estimatedTokens).toBe(0);
  });

  it('tracks authorCascadeId after first round dispatch', () => {
    let state: SharedConversationState = { estimatedTokens: 0 };

    // Simulate: first round creates cascade
    const cascadeId = 'cascade-123';
    const promptLength = 4000; // characters → /4 ≈ 1000 tokens
    state = { ...state, authorCascadeId: cascadeId, estimatedTokens: promptLength / 4 + 5000 };

    expect(state.authorCascadeId).toBe('cascade-123');
    expect(state.estimatedTokens).toBe(6000);
  });

  it('accumulates tokens across rounds', () => {
    let state: SharedConversationState = { authorCascadeId: 'cascade-123', estimatedTokens: 6000 };

    // Simulate: second round sends switch prompt
    const switchPromptLength = 2000;
    state = { ...state, estimatedTokens: state.estimatedTokens + switchPromptLength / 4 + 2000 };

    expect(state.estimatedTokens).toBe(8500);
    expect(state.authorCascadeId).toBe('cascade-123');
  });

  it('resets to undefined when token threshold exceeded', () => {
    let state: SharedConversationState | undefined = { authorCascadeId: 'cascade-123', estimatedTokens: 110_000 };

    // Simulate: safety valve check
    if (shouldResetSharedState(state, 100_000)) {
      state = undefined; // fallback to isolated
    }

    expect(state).toBeUndefined();
  });
});
