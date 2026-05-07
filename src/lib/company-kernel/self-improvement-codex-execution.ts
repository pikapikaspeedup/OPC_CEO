import { createProject, getProject, updateProject, addRunToProject } from '../agents/project-registry';
import type { AgentRunState } from '../agents/group-types';
import type { ProjectDefinition } from '../agents/project-types';
import { createRun, getRun, updateRun } from '../agents/run-registry';
import type { CodexExecHandle } from '../bridge/codex-adapter';
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
import { maybeAutoRunSystemImprovementPreflight } from './self-improvement-release-gate';
import { syncSystemImprovementProposalRuntimeState } from './self-improvement-runtime-state';

const log = createLogger('SelfImprovementCodexExecution');
const DEFAULT_PLATFORM_ENGINEERING_TEMPLATE_ID = 'development-template-1';
const CODEX_STAGE_ID = 'platform-engineering-codex-worktree';
const ACTIVE_TRACKING_RUN_STATUSES = new Set(['queued', 'starting', 'running']);
const SELF_IMPROVEMENT_CODEX_INTENT_PREFIX = 'system-improvement-codex:';

const globalForActiveCodexHandles = globalThis as unknown as {
  __SELF_IMPROVEMENT_CODEX_ACTIVE_HANDLES__?: Map<string, CodexExecHandle>;
};

const activeCodexHandles = globalForActiveCodexHandles.__SELF_IMPROVEMENT_CODEX_ACTIVE_HANDLES__
  || new Map<string, CodexExecHandle>();

if (process.env.NODE_ENV !== 'production') {
  globalForActiveCodexHandles.__SELF_IMPROVEMENT_CODEX_ACTIVE_HANDLES__ = activeCodexHandles;
}

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

export interface RunApprovedSystemImprovementCodexTaskOptions {
  force?: boolean;
  skipAutoPreflight?: boolean;
  remediationPrompt?: string;
}

interface PreparedCodexExecutionDispatch {
  proposal: SystemImprovementProposal;
  tracking: { project: ProjectDefinition; createdProject: boolean };
  run: ReturnType<typeof createRun>;
  workspaceUri: string;
  templateId: string;
  allowedPathPrefixes: string[];
  validationCommands: string[];
}

interface ImmediateCodexExecutionDispatch {
  proposal: SystemImprovementProposal;
  launch: SystemImprovementCodexLaunchResult;
}

function registerActiveCodexHandle(runId: string, handle: CodexExecHandle): void {
  activeCodexHandles.set(runId, handle);
}

function getActiveCodexHandle(runId: string): CodexExecHandle | null {
  return activeCodexHandles.get(runId) || null;
}

function clearActiveCodexHandle(runId: string): void {
  activeCodexHandles.delete(runId);
}

function isTerminalTrackingRunStatus(status: AgentRunState['status'] | undefined): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'blocked'
    || status === 'timeout'
    || status === 'cancelled';
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

function buildProjectGoal(proposal: SystemImprovementProposal, remediationPrompt?: string): string {
  const sections = [
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
  ];
  if (remediationPrompt?.trim()) {
    sections.push(
      '',
      'Controller context:',
      remediationPrompt.trim(),
    );
  }
  return sections.join('\n').trim();
}

function buildCodexPrompt(proposal: SystemImprovementProposal, remediationPrompt?: string): string {
  const sections = [
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
  ];
  if (remediationPrompt?.trim()) {
    sections.push(
      '',
      'Controller context:',
      remediationPrompt.trim(),
      '',
      'Reconcile the proposal against the current repository snapshot. Replace the outdated patch with a fresh clean diff.',
    );
  }
  return sections.join('\n').trim();
}

