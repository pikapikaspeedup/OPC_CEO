import type {
  ProtectedCorePolicy,
  SystemImprovementArea,
  SystemImprovementRisk,
  SystemImprovementSignal,
} from './contracts';

export function buildDefaultProtectedCorePolicy(now = new Date().toISOString()): ProtectedCorePolicy {
  return {
    id: 'protected-core-policy:default',
    protectedGlobs: [
      'src/lib/agents/scheduler.ts',
      'src/server/workers/*',
      'src/lib/company-kernel/budget-*',
      'src/lib/company-kernel/circuit-breaker.ts',
      'src/lib/company-kernel/memory-*',
      'src/lib/company-kernel/*promotion*',
      'src/lib/approval/*',
      'src/lib/providers/*',
      'src/lib/storage/*',
      'src/app/api/company/**',
      'server.ts',
      'middleware.ts',
    ],
    criticalGlobs: [
      'src/lib/storage/*',
      'src/server/workers/*',
      'server.ts',
      'middleware.ts',
    ],
    requiresApprovalFor: [
      'database',
      'scheduler',
      'approval',
      'provider',
      'memory',
      'runtime',
      'security',
    ],
    maxFilesWithoutApproval: 5,
    requireBranch: true,
    requireTests: true,
    requireRollbackPlan: true,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function globToRegExp(glob: string): RegExp {
  const escaped = normalizePath(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  const normalized = normalizePath(filePath);
  return globs.some((glob) => globToRegExp(glob).test(normalized));
}

function protectedAreaFromFile(filePath: string): string | null {
  const normalized = normalizePath(filePath);
  if (normalized.includes('/storage/') || normalized.includes('gateway-db')) return 'database';
  if (normalized.includes('scheduler')) return 'scheduler';
  if (normalized.includes('/approval/')) return 'approval';
  if (normalized.includes('/providers/')) return 'provider';
  if (normalized.includes('memory-') || normalized.includes('promotion')) return 'memory';
  if (normalized.includes('/runtime/') || normalized === 'server.ts') return 'runtime';
  if (normalized.includes('auth') || normalized.includes('secret') || normalized === 'middleware.ts') return 'security';
  return null;
}

function areaRequiresApproval(area: SystemImprovementArea): boolean {
  return area === 'database'
    || area === 'scheduler'
    || area === 'provider'
    || area === 'approval'
    || area === 'runtime';
}

export function evaluateSystemImprovementRisk(input: {
  affectedFiles?: string[];
  affectedAreas?: SystemImprovementArea[];
  sourceSignals?: SystemImprovementSignal[];
  policy?: ProtectedCorePolicy;
}): {
  risk: SystemImprovementRisk;
  protectedAreas: string[];
  reasons: string[];
} {
  const policy = input.policy || buildDefaultProtectedCorePolicy();
  const affectedFiles = input.affectedFiles || [];
  const affectedAreas = input.affectedAreas || [];
  const protectedAreas = new Set<string>();
  const reasons: string[] = [];
  let score = 0;

  for (const filePath of affectedFiles) {
    if (matchesAnyGlob(filePath, policy.criticalGlobs)) {
      score = Math.max(score, 100);
      reasons.push(`critical-file:${filePath}`);
    } else if (matchesAnyGlob(filePath, policy.protectedGlobs)) {
      score = Math.max(score, 80);
      reasons.push(`protected-file:${filePath}`);
    }
    const area = protectedAreaFromFile(filePath);
    if (area) protectedAreas.add(area);
  }

  if (affectedFiles.length > policy.maxFilesWithoutApproval) {
    score = Math.max(score, 75);
    reasons.push(`file-count:${affectedFiles.length}`);
  }

  for (const area of affectedAreas) {
    if (areaRequiresApproval(area)) {
      score = Math.max(score, 80);
      protectedAreas.add(area);
      reasons.push(`protected-area:${area}`);
    }
  }

  for (const signal of input.sourceSignals || []) {
    if (signal.severity === 'critical') {
      score = Math.max(score, 90);
      reasons.push(`critical-signal:${signal.id}`);
    } else if (signal.severity === 'high') {
      score = Math.max(score, 70);
    }
  }

  if (affectedFiles.length > 0 && affectedFiles.every((filePath) => normalizePath(filePath).startsWith('docs/'))) {
    score = Math.min(score, 25);
    reasons.push('docs-only');
  }

  const risk: SystemImprovementRisk = score >= 90
    ? 'critical'
    : score >= 70
      ? 'high'
      : score >= 35
        ? 'medium'
        : 'low';

  return {
    risk,
    protectedAreas: Array.from(protectedAreas).sort(),
    reasons,
  };
}
