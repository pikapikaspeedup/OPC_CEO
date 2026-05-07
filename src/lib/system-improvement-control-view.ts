import type {
  SystemImprovementControlNextActionFE,
  SystemImprovementControlOwnerFE,
  SystemImprovementControlStageFE,
  SystemImprovementProposalFE,
} from './types';

export type SystemImprovementTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export function getSystemImprovementStageLabel(stage?: SystemImprovementControlStageFE): string {
  switch (stage) {
    case 'entry-review':
      return '待准入';
    case 'ai-executing':
      return 'AI 实现中';
    case 'ai-preflight':
      return 'AI 发布前检查';
    case 'exit-review':
      return '待准出';
    case 'ops-merge':
      return '待 Ops 合并';
    case 'ops-restart':
      return '待 Ops 重启';
    case 'published':
      return '已发布';
    case 'observing':
      return '观察中';
    case 'rolled-back':
      return '已回滚';
    case 'blocked':
      return '已阻塞';
    default:
      return '处理中';
  }
}

export function getSystemImprovementStageTone(stage?: SystemImprovementControlStageFE): SystemImprovementTone {
  switch (stage) {
    case 'entry-review':
      return 'warning';
    case 'ai-executing':
    case 'ai-preflight':
    case 'ops-merge':
    case 'ops-restart':
      return 'info';
    case 'exit-review':
    case 'published':
    case 'observing':
      return 'success';
    case 'blocked':
    case 'rolled-back':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function getSystemImprovementOwnerLabel(owner?: SystemImprovementControlOwnerFE): string {
  switch (owner) {
    case 'ceo':
      return 'CEO';
    case 'ai':
      return 'AI';
    case 'ops':
      return 'Ops';
    default:
      return '无';
  }
}

export function getSystemImprovementNextActionLabel(action?: SystemImprovementControlNextActionFE): string {
  switch (action) {
    case 'approve-entry':
      return '批准准入';
    case 'run-preflight':
      return '运行发布前检查';
    case 'approve-exit':
      return '批准准出';
    case 'mark-merged':
      return '标记已合并';
    case 'mark-restarted':
      return '标记已重启';
    case 'start-observation':
      return '开始观察';
    case 'mark-rolled-back':
      return '标记已回滚';
    case 'resolve-blocker':
      return '处理阻塞项';
    case 'none':
    default:
      return '无';
  }
}

export function getSystemImprovementQueueSummary(proposal: SystemImprovementProposalFE): string {
  const controlState = proposal.controlState;
  if (!controlState) return proposal.summary;
  return [controlState.headline, controlState.subline].filter(Boolean).join(' · ');
}

export function isSystemImprovementDecisionStage(proposal: SystemImprovementProposalFE): boolean {
  return proposal.controlState?.pageMode === 'entry-review' || proposal.controlState?.pageMode === 'exit-review';
}
