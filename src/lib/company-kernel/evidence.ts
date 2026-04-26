import { createHash } from 'crypto';

import type { ArtifactRef } from '../agents/group-types';
import type { EvidenceRef, EvidenceRefType } from './contracts';

function hashId(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

export function buildEvidenceRef(input: {
  type: EvidenceRefType;
  label: string;
  runId?: string;
  artifactPath?: string;
  filePath?: string;
  apiRoute?: string;
  excerpt?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}): EvidenceRef {
  const checksumSeed = [
    input.type,
    input.label,
    input.runId || '',
    input.artifactPath || '',
    input.filePath || '',
    input.apiRoute || '',
    input.excerpt || '',
  ].join('\n');
  const checksum = hashId(checksumSeed);

  return {
    id: `ev-${checksum}`,
    type: input.type,
    label: input.label,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.artifactPath ? { artifactPath: input.artifactPath } : {}),
    ...(input.filePath ? { filePath: input.filePath } : {}),
    ...(input.apiRoute ? { apiRoute: input.apiRoute } : {}),
    ...(input.excerpt ? { excerpt: input.excerpt } : {}),
    checksum,
    createdAt: input.createdAt,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function buildRunEvidenceRef(runId: string, createdAt: string): EvidenceRef {
  return buildEvidenceRef({
    type: 'run',
    runId,
    label: `Run ${runId.slice(0, 8)}`,
    createdAt,
  });
}

export function buildArtifactEvidenceRefs(input: {
  runId: string;
  artifacts: ArtifactRef[];
  createdAt: string;
}): EvidenceRef[] {
  return input.artifacts.map((artifact) => buildEvidenceRef({
    type: artifact.kind === 'delivery-packet' || artifact.path.includes('delivery-packet')
      ? 'delivery-packet'
      : 'artifact',
    runId: input.runId,
    artifactPath: artifact.path,
    label: artifact.title || artifact.path,
    createdAt: input.createdAt,
    metadata: {
      artifactId: artifact.id,
      kind: artifact.kind,
      format: artifact.format,
      roleId: artifact.roleId,
      round: artifact.round,
    },
  }));
}

export function dedupeEvidenceRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const result: EvidenceRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    result.push(ref);
  }
  return result;
}

