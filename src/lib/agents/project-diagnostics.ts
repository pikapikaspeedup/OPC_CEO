import { createLogger } from '../logger';
import { AssetLoader } from './asset-loader';
import { resolveStageId } from './pipeline/pipeline-graph';
import { validateTemplateContracts } from './contract-validator';
import { getOrCompileIR } from './pipeline/dag-compiler';
import { canActivateNode } from './pipeline/dag-runtime';
import { getProject, listProjects } from './project-registry';
import { getRun } from './run-registry';
import type { ProjectDefinition, PipelineStageProgress, BranchProgress } from './project-types';
import type { PipelineStage } from './pipeline/pipeline-types';

const log = createLogger('ProjectDiagnostics');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HealthStatus = 'running' | 'waiting' | 'blocked' | 'stale' | 'failed' | 'completed';
export type OrchestrationState = 'na' | 'waiting' | 'eligible' | 'completed';

export interface ProjectDiagnostics {
  projectId: string;
  /** Raw project status from runtime */
  projectStatus: string;
  /** Derived health — the primary display status for UI and MCP */
  health: HealthStatus;
  activeStageIds: string[];
  canReconcile: boolean;
  summary: string;
  recommendedActions: string[];
  stages: StageDiagnostics[];
  branches: BranchDiagnostics[];
}

export interface StageDiagnostics {
  stageId: string;
  stageTitle?: string;
  stageType: 'normal' | 'fan-out' | 'join';
  status: string;
  pendingReason?: string;
  waitingOnStageIds?: string[];
  staleSince?: string;
  orchestrationState?: OrchestrationState;
  recommendedActions: string[];
  /** Contract mismatch diagnostics (V4.4) */
  contractIssues?: string[];
}

export interface BranchDiagnostics {
  parentStageId: string;
  branchIndex: number;
  subProjectId?: string;
  runId?: string;
  status: string;
  health: HealthStatus;
  staleSince?: string;
  failureReason?: string;
  recommendedActions: string[];
}

export interface ProjectGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  stageId: string;
  stageTitle?: string;
  stageType: string;
  status: string;
  active: boolean;
  branchCompleted?: number;
  branchTotal?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Diagnostics analysis
// ---------------------------------------------------------------------------

export function analyzeProject(projectId: string): ProjectDiagnostics | null {
  const project = getProject(projectId);
  if (!project) return null;

  const pipelineState = project.pipelineState;
  if (!pipelineState) {
    return {
      projectId,
      projectStatus: project.status,
      health: project.status === 'completed' ? 'completed' : 'waiting',
      activeStageIds: [],
      canReconcile: false,
      summary: 'No pipeline state initialized',
      recommendedActions: [],
      stages: [],
      branches: [],
    };
  }

  const template = AssetLoader.getTemplate(pipelineState.templateId);
  const ir = template ? getOrCompileIR(template) : null;
  const stageDiagnostics = pipelineState.stages.map(stage => {
    const templateStage = template?.pipeline?.find(s => resolveStageId(s) === stage.stageId);
    // Derive stageType from IR node kind instead of PipelineStage.stageType
    const irNode = ir?.nodes.find(n => n.id === stage.stageId);
    const stageType = irNode
      ? (irNode.kind === 'stage' ? 'normal' : irNode.kind) as 'normal' | 'fan-out' | 'join'
      : (templateStage?.stageType || 'normal') as 'normal' | 'fan-out' | 'join';
    return analyzeStage(project, stage, templateStage || null, stageType);
  });

  // V4.4: Inject contract issues into stage diagnostics
  if (template) {
    const contractResult = validateTemplateContracts(template);
    for (const err of [...contractResult.errors, ...contractResult.warnings]) {
      const diag = stageDiagnostics.find(s => s.stageId === err.stageId);
      if (diag) {
        if (!diag.contractIssues) diag.contractIssues = [];
        diag.contractIssues.push(err.message);
      }
    }
  }

  const branchDiagnostics: BranchDiagnostics[] = [];
  for (const stage of pipelineState.stages) {
    if (!stage.branches?.length) continue;
    for (const branch of stage.branches) {
      branchDiagnostics.push(analyzeBranch(stage.stageId, branch));
    }
  }

  const health = deriveProjectHealth(project, stageDiagnostics, branchDiagnostics);
  const canReconcile = stageDiagnostics.some(
    s => s.orchestrationState === 'eligible' || s.pendingReason?.includes('upstream completed'),
  );
  const summary = buildSummary(health, pipelineState.activeStageIds, stageDiagnostics, branchDiagnostics);
  const recommendedActions = buildProjectActions(health, canReconcile, stageDiagnostics);

  return {
    projectId,
    projectStatus: pipelineState.status,
    health,
    activeStageIds: pipelineState.activeStageIds,
    canReconcile,
    summary,
    recommendedActions,
    stages: stageDiagnostics,
    branches: branchDiagnostics,
  };
}

