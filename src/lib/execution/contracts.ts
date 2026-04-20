import type { ReviewDecision } from '../agents/group-types';

export type ExecutionProfile =
  | {
      kind: 'workflow-run';
      workflowRef?: string;
      skillHints?: string[];
    }
  | {
      kind: 'review-flow';
      templateId: string;
      stageId?: string;
      reviewPolicyId?: string;
      roles?: string[];
    }
  | {
      kind: 'dag-orchestration';
      templateId: string;
      stageId?: string;
    };

export interface ExecutionProfileSummary {
  kind: ExecutionProfile['kind'];
  label: string;
  detail?: string;
}

export function summarizeExecutionProfile(profile: ExecutionProfile): ExecutionProfileSummary {
  if (profile.kind === 'workflow-run') {
    return {
      kind: 'workflow-run',
      label: 'Workflow Run',
      detail: profile.workflowRef || profile.skillHints?.join(', ') || undefined,
    };
  }

  if (profile.kind === 'review-flow') {
    return {
      kind: 'review-flow',
      label: 'Review Flow',
      detail: profile.stageId
        ? `${profile.templateId} / ${profile.stageId}`
        : profile.reviewPolicyId || profile.roles?.join(' → ') || profile.templateId,
    };
  }

  return {
    kind: 'dag-orchestration',
    label: 'DAG Orchestration',
    detail: profile.stageId ? `${profile.templateId} / ${profile.stageId}` : profile.templateId,
  };
}

export function isExecutionProfile(value: unknown): value is ExecutionProfile {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'workflow-run') return true;
  if (kind === 'review-flow') {
    return typeof (value as { templateId?: unknown }).templateId === 'string';
  }
  if (kind === 'dag-orchestration') return typeof (value as { templateId?: unknown }).templateId === 'string';
  return false;
}

export function deriveExecutionProfileFromRun(input: {
  executionTarget?: { kind: 'template' | 'prompt' | 'project-only'; templateId?: string; stageId?: string; promptAssetRefs?: string[]; skillHints?: string[] };
  executorKind?: 'template' | 'prompt';
  reviewOutcome?: ReviewDecision | 'revise-exhausted' | null;
  resolvedWorkflowRef?: string;
  resolvedSkillRefs?: string[];
  stageExecutionMode?: 'legacy-single' | 'review-loop' | 'delivery-single-pass' | 'orchestration';
  reviewPolicyId?: string;
  roleIds?: string[];
}): ExecutionProfile | null {
  if (input.executionTarget?.kind === 'prompt' || input.executorKind === 'prompt') {
    return {
      kind: 'workflow-run',
      ...(input.resolvedWorkflowRef ? { workflowRef: input.resolvedWorkflowRef } : {}),
      ...(input.resolvedSkillRefs?.length ? { skillHints: input.resolvedSkillRefs } : {}),
    };
  }

  if (input.executionTarget?.kind === 'template' && input.executionTarget.templateId) {
    if (input.stageExecutionMode === 'review-loop') {
      return {
        kind: 'review-flow',
        templateId: input.executionTarget.templateId,
        ...(input.executionTarget.stageId ? { stageId: input.executionTarget.stageId } : {}),
        ...(input.reviewPolicyId ? { reviewPolicyId: input.reviewPolicyId } : {}),
        ...(input.roleIds?.length ? { roles: input.roleIds } : {}),
      };
    }
    return {
      kind: 'dag-orchestration',
      templateId: input.executionTarget.templateId,
      ...(input.executionTarget.stageId ? { stageId: input.executionTarget.stageId } : {}),
    };
  }

  return null;
}

export function normalizeExecutionProfileForTarget(profile: ExecutionProfile): {
  kind: 'template' | 'prompt';
  templateId?: string;
  stageId?: string;
  promptAssetRefs?: string[];
  skillHints?: string[];
} {
  if (profile.kind === 'workflow-run') {
    return {
      kind: 'prompt',
      ...(profile.workflowRef ? { promptAssetRefs: [profile.workflowRef] } : {}),
      ...(profile.skillHints?.length ? { skillHints: profile.skillHints } : {}),
    };
  }

  if (profile.kind === 'dag-orchestration') {
    return {
      kind: 'template',
      templateId: profile.templateId,
      ...(profile.stageId ? { stageId: profile.stageId } : {}),
    };
  }

  if (profile.kind === 'review-flow') {
    return {
      kind: 'template',
      templateId: profile.templateId,
      ...(profile.stageId ? { stageId: profile.stageId } : {}),
    };
  }

  return {
    kind: 'template',
  };
}

export function deriveExecutionProfileFromScheduledAction(action: {
  kind: string;
  templateId?: string;
  stageId?: string;
  promptAssetRefs?: string[];
  skillHints?: string[];
  executionProfile?: ExecutionProfile;
}): ExecutionProfile | null {
  if (action.executionProfile) return action.executionProfile;
  if (action.kind === 'dispatch-prompt') {
    return {
      kind: 'workflow-run',
      ...(action.promptAssetRefs?.[0] ? { workflowRef: action.promptAssetRefs[0] } : {}),
      ...(action.skillHints?.length ? { skillHints: action.skillHints } : {}),
    };
  }
  if (action.kind === 'dispatch-pipeline' && action.templateId) {
    return {
      kind: 'dag-orchestration',
      templateId: action.templateId,
      ...(action.stageId ? { stageId: action.stageId } : {}),
    };
  }
  return null;
}
