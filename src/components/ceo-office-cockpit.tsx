'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Command,
  MessageSquare,
  PackageCheck,
  PanelRightClose,
  PanelRightOpen,
  PauseCircle,
  PlayCircle,
  Plus,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { api, type AuditEvent } from '@/lib/api';
import {
  buildImprovementCandidateViews,
  type ImprovementCandidateView,
} from '@/lib/ceo-office-improvement-pool';
import { getDepartmentBoundWorkspaceUris } from '@/lib/department-config';
import { formatRelativeTime } from '@/lib/i18n/formatting';
import { pickLatestDailyDigest } from '@/lib/ceo-office-home';
import type { Locale } from '@/lib/i18n';
import {
  getSystemImprovementQueueSummary,
  getSystemImprovementStageLabel,
  getSystemImprovementStageTone,
} from '@/lib/system-improvement-control-view';
import type {
  AgentRun,
  CompanyLoopDigestFE,
  CompanyLoopPolicyFE,
  CompanyLoopRunFE,
  CompanyLoopRunKindFE,
  CEORoutineSummaryFE,
  Conversation,
	  DailyDigestFE,
  DecisionItemViewFE,
  DecisionTargetFE,
	  DepartmentConfig,
	  ManagementOverviewFE,
  SystemImprovementProposalFE,
  SystemImprovementSignalFE,
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
  onOpenProjects: () => void;
  onOpenKnowledge: () => void;
  onNavigateToKnowledge: (knowledgeId: string | null, title: string | null) => void;
  onOpenOps: (options?: { proposalId?: string; query?: string }) => void;
  onOpenImprovementProposal: (proposalId: string | null) => void;
  onOpenSettings: () => void;
  onSelectConversation: (id: string, title: string, targetSection?: 'ceo' | 'conversations') => void;
  onNavigateToProject: (projectId: string | null) => void;
  onOpenDecisionTarget: (target: DecisionTargetFE) => void;
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
  return getSystemImprovementStageLabel(proposal.controlState?.stage);
}

function formatImprovementExecutionSummary(proposal: SystemImprovementProposalFE): string {
  return getSystemImprovementQueueSummary(proposal);
}

