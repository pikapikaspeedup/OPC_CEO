import { randomUUID } from 'crypto';

import type {
  EvidenceRef,
  SystemImprovementArea,
  SystemImprovementSeverity,
  SystemImprovementSignal,
  SystemImprovementSignalSource,
} from './contracts';
import { upsertSystemImprovementSignal } from './self-improvement-store';
import { getSystemImprovementSignal } from './self-improvement-store';

export interface CreateSystemImprovementSignalInput {
  id?: string;
  source: SystemImprovementSignalSource;
  title: string;
  summary: string;
  evidenceRefs?: EvidenceRef[];
  affectedAreas?: SystemImprovementArea[];
  severity?: SystemImprovementSeverity;
  recurrence?: number;
  estimatedBenefit?: SystemImprovementSignal['estimatedBenefit'];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

function inferSeverity(input: CreateSystemImprovementSignalInput): SystemImprovementSeverity {
  if (input.severity) return input.severity;
  if (input.source === 'runtime-error' || input.source === 'test-failure') return 'high';
  if (input.source === 'performance' || input.source === 'architecture-risk' || input.source === 'user-story-gap') return 'medium';
  return 'low';
}

function inferAreas(input: CreateSystemImprovementSignalInput): SystemImprovementArea[] {
  if (input.affectedAreas?.length) return input.affectedAreas;
  if (input.source === 'performance') return ['api', 'runtime'];
  if (input.source === 'runtime-error') return ['runtime'];
  if (input.source === 'test-failure') return ['runtime', 'api'];
  if (input.source === 'ux-breakpoint') return ['frontend'];
  if (input.source === 'architecture-risk') return ['runtime', 'database'];
  if (input.source === 'user-story-gap') return ['docs'];
  return ['docs'];
}

export function createSystemImprovementSignal(input: CreateSystemImprovementSignalInput): SystemImprovementSignal {
  const now = new Date().toISOString();
  const signalId = input.id || `system-improvement-signal-${randomUUID()}`;
  const existing = input.id ? getSystemImprovementSignal(input.id) : null;
  return upsertSystemImprovementSignal({
    id: signalId,
    source: input.source,
    title: input.title.trim(),
    summary: input.summary.trim(),
    evidenceRefs: input.evidenceRefs || [],
    affectedAreas: inferAreas(input),
    severity: inferSeverity(input),
    recurrence: Math.max(1, Math.trunc(input.recurrence || existing?.recurrence || 1)),
    estimatedBenefit: input.estimatedBenefit || {},
    createdAt: input.createdAt || existing?.createdAt || now,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}
