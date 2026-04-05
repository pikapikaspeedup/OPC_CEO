import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import type { BranchProgress, ProjectDefinition, ProjectPipelineState, PipelineStageProgress } from './project-types';
import { AssetLoader } from './asset-loader';
import { createLogger } from '../logger';
import { GATEWAY_HOME, PROJECTS_FILE, ARTIFACT_ROOT_DIR } from './gateway-home';
import { resolveStageId } from './pipeline-graph';

const log = createLogger('ProjectRegistry');

const PERSIST_FILE = PROJECTS_FILE;

// ---------------------------------------------------------------------------
// In-memory store (Preserved across Next.js HMR via globalThis)
// ---------------------------------------------------------------------------

const globalForProjects = globalThis as unknown as {
  __PROJECT_REGISTRY_MAP?: Map<string, ProjectDefinition>;
};

const projects = globalForProjects.__PROJECT_REGISTRY_MAP || new Map<string, ProjectDefinition>();
if (process.env.NODE_ENV !== 'production') {
  globalForProjects.__PROJECT_REGISTRY_MAP = projects;
}

function saveToDisk(): void {
  try {
    if (!existsSync(GATEWAY_HOME)) {
      mkdirSync(GATEWAY_HOME, { recursive: true });
    }
    const entries = Array.from(projects.values());
    writeFileSync(PERSIST_FILE, JSON.stringify(entries, null, 2), 'utf-8');

    // V3.6 Fix (E4): Synchronize per-project `project.json`
    for (const project of entries) {
      if (project.workspace) {
        const projectDir = path.join(project.workspace.replace(/^file:\/\//, ''), ARTIFACT_ROOT_DIR, 'projects', project.projectId);
        if (existsSync(projectDir)) {
          writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8');
        }
      }
    }

    log.debug({ count: entries.length }, 'Projects persisted');
  } catch (err: any) {
    log.error({ err: err.message }, 'Failed to persist projects');
  }
}

function loadFromDisk(): void {
  try {
    // If the Map is already populated, this is an HMR reload, not a cold start.
    // Skip loading from disk to preserve actual running states.
    if (projects.size > 0 && process.env.NODE_ENV !== 'production') {
      log.debug('Projects map already populated in Memory (HMR skipped disk load)');
      return;
    }

    if (!existsSync(PERSIST_FILE)) {
      // Fallback: try legacy path for backward compatibility
      const legacyFile = path.join(process.cwd(), 'data', 'projects.json');
      if (existsSync(legacyFile)) {
        log.info('Loading projects from legacy path, will save to new path on next write');
        const raw = readFileSync(legacyFile, 'utf-8');
        const entries: ProjectDefinition[] = JSON.parse(raw);
        for (const entry of entries) { projects.set(entry.projectId, entry); }
        saveToDisk();  // migrate to new path
        return;
      }
      return;
    }
    const raw = readFileSync(PERSIST_FILE, 'utf-8');
    const entries: ProjectDefinition[] = JSON.parse(raw);
    for (const entry of entries) {
      if (entry.pipelineState) {
        const template = entry.pipelineState.templateId ? AssetLoader.getTemplate(entry.pipelineState.templateId) : null;
        entry.pipelineState.stages = entry.pipelineState.stages.map((stage, idx) => {
          const templateStage = template?.pipeline[idx];
          return {
            ...stage,
            stageId: stage.stageId || (templateStage ? resolveStageId(templateStage) : stage.groupId),
            stageIndex: stage.stageIndex ?? idx,
          };
        });
        entry.pipelineState.activeStageIds = entry.pipelineState.activeStageIds
          || entry.pipelineState.stages.filter(stage => stage.status === 'running').map(stage => stage.stageId);
      }
      projects.set(entry.projectId, entry);
    }
    log.info({ total: entries.length }, 'Projects loaded from disk');
  } catch (err: any) {
    log.warn({ err: err.message }, 'Failed to load projects from disk');
  }
}

loadFromDisk();

export function createProject(input: {
  name: string;
  goal: string;
  templateId?: string;
  workspace: string;
  parentProjectId?: string;
  parentStageId?: string;
  branchIndex?: number;
  projectType?: 'coordinated' | 'adhoc' | 'strategic';
  skillHint?: string;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
}): ProjectDefinition {
  const projectId = randomUUID();
  const project: ProjectDefinition = {
    projectId,
    name: input.name,
    goal: input.goal,
    templateId: input.templateId,
    workspace: input.workspace,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runIds: [],
    parentProjectId: input.parentProjectId,
    parentStageId: input.parentStageId,
    branchIndex: input.branchIndex,
    projectType: input.projectType,
    skillHint: input.skillHint,
    priority: input.priority,
  };

  const projectDir = path.join(input.workspace.replace(/^file:\/\//, ''), ARTIFACT_ROOT_DIR, 'projects', projectId);
  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true });
  }
  const runsDir = path.join(projectDir, 'runs');
  if (!existsSync(runsDir)) {
    mkdirSync(runsDir, { recursive: true });
  }

  writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2), 'utf-8');

  projects.set(projectId, project);
  saveToDisk();
  log.info({ projectId, name: project.name }, 'Project created');
  return project;
}

