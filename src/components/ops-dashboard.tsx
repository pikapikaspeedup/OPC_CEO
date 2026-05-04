'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FolderKanban,
  GitMerge,
  KeyRound,
  Loader2,
  Network,
  Pause,
  Play,
  Plug2,
  Radio,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldAlert,
  Sparkles,
  Ticket,
  Waypoints,
  Wrench,
  Workflow as WorkflowIcon,
} from 'lucide-react';

import { api, type AuditEvent, type SchedulerJobResponse } from '@/lib/api';
import type {
  BudgetLedgerEntryFE,
  CircuitBreakerFE,
  CompanyLoopRunFE,
  ManagementOverviewFE,
  McpServer,
  OperatingSignalFE,
  Rule,
  Skill,
  SystemImprovementProposalFE,
  SystemImprovementReleaseActionFE,
  SystemImprovementReleaseGateSnapshotFE,
  Workflow,
  Workspace,
} from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import SchedulerPanel from '@/components/scheduler-panel';
import AssetsManager from '@/components/assets-manager';
import AnalyticsDashboard from '@/components/analytics-dashboard';
import CodexWidget from '@/components/codex-widget';

type AssetTab = 'workflows' | 'skills' | 'rules';
type DeepWorkspaceTab = 'scheduler' | 'assets' | 'toolbox';

type QuotaSnapshot = Awaited<ReturnType<typeof api.getDepartmentQuota>>;
type TunnelStatusSnapshot = Awaited<ReturnType<typeof api.tunnelStatus>>;

type OpsDashboardProps = {
  searchQuery: string;
  workspaces: Workspace[];
  skills: Skill[];
  workflows: Workflow[];
  rules: Rule[];
  discoveredSkills?: Skill[];
  discoveredWorkflows?: Workflow[];
  discoveredRules?: Rule[];
  requestedTab?: AssetTab;
  requestedItemName?: string | null;
  requestToken?: number;
  requestedProposalId?: string | null;
  proposalRequestToken?: number;
  refreshSignal?: number;
  onRefreshAssets: () => void;
  onOpenProviderSettings: () => void;
  onOpenApiKeys: () => void;
  onNavigateToProject?: (projectId: string) => void;
  onOpenImprovementProposal?: (proposalId: string | null) => void;
};

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-[#f3f4f6] text-[#64748b]',
  info: 'bg-[#eef4ff] text-[#2563eb]',
  success: 'bg-[#ecfdf5] text-[#059669]',
  warning: 'bg-[#fff7ed] text-[#d97706]',
  danger: 'bg-[#fef2f2] text-[#dc2626]',
};

const STATUS_DOT_CLASSES: Record<StatusTone, string> = {
  neutral: 'bg-[#94a3b8]',
  info: 'bg-[#3b82f6]',
  success: 'bg-[#10b981]',
  warning: 'bg-[#f59e0b]',
  danger: 'bg-[#ef4444]',
};

function matchesSearch(query: string, ...parts: Array<string | null | undefined>): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return parts.some((part) => part?.toLowerCase().includes(trimmed));
}

