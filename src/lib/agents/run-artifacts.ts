/**
 * Run Artifacts — artifact scanning, delivery packet, scope audit, envelope I/O.
 *
 * Extracted from group-runtime.ts for maintainability.
 * Pure utility functions that operate on the artifact directory structure.
 */

import { getRun } from './run-registry';
import type {
  AgentRunState, TaskResult, ArtifactManifest, ArtifactRef, ResultEnvelope,
} from './group-types';
import type { DevelopmentWorkPackage, DevelopmentDeliveryPacket, WriteScopeAudit } from './development-template-types';
import { createLogger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const log = createLogger('RunArtifacts');

// ---------------------------------------------------------------------------
// readDeliveryPacket
// ---------------------------------------------------------------------------

export function readDeliveryPacket(
  artifactAbsDir: string,
  shortRunId: string,
  expectedTaskId?: string,
): DevelopmentDeliveryPacket | undefined {
  const packetPath = path.join(artifactAbsDir, 'delivery', 'delivery-packet.json');
  try {
    if (!fs.existsSync(packetPath)) {
      log.error({ runId: shortRunId }, 'delivery-packet.json not found');
      return undefined;
    }
    const raw = JSON.parse(fs.readFileSync(packetPath, 'utf-8'));

    if (!raw.status || !raw.summary || !raw.taskId || !raw.changedFiles) {
      log.error({ runId: shortRunId }, 'delivery-packet.json missing required fields (status, summary, taskId, changedFiles)');
      return undefined;
    }

    if (raw.status !== 'completed' && raw.status !== 'blocked') {
      log.error({ runId: shortRunId, status: raw.status }, 'delivery-packet.json has invalid status (must be completed|blocked)');
      return undefined;
    }

    if (raw.status === 'blocked' && !raw.blockedReason) {
      log.error({ runId: shortRunId }, 'delivery-packet.json has blocked status but no blockedReason — protocol violation');
      return undefined;
    }

    if (expectedTaskId && raw.taskId !== expectedTaskId) {
      log.error({ runId: shortRunId, expected: expectedTaskId, got: raw.taskId }, 'delivery-packet.json taskId mismatch — possible cross-contamination');
      return undefined;
    }

    if (!Array.isArray(raw.changedFiles)) {
      log.error({ runId: shortRunId }, 'delivery-packet.json changedFiles is not an array');
      return undefined;
    }

    return raw as DevelopmentDeliveryPacket;
  } catch (err: any) {
    log.error({ runId: shortRunId, err: err.message }, 'Failed to parse delivery-packet.json');
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// buildWriteScopeAudit
// ---------------------------------------------------------------------------

export function buildWriteScopeAudit(
  artifactAbsDir: string,
  workPackage: DevelopmentWorkPackage | undefined,
  result: TaskResult,
  deliveryPacket: DevelopmentDeliveryPacket | undefined,
  shortRunId: string,
): WriteScopeAudit | undefined {
  if (!workPackage || workPackage.allowedWriteScope.length === 0) {
    return undefined;
  }

  try {
    const declaredPaths = workPackage.allowedWriteScope.map(s => s.path);
    const observedChangedFiles = result.changedFiles || [];
    const reportedChangedFiles = deliveryPacket?.changedFiles || [];
    const effectiveChangedFiles = [...new Set([...observedChangedFiles, ...reportedChangedFiles])];

    const outOfScopeFiles = effectiveChangedFiles.filter(f => {
      return !declaredPaths.some(dp => f.includes(dp) || dp.includes(f));
    });

    const audit: WriteScopeAudit = {
      taskId: workPackage.taskId,
      withinScope: outOfScopeFiles.length === 0,
      declaredScopeCount: declaredPaths.length,
      observedChangedFiles,
      reportedChangedFiles,
      effectiveChangedFiles,
      outOfScopeFiles,
    };

    const deliveryDir = path.join(artifactAbsDir, 'delivery');
    if (!fs.existsSync(deliveryDir)) fs.mkdirSync(deliveryDir, { recursive: true });
    fs.writeFileSync(path.join(deliveryDir, 'scope-audit.json'), JSON.stringify(audit, null, 2), 'utf-8');
    log.info({ runId: shortRunId, withinScope: audit.withinScope, outOfScope: outOfScopeFiles.length }, 'Scope audit written');

    return audit;
  } catch (err: any) {
    log.warn({ runId: shortRunId, err: err.message }, 'Failed to build scope audit');
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// scanArtifactManifest
// ---------------------------------------------------------------------------

export function scanArtifactManifest(
  runId: string,
  templateId: string | undefined,
  artifactAbsDir: string,
  executionTarget?: ArtifactManifest['executionTarget'],
): ArtifactManifest {
  const items: ArtifactRef[] = [];
  const allowedExtensions = new Set(['.md', '.json', '.txt']);

  const scanDirs = [
    { dir: 'specs', kindPrefix: 'product' },
    { dir: 'architecture', kindPrefix: 'architecture' },
    { dir: 'review', kindPrefix: 'review' },
    { dir: 'delivery', kindPrefix: 'delivery' },
  ];

  function scanRecursive(baseDirPath: string, kindPrefix: string): void {
    if (!fs.existsSync(baseDirPath)) return;
    try {
      const entries = fs.readdirSync(baseDirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(baseDirPath, entry.name);
        if (entry.isDirectory()) {
          scanRecursive(fullPath, kindPrefix);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!allowedExtensions.has(ext)) continue;

          const baseName = path.basename(entry.name, ext);
          const relPath = path.relative(artifactAbsDir, fullPath);
          const kind = `${kindPrefix}.${baseName}`;

          items.push({
            id: randomUUID(),
            kind,
            title: baseName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            path: relPath,
            format: ext.slice(1) as 'md' | 'json' | 'txt',
            sourceRunId: runId,
          });
        }
      }
    } catch {
      // Directory read failed, skip
    }
  }

  for (const { dir, kindPrefix } of scanDirs) {
    scanRecursive(path.join(artifactAbsDir, dir), kindPrefix);
  }
  return {
    runId,
    ...(templateId ? { templateId } : {}),
    ...(executionTarget ? { executionTarget } : {}),
    items,
  };
}

// ---------------------------------------------------------------------------
// copyUpstreamArtifacts
// ---------------------------------------------------------------------------

export function copyUpstreamArtifacts(
  workspacePath: string,
  artifactAbsDir: string,
  inputArtifacts: ArtifactRef[],
  runId: string,
): void {
  const shortRunId = runId.slice(0, 8);
  const inputDir = path.join(artifactAbsDir, 'input');

  try {
    if (!fs.existsSync(inputDir)) {
      fs.mkdirSync(inputDir, { recursive: true });
    }

    for (const art of inputArtifacts) {
      if (!art.sourceRunId) continue;
      const srcRun = getRun(art.sourceRunId);
      if (!srcRun?.artifactDir) continue;

      const srcPath = path.join(workspacePath, srcRun.artifactDir, art.path);
      if (!fs.existsSync(srcPath)) {
        log.warn({ runId: shortRunId, srcPath: art.path }, 'Source artifact not found, skipping copy');
        continue;
      }

      const destDir = path.join(inputDir, art.sourceRunId.slice(0, 8));
      const destPath = path.join(destDir, art.path);
      const destParent = path.dirname(destPath);
      if (!fs.existsSync(destParent)) {
        fs.mkdirSync(destParent, { recursive: true });
      }
      fs.copyFileSync(srcPath, destPath);
      log.debug({ runId: shortRunId, src: art.path }, 'Upstream artifact copied');
    }

    log.info({ runId: shortRunId, count: inputArtifacts.length }, 'Upstream artifacts copied to input/');
  } catch (err: any) {
    log.warn({ runId: shortRunId, err: err.message }, 'Failed to copy upstream artifacts (non-fatal)');
  }
}

// ---------------------------------------------------------------------------
// buildResultEnvelope
// ---------------------------------------------------------------------------

export function buildResultEnvelope(
  run: AgentRunState,
  manifest: ArtifactManifest,
  decision: string,
  result?: TaskResult,
): ResultEnvelope {
  return {
    templateId: run.templateId || manifest.templateId,
    executionTarget: run.executionTarget || manifest.executionTarget,
    runId: run.runId,
    status: run.status,
    decision,
    summary: result?.summary || run.result?.summary || 'Advisory run completed',
    outputArtifacts: manifest.items,
    risks: [],
    nextAction: decision === 'approved'
      ? 'Ready for next phase'
      : decision === 'rejected'
        ? 'Requires re-evaluation'
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// writeEnvelopeFile
// ---------------------------------------------------------------------------

export function writeEnvelopeFile(artifactAbsDir: string, filename: string, data: unknown): void {
  try {
    if (!fs.existsSync(artifactAbsDir)) {
      fs.mkdirSync(artifactAbsDir, { recursive: true });
    }
    fs.writeFileSync(path.join(artifactAbsDir, filename), JSON.stringify(data, null, 2), 'utf-8');
  } catch (err: any) {
    log.warn({ filename, err: err.message }, 'Failed to write envelope file');
  }
}
