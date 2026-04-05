import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from 'fs';
import path from 'path';
import { createLogger } from '../logger';
import { GATEWAY_HOME } from './gateway-home';

const log = createLogger('OpsAudit');

const AUDIT_DIR = path.join(GATEWAY_HOME, 'ops_audit');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AuditEventKind =
  | 'scheduler:triggered'
  | 'scheduler:failed'
  | 'project:reconciled'
  | 'project:reconcile-skipped'
  | 'stage:completed'
  | 'fanout:started'
  | 'branch:created'
  | 'branch:completed'
  | 'branch:stale'
  | 'join:completed'
  | 'operator:resume'
  | 'operator:cancel'
  // V5.2 — control-flow events
  | 'checkpoint:created'
  | 'checkpoint:restored'
  | 'gate:approved'
  | 'gate:rejected'
  | 'switch:evaluated'
  | 'loop:iteration'
  | 'loop:terminated'
  // V5.3 — AI generation events
  | 'template:ai-generated'
  | 'template:ai-confirmed'
  | 'template:ai-rejected'
  | 'template:updated'
  | 'template:deleted'
  | 'template:cloned'
  // V5.4 — resource policy events
  | 'policy:violation-warn'
  | 'policy:violation-block';

export interface AuditEvent {
  timestamp: string;
  kind: AuditEventKind;
  projectId?: string;
  stageId?: string;
  branchIndex?: number;
  jobId?: string;
  message: string;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureAuditDir(): void {
  if (!existsSync(AUDIT_DIR)) {
    mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

function getAuditFilePath(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`; // YYYY-MM-DD local
  return path.join(AUDIT_DIR, `ops_audit_${dateStr}.jsonl`);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

export function appendAuditEvent(
  input: Omit<AuditEvent, 'timestamp'>,
): void {
  const event: AuditEvent = {
    timestamp: new Date().toISOString(),
    ...input,
  };

  try {
    ensureAuditDir();
    const filePath = getAuditFilePath(new Date());
    appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf-8');
  } catch (err: any) {
    log.error({ err: err.message }, 'Failed to append audit event');
  }
}

// ---------------------------------------------------------------------------
// Read / Query
// ---------------------------------------------------------------------------

export interface AuditQueryOptions {
  /** Filter by event kind */
  kind?: AuditEventKind;
  /** Filter by project ID */
  projectId?: string;
  /** Maximum number of events to return (default: 100) */
  limit?: number;
  /** Start date (inclusive, ISO string or YYYY-MM-DD) */
  since?: string;
  /** End date (inclusive, ISO string or YYYY-MM-DD) */
  until?: string;
}

export function queryAuditEvents(opts?: AuditQueryOptions): AuditEvent[] {
  const limit = opts?.limit ?? 100;
  const results: AuditEvent[] = [];

  try {
    ensureAuditDir();
    const files = readdirSync(AUDIT_DIR)
      .filter(f => f.startsWith('ops_audit_') && f.endsWith('.jsonl'))
      .sort()
      .reverse(); // Most recent first

    // Date range filtering on file names
    const sinceDate = opts?.since?.slice(0, 10);
    const untilDate = opts?.until?.slice(0, 10);

    for (const file of files) {
      const fileDate = file.replace('ops_audit_', '').replace('.jsonl', '');
      if (sinceDate && fileDate < sinceDate) continue;
      if (untilDate && fileDate > untilDate) continue;

      const filePath = path.join(AUDIT_DIR, file);
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean).reverse(); // Most recent first within file

      for (const line of lines) {
        if (results.length >= limit) break;
        try {
          const event: AuditEvent = JSON.parse(line);
          if (opts?.kind && event.kind !== opts.kind) continue;
          if (opts?.projectId && event.projectId !== opts.projectId) continue;
          if (opts?.since && event.timestamp < opts.since) continue;
          if (opts?.until && event.timestamp > opts.until) continue;
          results.push(event);
        } catch {
          // Skip malformed lines
        }
      }

      if (results.length >= limit) break;
    }
  } catch (err: any) {
    log.error({ err: err.message }, 'Failed to query audit events');
  }

  return results.slice(0, limit);
}
