/**
 * Prompt Cache Break Detection
 * Ported from claude-code/src/services/api/promptCacheBreakDetection.ts
 *
 * Monitors cache hit rates across API calls and detects unexpected cache invalidations.
 * Two-phase approach:
 *   Phase 1 (pre-API): recordPromptState() — snapshot system prompt + tools hashes
 *   Phase 2 (post-API): checkForCacheBreak() — compare cache_read_tokens with previous
 */

import { createHash } from 'node:crypto';
import type { APITool, APIMessage } from './types';

// ─── Constants ──────────────────────────────────────────────────────

/** Minimum token drop to consider a cache break */
const MIN_CACHE_MISS_TOKENS = 2000;

/** Cache TTL thresholds for break cause attribution */
const CACHE_TTL_5MIN_MS = 5 * 60 * 1000;
const CACHE_TTL_1HOUR_MS = 60 * 60 * 1000;

/** Maximum tracked sources to prevent memory leak */
const MAX_TRACKED_SOURCES = 10;

/** Percentage drop threshold (5%) — drop below 95% of previous read = break */
const CACHE_BREAK_THRESHOLD = 0.05;

// ─── Types ──────────────────────────────────────────────────────────

export type PromptStateSnapshot = {
  /** Hash of the system prompt content */
  systemHash: string;
  /** Hash of all tool schemas combined */
  toolsHash: string;
  /** Per-tool hashes for identifying which tool changed */
  perToolHashes: Map<string, string>;
  /** Model name */
  model: string;
  /** Source identifier (e.g., 'repl', 'agent:default') */
  querySource?: string;
  /** Timestamp of the snapshot */
  timestamp: number;
};

export type CacheBreakCause =
  | 'system_prompt_changed'
  | 'tools_changed'
  | 'model_changed'
  | 'ttl_expired_5m'
  | 'ttl_expired_1h'
  | 'compaction'
  | 'unknown';

export type CacheBreakEvent = {
  cause: CacheBreakCause;
  prevCacheReadTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  tokenDrop: number;
  dropPercent: number;
  /** Which tools were added/removed/changed */
  toolChanges?: {
    added: string[];
    removed: string[];
    changed: string[];
  };
  /** When the previous state was recorded */
  prevTimestamp: number;
  /** Time since last API call (ms) */
  timeSinceLastCall: number;
  /** The query source that experienced the break */
  querySource?: string;
};

export type CacheMetrics = {
  /** Total cache read tokens across all calls */
  totalCacheReadTokens: number;
  /** Total cache creation tokens across all calls */
  totalCacheCreationTokens: number;
  /** Number of API calls tracked */
  callCount: number;
  /** Number of detected cache breaks */
  breakCount: number;
  /** Average cache hit rate (0-1) */
  averageCacheHitRate: number;
  /** History of cache breaks */
  breaks: CacheBreakEvent[];
};

// ─── PromptCacheMonitor ─────────────────────────────────────────────

export class PromptCacheMonitor {
  /** Previous state per query source */
  private stateBySource: Map<string, PromptStateSnapshot> = new Map();
  /** The snapshot BEFORE the current one (for tool diff) */
  private prevStateBySource: Map<string, PromptStateSnapshot> = new Map();
  /** Previous cache_read_tokens per source */
  private prevCacheReadBySource: Map<string, number> = new Map();
  /** Pending changes detected in Phase 1 */
  private pendingChanges: Map<string, CacheBreakCause[]> = new Map();
  /** Whether next drop is expected (after compaction) */
  private expectCacheDrop: Set<string> = new Set();

  /** Accumulated metrics */
  private metrics: CacheMetrics = {
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    callCount: 0,
    breakCount: 0,
    averageCacheHitRate: 0,
    breaks: [],
  };

  // ─── Phase 1: Record State ────────────────────────────────────

