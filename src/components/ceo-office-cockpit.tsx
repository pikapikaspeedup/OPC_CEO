'use client';

import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Command,
  Gauge,
  Layers3,
  MessageSquare,
  PackageCheck,
  PauseCircle,
  PlayCircle,
  Radio,
  RefreshCw,
  Search,
  SendHorizontal,
  Settings2,
  ShieldAlert,
  Sparkles,
  UserRound,
} from 'lucide-react';
import Chat from '@/components/chat';
import ChatInput from '@/components/chat-input';
import CEODashboard from '@/components/ceo-dashboard';
import ApprovalPanel from '@/components/approval-panel';
import DepartmentDetailDrawer from '@/components/department-detail-drawer';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api, type AuditEvent } from '@/lib/api';
import { getDepartmentBoundWorkspaceUris } from '@/lib/department-config';
import { formatRelativeTime } from '@/lib/i18n/formatting';
import { pickLatestDailyDigest } from '@/lib/ceo-office-home';
import type { Locale } from '@/lib/i18n';
import type {
  AgentRun,
  CompanyLoopDigestFE,
  CompanyLoopPolicyFE,
  CompanyLoopRunFE,
  CompanyLoopRunKindFE,
  CompanyOperatingDayFE,
  CEORoutineSummaryFE,
  Conversation,
	  DailyDigestFE,
	  DepartmentConfig,
	  GrowthProposalFE,
	  ManagementOverviewFE,
  OperatingAgendaItemFE,
  OperatingSignalFE,
  SystemImprovementProposalFE,
  ModelConfig,
  Project,
  Skill,
  StepsData,
  UserInfo,
  Workflow,
  Workspace,
} from '@/lib/types';
import type { ActiveTask } from '@/components/active-tasks-panel';
import {
  WorkspaceMiniMetric,
  WorkspaceStatusDot,
  WorkspaceSurface,
} from '@/components/ui/workspace-primitives';
import { cn } from '@/lib/utils';

type ChatInputSend = ComponentProps<typeof ChatInput>['onSend'];

type CeoOfficeCockpitProps = {
  locale: Locale;
  connected: boolean;
  activeId: string | null;
  activeTitle: string;
  steps: StepsData | null;
  loading: boolean;
  isActive: boolean;
  isRunning: boolean;
  sendError: string | null;
  currentModel: string;
  models: ModelConfig[];
  skills: Skill[];
  workflows: Workflow[];
  agenticMode: boolean;
  activeRuns: AgentRun[];
  pendingApprovals: number;
  projects: Project[];
  workspaces: Workspace[];
  departments: Map<string, DepartmentConfig>;
  configuredDepartmentCount: number;
  ceoHistory: Conversation[];
  ceoPriorityTasks: ActiveTask[];
  ceoRecentEvents: AuditEvent[];
  refreshSignal?: number;
  onCreateCeoConversation: () => void | Promise<void>;
  onOpenConversationWorkbench: () => void;
  onOpenProjects: () => void;
  onOpenKnowledge: () => void;
  onNavigateToKnowledge: (knowledgeId: string | null, title: string | null) => void;
  onOpenOps: (options?: { proposalId?: string; query?: string }) => void;
  onOpenImprovementProposal: (proposalId: string | null) => void;
  onOpenSettings: () => void;
  onSelectConversation: (id: string, title: string, targetSection?: 'ceo' | 'conversations') => void;
  onNavigateToProject: (projectId: string | null) => void;
  onSend: ChatInputSend;
  onCancel: () => void;
  onProceed: (uri: string) => void;
  onRevert?: (stepIndex: number) => void;
  onModelChange: (model: string) => void;
  onAgenticModeChange: (mode: boolean) => void;
  onDepartmentSaved: (uri: string, config: DepartmentConfig) => void;
  onRefreshDashboard: () => void;
};

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

function formatImprovementMergeGateLabel(proposal: SystemImprovementProposalFE): string {
  switch (proposal.exitEvidence?.mergeGate.status) {
    case 'ready-to-merge':
      return '可发布';
    case 'blocked':
      return '已阻塞';
    case 'pending':
      return '待补齐';
    default:
      return '待收口';
  }
}

function formatImprovementReleaseGateLabel(proposal: SystemImprovementProposalFE): string | null {
  switch (proposal.exitEvidence?.releaseGate?.status) {
    case 'preflight-failed':
      return '预检失败';
    case 'ready-for-approval':
      return '待批准发布';
    case 'approved':
      return '已批准发布';
    case 'merged':
      return '已合并';
    case 'restarted':
      return '已重启';
    case 'observing':
      return '观察中';
    case 'rolled-back':
      return '已回滚';
    default:
      return null;
  }
}

function formatImprovementExecutionSummary(proposal: SystemImprovementProposalFE): string {
  const evidence = proposal.exitEvidence;
  if (!evidence) {
    return proposal.status;
  }
  const segments: string[] = [];
  if (evidence.codex) {
    segments.push(`Codex ${evidence.codex.decision}`);
    segments.push(`${evidence.codex.changedFiles.length} files`);
  }
  if (evidence.project) segments.push(`项目 ${evidence.project.status}`);
  if (evidence.latestRun) {
    segments.push(
      evidence.latestRun.status === 'completed'
        ? 'Run 已完成'
        : evidence.latestRun.status === 'running'
          ? 'Run 执行中'
          : evidence.latestRun.status === 'blocked'
            ? 'Run 阻塞'
            : evidence.latestRun.status === 'failed'
              ? 'Run 失败'
              : `Run ${evidence.latestRun.status}`,
    );
  }
  segments.push(
    evidence.testing.evidenceCount > 0
      ? `测试 ${evidence.testing.passedCount}/${evidence.testing.evidenceCount}`
      : '未提交测试',
  );
  segments.push(`发布 ${formatImprovementMergeGateLabel(proposal)}`);
  const releaseLabel = formatImprovementReleaseGateLabel(proposal);
  if (releaseLabel) {
    segments.push(`发布 ${releaseLabel}`);
  }
  return segments.join(' · ');
}

function getImprovementDecisionLabel(proposal: SystemImprovementProposalFE): string {
  switch (proposal.exitEvidence?.releaseGate?.status) {
    case 'preflight-failed':
      return '预检失败';
    case 'ready-for-approval':
      return '待批准发布';
    case 'approved':
      return '待合并';
    case 'merged':
      return '待重启';
    case 'restarted':
      return '待观察';
    default:
      break;
  }
  if (proposal.exitEvidence?.mergeGate.status === 'ready-to-merge') return '待发布检查';
  if (proposal.exitEvidence?.mergeGate.status === 'blocked') return '需处理';
  if (proposal.status === 'approval-required') return '需准入';
  if (proposal.status === 'approved') return '待执行';
  if (proposal.status === 'testing') return '待验证';
  return proposal.status;
}

function getImprovementDecisionPriority(proposal: SystemImprovementProposalFE): DecisionItem['priority'] {
  if (
    proposal.status === 'approval-required'
    || proposal.exitEvidence?.mergeGate.status === 'ready-to-merge'
    || proposal.exitEvidence?.mergeGate.status === 'blocked'
    || proposal.risk === 'critical'
    || proposal.risk === 'high'
  ) {
    return '高';
  }
  if (proposal.status === 'approved' || proposal.status === 'testing') return '中';
  return '低';
}

function getImprovementDecisionTone(proposal: SystemImprovementProposalFE): Tone {
  if (proposal.exitEvidence?.releaseGate?.status === 'preflight-failed') return 'danger';
  if (proposal.exitEvidence?.releaseGate?.status === 'ready-for-approval') return 'success';
  if (proposal.exitEvidence?.releaseGate?.status === 'approved' || proposal.exitEvidence?.releaseGate?.status === 'merged') return 'warning';
  if (proposal.exitEvidence?.releaseGate?.status === 'restarted') return 'info';
  if (proposal.exitEvidence?.mergeGate.status === 'ready-to-merge') return 'success';
  if (proposal.exitEvidence?.mergeGate.status === 'blocked') return 'danger';
  if (proposal.status === 'approval-required' || proposal.status === 'approved' || proposal.status === 'testing') return 'warning';
  return 'info';
}

type DepartmentPulse = {
  workspace: Workspace;
  department: DepartmentConfig | undefined;
  active: number;
  completed: number;
  failed: number;
  total: number;
  progress: number;
};

type DecisionItem = {
  id: string;
  title: string;
  source: string;
  eta: string;
  priority: '高' | '中' | '低';
  tone: Tone;
  icon: ReactNode;
  detail?: string;
  onClick?: () => void;
};

type RoutineItem = {
  id: string;
  label: string;
  meta: string;
  done: boolean;
  status: 'done' | 'pending' | 'attention';
  priority: 'low' | 'medium' | 'high';
  action?: CEORoutineSummaryFE['actions'][number];
};

