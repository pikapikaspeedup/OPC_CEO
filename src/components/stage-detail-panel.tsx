'use client';

import { useState } from 'react';
import { renderMarkdown } from '@/lib/render-markdown';
import {
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  SkipForward,
  RotateCw,
  Zap,
  FileCode2,
  Package,
  XCircle,
  MessageSquare,
  ShieldCheck,
  FastForward,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Pane, PaneHeader, StatusChip } from '@/components/ui/app-shell';
import type { PipelineStageProgressFE, ResumeAction, AgentRun } from '@/lib/types';
import { ReviewOutcomeBadge } from '@/components/role-timeline';

interface StageDetailPanelProps {
  stage: PipelineStageProgressFE;
  stageTitle: string;
  /** The AgentRun associated with this stage — carries result, envelopes, etc. */
  run?: AgentRun | null;
  onResume: (stageId: string, action: ResumeAction, branchIndex?: number) => Promise<void>;
  resumeLoading: boolean;
  resumeError?: string | null;
  onOpenConversation?: (id: string, title: string) => void;
  onEvaluateRun?: (runId: string) => Promise<void>;
  onGateApprove?: (nodeId: string, input: { action: 'approve' | 'reject'; reason?: string }) => Promise<void>;
}

const stageStatusConfig: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  running: { label: 'Running', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  blocked: { label: 'Blocked', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  skipped: { label: 'Skipped', tone: 'neutral' },
};

function formatElapsedTime(startedAt?: string, completedAt?: string): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}



function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-white/30">{label}</div>
      <div className="mt-1 text-sm font-mono text-white/70">{children}</div>
    </div>
  );
}

