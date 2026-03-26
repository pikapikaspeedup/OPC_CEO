/**
 * Development Template 1 — V2.5 Payload Types
 *
 * Work Package, Delivery Packet, and Write Scope Audit types
 * specific to the "software development delivery" template.
 *
 * These are template-level payloads, not platform-level envelope types.
 */

import type { ArtifactRef } from './group-types';

// ---------------------------------------------------------------------------
// Work Package — runtime-generated input to autonomous dev group
// ---------------------------------------------------------------------------

export interface DevelopmentWorkPackage {
  templateId: 'development-template-1';
  taskId: string;
  goal: string;
  sourceArchitectureRunId: string;
  sourceProductRunIds: string[];
  requestedDeliverables: string[];
  successCriteria: string[];
  constraints?: string[];
  referencedArtifacts: ArtifactRef[];
  allowedWriteScope: Array<{
    path: string;
    operation: 'create' | 'modify' | 'delete';
  }>;
}

// ---------------------------------------------------------------------------
// Delivery Packet — workflow-generated output from autonomous dev group
// ---------------------------------------------------------------------------

export interface DevelopmentDeliveryPacket {
  templateId: 'development-template-1';
  taskId: string;
  status: 'completed' | 'blocked';
  blockedReason?: string;
  summary: string;
  changedFiles: string[];
  tests: Array<{
    command: string;
    status: 'passed' | 'failed' | 'not-run';
    notes?: string;
  }>;
  residualRisks: string[];
  openQuestions: string[];
  followUps?: string[];
}

// ---------------------------------------------------------------------------
// Write Scope Audit — runtime-generated comparison of allowed vs actual writes
// ---------------------------------------------------------------------------

export interface WriteScopeAudit {
  taskId: string;
  withinScope: boolean;
  declaredScopeCount: number;
  observedChangedFiles: string[];
  reportedChangedFiles: string[];
  effectiveChangedFiles: string[];
  outOfScopeFiles: string[];
}