function getImprovementDecisionTone(proposal: SystemImprovementProposalFE): Tone {
  return getSystemImprovementStageTone(proposal.controlState?.stage);
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
  status: string;
  owner: string;
  nextAction: string;
  priority: '高' | '中' | '低';
  tone: Tone;
  icon: ReactNode;
  detail?: string;
  target: DecisionTargetFE;
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

type OfficeLoadSnapshot = {
  routine: CEORoutineSummaryFE | null;
  managementOverview: ManagementOverviewFE | null;
  loopPolicy: CompanyLoopPolicyFE | null;
  loopRuns: CompanyLoopRunFE[];
  loopDigests: CompanyLoopDigestFE[];
  improvementSignals: SystemImprovementSignalFE[];
  improvementProposals: SystemImprovementProposalFE[];
  decisionViews: DecisionItemViewFE[];
};

function ImprovementCandidateRow({
  candidate,
  locale,
  busy,
  onGenerate,
  onOpenProposal,
}: {
  candidate: ImprovementCandidateView;
  locale: Locale;
  busy: boolean;
  onGenerate: (signal: SystemImprovementSignalFE) => void;
  onOpenProposal: (proposalId: string) => void;
}) {
  const proposal = candidate.proposal;

  return (
    <div className="rounded-[12px] border border-[#e3e8f2] bg-[#fbfcff] px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[#111827]">{candidate.signal.title}</div>
          <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#6b768a]">{candidate.signal.summary}</div>
        </div>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
          toneClasses(candidate.proposalStatusTone as Tone),
        )}>
          {candidate.proposalStatusLabel}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full bg-[#eef4ff] px-2 py-0.5 text-[11px] font-semibold text-[#2563eb]">
          {candidate.sourceLabel}
        </span>
        <span className={cn(
          'rounded-full px-2 py-0.5 text-[11px] font-semibold',
          toneClasses(candidate.severityTone as Tone),
        )}>
          {candidate.severityLabel}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#7c8799]">
        <span>{candidate.areasLabel}</span>
        <span>{candidate.signal.evidenceRefs.length} 证据</span>
        <span>{formatRelativeTime(candidate.signal.createdAt, locale)}</span>
      </div>
      <div className="mt-3 flex justify-end">
        {proposal ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-[10px] border-[#dfe5ee] bg-white text-[12px]"
            onClick={() => onOpenProposal(proposal.id)}
          >
            打开提案
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-[10px] bg-[#2f6df6] px-3 text-[12px] text-white hover:bg-[#245ee8]"
            disabled={busy}
            onClick={() => onGenerate(candidate.signal)}
          >
            {busy ? '生成中' : '生成提案'}
          </Button>
        )}
      </div>
    </div>
  );
}

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

const WELCOME_SAMPLE_PROMPTS = [
  '今天公司哪些事最值得我关心？',
  '生成本周部门 OKR 进度报告',
  '评估当前活跃项目的风险，并给出建议',
  '帮我安排一个每天 20:00 自动汇总的日报任务',
];

function CockpitTopBar({
  displayName,
  companyName,
  greeting,
  todayLabel,
  pendingApprovals,
  failedProjectCount,
  activeRunsCount,
  activeId,
  activeTitle,
  ceoHistory,
  locale,
  threadMenuOpen,
  onToggleThreadMenu,
  onCloseThreadMenu,
  onSelectConversation,
  onCreateConversation,
  onOpenKnowledge,
  onOpenApprovals,
  opsOpen,
  onToggleDesktopOps,
  onToggleMobileOps,
}: {
  displayName: string;
  companyName: string;
  greeting: string;
  todayLabel: string;
  pendingApprovals: number;
  failedProjectCount: number;
  activeRunsCount: number;
  activeId: string | null;
  activeTitle: string;
  ceoHistory: Conversation[];
  locale: Locale;
  threadMenuOpen: boolean;
  onToggleThreadMenu: () => void;
  onCloseThreadMenu: () => void;
  onSelectConversation: (id: string, title: string, targetSection?: 'ceo' | 'conversations') => void;
  onCreateConversation: () => void | Promise<void>;
  onOpenKnowledge: () => void;
  onOpenApprovals: () => void;
  opsOpen: boolean;
  onToggleDesktopOps: () => void;
  onToggleMobileOps: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!threadMenuOpen) return;
    const handler = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        onCloseThreadMenu();
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [threadMenuOpen, onCloseThreadMenu]);

  const threadButtonLabel = activeId ? (activeTitle || 'CEO Office') : '新对话';

  return (
    <header className="flex shrink-0 flex-col gap-3 border-b border-[#e3e8f2] bg-white px-3 py-3 md:px-6 md:py-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold leading-tight tracking-[-0.02em] text-[#111827] md:text-[17px]">
              {displayName}，{greeting}
            </h1>
          </div>
          <div className="mt-0.5 truncate text-[12px] text-[#6b768a]">
            {companyName}{todayLabel ? ` · ${todayLabel}` : ''}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={onToggleThreadMenu}
              data-testid="cockpit-thread-toggle"
              className="inline-flex h-9 max-w-[200px] items-center gap-1.5 rounded-[10px] border border-[#dfe5ee] bg-white px-3 text-[13px] font-medium text-[#1f2937] hover:bg-[#f9fbff]"
              aria-haspopup="menu"
              aria-expanded={threadMenuOpen}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[#1768d9]" />
              <span className="truncate">{threadButtonLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#98a2b3]" />
            </button>
            {threadMenuOpen ? (
              <div
                role="menu"
                data-testid="cockpit-thread-menu"
                className="absolute right-0 top-[44px] z-30 w-[280px] overflow-hidden rounded-[12px] border border-[#dfe5ee] bg-white shadow-[0_18px_40px_rgba(28,44,73,0.16)]"
              >
                <button
                  type="button"
                  onClick={() => {
                    onCloseThreadMenu();
                    void onCreateConversation();
                  }}
                  className="flex w-full items-center gap-2 border-b border-[#edf1f7] px-3 py-2.5 text-left text-[13px] font-medium text-[#1768d9] hover:bg-[#f8fbff]"
                >
                  <Plus className="h-4 w-4" />
                  新建 CEO 线程
                </button>
                <div className="max-h-[320px] overflow-y-auto">
                  {ceoHistory.length ? ceoHistory.slice(0, 12).map(conversation => (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() => {
                        onCloseThreadMenu();
                        onSelectConversation(conversation.id, conversation.title || 'CEO Office', 'ceo');
                      }}
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-[#f8fbff]',
                        activeId === conversation.id && 'bg-[#eaf2ff]',
                      )}
                    >
                      <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#7c8799]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-[#1f2937]">{conversation.title || 'CEO Office'}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-[#7c8799]">
                          {conversation.steps} steps · {formatRelativeTime(new Date(conversation.mtime).toISOString(), locale)}
                        </span>
                      </span>
                    </button>
                  )) : (
                    <div className="px-3 py-4 text-center text-[12px] text-[#7c8799]">暂无历史线程</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onOpenKnowledge}
            className="hidden h-9 w-9 items-center justify-center rounded-full border border-[#dfe5ee] bg-white text-[#566176] hover:bg-[#f9fbff] md:inline-flex"
            aria-label="知识库"
            title="知识库"
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onOpenApprovals}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#dfe5ee] bg-white text-[#566176] hover:bg-[#f9fbff]"
            aria-label="待审批"
            title="待审批"
            data-testid="cockpit-approvals-button"
          >
            <Bell className="h-4 w-4" />
            {pendingApprovals ? (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#2f6df6] px-1 text-[10px] font-semibold text-white">
                {pendingApprovals > 9 ? '9+' : pendingApprovals}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={onToggleDesktopOps}
            data-testid="cockpit-ops-toggle"
            className="hidden h-9 items-center gap-1.5 rounded-[10px] border border-[#dfe5ee] bg-white px-3 text-[12px] font-medium text-[#1f2937] hover:bg-[#f9fbff] xl:inline-flex"
            aria-pressed={opsOpen}
          >
            {opsOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            <span>运营总览</span>
          </button>

          <button
            type="button"
            onClick={onToggleMobileOps}
            data-testid="cockpit-ops-mobile-toggle"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#dfe5ee] bg-white text-[#566176] hover:bg-[#f9fbff] xl:hidden"
            aria-label="运营总览"
            title="运营总览"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <StatusPill
          tone={pendingApprovals ? 'warning' : 'success'}
          icon={<CheckCircle2 className="h-3 w-3" />}
          label={pendingApprovals ? `${pendingApprovals} 待审批` : '审批已清'}
        />
        <StatusPill
          tone={failedProjectCount ? 'danger' : 'success'}
          icon={<ShieldAlert className="h-3 w-3" />}
          label={failedProjectCount ? `${failedProjectCount} 风险项目` : '风险清零'}
        />
        <StatusPill
          tone={activeRunsCount ? 'info' : 'neutral'}
          icon={<Activity className="h-3 w-3" />}
          label={activeRunsCount ? `${activeRunsCount} 活跃任务` : '无活跃任务'}
        />
      </div>
    </header>
  );
}

function StatusPill({
  tone,
  icon,
  label,
}: {
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  icon: ReactNode;
  label: string;
}) {
  const toneClass = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    danger: 'border-red-200 bg-red-50 text-red-700',
    info: 'border-sky-200 bg-sky-50 text-sky-700',
    neutral: 'border-[#e3e8f2] bg-[#f4f7fb] text-[#566176]',
  }[tone];

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium', toneClass)}>
      {icon}
      {label}
    </span>
  );
}

function CeoOfficeWelcome({
  displayName,
  companyName,
  greeting,
  draft,
  onDraftChange,
  onSubmit,
  loading,
  hasHistory,
  onOpenHistory,
  sendError,
}: {
  displayName: string;
  companyName: string;
  greeting: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (text: string) => void;
  loading: boolean;
  hasHistory: boolean;
  onOpenHistory: () => void;
  sendError: string | null;
}) {
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(draft);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="ceo-office-welcome">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10 md:px-8">
        <div className="w-full max-w-[640px] text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-[18px] border border-[#dfe5ee] bg-white text-[#1768d9] shadow-[0_18px_48px_rgba(23,104,217,0.15)]">
            <Command className="h-6 w-6" />
          </div>
          <h2 className="text-[clamp(1.4rem,2.2vw,1.85rem)] font-semibold tracking-[-0.04em] text-[#111827]">
            {displayName}，{greeting}
          </h2>
          <p className="mx-auto mt-2 max-w-[480px] text-[13px] leading-6 text-[#6b768a]">
            欢迎回到 {companyName} 的持续经营对话台。直接发送一条消息，即可开始新的 CEO 线程；
            历史线程会保存在右上角的「线程」菜单里。
          </p>

          <form onSubmit={handleSubmit} className="relative mt-8">
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onSubmit(draft);
                }
              }}
              placeholder='向公司发起第一条对话，例如："今天公司有哪些异常？"'
              rows={3}
              data-testid="welcome-input"
              className="w-full resize-none rounded-[14px] border border-[#cfd8e8] bg-white px-4 py-3 pr-14 text-[14px] leading-6 text-[#111827] shadow-[0_10px_28px_rgba(31,41,55,0.05)] outline-none transition-colors placeholder:text-[#98a2b3] focus:border-[#2f6df6] focus:ring-4 focus:ring-[#2f6df6]/10"
            />
            <button
              type="submit"
              disabled={loading || !draft.trim()}
              data-testid="welcome-submit"
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#2f6df6] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="发送"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </form>

          {sendError ? (
            <div className="mt-3 rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-left text-[13px] text-red-700">
              {sendError}
            </div>
          ) : null}

          <div className="mt-8 text-left">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#98a2b3]">试试问</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {WELCOME_SAMPLE_PROMPTS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => onDraftChange(sample)}
                  data-testid="welcome-sample"
                  className="flex items-center gap-2 rounded-[12px] border border-[#e3e8f2] bg-white px-3 py-2.5 text-left text-[13px] text-[#1f2937] transition-colors hover:border-[#bfd1f5] hover:bg-[#f8fbff]"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#1768d9]" />
                  <span className="line-clamp-2">{sample}</span>
                </button>
              ))}
            </div>
            {hasHistory ? (
              <button
                type="button"
                onClick={onOpenHistory}
                className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-[#1768d9] hover:underline"
              >
                查看历史线程
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
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

function DecisionRow({ item, onOpen }: { item: DecisionItem; onOpen: (target: DecisionTargetFE) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.target)}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#edf1f7] px-3 py-3 text-left last:border-b-0 hover:bg-[#f8fbff]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border', toneClasses(item.tone))}>
          {item.icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#1f2937]">{item.title}</div>
          <div className="mt-0.5 truncate text-[12px] text-[#7c8799]">{item.source}</div>
          {item.detail ? <div className="mt-1 line-clamp-1 text-[11px] text-[#98a2b3]">{item.detail}</div> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="rounded-md bg-[#edf2fa] px-2 py-1 text-[11px] font-semibold text-[#566176]">{item.status}</span>
        <span className="rounded-md bg-[#f5f7fb] px-2 py-1 text-[11px] font-medium text-[#677489]">{item.owner}</span>
        <span className="rounded-md bg-[#f5f7fb] px-2 py-1 text-[11px] font-medium text-[#677489]">{item.nextAction}</span>
        <span className={cn(
          'rounded-md px-2 py-1 text-[11px] font-semibold',
          item.priority === '高' ? 'bg-red-50 text-red-600' : item.priority === '中' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-600',
        )}
        >
          {item.priority}
        </span>
      </div>
    </button>
  );
}

function formatDecisionOwner(owner: DecisionItemViewFE['currentOwner']): string {
  if (owner === 'ceo') return 'CEO';
  if (owner === 'ops') return 'Ops';
  if (owner === 'ai') return 'AI';
  return '无';
}

function formatDecisionAction(action: DecisionItemViewFE['nextAction']): string {
  switch (action) {
    case 'approve-entry':
      return '批准准入';
    case 'approve-exit':
      return '批准准出';
    case 'approve-stage-gate':
      return '批准阶段';
    default:
      return action;
  }
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
  ceoRecentEvents,
  refreshSignal = 0,
  onCreateCeoConversation,
  onOpenProjects,
  onOpenKnowledge,
  onNavigateToKnowledge,
  onOpenOps,
  onOpenImprovementProposal,
  onOpenSettings,
  onSelectConversation,
  onNavigateToProject,
  onOpenDecisionTarget,
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
  const [decisionViews, setDecisionViews] = useState<DecisionItemViewFE[]>([]);
  const [loopPolicy, setLoopPolicy] = useState<CompanyLoopPolicyFE | null>(null);
  const [loopRuns, setLoopRuns] = useState<CompanyLoopRunFE[]>([]);
  const [loopDigests, setLoopDigests] = useState<CompanyLoopDigestFE[]>([]);
  const [improvementSignals, setImprovementSignals] = useState<SystemImprovementSignalFE[]>([]);
  const [improvementProposals, setImprovementProposals] = useState<SystemImprovementProposalFE[]>([]);
  const [runningLoopKind, setRunningLoopKind] = useState<CompanyLoopRunKindFE | null>(null);
  const [togglingLoopPolicy, setTogglingLoopPolicy] = useState(false);
  const [latestDigest, setLatestDigest] = useState<DailyDigestFE | null>(null);
  const [commandDraft, setCommandDraft] = useState('');
  const [pendingCommand, setPendingCommand] = useState('');
  const [opsOpen, setOpsOpen] = useState(true);
  const [mobileOpsOpen, setMobileOpsOpen] = useState(false);
  const [threadMenuOpen, setThreadMenuOpen] = useState(false);
  const [showDeepWorkbench, setShowDeepWorkbench] = useState(false);
  const [showApprovalInbox, setShowApprovalInbox] = useState(false);
  const [showImprovementCandidateSheet, setShowImprovementCandidateSheet] = useState(false);
  const [improvementCandidateBusySignalId, setImprovementCandidateBusySignalId] = useState<string | null>(null);
  const [improvementCandidateError, setImprovementCandidateError] = useState<string | null>(null);
  const [selectedDepartmentUri, setSelectedDepartmentUri] = useState<string | null>(null);
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

  const applyOfficeData = useCallback((snapshot: OfficeLoadSnapshot) => {
    setRoutine(snapshot.routine);
    setManagementOverview(snapshot.managementOverview);
    setLoopPolicy(snapshot.loopPolicy);
    setLoopRuns(snapshot.loopRuns);
    setLoopDigests(snapshot.loopDigests);
    setImprovementSignals(snapshot.improvementSignals);
    setImprovementProposals(snapshot.improvementProposals);
    setDecisionViews(snapshot.decisionViews);
  }, []);

  const loadOfficeData = useCallback(async (): Promise<OfficeLoadSnapshot> => {
    const [
      nextRoutine,
      nextOverview,
      nextLoopPolicies,
      nextLoopRuns,
      nextLoopDigests,
      nextImprovementSignals,
      nextImprovementProposals,
      nextDecisions,
    ] = await Promise.all([
      api.ceoRoutine().catch(() => null),
      api.managementOverview().catch(() => null),
      api.companyLoopPolicies({ pageSize: 20 }).catch(() => ({ items: [] as CompanyLoopPolicyFE[] })),
      api.companyLoopRuns({ pageSize: 4 }).catch(() => ({ items: [] as CompanyLoopRunFE[] })),
      api.companyLoopDigests({ pageSize: 2 }).catch(() => ({ items: [] as CompanyLoopDigestFE[] })),
      api.systemImprovementSignals({ pageSize: 200 }).catch(() => ({ items: [] as SystemImprovementSignalFE[], total: 0 })),
      api.systemImprovementProposals({ pageSize: 50 }).catch(() => ({ items: [] as SystemImprovementProposalFE[] })),
      api.ceoDecisions({ limit: 8 }).catch(() => ({ items: [] as DecisionItemViewFE[] })),
    ]);

    return {
      routine: nextRoutine as CEORoutineSummaryFE | null,
      managementOverview: nextOverview as ManagementOverviewFE | null,
      loopPolicy: (((nextLoopPolicies as { items?: CompanyLoopPolicyFE[] } | null)?.items || [])
        .find((policy) => policy.scope === 'organization' && !policy.scopeId) || null),
      loopRuns: (nextLoopRuns as { items?: CompanyLoopRunFE[] } | null)?.items || [],
      loopDigests: (nextLoopDigests as { items?: CompanyLoopDigestFE[] } | null)?.items || [],
      improvementSignals: (nextImprovementSignals as { items?: SystemImprovementSignalFE[] } | null)?.items || [],
      improvementProposals: (nextImprovementProposals as { items?: SystemImprovementProposalFE[] } | null)?.items || [],
      decisionViews: (nextDecisions as { items?: DecisionItemViewFE[] } | null)?.items || [],
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadOfficeData().then((snapshot) => {
      if (cancelled) return;
      applyOfficeData(snapshot);
    });

    return () => {
      cancelled = true;
    };
  }, [applyOfficeData, loadOfficeData, projects.length, refreshSignal, workspaces.length]);

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

  const decisionRows = useMemo<DecisionItem[]>(
    () => decisionViews.slice(0, 6).map((item) => {
      const icon = item.target.kind === 'system-improvement-proposal'
        ? <PackageCheck className="h-4 w-4" />
        : item.target.kind === 'project-stage-gate'
          ? <BriefcaseBusiness className="h-4 w-4" />
          : <Command className="h-4 w-4" />;
      return {
        id: item.id,
        title: item.title,
        source: item.source,
        status: item.status,
        owner: formatDecisionOwner(item.currentOwner),
        nextAction: formatDecisionAction(item.nextAction),
        detail: item.detail,
        priority: item.priority,
        tone: item.tone as Tone,
        icon,
        target: item.target,
      };
    }),
    [decisionViews],
  );

  const improvementCandidates = useMemo(
    () => buildImprovementCandidateViews(improvementSignals, improvementProposals),
    [improvementProposals, improvementSignals],
  );
  const previewImprovementCandidates = useMemo(
    () => improvementCandidates.slice(0, 5),
    [improvementCandidates],
  );
  const improvementEntryReviewCount = useMemo(
    () => improvementProposals.filter((item) => item.controlState?.stage === 'entry-review').length,
    [improvementProposals],
  );
  const improvementExitReviewCount = useMemo(
    () => improvementProposals.filter((item) => item.controlState?.stage === 'exit-review').length,
    [improvementProposals],
  );

  const handleGenerateImprovementProposal = useCallback(async (signal: SystemImprovementSignalFE) => {
    setImprovementCandidateBusySignalId(signal.id);
    setImprovementCandidateError(null);
    try {
      await api.generateSystemImprovementProposal({ signalIds: [signal.id] });
      const snapshot = await loadOfficeData();
      applyOfficeData(snapshot);
    } catch (error) {
      setImprovementCandidateError(error instanceof Error ? error.message : '当前无法生成提案。');
    } finally {
      setImprovementCandidateBusySignalId(null);
    }
  }, [applyOfficeData, loadOfficeData]);
  const handleOpenImprovementProposalFromPool = useCallback((proposalId: string) => {
    setShowImprovementCandidateSheet(false);
    onOpenImprovementProposal(proposalId);
  }, [onOpenImprovementProposal]);

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
  const handleWelcomeSubmit = (text: string) => {
    const nextCommand = text.trim();
    if (!nextCommand || loading) return;

    if (activeId) {
      onSend(nextCommand);
      setCommandDraft('');
      return;
    }

    setPendingCommand(nextCommand);
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

  const opsDashboard = (
    <>
      <section className="grid gap-3 md:grid-cols-2">
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

      <div className="grid gap-4">
              <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
                <div className="border-b border-[#edf1f7] px-5 py-4">
                  <SectionHeader
                    title={(
                      <span className="flex items-center gap-2">
                        决策队列
                        <span className="rounded-full bg-[#edf2fa] px-2 py-0.5 text-[12px] text-[#566176]">{decisionRows.length}</span>
                      </span>
                    )}
                  />
                </div>
                <div>
                  {decisionRows.length ? decisionRows.map(item => (
                    <DecisionRow
                      key={item.id}
                      item={item}
                      onOpen={onOpenDecisionTarget}
                    />
                  )) : (
                    <div className="px-5 py-8 text-center text-sm text-[#7c8799]">当前没有排队中的高优决策。</div>
                  )}
                </div>
                <div className="border-t border-[#edf1f7] px-5 py-3 text-center">
                  <button type="button" onClick={() => setShowApprovalInbox(value => !value)} className="inline-flex items-center gap-1 text-[13px] font-medium text-[#1768d9]">
                    审批收件箱
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
                  <ApprovalPanel refreshInterval={15_000} onOpenTarget={onOpenDecisionTarget} />
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
                <SectionHeader
                  title={(
                    <span className="flex items-center gap-2">
                      候选改进
                      <span className="rounded-full bg-[#edf2fa] px-2 py-0.5 text-[12px] text-[#566176]">{improvementCandidates.length}</span>
                    </span>
                  )}
                />
                <button type="button" onClick={() => setShowImprovementCandidateSheet(true)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#1768d9]">
                  查看全部
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3 p-4">
                {improvementCandidateError ? (
                  <div className="rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                    {improvementCandidateError}
                  </div>
                ) : null}
                {previewImprovementCandidates.length ? previewImprovementCandidates.map((candidate) => (
                  <ImprovementCandidateRow
                    key={candidate.signal.id}
                    candidate={candidate}
                    locale={locale}
                    busy={improvementCandidateBusySignalId === candidate.signal.id}
                    onGenerate={(signal) => { void handleGenerateImprovementProposal(signal); }}
                    onOpenProposal={handleOpenImprovementProposalFromPool}
                  />
                )) : (
                  <div className="p-1 text-sm leading-6 text-[#7c8799]">当前没有候选项。</div>
                )}
              </div>
            </WorkspaceSurface>

            <WorkspaceSurface padding="none" className="overflow-hidden rounded-[14px] border-[#e3e8f2] bg-white shadow-[0_10px_28px_rgba(31,41,55,0.05)]">
              <div className="flex items-center justify-between border-b border-[#edf1f7] px-4 py-4">
                <SectionHeader
                  title={(
                    <span className="flex items-center gap-2">
                      系统改进进展
                      <span className="rounded-full bg-[#edf2fa] px-2 py-0.5 text-[12px] text-[#566176]">{improvementProposals.length}</span>
                    </span>
                  )}
                />
                <button type="button" onClick={() => onOpenOps()} className="inline-flex items-center gap-1 text-[12px] font-medium text-[#1768d9]">
                  Ops
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800">
                  <span>审批阶段</span>
                  <span className="font-semibold">{improvementEntryReviewCount} 准入 / {improvementExitReviewCount} 准出</span>
                </div>
                {improvementProposals.length ? (
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
                          </div>
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                            getImprovementDecisionTone(proposal) === 'success'
                              ? 'bg-emerald-50 text-emerald-700'
                              : getImprovementDecisionTone(proposal) === 'warning'
                                ? 'bg-amber-50 text-amber-700'
                                : getImprovementDecisionTone(proposal) === 'danger'
                                  ? 'bg-red-50 text-red-600'
                                  : 'bg-sky-50 text-sky-700',
                          )}>
                            {formatImprovementMergeGateLabel(proposal)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-1 text-sm leading-6 text-[#7c8799]">当前没有提案。</div>
                )}
              </div>
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
    </>
  );

  return (
    <div className="flex h-full min-h-0 bg-[#f3f6fa] text-[#111827]">
      <CeoRail
        user={user}
        onOpenProjects={onOpenProjects}
        onOpenKnowledge={onOpenKnowledge}
        onOpenOps={onOpenOps}
        onOpenSettings={onOpenSettings}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <CockpitTopBar
          displayName={displayName}
          companyName={companyName}
          greeting={greetingLabel}
          todayLabel={todayLabel}
          pendingApprovals={pendingApprovals}
          failedProjectCount={failedProjectCount}
          activeRunsCount={activeRuns.length}
          activeId={activeId}
          activeTitle={activeTitle}
          ceoHistory={ceoHistory}
          locale={locale}
          threadMenuOpen={threadMenuOpen}
          onToggleThreadMenu={() => setThreadMenuOpen(value => !value)}
          onCloseThreadMenu={() => setThreadMenuOpen(false)}
          onSelectConversation={onSelectConversation}
          onCreateConversation={onCreateCeoConversation}
          onOpenKnowledge={onOpenKnowledge}
          onOpenApprovals={() => {
            setOpsOpen(true);
            setMobileOpsOpen(true);
            setShowApprovalInbox(true);
          }}
          opsOpen={opsOpen}
          onToggleDesktopOps={() => setOpsOpen(value => !value)}
          onToggleMobileOps={() => setMobileOpsOpen(true)}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <section className="flex min-w-0 flex-1 flex-col bg-white" data-testid="ceo-chat-workspace">
            {activeId ? (
              <>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <Chat
                    steps={steps}
                    loading={loading}
                    currentModel={currentModel}
                    onProceed={onProceed}
                    onRevert={onRevert}
                    isActive={isActive}
                    conversationId={activeId}
                  />
                </div>
                <div className="shrink-0 border-t border-[#edf1f7] bg-white px-3 pb-3 pt-3 md:px-6 md:pb-5 md:pt-4">
                  {sendError ? (
                    <div className="mb-3 rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
                      {sendError}
                    </div>
                  ) : null}
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
              </>
            ) : (
              <CeoOfficeWelcome
                displayName={displayName}
                companyName={companyName}
                greeting={greetingLabel}
                draft={commandDraft}
                onDraftChange={setCommandDraft}
                onSubmit={handleWelcomeSubmit}
                loading={loading}
                hasHistory={ceoHistory.length > 0}
                onOpenHistory={() => setThreadMenuOpen(true)}
                sendError={sendError}
              />
            )}
          </section>

          {opsOpen ? (
            <aside
              data-testid="ceo-ops-sidebar"
              className="hidden w-[400px] shrink-0 overflow-hidden border-l border-[#dfe5ee] bg-[#f3f6fa] xl:flex xl:flex-col"
            >
              <ScrollArea className="h-full">
                <div className="space-y-4 px-4 py-5">
                  {opsDashboard}
                </div>
              </ScrollArea>
            </aside>
          ) : null}
        </div>
      </div>

      <Sheet open={mobileOpsOpen} onOpenChange={setMobileOpsOpen}>
        <SheetContent side="right" className="w-full max-w-[420px] overflow-y-auto border-[#dfe5ee] bg-[#f3f6fa] sm:max-w-[420px]">
          <SheetHeader className="border-b border-[#edf1f7] pb-4">
            <SheetTitle className="text-left text-[16px] font-semibold text-[#111827]">运营总览</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            {opsDashboard}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={showImprovementCandidateSheet} onOpenChange={setShowImprovementCandidateSheet}>
        <SheetContent className="w-full max-w-[720px] overflow-y-auto border-[#dfe5ee] bg-[#f8fafc] sm:max-w-[720px]">
          <SheetHeader className="border-b border-[#edf1f7] pb-4">
            <SheetTitle className="text-left text-[18px] font-semibold text-[#111827]">候选改进</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-5">
            {improvementCandidateError ? (
              <div className="rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                {improvementCandidateError}
              </div>
            ) : null}
            {improvementCandidates.length ? (
              <div className="space-y-3">
                {improvementCandidates.map((candidate) => (
                  <ImprovementCandidateRow
                    key={candidate.signal.id}
                    candidate={candidate}
                    locale={locale}
                    busy={improvementCandidateBusySignalId === candidate.signal.id}
                    onGenerate={(signal) => { void handleGenerateImprovementProposal(signal); }}
                    onOpenProposal={handleOpenImprovementProposalFromPool}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[12px] border border-[#e3e8f2] bg-white px-4 py-6 text-center text-sm text-[#7c8799]">
                当前没有候选项。
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
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

