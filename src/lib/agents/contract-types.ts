/**
 * Stage-level data contracts for typed pipeline validation.
 *
 * Design principle: the contract layer builds on top of existing
 * TaskEnvelope / ArtifactRef / ResultEnvelope types — it does NOT
 * introduce a parallel runtime schema system.
 *
 * - inputContract describes which artifacts this stage expects from upstream ResultEnvelopes
 * - outputContract describes which artifacts this stage promises to produce in its ResultEnvelope
 * - Both reuse the ArtifactRef vocabulary (id, kind, format)
 */

// ── Stage Contract ──────────────────────────────────────────────────────────

export interface StageContract {
  /** Artifact expectations from upstream (aligns with TaskEnvelope.inputArtifacts) */
  inputContract?: ArtifactExpectation[];
  /** Artifact promises to downstream (aligns with ResultEnvelope.outputArtifacts) */
  outputContract?: ArtifactPromise[];
}

/**
 * Describes what this stage expects to receive from upstream.
 * Semantics: upstream ResultEnvelope.outputArtifacts should contain
 * ArtifactRefs matching these expectations.
 */
export interface ArtifactExpectation {
  /** Expected artifact identifier (matches ArtifactRef.id) */
  id: string;
  /** Expected artifact kind (matches ArtifactRef.kind, e.g. 'report' | 'code' | 'data') */
  kind: string;
  /** Expected file format (matches ArtifactRef.format) */
  format?: 'md' | 'json' | 'txt';
  /** Whether this artifact is required (default true) */
  required?: boolean;
  /** Description */
  description?: string;
}

/**
 * Describes what this stage promises to output.
 * Semantics: upon completion, ResultEnvelope.outputArtifacts will contain
 * ArtifactRefs matching these promises.
 */
export interface ArtifactPromise {
  /** Artifact identifier */
  id: string;
  /** Artifact kind */
  kind: string;
  /** File path pattern (relative to project workspace) */
  pathPattern: string;
  /** File format */
  format?: 'md' | 'json' | 'txt';
  /**
   * Content structure constraint (optional).
   * Only used for structured artifacts (e.g. JSON) during lint.
   */
  contentSchema?: JsonSchema;
  /** Description */
  description?: string;
}

// ── Fan-out / Join Contracts ────────────────────────────────────────────────

export interface FanOutContract {
  /** Schema constraint for each workPackage item */
  workPackageSchema?: JsonSchema;
  /** Artifact expectations for the entry stage of each branch */
  branchInputContract?: ArtifactExpectation[];
}

export interface JoinMergeContract {
  /** Artifacts expected from each branch upon completion */
  branchOutputContract?: ArtifactExpectation[];
  /** Artifacts promised after the join merge */
  mergedOutputContract?: ArtifactPromise[];
  /** Merge strategy */
  mergeStrategy?: 'concat' | 'deep-merge' | 'custom';
}

// ── JSON Schema (minimal subset) ────────────────────────────────────────────

/**
 * Minimal JSON Schema subset.
 * Used ONLY for ArtifactPromise.contentSchema — validates the internal
 * structure of structured artifacts (e.g. JSON files).
 * NOT used for general input/output contract matching (that's handled by
 * ArtifactExpectation / ArtifactPromise).
 */
export interface JsonSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  enum?: (string | number | boolean)[];
  additionalProperties?: boolean;
}

// ── Validation Result ───────────────────────────────────────────────────────

export interface ContractValidationResult {
  valid: boolean;
  errors: ContractError[];
  warnings: ContractWarning[];
}

export interface ContractError {
  severity: 'error';
  stageId: string;
  field: string;
  message: string;
  relatedStageId?: string;
}

export interface ContractWarning {
  severity: 'warning';
  stageId: string;
  message: string;
}
