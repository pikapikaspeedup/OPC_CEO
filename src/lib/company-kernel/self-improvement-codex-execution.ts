import { createProject, getProject, updateProject, addRunToProject } from '../agents/project-registry';
import type { ProjectDefinition } from '../agents/project-types';
import { createRun, updateRun } from '../agents/run-registry';
import { createLogger } from '../logger';
import {
  PLATFORM_ENGINEERING_DEPARTMENT_ID,
  defaultPlatformEngineeringProjectGovernance,
  ensurePlatformEngineeringWorkspaceSkeleton,
  getPlatformEngineeringWorkspaceUri,
} from '../platform-engineering';
import {
  runPlatformEngineeringCodexTask,
  type PlatformEngineeringExitEvidence,
  type RunPlatformEngineeringCodexTaskInput,
} from '../platform-engineering-codex-runner';
import type {
  SystemImprovementCodexExecutionSnapshot,
  SystemImprovementProposal,
} from './contracts';
import {
  attachSystemImprovementTestEvidence,
  getSystemImprovementProposal,
  patchSystemImprovementProposal,
} from './self-improvement-store';
import { syncSystemImprovementProposalRuntimeState } from './self-improvement-runtime-state';

const log = createLogger('SelfImprovementCodexExecution');
const DEFAULT_PLATFORM_ENGINEERING_TEMPLATE_ID = 'development-template-1';
const CODEX_STAGE_ID = 'platform-engineering-codex-worktree';

