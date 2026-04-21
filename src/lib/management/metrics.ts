import { readDepartmentConfig } from '../agents/department-capability-registry';
import { listApprovalRequests } from '../approval/request-store';
import { listProjects } from '../agents/project-registry';
import { listScheduledJobsEnriched } from '../agents/scheduler';
import { listRunRecords } from '../storage/gateway-db';
import { listRecentKnowledgeAssets } from '../knowledge';
import type { DepartmentManagementOverview, ManagementMetric, ManagementOverview, ManagementRisk } from './contracts';
import { listKnownWorkspaces } from '../workspace-catalog';

function hasBlockedStage(project: ReturnType<typeof listProjects>[number]): boolean {
  return Boolean(project.pipelineState?.stages?.some((stage) => stage.status === 'blocked'));
}

function buildMetric(
  key: ManagementMetric['key'],
  scope: ManagementMetric['scope'],
  value: number,
  unit: ManagementMetric['unit'],
  window: ManagementMetric['window'],
  workspaceUri?: string,
  evidence?: string[],
): ManagementMetric {
  return {
    key,
    scope,
    value,
    unit,
    window,
    ...(workspaceUri ? { workspaceUri } : {}),
    ...(evidence ? { evidence } : {}),
    computedAt: new Date().toISOString(),
  };
}

function withinLast30Days(isoDate?: string): boolean {
  if (!isoDate) return false;
  return Date.now() - new Date(isoDate).getTime() <= 30 * 24 * 60 * 60 * 1000;
}

