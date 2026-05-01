import { executeDispatch } from '../agents/dispatch-service';
import { createProject, getProject } from '../agents/project-registry';
import type { ProjectDefinition } from '../agents/project-types';
import { createLogger } from '../logger';
import {
  PLATFORM_ENGINEERING_DEPARTMENT_ID,
  defaultPlatformEngineeringProjectGovernance,
  ensurePlatformEngineeringWorkspaceSkeleton,
  getPlatformEngineeringWorkspaceUri,
} from '../platform-engineering';
import type { SystemImprovementProposal } from './contracts';
import {
  getSystemImprovementProposal,
  patchSystemImprovementProposal,
} from './self-improvement-store';

const log = createLogger('SelfImprovementExecution');
const DEFAULT_PLATFORM_ENGINEERING_TEMPLATE_ID = 'development-template-1';

export interface SystemImprovementLaunchResult {
  status: 'already-running' | 'dispatched' | 'dispatch-failed';
  projectId?: string;
  runId?: string;
  createdProject: boolean;
  templateId: string;
  workspaceUri: string;
  error?: string;
}

function mergeMetadata(
  proposal: SystemImprovementProposal,
  patch: Record<string, unknown>,
): SystemImprovementProposal {
  const updated = patchSystemImprovementProposal(proposal.id, {
    metadata: {
      ...(proposal.metadata || {}),
      ...patch,
    },
  });
  if (!updated) {
    throw new Error(`System improvement proposal not found: ${proposal.id}`);
  }
  return updated;
}

function mergeLinkedRunIds(existing: string[], next?: string | null): string[] {
  if (!next) return existing;
  return Array.from(new Set([...existing, next]));
}

function determineWorkspaceUri(proposal: SystemImprovementProposal): string {
  const workspaceUri = typeof proposal.metadata?.workspaceUri === 'string'
    ? proposal.metadata.workspaceUri
    : getPlatformEngineeringWorkspaceUri();
  return workspaceUri || getPlatformEngineeringWorkspaceUri();
}

function determineTemplateId(proposal: SystemImprovementProposal): string {
  const preferred = typeof proposal.metadata?.preferredTemplateId === 'string'
    ? proposal.metadata.preferredTemplateId
    : null;
  return preferred || DEFAULT_PLATFORM_ENGINEERING_TEMPLATE_ID;
}

function buildProjectName(proposal: SystemImprovementProposal): string {
  const title = proposal.title.trim();
  const base = title.startsWith('系统改进：') ? title : `系统改进：${title}`;
  return base.length > 96 ? `${base.slice(0, 93)}...` : base;
}

function buildProjectGoal(proposal: SystemImprovementProposal): string {
  const sections = [
    `Proposal ID: ${proposal.id}`,
    `Title: ${proposal.title}`,
    '',
    'Summary:',
    proposal.summary,
    '',
    `Risk: ${proposal.risk}`,
    `Protected areas: ${proposal.protectedAreas.join(', ') || 'none'}`,
    `Affected files: ${proposal.affectedFiles.join(', ') || 'TBD'}`,
    '',
    'Implementation plan:',
    ...proposal.implementationPlan.map((item) => `- ${item}`),
    '',
    'Test plan:',
    ...proposal.testPlan.map((item) => `- ${item}`),
    '',
    'Rollback plan:',
    ...proposal.rollbackPlan.map((item) => `- ${item}`),
    '',
    'Execution rules:',
    '- This proposal is already admission-approved.',
    '- Use the platform engineering workflow and stay within the smallest safe change set.',
    '- Produce explicit evidence for tests, affected files, and rollback.',
    '- Do not merge, restart, or publish automatically.',
  ];
  return sections.join('\n').trim();
}

function buildProposalCreatedGovernance(): ProjectDefinition['governance'] {
  const now = new Date().toISOString();
  return {
    ...defaultPlatformEngineeringProjectGovernance(),
    platformEngineering: {
      observe: true,
      allowProposal: true,
      departmentId: PLATFORM_ENGINEERING_DEPARTMENT_ID,
      source: 'proposal-created',
      updatedAt: now,
    },
  };
}

function getExistingImprovementProjectId(proposal: SystemImprovementProposal): string | null {
  const value = proposal.metadata?.improvementProjectId;
  return typeof value === 'string' && value ? value : null;
}

function getExistingImprovementRunId(proposal: SystemImprovementProposal): string | null {
  const value = proposal.metadata?.improvementRunId;
  return typeof value === 'string' && value ? value : null;
}