function analyzeStage(
  project: ProjectDefinition,
  stage: PipelineStageProgress,
  templateStage: PipelineStage | null,
  stageType: 'normal' | 'fan-out' | 'join',
): StageDiagnostics {
  const result: StageDiagnostics = {
    stageId: stage.stageId,
    stageTitle: stage.title || stage.stageId,
    stageType,
    status: stage.status,
    recommendedActions: [],
  };

  // Orchestration state
  if (stageType === 'normal') {
    result.orchestrationState = 'na';
  } else if (stage.status === 'completed') {
    result.orchestrationState = 'completed';
  } else if (stage.status === 'pending' || stage.status === 'running') {
    // Check if conditions are met — use IR-based activation
    const template = AssetLoader.getTemplate(project.pipelineState!.templateId);
    if (template) {
      const ir = getOrCompileIR(template);
      const activation = canActivateNode(ir, stage.stageId, project.pipelineState!);
      if (activation.canActivate && stage.status === 'pending') {
        result.orchestrationState = 'eligible';
      } else {
        result.orchestrationState = 'waiting';
        if (activation.pendingUpstreamIds.length > 0) {
          result.waitingOnStageIds = activation.pendingUpstreamIds;
        }
      }
    } else {
      result.orchestrationState = 'waiting';
    }
  } else {
    result.orchestrationState = 'na';
  }

  // Pending reason
  if (stage.status === 'pending') {
    const template = AssetLoader.getTemplate(project.pipelineState!.templateId);
    if (template) {
      const ir = getOrCompileIR(template);
      const activation = canActivateNode(ir, stage.stageId, project.pipelineState!);
      if (activation.canActivate) {
        result.pendingReason = `upstream completed but stage not triggered`;
        result.recommendedActions.push('reconcile');
      } else {
        result.pendingReason = `waiting on upstream ${activation.pendingUpstreamIds.join(', ')}`;
        result.waitingOnStageIds = activation.pendingUpstreamIds;
      }
    }
  }

  // Stale detection
  if (stage.status === 'running' && stage.runId) {
    const run = getRun(stage.runId);
    if (run?.liveState?.staleSince) {
      result.staleSince = run.liveState.staleSince;
      result.recommendedActions.push('nudge', 'resume');
    }
  }

  // Failed stage
  if (stage.status === 'failed') {
    result.recommendedActions.push('resume', 'cancel');
  }

  // Fan-out specific: check if eligible but no branches created
  if (stageType === 'fan-out' && stage.status === 'pending' && result.orchestrationState === 'eligible') {
    if (!stage.branches?.length) {
      result.pendingReason = 'fan-out eligible but not triggered';
      result.recommendedActions.push('reconcile');
    }
  }

  // Join specific: waiting for branches — resolve sourceNodeId from IR
  if (stageType === 'join') {
    const template = AssetLoader.getTemplate(project.pipelineState!.templateId);
    const irNode = template ? getOrCompileIR(template).nodes.find(n => n.id === stage.stageId) : null;
    const sourceNodeId = irNode?.join?.sourceNodeId || templateStage?.joinFrom;
    if (sourceNodeId) {
      const fanOutStage = project.pipelineState?.stages.find(s => s.stageId === sourceNodeId);
      if (fanOutStage?.branches?.length) {
        const completed = fanOutStage.branches.filter(b => b.status === 'completed').length;
        const total = fanOutStage.branches.length;
        if (completed < total && stage.status !== 'completed') {
          result.pendingReason = `join waiting for ${completed}/${total} branches`;
          result.orchestrationState = 'waiting';
        } else if (completed === total && stage.status === 'pending') {
          result.pendingReason = 'join ready but pending';
          result.orchestrationState = 'eligible';
          result.recommendedActions.push('reconcile');
        }
      }
    }
  }

  return result;
}

