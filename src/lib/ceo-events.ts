import type { Project, PipelineStageProgressFE, CEOEvent } from './types';

function isToday(isoDate?: string): boolean {
  if (!isoDate) return false;
  return new Date(isoDate).toDateString() === new Date().toDateString();
}

function isOverdue(project: Project): boolean {
  if (project.status !== 'active' || !project.updatedAt) return false;
  const daysSinceUpdate = (Date.now() - new Date(project.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceUpdate > 7;
}

const EVENT_PRIORITY: Record<string, number> = { critical: 0, warning: 1, info: 2, done: 3 };
function eventPriority(type: string): number { return EVENT_PRIORITY[type] ?? 99; }

let _idCounter = 0;
function nextId(): string { return `ceo-evt-${++_idCounter}`; }

function buildProjectActions(project: Project, options?: { includeScheduler?: boolean }): NonNullable<CEOEvent['actions']> {
  const actions: NonNullable<CEOEvent['actions']> = [];

  actions.push({
    label: '打开项目',
    action: 'view',
    payload: { projectId: project.projectId },
  });

  if (project.workspace) {
    actions.push({
      label: '筛选部门',
      action: 'navigate',
      payload: { workspaceUri: project.workspace, target: 'department' },
    });
  }

  if (options?.includeScheduler) {
    actions.push({
      label: '打开调度',
      action: 'navigate',
      payload: { target: 'scheduler', workspaceUri: project.workspace },
    });
  }

  return actions;
}

export function generateCEOEvents(projects: Project[], stages: PipelineStageProgressFE[]): CEOEvent[] {
  const events: CEOEvent[] = [];
  const coveredStageIds = new Set<string>();

  // Critical: pending gate approvals
  for (const project of projects) {
    for (const stage of project.pipelineState?.stages || []) {
      if (stage.nodeKind !== 'gate' || stage.gateApproval?.status !== 'pending') {
        continue;
      }

      coveredStageIds.add(stage.stageId);
      events.push({
        id: nextId(),
        type: 'critical',
        title: 'Gate 待审批',
        description: `Stage ${stage.title || stage.stageId} awaiting approval`,
        projectId: project.projectId,
        workspaceUri: project.workspace,
        timestamp: new Date().toISOString(),
        actions: buildProjectActions(project, { includeScheduler: true }),
      });
    }
  }

  for (const stage of stages) {
    if (coveredStageIds.has(stage.stageId)) continue;
    if (stage.nodeKind === 'gate' && stage.gateApproval?.status === 'pending') {
      events.push({
        id: nextId(),
        type: 'critical',
        title: 'Gate 待审批',
        description: `Stage ${stage.title || stage.stageId} awaiting approval`,
        timestamp: new Date().toISOString(),
        actions: [
          { label: '打开调度', action: 'navigate', payload: { target: 'scheduler' } },
        ],
      });
    }
  }

  // Warning: overdue projects
  for (const project of projects) {
    if (isOverdue(project)) {
      events.push({
        id: nextId(),
        type: 'warning',
        title: `${project.name} 超时`,
        description: `Last updated ${project.updatedAt}`,
        projectId: project.projectId,
        workspaceUri: project.workspace,
        timestamp: project.updatedAt || new Date().toISOString(),
        actions: buildProjectActions(project, { includeScheduler: true }),
      });
    }
  }

  // Info: completed today
  for (const project of projects) {
    if (project.status === 'completed' && isToday(project.updatedAt)) {
      events.push({
        id: nextId(),
        type: 'done',
        title: `${project.name} 完成`,
        projectId: project.projectId,
        workspaceUri: project.workspace,
        timestamp: project.updatedAt || new Date().toISOString(),
        actions: buildProjectActions(project),
      });
    }
  }

  // Failed projects today
  for (const project of projects) {
    if (project.status === 'failed' && isToday(project.updatedAt)) {
      events.push({
        id: nextId(),
        type: 'warning',
        title: `${project.name} 失败`,
        projectId: project.projectId,
        workspaceUri: project.workspace,
        timestamp: project.updatedAt || new Date().toISOString(),
        actions: buildProjectActions(project, { includeScheduler: true }),
      });
    }
  }

  return events.sort((a, b) => eventPriority(a.type) - eventPriority(b.type));
}
