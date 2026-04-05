/**
 * Approval Triggers — Auto-generate approval requests on run anomalies.
 *
 * Listens to ProjectEvent 'stage:failed' and creates approval requests
 * for CEO review when runs fail, timeout, or get blocked.
 *
 * Must be initialized once at server startup via initApprovalTriggers().
 */

import { onProjectEvent, type ProjectEvent } from './project-events';
import { submitApprovalRequest } from '../approval/handler';
import { getRun } from './run-registry';
import { getProject } from './project-registry';
import { createLogger } from '../logger';

const log = createLogger('ApprovalTriggers');

const globalForApprovalTriggers = globalThis as unknown as {
  __AG_APPROVAL_TRIGGERS_INIT__?: boolean;
};

/**
 * Initialize approval triggers. Idempotent — safe to call multiple times.
 */
export function initApprovalTriggers(): void {
  if (globalForApprovalTriggers.__AG_APPROVAL_TRIGGERS_INIT__) return;
  globalForApprovalTriggers.__AG_APPROVAL_TRIGGERS_INIT__ = true;

  onProjectEvent('approval-triggers', async (event: ProjectEvent) => {
    if (event.type !== 'stage:failed') return;

    try {
      await handleStageFailed(event);
    } catch (err: any) {
      log.error({ err: err.message, projectId: event.projectId, stageId: event.stageId }, 'Approval trigger error');
    }
  });

  log.info('Approval triggers initialized');
}

async function handleStageFailed(event: Extract<ProjectEvent, { type: 'stage:failed' }>): Promise<void> {
  const run = getRun(event.runId);
  const project = getProject(event.projectId);

  const workspace = run?.workspace || project?.workspace || '';
  const projectName = project?.name || event.projectId;
  const stageId = event.stageId;
  const shortRunId = event.runId.slice(0, 8);

  if (event.status === 'timeout') {
    await submitApprovalRequest({
      type: 'other',
      workspace,
      runId: event.runId,
      title: `任务超时: ${projectName}`,
      description: `项目「${projectName}」的阶段 ${stageId} 执行超时 (Run: ${shortRunId})。${event.error || ''}`,
      urgency: 'high',
    });
    log.info({ projectId: event.projectId, runId: shortRunId }, 'Auto-created timeout approval request');
  } else if (event.status === 'blocked') {
    await submitApprovalRequest({
      type: 'scope_extension',
      workspace,
      runId: event.runId,
      title: `任务阻塞: ${projectName}`,
      description: `项目「${projectName}」的阶段 ${stageId} 被阻塞 (Run: ${shortRunId})。${event.error || '需要人工介入解除阻塞。'}`,
      urgency: 'high',
    });
    log.info({ projectId: event.projectId, runId: shortRunId }, 'Auto-created blocked approval request');
  } else {
    // failed
    await submitApprovalRequest({
      type: 'other',
      workspace,
      runId: event.runId,
      title: `任务失败: ${projectName}`,
      description: `项目「${projectName}」的阶段 ${stageId} 执行失败 (Run: ${shortRunId})。错误: ${event.error || '未知错误'}`,
      urgency: 'normal',
    });
    log.info({ projectId: event.projectId, runId: shortRunId }, 'Auto-created failure approval request');
  }
}