export async function ensureSystemImprovementProjectLaunched(
  proposalId: string,
): Promise<{ proposal: SystemImprovementProposal; launch: SystemImprovementLaunchResult }> {
  let proposal = getSystemImprovementProposal(proposalId);
  if (!proposal) {
    throw new Error(`System improvement proposal not found: ${proposalId}`);
  }
  if (proposal.status !== 'approved' && proposal.status !== 'in-progress') {
    throw new Error(`System improvement proposal ${proposalId} is not approved for launch`);
  }

  ensurePlatformEngineeringWorkspaceSkeleton();

  const templateId = determineTemplateId(proposal);
  const workspaceUri = determineWorkspaceUri(proposal);
  const goal = buildProjectGoal(proposal);
  let createdProject = false;
  let project = getExistingImprovementProjectId(proposal)
    ? getProject(getExistingImprovementProjectId(proposal)!)
    : null;

  if (!project) {
    project = createProject({
      name: buildProjectName(proposal),
      goal,
      workspace: workspaceUri,
      templateId,
      projectType: 'strategic',
      governance: buildProposalCreatedGovernance(),
    });
    createdProject = true;
    proposal = mergeMetadata(proposal, {
      improvementProjectId: project.projectId,
      improvementWorkspaceUri: workspaceUri,
      improvementTemplateId: templateId,
      launchStatus: 'project-created',
      launchRequestedAt: new Date().toISOString(),
      launchAttempts: Number(proposal.metadata?.launchAttempts || 0) + 1,
    });
  }

  const existingRunId = getExistingImprovementRunId(proposal) || project.runIds.at(-1) || null;
  if (existingRunId) {
    const updated = patchSystemImprovementProposal(proposal.id, {
      status: 'in-progress',
      linkedRunIds: mergeLinkedRunIds(proposal.linkedRunIds, existingRunId),
      metadata: {
        ...(proposal.metadata || {}),
        improvementProjectId: project.projectId,
        improvementRunId: existingRunId,
        improvementWorkspaceUri: workspaceUri,
        improvementTemplateId: templateId,
        launchStatus: 'already-running',
        lastLaunchError: null,
      },
    });
    if (!updated) {
      throw new Error(`System improvement proposal not found: ${proposal.id}`);
    }
    return {
      proposal: updated,
      launch: {
        status: 'already-running',
        projectId: project.projectId,
        runId: existingRunId,
        createdProject,
        templateId,
        workspaceUri,
      },
    };
  }

  try {
    const dispatch = await executeDispatch({
      workspace: workspaceUri,
      projectId: project.projectId,
      templateId,
      prompt: goal,
      taskEnvelope: {
        goal,
        proposalId: proposal.id,
        proposalTitle: proposal.title,
        proposalRisk: proposal.risk,
        proposalAffectedFiles: proposal.affectedFiles,
        proposalProtectedAreas: proposal.protectedAreas,
        sourceSignalIds: proposal.sourceSignalIds,
      },
      triggerContext: {
        source: 'api',
        intentSummary: `system-improvement-proposal:${proposal.id}`,
      },
    });

    const updated = patchSystemImprovementProposal(proposal.id, {
      status: 'in-progress',
      linkedRunIds: mergeLinkedRunIds(proposal.linkedRunIds, dispatch.runId),
      metadata: {
        ...(proposal.metadata || {}),
        improvementProjectId: project.projectId,
        improvementRunId: dispatch.runId,
        improvementWorkspaceUri: workspaceUri,
        improvementTemplateId: templateId,
        launchStatus: 'dispatched',
        launchedAt: new Date().toISOString(),
        lastLaunchError: null,
      },
    });
    if (!updated) {
      throw new Error(`System improvement proposal not found: ${proposal.id}`);
    }

    return {
      proposal: updated,
      launch: {
        status: 'dispatched',
        projectId: project.projectId,
        runId: dispatch.runId,
        createdProject,
        templateId,
        workspaceUri,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = patchSystemImprovementProposal(proposal.id, {
      metadata: {
        ...(proposal.metadata || {}),
        improvementProjectId: project.projectId,
        improvementWorkspaceUri: workspaceUri,
        improvementTemplateId: templateId,
        launchStatus: 'dispatch-failed',
        lastLaunchError: message,
        lastLaunchFailedAt: new Date().toISOString(),
      },
    });
    if (!updated) {
      throw new Error(`System improvement proposal not found: ${proposal.id}`);
    }
    log.error({
      proposalId: proposal.id,
      projectId: project.projectId,
      err: message,
    }, 'Failed to launch approved system improvement proposal');
    return {
      proposal: updated,
      launch: {
        status: 'dispatch-failed',
        projectId: project.projectId,
        createdProject,
        templateId,
        workspaceUri,
        error: message,
      },
    };
  }
}