export default function StageDetailPanel({
  stage,
  stageTitle,
  run,
  onResume,
  resumeLoading,
  resumeError,
  onOpenConversation,
  onEvaluateRun,
  onGateApprove,
}: StageDetailPanelProps) {
  const config = stageStatusConfig[stage.status] || stageStatusConfig.pending;
  const elapsed = formatElapsedTime(stage.startedAt, stage.completedAt);
  const isPromptRun = run?.executorKind === 'prompt';
  const isStaleActive = stage.status === 'running' && !!run?.liveState?.staleSince;
  const canRestartRole = !isPromptRun && (isStaleActive || stage.status === 'failed' || stage.status === 'blocked' || stage.status === 'cancelled');
  const canCancel = run?.status === 'starting' || run?.status === 'running' || stage.status === 'blocked';
  const canSkip = ['pending', 'failed', 'blocked', 'cancelled'].includes(stage.status);
  const canForceComplete = ['running', 'failed', 'blocked', 'cancelled', 'pending'].includes(stage.status);

  // Run-level data
  const summary = run?.result?.summary?.trim() || '';
  const resultEnvelope = run?.resultEnvelope;
  const taskEnvelope = run?.taskEnvelope;
  const outputArtifacts = resultEnvelope?.outputArtifacts || [];
  const needsReview = run?.result?.needsReview || [];
  const blockers = run?.result?.blockers || [];

  // Evaluate-specific state
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalStatus, setEvalStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalStartReviewCount, setEvalStartReviewCount] = useState<number | null>(null);

  // Gate approve/reject state
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const isGatePending = stage.nodeKind === 'gate' && stage.gateApproval?.status === 'pending';

  // Detect when evaluation completes — supervisorReviews count increases
  const currentReviewCount = run?.supervisorReviews?.length || 0;
  if (evalStatus === 'running' && evalStartReviewCount !== null && currentReviewCount > evalStartReviewCount) {
    // New review appeared — evaluation is done
    setEvalStatus('done');
    setEvalStartReviewCount(null);
    setEvalLoading(false);
    setTimeout(() => setEvalStatus('idle'), 8000);
  }

  const handleEvaluate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!run?.runId || !onEvaluateRun) return;
    setEvalStartReviewCount(currentReviewCount);
    setEvalLoading(true);
    setEvalStatus('running');
    setEvalError(null);
    try {
      await onEvaluateRun(run.runId);
      // API returns 202 immediately — keep showing 'running' until reviews refresh
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Evaluation failed';
      setEvalError(msg);
      setEvalStatus('error');
      setEvalLoading(false);
      setEvalStartReviewCount(null);
      setTimeout(() => { setEvalStatus('idle'); setEvalError(null); }, 8000);
    }
  };

  const handleGateAction = async (gateAction: 'approve' | 'reject', e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onGateApprove) return;
    setGateLoading(true);
    setGateError(null);
    try {
      await onGateApprove(stage.stageId, { action: gateAction });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gate action failed';
      setGateError(msg);
      setTimeout(() => setGateError(null), 5000);
    } finally {
      setGateLoading(false);
    }
  };

  const handleResume = async (action: ResumeAction, e: React.MouseEvent) => {
    e.stopPropagation();
    await onResume(stage.stageId, action);
  };

  return (
    <Pane tone="strong" className="p-6">
      <PaneHeader
        eyebrow="Stage Details"
        title={stageTitle}
        meta={(
          <>
            <StatusChip tone={config.tone}>{config.label}</StatusChip>
            {isPromptRun && <StatusChip tone="info">Prompt</StatusChip>}
            {run?.reviewOutcome && <ReviewOutcomeBadge outcome={run.reviewOutcome} />}
            {stage.attempts > 1 && (
              <StatusChip tone="warning">×{stage.attempts} attempts</StatusChip>
            )}
            {elapsed && <StatusChip>{elapsed}</StatusChip>}
          </>
        )}
        actions={(
          <div className={cn(
            'flex h-10 w-10 items-center justify-center rounded-[16px] border',
            stage.status === 'completed' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400' :
              stage.status === 'running' ? 'border-sky-400/20 bg-sky-400/10 text-sky-400' :
                stage.status === 'blocked' ? 'border-amber-400/20 bg-amber-400/10 text-amber-400' :
                  stage.status === 'failed' ? 'border-red-400/20 bg-red-400/10 text-red-400' :
                    stage.status === 'cancelled' ? 'border-slate-300/20 bg-slate-300/10 text-slate-300' :
                      'border-white/10 bg-white/5 text-white/40',
          )}>
            {stage.status === 'completed' ? <CheckCircle2 className="h-4 w-4" /> :
              stage.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> :
                stage.status === 'failed' ? <AlertTriangle className="h-4 w-4" /> :
                  stage.status === 'blocked' ? <AlertTriangle className="h-4 w-4" /> :
                    stage.status === 'cancelled' ? <XCircle className="h-4 w-4" /> :
                      stage.status === 'skipped' ? <SkipForward className="h-4 w-4" /> :
                        <Clock className="h-4 w-4" />}
          </div>
        )}
      />

      {/* ── Gate Approval Action ── */}
      {isGatePending && onGateApprove && (
        <div className="mt-5 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-5 py-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            <span className="text-[13px] font-semibold text-amber-200">Gate Awaiting Approval</span>
          </div>
          <div className="text-[12px] text-amber-200/60 mb-4">
            This gate node requires human approval to proceed. Rejecting will cancel the gate and block downstream stages.
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline"
              className="h-8 rounded-xl border-emerald-400/20 bg-emerald-400/8 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/15 hover:text-emerald-200 disabled:opacity-50"
              disabled={gateLoading}
              onClick={(e) => handleGateAction('approve', e)}>
              {gateLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              Approve
            </Button>
            <Button size="sm" variant="outline"
              className="h-8 rounded-xl border-red-400/20 bg-red-400/8 text-xs font-semibold text-red-300 hover:bg-red-400/15 hover:text-red-200 disabled:opacity-50"
              disabled={gateLoading}
              onClick={(e) => handleGateAction('reject', e)}>
              {gateLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
              Reject
            </Button>
          </div>
          {gateError && (
            <div className="mt-2 text-[12px] text-red-300">{gateError}</div>
          )}
        </div>
      )}

      {/* Gate decided — show result */}
      {stage.nodeKind === 'gate' && stage.gateApproval && stage.gateApproval.status !== 'pending' && (
        <div className={cn(
          'mt-5 rounded-2xl border px-5 py-4',
          stage.gateApproval.status === 'approved'
            ? 'border-emerald-400/20 bg-emerald-400/[0.06]'
            : 'border-red-400/20 bg-red-400/[0.06]',
        )}>
          <div className="flex items-center gap-2">
            <ShieldCheck className={cn('h-4 w-4', stage.gateApproval.status === 'approved' ? 'text-emerald-400' : 'text-red-400')} />
            <span className={cn('text-[13px] font-semibold', stage.gateApproval.status === 'approved' ? 'text-emerald-200' : 'text-red-200')}>
              Gate {stage.gateApproval.status === 'approved' ? 'Approved' : 'Rejected'}
            </span>
            {stage.gateApproval.decidedAt && (
              <span className="text-[10px] text-white/30 ml-auto font-mono">{new Date(stage.gateApproval.decidedAt).toLocaleString()}</span>
            )}
          </div>
          {stage.gateApproval.approvedBy && (
            <div className="mt-1 text-[11px] text-white/40">By: {stage.gateApproval.approvedBy}</div>
          )}
          {stage.gateApproval.reason && (
            <div className="mt-1 text-[12px] text-white/50">{stage.gateApproval.reason}</div>
          )}
        </div>
      )}

      {/* ── Execution Summary (primary content) ── */}
      {summary && (
        <div className="mt-5 rounded-2xl border border-emerald-400/12 bg-emerald-400/[0.04] px-5 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-400/60 mb-2">Execution Summary</div>
          <div
            className="chat-markdown text-[14px] leading-6 text-white/80"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }}
          />
        </div>
      )}

      {/* ── Decision + Output Artifacts ── */}
      {resultEnvelope && (resultEnvelope.decision || outputArtifacts.length > 0) && (
        <div className="mt-4 space-y-3">
          {resultEnvelope.decision && (
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-white/30">Decision</span>
              <span className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                resultEnvelope.decision === 'approved' || resultEnvelope.decision === 'delivered'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : resultEnvelope.decision === 'rejected' || resultEnvelope.decision === 'blocked-by-team'
                    ? 'bg-red-500/15 text-red-400'
                    : 'bg-amber-500/15 text-amber-400',
              )}>{resultEnvelope.decision}</span>
            </div>
          )}
          {outputArtifacts.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-2">Output Artifacts</div>
              <div className="space-y-1.5">
                {outputArtifacts.map((art, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2.5">
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-white/80 truncate">{art.title}</div>
                      <div className="text-[10px] text-white/30 font-mono truncate">{art.path}</div>
                    </div>
                    <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] text-white/40">{art.kind}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Review Items & Blockers ── */}
      {(needsReview.length > 0 || blockers.length > 0) && (
        <div className="mt-4 space-y-3">
          {needsReview.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/60 mb-2">
                Needs Review ({needsReview.length})
              </div>
              <div className="space-y-1.5">
                {needsReview.map((item, i) => (
                  <div key={i} className="rounded-xl border border-amber-400/15 bg-amber-400/[0.06] px-4 py-2.5 text-[13px] leading-5 text-amber-200/80">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}
          {blockers.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-red-400/60 mb-2">
                Blockers ({blockers.length})
              </div>
              <div className="space-y-1.5">
                {blockers.map((item, i) => (
                  <div key={i} className="rounded-xl border border-red-400/15 bg-red-400/[0.06] px-4 py-2.5 text-[13px] leading-5 text-red-200/80">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Task Configuration ── */}
      {taskEnvelope && (
        <div className="mt-4 rounded-xl border border-white/6 bg-white/[0.02] px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-2">Task Configuration</div>
          <div className="text-[13px] leading-6 text-white/60">{taskEnvelope.goal}</div>
          {taskEnvelope.successCriteria && taskEnvelope.successCriteria.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {taskEnvelope.successCriteria.map((c, i) => (
                <span key={i} className="rounded-lg bg-white/5 px-2 py-1 text-[10px] text-white/40">{c}</span>
              ))}
            </div>
          )}
          {taskEnvelope.inputArtifacts && taskEnvelope.inputArtifacts.length > 0 && (
            <div className="mt-2 space-y-1">
              {taskEnvelope.inputArtifacts.map((art, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-white/40">
                  <Package className="h-3 w-3 shrink-0 text-sky-400/60" />
                  <span className="truncate">{art.title}</span>
                  <span className="shrink-0 text-[9px] text-white/25">{art.kind}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Metadata grid ── */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <MetaCell label="Stage ID">{stage.stageId}</MetaCell>
        <MetaCell label="Stage Index">{stage.stageIndex}</MetaCell>
        {stage.startedAt && <MetaCell label="Started">{new Date(stage.startedAt).toLocaleString()}</MetaCell>}
        {stage.completedAt && <MetaCell label="Completed">{new Date(stage.completedAt).toLocaleString()}</MetaCell>}
        {stage.runId && (
          <div className="col-span-2">
            <MetaCell label="Run ID">{stage.runId}</MetaCell>
          </div>
        )}
      </div>

      {/* ── Error display ── */}
      {stage.lastError && (
        <div className="mt-4 rounded-xl border border-red-400/15 bg-red-400/8 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-red-300/60 mb-1">Error</div>
          <div className="text-[13px] leading-5 text-red-300/90">{stage.lastError}</div>
        </div>
      )}

      {/* ── Intervention buttons ── */}
      {(isStaleActive || canRestartRole || canCancel || run?.runId) && (
        <div className="mt-5 flex items-center gap-2 flex-wrap">
          {isStaleActive && (
            <Button size="sm" variant="outline"
              className="h-8 rounded-xl border-sky-400/20 bg-sky-400/8 text-xs font-semibold text-sky-300 hover:bg-sky-400/15 hover:text-sky-200 disabled:opacity-50"
              disabled={resumeLoading} onClick={(e) => handleResume('nudge', e)}>
              {resumeLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
              Nudge
            </Button>
          )}
          {canRestartRole && (
            <Button size="sm" variant="outline"
              className="h-8 rounded-xl border-emerald-400/20 bg-emerald-400/8 text-xs font-semibold text-emerald-300 hover:bg-emerald-400/15 hover:text-emerald-200 disabled:opacity-50"
              disabled={resumeLoading} onClick={(e) => handleResume('restart_role', e)}>
              {resumeLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCw className="mr-1.5 h-3.5 w-3.5" />}
              Restart Role
            </Button>
          )}
          {canCancel && (
            <Button size="sm" variant="outline"
              className="h-8 rounded-xl border-red-400/20 bg-red-400/8 text-xs font-semibold text-red-300 hover:bg-red-400/15 hover:text-red-200 disabled:opacity-50"
              disabled={resumeLoading} onClick={(e) => handleResume('cancel', e)}>
              {resumeLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
              Cancel
            </Button>
          )}
          {canSkip && (
            <Button size="sm" variant="outline"
              className="h-8 rounded-xl border-white/10 bg-white/5 text-xs font-semibold text-white/60 hover:bg-white/10 hover:text-white"
              disabled={resumeLoading} onClick={(e) => handleResume('skip', e)}>
              {resumeLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SkipForward className="mr-1.5 h-3.5 w-3.5" />}
              Skip
            </Button>
          )}
          {canForceComplete && (
            <Button size="sm" variant="outline"
              className="h-8 rounded-xl border-orange-400/20 bg-orange-400/8 text-xs font-semibold text-orange-300 hover:bg-orange-400/15 hover:text-orange-200 disabled:opacity-50"
              disabled={resumeLoading} onClick={(e) => handleResume('force-complete', e)}>
              {resumeLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FastForward className="mr-1.5 h-3.5 w-3.5" />}
              Force Complete
            </Button>
          )}
          {run?.childConversationId && onOpenConversation && (
            <Button size="sm" variant="outline"
              className="h-8 rounded-xl border-sky-400/20 bg-sky-400/8 text-xs font-semibold text-sky-300 hover:bg-sky-400/15 hover:text-sky-200"
              onClick={() => onOpenConversation(run.childConversationId!, stageTitle)}>
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              Open Conversation
            </Button>
          )}
          {run?.runId && onEvaluateRun && (
            <Button size="sm" variant="outline"
              className={cn(
                'h-8 rounded-xl text-xs font-semibold disabled:opacity-50',
                evalStatus === 'running'
                  ? 'border-purple-400/30 bg-purple-400/15 text-purple-200 animate-pulse'
                  : evalStatus === 'done'
                    ? 'border-emerald-400/30 bg-emerald-400/15 text-emerald-300'
                    : 'border-purple-400/20 bg-purple-400/8 text-purple-300 hover:bg-purple-400/15 hover:text-purple-200',
              )}
              disabled={evalLoading || resumeLoading}
              onClick={handleEvaluate}>
              {evalLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
              {evalStatus === 'running' ? 'Diagnosing...' : evalStatus === 'done' ? 'Done ✓' : 'AI Diagnose'}
            </Button>
          )}
        </div>
      )}

      {/* Evaluate progress banner */}
      {evalStatus === 'running' && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-purple-400/20 bg-purple-400/[0.06] px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-purple-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-purple-200">AI Supervisor is analyzing this run...</div>
            <div className="text-[11px] text-purple-300/60 mt-0.5">This may take 30-90 seconds.</div>
          </div>
          {run?.supervisorConversationId && onOpenConversation && (
            <Button size="sm" variant="outline"
              className="h-7 rounded-lg border-purple-400/30 bg-purple-400/15 text-[11px] font-semibold text-purple-200 hover:bg-purple-400/25 hover:text-white shrink-0"
              onClick={() => onOpenConversation(run.supervisorConversationId!, 'AI Supervisor Diagnosis')}>
              <MessageSquare className="mr-1 h-3 w-3" />
              View Live
            </Button>
          )}
        </div>
      )}
      {evalStatus === 'done' && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <div className="text-[13px] font-medium text-emerald-200">Diagnosis complete — check Supervisor Reviews for results.</div>
        </div>
      )}
      {evalStatus === 'error' && evalError && (
        <div className="mt-3 rounded-xl border border-red-400/15 bg-red-400/10 px-4 py-3 text-[13px] text-red-300">
          Diagnosis failed: {evalError}
        </div>
      )}

      {resumeError && (
        <div className="mt-3 rounded-xl border border-red-400/15 bg-red-400/10 px-3 py-2 text-[12px] text-red-300">
          {resumeError}
        </div>
      )}
    </Pane>
  );
}
