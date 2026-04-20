import { onProjectEvent } from '../agents/project-events';
import { appendCEOPendingIssue, removeCEOPendingIssuesByPrefix } from './ceo-profile-store';
import { appendCEOEvent } from './ceo-event-store';

let registered = false;

export function ensureCEOEventConsumer(): void {
  if (registered) return;
  registered = true;

  onProjectEvent('ceo-event-consumer', async (event) => {
    if (event.type === 'stage:completed') {
      removeCEOPendingIssuesByPrefix(`project:${event.projectId}:${event.stageId}:`);
      appendCEOEvent({
        kind: 'project',
        level: 'done',
        title: `Stage ${event.stageId} completed`,
        description: `Run ${event.runId} completed successfully.`,
        projectId: event.projectId,
        meta: { stageId: event.stageId, runId: event.runId },
      });
      return;
    }

    if (event.type === 'stage:failed') {
      appendCEOEvent({
        kind: 'project',
        level: event.status === 'blocked' ? 'warning' : 'critical',
        title: `Stage ${event.stageId} ${event.status}`,
        description: event.error || `Run ${event.runId} entered ${event.status}.`,
        projectId: event.projectId,
        meta: { stageId: event.stageId, runId: event.runId, status: event.status },
      });
      appendCEOPendingIssue({
        id: `project:${event.projectId}:${event.stageId}:${event.status}`,
        title: `项目 ${event.projectId} 的阶段 ${event.stageId} 进入 ${event.status}`,
        level: event.status === 'blocked' ? 'warning' : 'critical',
        source: 'project',
        projectId: event.projectId,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    if (event.type === 'project:completed') {
      removeCEOPendingIssuesByPrefix(`project:${event.projectId}:`);
      appendCEOEvent({
        kind: 'project',
        level: 'done',
        title: 'Project completed',
        projectId: event.projectId,
      });
      return;
    }

    if (event.type === 'branch:completed') {
      appendCEOEvent({
        kind: 'project',
        level: 'info',
        title: `Branch ${event.branchIndex} completed`,
        description: `Child project ${event.subProjectId} completed under ${event.parentStageId}.`,
        projectId: event.parentProjectId,
      });
    }
  });
}