function buildProposalCreatedGovernance(proposalId: string): ProjectDefinition['governance'] {
  const now = new Date().toISOString();
  return {
    ...defaultPlatformEngineeringProjectGovernance(),
    platformEngineering: {
      observe: true,
      allowProposal: true,
      departmentId: PLATFORM_ENGINEERING_DEPARTMENT_ID,
      source: 'proposal-created',
      systemImprovementProposalId: proposalId,
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
    const currentProposalId = existingProject.governance?.platformEngineering?.systemImprovementProposalId;
    if (currentProposalId !== input.proposal.id) {
      const now = new Date().toISOString();
      const updatedProject = updateProject(existingProject.projectId, {
        governance: {
          ...(existingProject.governance || defaultPlatformEngineeringProjectGovernance()),
          platformEngineering: {
            ...(existingProject.governance?.platformEngineering || {}),
            observe: existingProject.governance?.platformEngineering?.observe ?? true,
            allowProposal: existingProject.governance?.platformEngineering?.allowProposal ?? true,
            departmentId: existingProject.governance?.platformEngineering?.departmentId || PLATFORM_ENGINEERING_DEPARTMENT_ID,
            source: existingProject.governance?.platformEngineering?.source || 'proposal-created',
            systemImprovementProposalId: input.proposal.id,
            updatedAt: now,
          },
        },
      }) || existingProject;
      return { project: updatedProject, createdProject: false, proposal: input.proposal };
    }
    return { project: existingProject, createdProject: false, proposal: input.proposal };
  }

  const project = createProject({
    name: buildProjectName(input.proposal),
    goal: buildProjectGoal(input.proposal),
    workspace: input.workspaceUri,
    templateId: input.templateId,
    projectType: 'strategic',
    governance: buildProposalCreatedGovernance(input.proposal.id),
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
        `systemImprovementProposalId=${input.proposal.id}`,
        'systemImprovementCodexTracking=true',
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

function clearExecutionPointers(proposal: SystemImprovementProposal): SystemImprovementProposal {
  return patchSystemImprovementProposal(proposal.id, {
    exitEvidence: undefined,
    metadata: {
      ...(proposal.metadata || {}),
      codexRunnerEvidence: undefined,
      codexEvidencePath: undefined,
      codexWorktreePath: undefined,
      codexBranch: undefined,
      codexRunId: undefined,
    },
  }) || proposal;
}

function buildCodexTaskInput(input: {
  proposal: SystemImprovementProposal;
  allowedPathPrefixes: string[];
  validationCommands: string[];
  remediationPrompt?: string;
  onCodexExecHandle?: (handle: CodexExecHandle) => void;
}): RunPlatformEngineeringCodexTaskInput {
  const baseMode = input.proposal.metadata?.codexBaseMode === 'checkpoint' ? 'checkpoint' : 'snapshot';
  return {
    repoPath: process.cwd(),
    taskKey: input.proposal.id,
    prompt: buildCodexPrompt(input.proposal, input.remediationPrompt),
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
    onCodexExecHandle: input.onCodexExecHandle,
  };
}

function buildPreparedLaunchResult(input: PreparedCodexExecutionDispatch): SystemImprovementCodexLaunchResult {
  return {
    status: 'dispatched',
    projectId: input.tracking.project.projectId,
    runId: input.run.runId,
    createdProject: input.tracking.createdProject,
    templateId: input.templateId,
    workspaceUri: input.workspaceUri,
  };
}

function isImmediateDispatchResult(
  value: PreparedCodexExecutionDispatch | ImmediateCodexExecutionDispatch,
): value is ImmediateCodexExecutionDispatch {
  return 'launch' in value;
}

async function prepareApprovedSystemImprovementCodexTask(
  proposalId: string,
  options: RunApprovedSystemImprovementCodexTaskOptions = {},
): Promise<PreparedCodexExecutionDispatch | ImmediateCodexExecutionDispatch> {
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

  const existingRunId = getMetadataString(proposal, 'improvementRunId');
  const existingRun = existingRunId ? getRun(existingRunId) : null;
  if (existingRun && ACTIVE_TRACKING_RUN_STATUSES.has(existingRun.status) && !options.force) {
    const synced = await syncSystemImprovementProposalRuntimeState(proposal.id, {
      proposal,
      project: existingRun.projectId ? getProject(existingRun.projectId) : null,
      latestRun: existingRun,
    });
    return {
      proposal: synced || proposal,
      launch: {
        status: 'already-running',
        projectId: existingRun.projectId,
        runId: existingRun.runId,
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
  const prompt = buildProjectGoal(proposal, options.remediationPrompt);
  const tracking = ensureTrackingProject({ proposal, workspaceUri, templateId });
  proposal = tracking.proposal;
  proposal = clearExecutionPointers(proposal);
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

  return {
    proposal,
    tracking,
    run,
    workspaceUri,
    templateId,
    allowedPathPrefixes,
    validationCommands,
  };
}

export function isSystemImprovementCodexTrackingRun(run: Pick<AgentRunState, 'provider' | 'triggerContext' | 'taskEnvelope'> | null | undefined): boolean {
  if (!run) return false;
  if (run.provider !== 'codex-cli') return false;
  if (run.triggerContext?.intentSummary?.startsWith(SELF_IMPROVEMENT_CODEX_INTENT_PREFIX)) return true;
  return Array.isArray(run.taskEnvelope?.constraints)
    && run.taskEnvelope.constraints.includes('systemImprovementCodexTracking=true');
}

export async function cancelSystemImprovementCodexRun(runId: string): Promise<void> {
  const run = getRun(runId);
  if (!run || !isSystemImprovementCodexTrackingRun(run)) {
    return;
  }

  const activeHandle = getActiveCodexHandle(runId);
  activeHandle?.cancel('cancelled_by_user');
  clearActiveCodexHandle(runId);

  updateRun(runId, {
    status: 'cancelled',
    lastError: 'Codex execution cancelled by operator.',
    result: {
      status: 'blocked',
      summary: 'Codex worktree runner cancelled by operator.',
      changedFiles: [],
      blockers: ['codex execution cancelled'],
      needsReview: [],
    },
  });

  if (run.projectId) {
    updateProject(run.projectId, {
      status: 'cancelled',
    });
  }

  const proposalId = run.triggerContext?.intentSummary?.startsWith(SELF_IMPROVEMENT_CODEX_INTENT_PREFIX)
    ? run.triggerContext.intentSummary.slice(SELF_IMPROVEMENT_CODEX_INTENT_PREFIX.length)
    : run.taskEnvelope?.constraints
      ?.find((entry) => entry.startsWith('systemImprovementProposalId='))
      ?.slice('systemImprovementProposalId='.length)
      || run.taskEnvelope?.constraints
        ?.find((entry) => entry.startsWith('proposalId='))
        ?.slice('proposalId='.length);

  if (!proposalId) return;

  await syncSystemImprovementProposalRuntimeState(proposalId, {
    proposal: getSystemImprovementProposal(proposalId),
    project: run.projectId ? getProject(run.projectId) : null,
    latestRun: getRun(runId),
  });
}

async function executePreparedApprovedSystemImprovementCodexTask(
  prepared: PreparedCodexExecutionDispatch,
  options: RunApprovedSystemImprovementCodexTaskOptions = {},
): Promise<{ proposal: SystemImprovementProposal; launch: SystemImprovementCodexLaunchResult }> {
  const { proposal, tracking, run, workspaceUri, templateId, allowedPathPrefixes, validationCommands } = prepared;

  try {
    const result = await runPlatformEngineeringCodexTask(buildCodexTaskInput({
      proposal,
      allowedPathPrefixes,
      validationCommands,
      remediationPrompt: options.remediationPrompt,
      onCodexExecHandle: (handle) => {
        const latestTrackingRun = getRun(run.runId);
        if (latestTrackingRun?.status === 'cancelled') {
          handle.cancel('cancelled_by_user');
          return;
        }
        registerActiveCodexHandle(run.runId, handle);
      },
    }));
    clearActiveCodexHandle(run.runId);
    const latestTrackingRun = getRun(run.runId);
    if (latestTrackingRun && isTerminalTrackingRunStatus(latestTrackingRun.status) && latestTrackingRun.status !== 'running') {
      return {
        proposal: getSystemImprovementProposal(proposal.id) || proposal,
        launch: {
          status: 'already-running',
          projectId: tracking.project.projectId,
          runId: run.runId,
          createdProject: tracking.createdProject,
          templateId,
          workspaceUri,
        },
      };
    }
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
    const withPreflight = options.skipAutoPreflight
      ? (synced || withTestEvidence)
      : await maybeAutoRunSystemImprovementPreflight({
        proposal: synced || withTestEvidence,
      });

    return {
      proposal: withPreflight,
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
    clearActiveCodexHandle(run.runId);
    const latestTrackingRun = getRun(run.runId);
    if (latestTrackingRun?.status === 'cancelled') {
      return {
        proposal: await syncSystemImprovementProposalRuntimeState(proposal.id, {
          proposal: getSystemImprovementProposal(proposal.id),
          project: getProject(tracking.project.projectId),
          latestRun: latestTrackingRun,
        }) || getSystemImprovementProposal(proposal.id) || proposal,
        launch: {
          status: 'dispatch-failed',
          projectId: tracking.project.projectId,
          runId: run.runId,
          createdProject: tracking.createdProject,
          templateId,
          workspaceUri,
          error: 'cancelled',
        },
      };
    }
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

export async function dispatchApprovedSystemImprovementCodexTask(
  proposalId: string,
  options: RunApprovedSystemImprovementCodexTaskOptions = {},
): Promise<{ proposal: SystemImprovementProposal; launch: SystemImprovementCodexLaunchResult }> {
  const prepared = await prepareApprovedSystemImprovementCodexTask(proposalId, options);
  if (isImmediateDispatchResult(prepared)) {
    return prepared;
  }

  const synced = await syncSystemImprovementProposalRuntimeState(prepared.proposal.id, {
    proposal: prepared.proposal,
    project: prepared.tracking.project,
    latestRun: prepared.run,
  });

  void executePreparedApprovedSystemImprovementCodexTask(prepared, options).catch((err: unknown) => {
    log.error({
      proposalId,
      runId: prepared.run.runId,
      err: err instanceof Error ? err.message : String(err),
    }, 'Detached system improvement Codex execution crashed unexpectedly');
  });

  return {
    proposal: synced || prepared.proposal,
    launch: buildPreparedLaunchResult(prepared),
  };
}

export async function runApprovedSystemImprovementCodexTask(
  proposalId: string,
  options: RunApprovedSystemImprovementCodexTaskOptions = {},
): Promise<{ proposal: SystemImprovementProposal; launch: SystemImprovementCodexLaunchResult }> {
  const prepared = await prepareApprovedSystemImprovementCodexTask(proposalId, options);
  if (isImmediateDispatchResult(prepared)) {
    return prepared;
  }
  return executePreparedApprovedSystemImprovementCodexTask(prepared, options);
}
