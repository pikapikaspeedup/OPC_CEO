/**
 * Execution Journal — V5.2a
 *
 * Records every control-flow decision made during pipeline execution:
 * node activations, condition evaluations, branch selections,
 * loop iterations and checkpoint creations.
 *
 * Persistence: one JSONL file per project under
 *   ~/.gemini/antigravity/gateway/projects/{projectId}/journal.jsonl
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import path from 'path';
import { createLogger } from '../logger';
import { GATEWAY_HOME } from './gateway-home';

const log = createLogger('ExecutionJournal');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JournalEventType =
  | 'node:activated'
  | 'node:completed'
  | 'node:failed'
  | 'condition:evaluated'
  | 'gate:decided'
  | 'switch:routed'
  | 'loop:iteration'
  | 'loop:terminated'
  | 'checkpoint:created'
  | 'checkpoint:restored';

export interface JournalEntry {
  /** Auto-generated entry ID */
  entryId: string;
  /** Project this entry belongs to */
  projectId: string;
  /** Related node ID */
  nodeId: string;
  /** Node kind at time of recording */
  nodeKind: string;
  /** What happened */
  eventType: JournalEventType;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Event-specific payload */
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function projectDir(projectId: string): string {
  return path.join(GATEWAY_HOME, 'projects', projectId);
}

function journalPath(projectId: string): string {
  return path.join(projectDir(projectId), 'journal.jsonl');
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

let _counter = 0;

/**
 * Generate a short, unique-enough entry ID.
 * Format: `je-{timestamp_ms}-{counter}`
 */
function generateEntryId(): string {
  return `je-${Date.now()}-${++_counter}`;
}

/**
 * Append a journal entry for a project.
 * Creates the project directory if it does not exist.
 */
export function appendJournalEntry(
  input: Omit<JournalEntry, 'entryId' | 'timestamp'>,
): JournalEntry {
  const entry: JournalEntry = {
    entryId: generateEntryId(),
    timestamp: new Date().toISOString(),
    ...input,
  };

  try {
    const dir = projectDir(input.projectId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const fp = journalPath(input.projectId);
    appendFileSync(fp, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err: any) {
    log.error({ err: err.message, projectId: input.projectId }, 'Failed to append journal entry');
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface JournalQueryOptions {
  /** Filter by node ID */
  nodeId?: string;
  /** Filter by event type */
  eventType?: JournalEventType;
  /** Maximum entries to return (default: 200) */
  limit?: number;
}

/**
 * Read and optionally filter the journal for a project.
 * Returns entries in chronological order (oldest first).
 */
export function queryJournal(
  projectId: string,
  opts?: JournalQueryOptions,
): JournalEntry[] {
  const limit = opts?.limit ?? 200;
  const fp = journalPath(projectId);

  if (!existsSync(fp)) return [];

  try {
    const raw = readFileSync(fp, 'utf-8');
    let entries: JournalEntry[] = raw
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as JournalEntry);

    if (opts?.nodeId) {
      entries = entries.filter(e => e.nodeId === opts.nodeId);
    }
    if (opts?.eventType) {
      entries = entries.filter(e => e.eventType === opts.eventType);
    }

    return entries.slice(-limit);
  } catch (err: any) {
    log.error({ err: err.message, projectId }, 'Failed to read journal');
    return [];
  }
}

/**
 * Shorthand: get all journal entries for a specific node.
 */
export function getNodeJournal(
  projectId: string,
  nodeId: string,
): JournalEntry[] {
  return queryJournal(projectId, { nodeId });
}