export interface SystemImprovementCodexLaunchResult {
  status: 'already-running' | 'dispatched' | 'dispatch-failed';
  projectId?: string;
  runId?: string;
  codexRunId?: string;
  evidencePath?: string;
  worktreePath?: string;
  branch?: string;
  createdProject: boolean;
  templateId: string;
  workspaceUri: string;
  error?: string;
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeRepoRelativePath(value: string): string {
  return value.replace(/^file:\/\//, '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

function allowPrefixFromAffectedPath(value: string): string | null {
  const normalized = normalizeRepoRelativePath(value);
  if (!normalized) return null;
  const wildcardIndex = normalized.search(/[*{[]/);
  if (wildcardIndex >= 0) {
    return normalized.slice(0, wildcardIndex).replace(/\/+$/, '') || null;
  }
  return normalized;
}

function resolveAllowedPathPrefixes(proposal: SystemImprovementProposal): string[] {
  const fromMetadata = proposal.metadata?.allowedPathPrefixes;
  const metadataPrefixes = Array.isArray(fromMetadata)
    ? fromMetadata.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return uniq([
    ...metadataPrefixes.map(normalizeRepoRelativePath),
    ...proposal.affectedFiles.map(allowPrefixFromAffectedPath).filter((entry): entry is string => Boolean(entry)),
  ]);
}

function isRunnableValidationCommand(command: string): boolean {
  const normalized = command.trim();
  if (!normalized || normalized.includes('<') || normalized.includes('>')) return false;
  if (/^run\s+/i.test(normalized)) return false;
  return /^(npm|npx|pnpm|yarn|bun|node|tsc|vitest|eslint|test|git)\b/.test(normalized);
}

function resolveValidationCommands(proposal: SystemImprovementProposal): string[] {
  const fromMetadata = proposal.metadata?.validationCommands;
  const metadataCommands = Array.isArray(fromMetadata)
    ? fromMetadata.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const commands = uniq([...metadataCommands, ...proposal.testPlan])
    .filter(isRunnableValidationCommand);
  return commands.length > 0 ? commands : ['npx tsc --noEmit --pretty false'];
}

function determineTemplateId(proposal: SystemImprovementProposal): string {
  const preferred = typeof proposal.metadata?.preferredTemplateId === 'string'
    ? proposal.metadata.preferredTemplateId
    : null;
  return preferred || DEFAULT_PLATFORM_ENGINEERING_TEMPLATE_ID;
}

function buildProjectName(proposal: SystemImprovementProposal): string {
  const title = proposal.title.trim();
  const base = title.startsWith('System improvement:')
    ? title
    : `System improvement: ${title}`;
  return base.length > 96 ? `${base.slice(0, 93)}...` : base;
}

function buildProjectGoal(proposal: SystemImprovementProposal): string {
  return [
    `Proposal ID: ${proposal.id}`,
    `Title: ${proposal.title}`,
    `Risk: ${proposal.risk}`,
    `Protected areas: ${proposal.protectedAreas.join(', ') || 'none'}`,
    `Affected files: ${proposal.affectedFiles.join(', ') || 'TBD'}`,
    '',
    'Summary:',
    proposal.summary,
    '',
    'Implementation plan:',
    ...proposal.implementationPlan.map((item) => `- ${item}`),
    '',
    'Test plan:',
    ...proposal.testPlan.map((item) => `- ${item}`),
    '',
    'Rollback plan:',
    ...proposal.rollbackPlan.map((item) => `- ${item}`),
  ].join('\n').trim();
}

function buildCodexPrompt(proposal: SystemImprovementProposal): string {
  return [
    `Proposal ID: ${proposal.id}`,
    `Title: ${proposal.title}`,
    '',
    'Goal:',
    proposal.summary,
    '',
    'Implementation plan:',
    ...proposal.implementationPlan.map((item) => `- ${item}`),
    '',
    'Affected files:',
    ...(proposal.affectedFiles.length ? proposal.affectedFiles.map((item) => `- ${item}`) : ['- TBD']),
    '',
    'Rollback plan:',
    ...proposal.rollbackPlan.map((item) => `- ${item}`),
    '',
    'Return with concise notes. The controller will collect git diff and validation evidence.',
  ].join('\n').trim();
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

function getMetadataString(proposal: SystemImprovementProposal, key: string): string | null {
  const value = proposal.metadata?.[key];
  return typeof value === 'string' && value ? value : null;
}

function ensureTrackingProject(input: {
  proposal: SystemImprovementProposal;
  workspaceUri: string;
  templateId: string;
}): { project: ProjectDefinition; createdProject: boolean; proposal: SystemImprovementProposal } {
  const existingProjectId = getMetadataString(input.proposal, 'improvementProjectId');
  const existingProject = existingProjectId ? getProject(existingProjectId) : null;
  if (existingProject) {
    return { project: existingProject, createdProject: false, proposal: input.proposal };
  }

  const project = createProject({
    name: buildProjectName(input.proposal),
    goal: buildProjectGoal(input.proposal),
    workspace: input.workspaceUri,
    templateId: input.templateId,
    projectType: 'strategic',
    governance: buildProposalCreatedGovernance(),
  });
  const updated = patchSystemImprovementProposal(input.proposal.id, {
    metadata: {
      ...(input.proposal.metadata || {}),
      improvementProjectId: project.projectId,
      improvementWorkspaceUri: input.workspaceUri,
      improvementTemplateId: input.templateId,
      launchStatus: 'project-created',
      launchRequestedAt: new Date().toISOString(),
      launchAttempts: Number(input.proposal.metadata?.launchAttempts || 0) + 1,
    },
  });
  if (!updated) {
    throw new Error(`System improvement proposal not found: ${input.proposal.id}`);
  }
  return { project, createdProject: true, proposal: updated };
}

function createTrackingRun(input: {
  proposal: SystemImprovementProposal;
  project: ProjectDefinition;
  workspaceUri: string;
  templateId: string;
  prompt: string;
}) {
  const run = createRun({
    stageId: CODEX_STAGE_ID,
    workspace: input.workspaceUri,
    prompt: input.prompt,
    projectId: input.project.projectId,
    templateId: input.templateId,
    pipelineStageId: CODEX_STAGE_ID,
    executorKind: 'prompt',
    provider: 'codex-cli',
    taskEnvelope: {
      goal: input.prompt,
      constraints: [
        `proposalId=${input.proposal.id}`,
        `risk=${input.proposal.risk}`,
        `protectedAreas=${input.proposal.protectedAreas.join(',') || 'none'}`,
        `affectedFiles=${input.proposal.affectedFiles.join(',') || 'TBD'}`,
      ],
    },
    triggerContext: {
      source: 'api',
      intentSummary: `system-improvement-codex:${input.proposal.id}`,
    },
  });
  addRunToProject(input.project.projectId, run.runId);
  updateRun(run.runId, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });
  return run;
}

function allCodexEvidenceChecksPassed(evidence: PlatformEngineeringExitEvidence): boolean {
  return evidence.scopeCheckPassed
    && evidence.diffCheckPassed
    && evidence.disallowedFiles.length === 0
    && evidence.validations.every((validation) => validation.passed);
}

function buildCodexEvidenceSnapshot(input: {
  result: Awaited<ReturnType<typeof runPlatformEngineeringCodexTask>>;
  allowedPathPrefixes: string[];
}): SystemImprovementCodexExecutionSnapshot {
  const evidence = input.result.evidence;
  const passedValidationCount = evidence.validations.filter((validation) => validation.passed).length;
  const failedValidationCount = evidence.validations.length - passedValidationCount;
  const passed = allCodexEvidenceChecksPassed(evidence);
  return {
    runId: evidence.runId,
    taskKey: evidence.taskKey,
    branch: evidence.branch,
    worktreePath: evidence.worktreePath,
    ...(evidence.evidencePath ? { evidencePath: evidence.evidencePath } : {}),
    baseMode: input.result.worktree.baseMode,
    baseSha: evidence.baseSha,
    headSha: evidence.headSha,
    ...(input.result.worktree.snapshotSha ? { snapshotSha: input.result.worktree.snapshotSha } : {}),
    changedFiles: evidence.changedFiles,
    allowedPathPrefixes: input.allowedPathPrefixes,
    disallowedFiles: evidence.disallowedFiles,
    scopeCheckPassed: evidence.scopeCheckPassed,
    diffCheckPassed: evidence.diffCheckPassed,
    validationCount: evidence.validations.length,
    passedValidationCount,
    failedValidationCount,
    decision: passed ? 'ready-to-merge' : 'blocked',
    updatedAt: new Date().toISOString(),
  };
}

function summarizeCodexEvidence(evidence: PlatformEngineeringExitEvidence): string {
  const passed = allCodexEvidenceChecksPassed(evidence);
  const changed = evidence.changedFiles.length;
  const failedValidations = evidence.validations.filter((validation) => !validation.passed);
  if (passed) {
    return `Codex worktree runner passed with ${changed} changed file${changed === 1 ? '' : 's'}.`;
  }
  const reasons = [
    evidence.disallowedFiles.length ? `${evidence.disallowedFiles.length} disallowed file(s)` : null,
    !evidence.diffCheckPassed ? 'git diff --check failed' : null,
    failedValidations.length ? `${failedValidations.length} validation(s) failed` : null,
  ].filter(Boolean);
  return `Codex worktree runner blocked: ${reasons.join(', ') || 'quality gate failed'}.`;
}

function buildCodexTaskInput(input: {
  proposal: SystemImprovementProposal;
  allowedPathPrefixes: string[];
  validationCommands: string[];
}): RunPlatformEngineeringCodexTaskInput {
  const baseMode = input.proposal.metadata?.codexBaseMode === 'checkpoint' ? 'checkpoint' : 'snapshot';
  return {
    repoPath: process.cwd(),
    taskKey: input.proposal.id,
    prompt: buildCodexPrompt(input.proposal),
    baseMode,
    model: typeof input.proposal.metadata?.codexModel === 'string'
      ? input.proposal.metadata.codexModel
      : undefined,
    timeoutMs: typeof input.proposal.metadata?.codexTimeoutMs === 'number'
      ? input.proposal.metadata.codexTimeoutMs
      : 0,
    expectEdits: true,
    allowedPathPrefixes: input.allowedPathPrefixes,
    validationCommands: input.validationCommands,
  };
}

export async function runApprovedSystemImprovementCodexTask(
  proposalId: string,
  options: { force?: boolean } = {},
): Promise<{ proposal: SystemImprovementProposal; launch: SystemImprovementCodexLaunchResult }> {
  let proposal = getSystemImprovementProposal(proposalId);
  if (!proposal) {
    throw new Error(`System improvement proposal not found: ${proposalId}`);
  }
  if (
    proposal.status !== 'approved'
    && proposal.status !== 'in-progress'
    && proposal.status !== 'testing'
    && proposal.status !== 'ready-to-merge'
  ) {
    throw new Error(`System improvement proposal ${proposalId} is not approved for Codex execution`);
  }

  const existingEvidence = proposal.metadata?.codexRunnerEvidence;
  if (existingEvidence && !options.force) {
    const synced = await syncSystemImprovementProposalRuntimeState(proposal.id, { proposal });
    const evidence = existingEvidence as Partial<SystemImprovementCodexExecutionSnapshot>;
    return {
      proposal: synced || proposal,
      launch: {
        status: 'already-running',
        projectId: getMetadataString(proposal, 'improvementProjectId') || undefined,
        runId: getMetadataString(proposal, 'improvementRunId') || undefined,
        codexRunId: typeof evidence.runId === 'string' ? evidence.runId : undefined,
        evidencePath: typeof evidence.evidencePath === 'string' ? evidence.evidencePath : undefined,
        worktreePath: typeof evidence.worktreePath === 'string' ? evidence.worktreePath : undefined,
        branch: typeof evidence.branch === 'string' ? evidence.branch : undefined,
        createdProject: false,
        templateId: determineTemplateId(proposal),
        workspaceUri: getPlatformEngineeringWorkspaceUri(),
      },
    };
  }

  ensurePlatformEngineeringWorkspaceSkeleton();
  const workspaceUri = getPlatformEngineeringWorkspaceUri();
  const templateId = determineTemplateId(proposal);
  const allowedPathPrefixes = resolveAllowedPathPrefixes(proposal);
  if ((proposal.risk === 'high' || proposal.risk === 'critical') && allowedPathPrefixes.length === 0) {
    throw new Error(`System improvement proposal ${proposalId} requires an allowlist before protected Codex execution`);
  }
  const validationCommands = resolveValidationCommands(proposal);
  const prompt = buildProjectGoal(proposal);
  const tracking = ensureTrackingProject({ proposal, workspaceUri, templateId });
  proposal = tracking.proposal;
  const run = createTrackingRun({ proposal, project: tracking.project, workspaceUri, templateId, prompt });

  proposal = patchSystemImprovementProposal(proposal.id, {
    status: 'in-progress',
    linkedRunIds: uniq([...proposal.linkedRunIds, run.runId]),
    metadata: {
      ...(proposal.metadata || {}),
      improvementProjectId: tracking.project.projectId,
      improvementRunId: run.runId,
      improvementWorkspaceUri: workspaceUri,
      improvementTemplateId: templateId,
      codexTrackingRunId: run.runId,
      launchStatus: 'codex-running',
      launchedAt: new Date().toISOString(),
      lastLaunchError: null,
    },
  }) || proposal;

  try {
    const result = await runPlatformEngineeringCodexTask(buildCodexTaskInput({
      proposal,
      allowedPathPrefixes,
      validationCommands,
    }));
    const evidenceSnapshot = buildCodexEvidenceSnapshot({ result, allowedPathPrefixes });
    const passed = evidenceSnapshot.decision === 'ready-to-merge';

    updateRun(run.runId, {
      status: 'completed',
      result: {
        status: passed ? 'completed' : 'blocked',
        summary: summarizeCodexEvidence(result.evidence),
        changedFiles: result.evidence.changedFiles,
        blockers: passed
          ? []
          : result.evidence.validations
            .filter((validation) => !validation.passed)
            .map((validation) => validation.command),
        needsReview: passed ? [] : ['Review Codex runner evidence before retry or merge.'],
      },
    });
    updateProject(tracking.project.projectId, {
      status: 'completed',
    });

    const withMetadata = patchSystemImprovementProposal(proposal.id, {
      metadata: {
        ...(proposal.metadata || {}),
        improvementProjectId: tracking.project.projectId,
        improvementRunId: run.runId,
        codexRunId: result.worktree.runId,
        codexEvidencePath: result.evidence.evidencePath,
        codexWorktreePath: result.worktree.worktreePath,
        codexBranch: result.worktree.branch,
        codexRunnerEvidence: evidenceSnapshot,
        launchStatus: 'codex-completed',
        lastLaunchError: null,
      },
    }) || proposal;
    const withTestEvidence = attachSystemImprovementTestEvidence(proposal.id, {
      command: 'platform-engineering-codex-runner',
      status: passed ? 'passed' : 'failed',
      outputSummary: summarizeCodexEvidence(result.evidence),
      createdAt: new Date().toISOString(),
    }) || withMetadata;
    const synced = await syncSystemImprovementProposalRuntimeState(proposal.id, {
      proposal: withTestEvidence,
      project: getProject(tracking.project.projectId),
      latestRun: updateRun(run.runId, {}) || run,
    });

    return {
      proposal: synced || withTestEvidence,
      launch: {
        status: 'dispatched',
        projectId: tracking.project.projectId,
        runId: run.runId,
        codexRunId: result.worktree.runId,
        evidencePath: result.evidence.evidencePath,
        worktreePath: result.worktree.worktreePath,
        branch: result.worktree.branch,
        createdProject: tracking.createdProject,
        templateId,
        workspaceUri,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    updateRun(run.runId, {
      status: 'failed',
      lastError: message,
      result: {
        status: 'failed',
        summary: `Codex worktree runner failed: ${message}`,
        changedFiles: [],
        blockers: [message],
        needsReview: ['Fix runner setup or retry after resolving the failure.'],
      },
    });
    updateProject(tracking.project.projectId, {
      status: 'failed',
    });
    const updated = patchSystemImprovementProposal(proposal.id, {
      linkedRunIds: uniq([...proposal.linkedRunIds, run.runId]),
      metadata: {
        ...(proposal.metadata || {}),
        improvementProjectId: tracking.project.projectId,
        improvementRunId: run.runId,
        improvementWorkspaceUri: workspaceUri,
        improvementTemplateId: templateId,
        codexTrackingRunId: run.runId,
        launchStatus: 'codex-failed',
        lastLaunchError: message,
        lastLaunchFailedAt: new Date().toISOString(),
      },
    }) || proposal;
    const withTestEvidence = attachSystemImprovementTestEvidence(proposal.id, {
      command: 'platform-engineering-codex-runner',
      status: 'failed',
      outputSummary: `Codex worktree runner failed: ${message}`,
      createdAt: new Date().toISOString(),
    }) || updated;
    const synced = await syncSystemImprovementProposalRuntimeState(proposal.id, {
      proposal: withTestEvidence,
      project: getProject(tracking.project.projectId),
      latestRun: updateRun(run.runId, {}) || run,
    });
    log.error({
      proposalId: proposal.id,
      projectId: tracking.project.projectId,
      runId: run.runId,
      err: message,
    }, 'Failed to run approved system improvement Codex task');
    return {
      proposal: synced || withTestEvidence,
      launch: {
        status: 'dispatch-failed',
        projectId: tracking.project.projectId,
        runId: run.runId,
        createdProject: tracking.createdProject,
        templateId,
        workspaceUri,
        error: message,
      },
    };
  }
}
