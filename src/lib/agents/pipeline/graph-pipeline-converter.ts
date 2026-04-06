/**
 * Graph Pipeline Converter — bidirectional format conversion
 * between pipeline[] and graphPipeline.
 */

import type { PipelineStage } from './pipeline-types';
import type { GraphPipeline, GraphPipelineNode, GraphPipelineEdge } from './graph-pipeline-types';
import { resolveStageId } from './pipeline-graph';

// ── pipeline[] → graphPipeline ──────────────────────────────────────────────

/**
 * Convert a pipeline[] array to an equivalent graphPipeline.
 * Implicit linear edges become explicit GraphPipelineEdge entries.
 */
export function pipelineToGraphPipeline(pipeline: PipelineStage[]): GraphPipeline {
  const nodes: GraphPipelineNode[] = [];
  const edges: GraphPipelineEdge[] = [];

  for (let i = 0; i < pipeline.length; i++) {
    const stage = pipeline[i];
    const stageId = resolveStageId(stage);

    const kind = stage.stageType === 'fan-out'
      ? 'fan-out' as const
      : stage.stageType === 'join'
        ? 'join' as const
        : 'stage' as const;

    const node: GraphPipelineNode = {
      id: stageId,
      kind,
      title: stage.title,
      description: stage.description,
      executionMode: stage.executionMode,
      roles: stage.roles,
      capabilities: stage.capabilities,
      sourceContract: stage.sourceContract,
      reviewPolicyId: stage.reviewPolicyId,
      defaultModel: stage.defaultModel,
      groupId: stageId,
      autoTrigger: stage.autoTrigger,
      ...(stage.triggerOn && { triggerOn: stage.triggerOn }),
      ...(stage.promptTemplate && { promptTemplate: stage.promptTemplate }),
      ...(stage.contract && { contract: stage.contract }),
    };

    // Fan-out config
    if (kind === 'fan-out' && stage.fanOutSource) {
      node.fanOut = {
        workPackagesPath: stage.fanOutSource.workPackagesPath,
        perBranchTemplateId: stage.fanOutSource.perBranchTemplateId,
        ...(stage.fanOutContract && { contract: stage.fanOutContract }),
      };
    }

    // Join config
    if (kind === 'join' && stage.joinFrom) {
      node.join = {
        sourceNodeId: stage.joinFrom,
        policy: stage.joinPolicy ?? 'all',
        ...(stage.joinMergeContract && { contract: stage.joinMergeContract }),
      };
    }

    nodes.push(node);

    // Build edges
    if (stage.upstreamStageIds !== undefined) {
      // Explicit upstream: upstreamStageIds: ['a', 'b'] → edges from a→stageId, b→stageId
      // upstreamStageIds: [] means entry node (no edges)
      for (const upId of stage.upstreamStageIds) {
        edges.push({ from: upId, to: stageId });
      }
    } else if (i > 0) {
      // Implicit linear: edge from previous stage
      const prevId = resolveStageId(pipeline[i - 1]);
      edges.push({ from: prevId, to: stageId });
    }
  }

  return { nodes, edges };
}

// ── graphPipeline → pipeline[] ──────────────────────────────────────────────

/**
 * Convert a graphPipeline to a pipeline[] array.
 * Uses topological sort to determine stage order.
 * Edges become upstreamStageIds.
 */
export function graphPipelineToPipeline(graph: GraphPipeline): PipelineStage[] {
  const sorted = topologicalSort(graph);
  const pipeline: PipelineStage[] = [];

  for (const nodeId of sorted) {
    const node = graph.nodes.find(n => n.id === nodeId)!;
    const upstreamIds = graph.edges
      .filter(e => e.to === nodeId)
      .map(e => e.from);

    const stage: PipelineStage = {
      stageId: node.id,
      title: node.title,
      description: node.description,
      executionMode: node.executionMode,
      roles: node.roles,
      capabilities: node.capabilities,
      sourceContract: node.sourceContract,
      reviewPolicyId: node.reviewPolicyId,
      defaultModel: node.defaultModel,
      groupId: node.id,
      autoTrigger: node.autoTrigger ?? true,
      ...(node.triggerOn && { triggerOn: node.triggerOn }),
      ...(node.promptTemplate && { promptTemplate: node.promptTemplate }),
      ...(node.contract && { contract: node.contract }),
    };

    // Entry nodes get explicit empty upstreamStageIds
    // Others get explicit upstreamStageIds from edges
    stage.upstreamStageIds = upstreamIds.length > 0 ? upstreamIds : [];

    // Kind mapping
    if (node.kind === 'fan-out' || node.kind === 'join') {
      stage.stageType = node.kind;
    }

    // Fan-out config
    if (node.kind === 'fan-out' && node.fanOut) {
      stage.fanOutSource = {
        workPackagesPath: node.fanOut.workPackagesPath,
        perBranchTemplateId: node.fanOut.perBranchTemplateId,
      };
      if (node.fanOut.contract) {
        stage.fanOutContract = node.fanOut.contract;
      }
    }

    // Join config
    if (node.kind === 'join' && node.join) {
      stage.joinFrom = node.join.sourceNodeId;
      stage.joinPolicy = node.join.policy ?? 'all';
      if (node.join.contract) {
        stage.joinMergeContract = node.join.contract;
      }
    }

    pipeline.push(stage);
  }

  return pipeline;
}

// ── Topological Sort ────────────────────────────────────────────────────────

function topologicalSort(graph: GraphPipeline): string[] {
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  // Sort entry nodes for deterministic output
  queue.sort();

  const result: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    result.push(nodeId);

    const neighbors = graph.edges
      .filter(e => e.from === nodeId)
      .map(e => e.to)
      .sort();

    for (const next of neighbors) {
      const newDeg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
    // Re-sort to maintain determinism when multiple nodes become ready
    queue.sort();
  }

  return result;
}