function formatTimestamp(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(value?: string | null): string {
  if (!value) return '刚刚';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '刚刚';
  const diffMinutes = Math.round((Date.now() - time) / 60_000);
  if (diffMinutes <= 1) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  return `${Math.round(diffHours / 24)} 天前`;
}

function formatSchedulerCadence(job: SchedulerJobResponse): string {
  if (job.type === 'interval') {
    const intervalMs = (job as SchedulerJobResponse & { intervalMs?: number }).intervalMs;
    if (typeof intervalMs === 'number' && intervalMs > 0) {
      if (intervalMs % 3_600_000 === 0) return `每 ${intervalMs / 3_600_000} 小时`;
      if (intervalMs % 60_000 === 0) return `每 ${intervalMs / 60_000} 分钟`;
      if (intervalMs % 1_000 === 0) return `每 ${intervalMs / 1_000} 秒`;
    }
    return '循环';
  }
  if (job.type === 'cron') {
    const cronExpression = (job as SchedulerJobResponse & { cronExpression?: string }).cronExpression;
    return cronExpression || 'Cron 表达式';
  }
  return '单次';
}

function formatTriggerSource(createdBy?: SchedulerJobResponse['createdBy']): string {
  switch (createdBy) {
    case 'ceo-command':
      return 'CEO 指令';
    case 'ceo-workflow':
      return 'CEO 工作流';
    case 'mcp':
      return 'MCP';
    case 'web':
      return '控制台';
    case 'api':
      return 'API';
    default:
      return '调度器';
  }
}

function getJobTarget(job: SchedulerJobResponse): string {
  if (job.departmentWorkspaceUri) {
    return job.departmentWorkspaceUri.split('/').pop() || job.departmentWorkspaceUri;
  }
  if (typeof job.action?.workspace === 'string' && job.action.workspace) {
    return job.action.workspace.split('/').pop() || job.action.workspace;
  }
  if (typeof job.action?.projectId === 'string' && job.action.projectId) {
    return `项目 ${job.action.projectId.slice(0, 8)}`;
  }
  return formatTriggerSource(job.createdBy);
}

function getJobState(job: SchedulerJobResponse): {
  label: string;
  tone: StatusTone;
  detail: string;
} {
  if (job.enabled === false) {
    return { label: '已暂停', tone: 'neutral', detail: '未参与调度' };
  }
  if (job.lastRunError || job.lastRunResult === 'failed') {
    return { label: '需关注', tone: 'danger', detail: job.lastRunError || '最近一次执行失败' };
  }
  if (job.lastRunResult === 'skipped') {
    return { label: '已跳过', tone: 'warning', detail: '最近一次被策略跳过' };
  }
  if (job.nextRunAt) {
    return { label: '启用中', tone: 'success', detail: `下次 ${formatTimestamp(job.nextRunAt)}` };
  }
  return { label: '待配置', tone: 'info', detail: '等待下一次触发' };
}

function formatJobResult(result?: string): string {
  switch (result) {
    case 'success':
      return '成功';
    case 'failed':
      return '失败';
    case 'skipped':
      return '跳过';
    case 'running':
      return '运行中';
    default:
      return '未执行';
  }
}

function formatExecutionProfileLabel(label?: string | null): string | null {
  if (!label) return null;
  if (label === 'Workflow Run') return '工作流执行';
  if (label === 'Review Flow') return '评审流程';
  if (label === 'DAG Orchestration') return '流程编排';
  return label;
}

function formatSchedulerRuntimeMessage(message?: string | null): string | null {
  if (!message) return null;
  if (message === 'Scheduler loop is running.') return '调度循环运行中';
  if (message === 'Scheduler is disabled.') return '调度循环已禁用';
  if (message === 'Scheduler loop appears stalled.') return '调度循环疑似停滞';
  return message;
}

function formatLoopKind(kind: CompanyLoopRunFE['kind']): string {
  switch (kind) {
    case 'daily-review':
      return '每日巡检';
    case 'weekly-review':
      return '每周复盘';
    case 'growth-review':
      return '增长评审';
    case 'risk-review':
      return '风险巡检';
    default:
      return '自治循环';
  }
}

function formatLoopStatus(status: CompanyLoopRunFE['status']): string {
  switch (status) {
    case 'running':
      return '进行中';
    case 'completed':
      return '已完成';
    case 'skipped':
      return '已跳过';
    case 'failed':
      return '失败';
    default:
      return '未知';
  }
}

function formatProposalRisk(risk: SystemImprovementProposalFE['risk']): string {
  switch (risk) {
    case 'critical':
      return '关键风险';
    case 'high':
      return '高风险';
    case 'medium':
      return '中风险';
    case 'low':
      return '低风险';
    default:
      return '待评估';
  }
}

function formatProposalStatus(status: SystemImprovementProposalFE['status']): string {
  switch (status) {
    case 'draft':
      return '草稿';
    case 'needs-evidence':
      return '待补证据';
    case 'approval-required':
      return '待审批';
    case 'approved':
      return '已批准';
    case 'in-progress':
      return '进行中';
    case 'testing':
      return '测试中';
    case 'ready-to-merge':
      return '待合并';
    case 'published':
      return '已发布';
    case 'observing':
      return '观察中';
    case 'rejected':
      return '已拒绝';
    case 'rolled-back':
      return '已回滚';
    default:
      return '处理中';
  }
}

function formatProposalMergeGateStatus(status?: 'pending' | 'ready-to-merge' | 'blocked'): string {
  switch (status) {
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

function formatProposalReleaseStatus(status?: SystemImprovementReleaseGateSnapshotFE['status']): string {
  switch (status) {
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
    case 'not-started':
    default:
      return '未预检';
  }
}

function getProposalReleaseTone(status?: SystemImprovementReleaseGateSnapshotFE['status']): StatusTone {
  switch (status) {
    case 'ready-for-approval':
    case 'approved':
    case 'merged':
    case 'restarted':
    case 'observing':
      return 'success';
    case 'preflight-failed':
    case 'rolled-back':
      return 'danger';
    case 'not-started':
    default:
      return 'neutral';
  }
}

function getProposalMergeGateTone(proposal: SystemImprovementProposalFE): StatusTone {
  const gateStatus = proposal.exitEvidence?.mergeGate.status;
  if (gateStatus === 'ready-to-merge') return 'success';
  if (gateStatus === 'blocked') return 'danger';
  if (proposal.status === 'testing' || proposal.status === 'in-progress') return 'warning';
  return proposal.risk === 'high' ? 'warning' : 'info';
}

function formatImprovementRunStatus(status?: string): string {
  switch (status) {
    case 'queued':
      return '排队中';
    case 'starting':
      return '启动中';
    case 'running':
      return '执行中';
    case 'completed':
      return '已完成';
    case 'blocked':
      return '已阻塞';
    case 'failed':
      return '已失败';
    case 'cancelled':
      return '已取消';
    case 'timeout':
      return '已超时';
    default:
      return '未启动';
  }
}

function buildProposalEvidenceDetail(proposal: SystemImprovementProposalFE): string {
  const evidence = proposal.exitEvidence;
  if (!evidence) {
    return proposal.summary || `影响文件 ${proposal.affectedFiles.length} 个`;
  }
  const segments: string[] = [];
  if (evidence.codex) {
    segments.push(`Codex ${evidence.codex.decision}`);
    segments.push(`${evidence.codex.changedFiles.length} files`);
  }
  if (evidence.project) {
    segments.push(`项目 ${evidence.project.status}`);
  }
  if (evidence.latestRun) {
    segments.push(`Run ${formatImprovementRunStatus(evidence.latestRun.status)}`);
  }
  if (evidence.testing.evidenceCount > 0) {
    segments.push(`测试 ${evidence.testing.passedCount} 过 / ${evidence.testing.failedCount} 失败`);
  } else {
    segments.push('未提交测试');
  }
  segments.push(`发布 ${formatProposalMergeGateStatus(evidence.mergeGate.status)}`);
  return segments.join(' · ');
}

function buildProposalEvidenceReason(proposal: SystemImprovementProposalFE): string {
  const reasons = proposal.exitEvidence?.mergeGate.reasons || [];
  if (reasons.length > 0) return reasons[0];
  return proposal.summary || `影响文件 ${proposal.affectedFiles.length} 个`;
}

function buildReleaseGateDetail(releaseGate?: SystemImprovementReleaseGateSnapshotFE): string {
  if (!releaseGate) return '发布前检查尚未执行';
  const checks = releaseGate.checks.length
    ? `${releaseGate.checks.filter((item) => item.status === 'passed').length}/${releaseGate.checks.length} checks`
    : '0 checks';
  const patch = releaseGate.patchPath ? releaseGate.patchPath.split('/').pop() : 'no patch';
  return `${checks} · ${patch}`;
}

function formatServerType(type?: McpServer['type']): string {
  switch (type) {
    case 'http':
      return 'HTTP';
    case 'sse':
      return 'SSE';
    case 'stdio':
    default:
      return 'STDIO';
  }
}

function formatAssetScope(scope?: Skill['scope'] | Workflow['scope'] | Rule['scope']): string {
  if (scope === 'workspace') return '部门级';
  if (scope === 'global') return '组织级';
  return '未标注';
}

function formatAssetStatus(source?: Skill['source'] | Workflow['source'] | Rule['source']): {
  label: string;
  tone: StatusTone;
} {
  return source === 'discovered'
    ? { label: '待导入', tone: 'warning' }
    : { label: '已接入', tone: 'success' };
}

function formatAuditMessage(message: string): string {
  const completedStage = message.match(/^Stage '(.+)' completed$/);
  if (completedStage) return `阶段 ${completedStage[1]} 已完成`;
  const failedStage = message.match(/^Stage '(.+)' failed$/);
  if (failedStage) return `阶段 ${failedStage[1]} 失败`;
  if (message === 'Project completed') return '项目已完成';
  if (message === 'Project failed') return '项目失败';
  return message;
}

function buildTrend(values: number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - (((value - min) / range) * 76 + 12);
      return `${x},${y}`;
    })
    .join(' ');
}

function scrollToRef(ref: React.RefObject<HTMLDivElement | null>): void {
  ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function OpsMetricCard({
  icon,
  label,
  value,
  detail,
  tone = 'info',
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  detail: string;
  tone?: StatusTone;
  trend: number[];
}) {
  const points = buildTrend(trend);

  return (
    <div className="rounded-[14px] border border-[#dfe5ee] bg-white px-3.5 py-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]', STATUS_TONE_CLASSES[tone])}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-[#64748b]">{label}</div>
          <div className="mt-1 text-[30px] font-semibold leading-none text-[#0f172a]">{value}</div>
          <div className="mt-1.5 text-[11px] font-medium leading-5 text-[#64748b]">{detail}</div>
        </div>
        <div className="hidden h-11 w-20 shrink-0 md:block">
          {points ? (
            <svg viewBox="0 0 100 100" className="h-full w-full">
              <polyline
                fill="none"
                stroke="#3b82f6"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points}
              />
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OpsPanel({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-[14px] border border-[#dfe5ee] bg-white shadow-[0_12px_28px_rgba(15,23,42,0.05)]', className)}>
      <div className="flex items-start justify-between gap-3 border-b border-[#eef2f7] px-3.5 py-3">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[#0f172a]">{title}</div>
          {subtitle ? <div className="mt-1 text-[12px] text-[#64748b]">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="px-3.5 py-3.5">{children}</div>
    </section>
  );
}

function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold', STATUS_TONE_CLASSES[tone])}>
      <span className={cn('h-2 w-2 rounded-full', STATUS_DOT_CLASSES[tone])} />
      {label}
    </span>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-[#dbe3ef] bg-[#fbfdff] px-3.5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-[#0f172a]">{title}</div>
          <div className="mt-1 text-[12px] leading-5 text-[#64748b]">{body}</div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

function QuotaBar({ used, limit }: { used: number; limit: number }) {
  if (limit <= 0) {
    return <div className="text-[11px] text-[#64748b]">无限制</div>;
  }
  const pct = Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
  const tone: StatusTone = pct >= 100 ? 'danger' : pct >= 80 ? 'warning' : 'success';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-[#64748b]">
        <span>{used.toLocaleString()} / {limit.toLocaleString()}</span>
        <span className={cn('font-semibold', tone === 'danger' ? 'text-[#dc2626]' : tone === 'warning' ? 'text-[#d97706]' : 'text-[#0f766e]')}>{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#eef2f7]">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            tone === 'danger'
              ? 'bg-[#ef4444]'
              : tone === 'warning'
                ? 'bg-[#f59e0b]'
                : 'bg-[#10b981]',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function OpsDashboard({
  searchQuery,
  workspaces,
  skills,
  workflows,
  rules,
  discoveredSkills = [],
  discoveredWorkflows = [],
  discoveredRules = [],
  requestedTab = 'workflows',
  requestedItemName = null,
  requestToken = 0,
  requestedProposalId = null,
  proposalRequestToken = 0,
  refreshSignal = 0,
  onRefreshAssets,
  onOpenProviderSettings,
  onOpenApiKeys,
  onNavigateToProject,
  onOpenImprovementProposal,
}: OpsDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<ManagementOverviewFE | null>(null);
  const [jobs, setJobs] = useState<SchedulerJobResponse[]>([]);
  const [budgetLedger, setBudgetLedger] = useState<BudgetLedgerEntryFE[]>([]);
  const [openBreakers, setOpenBreakers] = useState<CircuitBreakerFE[]>([]);
  const [signals, setSignals] = useState<OperatingSignalFE[]>([]);
  const [loopRuns, setLoopRuns] = useState<CompanyLoopRunFE[]>([]);
  const [improvementProposals, setImprovementProposals] = useState<SystemImprovementProposalFE[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatusSnapshot | null>(null);
  const [quotas, setQuotas] = useState<QuotaSnapshot[]>([]);
  const [schedulerFilter, setSchedulerFilter] = useState<'all' | 'enabled' | 'paused' | 'attention'>('all');
  const [assetTab, setAssetTab] = useState<AssetTab>(requestedTab);
  const [deepWorkspaceTab, setDeepWorkspaceTab] = useState<DeepWorkspaceTab | null>(null);
  const [createJobRequestToken, setCreateJobRequestToken] = useState(0);
  const [jobBusyKey, setJobBusyKey] = useState<string | null>(null);
  const [proposalBusyKey, setProposalBusyKey] = useState<string | null>(null);
  const [highlightedProposalId, setHighlightedProposalId] = useState<string | null>(null);
  const deepWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const exitEvidenceRef = useRef<HTMLDivElement | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [
        nextOverview,
        nextJobs,
        nextLedger,
        nextBreakers,
        nextSignals,
        nextLoopRuns,
        nextProposals,
        nextAuditEvents,
        nextMcpConfig,
        nextTunnelStatus,
        quotaResults,
      ] = await Promise.all([
        api.managementOverview().catch(() => null),
        api.schedulerJobs().catch(() => [] as SchedulerJobResponse[]),
        api.companyBudgetLedger({ pageSize: 12 }).then((result) => result.items || []).catch(() => [] as BudgetLedgerEntryFE[]),
        api.companyCircuitBreakers({ status: 'open', pageSize: 12 }).then((result) => result.items || []).catch(() => [] as CircuitBreakerFE[]),
        api.companySignals({ pageSize: 12 }).then((result) => result.items || []).catch(() => [] as OperatingSignalFE[]),
        api.companyLoopRuns({ pageSize: 8 }).then((result) => result.items || []).catch(() => [] as CompanyLoopRunFE[]),
        api.systemImprovementProposals({ pageSize: 8 }).then((result) => result.items || []).catch(() => [] as SystemImprovementProposalFE[]),
        api.auditEvents({ limit: 18 }).catch(() => [] as AuditEvent[]),
        api.mcp().catch(() => ({ servers: [] })),
        api.tunnelStatus().catch(() => null),
        Promise.allSettled(workspaces.map((workspace) => api.getDepartmentQuota(workspace.uri))),
      ]);

      setOverview(nextOverview as ManagementOverviewFE | null);
      setJobs(nextJobs);
      setBudgetLedger(nextLedger);
      setOpenBreakers(nextBreakers);
      setSignals(nextSignals);
      setLoopRuns(nextLoopRuns);
      setImprovementProposals(nextProposals);
      setAuditEvents(nextAuditEvents);
      setMcpServers((nextMcpConfig?.servers || []).filter(Boolean));
      setTunnelStatus(nextTunnelStatus);
      setQuotas(
        quotaResults
          .filter((result): result is PromiseFulfilledResult<QuotaSnapshot> => result.status === 'fulfilled')
          .map((result) => result.value),
      );
    } finally {
      setLoading(false);
    }
  }, [workspaces]);

  useEffect(() => {
    void loadDashboard();
    const interval = window.setInterval(() => {
      void loadDashboard();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [loadDashboard, refreshSignal]);

  useEffect(() => {
    setAssetTab(requestedTab);
  }, [requestedTab]);

  useEffect(() => {
    if (requestedItemName) {
      setDeepWorkspaceTab('assets');
      window.setTimeout(() => scrollToRef(deepWorkspaceRef), 50);
    }
  }, [requestedItemName, requestToken]);

  useEffect(() => {
    if (!requestedProposalId || loading) return;
    setHighlightedProposalId(requestedProposalId);
    window.setTimeout(() => scrollToRef(exitEvidenceRef), 80);
    const timer = window.setTimeout(() => {
      setHighlightedProposalId((current) => current === requestedProposalId ? null : current);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [improvementProposals.length, loading, proposalRequestToken, requestedProposalId]);

  const handleToggleJob = useCallback(async (job: SchedulerJobResponse) => {
    const busyKey = `${job.jobId}:toggle`;
    setJobBusyKey(busyKey);
    try {
      await api.updateSchedulerJob(job.jobId, { enabled: !job.enabled });
      await loadDashboard();
    } finally {
      setJobBusyKey(null);
    }
  }, [loadDashboard]);

  const handleTriggerJob = useCallback(async (job: SchedulerJobResponse) => {
    const busyKey = `${job.jobId}:trigger`;
    setJobBusyKey(busyKey);
    try {
      await api.triggerSchedulerJob(job.jobId);
      await loadDashboard();
    } finally {
      setJobBusyKey(null);
    }
  }, [loadDashboard]);

  const handleRunCodexProposal = useCallback(async (proposal: SystemImprovementProposalFE, force = false) => {
    setProposalBusyKey(`${proposal.id}:codex`);
    try {
      await api.runSystemImprovementCodexProposal(proposal.id, { force });
      await loadDashboard();
    } finally {
      setProposalBusyKey(null);
    }
  }, [loadDashboard]);

  const handleReleaseGateAction = useCallback(async (
    proposal: SystemImprovementProposalFE,
    action: SystemImprovementReleaseActionFE,
  ) => {
    setProposalBusyKey(`${proposal.id}:${action}`);
    try {
      await api.runSystemImprovementReleaseGateAction(proposal.id, {
        action,
        actor: 'Ops',
        note: action === 'approve' ? 'CEO/Ops 批准发布' : undefined,
        observationSummary: action === 'start-observation' ? '发布后观察开始。' : undefined,
        rollbackReason: action === 'mark-rolled-back' ? 'Ops 标记回滚。' : undefined,
        healthCheckSummary: action === 'mark-restarted' ? 'Ops 标记重启完成，进入发布后检查。' : undefined,
      });
      await loadDashboard();
    } finally {
      setProposalBusyKey(null);
    }
  }, [loadDashboard]);

  const openSchedulerStudio = useCallback((requestCreate = false) => {
    setDeepWorkspaceTab('scheduler');
    if (requestCreate) {
      setCreateJobRequestToken((value) => value + 1);
    }
    window.setTimeout(() => scrollToRef(deepWorkspaceRef), 50);
  }, []);

  const openAssetStudio = useCallback(() => {
    setDeepWorkspaceTab('assets');
    window.setTimeout(() => scrollToRef(deepWorkspaceRef), 50);
  }, []);

  const filteredJobs = useMemo(() => {
    return jobs
      .filter((job) => {
        if (schedulerFilter === 'enabled') return job.enabled !== false;
        if (schedulerFilter === 'paused') return job.enabled === false;
        if (schedulerFilter === 'attention') {
          return Boolean(job.lastRunError || job.lastRunResult === 'failed' || job.lastRunResult === 'skipped');
        }
        return true;
      })
      .filter((job) => matchesSearch(
        searchQuery,
        job.name,
        formatSchedulerCadence(job),
        getJobTarget(job),
        job.intentSummary,
        job.lastRunError,
      ));
  }, [jobs, schedulerFilter, searchQuery]);

  const enabledJobs = useMemo(
    () => jobs.filter((job) => job.enabled !== false),
    [jobs],
  );
  const attentionJobs = useMemo(
    () => jobs.filter((job) => job.lastRunResult === 'failed' || job.lastRunResult === 'skipped' || !!job.lastRunError),
    [jobs],
  );

  const quotaSummary = useMemo(() => {
    const limitedQuotas = quotas.filter((item) => item.quota.daily > 0);
    const totalDaily = limitedQuotas.reduce((sum, item) => sum + item.quota.daily, 0);
    const usedDaily = limitedQuotas.reduce((sum, item) => sum + item.quota.used.daily, 0);
    const ratio = totalDaily > 0 ? usedDaily / totalDaily : null;
    return {
      limitedQuotas,
      totalDaily,
      usedDaily,
      ratio,
    };
  }, [quotas]);

  const schedulerTrend = useMemo(
    () => jobs.slice(0, 7).map((job) => (
      job.enabled === false
        ? 1
        : job.lastRunResult === 'failed'
          ? 0
          : job.lastRunResult === 'skipped'
            ? 2
            : 3
    )),
    [jobs],
  );
  const signalTrend = useMemo(
    () => signals.slice(0, 7).map((signal) => Math.max(1, Math.round(signal.score))),
    [signals],
  );
  const quotaTrend = useMemo(
    () => quotaSummary.limitedQuotas.slice(0, 7).map((item) => {
      if (item.quota.daily <= 0) return 0;
      return Math.round((item.quota.used.daily / item.quota.daily) * 100);
    }),
    [quotaSummary.limitedQuotas],
  );
  const serviceTrend = useMemo(() => {
    const statusValues = mcpServers.slice(0, 6).map(() => 3);
    if (tunnelStatus?.configured) {
      statusValues.push(tunnelStatus.running ? 3 : tunnelStatus.starting ? 2 : 1);
    }
    return statusValues;
  }, [mcpServers, tunnelStatus]);

  const systemRows = useMemo<Array<{
    label: string;
    tone: StatusTone;
    status: string;
    metric: string;
    detail: string;
  }>>(() => {
    const runtime = overview?.schedulerRuntime;
    const runtimeTone: StatusTone = runtime?.status === 'running'
      ? 'success'
      : runtime?.status === 'disabled'
        ? 'danger'
        : runtime?.status === 'stalled'
          ? 'warning'
          : 'neutral';

    return [
      {
        label: '调度引擎',
        tone: runtimeTone,
        status: runtime?.status === 'running' ? '运行中' : runtime?.status === 'disabled' ? '已禁用' : runtime?.status === 'stalled' ? '停滞' : '空闲',
        metric: `${runtime?.enabledJobCount ?? enabledJobs.length} 个任务`,
        detail: formatSchedulerRuntimeMessage(runtime?.message) || (runtime?.nextRunAt ? `下次轮询 ${formatTimestamp(runtime.nextRunAt)}` : '等待下一次轮询'),
      },
      {
        label: '审批队列',
        tone: overview?.pendingApprovals ? 'warning' : 'success',
        status: overview?.pendingApprovals ? '待处理' : '已清空',
        metric: `${overview?.pendingApprovals ?? 0} 条`,
        detail: overview?.pendingApprovals ? `${overview.pendingApprovals} 条待 CEO 决策` : '当前没有待处理审批',
      },
      {
        label: '熔断保护',
        tone: openBreakers.length ? 'danger' : 'success',
        status: openBreakers.length ? '打开' : '正常',
        metric: `${openBreakers.length} 个`,
        detail: openBreakers[0]?.reason || '没有打开的熔断器',
      },
      {
        label: '经营信号',
        tone: signals.length ? 'info' : 'neutral',
        status: signals.length ? '活跃' : '静默',
        metric: `${signals.length} 条`,
        detail: signals.length ? `最新信号 ${formatRelative(signals[0]?.updatedAt)}` : '暂无新的经营信号',
      },
      {
        label: '知识回流',
        tone: (overview?.recentKnowledge || 0) > 0 ? 'success' : 'neutral',
        status: (overview?.recentKnowledge || 0) > 0 ? '更新中' : '静默',
        metric: (overview?.recentKnowledge || 0) > 0 ? `${overview?.recentKnowledge || 0} 条新增` : '暂无新增',
        detail: (overview?.recentKnowledge || 0) > 0 ? `最近 50 条内新增 ${overview?.recentKnowledge || 0} 条知识资产` : '最近未观测到新增知识资产',
      },
    ];
  }, [enabledJobs.length, openBreakers, overview, signals]);

  const filteredSystemRows = useMemo(
    () => systemRows.filter((row) => matchesSearch(searchQuery, row.label, row.status, row.metric, row.detail)),
    [searchQuery, systemRows],
  );

  const filteredMcpServers = useMemo(
    () => mcpServers.filter((server) => matchesSearch(searchQuery, server.name, server.description, server.url, server.command, server.type)),
    [mcpServers, searchQuery],
  );

  const filteredQuotaRows = useMemo(
    () => quotas.filter((item) => matchesSearch(searchQuery, item.workspace)),
    [quotas, searchQuery],
  );

  const assetCollections = useMemo(() => ({
    workflows: {
      icon: <WorkflowIcon className="h-4 w-4" />,
      canonical: workflows.filter((item) => item.source !== 'discovered'),
      discovered: discoveredWorkflows,
      label: '工作流',
      singularLabel: '工作流',
    },
    skills: {
      icon: <Wrench className="h-4 w-4" />,
      canonical: skills.filter((item) => item.source !== 'discovered'),
      discovered: discoveredSkills,
      label: '技能',
      singularLabel: '技能',
    },
    rules: {
      icon: <ShieldAlert className="h-4 w-4" />,
      canonical: rules.filter((item) => item.source !== 'discovered'),
      discovered: discoveredRules,
      label: '规则',
      singularLabel: '规则',
    },
  }), [discoveredRules, discoveredSkills, discoveredWorkflows, rules, skills, workflows]);

  const assetRows = useMemo(() => {
    const current = assetCollections[assetTab];
    return [...current.canonical, ...current.discovered]
      .filter((item) => matchesSearch(searchQuery, item.name, item.description, item.path))
      .map((item) => ({
        ...item,
        kindLabel: current.singularLabel,
        status: formatAssetStatus(item.source),
        scopeLabel: formatAssetScope(item.scope),
      }))
      .slice(0, 6);
  }, [assetCollections, assetTab, searchQuery]);

  const recentActivity = useMemo(() => {
    const loopItems = loopRuns.map((run) => ({
      id: `loop-${run.id}`,
      type: 'loop' as const,
      title: run.summary || formatLoopKind(run.kind),
      category: '自治循环',
      detail: `${formatLoopKind(run.kind)} · 已派发 ${run.dispatchedRunIds.length} 项`,
      statusLabel: formatLoopStatus(run.status),
      timestamp: run.finishedAt || run.startedAt,
      tone: (run.status === 'failed' ? 'danger' : run.status === 'skipped' ? 'warning' : 'success') as StatusTone,
    }));
    const proposalItems = improvementProposals.map((proposal) => ({
      id: `proposal-${proposal.id}`,
      type: 'proposal' as const,
      title: proposal.title,
      category: '系统改进',
      detail: buildProposalEvidenceDetail(proposal),
      statusLabel: `${formatProposalRisk(proposal.risk)} · ${formatProposalStatus(proposal.status)}`,
      timestamp: proposal.updatedAt,
      tone: getProposalMergeGateTone(proposal),
    }));
    const auditItems = auditEvents.map((event) => ({
      id: `audit-${event.timestamp}-${event.kind}`,
      type: 'audit' as const,
      title: formatAuditMessage(event.message),
      category: '系统审计',
      detail: event.jobId ? `任务 ${event.jobId.slice(0, 8)}` : event.projectId ? `项目 ${event.projectId.slice(0, 8)}` : '控制面日志',
      statusLabel: event.kind.includes('error') || event.kind.includes('failed') ? '异常' : '已记录',
      timestamp: event.timestamp,
      tone: (event.kind.includes('error') || event.kind.includes('failed') ? 'danger' : 'neutral') as StatusTone,
    }));

    return [...loopItems, ...proposalItems, ...auditItems]
      .filter((item) => matchesSearch(searchQuery, item.title, item.category, item.detail, item.statusLabel))
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
      .slice(0, 8);
  }, [auditEvents, improvementProposals, loopRuns, searchQuery]);

  const tunnelRows = useMemo(() => ([
    {
      label: '对外 Tunnel',
      tone: (tunnelStatus?.running ? 'success' : tunnelStatus?.configured ? 'warning' : 'neutral') as StatusTone,
      status: tunnelStatus?.running ? '运行中' : tunnelStatus?.starting ? '启动中' : tunnelStatus?.configured ? '已停止' : '未配置',
      metric: tunnelStatus?.url || '尚未配置',
      detail: tunnelStatus?.error || (tunnelStatus?.configured ? '等待需要时启动' : '尚未配置外部访问地址'),
    },
    {
      label: '自治 Loop',
      tone: (overview?.schedulerRuntime.loopActive ? 'success' : 'neutral') as StatusTone,
      status: overview?.schedulerRuntime.loopActive ? '活跃' : '待命',
      metric: overview?.schedulerRuntime.nextRunAt ? formatTimestamp(overview.schedulerRuntime.nextRunAt) : '等待触发',
      detail: overview?.schedulerRuntime.configuredToStart ? '允许随调度启动' : '当前未配置自启',
    },
    {
      label: '辅助服务',
      tone: (overview?.schedulerRuntime.companionServicesEnabled ? 'info' : 'neutral') as StatusTone,
      status: overview?.schedulerRuntime.companionServicesEnabled ? '已开启' : '已关闭',
      metric: `${enabledJobs.length} 个任务在线`,
      detail: 'Provider、密钥与连接策略入口',
    },
  ]), [enabledJobs.length, overview?.schedulerRuntime.companionServicesEnabled, overview?.schedulerRuntime.configuredToStart, overview?.schedulerRuntime.loopActive, overview?.schedulerRuntime.nextRunAt, tunnelStatus]);

  const filteredTunnelRows = useMemo(
    () => tunnelRows.filter((row) => matchesSearch(searchQuery, row.label, row.status, row.metric, row.detail)),
    [searchQuery, tunnelRows],
  );

  const exitEvidenceRows = useMemo(() => improvementProposals
    .filter((proposal) => (
      proposal.exitEvidence
      || proposal.status === 'approved'
      || proposal.status === 'in-progress'
      || proposal.status === 'testing'
      || proposal.status === 'ready-to-merge'
    ))
    .filter((proposal) => matchesSearch(
      searchQuery,
      proposal.title,
      proposal.id,
      proposal.summary,
      buildProposalEvidenceDetail(proposal),
      buildProposalEvidenceReason(proposal),
    ))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 4), [improvementProposals, searchQuery]);

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-[16px] border border-[#dfe5ee] bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-[#64748b]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-4">
        <OpsMetricCard
          icon={<Clock3 className="h-5 w-5" />}
          label="启用中调度任务"
          value={`${enabledJobs.length} / ${jobs.length || 0}`}
          detail={`${overview?.schedulerRuntime.enabledJobCount ?? enabledJobs.length} 个任务在线 · ${attentionJobs.length} 项需关注`}
          tone="info"
          trend={schedulerTrend}
        />
        <OpsMetricCard
          icon={<Activity className="h-5 w-5" />}
          label="待处理治理项"
          value={signals.length + (overview?.pendingApprovals || 0)}
          detail={`审批 ${overview?.pendingApprovals || 0} · 经营信号 ${signals.length}`}
          tone={signals.length || (overview?.pendingApprovals || 0) ? 'warning' : 'success'}
          trend={signalTrend}
        />
        <OpsMetricCard
          icon={<Ticket className="h-5 w-5" />}
          label="额度使用率"
          value={quotaSummary.ratio == null ? '—' : `${Math.round(quotaSummary.ratio * 100)}%`}
          detail={quotaSummary.totalDaily > 0 ? `${quotaSummary.usedDaily.toLocaleString()} / ${quotaSummary.totalDaily.toLocaleString()} 今日配额` : '当前没有配置每日额度'}
          tone={quotaSummary.ratio != null && quotaSummary.ratio >= 0.8 ? 'warning' : 'success'}
          trend={quotaTrend}
        />
        <OpsMetricCard
          icon={<Plug2 className="h-5 w-5" />}
          label="连接服务"
          value={`${mcpServers.length + (tunnelStatus?.running ? 1 : 0)} / ${mcpServers.length + (tunnelStatus?.configured ? 1 : 0)}`}
          detail={`MCP ${mcpServers.length} 个 · Tunnel ${tunnelStatus?.running ? '运行中' : tunnelStatus?.configured ? '已停止' : '未配置'}`}
          tone={tunnelStatus?.running || mcpServers.length ? 'info' : 'neutral'}
          trend={serviceTrend}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.83fr)]">
        <OpsPanel
          title="调度任务"
          subtitle="首屏只保留任务名、调度方式、下一次运行、最近结果和快捷动作。"
          actions={(
            <>
              <div className="hidden items-center gap-1 rounded-[10px] bg-[#f8fafc] p-1 md:flex">
                {[
                  { key: 'all', label: `全部 ${jobs.length}` },
                  { key: 'enabled', label: `启用中 ${enabledJobs.length}` },
                  { key: 'paused', label: `已暂停 ${jobs.length - enabledJobs.length}` },
                  { key: 'attention', label: `需关注 ${attentionJobs.length}` },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setSchedulerFilter(item.key as typeof schedulerFilter)}
                    className={cn(
                      'rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                      schedulerFilter === item.key
                        ? 'bg-white text-[#2563eb] shadow-[0_4px_12px_rgba(37,99,235,0.12)]'
                        : 'text-[#64748b] hover:text-[#0f172a]',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <Button
                onClick={() => openSchedulerStudio(true)}
                className="h-9 rounded-[10px] bg-[#2f6df6] px-3 text-white hover:brightness-105"
              >
                <Play className="mr-1.5 h-4 w-4" />
                新建任务
              </Button>
              <Button
                variant="outline"
                onClick={() => openSchedulerStudio(false)}
                className="h-9 rounded-[10px] border-[#dfe5ee] bg-white text-[#0f172a] hover:bg-[#f8fafc]"
              >
                调度治理
              </Button>
            </>
          )}
        >
          {filteredJobs.length === 0 ? (
            <EmptyState
              title="没有匹配的调度任务"
              body="调整顶部筛选后，这里会显示任务、最近状态和控制动作。"
              action={(
                <Button
                  variant="outline"
                  onClick={() => openSchedulerStudio(false)}
                  className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                >
                  展开调度治理
                </Button>
              )}
            />
          ) : (
            <div className="overflow-hidden rounded-[12px] border border-[#eef2f7]">
              <div className="grid grid-cols-[minmax(0,2fr)_0.92fr_1fr_0.8fr_1.05fr_220px] gap-3 bg-[#f8fafc] px-3.5 py-2.5 text-[11px] font-semibold text-[#64748b]">
                <div>任务名称</div>
                <div>调度</div>
                <div>下次运行</div>
                <div>状态</div>
                <div>最近结果</div>
                <div className="text-right">控制动作</div>
              </div>
              <div className="divide-y divide-[#eef2f7]">
                {filteredJobs.slice(0, 8).map((job) => {
                  const state = getJobState(job);
                  const toggleKey = `${job.jobId}:toggle`;
                  const triggerKey = `${job.jobId}:trigger`;
                  const detail = formatExecutionProfileLabel(job.executionProfileSummary?.label) || getJobTarget(job);
                  return (
                    <div key={job.jobId} className="grid grid-cols-[minmax(0,2fr)_0.92fr_1fr_0.8fr_1.05fr_220px] gap-3 px-3.5 py-2.5 text-[13px] text-[#0f172a] hover:bg-[#fbfdff]">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{job.name || job.jobId}</div>
                        <div className="mt-1 truncate text-[12px] text-[#64748b]">{detail}</div>
                      </div>
                      <div className="truncate text-[#475569]">{formatSchedulerCadence(job)}</div>
                      <div className="truncate text-[#475569]">{formatTimestamp(job.nextRunAt)}</div>
                      <div>
                        <StatusPill tone={state.tone} label={state.label} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[#475569]">{formatJobResult(job.lastRunResult)}</div>
                        <div className="mt-1 truncate text-[12px] text-[#94a3b8]">{job.lastRunError || formatTimestamp(job.lastRunAt)}</div>
                      </div>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          className="h-8 rounded-[8px] px-2 text-[12px] text-[#2563eb] hover:bg-[#eef4ff] hover:text-[#1d4ed8]"
                          onClick={() => { void handleTriggerJob(job); }}
                          disabled={jobBusyKey === triggerKey}
                        >
                          {jobBusyKey === triggerKey ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
                          立即执行
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-8 rounded-[8px] px-2 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                          onClick={() => { void handleToggleJob(job); }}
                          disabled={jobBusyKey === toggleKey}
                        >
                          {jobBusyKey === toggleKey ? (
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          ) : job.enabled === false ? (
                            <Play className="mr-1.5 h-4 w-4" />
                          ) : (
                            <Pause className="mr-1.5 h-4 w-4" />
                          )}
                          {job.enabled === false ? '启用' : '暂停'}
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-8 rounded-[8px] px-2 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                          onClick={() => openSchedulerStudio(false)}
                        >
                          <ChevronRight className="mr-1.5 h-4 w-4" />
                          调度治理
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="border-t border-[#eef2f7] px-3.5 py-2.5 text-[12px] text-[#64748b]">
                共 {filteredJobs.length} 条匹配任务，支持立即执行、启停控制和进入调度治理。
              </div>
            </div>
          )}
        </OpsPanel>

        <OpsPanel
          title="系统状态"
          subtitle="组件、状态、指标和说明保持同屏，便于快速扫读。"
          actions={(
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                void loadDashboard();
              }}
              className="h-8 w-8 text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0f172a]"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        >
          {filteredSystemRows.length === 0 ? (
            <EmptyState
              title="没有匹配的系统状态"
              body="当前筛选没有命中组件状态，刷新后会恢复默认状态视图。"
              action={(
                <Button
                  variant="outline"
                  onClick={() => {
                    void loadDashboard();
                  }}
                  className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                >
                  刷新状态
                </Button>
              )}
            />
          ) : (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-[12px] border border-[#eef2f7]">
                <div className="grid grid-cols-[minmax(0,1fr)_98px_96px_minmax(0,1.15fr)] gap-3 bg-[#f8fafc] px-3.5 py-2.5 text-[11px] font-semibold text-[#64748b]">
                  <div>组件</div>
                  <div>状态</div>
                  <div>指标</div>
                  <div>说明</div>
                </div>
                <div className="divide-y divide-[#eef2f7]">
                  {filteredSystemRows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_98px_96px_minmax(0,1.15fr)] items-center gap-3 px-3.5 py-2.5">
                      <div className="truncate text-[13px] font-semibold text-[#0f172a]">{row.label}</div>
                      <StatusPill tone={row.tone} label={row.status} />
                      <div className="truncate text-[12px] text-[#475569]">{row.metric}</div>
                      <div className="truncate text-[12px] text-[#64748b]">{row.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
              {overview?.risks?.length ? (
                <div className="rounded-[12px] border border-[#fff1d6] bg-[#fffaf0] px-3 py-2.5 text-[12px] text-[#92400e]">
                  <div className="font-semibold text-[#78350f]">当前风险</div>
                  <div className="mt-1 line-clamp-2">{overview.risks[0]?.title}</div>
                </div>
              ) : null}
            </div>
          )}
        </OpsPanel>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <OpsPanel
          title="MCP / 服务连接"
          subtitle="优先展示已接入的 MCP 服务和入口定位。"
          actions={<StatusPill tone={filteredMcpServers.length ? 'success' : 'neutral'} label={`已接入 ${filteredMcpServers.length}`} />}
        >
          {filteredMcpServers.length === 0 ? (
            <EmptyState title="没有匹配的服务连接" body="配置 MCP 服务后，这里会显示名称、接入方式和入口信息。" />
          ) : (
            <div className="overflow-hidden rounded-[12px] border border-[#eef2f7]">
              <div className="grid grid-cols-[minmax(0,1.05fr)_72px_76px_minmax(0,1fr)] gap-3 bg-[#f8fafc] px-3.5 py-2.5 text-[11px] font-semibold text-[#64748b]">
                <div>服务名称</div>
                <div>接入</div>
                <div>状态</div>
                <div>入口</div>
              </div>
              <div className="divide-y divide-[#eef2f7]">
                {filteredMcpServers.slice(0, 6).map((server) => (
                  <div key={`${server.name}-${server.url || server.command || server.type}`} className="grid grid-cols-[minmax(0,1.05fr)_72px_76px_minmax(0,1fr)] gap-3 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-[#0f172a]">{server.name}</div>
                      <div className="mt-1 truncate text-[12px] text-[#64748b]">{server.description || 'MCP 服务'}</div>
                    </div>
                    <div className="truncate text-[12px] text-[#475569]">{formatServerType(server.type)}</div>
                    <StatusPill tone="success" label="已加载" />
                    <div className="truncate text-[12px] text-[#475569]">{server.url || server.command || '配置文件模式'}</div>
                  </div>
                ))}
              </div>
              <div className="border-t border-[#eef2f7] px-3.5 py-2 text-[11px] text-[#94a3b8]">配置文件：`~/.gemini/antigravity/mcp_config.json`</div>
            </div>
          )}
        </OpsPanel>

        <OpsPanel
          title="额度与配额"
          subtitle="只保留最关键的部门日配额，完整策略留在深层工作台。"
          actions={<StatusPill tone={quotaSummary.totalDaily > 0 ? 'info' : 'neutral'} label={quotaSummary.totalDaily > 0 ? '日配额' : '无限额'} />}
        >
          {filteredQuotaRows.length === 0 ? (
            <EmptyState title="没有匹配的额度信息" body="当前搜索没有命中部门配额，或尚未配置任何额度限制。" />
          ) : (
            <div className="overflow-hidden rounded-[12px] border border-[#eef2f7]">
              <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_124px] gap-3 bg-[#f8fafc] px-3.5 py-2.5 text-[11px] font-semibold text-[#64748b]">
                <div>工作区</div>
                <div>已用</div>
                <div>日限额</div>
                <div>使用率</div>
              </div>
              <div className="divide-y divide-[#eef2f7]">
                {filteredQuotaRows.slice(0, 5).map((quota) => {
                  const workspaceName = quota.workspace.split('/').pop() || quota.workspace;
                  return (
                    <div key={quota.workspace} className="grid grid-cols-[minmax(0,1fr)_72px_72px_124px] items-center gap-3 px-3.5 py-2.5">
                      <div className="truncate text-[13px] font-semibold text-[#0f172a]">{workspaceName}</div>
                      <div className="truncate text-[12px] text-[#475569]">{quota.quota.used.daily.toLocaleString()}</div>
                      <div className="truncate text-[12px] text-[#475569]">{quota.quota.daily > 0 ? quota.quota.daily.toLocaleString() : '无限制'}</div>
                      <QuotaBar used={quota.quota.used.daily} limit={quota.quota.daily} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </OpsPanel>

        <OpsPanel
          title="Tunnel / 网络"
          subtitle="对外通路、自治 loop 和辅助服务入口统一放在这里。"
          actions={<StatusPill tone={tunnelStatus?.running ? 'success' : tunnelStatus?.configured ? 'warning' : 'neutral'} label={tunnelStatus?.running ? '通道在线' : tunnelStatus?.configured ? '已配置' : '未配置'} />}
        >
          {filteredTunnelRows.length === 0 ? (
            <EmptyState title="没有匹配的网络状态" body="当前筛选没有命中通道或自治服务信息。" />
          ) : (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-[12px] border border-[#eef2f7]">
                <div className="grid grid-cols-[minmax(0,0.9fr)_84px_minmax(0,0.9fr)_minmax(0,1fr)] gap-3 bg-[#f8fafc] px-3.5 py-2.5 text-[11px] font-semibold text-[#64748b]">
                  <div>通道</div>
                  <div>状态</div>
                  <div>地址 / 指标</div>
                  <div>说明</div>
                </div>
                <div className="divide-y divide-[#eef2f7]">
                  {filteredTunnelRows.map((row) => (
                    <div key={row.label} className="grid grid-cols-[minmax(0,0.9fr)_84px_minmax(0,0.9fr)_minmax(0,1fr)] items-center gap-3 px-3.5 py-2.5">
                      <div className="truncate text-[13px] font-semibold text-[#0f172a]">{row.label}</div>
                      <StatusPill tone={row.tone} label={row.status} />
                      <div className="truncate text-[12px] text-[#475569]">{row.metric}</div>
                      <div className="truncate text-[12px] text-[#64748b]">{row.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant="outline"
              onClick={onOpenProviderSettings}
              className="h-9 rounded-[10px] border-[#dfe5ee] bg-white text-[#0f172a] hover:bg-[#f8fafc]"
            >
              <Settings2 className="mr-1.5 h-4 w-4" />
              Provider 设置
            </Button>
            <Button
              variant="outline"
              onClick={onOpenApiKeys}
              className="h-9 rounded-[10px] border-[#dfe5ee] bg-white text-[#0f172a] hover:bg-[#f8fafc]"
            >
              <KeyRound className="mr-1.5 h-4 w-4" />
              密钥配置
            </Button>
          </div>
        </OpsPanel>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.9fr)]">
        <OpsPanel
          title="资产管理"
          subtitle="首屏保留标准资产与待导入资产，完整导入和编辑留在资产工作台。"
          actions={(
            <>
              <div className="hidden items-center gap-1 rounded-[10px] bg-[#f8fafc] p-1 md:flex">
                {(['skills', 'workflows', 'rules'] as AssetTab[]).map((tabKey) => {
                  const meta = assetCollections[tabKey];
                  const total = meta.canonical.length + meta.discovered.length;
                  return (
                    <button
                      key={tabKey}
                      type="button"
                      onClick={() => setAssetTab(tabKey)}
                      className={cn(
                        'rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                        assetTab === tabKey
                          ? 'bg-white text-[#2563eb] shadow-[0_4px_12px_rgba(37,99,235,0.12)]'
                          : 'text-[#64748b] hover:text-[#0f172a]',
                      )}
                    >
                      {meta.label} {total}
                    </button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                onClick={openAssetStudio}
                className="h-9 rounded-[10px] border-[#dfe5ee] bg-white text-[#0f172a] hover:bg-[#f8fafc]"
              >
                资产工作台
              </Button>
            </>
          )}
        >
          {assetRows.length === 0 ? (
            <EmptyState
              title="没有匹配的资产"
              body="当前分类或搜索没有命中资产，可以进入资产工作台查看全量内容。"
              action={(
                <Button
                  variant="outline"
                  onClick={openAssetStudio}
                  className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                >
                  打开资产工作台
                </Button>
              )}
            />
          ) : (
            <div className="overflow-hidden rounded-[12px] border border-[#eef2f7]">
              <div className="grid grid-cols-[minmax(0,1.25fr)_88px_88px_76px_minmax(0,1fr)] gap-3 bg-[#f8fafc] px-3.5 py-2.5 text-[11px] font-semibold text-[#64748b]">
                <div>名称</div>
                <div>类型</div>
                <div>状态</div>
                <div>范围</div>
                <div>定位</div>
              </div>
              <div className="divide-y divide-[#eef2f7]">
                {assetRows.map((item) => (
                  <div key={`${item.name}-${item.path}`} className="grid grid-cols-[minmax(0,1.25fr)_88px_88px_76px_minmax(0,1fr)] gap-3 px-3.5 py-2.5 hover:bg-[#fbfdff]">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-[#0f172a]">{item.name}</div>
                      <div className="mt-1 truncate text-[12px] text-[#64748b]">{item.description || item.path}</div>
                    </div>
                    <div className="flex items-center text-[12px] text-[#475569]">
                      {assetCollections[assetTab].icon}
                      <span className="ml-2">{item.kindLabel}</span>
                    </div>
                    <StatusPill tone={item.status.tone} label={item.status.label} />
                    <div className="text-[12px] text-[#475569]">{item.scopeLabel}</div>
                    <div className="truncate text-[12px] text-[#475569]">{item.path}</div>
                  </div>
                ))}
              </div>
              <div className="border-t border-[#eef2f7] px-3.5 py-2.5 text-[12px] text-[#64748b]">
                标准资产 {assetCollections[assetTab].canonical.length} 项，待导入 {assetCollections[assetTab].discovered.length} 项。
              </div>
            </div>
          )}
        </OpsPanel>

        <OpsPanel
          title="最近活动"
          subtitle="自治循环、系统改进和系统审计按时间收口到一个侧栏。"
          actions={<StatusPill tone={recentActivity.length ? 'info' : 'neutral'} label={`${recentActivity.length} 条`} />}
        >
          {recentActivity.length === 0 ? (
            <EmptyState
              title="没有匹配的活动"
              body="当前搜索没有命中最近活动，刷新后会恢复默认时间线。"
              action={(
                <Button
                  variant="outline"
                  onClick={() => {
                    void loadDashboard();
                  }}
                  className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                >
                  刷新活动
                </Button>
              )}
            />
          ) : (
            <div className="space-y-3">
              {recentActivity.map((item) => (
                <div key={item.id} className="flex items-start gap-3 border-b border-[#eef2f7] pb-3 last:border-b-0 last:pb-0">
                  <div className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]', STATUS_TONE_CLASSES[item.tone])}>
                    {item.type === 'loop' ? <Sparkles className="h-4 w-4" /> : item.type === 'proposal' ? <Bot className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-[#0f172a]">{item.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <StatusPill tone={item.tone} label={item.category} />
                      <div className="truncate text-[12px] text-[#64748b]">{item.statusLabel}</div>
                    </div>
                    <div className="mt-1 truncate text-[12px] text-[#64748b]">{item.detail}</div>
                  </div>
                  <div className="shrink-0 text-[11px] text-[#94a3b8]">{formatRelative(item.timestamp)}</div>
                </div>
              ))}
            </div>
          )}
        </OpsPanel>

        <div ref={exitEvidenceRef}>
          <OpsPanel
            title="系统改进发布检查"
            subtitle="这里收口系统改进的执行证据、发布前检查、合并状态和发布后观察。"
            actions={<StatusPill tone={exitEvidenceRows.length ? 'warning' : 'neutral'} label={`${exitEvidenceRows.length} 条`} />}
          >
            {exitEvidenceRows.length === 0 ? (
              <EmptyState
                title="暂无系统改进发布检查"
                body="当前没有进入平台工程执行态的系统改进 proposal。"
              />
            ) : (
              <div className="space-y-3">
                {exitEvidenceRows.map((proposal) => (
                  <div
                    key={proposal.id}
                    className={cn(
                      'rounded-[12px] border bg-[#fbfdff] px-3.5 py-3 transition-colors',
                      highlightedProposalId === proposal.id
                        ? 'border-[#2f6df6] ring-4 ring-[#2f6df6]/10'
                        : 'border-[#eef2f7]',
                    )}
                  >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-[#0f172a]">{proposal.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusPill tone={getProposalMergeGateTone(proposal)} label={formatProposalMergeGateStatus(proposal.exitEvidence?.mergeGate.status)} />
                        <div className="text-[12px] text-[#64748b]">{formatProposalStatus(proposal.status)}</div>
                        <div className="text-[12px] text-[#64748b]">{formatProposalRisk(proposal.risk)}</div>
                      </div>
                    </div>
                    <div className="shrink-0 text-[11px] text-[#94a3b8]">{formatRelative(proposal.updatedAt)}</div>
                  </div>
                  <div className="mt-2 text-[12px] text-[#475569]">{buildProposalEvidenceDetail(proposal)}</div>
                  <div className="mt-1 text-[12px] text-[#64748b]">{buildProposalEvidenceReason(proposal)}</div>
                  {proposal.exitEvidence?.codex ? (
                    <div className="mt-3 overflow-hidden rounded-[10px] border border-[#eef2f7] bg-white">
                      <div className="grid grid-cols-[0.95fr_1.2fr_0.8fr] gap-3 bg-[#f8fafc] px-3 py-2 text-[11px] font-semibold text-[#64748b]">
                        <div>Worktree</div>
                        <div>Scope</div>
                        <div>Validation</div>
                      </div>
                      <div className="grid grid-cols-[0.95fr_1.2fr_0.8fr] gap-3 px-3 py-2 text-[12px] text-[#475569]">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[11px] text-[#0f172a]">{proposal.exitEvidence.codex.branch}</div>
                          <div className="mt-1 truncate text-[11px] text-[#94a3b8]">{proposal.exitEvidence.codex.worktreePath}</div>
                        </div>
                        <div className="min-w-0">
                          <div className="truncate">{proposal.exitEvidence.codex.changedFiles.length} changed · {proposal.exitEvidence.codex.disallowedFiles.length} disallowed</div>
                          <div className="mt-1 truncate text-[11px] text-[#94a3b8]">
                            {proposal.exitEvidence.codex.allowedPathPrefixes.slice(0, 3).join(', ') || 'allowlist missing'}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="truncate">{proposal.exitEvidence.codex.passedValidationCount}/{proposal.exitEvidence.codex.validationCount} passed</div>
                          <div className="mt-1 truncate text-[11px] text-[#94a3b8]">
                            diff {proposal.exitEvidence.codex.diffCheckPassed ? 'ok' : 'failed'} · scope {proposal.exitEvidence.codex.scopeCheckPassed ? 'ok' : 'failed'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 overflow-hidden rounded-[10px] border border-[#e6edf6] bg-white">
                    <div className="flex items-center justify-between gap-3 bg-[#f8fafc] px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-[#64748b]">发布检查</div>
                        <div className="mt-0.5 truncate text-[12px] text-[#475569]">
                          {buildReleaseGateDetail(proposal.exitEvidence?.releaseGate)}
                        </div>
                      </div>
                      <StatusPill
                        tone={getProposalReleaseTone(proposal.exitEvidence?.releaseGate?.status)}
                        label={formatProposalReleaseStatus(proposal.exitEvidence?.releaseGate?.status)}
                      />
                    </div>
                    {proposal.exitEvidence?.releaseGate ? (
                      <div className="grid gap-3 px-3 py-2 text-[12px] text-[#475569] lg:grid-cols-[1fr_1fr]">
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">检查项</div>
                          <div className="mt-1 space-y-1">
                            {proposal.exitEvidence.releaseGate.checks.slice(0, 4).map((item) => (
                              <div key={`${proposal.id}-${item.label}`} className="flex items-center justify-between gap-2">
                                <span className="truncate">{item.label}</span>
                                <span className={cn(
                                  'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                                  item.status === 'passed' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600',
                                )}>
                                  {item.status === 'passed' ? 'passed' : 'failed'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">操作命令</div>
                          <div className="mt-1 space-y-1 font-mono text-[11px] text-[#64748b]">
                            <div className="truncate">merge: {proposal.exitEvidence.releaseGate.commands.mergeCommand}</div>
                            <div className="truncate">verify: {proposal.exitEvidence.releaseGate.commands.verifyCommand}</div>
                            <div className="truncate">restart: {proposal.exitEvidence.releaseGate.commands.restartCommand}</div>
                            <div className="truncate">rollback: {proposal.exitEvidence.releaseGate.commands.rollbackCommand}</div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {proposal.exitEvidence?.project?.projectId ? (
                      <Button
                        variant="outline"
                        onClick={() => onNavigateToProject?.(proposal.exitEvidence!.project!.projectId)}
                        className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                      >
                        查看项目执行
                      </Button>
                    ) : null}
                    {onOpenImprovementProposal ? (
                      <Button
                        variant="outline"
                        onClick={() => onOpenImprovementProposal(proposal.id)}
                        className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                      >
                        查看完整详情
                      </Button>
                    ) : null}
                    {proposal.status === 'approved' && !proposal.exitEvidence?.codex ? (
                      <Button
                        variant="outline"
                        disabled={proposalBusyKey === `${proposal.id}:codex`}
                        onClick={() => { void handleRunCodexProposal(proposal); }}
                        className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                      >
                        {proposalBusyKey === `${proposal.id}:codex` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
                        启动 Codex
                      </Button>
                    ) : null}
                    {proposal.exitEvidence?.mergeGate.status === 'blocked' ? (
                      <Button
                        variant="outline"
                        disabled={proposalBusyKey === `${proposal.id}:codex`}
                        onClick={() => { void handleRunCodexProposal(proposal, true); }}
                        className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                      >
                        {proposalBusyKey === `${proposal.id}:codex` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                        重跑 Codex
                      </Button>
                    ) : null}
                    {proposal.exitEvidence?.mergeGate.status === 'ready-to-merge' ? (
                      <Button
                        variant="outline"
                        disabled={proposalBusyKey === `${proposal.id}:preflight`}
                        onClick={() => { void handleReleaseGateAction(proposal, 'preflight'); }}
                        className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                      >
                        {proposalBusyKey === `${proposal.id}:preflight` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                        发布前检查
                      </Button>
                    ) : null}
                    {proposal.exitEvidence?.releaseGate?.status === 'ready-for-approval' ? (
                      <Button
                        variant="outline"
                        disabled={proposalBusyKey === `${proposal.id}:approve`}
                        onClick={() => { void handleReleaseGateAction(proposal, 'approve'); }}
                        className="h-8 rounded-[9px] border-emerald-200 bg-emerald-50 px-3 text-[12px] text-emerald-700 hover:bg-emerald-100"
                      >
                        {proposalBusyKey === `${proposal.id}:approve` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-1.5 h-4 w-4" />}
                        批准发布
                      </Button>
                    ) : null}
                    {proposal.exitEvidence?.releaseGate?.status === 'approved' ? (
                      <Button
                        variant="outline"
                        disabled={proposalBusyKey === `${proposal.id}:mark-merged`}
                        onClick={() => { void handleReleaseGateAction(proposal, 'mark-merged'); }}
                        className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                      >
                        {proposalBusyKey === `${proposal.id}:mark-merged` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitMerge className="mr-1.5 h-4 w-4" />}
                        标记已合并
                      </Button>
                    ) : null}
                    {proposal.exitEvidence?.releaseGate?.status === 'merged' ? (
                      <Button
                        variant="outline"
                        disabled={proposalBusyKey === `${proposal.id}:mark-restarted`}
                        onClick={() => { void handleReleaseGateAction(proposal, 'mark-restarted'); }}
                        className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                      >
                        {proposalBusyKey === `${proposal.id}:mark-restarted` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                        标记已重启
                      </Button>
                    ) : null}
                    {proposal.exitEvidence?.releaseGate?.status === 'restarted' ? (
                      <Button
                        variant="outline"
                        disabled={proposalBusyKey === `${proposal.id}:start-observation`}
                        onClick={() => { void handleReleaseGateAction(proposal, 'start-observation'); }}
                        className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                      >
                        {proposalBusyKey === `${proposal.id}:start-observation` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Radio className="mr-1.5 h-4 w-4" />}
                        开始观察
                      </Button>
                    ) : null}
                    {proposal.exitEvidence?.releaseGate && ['approved', 'merged', 'restarted', 'observing'].includes(proposal.exitEvidence.releaseGate.status) ? (
                      <Button
                        variant="outline"
                        disabled={proposalBusyKey === `${proposal.id}:mark-rolled-back`}
                        onClick={() => { void handleReleaseGateAction(proposal, 'mark-rolled-back'); }}
                        className="h-8 rounded-[9px] border-red-100 bg-white px-3 text-[12px] text-red-600 hover:bg-red-50"
                      >
                        {proposalBusyKey === `${proposal.id}:mark-rolled-back` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}
                        标记回滚
                      </Button>
                    ) : null}
                  {proposal.exitEvidence?.codex?.evidencePath ? (
                    <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#64748b]">
                      evidence {proposal.exitEvidence.codex.evidencePath.split('/').pop()}
                      </span>
                    ) : null}
                  </div>
                  </div>
                ))}
              </div>
            )}
          </OpsPanel>
        </div>
      </div>

      <OpsPanel
        title="深层工作台"
        subtitle="完整任务编辑、资产导入和统计工具统一从一个入口进入，不再拆成三段旧附录区。"
        actions={(
          <>
            <div className="hidden items-center gap-1 rounded-[10px] bg-[#f8fafc] p-1 md:flex">
              {([
                { key: 'scheduler', label: '调度治理' },
                { key: 'assets', label: '资产工作台' },
                { key: 'toolbox', label: '扩展工具' },
              ] as Array<{ key: DeepWorkspaceTab; label: string }>).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setDeepWorkspaceTab(item.key)}
                  className={cn(
                    'rounded-[8px] px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                    deepWorkspaceTab === item.key
                      ? 'bg-white text-[#2563eb] shadow-[0_4px_12px_rgba(37,99,235,0.12)]'
                      : 'text-[#64748b] hover:text-[#0f172a]',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {deepWorkspaceTab ? (
              <Button
                variant="ghost"
                onClick={() => setDeepWorkspaceTab(null)}
                className="h-9 rounded-[10px] px-3 text-[#0f172a] hover:bg-[#f8fafc]"
              >
                收起
              </Button>
            ) : null}
          </>
        )}
      >
        <div ref={deepWorkspaceRef}>
          {deepWorkspaceTab === 'scheduler' ? (
            <SchedulerPanel createRequestToken={createJobRequestToken} />
          ) : deepWorkspaceTab === 'assets' ? (
            <AssetsManager
              workflows={workflows}
              skills={skills}
              rules={rules}
              discoveredWorkflows={discoveredWorkflows}
              discoveredSkills={discoveredSkills}
              discoveredRules={discoveredRules}
              requestedTab={requestedTab}
              requestedItemName={requestedItemName}
              requestToken={requestToken}
              onRefresh={onRefreshAssets}
            />
          ) : deepWorkspaceTab === 'toolbox' ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
              <AnalyticsDashboard />
              <div className="space-y-4">
                <div className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-3.5 py-3.5">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-[#0f172a]">
                    <Network className="h-4 w-4 text-[#2563eb]" />
                    连接与能力入口
                  </div>
                  <div className="mt-3 grid gap-2">
                    <Button
                      variant="outline"
                      onClick={onOpenProviderSettings}
                      className="justify-between rounded-[10px] border-[#dfe5ee] bg-white text-[#0f172a] hover:bg-[#f8fafc]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Settings2 className="h-4 w-4" />
                        Provider 设置
                      </span>
                      <ArrowUpRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      onClick={onOpenApiKeys}
                      className="justify-between rounded-[10px] border-[#dfe5ee] bg-white text-[#0f172a] hover:bg-[#f8fafc]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <KeyRound className="h-4 w-4" />
                        密钥配置
                      </span>
                      <ArrowUpRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => openSchedulerStudio(false)}
                      className="justify-between rounded-[10px] border-[#dfe5ee] bg-white text-[#0f172a] hover:bg-[#f8fafc]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <FolderKanban className="h-4 w-4" />
                        打开调度治理
                      </span>
                      <ArrowUpRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      onClick={openAssetStudio}
                      className="justify-between rounded-[10px] border-[#dfe5ee] bg-white text-[#0f172a] hover:bg-[#f8fafc]"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Waypoints className="h-4 w-4" />
                        打开资产工作台
                      </span>
                      <ArrowUpRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CodexWidget />
              </div>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-3">
              {[
                {
                  key: 'scheduler' as const,
                  title: '调度治理',
                  detail: '保留自治循环、经营信号、自我改进和任务编辑弹窗。',
                  stats: [
                    `${attentionJobs.length} 项需关注`,
                    `${openBreakers.length} 个熔断器`,
                    `${budgetLedger.length} 条预算记录`,
                  ],
                },
                {
                  key: 'assets' as const,
                  title: '资产工作台',
                  detail: '完整保留标准资产与待导入资产的导入、编辑、删除与定位。',
                  stats: [
                    `${workflows.length} 个工作流`,
                    `${skills.length} 个技能`,
                    `${discoveredSkills.length + discoveredWorkflows.length + discoveredRules.length} 项待导入`,
                  ],
                },
                {
                  key: 'toolbox' as const,
                  title: '扩展工具',
                  detail: '统计分析、连接入口和本地 Codex 工具统一下沉到这一层。',
                  stats: [
                    '分析视图已后移',
                    '连接入口集中',
                    '本地工具保留',
                  ],
                },
              ].map((item) => (
                <div key={item.key} className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-3.5 py-3">
                  <div className="text-[13px] font-semibold text-[#0f172a]">{item.title}</div>
                  <div className="mt-1 text-[12px] leading-5 text-[#64748b]">{item.detail}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.stats.map((stat) => (
                      <span key={stat} className="inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#64748b]">
                        {stat}
                      </span>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setDeepWorkspaceTab(item.key)}
                    className="mt-3 h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                  >
                    打开 {item.title}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </OpsPanel>
    </div>
  );
}