  /**
   * Record the prompt state before an API call.
   * Call this before sending the request.
   */
  recordPromptState(
    systemPrompt: string,
    tools: APITool[],
    model: string,
    querySource: string = 'default',
  ): void {
    const newSnapshot: PromptStateSnapshot = {
      systemHash: hashString(systemPrompt),
      toolsHash: hashTools(tools),
      perToolHashes: buildPerToolHashes(tools),
      model,
      querySource,
      timestamp: Date.now(),
    };

    const prevSnapshot = this.stateBySource.get(querySource);

    if (prevSnapshot) {
      // Detect what changed
      const changes: CacheBreakCause[] = [];

      if (prevSnapshot.systemHash !== newSnapshot.systemHash) {
        changes.push('system_prompt_changed');
      }

      if (prevSnapshot.toolsHash !== newSnapshot.toolsHash) {
        changes.push('tools_changed');
      }

      if (prevSnapshot.model !== newSnapshot.model) {
        changes.push('model_changed');
      }

      // Check TTL expiry
      const elapsed = newSnapshot.timestamp - prevSnapshot.timestamp;
      if (elapsed > CACHE_TTL_1HOUR_MS) {
        changes.push('ttl_expired_1h');
      } else if (elapsed > CACHE_TTL_5MIN_MS) {
        changes.push('ttl_expired_5m');
      }

      if (changes.length > 0) {
        this.pendingChanges.set(querySource, changes);
      }
    }

    // Store previous snapshot before overwriting
    if (prevSnapshot) {
      this.prevStateBySource.set(querySource, prevSnapshot);
    }
    this.stateBySource.set(querySource, newSnapshot);

    // Enforce max tracked sources
    if (this.stateBySource.size > MAX_TRACKED_SOURCES) {
      const oldest = [...this.stateBySource.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      if (oldest) {
        this.stateBySource.delete(oldest[0]);
        this.prevCacheReadBySource.delete(oldest[0]);
        this.pendingChanges.delete(oldest[0]);
      }
    }
  }

  // ─── Phase 2: Check Response ──────────────────────────────────

  /**
   * Check API response for unexpected cache breaks.
   * Call this after receiving the API response.
   *
   * @returns CacheBreakEvent if a break was detected, null otherwise
   */
  checkForCacheBreak(
    cacheReadTokens: number,
    cacheCreationTokens: number,
    inputTokens: number,
    querySource: string = 'default',
  ): CacheBreakEvent | null {
    this.metrics.callCount++;
    this.metrics.totalCacheReadTokens += cacheReadTokens;
    this.metrics.totalCacheCreationTokens += cacheCreationTokens;

    // Update average cache hit rate
    const totalInput = inputTokens + cacheReadTokens;
    if (totalInput > 0) {
      const hitRate = cacheReadTokens / totalInput;
      // Running average
      this.metrics.averageCacheHitRate =
        (this.metrics.averageCacheHitRate * (this.metrics.callCount - 1) + hitRate) /
        this.metrics.callCount;
    }

    const prevCacheRead = this.prevCacheReadBySource.get(querySource);
    this.prevCacheReadBySource.set(querySource, cacheReadTokens);

    // Skip detection if expecting a cache drop (compaction/deletion)
    if (this.expectCacheDrop.has(querySource)) {
      this.expectCacheDrop.delete(querySource);
      return null;
    }

    // Skip detection on first call (no baseline)
    if (prevCacheRead === undefined) {
      return null;
    }

    // Check if cache_read dropped significantly
    if (prevCacheRead === 0) {
      return null;
    }

    const tokenDrop = prevCacheRead - cacheReadTokens;
    const dropPercent = tokenDrop / prevCacheRead;

    if (dropPercent < CACHE_BREAK_THRESHOLD || tokenDrop < MIN_CACHE_MISS_TOKENS) {
      return null;
    }

    // Cache break detected!
    const snapshot = this.stateBySource.get(querySource);
    const pendingCauses = this.pendingChanges.get(querySource) ?? [];
    this.pendingChanges.delete(querySource);

    const cause = pendingCauses[0] ?? 'unknown';

    // Compute tool diff if tools changed
    let toolChanges: CacheBreakEvent['toolChanges'];
    if (pendingCauses.includes('tools_changed')) {
      const prevSnapshot = this.findPrevSnapshot(querySource);
      const currentSnapshot = this.stateBySource.get(querySource);
      if (prevSnapshot && currentSnapshot) {
        toolChanges = computeToolDiff(prevSnapshot.perToolHashes, currentSnapshot.perToolHashes);
      }
    }

    const breakEvent: CacheBreakEvent = {
      cause,
      prevCacheReadTokens: prevCacheRead,
      cacheReadTokens,
      cacheCreationTokens,
      tokenDrop,
      dropPercent: Math.round(dropPercent * 100),
      toolChanges,
      prevTimestamp: snapshot?.timestamp ?? Date.now(),
      timeSinceLastCall: snapshot ? Date.now() - snapshot.timestamp : 0,
      querySource,
    };

    this.metrics.breakCount++;
    this.metrics.breaks.push(breakEvent);

    return breakEvent;
  }

  // ─── Notifications ────────────────────────────────────────────

  /**
   * Notify that compaction occurred (expected cache drop).
   */
  notifyCompaction(querySource: string = 'default'): void {
    this.expectCacheDrop.add(querySource);
    // Reset baseline since compacted messages are shorter
    this.prevCacheReadBySource.delete(querySource);
  }

  /**
   * Notify that cache was explicitly deleted/invalidated.
   */
  notifyCacheDeletion(querySource: string = 'default'): void {
    this.expectCacheDrop.add(querySource);
  }

  // ─── Getters ──────────────────────────────────────────────────

  /**
   * Get accumulated cache metrics.
   */
  getMetrics(): Readonly<CacheMetrics> {
    return Object.freeze({ ...this.metrics, breaks: [...this.metrics.breaks] });
  }

  /**
   * Get current cache hit rate for a source.
   */
  getCacheHitRate(querySource: string = 'default'): number | null {
    const cacheRead = this.prevCacheReadBySource.get(querySource);
    if (cacheRead === undefined) return null;
    return cacheRead > 0 ? 1 : 0;
  }

  /**
   * Reset all tracking state.
   */
  reset(): void {
    this.stateBySource.clear();
    this.prevStateBySource.clear();
    this.prevCacheReadBySource.clear();
    this.pendingChanges.clear();
    this.expectCacheDrop.clear();
    this.metrics = {
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      callCount: 0,
      breakCount: 0,
      averageCacheHitRate: 0,
      breaks: [],
    };
  }

  // ─── Internal ─────────────────────────────────────────────────

  private findPrevSnapshot(querySource: string): PromptStateSnapshot | undefined {
    return this.prevStateBySource.get(querySource);
  }
}

// ─── Hash Utilities ─────────────────────────────────────────────────

function hashString(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function hashTools(tools: APITool[]): string {
  const content = tools.map(t => `${t.name}:${JSON.stringify(t.input_schema)}`).join('|');
  return hashString(content);
}

function buildPerToolHashes(tools: APITool[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const tool of tools) {
    map.set(tool.name, hashString(`${tool.description}:${JSON.stringify(tool.input_schema)}`));
  }
  return map;
}

function computeToolDiff(
  prev: Map<string, string>,
  current: Map<string, string>,
): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const [name, hash] of current) {
    if (!prev.has(name)) {
      added.push(name);
    } else if (prev.get(name) !== hash) {
      changed.push(name);
    }
  }

  for (const name of prev.keys()) {
    if (!current.has(name)) {
      removed.push(name);
    }
  }

  return { added, removed, changed };
}