const navItems = [
  { key: 'ceo', label: 'CEO Office', icon: UserRound },
  { key: 'projects', label: 'Projects', icon: BriefcaseBusiness },
  { key: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { key: 'ops', label: 'Ops', icon: Radio },
  { key: 'settings', label: 'Settings', icon: Settings2 },
] as const;

function getGreeting(locale: Locale, date: Date): string {
  const hour = date.getHours();
  if (locale !== 'zh') {
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function getUserDisplayName(user: UserInfo | null): string {
  if (user?.name?.trim()) return user.name.trim();
  if (user?.email) return user.email.split('@')[0] || 'CEO';
  return 'CEO';
}

function getCompanyName(user: UserInfo | null): string {
  const domain = user?.email?.split('@')[1];
  if (!domain) return 'AI 未来科技有限公司';
  return domain.split('.')[0]?.toUpperCase() || 'OPC';
}

function getProjectPriority(project: Project): number {
  if (project.status === 'failed') return 0;
  if (project.status === 'paused') return 1;
  if (project.status === 'active') return 2;
  return 3;
}

function getProjectTone(status: Project['status']): Tone {
  if (status === 'failed') return 'danger';
  if (status === 'paused') return 'warning';
  if (status === 'active') return 'info';
  if (status === 'completed') return 'success';
  return 'neutral';
}

function formatAuditKind(kind: string): string {
  if (kind === 'stage:completed') return '阶段完成';
  if (kind === 'stage:failed') return '阶段失败';
  if (kind === 'project:completed') return '项目完成';
  if (kind === 'job:failed') return '任务失败';
  return kind;
}

function getDepartmentOkrProgress(department: DepartmentConfig | undefined): number | null {
  const keyResults = department?.okr?.objectives?.flatMap(objective => objective.keyResults) || [];
  if (!keyResults.length) return null;

  const total = keyResults.reduce((sum, item) => {
    if (!item.target) return sum;
    return sum + Math.min(1, Math.max(0, item.current / item.target));
  }, 0);

  return Math.round((total / keyResults.length) * 100);
}

function toneClasses(tone: Tone) {
  return {
    neutral: 'border-[#dfe6f2] bg-white text-[#1d2738]',
    info: 'border-sky-200 bg-sky-50 text-sky-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    danger: 'border-red-200 bg-red-50 text-red-700',
    accent: 'border-blue-200 bg-blue-50 text-blue-700',
  }[tone];
}

function SectionHeader({
  title,
  action,
}: {
  title: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[15px] font-semibold tracking-[-0.03em] text-[#111827]">{title}</h2>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  delta,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  delta?: ReactNode;
  icon: ReactNode;
  tone: Tone;
}) {
  return (
    <div className="rounded-[14px] border border-[#e3e8f2] bg-white p-4 shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] text-[#6b768a]">{label}</div>
          <div className="mt-2 flex items-end gap-2">
            <div className="text-[28px] font-semibold leading-none tracking-[-0.06em] text-[#111827]">{value}</div>
            {delta ? <div className="pb-1 text-[12px] font-semibold text-emerald-600">{delta}</div> : null}
          </div>
          <div className="mt-2 truncate text-[12px] text-[#7c8799]">{detail}</div>
        </div>
        <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border', toneClasses(tone))}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function SplitMetricCard({
  activeSchedulers,
  completedToday,
  schedulerRuntime,
}: {
  activeSchedulers: number;
  completedToday: number;
  schedulerRuntime?: ManagementOverviewFE['schedulerRuntime'];
}) {
  const schedulerTone = schedulerRuntime?.status === 'disabled' || schedulerRuntime?.status === 'stalled'
    ? 'warning'
    : activeSchedulers > 0
      ? 'info'
      : 'success';
  const schedulerDetail = (() => {
    if (!schedulerRuntime) return activeSchedulers > 0 ? '状态读取中' : '无启用任务';
    if (schedulerRuntime.status === 'disabled') return '调度未启动';
    if (schedulerRuntime.status === 'stalled') return '调度循环异常';
    if (schedulerRuntime.dueNowCount > 0) return `${schedulerRuntime.dueNowCount} 个任务待触发`;
    if (schedulerRuntime.nextRunAt) return `下次 ${formatRelativeTime(schedulerRuntime.nextRunAt, 'zh')}`;
    return schedulerRuntime.status === 'idle' ? '空闲' : '调度运行中';
  })();
  const schedulerIconClassName = schedulerTone === 'warning'
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : schedulerTone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-indigo-200 bg-indigo-50 text-indigo-700';

  return (
    <div className="rounded-[14px] border border-[#e3e8f2] bg-white p-4 shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
      <div className="grid h-full grid-cols-2 divide-x divide-[#edf1f7]">
        <div className="pr-4">
          <div className="flex items-center gap-3">
            <div className={cn('flex h-11 w-11 items-center justify-center rounded-[14px] border', schedulerIconClassName)}>
              <Clock3 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] text-[#6b768a]">定时任务</div>
              <div className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.06em] text-[#111827]">{activeSchedulers}</div>
            </div>
          </div>
          <div className={cn('mt-2 text-[12px]', schedulerTone === 'warning' ? 'text-amber-700' : 'text-[#7c8799]')}>{schedulerDetail}</div>
        </div>
        <div className="pl-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-blue-200 bg-blue-50 text-blue-700">
              <PackageCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] text-[#6b768a]">今日完成</div>
              <div className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.06em] text-[#111827]">{completedToday}</div>
            </div>
          </div>
          <div className="mt-2 text-[12px] text-[#7c8799]">完成项目记录</div>
        </div>
      </div>
    </div>
  );
}

function CeoRail({
  user,
  onOpenProjects,
  onOpenKnowledge,
  onOpenOps,
  onOpenSettings,
}: {
  user: UserInfo | null;
  onOpenProjects: () => void;
  onOpenKnowledge: () => void;
  onOpenOps: () => void;
  onOpenSettings: () => void;
}) {
  const displayName = getUserDisplayName(user);
  const initials = displayName.slice(0, 1).toUpperCase();
  const handlers: Record<typeof navItems[number]['key'], () => void> = {
    ceo: () => undefined,
    projects: onOpenProjects,
    knowledge: onOpenKnowledge,
    ops: onOpenOps,
    settings: onOpenSettings,
  };

  return (
    <aside className="hidden w-[216px] shrink-0 border-r border-[#dfe5ee] bg-[#f4f7fb] px-3 py-6 lg:flex lg:flex-col">
      <div className="flex items-center gap-3 px-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-[15px] bg-[#0b64d8] text-white shadow-[0_14px_28px_rgba(11,100,216,0.2)]">
          <Command className="h-5 w-5" />
        </div>
        <div className="text-[22px] font-semibold tracking-[-0.05em] text-[#0d1b2e]">OPC</div>
      </div>

      <nav className="mt-10 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.key === 'ceo';

          return (
            <button
              key={item.key}
              type="button"
              onClick={handlers[item.key]}
              className={cn(
                'flex h-14 w-full items-center gap-3 rounded-[10px] px-4 text-left text-[15px] font-medium transition-colors',
                active ? 'bg-[#e6effb] text-[#145fc2]' : 'text-[#1f2937] hover:bg-white',
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2">
        <div className="rounded-[10px] border border-[#dfe5ee] bg-white p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e6effb] text-sm font-semibold text-[#145fc2]">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[#111827]">{displayName}</div>
              <div className="truncate text-[12px] text-[#7c8799]">CEO</div>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-11 w-full items-center justify-between rounded-[10px] border border-[#dfe5ee] bg-white px-3 text-[12px] text-[#566176] hover:bg-[#f9fbff]"
        >
          <span>{getCompanyName(user)}</span>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

function TopUtilityBar({
  displayName,
  company,
  greeting,
  todayLabel,
  pendingApprovals,
  onOpenConversationWorkbench,
  onOpenKnowledge,
  onOpenApprovals,
}: {
  displayName: string;
  company: string;
  greeting: string;
  todayLabel: string;
  pendingApprovals: number;
  onOpenConversationWorkbench: () => void;
  onOpenKnowledge: () => void;
  onOpenApprovals: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <div className="min-w-0">
        <h1 className="text-[clamp(1.55rem,2vw,2rem)] font-semibold leading-tight tracking-[-0.06em] text-[#111827]">
          {displayName}，{greeting}
        </h1>
        <div className="mt-1 truncate text-[13px] text-[#6b768a]">{company}{todayLabel ? ` · ${todayLabel}` : ''}</div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onOpenKnowledge}
          className="hidden h-10 min-w-[184px] items-center gap-2 rounded-[10px] border border-[#dfe5ee] bg-white px-3 text-left text-[13px] text-[#8a95a8] shadow-[0_8px_20px_rgba(31,41,55,0.04)] md:flex"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1">打开知识库</span>
        </button>
        <button
          type="button"
          onClick={onOpenConversationWorkbench}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#dfe5ee] bg-white px-3 text-[13px] font-medium text-[#1f2937] shadow-[0_8px_20px_rgba(31,41,55,0.04)] hover:bg-[#f9fbff]"
        >
          <MessageSquare className="h-4 w-4" />
          对话线程
        </button>
        <button
          type="button"
          onClick={onOpenApprovals}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#dfe5ee] bg-white text-[#566176] shadow-[0_8px_20px_rgba(31,41,55,0.04)] hover:bg-[#f9fbff]"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {pendingApprovals ? (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#2f6df6] px-1 text-[11px] font-semibold text-white">
              {pendingApprovals > 9 ? '9+' : pendingApprovals}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

function MobileNav({
  onOpenProjects,
  onOpenKnowledge,
  onOpenOps,
  onOpenSettings,
}: {
  onOpenProjects: () => void;
  onOpenKnowledge: () => void;
  onOpenOps: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 lg:hidden">
      {[
        { label: 'Projects', icon: BriefcaseBusiness, onClick: onOpenProjects },
        { label: 'Knowledge', icon: BookOpen, onClick: onOpenKnowledge },
        { label: 'Ops', icon: Radio, onClick: onOpenOps },
        { label: 'Settings', icon: Settings2, onClick: onOpenSettings },
      ].map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className="flex min-h-11 items-center justify-center gap-2 rounded-[12px] border border-[#dfe5ee] bg-white text-[12px] font-medium text-[#344054]"
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function CommandShortcut({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 items-center gap-3 rounded-[12px] border border-[#e3e8f2] bg-[#fbfcff] px-3 text-left transition-colors hover:border-[#cfd8e8] hover:bg-white"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[#eaf2ff] text-[#1768d9]">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[#1f2937]">{title}</span>
        <span className="mt-0.5 block truncate text-[12px] text-[#7c8799]">{subtitle}</span>
      </span>
    </button>
  );
}

function Sparkline({
  tone = 'success',
}: {
  tone?: 'success' | 'warning' | 'info';
}) {
  const stroke = tone === 'warning' ? '#f97316' : tone === 'info' ? '#0ea5e9' : '#10b981';
  return (
    <svg viewBox="0 0 84 28" className="h-7 w-20" aria-hidden="true">
      <path d="M2 22 C12 18 16 24 26 15 S42 18 51 10 66 14 82 5" fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function DecisionRow({ item }: { item: DecisionItem }) {
  return (
    <button
      type="button"
      onClick={item.onClick}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-[#edf1f7] px-3 py-3 text-left last:border-b-0 hover:bg-[#f8fbff]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border', toneClasses(item.tone))}>
          {item.icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#1f2937]">{item.title}</div>
          <div className="mt-0.5 truncate text-[12px] text-[#7c8799]">来自：{item.source}</div>
          {item.detail ? <div className="mt-1 line-clamp-1 text-[11px] text-[#98a2b3]">{item.detail}</div> : null}
        </div>
      </div>
      <div className="hidden text-[12px] text-[#566176] sm:block">{item.eta}</div>
      <span className={cn(
        'rounded-md px-2 py-1 text-[11px] font-semibold',
        item.priority === '高' ? 'bg-red-50 text-red-600' : item.priority === '中' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-600',
      )}
      >
        {item.priority}
      </span>
    </button>
  );
}

function DepartmentRow({
  item,
  onOpenDepartment,
}: {
  item: DepartmentPulse;
  onOpenDepartment: (workspaceUri: string) => void;
}) {
  const tone = item.failed ? 'warning' : item.active ? 'success' : 'info';
  const barClass = item.failed ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <button
      type="button"
      onClick={() => onOpenDepartment(item.workspace.uri)}
      className="grid w-full grid-cols-[minmax(170px,1.35fr)_0.8fr_0.6fr_90px] items-center gap-4 border-b border-[#edf1f7] px-3 py-3 text-left last:border-b-0 hover:bg-[#f8fbff] max-md:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#eaf2ff] text-[#1768d9]">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#1f2937]">{item.department?.name || item.workspace.name}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[12px] text-[#7c8799]">OKR 进度</span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[#edf1f7]">
              <div className={cn('h-full rounded-full', barClass)} style={{ width: `${Math.max(6, Math.min(100, item.progress))}%` }} />
            </div>
            <span className="text-[12px] text-[#566176]">{item.progress}%</span>
          </div>
        </div>
      </div>
      <div className="text-sm text-[#1f2937] max-md:hidden">
        <span className="text-[12px] text-[#7c8799]">活跃任务</span>
        <div className="mt-1 font-semibold">{item.active}</div>
      </div>
      <div className="text-sm text-[#1f2937] max-md:hidden">
        <span className="text-[12px] text-[#7c8799]">风险</span>
        <div className={cn('mt-1 font-semibold', item.failed ? 'text-red-600' : 'text-[#111827]')}>{item.failed}</div>
      </div>
      <div className="flex justify-end max-md:hidden">
        <Sparkline tone={tone} />
      </div>
      <ChevronRight className="hidden h-4 w-4 text-[#98a2b3] max-md:block" />
    </button>
  );
}

function RoutineRow({
  item,
  onClick,
}: {
  item: RoutineItem;
  onClick?: () => void;
}) {
  const dotTone = item.status === 'done' ? 'success' : item.status === 'attention' ? 'warning' : 'neutral';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-[#f8fbff]"
    >
      <WorkspaceStatusDot tone={dotTone} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-[#1f2937]">{item.label}</div>
        <div className="mt-0.5 truncate text-[12px] text-[#7c8799]">{item.meta}</div>
      </div>
      {item.done ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : item.status === 'attention' ? (
        <ShieldAlert className="h-4 w-4 text-amber-600" />
      ) : (
        <ChevronRight className="h-4 w-4 text-[#98a2b3]" />
      )}
    </button>
  );
}

function HealthRow({
  label,
  value,
  width,
  tone,
}: {
  label: string;
  value: ReactNode;
  width: number;
  tone: 'success' | 'info' | 'warning' | 'danger';
}) {
  const barClass = {
    success: 'bg-emerald-500',
    info: 'bg-blue-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
  }[tone];

  return (
    <div className="grid grid-cols-[1fr_auto_84px] items-center gap-3 text-[12px]">
      <span className="text-[#566176]">{label}</span>
      <span className="font-medium text-[#111827]">{value}</span>
      <div className="h-5 overflow-hidden rounded-full bg-[#edf1f7]">
        <div className={cn('h-full rounded-full', barClass)} style={{ width: `${Math.max(8, Math.min(100, width))}%` }} />
      </div>
    </div>
  );
}

export default function CeoOfficeCockpit({
  locale,
  connected,
  activeId,
  activeTitle,
  steps,
  loading,
  isActive,
  isRunning,
  sendError,
  currentModel,
  models,
  skills,
  workflows,
  agenticMode,
  activeRuns,
  pendingApprovals,
  projects,
  workspaces,
  departments,
  configuredDepartmentCount,
  ceoHistory,
  ceoPriorityTasks,
  ceoRecentEvents,
  refreshSignal = 0,
  onCreateCeoConversation,
  onOpenConversationWorkbench,
  onOpenProjects,
  onOpenKnowledge,
  onNavigateToKnowledge,
  onOpenOps,
  onOpenImprovementProposal,
  onOpenSettings,
  onSelectConversation,
  onNavigateToProject,
  onSend,
  onCancel,
  onProceed,
  onRevert,
  onModelChange,
  onAgenticModeChange,
  onDepartmentSaved,
  onRefreshDashboard,
}: CeoOfficeCockpitProps) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [routine, setRoutine] = useState<CEORoutineSummaryFE | null>(null);
  const [managementOverview, setManagementOverview] = useState<ManagementOverviewFE | null>(null);
  const [operatingDay, setOperatingDay] = useState<CompanyOperatingDayFE | null>(null);
  const [growthProposals, setGrowthProposals] = useState<GrowthProposalFE[]>([]);
  const [loopPolicy, setLoopPolicy] = useState<CompanyLoopPolicyFE | null>(null);
  const [loopRuns, setLoopRuns] = useState<CompanyLoopRunFE[]>([]);
  const [loopDigests, setLoopDigests] = useState<CompanyLoopDigestFE[]>([]);
  const [improvementProposals, setImprovementProposals] = useState<SystemImprovementProposalFE[]>([]);
  const [runningLoopKind, setRunningLoopKind] = useState<CompanyLoopRunKindFE | null>(null);
  const [togglingLoopPolicy, setTogglingLoopPolicy] = useState(false);
  const [latestDigest, setLatestDigest] = useState<DailyDigestFE | null>(null);
  const [commandDraft, setCommandDraft] = useState('');
  const [pendingCommand, setPendingCommand] = useState('');
  const [showThreadWorkbench, setShowThreadWorkbench] = useState(false);
  const [showDeepWorkbench, setShowDeepWorkbench] = useState(false);
  const [showApprovalInbox, setShowApprovalInbox] = useState(false);
  const [selectedDepartmentUri, setSelectedDepartmentUri] = useState<string | null>(null);
  const [selectedAgendaItemId, setSelectedAgendaItemId] = useState<string | null>(null);
  const [clockNow, setClockNow] = useState<Date | null>(null);

  useEffect(() => {
    const updateClock = () => setClockNow(new Date());
    const hydrationTimer = window.setTimeout(updateClock, 0);
    const timer = window.setInterval(updateClock, 60_000);
    return () => {
      window.clearTimeout(hydrationTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    api.me()
      .then(nextUser => {
        if (!cancelled) setUser(nextUser);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

	    Promise.all([
	      api.ceoRoutine().catch(() => null),
	      api.managementOverview().catch(() => null),
	      api.companyOperatingDay({ limit: 12 }).catch(() => null),
	      api.companyGrowthProposals({ pageSize: 4 }).catch(() => ({ items: [] as GrowthProposalFE[] })),
	      api.companyLoopPolicies({ pageSize: 20 }).catch(() => ({ items: [] as CompanyLoopPolicyFE[] })),
	      api.companyLoopRuns({ pageSize: 4 }).catch(() => ({ items: [] as CompanyLoopRunFE[] })),
	      api.companyLoopDigests({ pageSize: 2 }).catch(() => ({ items: [] as CompanyLoopDigestFE[] })),
	      api.systemImprovementProposals({ pageSize: 4 }).catch(() => ({ items: [] as SystemImprovementProposalFE[] })),
	    ]).then(([nextRoutine, nextOverview, nextOperatingDay, nextGrowthProposals, nextLoopPolicies, nextLoopRuns, nextLoopDigests, nextImprovementProposals]) => {
	      if (cancelled) return;
	      setRoutine(nextRoutine as CEORoutineSummaryFE | null);
	      setManagementOverview(nextOverview as ManagementOverviewFE | null);
	      setOperatingDay(nextOperatingDay as CompanyOperatingDayFE | null);
	      setGrowthProposals((nextGrowthProposals as { items?: GrowthProposalFE[] } | null)?.items || []);
	      setLoopPolicy(
	        ((nextLoopPolicies as { items?: CompanyLoopPolicyFE[] } | null)?.items || [])
	          .find((policy) => policy.scope === 'organization' && !policy.scopeId) || null,
	      );
	      setLoopRuns((nextLoopRuns as { items?: CompanyLoopRunFE[] } | null)?.items || []);
	      setLoopDigests((nextLoopDigests as { items?: CompanyLoopDigestFE[] } | null)?.items || []);
	      setImprovementProposals((nextImprovementProposals as { items?: SystemImprovementProposalFE[] } | null)?.items || []);
	    });

    return () => {
      cancelled = true;
    };
  }, [projects.length, refreshSignal, workspaces.length]);

  const runCompanyLoopFromOffice = async (kind: CompanyLoopRunKindFE) => {
    setRunningLoopKind(kind);
    try {
      await api.runCompanyLoopNow({ kind });
      const [nextLoopRuns, nextLoopDigests] = await Promise.all([
        api.companyLoopRuns({ pageSize: 4 }).catch(() => ({ items: [] as CompanyLoopRunFE[] })),
        api.companyLoopDigests({ pageSize: 2 }).catch(() => ({ items: [] as CompanyLoopDigestFE[] })),
      ]);
      setLoopRuns(nextLoopRuns.items || []);
      setLoopDigests(nextLoopDigests.items || []);
    } catch {
      // Surface stays read-only; Ops contains detailed error state.
    } finally {
      setRunningLoopKind(null);
    }
  };

  const toggleCompanyLoopPolicy = async () => {
    if (!loopPolicy) return;
    setTogglingLoopPolicy(true);
    try {
      const response = await api.updateCompanyLoopPolicy(loopPolicy.id, {
        ...loopPolicy,
        enabled: !loopPolicy.enabled,
      });
      setLoopPolicy(response.policy);
    } catch {
      // Ops/Settings expose detailed policy errors; keep the cockpit compact.
    } finally {
      setTogglingLoopPolicy(false);
    }
  };

  const digestWorkspaceKey = useMemo(
    () => workspaces.map(workspace => workspace.uri).join('|'),
    [workspaces],
  );
  const digestWorkspaceUris = useMemo(
    () => digestWorkspaceKey ? digestWorkspaceKey.split('|') : [],
    [digestWorkspaceKey],
  );

  useEffect(() => {
    let cancelled = false;

    Promise.resolve().then(async () => {
      if (!digestWorkspaceUris.length) {
        if (!cancelled) setLatestDigest(null);
        return;
      }

      const digests = await Promise.all(digestWorkspaceUris.map(uri => api.getDailyDigest(uri).catch(() => null)));
      if (!cancelled) {
        setLatestDigest(pickLatestDailyDigest(digests));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [digestWorkspaceUris]);

  useEffect(() => {
    if (!activeId || !pendingCommand) return;

    const command = pendingCommand;
    const timer = window.setTimeout(() => {
      onSend(command);
      setCommandDraft('');
      setPendingCommand('');
      setShowThreadWorkbench(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeId, onSend, pendingCommand]);

  const displayName = getUserDisplayName(user);
  const companyName = getCompanyName(user);
  const todayLabel = clockNow
    ? new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(clockNow)
    : '';
  const greetingLabel = clockNow
    ? getGreeting(locale, clockNow)
    : locale === 'zh' ? '你好' : 'Hello';

  const activeProjectCount = useMemo(
    () => projects.filter(project => project.status === 'active').length,
    [projects],
  );
  const failedProjectCount = useMemo(
    () => projects.filter(project => project.status === 'failed').length,
    [projects],
  );
  const completedProjectCount = useMemo(
    () => projects.filter(project => project.status === 'completed').length,
    [projects],
  );
  const recentCompletedToday = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return projects.filter(project => (
      project.status === 'completed'
      && new Date(project.updatedAt).getTime() >= startOfToday
    )).length;
  }, [projects]);
  const departmentSetupValue = workspaces.length ? `${configuredDepartmentCount}/${workspaces.length}` : '0';
  const departmentSetupPercent = workspaces.length ? Math.round((configuredDepartmentCount / workspaces.length) * 100) : 0;
  const schedulerRuntime = managementOverview?.schedulerRuntime;
  const activeSchedulers = schedulerRuntime?.enabledJobCount ?? managementOverview?.activeSchedulers ?? routine?.activeSchedulers ?? 0;

  const projectAttentionItems = useMemo(
    () => [...projects]
      .filter(project => ['failed', 'paused', 'active'].includes(project.status))
      .sort((a, b) => {
        const priorityDiff = getProjectPriority(a) - getProjectPriority(b);
        if (priorityDiff) return priorityDiff;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, 5),
    [projects],
  );

  const decisionItems = useMemo<DecisionItem[]>(() => {
    const agendaItems = (operatingDay?.agenda || []).slice(0, 4).map((item) => ({
      id: `agenda-${item.id}`,
	      title: item.title,
	      source: item.recommendedAction === 'dispatch' ? '经营议程 · 可派发' : '经营议程',
	      eta: item.status === 'blocked' ? '需决策' : `${item.priority.toUpperCase()} · ${Math.round(item.score)}`,
	      detail: `${item.reason} · evidence ${item.evidenceRefs.length} · ${item.signalIds.length} signals`,
	      priority: (item.priority === 'p0' || item.priority === 'p1' ? '高' : item.priority === 'p2' ? '中' : '低') as DecisionItem['priority'],
      tone: item.status === 'blocked'
        ? 'danger' as Tone
        : item.priority === 'p0' || item.priority === 'p1'
          ? 'warning' as Tone
          : 'info' as Tone,
      icon: item.recommendedAction === 'dispatch'
        ? <Command className="h-4 w-4" />
        : <Bell className="h-4 w-4" />,
      onClick: () => {
        setSelectedAgendaItemId(item.id);
        if (item.recommendedAction === 'approve') {
          setShowApprovalInbox(value => !value);
          return;
        }
        if (item.recommendedAction === 'observe') {
          onOpenKnowledge();
          return;
        }
        onOpenProjects();
      },
    }));

    const taskItems = ceoPriorityTasks.slice(0, 3).map((task, index) => ({
      id: `task-${task.cascadeId}`,
      title: task.title,
      source: task.workspace || 'CEO 线程',
      eta: task.isActive ? '执行中' : `${task.stepCount} steps`,
      priority: (index === 0 && task.isActive ? '高' : '中') as DecisionItem['priority'],
      tone: task.isActive ? 'warning' as Tone : 'info' as Tone,
      icon: <Sparkles className="h-4 w-4" />,
      onClick: () => onSelectConversation(task.cascadeId, task.title, 'ceo'),
    }));

	    const projectItems = projectAttentionItems.map((project) => ({
      id: `project-${project.projectId}`,
      title: project.name,
      source: project.workspace || 'OPC',
      eta: formatRelativeTime(project.updatedAt, locale),
      priority: (project.status === 'failed' ? '高' : project.status === 'paused' ? '中' : '低') as DecisionItem['priority'],
      tone: getProjectTone(project.status),
      icon: project.status === 'failed' ? <ShieldAlert className="h-4 w-4" /> : <BriefcaseBusiness className="h-4 w-4" />,
      onClick: () => onNavigateToProject(project.projectId),
	    }));

	    const growthItems = growthProposals
	      .filter((proposal) => proposal.risk === 'high' && proposal.status !== 'published' && proposal.status !== 'observing' && proposal.status !== 'rejected')
	      .slice(0, 2)
	      .map((proposal) => ({
	        id: `growth-${proposal.id}`,
	        title: proposal.title,
	        source: `增长提案 · ${proposal.kind}`,
	        eta: proposal.status === 'approval-required' ? '需审批' : `${proposal.score} 分`,
	        priority: '高' as DecisionItem['priority'],
	        tone: 'warning' as Tone,
	        icon: <Sparkles className="h-4 w-4" />,
	        onClick: onOpenKnowledge,
	      }));

    const improvementItems = improvementProposals
      .filter((proposal) => (
        proposal.status === 'approval-required'
        || proposal.status === 'approved'
        || proposal.status === 'testing'
        || (
          proposal.exitEvidence?.mergeGate.status === 'ready-to-merge'
          && proposal.exitEvidence?.releaseGate?.status !== 'observing'
          && proposal.exitEvidence?.releaseGate?.status !== 'rolled-back'
        )
        || proposal.exitEvidence?.mergeGate.status === 'blocked'
      ))
      .slice(0, 3)
      .map((proposal) => ({
        id: `self-improvement-${proposal.id}`,
        title: proposal.title,
        source: '软件自迭代',
        eta: getImprovementDecisionLabel(proposal),
        detail: formatImprovementExecutionSummary(proposal),
        priority: getImprovementDecisionPriority(proposal),
        tone: getImprovementDecisionTone(proposal),
        icon: <PackageCheck className="h-4 w-4" />,
        onClick: () => {
          onOpenImprovementProposal(proposal.id);
        },
      }));

	    return [...agendaItems, ...improvementItems, ...growthItems, ...taskItems, ...projectItems].slice(0, 6);
	  }, [ceoPriorityTasks, growthProposals, improvementProposals, locale, onNavigateToProject, onOpenImprovementProposal, onOpenKnowledge, onOpenProjects, onSelectConversation, operatingDay, projectAttentionItems]);

  const departmentPulse = useMemo<DepartmentPulse[]>(
    () => workspaces.map((workspace) => {
      const department = departments.get(workspace.uri);
      const workspaceProjects = projects.filter(project => project.workspace === workspace.uri);
      const okrProgress = getDepartmentOkrProgress(department);
      const completed = workspaceProjects.filter(project => project.status === 'completed').length;
      const total = workspaceProjects.length;

      return {
        workspace,
        department,
        active: workspaceProjects.filter(project => project.status === 'active').length,
        completed,
        failed: workspaceProjects.filter(project => project.status === 'failed').length,
        total,
        progress: okrProgress ?? (total ? Math.round((completed / total) * 100) : 0),
      };
    }).sort((a, b) => {
      const leftPriority = a.failed * 10 + a.active;
      const rightPriority = b.failed * 10 + b.active;
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return a.workspace.name.localeCompare(b.workspace.name);
    }).slice(0, 4),
    [departments, projects, workspaces],
  );

  const routineItems = useMemo<RoutineItem[]>(() => {
    if (routine?.actions?.length) {
      return routine.actions.slice(0, 6).map((action) => ({
        id: action.id,
        label: action.label,
        meta: action.meta || action.type,
        done: action.status === 'done',
        status: action.status,
        priority: action.priority,
        action,
      }));
    }

    return [
      { id: 'overview', label: '经营日报快速浏览', meta: connected ? '实时在线' : '等待重连', done: connected, status: connected ? 'done' : 'attention', priority: connected ? 'low' : 'high' },
      { id: 'meeting', label: '研发例会', meta: activeRuns.length ? `${activeRuns.length} 个任务运行中` : '暂无运行任务', done: activeRuns.length === 0, status: activeRuns.length === 0 ? 'done' : 'pending', priority: activeRuns.length ? 'medium' : 'low' },
      { id: 'review', label: '产品评审会', meta: pendingApprovals ? `${pendingApprovals} 项待审批` : '无待审批', done: pendingApprovals === 0, status: pendingApprovals === 0 ? 'done' : 'attention', priority: pendingApprovals ? 'high' : 'low' },
      { id: 'risk', label: '关键项目风险复盘', meta: failedProjectCount ? `${failedProjectCount} 个风险项目` : '风险清零', done: failedProjectCount === 0, status: failedProjectCount === 0 ? 'done' : 'attention', priority: failedProjectCount ? 'high' : 'low' },
      { id: 'digest', label: '部门日报生成', meta: '每天 20:00 北京时间', done: !!latestDigest, status: latestDigest ? 'done' : 'pending', priority: latestDigest ? 'low' : 'medium' },
    ];
  }, [activeRuns.length, connected, failedProjectCount, latestDigest, pendingApprovals, routine]);

  const handleRoutineAction = (item: RoutineItem) => {
    const action = item.action;
    const target = action?.target;
    if (!target) return;

    if (target.kind === 'approvals') {
      setShowApprovalInbox(value => !value);
      return;
    }
    if (target.kind === 'project') {
      onNavigateToProject(target.projectId || null);
      return;
    }
    if (target.kind === 'scheduler') {
      onOpenOps();
      return;
    }
    if (target.kind === 'knowledge') {
      onNavigateToKnowledge(target.knowledgeId || null, item.meta);
      return;
    }
    if (target.kind === 'ceo-focus') {
      setShowDeepWorkbench(true);
    }
  };

  const selectedDepartmentWorkspace = selectedDepartmentUri
    ? workspaces.find(workspace => workspace.uri === selectedDepartmentUri) || null
    : null;
  const selectedDepartmentConfig = selectedDepartmentUri
    ? departments.get(selectedDepartmentUri) || {
      name: selectedDepartmentWorkspace?.name || '',
      type: 'build' as const,
      skills: [],
      okr: null,
    }
    : null;
  const selectedDepartmentProjects = selectedDepartmentUri
    ? projects.filter((project) => project.workspace && (
      selectedDepartmentConfig
        ? getDepartmentBoundWorkspaceUris(
            selectedDepartmentConfig,
            selectedDepartmentUri,
            selectedDepartmentWorkspace?.name,
          ).includes(project.workspace)
        : project.workspace === selectedDepartmentUri
    ))
    : [];
  const selectedAgendaItem = useMemo<OperatingAgendaItemFE | null>(() => {
    if (!selectedAgendaItemId) return null;
    return operatingDay?.agenda.find((item) => item.id === selectedAgendaItemId) || null;
  }, [operatingDay, selectedAgendaItemId]);
  const selectedAgendaSignals = useMemo<OperatingSignalFE[]>(() => {
    if (!selectedAgendaItem) return [];
    const ids = new Set(selectedAgendaItem.signalIds);
    return (operatingDay?.activeSignals || []).filter((signal) => ids.has(signal.id));
  }, [operatingDay, selectedAgendaItem]);

  const handleCommandSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextCommand = commandDraft.trim();
    if (!nextCommand || loading) return;

    if (activeId) {
      onSend(nextCommand);
      setCommandDraft('');
      setShowThreadWorkbench(true);
      return;
    }

    setPendingCommand(nextCommand);
    setShowThreadWorkbench(true);
    void onCreateCeoConversation();
  };

  const apiHealthOnline = !!managementOverview || !!routine;
  const healthBase = apiHealthOnline ? 96 : 48;
  const realtimeHealthWidth = connected ? 96 : 42;
  const riskHealth = failedProjectCount ? Math.max(20, 88 - failedProjectCount * 8) : 99;
  const schedulerHealthTone = schedulerRuntime?.status === 'disabled' || schedulerRuntime?.status === 'stalled'
    ? 'warning'
    : schedulerRuntime?.dueNowCount
      ? 'info'
      : 'success';
  const schedulerHealthValue = schedulerRuntime
    ? schedulerRuntime.status === 'disabled'
      ? 'Disabled'
      : schedulerRuntime.status === 'stalled'
        ? 'Stalled'
        : schedulerRuntime.dueNowCount > 0
          ? `${schedulerRuntime.dueNowCount} due`
          : schedulerRuntime.status === 'idle'
            ? 'Idle'
            : 'Running'
    : 'Unknown';
  const schedulerHealthWidth = schedulerRuntime?.status === 'disabled' || schedulerRuntime?.status === 'stalled'
    ? 38
    : schedulerRuntime?.dueNowCount
      ? 72
      : 96;
  const attentionRoutineCount = routineItems.filter(item => item.status === 'attention').length;
  const pendingRoutineCount = routineItems.filter(item => item.status === 'pending').length;
  const routineSummaryLabel = attentionRoutineCount
    ? `${attentionRoutineCount} 项需处理`
    : pendingRoutineCount
      ? `${pendingRoutineCount} 项待确认`
      : '全部完成';

  return (
    <div className="flex h-full min-h-0 bg-[#f3f6fa] text-[#111827]">
      <CeoRail
        user={user}
        onOpenProjects={onOpenProjects}
        onOpenKnowledge={onOpenKnowledge}
        onOpenOps={onOpenOps}
        onOpenSettings={onOpenSettings}
      />

      <ScrollArea className="h-full min-w-0 flex-1">
        <div className="mx-auto grid min-h-full w-full max-w-[1360px] grid-cols-[minmax(0,1fr)_280px] gap-4 px-5 py-6 max-xl:grid-cols-1 md:px-8">
          <main className="min-w-0 space-y-4">
            <TopUtilityBar
              displayName={displayName}
              company={companyName}
              greeting={greetingLabel}
              todayLabel={todayLabel}
              pendingApprovals={pendingApprovals}
              onOpenConversationWorkbench={onOpenConversationWorkbench}
              onOpenKnowledge={onOpenKnowledge}
              onOpenApprovals={() => setShowApprovalInbox(value => !value)}
            />
            <MobileNav
              onOpenProjects={onOpenProjects}
              onOpenKnowledge={onOpenKnowledge}
              onOpenOps={onOpenOps}
              onOpenSettings={onOpenSettings}
            />

            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.38fr]">
              <MetricCard
                label="待审批"
                value={pendingApprovals}
                detail={pendingApprovals ? '待处理审批入口' : '暂无待审批'}
                tone={pendingApprovals ? 'warning' : 'success'}
                icon={<CheckCircle2 className="h-5 w-5" />}
              />
              <MetricCard
                label="风险项目"
                value={failedProjectCount}
                detail={`${activeProjectCount} 个活跃项目`}
                tone={failedProjectCount ? 'danger' : 'success'}
                icon={<ShieldAlert className="h-5 w-5" />}
              />
              <MetricCard
                label="活跃任务"
                value={activeRuns.length}
                detail={activeRuns.length ? '当前运行中' : '无运行任务'}
                tone={activeRuns.length ? 'info' : 'success'}
                icon={<Activity className="h-5 w-5" />}
              />
              <SplitMetricCard activeSchedulers={activeSchedulers} completedToday={recentCompletedToday} schedulerRuntime={schedulerRuntime} />
            </section>

            <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
              <div className="space-y-4 p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <SectionHeader title="CEO 指令中心" />
                  <span className="rounded-full bg-[#f2f5fa] px-3 py-1 text-[12px] text-[#6b768a]">
                    即时 / 定时 / 咨询
                  </span>
                </div>

                <form onSubmit={handleCommandSubmit} className="relative">
                  <input
                    value={commandDraft}
                    onChange={(event) => setCommandDraft(event.target.value)}
                    placeholder="向公司下达指令，或询问任何业务问题..."
                    className="h-[58px] w-full rounded-[12px] border border-[#cfd8e8] bg-white px-4 pr-14 text-[15px] text-[#111827] outline-none transition-colors placeholder:text-[#98a2b3] focus:border-[#2f6df6] focus:ring-4 focus:ring-[#2f6df6]/10"
                  />
                  <button
                    type="submit"
                    disabled={loading || !commandDraft.trim()}
                    className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[10px] bg-[#2f6df6] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="发送指令"
                  >
                    <SendHorizontal className="h-4 w-4" />
                  </button>
                </form>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <CommandShortcut
                    icon={<ZapIcon />}
                    title="即时任务"
                    subtitle="立即执行的指令"
                    onClick={() => {
                      setShowThreadWorkbench(true);
                      void onCreateCeoConversation();
                    }}
                  />
                  <CommandShortcut icon={<CalendarClock className="h-4 w-4" />} title="定时任务" subtitle="按计划执行的任务" onClick={onOpenOps} />
                  <CommandShortcut icon={<MessageSquare className="h-4 w-4" />} title="询问 / 咨询" subtitle="获取信息或建议" onClick={() => setShowThreadWorkbench(true)} />
                  <CommandShortcut icon={<Layers3 className="h-4 w-4" />} title="多智能体协同" subtitle="跨部门协同任务" onClick={onOpenProjects} />
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#7c8799]">
                  <span>示例指令：</span>
                  {['生成本周部门 OKR 进度报告', '评估项目风险', '每天 20:00 生成 AI 日报', '分析 Q3 营收增长策略'].map(example => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setCommandDraft(example)}
                      className="rounded-full bg-[#f2f5fa] px-3 py-1.5 text-[#566176] hover:bg-[#eaf2ff] hover:text-[#1768d9]"
                    >
                      {example}
                    </button>
                  ))}
                  {activeId ? (
                    <button
                      type="button"
                      onClick={() => setShowThreadWorkbench(value => !value)}
                      className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[#1768d9] hover:bg-[#eaf2ff]"
                    >
                      {showThreadWorkbench ? '收起线程' : '查看线程'}
                      <ChevronRight className={cn('h-4 w-4 transition-transform', showThreadWorkbench && 'rotate-90')} />
                    </button>
                  ) : null}
                </div>

                {sendError ? (
                  <div className="rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                    {sendError}
                  </div>
                ) : null}
              </div>

              {showThreadWorkbench ? (
                <div className="border-t border-[#edf1f7] bg-[#fbfcff] p-4">
                  {activeId ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[#1f2937]">{activeTitle || 'CEO Office'}</div>
                          <div className="text-[12px] text-[#7c8799]">
                            {currentModel === 'MODEL_AUTO' ? '自动模型' : currentModel} · {steps?.steps?.length || 0} steps
                          </div>
                        </div>
                        <Button variant="outline" size="sm" onClick={onOpenConversationWorkbench} className="rounded-full border-[#dfe5ee] bg-white">
                          打开完整线程
                        </Button>
                      </div>
                      <div className="max-h-[300px] overflow-y-auto rounded-[12px] border border-[#e3e8f2] bg-white">
                        <Chat
                          steps={steps}
                          loading={loading}
                          currentModel={currentModel}
                          onProceed={onProceed}
                          onRevert={onRevert}
                          isActive={isActive}
                        />
                      </div>
                      <ChatInput
                        activeId={activeId}
                        onSend={onSend}
                        onCancel={onCancel}
                        disabled={loading}
                        isRunning={isRunning}
                        connected={connected}
                        models={models}
                        currentModel={currentModel}
                        onModelChange={onModelChange}
                        skills={skills}
                        workflows={workflows}
                        agenticMode={agenticMode}
                        onAgenticModeChange={onAgenticModeChange}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={onCreateCeoConversation}
                      className="flex min-h-24 w-full flex-col items-center justify-center rounded-[12px] border border-dashed border-[#cfd8e8] bg-white text-sm text-[#566176] hover:border-[#9fb2d2]"
                    >
                      <Command className="mb-2 h-5 w-5 text-[#1768d9]" />
                      创建 CEO 线程后开始执行指令
                    </button>
                  )}
                </div>
              ) : null}
            </WorkspaceSurface>

            <div className="grid gap-4 xl:grid-cols-[0.62fr_1fr]">
              <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
                <div className="border-b border-[#edf1f7] px-5 py-4">
                  <SectionHeader
                    title={(
                      <span className="flex items-center gap-2">
                        决策队列
                        <span className="rounded-full bg-[#edf2fa] px-2 py-0.5 text-[12px] text-[#566176]">{decisionItems.length}</span>
                      </span>
                    )}
                  />
                </div>
                <div>
                  {decisionItems.length ? decisionItems.map(item => (
                    <DecisionRow key={item.id} item={item} />
                  )) : (
                    <div className="px-5 py-8 text-center text-sm text-[#7c8799]">当前没有排队中的高优决策。</div>
                  )}
                </div>
                {selectedAgendaItem ? (
                  <div className="border-t border-[#edf1f7] bg-[#fbfcff] px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-[#111827]">议程详情</div>
                        <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#566176]">{selectedAgendaItem.reason}</div>
                      </div>
                      <button type="button" onClick={() => setSelectedAgendaItemId(null)} className="rounded-full px-2 py-1 text-[11px] text-[#7c8799] hover:bg-white">
                        收起
                      </button>
                    </div>
                    <div className="mt-3 grid gap-2 text-[11px] text-[#566176] sm:grid-cols-2">
                      <div className="rounded-[10px] border border-[#e3e8f2] bg-white px-3 py-2">
                        <div className="font-semibold text-[#1f2937]">Linked refs</div>
                        <div className="mt-1 space-y-1">
                          {selectedAgendaItem.dispatchedRunId ? <div>run: <span className="font-mono">{selectedAgendaItem.dispatchedRunId}</span></div> : null}
                          {selectedAgendaItem.suggestedWorkflowRef ? <div>workflow: <span className="font-mono">{selectedAgendaItem.suggestedWorkflowRef}</span></div> : null}
                          {selectedAgendaItem.budgetDecisionId ? <div>budget: <span className="font-mono">{selectedAgendaItem.budgetDecisionId}</span></div> : null}
                          {!selectedAgendaItem.dispatchedRunId && !selectedAgendaItem.suggestedWorkflowRef && !selectedAgendaItem.budgetDecisionId ? <div>暂无执行关联</div> : null}
                        </div>
                      </div>
                      <div className="rounded-[10px] border border-[#e3e8f2] bg-white px-3 py-2">
                        <div className="font-semibold text-[#1f2937]">Evidence</div>
                        <div className="mt-1 space-y-1">
                          {selectedAgendaItem.evidenceRefs.slice(0, 3).map((ref) => (
                            <div key={ref.id} className="truncate">{ref.type}: {ref.label}</div>
                          ))}
                          {selectedAgendaItem.evidenceRefs.length === 0 ? <div>暂无 evidence</div> : null}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2">
                      {selectedAgendaSignals.length ? selectedAgendaSignals.map((signal) => (
                        <div key={signal.id} className="rounded-[10px] border border-[#e3e8f2] bg-white px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[12px] font-semibold text-[#1f2937]">{signal.title}</span>
                            <span className="shrink-0 rounded-full bg-[#eef4ff] px-2 py-0.5 text-[10px] text-[#1768d9]">{signal.source}/{signal.kind}</span>
                          </div>
                          <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-[#566176]">{signal.summary}</div>
                          <div className="mt-1 truncate font-mono text-[10px] text-[#98a2b3]">{signal.dedupeKey}</div>
                        </div>
                      )) : (
                        <div className="rounded-[10px] border border-dashed border-[#dfe5ee] bg-white px-3 py-3 text-center text-[11px] text-[#7c8799]">
                          当前 operating-day payload 未包含对应 signal 详情。
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="border-t border-[#edf1f7] px-5 py-3 text-center">
                  <button type="button" onClick={onOpenProjects} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#1768d9]">
                    查看全部决策
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </WorkspaceSurface>

              <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
                <div className="flex items-center justify-between gap-3 border-b border-[#edf1f7] px-5 py-4">
                  <SectionHeader title="部门 / 项目脉搏" />
                  <div className="flex rounded-[10px] bg-[#f2f5fa] p-1 text-[12px] font-medium">
                    <button type="button" onClick={() => setShowDeepWorkbench(true)} className="rounded-[8px] bg-white px-3 py-1.5 text-[#1768d9] shadow-sm">部门详情</button>
                    <button type="button" onClick={onOpenProjects} className="rounded-[8px] px-3 py-1.5 text-[#566176]">项目看板</button>
                  </div>
                </div>
                <div>
                  {departmentPulse.length ? departmentPulse.map(item => (
                    <DepartmentRow key={item.workspace.uri} item={item} onOpenDepartment={setSelectedDepartmentUri} />
                  )) : (
                    <div className="px-5 py-8 text-center text-sm text-[#7c8799]">暂无部门数据。</div>
                  )}
                </div>
                <div className="border-t border-[#edf1f7] px-5 py-3 text-center">
                  <button type="button" onClick={onOpenProjects} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#1768d9]">
                    查看全部部门 / 项目
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </WorkspaceSurface>
            </div>

            <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
              <button
                type="button"
                onClick={() => setShowDeepWorkbench(value => !value)}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[#f8fbff]"
              >
                <div>
                  <div className="text-[15px] font-semibold text-[#111827]">工作台</div>
                  <div className="mt-1 text-[12px] text-[#7c8799]">Projects / Knowledge / Ops / Settings</div>
                </div>
                <ChevronRight className={cn('h-5 w-5 text-[#98a2b3] transition-transform', showDeepWorkbench && 'rotate-90')} />
              </button>
              {showDeepWorkbench ? (
                <div className="space-y-4 border-t border-[#edf1f7] p-5">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: 'Projects', caption: '项目工作台', icon: <BriefcaseBusiness className="h-4 w-4" />, onClick: onOpenProjects },
                      { label: 'Knowledge', caption: '知识库', icon: <BookOpen className="h-4 w-4" />, onClick: onOpenKnowledge },
                      { label: 'Ops', caption: '运维中心', icon: <Radio className="h-4 w-4" />, onClick: () => onOpenOps() },
                      { label: 'Settings', caption: '配置中心', icon: <Settings2 className="h-4 w-4" />, onClick: onOpenSettings },
                    ].map(item => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={item.onClick}
                        className="flex items-center gap-3 rounded-[12px] border border-[#e3e8f2] bg-[#fbfcff] px-3 py-3 text-left hover:bg-white"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-[#eaf2ff] text-[#1768d9]">{item.icon}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[#1f2937]">{item.label}</span>
                          <span className="block truncate text-[12px] text-[#7c8799]">{item.caption}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <CEODashboard
                    workspaces={workspaces}
                    projects={projects}
                    departments={departments}
                    onSelectDepartment={setSelectedDepartmentUri}
                    onDepartmentSaved={onDepartmentSaved}
                    onRefresh={onRefreshDashboard}
                    onNavigateToProject={onNavigateToProject}
                  />
                </div>
              ) : null}
            </WorkspaceSurface>
          </main>

          <aside className="space-y-4">
            <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
              <div className="flex items-center justify-between border-b border-[#edf1f7] px-4 py-4">
                <SectionHeader title="今日关注" />
                <span className="text-[12px] text-[#7c8799]">{routineSummaryLabel}</span>
              </div>
              <div className="p-2">
                {routineItems.map(item => (
                  <RoutineRow key={item.id} item={item} onClick={() => handleRoutineAction(item)} />
                ))}
              </div>
              {showApprovalInbox ? (
                <div className="border-t border-[#edf1f7] bg-[#fbfcff] p-3">
                  <ApprovalPanel refreshInterval={15_000} />
                </div>
              ) : null}
            </WorkspaceSurface>

            <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
              <div className="flex items-center justify-between border-b border-[#edf1f7] px-4 py-4">
                <SectionHeader title="最新部门日报" />
                <button type="button" onClick={onOpenKnowledge} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#1768d9]">
                  更多
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              {latestDigest ? (
                <button type="button" onClick={() => setSelectedDepartmentUri(latestDigest.workspaceUri)} className="w-full p-4 text-left hover:bg-[#f8fbff]">
                  <div className="flex gap-3">
                    <div className="flex h-[92px] w-[78px] shrink-0 flex-col justify-center rounded-[10px] border border-[#d7e4f6] bg-[#edf6ff] text-center">
                      <div className="text-[18px] font-semibold text-[#1768d9]">日报</div>
                      <div className="mt-1 text-[12px] text-[#566176]">部门</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[#111827]">{latestDigest.date} 日报</div>
                      <div className="mt-1 text-[12px] text-[#7c8799]">{latestDigest.departmentName || '部门日报'}</div>
                      <div className="mt-2 line-clamp-3 text-[12px] leading-5 text-[#566176]">{latestDigest.summary}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#7c8799]">
                        <span>{latestDigest.tasksCompleted.length} 完成</span>
                        <span>{latestDigest.tasksInProgress.length} 进行中</span>
                        <span>{latestDigest.blockers.length} 阻塞</span>
                      </div>
                    </div>
                  </div>
                </button>
              ) : (
                <div className="p-4 text-sm leading-6 text-[#7c8799]">暂无部门日报。</div>
              )}
	            </WorkspaceSurface>

	            <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
	              <div className="flex items-center justify-between border-b border-[#edf1f7] px-4 py-4">
	                <SectionHeader title="增长提案" />
	                <button type="button" onClick={onOpenKnowledge} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#1768d9]">
	                  Knowledge
	                  <ChevronRight className="h-4 w-4" />
	                </button>
	              </div>
	              {growthProposals.length ? (
	                <div className="divide-y divide-[#edf1f7]">
	                  {growthProposals.slice(0, 3).map((proposal) => (
	                    <button key={proposal.id} type="button" onClick={onOpenKnowledge} className="w-full px-4 py-3 text-left hover:bg-[#f8fbff]">
	                      <div className="flex items-start justify-between gap-3">
	                        <div className="min-w-0">
	                          <div className="truncate text-sm font-semibold text-[#111827]">{proposal.title}</div>
	                          <div className="mt-1 text-[12px] text-[#7c8799]">{proposal.kind} · {proposal.status}</div>
	                        </div>
	                        <span className={cn(
	                          'rounded-full px-2 py-0.5 text-[11px] font-semibold',
	                          proposal.risk === 'high'
	                            ? 'bg-red-50 text-red-600'
	                            : proposal.risk === 'medium'
	                              ? 'bg-amber-50 text-amber-700'
	                              : 'bg-emerald-50 text-emerald-700',
	                        )}>
	                          {proposal.score}
	                        </span>
	                      </div>
	                    </button>
	                  ))}
	                </div>
	              ) : (
	                <div className="p-4 text-sm leading-6 text-[#7c8799]">暂无增长提案。</div>
	              )}
	            </WorkspaceSurface>

	            <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
	              <div className="flex items-center justify-between border-b border-[#edf1f7] px-4 py-4">
	                <SectionHeader title="公司循环" />
		                <button type="button" onClick={() => onOpenOps()} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#1768d9]">
	                  Ops
	                  <ChevronRight className="h-4 w-4" />
	                </button>
	              </div>
	              <div className="space-y-3 p-4">
	                <div className="grid grid-cols-3 gap-2">
	                  <WorkspaceMiniMetric label="状态" value={loopRuns[0]?.status || 'idle'} tone={loopRuns[0]?.status === 'failed' ? 'danger' : loopRuns[0]?.status === 'completed' ? 'success' : 'neutral'} />
	                  <WorkspaceMiniMetric label="选中" value={String(loopRuns[0]?.selectedAgendaIds.length || 0)} tone="info" />
	                  <WorkspaceMiniMetric label="派发" value={String(loopRuns[0]?.dispatchedRunIds.length || 0)} tone="accent" />
	                </div>
	                {loopDigests[0] ? (
		                  <button type="button" onClick={() => onOpenOps()} className="w-full rounded-xl border border-[#edf1f7] bg-[#fbfcff] p-3 text-left hover:bg-[#f8fbff]">
	                    <div className="text-[12px] font-semibold text-[#111827]">{loopDigests[0].title}</div>
	                    <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#6b768a]">{loopDigests[0].operatingSummary}</div>
	                  </button>
	                ) : null}
	                <div className="grid grid-cols-3 gap-2">
	                  <Button
	                    type="button"
	                    size="sm"
	                    variant="outline"
	                    disabled={Boolean(runningLoopKind)}
	                    onClick={() => void runCompanyLoopFromOffice('daily-review')}
	                    className="h-8 rounded-xl text-[12px]"
	                  >
	                    <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
	                    {runningLoopKind === 'daily-review' ? '运行中' : 'Daily'}
	                  </Button>
	                  <Button
	                    type="button"
	                    size="sm"
	                    variant="outline"
	                    disabled={Boolean(runningLoopKind)}
	                    onClick={() => void runCompanyLoopFromOffice('growth-review')}
	                    className="h-8 rounded-xl text-[12px]"
	                  >
	                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
	                    {runningLoopKind === 'growth-review' ? '运行中' : 'Growth'}
	                  </Button>
	                  <Button
	                    type="button"
	                    size="sm"
	                    variant="outline"
	                    disabled={!loopPolicy || togglingLoopPolicy}
	                    onClick={() => void toggleCompanyLoopPolicy()}
	                    className="h-8 rounded-xl text-[12px]"
	                  >
	                    {loopPolicy?.enabled ? (
	                      <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
	                    ) : (
	                      <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
	                    )}
	                    {togglingLoopPolicy ? '切换中' : loopPolicy?.enabled ? 'Pause' : 'Resume'}
	                  </Button>
	                </div>
	                {improvementProposals.length ? (
	                  <div className="space-y-2">
	                    <div className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800">
	                      <span>系统改进</span>
	                      <span className="font-semibold">{improvementProposals.filter(item => item.status === 'approval-required').length} approval / {improvementProposals.length} total</span>
	                    </div>
	                    <div className="space-y-2">
	                      {improvementProposals.slice(0, 2).map((proposal) => (
	                        <button
	                          key={proposal.id}
	                          type="button"
	                          onClick={() => onOpenImprovementProposal(proposal.id)}
	                          className="w-full rounded-xl border border-[#edf1f7] bg-[#fbfcff] p-3 text-left hover:bg-[#f8fbff]"
	                        >
	                          <div className="flex items-start justify-between gap-3">
	                            <div className="min-w-0">
	                              <div className="truncate text-[12px] font-semibold text-[#111827]">{proposal.title}</div>
	                              <div className="mt-1 text-[12px] text-[#6b768a]">{formatImprovementExecutionSummary(proposal)}</div>
	                              {proposal.exitEvidence?.mergeGate.reasons?.[0] ? (
	                                <div className="mt-1 truncate text-[11px] text-[#8a94a6]">{proposal.exitEvidence.mergeGate.reasons[0]}</div>
	                              ) : null}
	                            </div>
	                            <span className={cn(
	                              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
	                              proposal.exitEvidence?.mergeGate.status === 'ready-to-merge'
	                                ? 'bg-emerald-50 text-emerald-700'
	                                : proposal.exitEvidence?.mergeGate.status === 'blocked'
	                                  ? 'bg-red-50 text-red-600'
	                                  : 'bg-amber-50 text-amber-700',
	                            )}>
	                              {formatImprovementMergeGateLabel(proposal)}
	                            </span>
	                          </div>
	                        </button>
	                      ))}
	                    </div>
	                  </div>
	                ) : null}
	              </div>
	            </WorkspaceSurface>

	            <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
	              <div className="flex items-center justify-between border-b border-[#edf1f7] px-4 py-4">
	                <SectionHeader title="系统状态" />
                <button type="button" onClick={onRefreshDashboard} className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600">
                  {schedulerRuntime?.status === 'disabled' || schedulerRuntime?.status === 'stalled'
                    ? '调度需关注'
                    : !apiHealthOnline
                      ? '读取中'
                      : failedProjectCount
                        ? '存在风险'
                        : '全部正常'}
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-3 p-4">
                <HealthRow label="API 服务" value={apiHealthOnline ? '正常' : '读取中'} tone={apiHealthOnline ? 'success' : 'warning'} width={healthBase} />
                <HealthRow label="实时通道" value={connected ? '已连接' : '未连接'} tone={connected ? 'success' : 'warning'} width={realtimeHealthWidth} />
                <HealthRow label="定时任务调度" value={schedulerHealthValue} tone={schedulerHealthTone} width={schedulerHealthWidth} />
                <HealthRow label="知识库索引健康度" value={`${Math.max(70, departmentSetupPercent || 70)}%`} tone={departmentSetupPercent >= 80 ? 'success' : 'warning'} width={Math.max(70, departmentSetupPercent || 70)} />
                <HealthRow label="风险健康" value={failedProjectCount ? `${failedProjectCount} risk` : 'Clear'} tone={failedProjectCount ? 'danger' : 'success'} width={riskHealth} />
              </div>
            </WorkspaceSurface>

            <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
              <div className="border-b border-[#edf1f7] px-4 py-4">
                <SectionHeader title="快速跳转" />
              </div>
              <div className="grid grid-cols-3 gap-2 p-3">
                {[
                  { label: 'Projects', detail: '项目看板', onClick: onOpenProjects },
                  { label: 'Knowledge', detail: '知识中心', onClick: onOpenKnowledge },
	                  { label: 'Ops', detail: '运维中心', onClick: () => onOpenOps() },
                ].map(item => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={item.onClick}
                    className="rounded-[10px] border border-[#e3e8f2] bg-[#fbfcff] px-2 py-3 text-left hover:bg-white"
                  >
                    <div className="truncate text-[12px] font-semibold text-[#1f2937]">{item.label}</div>
                    <div className="mt-1 truncate text-[11px] text-[#7c8799]">{item.detail}</div>
                  </button>
                ))}
              </div>
            </WorkspaceSurface>

            {ceoHistory.length ? (
              <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
                <div className="border-b border-[#edf1f7] px-4 py-4">
                  <SectionHeader title="最近线程" />
                </div>
                <div className="p-2">
                  {ceoHistory.slice(0, 3).map(conversation => (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => onSelectConversation(conversation.id, conversation.title || 'CEO Office', 'ceo')}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left hover:bg-[#f8fbff]',
                        activeId === conversation.id && 'bg-[#eaf2ff]',
                      )}
                    >
                      <MessageSquare className="h-4 w-4 shrink-0 text-[#1768d9]" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-[#1f2937]">{conversation.title || 'CEO Office'}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-[#7c8799]">
                          {conversation.steps} steps · {formatRelativeTime(new Date(conversation.mtime).toISOString(), locale)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </WorkspaceSurface>
            ) : null}

            {ceoRecentEvents.length ? (
              <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
                <div className="border-b border-[#edf1f7] px-4 py-4">
                  <SectionHeader title="最近信号" />
                </div>
                <div className="space-y-2 p-3">
                  {ceoRecentEvents.slice(0, 3).map((event, index) => (
                    <div key={`${event.timestamp}-${event.kind}-${event.message}-${index}`} className="rounded-[10px] bg-[#fbfcff] px-3 py-2">
                      <div className="truncate text-[12px] font-semibold text-[#1f2937]">{formatAuditKind(event.kind)}</div>
                      <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[#7c8799]">{event.message}</div>
                    </div>
                  ))}
                </div>
              </WorkspaceSurface>
            ) : null}

            <WorkspaceSurface className="rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
              <div className="grid grid-cols-2 gap-2">
                <WorkspaceMiniMetric label="Departments" value={departmentSetupValue} detail={`${departmentSetupPercent}% ready`} tone={departmentSetupPercent >= 100 ? 'success' : 'warning'} />
                <WorkspaceMiniMetric label="Projects" value={projects.length} detail={`${completedProjectCount} done`} tone="info" />
              </div>
            </WorkspaceSurface>
          </aside>
        </div>
      </ScrollArea>
      {selectedDepartmentWorkspace && selectedDepartmentConfig ? (
        <DepartmentDetailDrawer
          open={!!selectedDepartmentUri}
          onOpenChange={(open) => {
            if (!open) setSelectedDepartmentUri(null);
          }}
          workspace={selectedDepartmentWorkspace}
          config={selectedDepartmentConfig}
          projects={selectedDepartmentProjects}
          allWorkspaces={workspaces}
          onNavigateToProject={(projectId) => {
            setSelectedDepartmentUri(null);
            onNavigateToProject(projectId);
          }}
          onOpenSettings={() => {
            setSelectedDepartmentUri(null);
            onOpenSettings();
          }}
        />
      ) : null}
    </div>
  );
}

function ZapIcon() {
  return <Gauge className="h-4 w-4" />;
}
