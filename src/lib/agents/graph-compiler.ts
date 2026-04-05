/**
 * Graph Pipeline Compiler — compiles graphPipeline to DagIR.
 *
 * Produces the same DagIR as compilePipelineToIR (from pipeline[]),
 * so the runtime engine needs no changes.
 */

import type { GraphPipeline, GraphPipelineNode } from './graph-pipeline-types';
import type { DagIR, DagNode, DagEdge } from './dag-ir-types';
import type { SubgraphDefinition } from './subgraph-types';

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a graphPipeline structure.
 * Returns an array of error strings; empty = valid.
 */
export function validateGraphPipeline(graph: GraphPipeline): string[] {
  const errors: string[] = [];

  if (!graph.nodes?.length) {
    errors.push('graphPipeline must have at least one node');
    return errors;
  }

  // Duplicate node IDs
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.id) {
      errors.push('Every node must have an id');
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate node id: '${node.id}'`);
    }
    nodeIds.add(node.id);
  }

  // Node-level validation
  for (const node of graph.nodes) {
    if (!node.groupId) {
      errors.push(`Node '${node.id}' must have a groupId`);
    }
    if (!node.kind) {
      errors.push(`Node '${node.id}' must have a kind`);
    }
    if (node.kind === 'fan-out' && !node.fanOut) {
      errors.push(`Fan-out node '${node.id}' must have fanOut configuration`);
    }
    if (node.kind === 'join' && !node.join) {
      errors.push(`Join node '${node.id}' must have join configuration`);
    }
    if (node.kind !== 'fan-out' && node.fanOut) {
      errors.push(`Node '${node.id}' has fanOut configuration but kind is '${node.kind}'`);
    }
    if (node.kind !== 'join' && node.join) {
      errors.push(`Node '${node.id}' has join configuration but kind is '${node.kind}'`);
    }
    if (node.kind === 'gate' && node.gate === undefined) {
      // gate config is optional — defaults will be applied during compilation
    }
    if (node.kind !== 'gate' && node.gate) {
      errors.push(`Node '${node.id}' has gate configuration but kind is '${node.kind}'`);
    }
    if (node.kind === 'switch' && !node.switch) {
      errors.push(`Switch node '${node.id}' must have switch configuration`);
    }
    if (node.kind !== 'switch' && node.switch) {
      errors.push(`Node '${node.id}' has switch configuration but kind is '${node.kind}'`);
    }
    // Validate switch branches reference existing nodes
    if (node.kind === 'switch' && node.switch) {
      for (const branch of node.switch.branches) {
        if (!nodeIds.has(branch.targetNodeId)) {
          errors.push(`Switch node '${node.id}' branch '${branch.label}' references unknown target '${branch.targetNodeId}'`);
        }
      }
      if (node.switch.defaultTargetNodeId && !nodeIds.has(node.switch.defaultTargetNodeId)) {
        errors.push(`Switch node '${node.id}' default target references unknown node '${node.switch.defaultTargetNodeId}'`);
      }
    }
    // Loop node validation
    if ((node.kind === 'loop-start' || node.kind === 'loop-end') && !node.loop) {
      errors.push(`${node.kind} node '${node.id}' must have loop configuration`);
    }
    if (node.kind !== 'loop-start' && node.kind !== 'loop-end' && node.loop) {
      errors.push(`Node '${node.id}' has loop configuration but kind is '${node.kind}'`);
    }
    // Subgraph-ref validation
    if (node.kind === 'subgraph-ref' && !node.subgraphRef) {
      errors.push(`Subgraph-ref node '${node.id}' must have subgraphRef configuration`);
    }
    if (node.kind !== 'subgraph-ref' && node.subgraphRef) {
      errors.push(`Node '${node.id}' has subgraphRef configuration but kind is '${node.kind}'`);
    }
    if (node.loop) {
      if (node.loop.maxIterations < 1) {
        errors.push(`${node.kind} node '${node.id}' maxIterations must be >= 1`);
      }
      if (!nodeIds.has(node.loop.pairedNodeId)) {
        errors.push(`${node.kind} node '${node.id}' references unknown paired node '${node.loop.pairedNodeId}'`);
      } else {
        const paired = graph.nodes.find(n => n.id === node.loop!.pairedNodeId);
        if (paired) {
          if (node.kind === 'loop-start' && paired.kind !== 'loop-end') {
            errors.push(`loop-start node '${node.id}' pairedNodeId must reference a loop-end node, got '${paired.kind}'`);
          }
          if (node.kind === 'loop-end' && paired.kind !== 'loop-start') {
            errors.push(`loop-end node '${node.id}' pairedNodeId must reference a loop-start node, got '${paired.kind}'`);
          }
        }
      }
    }
  }

  // Edge validation
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge references unknown source node: '${edge.from}'`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge references unknown target node: '${edge.to}'`);
    }
    if (edge.from === edge.to) {
      errors.push(`Self-loop detected on node '${edge.from}'`);
    }
  }

  // Join sourceNodeId must reference a fan-out node
  for (const node of graph.nodes) {
    if (node.kind === 'join' && node.join) {
      const sourceNode = graph.nodes.find(n => n.id === node.join!.sourceNodeId);
      if (!sourceNode) {
        errors.push(`Join node '${node.id}' references unknown source node '${node.join.sourceNodeId}'`);
      } else if (sourceNode.kind !== 'fan-out') {
        errors.push(`Join node '${node.id}' source '${node.join.sourceNodeId}' must be a fan-out node, got '${sourceNode.kind}'`);
      }
    }
  }

  // Cycle detection (DFS)
  if (errors.length === 0) {
    const cycleError = detectCycles(graph);
    if (cycleError) {
      errors.push(cycleError);
    }
  }

  return errors;
}

// ── Cycle Detection ─────────────────────────────────────────────────────────

function detectCycles(graph: GraphPipeline): string | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();

  for (const node of graph.nodes) {
    color.set(node.id, WHITE);
  }

  for (const node of graph.nodes) {
    if (color.get(node.id) === WHITE) {
      const cycle = dfs(node.id, graph, color);
      if (cycle) return cycle;
    }
  }
  return null;
}

function dfs(
  nodeId: string,
  graph: GraphPipeline,
  color: Map<string, number>,
): string | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  color.set(nodeId, GRAY);

  const neighbors = graph.edges
    .filter(e => e.from === nodeId)
    .map(e => e.to);

  for (const next of neighbors) {
    if (color.get(next) === GRAY) {
      return `Cycle detected: ${nodeId} → ${next}`;
    }
    if (color.get(next) === WHITE) {
      const result = dfs(next, graph, color);
      if (result) return result;
    }
  }

  color.set(nodeId, BLACK);
  return null;
}

// ── Compiler ────────────────────────────────────────────────────────────────

/**
 * Compile a graphPipeline into DagIR.
 * Throws on validation errors.
 *
 * @param subgraphResolver - Optional resolver for subgraph-ref nodes.
 *   When provided, subgraph-ref nodes are expanded inline during compilation.
 *   Internal node IDs are prefixed with `{refNodeId}.` to avoid collisions.
 */
export function compileGraphPipelineToIR(
  templateId: string,
  graph: GraphPipeline,
  subgraphResolver?: (subgraphId: string) => SubgraphDefinition | null,
): DagIR {
  const errors = validateGraphPipeline(graph);
  if (errors.length > 0) {
    throw new Error(`Cannot compile graphPipeline for '${templateId}': ${errors.join('; ')}`);
  }

  // Expand subgraph-ref nodes before compilation
  const expanded = expandSubgraphRefs(graph, subgraphResolver);

  const nodes: DagNode[] = expanded.nodes.map((gn, index) => mapNodeToIR(gn, index));

  const edges: DagEdge[] = expanded.edges.map(ge => ({
    from: ge.from,
    to: ge.to,
    condition: ge.condition,
  }));

  // Entry nodes = nodes with no incoming edges
  const nodesWithIncoming = new Set(edges.map(e => e.to));
  const entryNodeIds = nodes
    .filter(n => !nodesWithIncoming.has(n.id))
    .map(n => n.id);

  return {
    templateId,
    nodes,
    edges,
    entryNodeIds,
    compiledAt: new Date().toISOString(),
    irVersion: 1,
  };
}

// ── Subgraph Expansion ──────────────────────────────────────────────────────

/**
 * Expand subgraph-ref nodes by replacing them with the subgraph's internal nodes/edges.
 * Internal node IDs are prefixed with `{refNodeId}.` to avoid collisions.
 * Edges from/to the ref node are rewired to the subgraph's input/output ports.
 */
function expandSubgraphRefs(
  graph: GraphPipeline,
  resolver?: (id: string) => SubgraphDefinition | null,
): GraphPipeline {
  const subgraphRefs = graph.nodes.filter(n => n.kind === 'subgraph-ref');
  if (subgraphRefs.length === 0 || !resolver) {
    // Nothing to expand — return as-is (filter out subgraph-ref nodes if no resolver)
    return graph;
  }

  const newNodes: GraphPipelineNode[] = [];
  const newEdges = [...graph.edges];

  // Track which ref node IDs were expanded so we can rewire edges
  const refExpansion = new Map<string, {
    inputNodeIds: Map<string, string>;   // portId → prefixed nodeId
    outputNodeIds: Map<string, string>;  // portId → prefixed nodeId
    entryNodeIds: string[];              // nodes with no incoming edges inside subgraph
    exitNodeIds: string[];               // nodes with no outgoing edges inside subgraph
  }>();

  for (const node of graph.nodes) {
    if (node.kind === 'subgraph-ref' && node.subgraphRef) {
      const subgraph = resolver(node.subgraphRef.subgraphId);
      if (!subgraph) {
        throw new Error(`Subgraph '${node.subgraphRef.subgraphId}' not found (referenced by node '${node.id}')`);
      }

      const prefix = `${node.id}.`;

      // Add prefixed internal nodes
      for (const sn of subgraph.graphPipeline.nodes) {
        newNodes.push({
          ...sn,
          id: `${prefix}${sn.id}`,
          // Fix internal references for paired loop nodes
          loop: sn.loop ? {
            ...sn.loop,
            pairedNodeId: `${prefix}${sn.loop.pairedNodeId}`,
          } : undefined,
          // Fix switch target references
          switch: sn.switch ? {
            ...sn.switch,
            branches: sn.switch.branches.map(b => ({
              ...b,
              targetNodeId: `${prefix}${b.targetNodeId}`,
            })),
            defaultTargetNodeId: sn.switch.defaultTargetNodeId
              ? `${prefix}${sn.switch.defaultTargetNodeId}`
              : undefined,
          } : undefined,
          // Fix join sourceNodeId
          join: sn.join ? {
            ...sn.join,
            sourceNodeId: `${prefix}${sn.join.sourceNodeId}`,
          } : undefined,
        });
      }

      // Add prefixed internal edges
      for (const se of subgraph.graphPipeline.edges) {
        newEdges.push({
          ...se,
          from: `${prefix}${se.from}`,
          to: `${prefix}${se.to}`,
        });
      }

      // Build port maps
      const inputMap = new Map<string, string>();
      for (const port of subgraph.inputs) {
        inputMap.set(port.id, `${prefix}${port.nodeId}`);
      }
      const outputMap = new Map<string, string>();
      for (const port of subgraph.outputs) {
        outputMap.set(port.id, `${prefix}${port.nodeId}`);
      }

      // Find entry and exit nodes within the subgraph
      const internalIds = new Set(subgraph.graphPipeline.nodes.map(n => n.id));
      const hasIncoming = new Set(subgraph.graphPipeline.edges.map(e => e.to));
      const hasOutgoing = new Set(subgraph.graphPipeline.edges.map(e => e.from));

      const entryIds = subgraph.graphPipeline.nodes
        .filter(n => !hasIncoming.has(n.id))
        .map(n => `${prefix}${n.id}`);

      const exitIds = subgraph.graphPipeline.nodes
        .filter(n => !hasOutgoing.has(n.id))
        .map(n => `${prefix}${n.id}`);

      refExpansion.set(node.id, {
        inputNodeIds: inputMap,
        outputNodeIds: outputMap,
        entryNodeIds: entryIds,
        exitNodeIds: exitIds,
      });
    } else {
      newNodes.push(node);
    }
  }

  // Rewire edges that referenced subgraph-ref nodes
  const rewiredEdges: typeof newEdges = [];
  for (const edge of newEdges) {
    const fromExpansion = refExpansion.get(edge.from);
    const toExpansion = refExpansion.get(edge.to);

    if (fromExpansion && toExpansion) {
      // Edge between two subgraph-refs: connect all exit nodes to all entry nodes
      for (const exitId of fromExpansion.exitNodeIds) {
        for (const entryId of toExpansion.entryNodeIds) {
          rewiredEdges.push({ ...edge, from: exitId, to: entryId });
        }
      }
    } else if (fromExpansion) {
      // Edge FROM a subgraph-ref: rewire from exit nodes
      for (const exitId of fromExpansion.exitNodeIds) {
        rewiredEdges.push({ ...edge, from: exitId });
      }
    } else if (toExpansion) {
      // Edge TO a subgraph-ref: rewire to entry nodes
      for (const entryId of toExpansion.entryNodeIds) {
        rewiredEdges.push({ ...edge, to: entryId });
      }
    } else {
      rewiredEdges.push(edge);
    }
  }

  return { nodes: newNodes, edges: rewiredEdges };
}

function mapNodeToIR(gn: GraphPipelineNode, index: number): DagNode {
  return {
    id: gn.id,
    kind: gn.kind,
    groupId: gn.groupId,
    label: gn.label,
    autoTrigger: gn.autoTrigger ?? true,
    triggerOn: gn.triggerOn ?? 'approved',
    promptTemplate: gn.promptTemplate,
    contract: gn.contract,
    fanOut: gn.fanOut
      ? {
          workPackagesPath: gn.fanOut.workPackagesPath,
          perBranchTemplateId: gn.fanOut.perBranchTemplateId,
          contract: gn.fanOut.contract,
          maxConcurrency: gn.fanOut.maxConcurrency,
        }
      : undefined,
    join: gn.join
      ? {
          sourceNodeId: gn.join.sourceNodeId,
          policy: gn.join.policy ?? 'all',
          contract: gn.join.contract,
        }
      : undefined,
    gate: gn.gate
      ? {
          autoApprove: gn.gate.autoApprove ?? false,
          approvalTimeout: gn.gate.approvalTimeout,
          approvalPrompt: gn.gate.approvalPrompt,
        }
      : gn.kind === 'gate'
        ? { autoApprove: false }
        : undefined,
    switch: gn.switch
      ? {
          branches: gn.switch.branches.map(b => ({
            label: b.label,
            condition: b.condition,
            targetNodeId: b.targetNodeId,
          })),
          defaultTargetNodeId: gn.switch.defaultTargetNodeId,
        }
      : undefined,
    loop: gn.loop
      ? {
          maxIterations: gn.loop.maxIterations,
          terminationCondition: gn.loop.terminationCondition,
          pairedNodeId: gn.loop.pairedNodeId,
          checkpointPerIteration: gn.loop.checkpointPerIteration ?? false,
        }
      : undefined,
    subgraphRef: gn.subgraphRef,
    sourceIndex: index,
  };
}
