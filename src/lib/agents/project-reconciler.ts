import { createLogger } from '../logger';
import { AssetLoader } from './asset-loader';
import { getOrCompileIR } from './pipeline/dag-compiler';
import { canActivateNode } from './pipeline/dag-runtime';
import { getProject, updatePipelineStageByStageId, updateBranchProgress } from './project-registry';
import { getRun } from './run-registry';
import { emitProjectEvent } from './project-events';

const log = createLogger('ProjectReconciler');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ReconcileAction {
  kind: 'dispatch-stage' | 'fan-out' | 'complete-join' | 'sync-status' | 'noop';
  stageId?: string;
  branchIndex?: number;
  detail: string;
}

export interface ReconcileResult {
  projectId: string;
  dryRun: boolean;
  actions: ReconcileAction[];
}

// ---------------------------------------------------------------------------
// Mutex guard — prevents concurrent reconcile on the same project
// ---------------------------------------------------------------------------

const activeReconciles = new Set<string>();

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function reconcileProject(
  projectId: string,
  opts?: { dryRun?: boolean },
): Promise<ReconcileResult> {
  const dryRun = opts?.dryRun ?? true;

  // Concurrent reconcile guard
  if (activeReconciles.has(projectId)) {
    return {
      projectId,
      dryRun,
      actions: [{ kind: 'noop', detail: 'Reconcile already in progress for this project' }],
    };
  }

  const project = getProject(projectId);
  if (!project) {
    return { projectId, dryRun, actions: [{ kind: 'noop', detail: 'Project not found' }] };
  }

  const pipelineState = project.pipelineState;
  if (!pipelineState) {
    return { projectId, dryRun, actions: [{ kind: 'noop', detail: 'No pipeline state' }] };
  }

  // Completed / cancelled projects: noop
  if (pipelineState.status === 'completed' || pipelineState.status === 'cancelled') {
    return {
      projectId,
      dryRun,
      actions: [{ kind: 'noop', detail: `Project already ${pipelineState.status}` }],
    };
  }

  const template = AssetLoader.getTemplate(pipelineState.templateId);
  if (!template) {
    return { projectId, dryRun, actions: [{ kind: 'noop', detail: 'Template not found' }] };
  }

  const actions: ReconcileAction[] = [];

  const ir = getOrCompileIR(template);

  // 1. Check for pending normal stages whose upstreams are all completed
  for (const stage of pipelineState.stages) {
    if (stage.status !== 'pending') continue;

    const irNode = ir.nodes.find(n => n.id === stage.stageId);
    if (!irNode) continue;

    if (irNode.kind === 'fan-out' || irNode.kind === 'join') {
      continue; // Handled separately below
    }

    if (!irNode.autoTrigger) continue;

    const activation = canActivateNode(ir, stage.stageId, pipelineState);
    if (activation.canActivate) {
      actions.push({
        kind: 'dispatch-stage',
        stageId: stage.stageId,
        detail: `Normal stage '${stage.stageId}' is eligible for dispatch (upstream completed)`,
      });
    }
  }

  // 2. Check fan-out stages: upstream completed but no branches created
  for (const stage of pipelineState.stages) {
    const irNode = ir.nodes.find(n => n.id === stage.stageId);
    if (!irNode || irNode.kind !== 'fan-out') continue;

    if (stage.branches?.length) continue; // Already fanned out

    const activation = canActivateNode(ir, stage.stageId, pipelineState);
    if (activation.canActivate) {
      actions.push({
        kind: 'fan-out',
        stageId: stage.stageId,
        detail: `Fan-out stage '${stage.stageId}' eligible but not triggered`,
      });
    }
  }

  // 3. Check join stages: all branches completed but join still pending
  for (const stage of pipelineState.stages) {
    const irNode = ir.nodes.find(n => n.id === stage.stageId);
    if (!irNode || irNode.kind !== 'join' || !irNode.join?.sourceNodeId) continue;

    if (stage.status === 'completed') continue;

    const fanOutStage = pipelineState.stages.find(s => s.stageId === irNode.join!.sourceNodeId);
    if (!fanOutStage?.branches?.length) continue;

    const allCompleted = fanOutStage.branches.every(b => b.status === 'completed');
    if (allCompleted) {
      actions.push({
        kind: 'complete-join',
        stageId: stage.stageId,
        detail: `Join stage '${stage.stageId}' is ready (all ${fanOutStage.branches.length} branches completed)`,
      });
    }
  }

  // 4. Check branch status sync: child project completed/failed but branch not updated
  for (const stage of pipelineState.stages) {
    if (!stage.branches?.length) continue;

    for (const branch of stage.branches) {
      if (branch.status === 'completed' || branch.status === 'failed') continue;
      if (!branch.subProjectId) continue;

      const childProject = getProject(branch.subProjectId);
      if (!childProject?.pipelineState) continue;

      if (childProject.pipelineState.status === 'completed') {
        actions.push({
          kind: 'sync-status',
          stageId: stage.stageId,
          branchIndex: branch.branchIndex,
          detail: `Branch ${branch.branchIndex} child project completed but branch status is '${branch.status}'`,
        });
      } else if (
        (childProject.pipelineState.status === 'failed' || childProject.pipelineState.status === 'cancelled') &&
        branch.status === 'running'
      ) {
        actions.push({
          kind: 'sync-status',
          stageId: stage.stageId,
          branchIndex: branch.branchIndex,
          detail: `Branch ${branch.branchIndex} child project ${childProject.pipelineState.status} but branch status is 'running'`,
        });
      }
    }
  }

  // 5. Check activeStageIds consistency
  const actualActive = pipelineState.stages
    .filter(s => s.status === 'running')
    .map(s => s.stageId);
  const recordedActive = pipelineState.activeStageIds;
  const activeMatch =
    actualActive.length === recordedActive.length &&
    actualActive.every(id => recordedActive.includes(id));

  if (!activeMatch) {
    actions.push({
      kind: 'sync-status',
      detail: `activeStageIds mismatch: recorded [${recordedActive.join(', ')}] vs actual [${actualActive.join(', ')}]`,
    });
  }

  if (actions.length === 0) {
    actions.push({ kind: 'noop', detail: 'No reconcile actions needed — project state is consistent' });
  }

  // Execute if not dry-run
  if (!dryRun && actions.some(a => a.kind !== 'noop')) {
    activeReconciles.add(projectId);
    try {
      await executeReconcileActions(projectId, actions);
      try {
        const { appendAuditEvent } = await import('./ops-audit');
        appendAuditEvent({
          kind: 'project:reconciled',
          projectId,
          message: `Reconciled: ${actions.filter(a => a.kind !== 'noop').length} action(s)`,
          meta: { actions: actions.filter(a => a.kind !== 'noop').map(a => `${a.kind}:${a.stageId || ''}`) },
        });
      } catch { /* audit non-critical */ }
    } finally {
      activeReconciles.delete(projectId);
    }
  } else if (dryRun && actions.some(a => a.kind !== 'noop')) {
    try {
      const { appendAuditEvent } = await import('./ops-audit');
      appendAuditEvent({
        kind: 'project:reconcile-skipped',
        projectId,
        message: `Dry-run reconcile: ${actions.filter(a => a.kind !== 'noop').length} action(s) identified`,
      });
    } catch { /* audit non-critical */ }
  }

  return { projectId, dryRun, actions };
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

async function executeReconcileActions(projectId: string, actions: ReconcileAction[]): Promise<void> {
  for (const action of actions) {
    try {
      switch (action.kind) {
        case 'dispatch-stage':
          await executeDispatchStage(projectId, action.stageId!);
          break;
        case 'fan-out':
          await executeFanOut(projectId, action.stageId!);
          break;
        case 'complete-join':
          await executeCompleteJoin(projectId, action.stageId!);
          break;
        case 'sync-status':
          executeSyncStatus(projectId, action);
          break;
        case 'noop':
          break;
      }
      log.info({ projectId, action: action.kind, stageId: action.stageId }, 'Reconcile action executed');
    } catch (err: any) {
      log.error({ projectId, action: action.kind, stageId: action.stageId, err: err.message }, 'Reconcile action failed');
    }
  }
}

async function executeDispatchStage(projectId: string, stageId: string): Promise<void> {
  const project = getProject(projectId);
  if (!project?.pipelineState || !project.workspace) return;

  const template = AssetLoader.getTemplate(project.pipelineState.templateId);
  if (!template) return;

  const ir = getOrCompileIR(template);
  const irNode = ir.nodes.find(n => n.id === stageId);
  if (!irNode) return;

  // Re-check activation (idempotency guard) — use IR-based activation
  const activation = canActivateNode(ir, stageId, project.pipelineState);
  if (!activation.canActivate) return;

  const stage = project.pipelineState.stages.find(s => s.stageId === stageId);
  if (!stage || stage.status !== 'pending') return;

  // Collect upstream run IDs from IR activation result
  const upstreamStageIds = activation.upstreamNodeIds.length > 0
    ? activation.upstreamNodeIds
    : [];

  const { filterSourcesByNode } = await import('./pipeline/dag-runtime');
  const allSourceRunIds = upstreamStageIds.flatMap(upId => {
    const upStage = project.pipelineState!.stages.find(s => s.stageId === upId);
    return upStage?.runId ? [upStage.runId] : [];
  });
  const sourceRunIds = filterSourcesByNode(ir, stageId, allSourceRunIds);

  const { dispatchRun } = await import('./group-runtime');
  const { addRunToProject, trackStageDispatch } = await import('./project-registry');

  const result = await dispatchRun({
    stageId: stageId,
    workspace: project.workspace,
    prompt: irNode.promptTemplate || project.goal,
    projectId: project.projectId,
    pipelineId: template.id,
    templateId: template.id,
    pipelineStageId: stageId,
    sourceRunIds,
  });

  addRunToProject(project.projectId, result.runId);
  trackStageDispatch(project.projectId, stageId, result.runId);
}

async function executeFanOut(projectId: string, stageId: string): Promise<void> {
  // Re-emit the upstream stage:completed event to let fan-out-controller handle it
  // This is safer than duplicating fan-out logic
  const project = getProject(projectId);
  if (!project?.pipelineState) return;

  const template = AssetLoader.getTemplate(project.pipelineState.templateId);
  if (!template) return;

  const ir = getOrCompileIR(template);
  const irNode = ir.nodes.find(n => n.id === stageId);
  if (!irNode || irNode.kind !== 'fan-out') return;

  // Idempotency: check branches don't already exist
  const stage = project.pipelineState.stages.find(s => s.stageId === stageId);
  if (stage?.branches?.length) return;

  // Find completed upstream nodes via IR edges
  const upstreamNodeIds = ir.edges
    .filter(e => e.to === stageId)
    .map(e => e.from);

  for (const upstreamId of upstreamNodeIds) {
    const upstreamProgress = project.pipelineState.stages.find(s => s.stageId === upstreamId);
    if (upstreamProgress?.status === 'completed') {
      // Re-emit to trigger fan-out-controller
      emitProjectEvent({
        type: 'stage:completed',
        projectId,
        stageId: upstreamId,
        runId: upstreamProgress.runId || '',
      });
      return;
    }
  }
}

async function executeCompleteJoin(projectId: string, stageId: string): Promise<void> {
  const project = getProject(projectId);
  if (!project?.pipelineState) return;

  const template = AssetLoader.getTemplate(project.pipelineState.templateId);
  if (!template) return;

  const ir = getOrCompileIR(template);
  const irNode = ir.nodes.find(n => n.id === stageId);
  if (!irNode || irNode.kind !== 'join' || !irNode.join?.sourceNodeId) return;

  // Idempotency: check join isn't already completed
  const joinStage = project.pipelineState.stages.find(s => s.stageId === stageId);
  if (joinStage?.status === 'completed') return;

  const fanOutStage = project.pipelineState.stages.find(s => s.stageId === irNode.join!.sourceNodeId);
  if (!fanOutStage?.branches?.every(b => b.status === 'completed')) return;

  // Mark fan-out stage as completed
  updatePipelineStageByStageId(projectId, irNode.join!.sourceNodeId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });

  // Mark join stage as completed
  updatePipelineStageByStageId(projectId, stageId, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });
  updatePipelineStageByStageId(projectId, stageId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });

  emitProjectEvent({ type: 'stage:completed', projectId, stageId, runId: '', nodeKind: 'join' });
}

function executeSyncStatus(projectId: string, action: ReconcileAction): void {
  if (action.stageId && action.branchIndex !== undefined) {
    const project = getProject(projectId);
    if (!project?.pipelineState) return;

    const stage = project.pipelineState.stages.find(s => s.stageId === action.stageId);
    const branch = stage?.branches?.find(b => b.branchIndex === action.branchIndex);
    if (!branch?.subProjectId) return;

    const childProject = getProject(branch.subProjectId);
    if (!childProject?.pipelineState) return;

    if (childProject.pipelineState.status === 'completed') {
      const outputRunId = [...(childProject.pipelineState.stages || [])]
        .reverse()
        .find(s => s.runId && (s.status === 'completed' || s.status === 'skipped'))
        ?.runId;

      updateBranchProgress(projectId, action.stageId, action.branchIndex, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        runId: outputRunId,
      });
    } else if (childProject.pipelineState.status === 'failed' || childProject.pipelineState.status === 'cancelled') {
      updateBranchProgress(projectId, action.stageId, action.branchIndex, {
        status: 'failed',
        lastError: childProject.pipelineState.status,
        completedAt: new Date().toISOString(),
      });
    }
  }
  // activeStageIds mismatch is auto-corrected by recomputePipelineState on any stage update
}
