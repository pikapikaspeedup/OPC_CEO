export type DecisionTarget =
  | { kind: 'system-improvement-proposal'; proposalId: string }
  | { kind: 'growth-proposal'; proposalId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'project-stage-gate'; projectId: string; stageId: string }
  | { kind: 'run'; runId: string; projectId?: string }
  | { kind: 'knowledge'; knowledgeId: string }
  | { kind: 'conversation'; conversationId: string; title?: string; section?: 'ceo' | 'conversations' }
  | { kind: 'ops'; proposalId?: string; query?: string }
  | { kind: 'settings'; tab?: 'profile' | 'provider' | 'api-keys' | 'scenes' | 'autonomy' | 'mcp' | 'messaging'; focus?: 'third-party-provider' };

export type DecisionItemTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
export type DecisionItemPriority = '高' | '中' | '低';
export type DecisionItemOwner = 'ceo' | 'ai' | 'ops' | 'none';
type DecisionSettingsTab = Extract<DecisionTarget, { kind: 'settings' }>['tab'];

export interface DecisionItemView {
  id: string;
  title: string;
  source: string;
  status: string;
  detail?: string;
  priority: DecisionItemPriority;
  tone: DecisionItemTone;
  currentOwner: DecisionItemOwner;
  nextAction: string;
  target: DecisionTarget;
  createdAt: string;
  updatedAt: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDecisionTarget(value: unknown): value is DecisionTarget {
  if (!isPlainObject(value) || typeof value.kind !== 'string') return false;
  switch (value.kind) {
    case 'system-improvement-proposal':
    case 'growth-proposal':
      return typeof value.proposalId === 'string' && value.proposalId.length > 0;
    case 'project':
      return typeof value.projectId === 'string' && value.projectId.length > 0;
    case 'project-stage-gate':
      return typeof value.projectId === 'string' && value.projectId.length > 0
        && typeof value.stageId === 'string' && value.stageId.length > 0;
    case 'run':
      return typeof value.runId === 'string' && value.runId.length > 0;
    case 'knowledge':
      return typeof value.knowledgeId === 'string' && value.knowledgeId.length > 0;
    case 'conversation':
      return typeof value.conversationId === 'string' && value.conversationId.length > 0;
    case 'ops':
      return (!('proposalId' in value) || typeof value.proposalId === 'string')
        && (!('query' in value) || typeof value.query === 'string');
    case 'settings':
      return true;
    default:
      return false;
  }
}

export function encodeDecisionTarget(target: DecisionTarget): string {
  switch (target.kind) {
    case 'system-improvement-proposal':
      return `si~${target.proposalId}`;
    case 'growth-proposal':
      return `gp~${target.proposalId}`;
    case 'project':
      return `pj~${target.projectId}`;
    case 'project-stage-gate':
      return `sg~${target.projectId}~${target.stageId}`;
    case 'run':
      return target.projectId
        ? `rn~${target.runId}~${target.projectId}`
        : `rn~${target.runId}`;
    case 'knowledge':
      return `kn~${target.knowledgeId}`;
    case 'conversation':
      return [
        'cv',
        target.section || '',
        target.conversationId,
        target.title || '',
      ].join('~');
    case 'ops':
      return [
        'ops',
        target.proposalId || '',
        target.query || '',
      ].join('~');
    case 'settings':
      return [
        'st',
        target.tab || '',
        target.focus || '',
      ].join('~');
    default:
      return JSON.stringify(target);
  }
}

export function decodeDecisionTarget(value: string | null | undefined): DecisionTarget | null {
  if (!value) return null;
  const parts = value.split('~');
  const [kind, first = '', second = '', third = ''] = parts;
  switch (kind) {
    case 'si':
      return first
        ? { kind: 'system-improvement-proposal', proposalId: first }
        : null;
    case 'gp':
      return first
        ? { kind: 'growth-proposal', proposalId: first }
        : null;
    case 'pj':
      return first
        ? { kind: 'project', projectId: first }
        : null;
    case 'sg':
      return first && second
        ? { kind: 'project-stage-gate', projectId: first, stageId: second }
        : null;
    case 'rn':
      if (!first) return null;
      return second
        ? { kind: 'run', runId: first, projectId: second }
        : { kind: 'run', runId: first };
    case 'kn':
      return first
        ? { kind: 'knowledge', knowledgeId: first }
        : null;
    case 'cv':
      return second
        ? {
          kind: 'conversation',
          ...(first === 'ceo' || first === 'conversations' ? { section: first } : {}),
          conversationId: second,
          ...(third ? { title: third } : {}),
        }
        : null;
    case 'ops':
      if (!first && !second) return { kind: 'ops' };
      return {
        kind: 'ops',
        ...(first ? { proposalId: first } : {}),
        ...(second ? { query: second } : {}),
      };
    case 'st':
      return {
        kind: 'settings',
        ...(first ? { tab: first as DecisionSettingsTab } : {}),
        ...(second === 'third-party-provider' ? { focus: 'third-party-provider' as const } : {}),
      };
    default:
      return null;
  }
}
