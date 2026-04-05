/**
 * Checkpoint Manager — V5.2a
 *
 * Creates, lists, and restores pipeline state snapshots.
 * Used by loop iterations and manual replay/resume.
 *
 * Persistence: one JSON file per checkpoint under
 *   ~/.gemini/antigravity/gateway/projects/{projectId}/checkpoints/{id}.json
 *
 * Retention: max 10 checkpoints per project (oldest trimmed).
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';
import { createLogger } from '../logger';
import { GATEWAY_HOME } from './gateway-home';
import type { ProjectPipelineState, PipelineStageProgress } from './project-types';

const log = createLogger('CheckpointManager');

const MAX_CHECKPOINTS_PER_PROJECT = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Checkpoint {
  /** Unique checkpoint ID */
  id: string;
  /** Owning project */
  projectId: string;
  /** ISO-8601 creation timestamp */
  createdAt: string;
  /** Node that triggered this checkpoint */
  nodeId: string;
  /** Loop iteration index (if applicable) */
  iterationIndex?: number;
  /** Full pipeline state snapshot */
  snapshot: CheckpointSnapshot;
}

export interface CheckpointSnapshot {
  stages: PipelineStageProgress[];
  activeStageIds: string[];
  loopCounters: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function checkpointsDir(projectId: string): string {
  return path.join(GATEWAY_HOME, 'projects', projectId, 'checkpoints');
}

function checkpointFile(projectId: string, checkpointId: string): string {
  return path.join(checkpointsDir(projectId), `${checkpointId}.json`);
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _counter = 0;

function generateCheckpointId(): string {
  return `cp-${Date.now()}-${++_counter}`;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Create a checkpoint for the given project and persist it.
 * Automatically enforces the retention limit (oldest trimmed).
 */
export function createCheckpoint(
  projectId: string,
  nodeId: string,
  state: ProjectPipelineState,
  loopCounters: Record<string, number>,
  iterationIndex?: number,
): Checkpoint {
  const checkpoint: Checkpoint = {
    id: generateCheckpointId(),
    projectId,
    createdAt: new Date().toISOString(),
    nodeId,
    iterationIndex,
    snapshot: {
      stages: structuredClone(state.stages),
      activeStageIds: [...state.activeStageIds],
      loopCounters: { ...loopCounters },
    },
  };

  try {
    const dir = checkpointsDir(projectId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(
      checkpointFile(projectId, checkpoint.id),
      JSON.stringify(checkpoint, null, 2),
      'utf-8',
    );
    trimOldCheckpoints(projectId);
  } catch (err: any) {
    log.error({ err: err.message, projectId }, 'Failed to create checkpoint');
  }

  return checkpoint;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * List all checkpoints for a project, sorted by createdAt ascending.
 */
export function listCheckpoints(projectId: string): Checkpoint[] {
  const dir = checkpointsDir(projectId);
  if (!existsSync(dir)) return [];

  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    const checkpoints: Checkpoint[] = files.map(f => {
      const raw = readFileSync(path.join(dir, f), 'utf-8');
      return JSON.parse(raw) as Checkpoint;
    });
    checkpoints.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return checkpoints;
  } catch (err: any) {
    log.error({ err: err.message, projectId }, 'Failed to list checkpoints');
    return [];
  }
}

/**
 * Restore pipeline state from a specific checkpoint.
 * Returns the snapshot data — the caller decides whether to apply it.
 * Throws if the checkpoint does not exist.
 */
export function restoreFromCheckpoint(
  projectId: string,
  checkpointId: string,
): { state: Pick<ProjectPipelineState, 'stages' | 'activeStageIds'>; loopCounters: Record<string, number> } {
  const fp = checkpointFile(projectId, checkpointId);
  if (!existsSync(fp)) {
    throw new Error(`Checkpoint ${checkpointId} not found for project ${projectId}`);
  }

  const raw = readFileSync(fp, 'utf-8');
  const checkpoint = JSON.parse(raw) as Checkpoint;

  return {
    state: {
      stages: structuredClone(checkpoint.snapshot.stages),
      activeStageIds: [...checkpoint.snapshot.activeStageIds],
    },
    loopCounters: { ...checkpoint.snapshot.loopCounters },
  };
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Trim checkpoints beyond the retention limit, removing the oldest ones.
 */
function trimOldCheckpoints(projectId: string): void {
  const all = listCheckpoints(projectId);
  if (all.length <= MAX_CHECKPOINTS_PER_PROJECT) return;

  const toRemove = all.slice(0, all.length - MAX_CHECKPOINTS_PER_PROJECT);
  for (const cp of toRemove) {
    try {
      unlinkSync(checkpointFile(projectId, cp.id));
    } catch {
      // best-effort cleanup
    }
  }
}
