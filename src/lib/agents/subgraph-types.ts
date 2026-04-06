/**
 * SubgraphDefinition — reusable node group that can be referenced from any graphPipeline.
 *
 * Subgraphs are expanded at compile time into the parent IR.
 * Node IDs are prefixed with the referencing node's ID to avoid collisions.
 */

import type { GraphPipeline } from './pipeline/graph-pipeline-types';
import type { StageContract } from './contract-types';

// ── Subgraph I/O Ports ──────────────────────────────────────────────────────

export interface SubgraphPort {
  /** Port identifier (used in edge mapping) */
  id: string;
  /** Internal node ID this port maps to */
  nodeId: string;
  /** Optional contract for this port */
  contract?: StageContract;
}

// ── Subgraph Definition ─────────────────────────────────────────────────────

export interface SubgraphDefinition {
  /** Unique subgraph identifier */
  id: string;
  /** Asset kind discriminator */
  kind: 'subgraph';
  /** Human-readable title */
  title: string;
  /** Description */
  description?: string;
  /** The graph structure to embed */
  graphPipeline: GraphPipeline;
  /** Input ports — external edges connect TO these */
  inputs: SubgraphPort[];
  /** Output ports — these connect TO external edges */
  outputs: SubgraphPort[];
}

// ── Subgraph Reference (on graph nodes) ─────────────────────────────────────

export interface SubgraphRefConfig {
  /** ID of the subgraph definition to embed */
  subgraphId: string;
}
