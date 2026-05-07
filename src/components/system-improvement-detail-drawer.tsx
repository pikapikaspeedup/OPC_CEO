'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  CheckCircle2,
  FileCode2,
  GitPullRequest,
  Loader2,
  Waypoints,
  XCircle,
} from 'lucide-react';

import { api } from '@/lib/api';
import {
  getSystemImprovementNextActionLabel,
  getSystemImprovementOwnerLabel,
  getSystemImprovementStageLabel,
  getSystemImprovementStageTone,
} from '@/lib/system-improvement-control-view';
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

function extractProjectId(proposal: SystemImprovementProposalFE): string | null {
  if (proposal.exitEvidence?.project?.projectId) {
    return proposal.exitEvidence.project.projectId;
  }
  const value = proposal.metadata?.improvementProjectId;
  return typeof value === 'string' && value ? value : null;
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
  const controlState = proposal?.controlState;
  const decisionTitle = controlState?.headline || proposal?.title || '系统改进详情';
  const decisionSummary = controlState?.subline || proposal?.summary || '';
  const primaryStatusLabel = getSystemImprovementStageLabel(controlState?.stage);
  const primaryStatusTone = proposal ? getSystemImprovementStageTone(controlState?.stage) : 'neutral';
  const ownerLabel = getSystemImprovementOwnerLabel(controlState?.currentOwner);
  const nextActionLabel = getSystemImprovementNextActionLabel(controlState?.nextAction);
  const scopeFiles = proposal?.affectedFiles.length
    ? proposal.affectedFiles
    : (proposal?.exitEvidence?.codex?.changedFiles ?? []);
  const summaryFacts = [
    `${proposal?.sourceSignalIds.length || 0} 个信号 / ${proposal?.evidenceRefs.length || 0} 份证据`,
    scopeFiles.length ? `影响 ${scopeFiles.length} 个文件` : null,
    proposal ? formatRisk(proposal.risk) : null,
    controlState ? `责任方 ${ownerLabel}` : null,
  ].filter(Boolean) as string[];
  const releaseProgress = controlState?.milestones || [];
  const pageMode = controlState?.pageMode || 'progress';
  const releaseGate = proposal?.exitEvidence?.releaseGate;
  const testing = proposal?.exitEvidence?.testing;
  const verificationSummary = [
    testing?.evidenceCount ? `测试 ${testing.passedCount}/${testing.evidenceCount}` : null,
    releaseGate?.checks.length ? `发布前检查 ${releaseGate.checks.filter((item) => item.status === 'passed').length}/${releaseGate.checks.length}` : null,
    proposal?.exitEvidence?.codex ? `Codex ${proposal.exitEvidence.codex.passedValidationCount}/${proposal.exitEvidence.codex.validationCount}` : null,
  ].filter(Boolean).join(' · ');
  const canApproveEntry = pageMode === 'entry-review' && Boolean(proposal?.approvalRequestId);
  const canApproveExit = pageMode === 'exit-review';
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
                      <div className="mt-2 text-[14px] leading-7 text-[#64748b]">{decisionSummary}</div>
                      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[13px] leading-6 text-[#64748b]">
                        {summaryFacts.map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <aside className="space-y-4 xl:self-start">
                    <SectionCard title="当前操作">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">当前责任方</div>
                          <div className="mt-2 text-[13px] font-semibold text-[#0f172a]">{ownerLabel}</div>
                        </div>
                        <div className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">下一动作</div>
                          <div className="mt-2 text-[13px] font-semibold text-[#0f172a]">{nextActionLabel}</div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {canApproveEntry ? (
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

                        {canApproveExit ? (
                          <Button
                            disabled={busyAction === 'approve'}
                            onClick={() => { void handleReleaseGate('approve'); }}
                            className="h-10 w-full justify-start gap-2 rounded-[10px] bg-[#2f6df6] px-4 text-white hover:bg-[#245ee8]"
                          >
                            {busyAction === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitPullRequest className="h-4 w-4" />}
                            批准合入
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
                            查看 Ops 详情
                          </Button>
                        </div>
                      </div>
                    </SectionCard>
                  </aside>
                </div>
              </section>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-4">
                  <SectionCard title={pageMode === 'progress' ? '进度与审批' : '审批信息'}>
                    <div className="grid gap-5 lg:grid-cols-3">
                      <div className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                          {pageMode === 'entry-review' ? '解决的问题' : pageMode === 'exit-review' ? '准出结论' : '当前阶段'}
                        </div>
                        <div className="mt-2 text-[13px] leading-6 text-[#334155]">
                          {pageMode === 'progress' ? primaryStatusLabel : proposal.summary}
                        </div>
                      </div>
                        <div className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                          {pageMode === 'progress' ? '当前责任方 / 下一动作' : '影响范围与风险'}
                          </div>
                          <div className="mt-2 text-[13px] leading-6 text-[#334155]">{formatRisk(proposal.risk)}</div>
                        <div className="mt-2 text-[12px] leading-5 text-[#64748b]">
                          {pageMode === 'progress' ? `${ownerLabel} · ${nextActionLabel}` : `${scopeFiles.length} 个文件 · ${proposal.protectedAreas.length} 个保护范围`}
                        </div>
                      </div>
                      <div className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-4 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#94a3b8]">
                          {pageMode === 'entry-review' ? '批准后 AI 会做什么' : pageMode === 'exit-review' ? '验证完成度' : '审批事实'}
                        </div>
                        <div className="mt-2 text-[13px] leading-6 text-[#334155]">
                          {pageMode === 'entry-review'
                            ? `${proposal.implementationPlan.length} 条实施计划 · ${proposal.testPlan.length} 条测试计划`
                            : pageMode === 'exit-review'
                              ? verificationSummary || '当前没有验证结果。'
                              : proposal.entryApprovalSummary
                                ? `${proposal.entryApprovalSummary.status}${proposal.entryApprovalSummary.actedAt ? ` · ${proposal.entryApprovalSummary.actedAt}` : ''}`
                                : '当前没有准入审批记录。'}
                        </div>
                      </div>
                    </div>

                    {proposal.entryApprovalSummary ? (
                      <div className="mt-5 rounded-[12px] border border-[#eef2f7] bg-white px-4 py-3 text-[13px] leading-6 text-[#64748b]">
                        准入审批 {proposal.entryApprovalSummary.status}
                        {proposal.entryApprovalSummary.actedAt ? ` · ${proposal.entryApprovalSummary.actedAt}` : ''}
                        {proposal.entryApprovalSummary.actedBy ? ` · ${proposal.entryApprovalSummary.actedBy}` : ''}
                        {proposal.entryApprovalSummary.message ? ` · ${proposal.entryApprovalSummary.message}` : ''}
                      </div>
                    ) : null}

                    {releaseProgress.length ? (
                      <div className="mt-5 grid gap-3 lg:grid-cols-3">
                        {releaseProgress.map((step) => (
                          <div key={step.label} className="rounded-[12px] border border-[#eef2f7] bg-[#fbfdff] px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'inline-block h-2.5 w-2.5 rounded-full',
                                  step.status === 'done'
                                    ? 'bg-emerald-500'
                                    : step.status === 'current'
                                      ? 'bg-blue-500'
                                      : 'bg-slate-300',
                                )}
                              />
                              <div className="text-[12px] font-semibold text-[#0f172a]">{step.label}</div>
                            </div>
                            <div className="mt-2 text-[12px] leading-5 text-[#64748b]">{step.detail}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
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
