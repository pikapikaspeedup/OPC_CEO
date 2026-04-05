/**
 * GraphPipeline — Explicit graph definition format.
 *
 * Alternative to pipeline[] for defining DAG topologies.
 * Both formats compile to the same DagIR; there is no second runtime.
 */

import type { StageContract, FanOutContract, JoinMergeContract } from './contract-types';
import type { FlowCondition } from './dag-ir-types';
import type { SubgraphRefConfig } from './subgraph-types';

// ── Graph Pipeline ──────────────────────────────────────────────────────────

export interface GraphPipeline {
  /** Explicit node list */
  nodes: GraphPipelineNode[];
  /** Explicit edge list */
  edges: GraphPipelineEdge[];
}

// ── Graph Node ──────────────────────────────────────────────────────────────

export interface GraphPipelineNode {
  /** Globally unique node ID */
  id: string;
  /** Node category */
  kind: 'stage' | 'fan-out' | 'join' | 'gate' | 'switch' | 'loop-start' | 'loop-end' | 'subgraph-ref';
  /** Corresponding agent group ID */
  groupId: string;
  /** Display label */
  label?: string;
  /** Auto-trigger (default true) */
  autoTrigger?: boolean;
  /** Trigger condition */
  triggerOn?: 'approved' | 'completed' | 'any';
  /** Prompt template override */
  promptTemplate?: string;
  /** Data contract */
  contract?: StageContract;
  /** Fan-out configuration (only when kind === 'fan-out') */
  fanOut?: {
    workPackagesPath: string;
    perBranchTemplateId: string;
    contract?: FanOutContract;
    /** Maximum number of branches to run concurrently. Omit or 0 = unlimited. */
    maxConcurrency?: number;
  };
  /** Join configuration (only when kind === 'join') */
  join?: {
    /** Source fan-out node ID */
    sourceNodeId: string;
    policy?: 'all';
    contract?: JoinMergeContract;
  };
  /** Gate configuration (only when kind === 'gate') */
  gate?: {
    /** Auto-approve mode (default false) */
    autoApprove?: boolean;
    /** Approval timeout in milliseconds */
    approvalTimeout?: number;
    /** Approval prompt template */
    approvalPrompt?: string;
  };
  /** Switch configuration (only when kind === 'switch') */
  switch?: {
    /** Condition branches, evaluated in order */
    branches: Array<{
      label: string;
      condition: FlowCondition;
      targetNodeId: string;
    }>;
    /** Default branch node ID when no condition matches */
    defaultTargetNodeId?: string;
  };
  /** Loop configuration (only when kind === 'loop-start' or 'loop-end') */
  loop?: {
    /** Maximum iterations (required) */
    maxIterations: number;
    /** Exit condition (loop exits when matched) */
    terminationCondition: FlowCondition;
    /** Paired node ID (loop-start ↔ loop-end) */
    pairedNodeId: string;
    /** Auto-create checkpoint per iteration */
    checkpointPerIteration?: boolean;
  };
  /** Subgraph reference configuration (only when kind === 'subgraph-ref') */
  subgraphRef?: SubgraphRefConfig;
}

// ── Graph Edge ──────────────────────────────────────────────────────────────

export interface GraphPipelineEdge {
  /** Upstream node ID */
  from: string;
  /** Downstream node ID */
  to: string;
  /** Data mapping (optional, V5.2 extension) */
  dataMapping?: Record<string, string>;
  /** Condition expression (optional, V5.2 extension) */
  condition?: string;
}
