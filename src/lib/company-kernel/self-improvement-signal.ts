import { randomUUID } from 'crypto';

import type {
  EvidenceRef,
  SystemImprovementArea,
  SystemImprovementSeverity,
  SystemImprovementSignal,
  SystemImprovementSignalSource,
} from './contracts';
import { upsertSystemImprovementSignal } from './self-improvement-store';

export interface CreateSystemImprovementSignalInput {
  source: SystemImprovementSignalSource;
  title: string;
  summary: string;
  evidenceRefs?: EvidenceRef[];
  affectedAreas?: SystemImprovementArea[];
  severity?: SystemImprovementSeverity;
  recurrence?: number;
  estimatedBenefit?: SystemImprovementSignal['estimatedBenefit'];
  metadata?: Record<string, unknown>;
}

function inferSeverity(input: CreateSystemImprovementSignalInput): SystemImprovementSeverity {
  if (input.severity) return input.severity;
  if (input.source === 'runtime-error' || input.source === 'test-failure') return 'high';
  if (input.source === 'performance' || input.source === 'architecture-risk') return 'medium';
  return 'low';
}

function inferAreas(input: CreateSystemImprovementSignalInput): SystemImprovementArea[] {
  if (input.affectedAreas?.length) return input.affectedAreas;
  if (input.source === 'performance') return ['api', 'runtime'];
  if (input.source === 'runtime-error') return ['runtime'];
  if (input.source === 'test-failure') return ['runtime', 'api'];
  if (input.source === 'ux-breakpoint') return ['frontend'];
  if (input.source === 'architecture-risk') return ['runtime', 'database'];
  return ['docs'];
}

export function createSystemImprovementSignal(input: CreateSystemImprovementSignalInput): SystemImprovementSignal {
  const now = new Date().toISOString();
  return upsertSystemImprovementSignal({
    id: `system-improvement-signal-${randomUUID()}`,
    source: input.source,
    title: input.title.trim(),
    summary: input.summary.trim(),
    evidenceRefs: input.evidenceRefs || [],
    affectedAreas: inferAreas(input),
    severity: inferSeverity(input),
    recurrence: Math.max(1, Math.trunc(input.recurrence || 1)),
    estimatedBenefit: input.estimatedBenefit || {},
    createdAt: now,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}
