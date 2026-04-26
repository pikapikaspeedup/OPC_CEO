/**
 * Run finalization — advisory manifest/envelope finalization + delivery packet finalization.
 *
 * Extracted from group-runtime.ts to keep the runtime orchestrator focused.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';
import { getRun, updateRun } from './run-registry';
import { persistKnowledgeForRun } from '../knowledge';
import {
  readDeliveryPacket,
  buildWriteScopeAudit,
  scanArtifactManifest,
  buildResultEnvelope,
  writeEnvelopeFile,
} from './run-artifacts';
import { ARTIFACT_ROOT_DIR } from './gateway-home';
import type {
  TaskResult, GroupDefinition, ResultEnvelope,
} from './group-types';
import type { DevelopmentWorkPackage } from './development-template-types';

const log = createLogger('Finalization');

// ---------------------------------------------------------------------------
// finalizeAdvisoryRun
// ---------------------------------------------------------------------------

export function finalizeAdvisoryRun(
  runId: string,
  group: GroupDefinition,
  artifactAbsDir: string,
  decision: string,
  result?: TaskResult,
): void {
  if (!group.capabilities?.emitsManifest) return;

  const shortRunId = runId.slice(0, 8);

  try {
    // 1. Scan artifact directory and build manifest
    const manifest = scanArtifactManifest(runId, group.templateId, artifactAbsDir);
    const manifestPath = path.join(artifactAbsDir, 'artifacts.manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    log.info({ runId: shortRunId, items: manifest.items.length }, 'Artifact manifest written');

    // 2. Build and write result envelope
    const run = getRun(runId);
    const resultEnvelope = buildResultEnvelope(run!, manifest, decision, result);
    writeEnvelopeFile(artifactAbsDir, 'result-envelope.json', resultEnvelope);

    // 3. Update run state with manifest path and result envelope
    // V3.5 Fix: Use run's artifactDir (now per-run isolated) for manifest path
    const relManifestPath = run?.artifactDir
      ? `${run.artifactDir}artifacts.manifest.json`
      : `${ARTIFACT_ROOT_DIR}/runs/${runId}/artifacts.manifest.json`;
    updateRun(runId, {
      artifactManifestPath: relManifestPath,
      resultEnvelope,
    });

    log.info({ runId: shortRunId, decision }, 'Advisory run finalized');

    // V6: Extract and persist knowledge from completed run
    if (decision === 'approved' && result) {
      const run = getRun(runId);
      if (run?.workspace) {
        try {
          persistKnowledgeForRun({
            runId,
            workspaceUri: run.workspace,
            result,
            promptResolution: run.promptResolution,
            resolvedWorkflowRef: run.resolvedWorkflowRef,
            resolvedSkillRefs: run.resolvedSkillRefs,
            createdAt: run.finishedAt || run.createdAt,
          });
        } catch (e: unknown) {
          log.debug({ runId: shortRunId, err: e instanceof Error ? e.message : String(e) }, 'Memory extraction failed (non-fatal)');
        }
      }
    }
  } catch (err: unknown) {
    log.warn({ runId: shortRunId, err: err instanceof Error ? err.message : String(err) }, 'Failed to finalize advisory run (non-fatal)');
  }
}

// ---------------------------------------------------------------------------
// finalizeDeliveryRun
// ---------------------------------------------------------------------------

export function finalizeDeliveryRun(
  runId: string,
  group: GroupDefinition,
  artifactAbsDir: string,
  result: TaskResult,
  workPackage?: DevelopmentWorkPackage,
): void {
  const shortRunId = runId.slice(0, 8);

  try {
    // 1. Read delivery packet (HARD CONSTRAINT: missing packet = protocol violation)
    const expectedTaskId = workPackage?.taskId || getRun(runId)?.taskEnvelope?.taskId;
    const deliveryPacket = readDeliveryPacket(artifactAbsDir, shortRunId, expectedTaskId);
    if (!deliveryPacket) {
      log.error({ runId: shortRunId }, 'delivery-packet.json missing or invalid — delivery contract violated');
      updateRun(runId, {
        status: 'blocked',
        result: { ...result, status: 'blocked' },
        lastError: 'Delivery contract violated: delivery-packet.json is missing or invalid',
      });
      return;
    }

    // 2. Build scope audit
    const scopeAudit = buildWriteScopeAudit(artifactAbsDir, workPackage, result, deliveryPacket, shortRunId);

    // 3. Determine decision
    let decision: string;
    if (deliveryPacket.status === 'blocked') {
      decision = 'blocked-by-team';
    } else if (scopeAudit && !scopeAudit.withinScope && scopeAudit.outOfScopeFiles.length > 0) {
      decision = 'delivered-with-scope-warnings';
    } else {
      decision = 'delivered';
    }

    // 4. Scan manifest
    const manifest = scanArtifactManifest(runId, group.templateId, artifactAbsDir);
    const manifestPath = path.join(artifactAbsDir, 'artifacts.manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    // 5. Build result envelope with delivery-specific fields
    const run = getRun(runId);
    const resultEnvelope: ResultEnvelope = {
      templateId: group.templateId,
      runId,
      taskId: workPackage?.taskId || run?.taskEnvelope?.taskId,
      status: decision === 'blocked-by-team' ? 'blocked' : 'completed',
      decision,
      summary: deliveryPacket?.summary || result.summary,
      outputArtifacts: manifest.items,
      risks: deliveryPacket?.residualRisks || [],
      openQuestions: deliveryPacket?.openQuestions || [],
      nextAction: deliveryPacket?.status === 'blocked'
        ? `Blocked: ${deliveryPacket.blockedReason || 'unknown reason'}`
        : deliveryPacket?.followUps?.join('; '),
    };
    writeEnvelopeFile(artifactAbsDir, 'result-envelope.json', resultEnvelope);

    // 6. Update run state
    // V3.5 Fix: Use run's artifactDir (now per-run isolated) for manifest path
    const relManifestPath = run?.artifactDir
      ? `${run.artifactDir}artifacts.manifest.json`
      : `${ARTIFACT_ROOT_DIR}/runs/${runId}/artifacts.manifest.json`;
    const finalStatus = decision === 'blocked-by-team' ? 'blocked' as const : 'completed' as const;
    updateRun(runId, {
      status: finalStatus,
      result: {
        ...result,
        status: finalStatus,
        summary: deliveryPacket?.summary || result.summary,
      },
      artifactManifestPath: relManifestPath,
      resultEnvelope,
      lastError: decision === 'blocked-by-team' ? deliveryPacket?.blockedReason : undefined,
    });

    if (finalStatus === 'completed' && run?.workspace) {
      try {
        persistKnowledgeForRun({
          runId,
          workspaceUri: run.workspace,
          result: {
            ...result,
            status: finalStatus,
            summary: deliveryPacket?.summary || result.summary,
          },
          promptResolution: run.promptResolution,
          resolvedWorkflowRef: run.resolvedWorkflowRef,
          resolvedSkillRefs: run.resolvedSkillRefs,
          createdAt: run.finishedAt || run.createdAt,
        });
      } catch (e: unknown) {
        log.debug({ runId: shortRunId, err: e instanceof Error ? e.message : String(e) }, 'Delivery knowledge persistence failed (non-fatal)');
      }
    }

    log.info({ runId: shortRunId, decision, scopeOk: scopeAudit?.withinScope }, 'Delivery run finalized');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ runId: shortRunId, err: message }, 'Delivery finalization failed');
    updateRun(runId, {
      status: 'blocked',
      result: { ...result, status: 'blocked' },
      lastError: `Delivery finalization error: ${message}`,
    });
  }
}