function computeOkrProgressForWorkspace(workspaceUri: string): number | null {
  const config = readDepartmentConfig(workspaceUri.replace(/^file:\/\//, ''));
  const keyResults = config.okr?.objectives.flatMap((objective) => objective.keyResults) || [];
  if (keyResults.length === 0) return null;
  const values = keyResults.map((kr) => {
    const target = Math.max(kr.target || 0, 1);
    return Math.max(0, Math.min(1, (kr.current || 0) / target));
  });
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeOrganizationOkrProgress(): number | null {
  const workspaces = listKnownWorkspaces().map((workspace) => ({ uri: workspace.uri }));
  const progresses = workspaces
    .map((workspace) => computeOkrProgressForWorkspace(workspace.uri))
    .filter((value): value is number => value !== null);
  if (progresses.length === 0) return null;
  return progresses.reduce((sum, value) => sum + value, 0) / progresses.length;
}

function buildOrganizationRisks(): ManagementRisk[] {
  const projects = listProjects();
  const approvals = listApprovalRequests({ status: 'pending' });
  const risks: ManagementRisk[] = [];

  for (const project of projects.filter(hasBlockedStage).slice(0, 3)) {
    risks.push({
      level: 'warning',
      title: `项目阻塞：${project.name}`,
      description: '存在 blocked stage，需要 CEO 关注。',
      projectId: project.projectId,
      workspaceUri: project.workspace,
    });
  }

  for (const project of projects.filter((project) => project.status === 'failed').slice(0, 2)) {
    risks.push({
      level: 'critical',
      title: `项目失败：${project.name}`,
      projectId: project.projectId,
      workspaceUri: project.workspace,
    });
  }

  if (approvals.length > 0) {
    risks.push({
      level: 'warning',
      title: `待审批事项：${approvals.length} 条`,
      description: '存在待 CEO 决策的审批请求。',
    });
  }

  return risks.slice(0, 5);
}

export function buildManagementOverview(): ManagementOverview {
  const projects = listProjects();
  const runs = listRunRecords();
  const approvals = listApprovalRequests({ status: 'pending' });
  const schedulers = listScheduledJobsEnriched().filter((job) => job.enabled !== false);
  const knowledge = listRecentKnowledgeAssets(50);

  const activeProjects = projects.filter((project) => project.status === 'active').length;
  const completedProjects = projects.filter((project) => project.status === 'completed').length;
  const failedProjects = projects.filter((project) => project.status === 'failed').length;
  const blockedProjects = projects.filter(hasBlockedStage).length;
  const totalProjects = projects.length || 1;
  const completedRuns = runs.filter((run) => run.status === 'completed').length;
  const totalRuns = runs.length || 1;
  const okrProgress = computeOrganizationOkrProgress();
  const risks = buildOrganizationRisks();

  const metrics: ManagementMetric[] = [
    ...(okrProgress !== null
      ? [buildMetric('objectiveContribution', 'organization', okrProgress, 'ratio', 'rolling-30d')]
      : []),
    buildMetric('taskSuccessRate', 'organization', completedRuns / totalRuns, 'ratio', 'rolling-30d'),
    buildMetric('blockageRate', 'organization', blockedProjects / totalProjects, 'ratio', 'rolling-30d'),
    buildMetric('departmentThroughput', 'organization', completedProjects, 'count', 'rolling-30d'),
    buildMetric('memoryReuseRate', 'organization', knowledge.length > 0 ? Math.min(1, knowledge.length / Math.max(totalRuns, 1)) : 0, 'ratio', 'rolling-30d'),
  ];

  return {
    generatedAt: new Date().toISOString(),
    activeProjects,
    completedProjects,
    failedProjects,
    blockedProjects,
    pendingApprovals: approvals.length,
    activeSchedulers: schedulers.length,
    recentKnowledge: knowledge.length,
    okrProgress,
    risks,
    metrics,
  };
}

export function buildDepartmentManagementOverview(workspaceUri: string): DepartmentManagementOverview {
  const projects = listProjects().filter((project) => project.workspace === workspaceUri);
  const runs = listRunRecords().filter((run) => run.workspace === workspaceUri);
  const approvals = listApprovalRequests({ status: 'pending', workspace: workspaceUri });
  const schedulers = listScheduledJobsEnriched().filter((job) => job.enabled !== false && job.departmentWorkspaceUri === workspaceUri);
  const knowledge = listRecentKnowledgeAssets(50, workspaceUri);

  const activeProjects = projects.filter((project) => project.status === 'active').length;
  const completedProjects = projects.filter((project) => project.status === 'completed').length;
  const failedProjects = projects.filter((project) => project.status === 'failed').length;
  const blockedProjects = projects.filter(hasBlockedStage).length;
  const totalProjects = projects.length || 1;
  const recentRuns = runs.filter((run) => withinLast30Days(run.createdAt));
  const throughput30d = recentRuns.filter((run) => run.status === 'completed').length;
  const workflowRuns = recentRuns.filter((run) => !!run.resolvedWorkflowRef).length;
  const workflowHitRate = recentRuns.length > 0 ? workflowRuns / recentRuns.length : 0;
  const okrProgress = computeOkrProgressForWorkspace(workspaceUri);
  const risks: ManagementRisk[] = [];
  if (blockedProjects > 0) {
    risks.push({
      level: 'warning',
      title: `${blockedProjects} 个项目阻塞`,
      workspaceUri,
    });
  }
  if (failedProjects > 0) {
    risks.push({
      level: 'critical',
      title: `${failedProjects} 个项目失败`,
      workspaceUri,
    });
  }
  if (approvals.length > 0) {
    risks.push({
      level: 'warning',
      title: `${approvals.length} 条待审批事项`,
      workspaceUri,
    });
  }

  const metrics: ManagementMetric[] = [
    ...(okrProgress !== null
      ? [buildMetric('objectiveContribution', 'department', okrProgress, 'ratio', 'rolling-30d', workspaceUri)]
      : []),
    buildMetric('departmentThroughput', 'department', throughput30d, 'count', 'rolling-30d', workspaceUri),
    buildMetric('blockageRate', 'department', blockedProjects / totalProjects, 'ratio', 'rolling-30d', workspaceUri),
    buildMetric('workflowHitRate', 'department', workflowHitRate, 'ratio', 'rolling-30d', workspaceUri),
    buildMetric('memoryReuseRate', 'department', recentRuns.length > 0 ? Math.min(1, knowledge.length / recentRuns.length) : 0, 'ratio', 'rolling-30d', workspaceUri),
  ];

  return {
    workspaceUri,
    generatedAt: new Date().toISOString(),
    activeProjects,
    completedProjects,
    failedProjects,
    blockedProjects,
    pendingApprovals: approvals.length,
    activeSchedulers: schedulers.length,
    recentKnowledge: knowledge.length,
    okrProgress,
    risks,
    workflowHitRate,
    throughput30d,
    metrics,
  };
}
