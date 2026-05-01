import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import type { AgentRunState } from '../agents/group-types';
import { getProject } from '../agents/project-registry';
import {
  PLATFORM_ENGINEERING_DEPARTMENT_ID,
  getPlatformEngineeringWorkspaceUri,
  isPlatformEngineeringWorkspaceUri,
} from '../platform-engineering';
import type {
  EvidenceRef,
  SystemImprovementArea,
  SystemImprovementProposal,
  SystemImprovementSignal,
} from './contracts';
import { generateSystemImprovementProposal } from './self-improvement-planner';
import { createSystemImprovementSignal } from './self-improvement-signal';

const USER_STORY_SYNC_COOLDOWN_MS = 60_000;
let lastUserStoryGapSyncAt = 0;

function toRepoRoot(): string {
  return process.cwd();
}

function shaSuffix(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

function supportsPlatformEngineeringObservation(run: AgentRunState): boolean {
  if (isPlatformEngineeringWorkspaceUri(run.workspace)) return true;
  if (!run.projectId) return false;
  const project = getProject(run.projectId);
  return project?.governance?.platformEngineering?.observe === true;
}

function supportsPlatformEngineeringProposal(run: AgentRunState): boolean {
  if (isPlatformEngineeringWorkspaceUri(run.workspace)) return true;
  if (!run.projectId) return false;
  const project = getProject(run.projectId);
  return project?.governance?.platformEngineering?.allowProposal === true;
}

function inferRunFailureAreas(run: AgentRunState): SystemImprovementArea[] {
  const workflowRef = run.resolvedWorkflowRef || '';
  const areas = new Set<SystemImprovementArea>();
  if (run.triggerContext?.source === 'scheduler') {
    areas.add('scheduler');
  }
  if (workflowRef.includes('knowledge') || workflowRef.includes('digest')) {
    areas.add('knowledge');
  }
  if (/provider|model|auth|token/i.test(run.lastError || '')) {
    areas.add('provider');
  }
  if (run.result?.changedFiles?.some((file) => file.includes('src/app/api/'))) {
    areas.add('api');
  }
  if (run.result?.changedFiles?.some((file) => file.includes('src/components/'))) {
    areas.add('frontend');
  }
  if (run.result?.changedFiles?.some((file) => file.includes('storage') || file.includes('db'))) {
    areas.add('database');
  }
  if (areas.size === 0) {
    areas.add('runtime');
  }
  return [...areas];
}

function buildRunFailureEvidence(run: AgentRunState): EvidenceRef[] {
  const createdAt = run.finishedAt || run.createdAt || new Date().toISOString();
  const refs: EvidenceRef[] = [
    {
      id: `evidence:run:${run.runId}`,
      type: 'run',
      label: 'Failed run',
      runId: run.runId,
      excerpt: run.lastError || run.result?.summary,
      createdAt,
      metadata: {
        status: run.status,
        stageId: run.stageId,
        pipelineStageId: run.pipelineStageId,
      },
    },
  ];
  if (run.resultEnvelope) {
    refs.push({
      id: `evidence:result-envelope:${run.runId}`,
      type: 'result-envelope',
      label: 'Result envelope',
      runId: run.runId,
      excerpt: run.resultEnvelope.summary,
      createdAt,
    });
  }
  return refs;
}

function buildRunFailureSummary(run: AgentRunState): string {
  const project = run.projectId ? getProject(run.projectId) : null;
  const segments = [
    `Run ${run.runId.slice(0, 8)} ended as ${run.status}.`,
    project ? `Project: ${project.name}.` : '',
    run.resolvedWorkflowRef ? `Workflow: ${run.resolvedWorkflowRef}.` : '',
    run.lastError ? `Error: ${run.lastError}` : (run.result?.summary ? `Summary: ${run.result.summary}` : ''),
  ].filter(Boolean);
  return segments.join(' ');
}

function buildRunFailureTitle(run: AgentRunState): string {
  const project = run.projectId ? getProject(run.projectId) : null;
  if (project) {
    return `运行失败需要平台工程处理：${project.name}`;
  }
  return `运行失败需要平台工程处理：${run.runId.slice(0, 8)}`;
}

function buildRunFailureAffectedFiles(run: AgentRunState): string[] {
  const changedFiles = run.result?.changedFiles?.filter(Boolean) || [];
  if (changedFiles.length > 0) {
    return [...new Set(changedFiles)];
  }
  const areas = inferRunFailureAreas(run);
  if (areas.includes('frontend')) return ['src/components/*'];
  if (areas.includes('api')) return ['src/app/api/*'];
  if (areas.includes('database')) return ['src/lib/storage/*'];
  if (areas.includes('scheduler')) return ['src/lib/agents/scheduler.ts'];
  if (areas.includes('knowledge')) return ['src/lib/knowledge/*'];
  return ['src/lib/company-kernel/*'];
}

export function observeRunFailureForPlatformEngineering(
  run: AgentRunState,
): { signal?: SystemImprovementSignal; proposal?: SystemImprovementProposal } {
  if (!['failed', 'blocked', 'timeout'].includes(run.status)) {
    return {};
  }
  if (!supportsPlatformEngineeringObservation(run)) {
    return {};
  }

  const signal = createSystemImprovementSignal({
    id: `system-improvement-signal:platform-run-failure:${run.runId}`,
    source: 'runtime-error',
    title: buildRunFailureTitle(run),
    summary: buildRunFailureSummary(run),
    evidenceRefs: buildRunFailureEvidence(run),
    affectedAreas: inferRunFailureAreas(run),
    severity: run.status === 'timeout' ? 'critical' : 'high',
    recurrence: 1,
    metadata: {
      autoGeneratedBy: 'platform-engineering-run-failure-observer',
      departmentId: PLATFORM_ENGINEERING_DEPARTMENT_ID,
      workspaceUri: getPlatformEngineeringWorkspaceUri(),
      projectId: run.projectId,
      sourceRunId: run.runId,
      observedWorkspaceUri: run.workspace,
      affectedFiles: buildRunFailureAffectedFiles(run),
    },
  });

  if (!supportsPlatformEngineeringProposal(run)) {
    return { signal };
  }

  const proposal = generateSystemImprovementProposal({
    proposalId: `system-improvement-proposal:platform-run-failure:${run.runId}`,
    signalIds: [signal.id],
    title: signal.title,
    summary: signal.summary,
    affectedFiles: buildRunFailureAffectedFiles(run),
    affectedAreas: inferRunFailureAreas(run),
    branchName: `platform-fix/${run.runId.slice(0, 8)}`,
    linkedRunIds: [run.runId],
    metadata: {
      autoGeneratedBy: 'platform-engineering-run-failure-observer',
      departmentId: PLATFORM_ENGINEERING_DEPARTMENT_ID,
      workspaceUri: getPlatformEngineeringWorkspaceUri(),
      sourceRunId: run.runId,
      projectId: run.projectId,
    },
  });

  return { signal, proposal };
}

function inferAreasFromUserStoryPath(filePath: string): SystemImprovementArea[] {
  if (filePath.includes(`${path.sep}Knowledge${path.sep}`)) return ['knowledge', 'frontend'];
  if (filePath.includes(`${path.sep}Ops${path.sep}`)) return ['scheduler', 'runtime'];
  if (filePath.includes(`${path.sep}Settings${path.sep}`)) return ['provider', 'approval', 'runtime'];
  if (filePath.includes(`${path.sep}Projects${path.sep}`)) return ['frontend', 'runtime'];
  if (filePath.includes(`${path.sep}CEO Office${path.sep}`)) return ['frontend', 'runtime'];
  return ['docs'];
}

function collectUnsupportedStoriesFromFile(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- [不支持]'))
    .map((line) => line.replace(/^- \[不支持\]\s*/, '').trim())
    .filter(Boolean);
}

function walkMarkdownFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(full);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export function syncPlatformEngineeringUserStoryGapSignals(input: {
  userStoryRoot?: string;
  force?: boolean;
} = {}): SystemImprovementSignal[] {
  const nowMs = Date.now();
  if (!input.force && nowMs - lastUserStoryGapSyncAt < USER_STORY_SYNC_COOLDOWN_MS) {
    return [];
  }
  lastUserStoryGapSyncAt = nowMs;

  const userStoryRoot = input.userStoryRoot || path.join(toRepoRoot(), 'User Story');
  const relativeBase = path.dirname(userStoryRoot);
  const synced: SystemImprovementSignal[] = [];

  for (const filePath of walkMarkdownFiles(userStoryRoot)) {
    const unsupportedStories = collectUnsupportedStoriesFromFile(filePath);
    if (unsupportedStories.length === 0) continue;

    const relativePath = path.relative(relativeBase, filePath);
    const title = `User Story 缺口：${relativePath.replace(/\\/g, '/')}`;
    const summary = [
      `${relativePath} 仍有 ${unsupportedStories.length} 个未支持用户场景。`,
      '当前最突出的缺口：',
      ...unsupportedStories.slice(0, 5).map((story) => `- ${story}`),
    ].join('\n');

    synced.push(createSystemImprovementSignal({
      id: `system-improvement-signal:user-story-gap:${shaSuffix(relativePath)}`,
      source: 'user-story-gap',
      title,
      summary,
      evidenceRefs: [
        {
          id: `evidence:user-story:${shaSuffix(relativePath)}`,
          type: 'file',
          label: 'User Story gap source',
          filePath,
          excerpt: unsupportedStories.slice(0, 3).join('\n'),
          createdAt: new Date(nowMs).toISOString(),
        },
      ],
      affectedAreas: inferAreasFromUserStoryPath(filePath),
      severity: unsupportedStories.length >= 10 ? 'high' : 'medium',
      recurrence: unsupportedStories.length,
      metadata: {
        autoGeneratedBy: 'platform-engineering-user-story-gap-sync',
        departmentId: PLATFORM_ENGINEERING_DEPARTMENT_ID,
        workspaceUri: getPlatformEngineeringWorkspaceUri(),
        sourcePath: relativePath.replace(/\\/g, '/'),
        unsupportedStories,
      },
    }));
  }

  return synced;
}
