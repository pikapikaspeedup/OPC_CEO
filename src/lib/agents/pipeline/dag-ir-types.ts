/**
 * DAG IR — Unified Internal Graph Representation
 *
 * All template source formats (pipeline[], graphPipeline, YAML DSL)
 * compile down to this single IR before execution. The runtime engine
 * only operates on DagIR — there is no second runner.
 */

import type { StageContract, FanOutContract, JoinMergeContract } from '../contract-types';
import type { SubgraphRefConfig } from '../subgraph-types';
import type { StageExecutionConfig } from '../group-types';

// ── Node Types ──────────────────────────────────────────────────────────────

export type DagNodeKind = 'stage' | 'fan-out' | 'join' | 'gate' | 'switch' | 'loop-start' | 'loop-end' | 'subgraph-ref';

/**
 * DagNode — unified DAG node.
 * Regardless of the template source format, every logical step
 * is represented as a DagNode after compilation.
 */
export interface DagNode extends StageExecutionConfig {
  /** Globally unique node ID (mapped from stageId) */
  id: string;
  /** Node category */
  kind: DagNodeKind;
  /** Display label (for UI / diagnostics) */
  label?: string;
  /** Auto-trigger configuration */
  autoTrigger: boolean;
  /** Trigger condition */
  triggerOn: 'approved' | 'completed' | 'any';
  /** Prompt template override */
  promptTemplate?: string;

  // --- Contract (from V4.4) ---
  contract?: StageContract;

  // --- Fan-out specific ---
  fanOut?: {
    workPackagesPath: string;
    perBranchTemplateId: string;
    contract?: FanOutContract;
    /** Maximum concurrent branches. Omit or 0 = unlimited (all at once). */
    maxConcurrency?: number;
  };

  // --- Join specific ---
  join?: {
    /** Source fan-out node ID */
    sourceNodeId: string;
    policy: 'all';
    contract?: JoinMergeContract;
  };

  // --- Gate specific (V5.2) ---
  gate?: {
    /** Auto-approve mode (default false — requires human approval) */
    autoApprove?: boolean;
    /** Approval timeout in milliseconds (optional) */
    approvalTimeout?: number;
    /** Approval prompt template */
    approvalPrompt?: string;
  };

  // --- Switch specific (V5.2) ---
  switch?: {
    /** Condition branches, evaluated in order */
    branches: SwitchBranch[];
    /** Default branch node ID (when no condition matches) */
    defaultTargetNodeId?: string;
  };

  // --- Loop specific (V5.2) ---
  loop?: {
    /** Maximum iterations (required — no unbounded loops) */
    maxIterations: number;
    /** Termination condition (exit loop when matched) */
    terminationCondition: FlowCondition;
    /** Paired node ID (loop-start ↔ loop-end reference each other) */
    pairedNodeId: string;
    /** Auto-create checkpoint at each iteration start */
    checkpointPerIteration?: boolean;
  };

  // --- Subgraph reference (V5.4) ---
  /** Subgraph reference config (only when kind === 'subgraph-ref') */
  subgraphRef?: SubgraphRefConfig;

  // --- Metadata ---
  meta?: Record<string, unknown>;
  /** Index in the original pipeline[] array (for traceability) */
  sourceIndex?: number;
  /** @deprecated Internal compatibility alias; use `id`. */
  groupId?: string;
}

// ── Edge Types ──────────────────────────────────────────────────────────────

/**
 * DagEdge — unified DAG edge.
 * Represents a dependency between two nodes.
 */
export interface DagEdge {
  /** Upstream node ID */
  from: string;
  /** Downstream node ID */
  to: string;
  /** Contract compatibility on this edge (from V4.4 validation) */
  contractValid?: boolean;
  /** Edge condition expression (V5.2 extension point) */
  condition?: string;
}

// ── Compiled IR ─────────────────────────────────────────────────────────────

/**
 * DagIR — the compiled DAG graph.
 * This is the system's sole internal execution representation.
 */
export interface DagIR {
  /** Associated template ID */
  templateId: string;
  /** All nodes */
  nodes: DagNode[];
  /** All edges */
  edges: DagEdge[];
  /** Entry node IDs (nodes with no incoming edges) */
  entryNodeIds: string[];
  /** Compilation timestamp */
  compiledAt: string;
  /** IR version number (for future migration) */
  irVersion: 1;
}

// ── Runtime Helper Types ────────────────────────────────────────────────────

export interface DagNodeActivation {
  nodeId: string;
  canActivate: boolean;
  reason: string;
  /** All upstream node IDs */
  upstreamNodeIds: string[];
  /** Pending (not completed) upstream node IDs */
  pendingUpstreamIds: string[];
}

// ── Flow Condition Types (V5.2) ─────────────────────────────────────────────

/**
 * Deterministic condition expression.
 * No eval, no Function, no LLM — only field extraction + literal comparison.
 */
export interface FlowCondition {
  /** Expression type */
  type: 'field-match' | 'field-exists' | 'field-compare' | 'always';
  /** Upstream output field path (dot notation) */
  field?: string;
  /** Comparison operator (for field-compare) */
  operator?: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'matches';
  /** Comparison value */
  value?: string | number | boolean;
  /** Regex pattern (for matches operator) */
  pattern?: string;
}

export interface SwitchBranch {
  /** Branch label */
  label: string;
  /** Branch condition */
  condition: FlowCondition;
  /** Downstream node ID to activate when condition matches */
  targetNodeId: string;
}