export function getProject(projectId: string): ProjectDefinition | null {
  return projects.get(projectId) ?? null;
}

export function listProjects(): ProjectDefinition[] {
  return Array.from(projects.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function updateProject(projectId: string, updates: Partial<ProjectDefinition>): ProjectDefinition | null {
  const project = projects.get(projectId);
  if (!project) return null;

  Object.assign(project, updates);
  project.updatedAt = new Date().toISOString();

  saveToDisk();
  log.debug({ projectId }, 'Project updated');
  return project;
}

export function deleteProject(projectId: string): boolean {
  const project = projects.get(projectId);
  if (!project) return false;

  // Optional: Remove project directory if workspace is available
  if (project.workspace) {
    try {
      const { rmSync } = require('fs');
      const projectDir = path.join(project.workspace.replace(/^file:\/\//, ''), ARTIFACT_ROOT_DIR, 'projects', projectId);
      if (existsSync(projectDir)) {
        rmSync(projectDir, { recursive: true, force: true });
      }
    } catch (err: any) {
      log.warn({ err: err.message, projectId }, 'Failed to delete project directory');
    }
  }

  const deleted = projects.delete(projectId);
  if (deleted) {
    saveToDisk();
    log.info({ projectId }, 'Project deleted');
  }
  return deleted;
}

export function addRunToProject(projectId: string, runId: string): void {
  const project = projects.get(projectId);
  if (!project) return;

  if (!project.runIds.includes(runId)) {
    project.runIds.push(runId);
    project.updatedAt = new Date().toISOString();
    saveToDisk();
    log.debug({ projectId, runId }, 'Run added to project');
  }
}

// ---------------------------------------------------------------------------
// Pipeline State Management
// ---------------------------------------------------------------------------

/**
 * Initialize pipeline state on a project from its template.
 * Called when the first run for a template is dispatched.
 * V5.3: accepts optional templateOverrides to deep-merge onto the template before compiling.
 */
export function initializePipelineState(
  projectId: string,
  templateId: string,
  templateOverrides?: Record<string, unknown>,
): ProjectPipelineState | null {
  const project = projects.get(projectId);
  if (!project) return null;

  // Don't re-initialize if already set for same template
  if (project.pipelineState?.templateId === templateId) {
    return project.pipelineState;
  }

  const baseTemplate = AssetLoader.getTemplate(templateId);
  if (!baseTemplate) {
    log.warn({ projectId, templateId }, 'Cannot initialize pipeline state: template not found');
    return null;
  }

  // V5.3: Deep-merge runtime overrides onto a clone so the original asset stays untouched
  const template = templateOverrides
    ? deepMerge(structuredClone(baseTemplate), templateOverrides)
    : baseTemplate;

  let stages: PipelineStageProgress[] = [];
  if (template.pipeline) {
    stages = template.pipeline.map((stage: any, idx: number) => ({
      stageId: resolveStageId(stage),
      groupId: stage.groupId,
      stageIndex: idx,
      status: 'pending',
      attempts: 0,
    }));
  } else if (template.graphPipeline) {
    stages = template.graphPipeline.nodes.map((node: any, idx: number) => ({
      stageId: node.id,
      groupId: node.groupId || node.id,
      stageIndex: idx,
      status: 'pending',
      attempts: 0,
    }));
  }

  const pipelineState: ProjectPipelineState = {
    templateId,
    stages,
    activeStageIds: [],
    status: 'running',
    ...(templateOverrides ? { templateOverrides } : {}),
  };

  project.pipelineState = pipelineState;
  project.status = 'active';
  project.updatedAt = new Date().toISOString();
  saveToDisk();
  log.info({ projectId, templateId, stageCount: stages.length, hasOverrides: !!templateOverrides }, 'Pipeline state initialized');
  return pipelineState;
}

/** Deep-merge source into target (mutates target). Arrays are replaced, not concatenated. */
function deepMerge(target: any, source: any): any {
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

/**
 * Update a specific pipeline stage's status.
 * Called when a run starts, completes, or fails.
 */
function recomputePipelineState(project: ProjectDefinition): void {
  if (!project.pipelineState) return;
  const stages = project.pipelineState.stages;
  const hasFailedStage = stages.some(stage => stage.status === 'failed');
  const hasCancelledStage = stages.some(stage => stage.status === 'cancelled');
  const allComplete = stages.every(stage => stage.status === 'completed' || stage.status === 'skipped');

  if (allComplete) {
    project.pipelineState.status = 'completed';
    project.status = 'completed';
  } else if (hasFailedStage) {
    project.pipelineState.status = 'failed';
    project.status = 'failed';
  } else if (hasCancelledStage) {
    project.pipelineState.status = 'cancelled';
    project.status = 'cancelled';
  } else {
    project.pipelineState.status = 'running';
    project.status = 'active';
  }

  project.pipelineState.activeStageIds = stages
    .filter(stage => stage.status === 'running')
    .map(stage => stage.stageId);
}

function getStageByIdentifier(project: ProjectDefinition, stageIdentifier: string | number): PipelineStageProgress | null {
  if (!project.pipelineState) return null;
  if (typeof stageIdentifier === 'number') {
    return project.pipelineState.stages[stageIdentifier] ?? null;
  }
  return project.pipelineState.stages.find(stage => stage.stageId === stageIdentifier) ?? null;
}

export function updatePipelineStageByStageId(
  projectId: string,
  stageId: string,
  updates: Partial<PipelineStageProgress>,
): void {
  const project = projects.get(projectId);
  if (!project?.pipelineState) return;

  const stage = project.pipelineState.stages.find(item => item.stageId === stageId);
  if (!stage) return;

  Object.assign(stage, updates);
  recomputePipelineState(project);
  project.updatedAt = new Date().toISOString();
  saveToDisk();
  log.debug({ projectId, stageId, stageStatus: stage.status }, 'Pipeline stage updated');
}

export function updatePipelineStage(
  projectId: string,
  stageIndex: number,
  updates: Partial<PipelineStageProgress>,
): void {
  const project = projects.get(projectId);
  if (!project?.pipelineState) return;
  const stage = project.pipelineState.stages[stageIndex];
  if (!stage) return;
  updatePipelineStageByStageId(projectId, stage.stageId, updates);
}

export function updateBranchProgress(
  projectId: string,
  stageId: string,
  branchIndex: number,
  updates: Partial<BranchProgress>,
): void {
  const project = projects.get(projectId);
  if (!project?.pipelineState) return;
  const stage = project.pipelineState.stages.find(item => item.stageId === stageId);
  if (!stage) return;

  if (!stage.branches) {
    stage.branches = [];
  }

  const existing = stage.branches.find(branch => branch.branchIndex === branchIndex);
  if (existing) {
    Object.assign(existing, updates);
  } else {
    stage.branches.push({
      branchIndex,
      workPackageId: updates.workPackageId || `branch-${branchIndex}`,
      workPackageName: updates.workPackageName || `Branch ${branchIndex}`,
      subProjectId: updates.subProjectId || '',
      runId: updates.runId,
      status: updates.status || 'pending',
      lastError: updates.lastError,
      startedAt: updates.startedAt,
      completedAt: updates.completedAt,
    });
  }

  recomputePipelineState(project);
  project.updatedAt = new Date().toISOString();
  saveToDisk();
  log.debug({ projectId, stageId, branchIndex }, 'Branch progress updated');
}

/**
 * Find the first actionable stage in a project's pipeline.
 * Actionable means failed/blocked/cancelled or a stale active stage whose
 * canonical run has stopped making progress.
 */
export function getFirstActionableStage(projectId: string): PipelineStageProgress | null {
  const project = projects.get(projectId);
  if (!project?.pipelineState) return null;

  const { getRun } = require('./run-registry');
  return project.pipelineState.stages.find((stage: PipelineStageProgress) => {
    if (stage.status === 'failed' || stage.status === 'blocked' || stage.status === 'cancelled') {
      return true;
    }
    if (stage.branches?.some(branch => branch.status === 'failed' || branch.status === 'blocked' || branch.status === 'cancelled')) {
      return true;
    }
    if (stage.status !== 'running' || !stage.runId) {
      return false;
    }
    const run = getRun(stage.runId);
    return !!(run && (run.status === 'running' || run.status === 'starting') && run.liveState?.staleSince);
  }) ?? null;
}

/**
 * V3.5 Fix 8: Unified dispatch tracking for pipeline stages.
 * Single source of truth for attempts, runId, status, and startedAt.
 * Called by: API dispatch and runtime auto-trigger.
 */
export function trackStageDispatch(projectId: string, stageIdentifier: string | number, runId: string): void {
  const project = projects.get(projectId);
  if (!project?.pipelineState) return;
  const stage = getStageByIdentifier(project, stageIdentifier);
  if (!stage) return;

  stage.attempts = (stage.attempts || 0) + 1;
  stage.runId = runId;
  stage.status = 'running';
  stage.startedAt = new Date().toISOString();
  stage.lastError = undefined;

  recomputePipelineState(project);
  project.updatedAt = new Date().toISOString();
  saveToDisk();
  log.info({ projectId, stageId: stage.stageId, runId: runId.slice(0, 8), attempts: stage.attempts }, 'Pipeline stage dispatch tracked');
}

/**
 * V3.5: Narrow helper — only increment attempts counter for interventions.
 * Does NOT touch status, startedAt, or lastError (those are managed by the runtime).
 * Use this for nudge/retry where the stage status is already being managed asynchronously.
 */
export function incrementStageAttempts(projectId: string, stageIdentifier: string | number): void {
  const project = projects.get(projectId);
  if (!project?.pipelineState) return;
  const stage = getStageByIdentifier(project, stageIdentifier);
  if (!stage) return;

  stage.attempts = (stage.attempts || 0) + 1;
  project.updatedAt = new Date().toISOString();
  saveToDisk();
  log.debug({ projectId, stageId: stage.stageId, attempts: stage.attempts }, 'Stage attempts incremented');
}
