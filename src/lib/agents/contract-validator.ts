import type { TemplateDefinition, PipelineStage } from './pipeline-types';
import type {
  ArtifactExpectation,
  ArtifactPromise,
  ContractValidationResult,
  ContractError,
  ContractWarning,
} from './contract-types';
import { resolveStageId } from './pipeline-graph';

/**
 * Validate all typed contracts within a template definition.
 *
 * This runs at load-time / lint-time and does NOT block on missing contracts —
 * stages without contracts simply skip validation (with optional warnings).
 */
export function validateTemplateContracts(
  template: TemplateDefinition,
): ContractValidationResult {
  const errors: ContractError[] = [];
  const warnings: ContractWarning[] = [];

  if (!template.pipeline) {
    return { valid: true, errors: [], warnings: [] };
  }

  const stageMap = buildStageMap(template);

  // Rule 1 — Output → Input compatibility on every edge
  checkOutputInputCompat(template, stageMap, errors, warnings);

  // Rule 2 — Fan-out contract alignment
  checkFanOutContracts(template, stageMap, errors, warnings);

  // Rule 3 — Join merge contract alignment
  checkJoinMergeContracts(template, stageMap, errors, warnings);

  // Rule 4 — Artifact path conflict & id uniqueness
  checkArtifactConflicts(template, errors);

  // Rule 5 — stageType ↔ contract consistency
  checkStageTypeConsistency(template, warnings);

  return { valid: errors.length === 0, errors, warnings };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type StageMap = Map<string, PipelineStage>;

function buildStageMap(template: TemplateDefinition): StageMap {
  const map = new Map<string, PipelineStage>();
  for (const stage of template.pipeline) {
    map.set(resolveStageId(stage), stage);
  }
  return map;
}

/**
 * For each downstream stage that declares an inputContract, check that every
 * upstream stage's outputContract satisfies the required expectations.
 */
function checkOutputInputCompat(
  template: TemplateDefinition,
  stageMap: StageMap,
  errors: ContractError[],
  warnings: ContractWarning[],
): void {
  for (const stage of template.pipeline) {
    const stageId = resolveStageId(stage);
    const inputContract = stage.contract?.inputContract;
    if (!inputContract?.length) continue;

    const upstreamIds = resolveUpstreams(template, stageId, stageMap);

    for (const upstreamId of upstreamIds) {
      const upstream = stageMap.get(upstreamId);
      if (!upstream) continue;

      const outputContract = upstream.contract?.outputContract;
      if (!outputContract?.length) {
        warnings.push({
          severity: 'warning',
          stageId,
          message: `Stage '${stageId}' has inputContract but upstream '${upstreamId}' has no outputContract`,
        });
        continue;
      }

      for (const expectation of inputContract) {
        if (expectation.required === false) continue;
        if (!findMatchingPromise(expectation, outputContract)) {
          errors.push({
            severity: 'error',
            stageId,
            field: 'contract.inputContract',
            message: `Required artifact '${expectation.id}' (kind=${expectation.kind}) not satisfied by upstream '${upstreamId}'`,
            relatedStageId: upstreamId,
          });
        }
      }
    }
  }
}

function checkFanOutContracts(
  template: TemplateDefinition,
  _stageMap: StageMap,
  errors: ContractError[],
  warnings: ContractWarning[],
): void {
  for (const stage of template.pipeline) {
    if (stage.stageType !== 'fan-out') continue;
    const stageId = resolveStageId(stage);

    if (!stage.fanOutContract) {
      if (stage.fanOutSource) {
        warnings.push({
          severity: 'warning',
          stageId,
          message: `Fan-out stage '${stageId}' has no fanOutContract`,
        });
      }
      continue;
    }

    // If branchInputContract exists, just validate it has well-formed entries
    const branchInput = stage.fanOutContract.branchInputContract;
    if (branchInput) {
      for (const exp of branchInput) {
        if (!exp.id || !exp.kind) {
          errors.push({
            severity: 'error',
            stageId,
            field: 'fanOutContract.branchInputContract',
            message: `branchInputContract entry missing required 'id' or 'kind'`,
          });
        }
      }
    }
  }
}

function checkJoinMergeContracts(
  template: TemplateDefinition,
  stageMap: StageMap,
  errors: ContractError[],
  warnings: ContractWarning[],
): void {
  for (const stage of template.pipeline) {
    if (stage.stageType !== 'join') continue;
    const stageId = resolveStageId(stage);
    const joinContract = stage.joinMergeContract;

    if (!joinContract) {
      if (stage.joinFrom) {
        warnings.push({
          severity: 'warning',
          stageId,
          message: `Join stage '${stageId}' has no joinMergeContract`,
        });
      }
      continue;
    }

    // mergedOutputContract → downstream inputContract compatibility
    if (joinContract.mergedOutputContract?.length) {
      const downstreamIds = findDownstreams(template, stageId, stageMap);
      for (const dsId of downstreamIds) {
        const ds = stageMap.get(dsId);
        const dsInput = ds?.contract?.inputContract;
        if (!dsInput?.length) continue;

        for (const expectation of dsInput) {
          if (expectation.required === false) continue;
          if (!findMatchingPromise(expectation, joinContract.mergedOutputContract)) {
            errors.push({
              severity: 'error',
              stageId: dsId,
              field: 'contract.inputContract',
              message: `Required artifact '${expectation.id}' (kind=${expectation.kind}) not satisfied by join stage '${stageId}' mergedOutputContract`,
              relatedStageId: stageId,
            });
          }
        }
      }
    }
  }
}

function checkArtifactConflicts(
  template: TemplateDefinition,
  errors: ContractError[],
): void {
  const seenIds = new Map<string, string>(); // artifactId → stageId
  const seenPaths = new Map<string, string>(); // pathPattern → stageId

  for (const stage of template.pipeline) {
    const stageId = resolveStageId(stage);
    const promises = stage.contract?.outputContract || [];

    for (const promise of promises) {
      // Duplicate artifact id across stages
      const existing = seenIds.get(promise.id);
      if (existing && existing !== stageId) {
        errors.push({
          severity: 'error',
          stageId,
          field: 'contract.outputContract',
          message: `Artifact id '${promise.id}' already declared by stage '${existing}'`,
          relatedStageId: existing,
        });
      } else {
        seenIds.set(promise.id, stageId);
      }

      // Duplicate path pattern across stages
      if (promise.pathPattern) {
        const existingPath = seenPaths.get(promise.pathPattern);
        if (existingPath && existingPath !== stageId) {
          errors.push({
            severity: 'error',
            stageId,
            field: 'contract.outputContract',
            message: `Artifact pathPattern '${promise.pathPattern}' conflicts with stage '${existingPath}'`,
            relatedStageId: existingPath,
          });
        } else {
          seenPaths.set(promise.pathPattern, stageId);
        }
      }
    }

    // Also check joinMergeContract mergedOutputContract
    const mergedPromises = stage.joinMergeContract?.mergedOutputContract || [];
    for (const promise of mergedPromises) {
      const existing = seenIds.get(promise.id);
      if (existing && existing !== stageId) {
        errors.push({
          severity: 'error',
          stageId,
          field: 'joinMergeContract.mergedOutputContract',
          message: `Artifact id '${promise.id}' already declared by stage '${existing}'`,
          relatedStageId: existing,
        });
      } else {
        seenIds.set(promise.id, stageId);
      }

      if (promise.pathPattern) {
        const existingPath = seenPaths.get(promise.pathPattern);
        if (existingPath && existingPath !== stageId) {
          errors.push({
            severity: 'error',
            stageId,
            field: 'joinMergeContract.mergedOutputContract',
            message: `Artifact pathPattern '${promise.pathPattern}' conflicts with stage '${existingPath}'`,
            relatedStageId: existingPath,
          });
        } else {
          seenPaths.set(promise.pathPattern, stageId);
        }
      }
    }
  }
}

function checkStageTypeConsistency(
  template: TemplateDefinition,
  warnings: ContractWarning[],
): void {
  for (const stage of template.pipeline) {
    const stageId = resolveStageId(stage);
    const stageType = stage.stageType || 'normal';

    if (stageType !== 'fan-out' && stage.fanOutContract) {
      warnings.push({
        severity: 'warning',
        stageId,
        message: `Stage '${stageId}' has fanOutContract but stageType is '${stageType}'`,
      });
    }
    if (stageType !== 'join' && stage.joinMergeContract) {
      warnings.push({
        severity: 'warning',
        stageId,
        message: `Stage '${stageId}' has joinMergeContract but stageType is '${stageType}'`,
      });
    }
  }
}

// ── Shared utilities ────────────────────────────────────────────────────────

/**
 * Resolve upstream stage IDs for a given stage.
 * If explicit upstreamStageIds are provided, use those.
 * Otherwise, fall back to the immediately previous stage in the pipeline array.
 */
function resolveUpstreams(
  template: TemplateDefinition,
  stageId: string,
  stageMap: StageMap,
): string[] {
  const stage = stageMap.get(stageId);
  if (!stage) return [];

  if (stage.upstreamStageIds?.length) {
    return stage.upstreamStageIds;
  }

  // Linear fallback: previous stage in pipeline
  const idx = template.pipeline.findIndex(s => resolveStageId(s) === stageId);
  if (idx > 0) {
    return [resolveStageId(template.pipeline[idx - 1])];
  }
  return [];
}

function findDownstreams(
  template: TemplateDefinition,
  stageId: string,
  stageMap: StageMap,
): string[] {
  const result: string[] = [];
  for (const stage of template.pipeline) {
    const sid = resolveStageId(stage);
    const upstreams = resolveUpstreams(template, sid, stageMap);
    if (upstreams.includes(stageId)) {
      result.push(sid);
    }
  }
  return result;
}

/**
 * Check if any ArtifactPromise in the list matches the given expectation.
 * Match criteria: same id, same kind, and (if specified) same format.
 */
function findMatchingPromise(
  expectation: ArtifactExpectation,
  promises: ArtifactPromise[],
): ArtifactPromise | undefined {
  return promises.find(p => {
    if (p.id !== expectation.id) return false;
    if (p.kind !== expectation.kind) return false;
    if (expectation.format && p.format && expectation.format !== p.format) return false;
    return true;
  });
}
