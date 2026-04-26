import { listApprovalRequests } from '../approval/request-store';
import { listProjects } from '../agents/project-registry';
import { getSchedulerRuntimeStatus, listScheduledJobsEnriched } from '../agents/scheduler';
import { listRecentKnowledgeAssets } from '../knowledge';
import { listCEOEvents } from './ceo-event-store';
import { reconcileCEOPendingIssues } from './ceo-profile-store';
import type { CEORoutineAction, CEORoutineSummary } from './contracts';

function projectAttentionRank(status: string): number {
  if (status === 'failed') return 0;
  if (status === 'paused') return 1;
  if (status === 'active') return 2;
  return 3;
}

export function buildCEORoutineSummary(): CEORoutineSummary {
  const approvals = listApprovalRequests({ status: 'pending' });
  const projects = listProjects();
  const profile = reconcileCEOPendingIssues({
    pendingApprovalIds: new Set(approvals.map((approval) => approval.id)),
    terminalProjectIds: new Set(
      projects
        .filter((project) => ['completed', 'archived', 'cancelled'].includes(project.status))
        .map((project) => project.projectId),
    ),
  });
  const jobs = listScheduledJobsEnriched().filter((job) => job.enabled !== false);
  const schedulerRuntime = getSchedulerRuntimeStatus(jobs);
  const knowledge = listRecentKnowledgeAssets(10);
  const recentEvents = listCEOEvents(5);
  const pendingIssues = profile.pendingIssues || [];

  const activeProjects = projects.filter((project) => project.status === 'active').length;
  const attentionProjects = projects
    .filter((project) => ['failed', 'paused', 'active'].includes(project.status))
    .sort((a, b) => {
      const priorityDiff = projectAttentionRank(a.status) - projectAttentionRank(b.status);
      if (priorityDiff) return priorityDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  const recentCompleted = projects.filter((project) => project.status === 'completed').slice(0, 3);
  const recentKnowledge = knowledge.length;
  const activeSchedulers = jobs.length;
  const pendingApprovals = approvals.length;

  const highlights: string[] = [];
  const reminders: string[] = [];
  const escalations: string[] = [];
  if (activeProjects > 0) highlights.push(`当前有 ${activeProjects} 个进行中的项目。`);
  if (pendingApprovals > 0) highlights.push(`有 ${pendingApprovals} 条待审批事项需要 CEO 关注。`);
  if (recentCompleted.length > 0) {
    highlights.push(`最近完成项目：${recentCompleted.map((project) => project.name).join('，')}。`);
  }
  if (recentKnowledge > 0) {
    highlights.push(`最近沉淀了 ${recentKnowledge} 条结构化知识资产。`);
  }
  if (profile.activeFocus?.length) {
    highlights.push(`当前 CEO 关注重点：${profile.activeFocus.join('，')}。`);
  }
  if (recentEvents[0]?.title) {
    highlights.push(`最近组织事件：${recentEvents[0].title}。`);
  }
  if (pendingIssues.length > 0) {
    reminders.push(...pendingIssues.slice(0, 3).map((issue) => issue.title));
  }
  if (pendingIssues.some((issue) => issue.level === 'critical')) {
    escalations.push(...pendingIssues.filter((issue) => issue.level === 'critical').slice(0, 3).map((issue) => issue.title));
  }

  const firstApproval = approvals[0];
  const firstProject = attentionProjects[0];
  const firstJob = jobs
    .slice()
    .sort((a, b) => (a.nextRunAt || '').localeCompare(b.nextRunAt || ''))[0];
  const firstKnowledge = knowledge[0];
  const schedulerNeedsAttention = activeSchedulers > 0 && ['disabled', 'stalled'].includes(schedulerRuntime.status);
  const projectNeedsAttention = attentionProjects.some((project) => project.status === 'failed' || project.status === 'paused');

  const actions: CEORoutineAction[] = [
    {
      id: 'approval-inbox',
      label: pendingApprovals > 0 ? `处理 ${pendingApprovals} 条待审批事项` : '审批入口无待办',
      type: 'approval',
      status: pendingApprovals > 0 ? 'attention' : 'done',
      priority: approvals.some((approval) => approval.urgency === 'critical') ? 'high' : pendingApprovals > 0 ? 'medium' : 'low',
      meta: firstApproval?.title || '无待处理审批',
      count: pendingApprovals,
      target: {
        kind: 'approvals',
        section: 'ceo',
        ...(firstApproval?.id ? { requestId: firstApproval.id } : {}),
        ...(firstApproval?.workspace ? { workspaceUri: firstApproval.workspace } : {}),
      },
    },
    {
      id: firstProject?.projectId ? `project-${firstProject.projectId}` : 'project-overview',
      label: projectNeedsAttention ? '处理风险项目' : activeProjects > 0 ? `查看 ${activeProjects} 个进行中项目` : '项目队列稳定',
      type: 'project',
      status: projectNeedsAttention ? 'attention' : activeProjects > 0 ? 'pending' : 'done',
      priority: projectNeedsAttention ? 'high' : activeProjects > 0 ? 'medium' : 'low',
      meta: firstProject?.name || '无进行中项目',
      count: attentionProjects.length,
      target: {
        kind: 'project',
        section: 'projects',
        ...(firstProject?.projectId ? { projectId: firstProject.projectId } : {}),
        ...(firstProject?.workspace ? { workspaceUri: firstProject.workspace } : {}),
      },
    },
    {
      id: firstJob?.jobId ? `scheduler-${firstJob.jobId}` : 'scheduler-overview',
      label: schedulerNeedsAttention ? '恢复定时任务调度' : activeSchedulers > 0 ? `检查 ${activeSchedulers} 个定时任务` : '无启用中的定时任务',
      type: 'scheduler',
      status: schedulerNeedsAttention ? 'attention' : activeSchedulers > 0 ? 'pending' : 'done',
      priority: schedulerNeedsAttention ? 'high' : activeSchedulers > 0 ? 'medium' : 'low',
      meta: schedulerRuntime.status === 'running'
        ? (firstJob?.nextRunAt ? `下次 ${firstJob.nextRunAt}` : '调度循环运行中')
        : schedulerRuntime.message,
      count: activeSchedulers,
      target: {
        kind: 'scheduler',
        section: 'operations',
        ...(firstJob?.jobId ? { jobId: firstJob.jobId } : {}),
        ...(firstJob?.departmentWorkspaceUri ? { workspaceUri: firstJob.departmentWorkspaceUri } : {}),
      },
    },
    {
      id: firstKnowledge?.id ? `knowledge-${firstKnowledge.id}` : 'knowledge-review',
      label: recentKnowledge > 0 ? `复盘 ${recentKnowledge} 条最近知识沉淀` : '补齐最近知识沉淀',
      type: 'knowledge',
      status: recentKnowledge > 0 ? 'pending' : 'attention',
      priority: recentKnowledge > 0 ? 'medium' : 'low',
      meta: firstKnowledge?.title || '暂无结构化知识资产',
      count: recentKnowledge,
      target: {
        kind: 'knowledge',
        section: 'knowledge',
        ...(firstKnowledge?.id ? { knowledgeId: firstKnowledge.id } : {}),
        ...(firstKnowledge?.workspaceUri ? { workspaceUri: firstKnowledge.workspaceUri } : {}),
      },
    },
    {
      id: 'ceo-focus',
      label: profile.activeFocus?.length ? '确认当前关注重点' : '设定 CEO 当前关注重点',
      type: 'focus',
      status: profile.activeFocus?.length ? 'pending' : 'attention',
      priority: profile.activeFocus?.length ? 'medium' : 'low',
      meta: profile.activeFocus?.slice(0, 2).join('，') || '未设置 activeFocus',
      count: profile.activeFocus?.length || 0,
      target: {
        kind: 'ceo-focus',
        section: 'ceo',
      },
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    overview: highlights[0] || '当前没有明显异常，组织保持稳定运行。',
    digest: highlights.join(' '),
    activeProjects,
    pendingApprovals,
    activeSchedulers,
    recentKnowledge,
    highlights,
    reminders,
    escalations,
    actions,
  };
}
