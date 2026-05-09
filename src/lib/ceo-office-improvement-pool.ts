import { getSystemImprovementStageTone, type SystemImprovementTone } from './system-improvement-control-view';
import {
  isActiveStoryTopCandidateMetadata,
  readStoryTopCandidateGeneratedAt,
} from './story-top-candidates';
import type {
  SystemImprovementAreaFE,
  SystemImprovementProposalFE,
  SystemImprovementSignalFE,
} from './types';

export interface ImprovementCandidateView {
  signal: SystemImprovementSignalFE;
  proposal: SystemImprovementProposalFE | null;
  sourceLabel: string;
  severityLabel: string;
  severityTone: SystemImprovementTone;
  areasLabel: string;
  proposalStatusLabel: string;
  proposalStatusTone: SystemImprovementTone;
}

const areaLabels: Record<SystemImprovementAreaFE, string> = {
  frontend: '前端',
  api: 'API',
  runtime: '运行时',
  scheduler: '调度',
  provider: 'Provider',
  knowledge: '知识',
  approval: '审批',
  database: '数据库',
  docs: '文档',
};

const sourceLabels: Record<string, string> = {
  performance: '性能',
  'ux-breakpoint': '体验断点',
  'test-failure': '测试失败',
  'runtime-error': '运行故障',
  'manual-feedback': '人工反馈',
  'duplicate-work': '重复工作',
  'architecture-risk': '架构风险',
  'user-story-gap': '用户故事缺口',
};

function formatSeverity(signal: SystemImprovementSignalFE): { label: string; tone: SystemImprovementTone } {
  switch (signal.severity) {
    case 'critical':
      return { label: '关键', tone: 'danger' };
    case 'high':
      return { label: '高', tone: 'danger' };
    case 'medium':
      return { label: '中', tone: 'warning' };
    case 'low':
    default:
      return { label: '低', tone: 'success' };
  }
}

function formatAreas(areas: SystemImprovementAreaFE[]): string {
  const labels = areas.map((area) => areaLabels[area] || area);
  if (labels.length <= 2) return labels.join(' · ');
  return `${labels.slice(0, 2).join(' · ')} +${labels.length - 2}`;
}

function getProposalStatus(proposal: SystemImprovementProposalFE | null): { label: string; tone: SystemImprovementTone } {
  if (!proposal) return { label: '未生成提案', tone: 'neutral' };

  const stage = proposal.controlState?.stage;
  if (stage === 'entry-review') return { label: '待 CEO 准入', tone: 'warning' };
  if (stage === 'exit-review') return { label: '待 CEO 准出', tone: 'success' };
  if (stage === 'observing' || stage === 'published') return { label: '已发布/观察中', tone: 'success' };
  if (stage === 'blocked') return { label: '已阻塞', tone: 'danger' };
  if (stage === 'rolled-back') return { label: '已回滚', tone: 'danger' };
  if (stage) return { label: '执行中', tone: getSystemImprovementStageTone(stage) };

  return { label: '已生成提案', tone: 'info' };
}

export function buildImprovementCandidateViews(
  signals: SystemImprovementSignalFE[],
  proposals: SystemImprovementProposalFE[],
): ImprovementCandidateView[] {
  const latestProposalBySignalId = new Map<string, SystemImprovementProposalFE>();
  const sortedProposals = [...proposals].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  for (const proposal of sortedProposals) {
    for (const signalId of proposal.sourceSignalIds) {
      if (!latestProposalBySignalId.has(signalId)) {
        latestProposalBySignalId.set(signalId, proposal);
      }
    }
  }

  return [...signals]
    .filter((signal) => isActiveStoryTopCandidateMetadata(signal.metadata || undefined))
    .sort((left, right) => {
      const leftGeneratedAt = readStoryTopCandidateGeneratedAt(left.metadata || undefined) || left.createdAt;
      const rightGeneratedAt = readStoryTopCandidateGeneratedAt(right.metadata || undefined) || right.createdAt;
      if (leftGeneratedAt !== rightGeneratedAt) {
        return rightGeneratedAt.localeCompare(leftGeneratedAt);
      }
      return right.createdAt.localeCompare(left.createdAt);
    })
    .map((signal) => {
      const proposal = latestProposalBySignalId.get(signal.id) || null;
      const severity = formatSeverity(signal);
      const proposalStatus = getProposalStatus(proposal);

      return {
        signal,
        proposal,
        sourceLabel: sourceLabels[signal.source] || signal.source,
        severityLabel: severity.label,
        severityTone: severity.tone,
        areasLabel: formatAreas(signal.affectedAreas),
        proposalStatusLabel: proposalStatus.label,
        proposalStatusTone: proposalStatus.tone,
      };
    });
}
