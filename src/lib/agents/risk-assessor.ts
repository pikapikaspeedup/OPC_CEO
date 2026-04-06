/**
 * Risk Assessor — evaluates risks of AI-generated pipelines.
 *
 * Runs after graph validation + contract validation to produce human-readable
 * risk summaries. Used in the generation flow to help users decide whether
 * to accept a draft.
 */

import type { GraphPipeline } from './pipeline/graph-pipeline-types';
import type { GenerationContext } from './generation-context';

// ── Types ───────────────────────────────────────────────────────────────────

export interface RiskAssessment {
  severity: 'info' | 'warning' | 'critical';
  category: 'complexity' | 'cost' | 'reliability' | 'security' | 'availability';
  message: string;
  suggestion?: string;
}

// ── Risk Rules ──────────────────────────────────────────────────────────────

/**
 * Assess risks of a generated graphPipeline.
 * Returns an array of risk assessments ordered by severity (critical first).
 */
export function assessGenerationRisks(
  graph: GraphPipeline,
  dagErrors: string[],
  context: GenerationContext,
): RiskAssessment[] {
  const risks: RiskAssessment[] = [];
  const nodeCount = graph.nodes.length;

  // ── DAG validation errors → critical ──
  if (dagErrors.length > 0) {
    risks.push({
      severity: 'critical',
      category: 'reliability',
      message: `DAG validation failed with ${dagErrors.length} error(s): ${dagErrors[0]}`,
      suggestion: 'Fix the DAG structure before saving.',
    });
  }

  // ── Stage count thresholds ──
  if (nodeCount > 20) {
    risks.push({
      severity: 'critical',
      category: 'complexity',
      message: `Pipeline has ${nodeCount} nodes (>20). This is overly complex and hard to maintain.`,
      suggestion: 'Consider breaking into sub-templates or removing unnecessary stages.',
    });
  } else if (nodeCount > 10) {
    risks.push({
      severity: 'warning',
      category: 'complexity',
      message: `Pipeline has ${nodeCount} nodes (>10). Review whether all stages are necessary.`,
    });
  }

  // ── Missing execution config ──
  const missingExecution = graph.nodes.filter((node) => !node.executionMode || !Array.isArray(node.roles));
  if (missingExecution.length > 0) {
    risks.push({
      severity: 'critical',
      category: 'availability',
      message: `${missingExecution.length} node(s) are missing execution config: ${missingExecution.map((node) => node.id).join(', ')}`,
      suggestion: 'Populate executionMode and roles for every node before saving.',
    });
  }

  const missingRoles = graph.nodes
    .filter((node) => node.kind === 'stage' && (!node.roles || node.roles.length === 0))
    .map((node) => node.id);
  if (missingRoles.length > 0) {
    risks.push({
      severity: 'critical',
      category: 'availability',
      message: `${missingRoles.length} stage node(s) have no roles: ${missingRoles.join(', ')}`,
      suggestion: 'Add at least one executable role to each stage node.',
    });
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const invalidContracts = graph.nodes
    .filter((node) => node.sourceContract?.acceptedSourceStageIds?.some((id) => !nodeIds.has(id)))
    .map((node) => node.id);
  if (invalidContracts.length > 0) {
    risks.push({
      severity: 'critical',
      category: 'reliability',
      message: `${invalidContracts.length} node(s) reference missing acceptedSourceStageIds: ${invalidContracts.join(', ')}`,
      suggestion: 'Update sourceContract.acceptedSourceStageIds to reference existing stage IDs.',
    });
  }

  // ── Fan-out nesting ──
  const fanOutNodes = new Set(graph.nodes.filter(n => n.kind === 'fan-out').map(n => n.id));
  if (fanOutNodes.size > 0) {
    // Check if any fan-out has a downstream fan-out (before a join)
    for (const foId of fanOutNodes) {
      const downstream = graph.edges.filter(e => e.from === foId).map(e => e.to);
      for (const dId of downstream) {
        const dNode = graph.nodes.find(n => n.id === dId);
        if (dNode?.kind === 'fan-out') {
          risks.push({
            severity: 'warning',
            category: 'complexity',
            message: `Fan-out '${foId}' has a direct downstream fan-out '${dId}'. Nested fan-out increases complexity.`,
            suggestion: 'Consider flattening the fan-out structure.',
          });
        }
      }
    }
  }

  // ── Loop iteration limits ──
  const loopNodes = graph.nodes.filter(n => n.kind === 'loop-start' || n.kind === 'loop-end');
  for (const ln of loopNodes) {
    if (ln.loop && ln.loop.maxIterations > 3) {
      risks.push({
        severity: 'warning',
        category: 'cost',
        message: `Loop node '${ln.id}' allows up to ${ln.loop.maxIterations} iterations. High iteration count increases execution cost.`,
        suggestion: 'Consider reducing maxIterations or adding an early termination condition.',
      });
    }
  }

  // ── Switch without default ──
  const switchNodes = graph.nodes.filter(n => n.kind === 'switch');
  for (const sn of switchNodes) {
    if (sn.switch && !sn.switch.defaultTargetNodeId) {
      risks.push({
        severity: 'warning',
        category: 'reliability',
        message: `Switch node '${sn.id}' has no default branch. If no condition matches, the pipeline will fail.`,
        suggestion: 'Add a defaultTargetNodeId to handle unmatched conditions.',
      });
    }
  }

  // ── Stages without contracts ──
  const stagesWithoutContract = graph.nodes
    .filter(n => n.kind === 'stage' && !n.contract)
    .map(n => n.id);
  if (stagesWithoutContract.length > 0) {
    risks.push({
      severity: 'info',
      category: 'reliability',
      message: `${stagesWithoutContract.length} stage(s) have no contract: ${stagesWithoutContract.slice(0, 5).join(', ')}${stagesWithoutContract.length > 5 ? '...' : ''}`,
      suggestion: 'Adding contracts improves type safety between stages.',
    });
  }

  // Sort: critical > warning > info
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  risks.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return risks;
}

/**
 * Check if any risk is critical (should block save).
 */
export function hasCriticalRisk(risks: RiskAssessment[]): boolean {
  return risks.some(r => r.severity === 'critical');
}
