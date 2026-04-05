/**
 * DAG Runtime Engine — unified activation / traversal / filtering
 * based on DagIR rather than raw pipeline[] arrays.
 *
 * All stage/node activation decisions flow through this module.
 * pipeline-registry.ts delegates to these functions for backward compat.
 */

import { getRun } from './run-registry';
import { getGroup } from './group-registry';
import type { DagIR, DagNode, DagNodeActivation, FlowCondition } from './dag-ir-types';
import type { ProjectPipelineState } from './project-types';
import { evaluateCondition, type ConditionContext } from './flow-condition';

// ── Node Activation ─────────────────────────────────────────────────────────

/**
 * Determine whether a node can be activated given the current project state.
 *
 * Unified rules (applies to stage / fan-out / join):
 * 1. All upstream nodes (resolved via edges) must have status === 'completed'
 * 2. triggerOn === 'approved' → upstream run reviewOutcome must be 'approved'
 * 3. No node without upstream (entry node) is blocked
 */
export function canActivateNode(
  ir: DagIR,
  nodeId: string,
  projectState: ProjectPipelineState,
): DagNodeActivation {
  const node = ir.nodes.find(n => n.id === nodeId);
  if (!node) {
    return {
      nodeId,
      canActivate: false,
      reason: `Node '${nodeId}' not found in IR`,
      upstreamNodeIds: [],
      pendingUpstreamIds: [],
    };
  }

  // Find all upstream node IDs from edges
  const upstreamNodeIds = ir.edges
    .filter(e => e.to === nodeId)
    .map(e => e.from);

  if (upstreamNodeIds.length === 0) {
    return {
      nodeId,
      canActivate: true,
      reason: 'Entry node — no upstream dependencies',
      upstreamNodeIds: [],
      pendingUpstreamIds: [],
    };
  }

  const pendingUpstreamIds: string[] = [];
  const triggerOn = node.triggerOn || 'approved';

  for (const upId of upstreamNodeIds) {
    const progress = projectState.stages.find(s => s.stageId === upId);
    if (!progress || progress.status !== 'completed') {
      pendingUpstreamIds.push(upId);
      continue;
    }

    // Check review outcome when triggerOn === 'approved'
    if (triggerOn === 'approved' && progress.runId) {
      const upstreamRun = getRun(progress.runId);
      if (!upstreamRun || upstreamRun.reviewOutcome !== 'approved') {
        pendingUpstreamIds.push(upId);
      }
    }
  }

  // Gate-specific: upstream completed but still needs approval
  if (node.kind === 'gate' && pendingUpstreamIds.length === 0) {
    const gateProgress = projectState.stages.find(s => s.stageId === nodeId);
    const autoApprove = node.gate?.autoApprove ?? false;

    if (!autoApprove) {
      const approval = gateProgress?.gateApproval;
      if (!approval || approval.status === 'pending') {
        return {
          nodeId,
          canActivate: false,
          reason: 'Gate waiting for approval',
          upstreamNodeIds,
          pendingUpstreamIds: [],
        };
      }
      if (approval.status === 'rejected') {
        return {
          nodeId,
          canActivate: false,
          reason: 'Gate was rejected',
          upstreamNodeIds,
          pendingUpstreamIds: [],
        };
      }
    }
  }

  const canActivate = pendingUpstreamIds.length === 0;
  return {
    nodeId,
    canActivate,
    reason: canActivate
      ? 'All upstream nodes completed'
      : `Waiting on: ${pendingUpstreamIds.join(', ')}`,
    upstreamNodeIds,
    pendingUpstreamIds,
  };
}

// ── Downstream Traversal ────────────────────────────────────────────────────

/**
 * Get all downstream nodes for a given node ID.
 */
export function getDownstreamNodes(ir: DagIR, nodeId: string): DagNode[] {
  const downstreamIds = ir.edges
    .filter(e => e.from === nodeId)
    .map(e => e.to);

  return ir.nodes.filter(n => downstreamIds.includes(n.id));
}

// ── Bulk Activation ─────────────────────────────────────────────────────────

/**
 * Get all nodes that can currently be activated.
 * Used by reconciler and scheduler for batch advancement.
 */
export function getActivatableNodes(
  ir: DagIR,
  projectState: ProjectPipelineState,
): DagNodeActivation[] {
  const results: DagNodeActivation[] = [];

  for (const node of ir.nodes) {
    // Only check nodes that are in pending state
    const progress = projectState.stages.find(s => s.stageId === node.id);
    if (!progress || progress.status !== 'pending') continue;

    const activation = canActivateNode(ir, node.id, projectState);
    if (activation.canActivate) {
      results.push(activation);
    }
  }

  return results;
}

