/**
 * Approval Request Store
 *
 * In-memory storage with optional JSON file persistence.
 * Provides CRUD operations for ApprovalRequest objects.
 *
 * Input:  CreateApprovalInput → creates ApprovalRequest
 * Output: ApprovalRequest (with generated id, timestamps)
 *
 * Persistence: Writes to `~/.gemini/antigravity/requests/` directory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { createLogger } from '../logger';
import type { ApprovalRequest, ApprovalResponse, CreateApprovalInput } from './types';

const log = createLogger('RequestStore');

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const requests = new Map<string, ApprovalRequest>();

// ---------------------------------------------------------------------------
// Persistence directory
// ---------------------------------------------------------------------------

function getStoreDir(): string {
  return path.join(process.env.HOME || '~', '.gemini', 'antigravity', 'requests');
}

function ensureStoreDir(): void {
  const dir = getStoreDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function persistRequest(request: ApprovalRequest): void {
  try {
    ensureStoreDir();
    const filePath = path.join(getStoreDir(), `${request.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(request, null, 2));
  } catch (err: any) {
    log.warn({ requestId: request.id, err: err.message }, 'Failed to persist request');
  }
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Create a new approval request.
 *
 * @param input — Request details.
 * @returns The created ApprovalRequest with generated id and timestamps.
 */
export function createApprovalRequest(input: CreateApprovalInput): ApprovalRequest {
  const now = new Date().toISOString();
  const request: ApprovalRequest = {
    id: randomUUID(),
    type: input.type,
    workspace: input.workspace,
    runId: input.runId,
    title: input.title,
    description: input.description,
    urgency: input.urgency || 'normal',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    onApproved: input.onApproved,
    onRejected: input.onRejected,
    onFeedback: input.onFeedback,
    notifications: [],
  };

  requests.set(request.id, request);
  persistRequest(request);

  log.info({ requestId: request.id, type: request.type, workspace: request.workspace }, 'Approval request created');
  return request;
}

/**
 * Get a request by ID.
 */
export function getApprovalRequest(id: string): ApprovalRequest | undefined {
  return requests.get(id);
}

/**
 * List all requests, optionally filtered.
 */
export function listApprovalRequests(filter?: {
  status?: string
  workspace?: string
  type?: string
}): ApprovalRequest[] {
  let result = Array.from(requests.values());

  if (filter?.status) {
    result = result.filter(r => r.status === filter.status);
  }
  if (filter?.workspace) {
    result = result.filter(r => r.workspace === filter.workspace);
  }
  if (filter?.type) {
    result = result.filter(r => r.type === filter.type);
  }

  // Sort by urgency (critical first) then by createdAt (newest first)
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
  result.sort((a, b) => {
    const ua = urgencyOrder[a.urgency] ?? 9;
    const ub = urgencyOrder[b.urgency] ?? 9;
    if (ua !== ub) return ua - ub;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return result;
}

/**
 * Update a request's response (CEO action).
 *
 * @param id — Request ID.
 * @param response — CEO's response.
 * @returns Updated request, or undefined if not found.
 */
export function respondToRequest(id: string, response: ApprovalResponse): ApprovalRequest | undefined {
  const request = requests.get(id);
  if (!request) return undefined;

  const updated: ApprovalRequest = {
    ...request,
    status: response.action === 'feedback' ? 'feedback' : response.action,
    response,
    updatedAt: new Date().toISOString(),
  };

  requests.set(id, updated);
  persistRequest(updated);

  log.info({ requestId: id, action: response.action, channel: response.channel }, 'Request responded');
  return updated;
}

/**
 * Load persisted requests from disk into memory.
 * Called once at startup.
 */
export function loadPersistedRequests(): number {
  const dir = getStoreDir();
  if (!fs.existsSync(dir)) return 0;

  let count = 0;
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        if (data.id) {
          requests.set(data.id, data);
          count++;
        }
      } catch {
        // Skip invalid files
      }
    }
  } catch (err: any) {
    log.warn({ err: err.message }, 'Failed to load persisted requests');
  }

  log.info({ count }, 'Persisted requests loaded');
  return count;
}

/**
 * Get request count by status (for dashboard summary).
 */
export function getRequestSummary(): Record<string, number> {
  const summary: Record<string, number> = {
    pending: 0,
    approved: 0,
    rejected: 0,
    feedback: 0,
    total: 0,
  };

  for (const r of requests.values()) {
    summary[r.status] = (summary[r.status] || 0) + 1;
    summary.total++;
  }

  return summary;
}
