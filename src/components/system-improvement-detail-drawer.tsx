'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  CheckCircle2,
  FileCode2,
  GitMerge,
  GitPullRequest,
  Loader2,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TestTube2,
  Waypoints,
  XCircle,
} from 'lucide-react';

import { api } from '@/lib/api';
import type { SystemImprovementProposalFE, SystemImprovementReleaseActionFE } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

interface SystemImprovementDetailDrawerProps {
  open: boolean;
  proposalId: string | null;
  onOpenChange: (open: boolean) => void;
  onNavigateToProject?: (projectId: string | null) => void;
  onOpenOps?: (options?: { proposalId?: string; query?: string }) => void;
  onRefresh?: () => void;
}

const toneClasses: Record<StatusTone, string> = {
  neutral: 'bg-[#f3f4f6] text-[#64748b]',
  info: 'bg-[#eef4ff] text-[#2563eb]',
  success: 'bg-[#ecfdf5] text-[#059669]',
  warning: 'bg-[#fff7ed] text-[#d97706]',
  danger: 'bg-[#fef2f2] text-[#dc2626]',
};

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

function formatRisk(risk: SystemImprovementProposalFE['risk']): string {
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

function getRiskTone(risk: SystemImprovementProposalFE['risk']): StatusTone {
  if (risk === 'critical' || risk === 'high') return 'danger';
  if (risk === 'medium') return 'warning';
  return 'success';
}

function getProposalStatusTone(status: SystemImprovementProposalFE['status']): StatusTone {
  switch (status) {
    case 'approval-required':
    case 'needs-evidence':
    case 'testing':
    case 'in-progress':
      return 'warning';
    case 'rejected':
    case 'rolled-back':
      return 'danger';
    case 'approved':
    case 'ready-to-merge':
    case 'published':
    case 'observing':
      return 'success';
    default:
      return 'neutral';
  }
}

function formatMergeStatus(proposal: SystemImprovementProposalFE): string {
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

function getMergeTone(proposal: SystemImprovementProposalFE): StatusTone {
  if (proposal.exitEvidence?.mergeGate.status === 'ready-to-merge') return 'success';
  if (proposal.exitEvidence?.mergeGate.status === 'blocked') return 'danger';
  if (proposal.status === 'testing' || proposal.status === 'in-progress') return 'warning';
  return 'neutral';
}

function formatReleaseStatus(proposal: SystemImprovementProposalFE): string | null {
  switch (proposal.exitEvidence?.releaseGate?.status) {
    case 'preflight-failed':
      return '发布前检查失败';
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
      return '未执行发布检查';
    default:
      return null;
  }
}

function getReleaseTone(proposal: SystemImprovementProposalFE): StatusTone {
  switch (proposal.exitEvidence?.releaseGate?.status) {
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

function extractProjectId(proposal: SystemImprovementProposalFE): string | null {
  if (proposal.exitEvidence?.project?.projectId) {
    return proposal.exitEvidence.project.projectId;
  }
  const value = proposal.metadata?.improvementProjectId;
  return typeof value === 'string' && value ? value : null;
}

function extractCurrentActionHint(proposal: SystemImprovementProposalFE): string {
  if (proposal.status === 'approval-required') {
    return '这条系统改进还在等待管理决策。批准后会自动启动平台工程执行。';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'preflight-failed') {
    return '发布前检查失败，先看失败项，再决定是否重跑 Codex 或修正补丁。';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'ready-for-approval') {
    return '代码、范围和验证已形成发布检查结果，现在可以决定是否批准发布。';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'approved') {
    return '这条改进已批准发布，下一步是完成合并。';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'merged') {
    return '代码已经合并，下一步是重启并补充健康检查记录。';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'restarted') {
    return '服务已重启，下一步是进入发布后观察。';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'observing') {
    return '当前处于发布后观察期，确认没有回归后即可收口。';
  }
  if (proposal.exitEvidence?.mergeGate.status === 'blocked') {
    return '当前执行证据还不够，先看阻塞原因，再决定是否重跑 Codex。';
  }
  if (proposal.exitEvidence?.mergeGate.status === 'ready-to-merge') {
    return '执行阶段已经跑通，下一步是做发布前检查。';
  }
  if (proposal.status === 'approved' && !proposal.exitEvidence?.codex) {
    return '提案已批准，但还没有启动平台工程执行。';
  }
  return '当前可以先看改动范围和发布检查，再决定下一步。';
}

function buildDecisionTitle(proposal: SystemImprovementProposalFE): string {
  if (proposal.status === 'approval-required') {
    return '是否批准这条系统改进进入平台工程执行？';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'preflight-failed') {
    return '是否继续修补失败项并重跑发布前检查？';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'ready-for-approval') {
    return '发布检查已通过，是否批准发布？';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'approved') {
    return '发布已批准，是否确认合并完成？';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'merged') {
    return '代码已合并，是否确认已重启？';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'restarted') {
    return '服务已重启，是否开始观察？';
  }
  if (proposal.exitEvidence?.mergeGate.status === 'blocked') {
    return '执行被阻塞，是否让 AI 重新生成并校验补丁？';
  }
  if (proposal.exitEvidence?.mergeGate.status === 'ready-to-merge') {
    return '执行阶段已完成，是否发起发布前检查？';
  }
  if (proposal.status === 'approved' && !proposal.exitEvidence?.codex) {
    return '提案已批准，是否启动平台工程执行？';
  }
  return '是否继续推进这条系统改进？';
}

function buildActionEffect(proposal: SystemImprovementProposalFE): string {
  if (proposal.status === 'approval-required') {
    return '批准后会自动立项或复用平台工程项目，并启动首轮执行。';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'preflight-failed') {
    return '重跑后会重新验证 patch、merge、restart 和 rollback 这条发布链。';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'ready-for-approval') {
    return '批准发布后会进入合并确认阶段，并继续保留回滚入口。';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'approved') {
    return '确认合并后，这条改进会进入重启确认。';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'merged') {
    return '确认重启后，这条改进会进入观察阶段。';
  }
  if (proposal.exitEvidence?.releaseGate?.status === 'restarted') {
    return '开始观察后，系统会把这次发布切入发布后观察状态。';
  }
  if (proposal.exitEvidence?.mergeGate.status === 'blocked') {
    return '重跑 Codex 会在现有范围内重新生成补丁并再次做 scope / diff 校验。';
  }
  if (proposal.exitEvidence?.mergeGate.status === 'ready-to-merge') {
    return '发起发布前检查后，会补齐发布链路里的失败项和阻塞项。';
  }
  if (proposal.status === 'approved' && !proposal.exitEvidence?.codex) {
    return '启动后会直接进入平台工程执行，而不是停留在提案态。';
  }
  return '执行当前动作后，系统会把状态推进到下一阶段。';
}

function buildScopeSummary(scopeFiles: string[], protectedAreas: string[]): string {
  const parts: string[] = [];
  if (scopeFiles.length) parts.push(`影响 ${scopeFiles.length} 个文件`);
  if (protectedAreas.length) parts.push(`${protectedAreas.length} 个保护范围`);
  if (!parts.length) return '当前还没有明确的影响范围。';
  return parts.join('，');
}

function buildOutcomeSummary(proposal: SystemImprovementProposalFE, releaseChecksCount: number, passedReleaseChecks: number): string {
  const parts: string[] = [];
  if (proposal.exitEvidence?.project) {
    parts.push(`平台工程项目 ${proposal.exitEvidence.project.status}`);
  }
  if (proposal.exitEvidence?.latestRun) {
    parts.push(`最近执行 ${proposal.exitEvidence.latestRun.status}`);
  }
  if (proposal.exitEvidence?.codex) {
    parts.push(`Codex 校验 ${proposal.exitEvidence.codex.passedValidationCount}/${proposal.exitEvidence.codex.validationCount}`);
  }
  if (proposal.exitEvidence?.testing?.evidenceCount) {
    parts.push(`测试 ${proposal.exitEvidence.testing.passedCount}/${proposal.exitEvidence.testing.evidenceCount}`);
  }
  if (releaseChecksCount) {
    parts.push(`发布检查 ${passedReleaseChecks}/${releaseChecksCount}`);
  }
  if (!parts.length) return '当前还没有形成执行结果。';
  return parts.join('，');
}

function formatCompactPath(path: string): string {
  if (!path) return path;
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 4) return normalized;
  return parts.slice(-4).join('/');
}

function DrawerPill({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold', toneClasses[tone])}>
      {label}
    </span>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border border-[#dfe5ee] bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
      <div className="text-[14px] font-semibold text-[#0f172a]">{title}</div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ListBlock({
  title,
  items,
  emptyLabel,
  mono = false,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">{title}</div>
      <div className="mt-2 space-y-1.5">
        {items.length ? items.map((item) => (
          <div
            key={`${title}-${item}`}
            className={cn(
              'text-[13px] leading-6 text-[#334155]',
              mono && 'break-all font-mono text-[11px] text-[#475569]',
            )}
          >
            {item}
          </div>
        )) : (
          <div className="text-[12px] text-[#94a3b8]">{emptyLabel}</div>
        )}
      </div>
    </div>
  );
}

export default function SystemImprovementDetailDrawer({
  open,
  proposalId,
  onOpenChange,
  onNavigateToProject,
  onOpenOps,
  onRefresh,
}: SystemImprovementDetailDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<SystemImprovementProposalFE | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadProposal = useCallback(async () => {
    if (!open || !proposalId) {
      setProposal(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextProposal = await api.systemImprovementProposal(proposalId);
      setProposal(nextProposal);
    } catch (err) {
      setProposal(null);
      setError(err instanceof Error ? err.message : '当前无法读取系统改进详情。');
    } finally {
      setLoading(false);
    }
  }, [open, proposalId]);

  useEffect(() => {
    void loadProposal();
  }, [loadProposal]);

  const handleProposalChange = useCallback((nextProposal: SystemImprovementProposalFE | null) => {
    setProposal(nextProposal);
    onRefresh?.();
  }, [onRefresh]);

  const handleProposalApproval = useCallback(async (action: 'approved' | 'rejected') => {
    if (!proposal?.approvalRequestId) return;
    setBusyAction(action);
    setError(null);
    try {
      await api.respondApproval(
        proposal.approvalRequestId,
        action,
        action === 'approved'
          ? '从系统改进详情页批准并启动执行。'
          : '从系统改进详情页拒绝。',
      );
      const nextProposal = await api.systemImprovementProposal(proposal.id);
      handleProposalChange(nextProposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : '审批处理失败。');
    } finally {
      setBusyAction(null);
    }
  }, [handleProposalChange, proposal]);

  const handleRunCodex = useCallback(async (force = false) => {
    if (!proposal) return;
    setBusyAction(force ? 'rerun-codex' : 'run-codex');
    setError(null);
    try {
      const response = await api.runSystemImprovementCodexProposal(proposal.id, force ? { force: true } : undefined);
      handleProposalChange(response.proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Codex 执行失败。');
    } finally {
      setBusyAction(null);
    }
  }, [handleProposalChange, proposal]);

  const handleReleaseGate = useCallback(async (action: SystemImprovementReleaseActionFE) => {
    if (!proposal) return;
    setBusyAction(action);
    setError(null);
    try {
      const response = await api.runSystemImprovementReleaseGateAction(proposal.id, {
        action,
        actor: 'CEO',
        note: action === 'approve' ? 'CEO 在系统改进详情页批准发布。' : undefined,
        observationSummary: action === 'start-observation' ? '从系统改进详情页进入发布后观察。' : undefined,
        rollbackReason: action === 'mark-rolled-back' ? '从系统改进详情页标记回滚。' : undefined,
        healthCheckSummary: action === 'mark-restarted' ? '从系统改进详情页标记重启完成。' : undefined,
      });
      handleProposalChange(response.proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布动作执行失败。');
    } finally {
      setBusyAction(null);
    }
  }, [handleProposalChange, proposal]);

  const projectId = proposal ? extractProjectId(proposal) : null;
  const decisionTitle = useMemo(() => proposal ? buildDecisionTitle(proposal) : '', [proposal]);
  const currentHint = useMemo(() => proposal ? extractCurrentActionHint(proposal) : '', [proposal]);
  const actionEffect = useMemo(() => proposal ? buildActionEffect(proposal) : '', [proposal]);
  const validationSummary = proposal?.exitEvidence?.codex
    ? `${proposal.exitEvidence.codex.passedValidationCount}/${proposal.exitEvidence.codex.validationCount}`
    : '—';
  const proposalStatusLabel = proposal ? formatProposalStatus(proposal.status) : '';
  const releaseStatusLabel = proposal ? (formatReleaseStatus(proposal) || '未执行发布检查') : '—';
  const primaryStatusLabel = proposal
    ? (releaseStatusLabel !== '未执行发布检查'
      ? releaseStatusLabel
      : proposal.status === 'ready-to-merge'
        ? formatMergeStatus(proposal)
        : proposalStatusLabel)
    : '—';
  const primaryStatusTone = proposal
    ? (releaseStatusLabel !== '未执行发布检查'
      ? getReleaseTone(proposal)
      : proposal.status === 'ready-to-merge'
        ? getMergeTone(proposal)
        : getProposalStatusTone(proposal.status))
    : 'neutral';
  const scopeFiles = proposal?.affectedFiles.length
    ? proposal.affectedFiles
    : (proposal?.exitEvidence?.codex?.changedFiles ?? []);
  const releaseChecks = proposal?.exitEvidence?.releaseGate?.checks ?? [];
  const passedReleaseChecks = releaseChecks.filter((item) => item.status === 'passed').length;
  const failedReleaseChecks = releaseChecks.filter((item) => item.status === 'failed');
  const summaryFacts = [
    `${proposal?.sourceSignalIds.length || 0} 个信号 / ${proposal?.evidenceRefs.length || 0} 份证据`,
    scopeFiles.length ? `影响 ${scopeFiles.length} 个文件` : null,
    proposal?.exitEvidence?.codex ? `校验 ${validationSummary} 通过` : null,
    releaseChecks.length ? `发布检查 ${passedReleaseChecks}/${releaseChecks.length}` : null,
  ].filter(Boolean) as string[];
  const scopeSummary = buildScopeSummary(scopeFiles, proposal?.protectedAreas ?? []);
  const outcomeSummary = proposal
    ? buildOutcomeSummary(proposal, releaseChecks.length, passedReleaseChecks)
    : '';
  const canShowProjectAction = Boolean(projectId);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-[min(1440px,92vw)] data-[side=right]:sm:max-w-[min(1440px,92vw)] border-l border-[#dfe5ee] bg-[#f7f9fc] p-0"
      >
        <SheetHeader className="border-b border-[#dfe5ee] bg-white px-6 py-5">
          <SheetTitle className="max-w-[980px] pr-12 text-[26px] font-semibold leading-[1.25] text-[#0f172a]">
            {proposal?.title || '系统改进详情'}
          </SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[#64748b]" />
            </div>
          ) : error ? (
            <SectionCard title="读取失败">
              <div className="rounded-[12px] border border-red-100 bg-red-50 px-4 py-3 text-[13px] leading-6 text-red-700">
                {error}
              </div>
            </SectionCard>
          ) : proposal ? (
            <div className="space-y-5">
              <section className="rounded-[18px] border border-[#dfe5ee] bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="min-w-0 flex items-start gap-3">
                    <span className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#eef4ff] text-[#2563eb]">
                      <Waypoints className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <DrawerPill tone={primaryStatusTone} label={primaryStatusLabel} />
                        <DrawerPill tone={getRiskTone(proposal.risk)} label={formatRisk(proposal.risk)} />
                      </div>
                      <div className="mt-4 text-[22px] font-semibold leading-9 text-[#0f172a]">{decisionTitle}</div>
                      <div className="mt-2 text-[14px] leading-7 text-[#64748b]">{currentHint}</div>
                      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[13px] leading-6 text-[#64748b]">
                        {summaryFacts.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                      {proposal.exitEvidence?.mergeGate.reasons?.length ? (
                        <div className="mt-4 rounded-[12px] border border-amber-100 bg-amber-50 px-4 py-3 text-[13px] leading-6 text-amber-800">
                          {proposal.exitEvidence.mergeGate.reasons[0]}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <aside className="space-y-4 xl:self-start">
                    <SectionCard title="当前操作">
                      <div className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-4 py-3 text-[13px] leading-6 text-[#475569]">
                        {actionEffect}
                      </div>
                      <div className="space-y-2">
                        {proposal.status === 'approval-required' && proposal.approvalRequestId ? (
                          <>
                            <Button
                              disabled={busyAction === 'approved'}
                              onClick={() => { void handleProposalApproval('approved'); }}
                              className="h-10 w-full justify-start gap-2 rounded-[10px] bg-[#2f6df6] px-4 text-white hover:bg-[#245ee8]"
                            >
                              {busyAction === 'approved' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                              批准并启动
                            </Button>
                            <Button
                              variant="outline"
                              disabled={busyAction === 'rejected'}
                              onClick={() => { void handleProposalApproval('rejected'); }}
                              className="h-10 w-full justify-start gap-2 rounded-[10px] border-red-200 bg-white px-4 text-red-600 hover:bg-red-50"
                            >
                              {busyAction === 'rejected' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                              拒绝提案
                            </Button>
                          </>
                        ) : null}

                        {proposal.status === 'approved' && !proposal.exitEvidence?.codex ? (
                          <Button
                            variant="outline"
                            disabled={busyAction === 'run-codex'}
                            onClick={() => { void handleRunCodex(false); }}
                            className="h-10 w-full justify-start gap-2 rounded-[10px] border-[#dfe5ee] bg-white px-4 text-[#0f172a] hover:bg-[#f8fafc]"
                          >
                            {busyAction === 'run-codex' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            启动 Codex
                          </Button>
                        ) : null}

                        {proposal.exitEvidence?.mergeGate.status === 'blocked' ? (
                          <Button
                            variant="outline"
                            disabled={busyAction === 'rerun-codex'}
                            onClick={() => { void handleRunCodex(true); }}
                            className="h-10 w-full justify-start gap-2 rounded-[10px] border-[#dfe5ee] bg-white px-4 text-[#0f172a] hover:bg-[#f8fafc]"
                          >
                            {busyAction === 'rerun-codex' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            重跑 Codex
                          </Button>
                        ) : null}

                        {proposal.exitEvidence?.mergeGate.status === 'ready-to-merge' ? (
                          <Button
                            variant="outline"
                            disabled={busyAction === 'preflight'}
                            onClick={() => { void handleReleaseGate('preflight'); }}
                            className="h-10 w-full justify-start gap-2 rounded-[10px] border-[#dfe5ee] bg-white px-4 text-[#0f172a] hover:bg-[#f8fafc]"
                          >
                            {busyAction === 'preflight' ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
                            发布前检查
                          </Button>
                        ) : null}

                        {proposal.exitEvidence?.releaseGate?.status === 'ready-for-approval' ? (
                          <Button
                            disabled={busyAction === 'approve'}
                            onClick={() => { void handleReleaseGate('approve'); }}
                            className="h-10 w-full justify-start gap-2 rounded-[10px] bg-[#2f6df6] px-4 text-white hover:bg-[#245ee8]"
                          >
                            {busyAction === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitPullRequest className="h-4 w-4" />}
                            批准发布
                          </Button>
                        ) : null}

                        {proposal.exitEvidence?.releaseGate?.status === 'approved' ? (
                          <Button
                            variant="outline"
                            disabled={busyAction === 'mark-merged'}
                            onClick={() => { void handleReleaseGate('mark-merged'); }}
                            className="h-10 w-full justify-start gap-2 rounded-[10px] border-[#dfe5ee] bg-white px-4 text-[#0f172a] hover:bg-[#f8fafc]"
                          >
                            {busyAction === 'mark-merged' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                            标记已合并
                          </Button>
                        ) : null}

                        {proposal.exitEvidence?.releaseGate?.status === 'merged' ? (
                          <Button
                            variant="outline"
                            disabled={busyAction === 'mark-restarted'}
                            onClick={() => { void handleReleaseGate('mark-restarted'); }}
                            className="h-10 w-full justify-start gap-2 rounded-[10px] border-[#dfe5ee] bg-white px-4 text-[#0f172a] hover:bg-[#f8fafc]"
                          >
                            {busyAction === 'mark-restarted' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                            标记已重启
                          </Button>
                        ) : null}

                        {proposal.exitEvidence?.releaseGate?.status === 'restarted' ? (
                          <Button
                            variant="outline"
                            disabled={busyAction === 'start-observation'}
                            onClick={() => { void handleReleaseGate('start-observation'); }}
                            className="h-10 w-full justify-start gap-2 rounded-[10px] border-[#dfe5ee] bg-white px-4 text-[#0f172a] hover:bg-[#f8fafc]"
                          >
                            {busyAction === 'start-observation' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                            开始观察
                          </Button>
                        ) : null}

                        {proposal.exitEvidence?.releaseGate && ['approved', 'merged', 'restarted', 'observing'].includes(proposal.exitEvidence.releaseGate.status) ? (
                          <Button
                            variant="outline"
                            disabled={busyAction === 'mark-rolled-back'}
                            onClick={() => { void handleReleaseGate('mark-rolled-back'); }}
                            className="h-10 w-full justify-start gap-2 rounded-[10px] border-red-200 bg-white px-4 text-red-600 hover:bg-red-50"
                          >
                            {busyAction === 'mark-rolled-back' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                            标记回滚
                          </Button>
                        ) : null}
                      </div>

                      <div className="mt-4 border-t border-[#eef2f7] pt-4">
                        <div className="space-y-2">
                          {canShowProjectAction ? (
                            <Button
                              variant="outline"
                              onClick={() => {
                                onOpenChange(false);
                                onNavigateToProject?.(projectId);
                              }}
                              className="h-10 w-full justify-start gap-2 rounded-[10px] border-[#dfe5ee] bg-white px-4 text-[#0f172a] hover:bg-[#f8fafc]"
                            >
                              查看项目执行
                            </Button>
                          ) : null}

                          <Button
                            variant="outline"
                            onClick={() => {
                              onOpenChange(false);
                              onOpenOps?.({ proposalId: proposal.id, query: proposal.title });
                            }}
                            className="h-10 w-full justify-start gap-2 rounded-[10px] border-[#dfe5ee] bg-white px-4 text-[#0f172a] hover:bg-[#f8fafc]"
                          >
                            打开 Ops 发布检查
                          </Button>
                        </div>
                      </div>
                    </SectionCard>
                  </aside>
                </div>
              </section>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-4">
                  <SectionCard title="决策依据">
                    <div className="grid gap-5 lg:grid-cols-3">
                      <div className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">为什么会出现</div>
                        <div className="mt-2 text-[13px] leading-6 text-[#334155]">
                          {proposal.sourceSignalIds.length} 个信号触发，已附 {proposal.evidenceRefs.length} 份证据，当前风险为 {formatRisk(proposal.risk)}。
                        </div>
                      </div>
                      <div className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">这次会改什么</div>
                        <div className="mt-2 text-[13px] leading-6 text-[#334155]">{proposal.summary}</div>
                        <div className="mt-2 text-[12px] leading-5 text-[#64748b]">{scopeSummary}</div>
                      </div>
                      <div className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">现在进行到哪</div>
                        <div className="mt-2 text-[13px] leading-6 text-[#334155]">{outcomeSummary}</div>
                      </div>
                    </div>

                    <div className="mt-5 rounded-[12px] border border-[#eef2f7] bg-white px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">发布检查结果</div>
                      {failedReleaseChecks.length ? (
                        <div className="mt-3 space-y-3">
                          {failedReleaseChecks.map((item) => (
                            <div key={`${proposal.id}-${item.label}`} className="rounded-[12px] border border-red-100 bg-red-50 px-4 py-3">
                              <div className="text-[13px] font-semibold text-red-700">{item.label}</div>
                              <div className="mt-1 text-[12px] leading-6 text-red-700">{item.detail}</div>
                              {item.command ? (
                                <div className="mt-2 break-all font-mono text-[11px] leading-5 text-red-700">
                                  {item.command}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : releaseChecks.length ? (
                        <div className="mt-3 rounded-[12px] border border-[#dcfce7] bg-[#f0fdf4] px-4 py-3 text-[13px] leading-6 text-[#166534]">
                          当前没有失败项，发布检查 {passedReleaseChecks}/{releaseChecks.length} 通过。
                        </div>
                      ) : (
                        <div className="mt-3 rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-4 py-3 text-[13px] leading-6 text-[#64748b]">
                          当前还没有发布检查结果。
                        </div>
                      )}
                    </div>
                  </SectionCard>

                  <Collapsible className="rounded-[14px] border border-[#dfe5ee] bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-[14px] font-semibold text-[#0f172a]">
                        <FileCode2 className="h-4 w-4 text-[#2563eb]" />
                        查看技术证据
                      </div>
                      <CollapsibleTrigger className="inline-flex items-center gap-1 text-[12px] font-medium text-[#64748b]">
                        展开
                        <ChevronDown className="h-4 w-4" />
                      </CollapsibleTrigger>
                    </div>

                    <CollapsibleContent className="mt-5 space-y-5">
                      <div className="grid gap-6 lg:grid-cols-2">
                        <ListBlock title="受影响文件" items={scopeFiles.map(formatCompactPath)} emptyLabel="当前还没有明确受影响文件。" mono />
                        <ListBlock title="保护范围" items={proposal.protectedAreas} emptyLabel="当前没有额外保护范围。" />
                        <ListBlock title="实施计划" items={proposal.implementationPlan} emptyLabel="当前还没有实施计划。" />
                        <ListBlock title="测试计划" items={proposal.testPlan} emptyLabel="当前还没有测试计划。" />
                        <ListBlock title="回滚计划" items={proposal.rollbackPlan} emptyLabel="当前还没有回滚计划。" />

                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">平台工程项目</div>
                          <div className="mt-2 text-[13px] leading-6 text-[#334155]">
                            {proposal.exitEvidence?.project ? (
                              <>
                                <div>{proposal.exitEvidence.project.name}</div>
                                <div className="text-[#64748b]">{proposal.exitEvidence.project.status} · {proposal.exitEvidence.project.runCount} 次运行</div>
                              </>
                            ) : '当前还没有创建执行项目。'}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">最近执行</div>
                          <div className="mt-2 text-[13px] leading-6 text-[#334155]">
                            {proposal.exitEvidence?.latestRun ? (
                              <>
                                <div>{proposal.exitEvidence.latestRun.summary || proposal.exitEvidence.latestRun.status}</div>
                                <div className="text-[#64748b]">
                                  {proposal.exitEvidence.latestRun.changedFilesCount} 个文件改动 · {proposal.exitEvidence.latestRun.blockerCount} 个阻塞
                                </div>
                              </>
                            ) : '当前还没有执行记录。'}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">Codex worktree</div>
                          <div className="mt-2 text-[13px] leading-6 text-[#334155]">
                            {proposal.exitEvidence?.codex ? (
                              <>
                                <div className="font-mono text-[11px] text-[#475569]">{proposal.exitEvidence.codex.branch}</div>
                                <div className="text-[#64748b]">
                                  {proposal.exitEvidence.codex.changedFiles.length} 个改动文件 · {proposal.exitEvidence.codex.disallowedFiles.length} 个越界文件 · {proposal.exitEvidence.codex.passedValidationCount}/{proposal.exitEvidence.codex.validationCount} 通过
                                </div>
                                <div className="mt-1 text-[#64748b]">
                                  diff {proposal.exitEvidence.codex.diffCheckPassed ? 'ok' : 'failed'} · scope {proposal.exitEvidence.codex.scopeCheckPassed ? 'ok' : 'failed'}
                                </div>
                              </>
                            ) : '当前还没有 Codex worktree 证据。'}
                          </div>
                        </div>

                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">证据路径</div>
                          <div className="mt-2 space-y-1 break-all font-mono text-[11px] leading-5 text-[#64748b]">
                            {proposal.exitEvidence?.codex?.evidencePath ? <div>evidence: {proposal.exitEvidence.codex.evidencePath}</div> : null}
                            {proposal.exitEvidence?.releaseGate?.patchPath ? <div>patch: {proposal.exitEvidence.releaseGate.patchPath}</div> : null}
                            {proposal.exitEvidence?.codex?.worktreePath ? <div>worktree: {proposal.exitEvidence.codex.worktreePath}</div> : null}
                          </div>
                        </div>
                      </div>

                      {(proposal.exitEvidence?.releaseGate?.commands || proposal.exitEvidence?.releaseGate?.patchPath) ? (
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">发布命令与补丁</div>
                          <div className="mt-2 space-y-1 break-all font-mono text-[11px] leading-5 text-[#64748b]">
                            <div>merge: {proposal.exitEvidence?.releaseGate?.commands.mergeCommand}</div>
                            <div>verify: {proposal.exitEvidence?.releaseGate?.commands.verifyCommand}</div>
                            <div>restart: {proposal.exitEvidence?.releaseGate?.commands.restartCommand}</div>
                            <div>rollback: {proposal.exitEvidence?.releaseGate?.commands.rollbackCommand}</div>
                            {proposal.exitEvidence?.releaseGate?.patchPath ? (
                              <div>patch: {proposal.exitEvidence.releaseGate.patchPath}</div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">来源证据</div>
                        <div className="mt-2 space-y-2">
                          {proposal.evidenceRefs.length ? proposal.evidenceRefs.map((item) => (
                            <div key={item.id} className="rounded-[10px] border border-[#eef2f7] bg-[#fbfdff] px-3 py-2.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <DrawerPill tone="neutral" label={item.type} />
                                <div className="text-[12px] font-semibold text-[#0f172a]">{item.label}</div>
                              </div>
                              <div className="mt-1.5 text-[12px] leading-6 text-[#64748b]">
                                {item.excerpt || item.filePath || item.artifactPath || item.apiRoute || '没有附加摘要。'}
                              </div>
                            </div>
                          )) : (
                            <div className="text-[12px] text-[#94a3b8]">当前没有附加来源证据。</div>
                          )}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>

                <aside className="hidden xl:block" />
              </div>
            </div>
          ) : (
            <SectionCard title="暂无详情">
              <div className="text-[13px] text-[#64748b]">当前没有可展示的系统改进详情。</div>
            </SectionCard>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