// ── Source Filtering ────────────────────────────────────────────────────────

/**
 * Filter source run IDs based on the target node's group sourceContract.
 * This is the IR-aware wrapper around the existing group-level filtering.
 *
 * Note: keeps the same runId-based interface as the legacy
 * filterSourcesByContract() for backward compatibility.
 */
export function filterSourcesByNode(
  ir: DagIR,
  nodeId: string,
  allSourceRunIds: string[],
): string[] {
  const node = ir.nodes.find(n => n.id === nodeId);
  if (!node) return allSourceRunIds;

  if (allSourceRunIds.length === 0) return allSourceRunIds;

  const group = getGroup(node.groupId);
  const acceptedSourceGroupIds = group?.sourceContract?.acceptedSourceGroupIds;
  if (!acceptedSourceGroupIds?.length) return allSourceRunIds;

  const accepted = new Set(acceptedSourceGroupIds);
  return allSourceRunIds.filter(runId => {
    const run = getRun(runId);
    return !!run && accepted.has(run.groupId);
  });
}

// ── Switch Evaluation (V5.2) ────────────────────────────────────────────────

export interface SwitchEvalResult {
  /** The selected branch label (or 'default') */
  selectedBranch: string;
  /** Node ID to activate */
  activateNodeId: string;
  /** Detailed evaluation explanation (for audit / journal) */
  explanation: string;
}

/**
 * Evaluate a switch node's branches and determine which downstream node to activate.
 * Returns the first matching branch, or the default, or throws if no match and no default.
 */
export function evaluateSwitch(
  node: DagNode,
  context: ConditionContext,
): SwitchEvalResult {
  if (node.kind !== 'switch' || !node.switch) {
    throw new Error(`evaluateSwitch called on non-switch node '${node.id}'`);
  }

  const explanations: string[] = [];

  for (const branch of node.switch.branches) {
    const result = evaluateCondition(branch.condition, context);
    explanations.push(`[${branch.label}] ${result.explanation}`);

    if (result.matched) {
      return {
        selectedBranch: branch.label,
        activateNodeId: branch.targetNodeId,
        explanation: explanations.join('; '),
      };
    }
  }

  // No branch matched — use default
  if (node.switch.defaultTargetNodeId) {
    explanations.push('[default] No condition matched, using default branch');
    return {
      selectedBranch: 'default',
      activateNodeId: node.switch.defaultTargetNodeId,
      explanation: explanations.join('; '),
    };
  }

  throw new Error(
    `Switch node '${node.id}': no condition matched and no default branch defined. Evaluations: ${explanations.join('; ')}`,
  );
}

// ── Loop Evaluation (V5.2) ──────────────────────────────────────────────────

export interface LoopEvalResult {
  /** 'continue' = loop again, 'terminate' = exit loop */
  action: 'continue' | 'terminate';
  /** Reason for the decision */
  reason: 'condition-met' | 'condition-not-met' | 'max-iterations-reached';
  /** Current iteration count after this evaluation */
  iteration: number;
  /** Detailed explanation */
  explanation: string;
}

/**
 * Evaluate a loop-end node to determine whether the loop should continue or terminate.
 * - If terminationCondition is met → terminate, proceed to downstream
 * - If not met and under maxIterations → continue (re-activate loop-start)
 * - If max iterations reached → force terminate
 */
export function evaluateLoopEnd(
  node: DagNode,
  context: ConditionContext,
  currentIteration: number,
): LoopEvalResult {
  if (node.kind !== 'loop-end' || !node.loop) {
    throw new Error(`evaluateLoopEnd called on non-loop-end node '${node.id}'`);
  }

  const { maxIterations, terminationCondition } = node.loop;
  const condResult = evaluateCondition(terminationCondition, context);

  if (condResult.matched) {
    return {
      action: 'terminate',
      reason: 'condition-met',
      iteration: currentIteration,
      explanation: `Termination condition met at iteration ${currentIteration}: ${condResult.explanation}`,
    };
  }

  if (currentIteration >= maxIterations) {
    return {
      action: 'terminate',
      reason: 'max-iterations-reached',
      iteration: currentIteration,
      explanation: `Max iterations (${maxIterations}) reached at iteration ${currentIteration}`,
    };
  }

  return {
    action: 'continue',
    reason: 'condition-not-met',
    iteration: currentIteration + 1,
    explanation: `Condition not met at iteration ${currentIteration}, continuing (max: ${maxIterations}): ${condResult.explanation}`,
  };
}