function analyzeBranch(parentStageId: string, branch: BranchProgress): BranchDiagnostics {
  const result: BranchDiagnostics = {
    parentStageId,
    branchIndex: branch.branchIndex,
    subProjectId: branch.subProjectId || undefined,
    runId: branch.runId || undefined,
    status: branch.status,
    health: 'running',
    failureReason: branch.lastError || undefined,
    recommendedActions: [],
  };

  if (branch.status === 'completed') {
    result.health = 'completed';
  } else if (branch.status === 'failed') {
    result.health = 'failed';
    result.failureReason = branch.lastError || 'unknown';
    result.recommendedActions.push('resume child project', 'cancel child project');
  } else if (branch.status === 'blocked' || branch.status === 'cancelled') {
    result.health = 'blocked';
    result.recommendedActions.push('resume child project');
  } else if (branch.status === 'running') {
    // Check child project for staleness
    if (branch.subProjectId) {
      const childProject = getProject(branch.subProjectId);
      if (!childProject) {
        result.health = 'failed';
        result.failureReason = 'child project not found';
        result.recommendedActions.push('reconcile');
      } else if (childProject.pipelineState) {
        if (childProject.pipelineState.status === 'failed' || childProject.pipelineState.status === 'cancelled') {
          result.health = 'failed';
          result.failureReason = `child project ${childProject.pipelineState.status}`;
          result.recommendedActions.push('resume child project');
        } else if (childProject.pipelineState.status === 'completed') {
          result.health = 'stale';
          result.failureReason = 'child project completed but branch status not synced';
          result.recommendedActions.push('reconcile');
        } else {
          // Check for stale runs
          const activeStage = childProject.pipelineState.stages.find(s => s.status === 'running' && s.runId);
          if (activeStage?.runId) {
            const run = getRun(activeStage.runId);
            if (run?.liveState?.staleSince) {
              result.health = 'stale';
              result.staleSince = run.liveState.staleSince;
              result.recommendedActions.push('nudge child project');
            }
          }
        }
      }
    }
  }

  return result;
}

function deriveProjectHealth(
  project: ProjectDefinition,
  stages: StageDiagnostics[],
  branches: BranchDiagnostics[],
): HealthStatus {
  const pipelineStatus = project.pipelineState?.status;
  if (pipelineStatus === 'completed') return 'completed';
  if (pipelineStatus === 'failed' || pipelineStatus === 'cancelled') return 'failed';

  // Check for stale runs
  if (stages.some(s => s.staleSince) || branches.some(b => b.health === 'stale')) {
    return 'stale';
  }

  // Check for blocked/failed branches
  if (branches.some(b => b.health === 'failed' || b.health === 'blocked')) {
    return 'blocked';
  }

  // Check for failed stages
  if (stages.some(s => s.status === 'failed' || s.status === 'blocked')) {
    return 'blocked';
  }

  // Active stages running
  const activeStageIds = project.pipelineState?.activeStageIds || [];
  if (activeStageIds.length > 0) {
    return 'running';
  }

  // No active stages but pending stages exist
  if (stages.some(s => s.status === 'pending')) {
    return 'waiting';
  }

  return 'running';
}

function buildSummary(
  health: HealthStatus,
  activeStageIds: string[],
  stages: StageDiagnostics[],
  branches: BranchDiagnostics[],
): string {
  const parts: string[] = [];
  parts.push(`Health: ${health}`);

  if (activeStageIds.length > 0) {
    parts.push(`Active: ${activeStageIds.join(', ')}`);
  }

  const staleBranches = branches.filter(b => b.health === 'stale' || b.health === 'failed');
  if (staleBranches.length > 0) {
    parts.push(`Problem branches: ${staleBranches.length}`);
  }

  const pendingEligible = stages.filter(s => s.orchestrationState === 'eligible');
  if (pendingEligible.length > 0) {
    parts.push(`Reconcile-eligible stages: ${pendingEligible.map(s => s.stageId).join(', ')}`);
  }

  return parts.join('. ');
}

function buildProjectActions(
  health: HealthStatus,
  canReconcile: boolean,
  stages: StageDiagnostics[],
): string[] {
  const actions: string[] = [];
  if (canReconcile) {
    actions.push('reconcile');
  }
  if (stages.some(s => s.status === 'failed')) {
    actions.push('resume failed stage');
  }
  if (health === 'stale') {
    actions.push('investigate stale runs');
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Graph data (independent from diagnostics)
// ---------------------------------------------------------------------------

export function buildProjectGraph(projectId: string): ProjectGraph | null {
  const project = getProject(projectId);
  if (!project?.pipelineState) return null;

  const template = AssetLoader.getTemplate(project.pipelineState.templateId);
  if (!template) return null;

  const ir = getOrCompileIR(template);

  const nodes: GraphNode[] = ir.nodes.map(node => {
    const progress = project.pipelineState!.stages.find(s => s.stageId === node.id);
    const branches = progress?.branches || [];

    return {
      stageId: node.id,
      stageTitle: node.title || node.label || node.id,
      stageType: node.kind === 'stage' ? 'normal' : node.kind,
      status: progress?.status || 'pending',
      active: project.pipelineState!.activeStageIds.includes(node.id),
      ...(branches.length > 0
        ? {
            branchCompleted: branches.filter(b => b.status === 'completed').length,
            branchTotal: branches.length,
          }
        : {}),
    };
  });

  const edges: GraphEdge[] = ir.edges.map(edge => ({
    from: edge.from,
    to: edge.to,
  }));

  return { nodes, edges };
}
