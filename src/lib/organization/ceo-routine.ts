import { listApprovalRequests } from '../approval/request-store';
import { listProjects } from '../agents/project-registry';
import { listScheduledJobsEnriched } from '../agents/scheduler';
import { listRecentKnowledgeAssets } from '../knowledge';
import { ensureCEOEventConsumer } from './ceo-event-consumer';
import { listCEOEvents } from './ceo-event-store';
import { reconcileCEOPendingIssues } from './ceo-profile-store';
import type { CEORoutineSummary } from './contracts';

export function buildCEORoutineSummary(): CEORoutineSummary {
  ensureCEOEventConsumer();
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
  const knowledge = listRecentKnowledgeAssets(10);
  const recentEvents = listCEOEvents(5);
  const pendingIssues = profile.pendingIssues || [];

  const activeProjects = projects.filter((project) => project.status === 'active').length;
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

  const actions: CEORoutineSummary['actions'] = [];
  if (pendingApprovals > 0) actions.push({ label: '处理待审批事项', type: 'approval' });
  if (activeProjects > 0) actions.push({ label: '查看进行中项目', type: 'project' });
  if (activeSchedulers > 0) actions.push({ label: '检查定时任务', type: 'scheduler' });
  if (recentKnowledge > 0) actions.push({ label: '复盘最近知识沉淀', type: 'knowledge' });
  if (profile.activeFocus?.length) actions.push({ label: '确认当前关注重点', type: 'focus' });

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
