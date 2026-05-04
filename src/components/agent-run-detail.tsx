'use client';

import { useState } from 'react';
import { renderMarkdown } from '@/lib/render-markdown';
import { useRunStream } from '@/hooks/use-run-stream';
import {
  AlertCircle,
  Ban,
  Bot,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCode2,
  Loader2,
  Package,
  ShieldCheck,
  XCircle,
  Zap,
  RotateCw,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { AgentRun, ModelConfig, RunConversationFE } from '@/lib/types';
import { getModelLabel } from '@/lib/model-labels';
import { formatDateTime } from '@/lib/i18n/formatting';
import { getAgentRunDuration, getAgentRunTimeAgo, getAgentRunWorkspaceName, isAgentRunActive } from '@/lib/agent-run-utils';
import { useI18n } from '@/components/locale-provider';
import { EmptyState, InspectorTabs, Pane, PaneHeader, StatusChip } from '@/components/ui/app-shell';
import RoleTimeline, { ReviewOutcomeBadge, SupervisorReviewLog } from '@/components/role-timeline';

const statusConfig: Record<string, { icon: React.ReactNode; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; soft: string }> = {
  queued: {
    icon: <Clock className="h-4 w-4" />,
    tone: 'neutral',
    soft: 'border-white/10 bg-white/[0.03] text-[color:var(--app-text-soft)]',
  },
  starting: {
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    tone: 'info',
    soft: 'border-sky-400/18 bg-sky-400/10 text-sky-100',
  },
  running: {
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    tone: 'success',
    soft: 'border-emerald-400/18 bg-emerald-400/10 text-emerald-100',
  },
  completed: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    tone: 'success',
    soft: 'border-emerald-400/18 bg-emerald-400/10 text-emerald-100',
  },
  blocked: {
    icon: <AlertCircle className="h-4 w-4" />,
    tone: 'warning',
    soft: 'border-amber-400/18 bg-amber-400/10 text-amber-100',
  },
  failed: {
    icon: <XCircle className="h-4 w-4" />,
    tone: 'danger',
    soft: 'border-red-400/18 bg-red-400/10 text-red-100',
  },
  cancelled: {
    icon: <Ban className="h-4 w-4" />,
    tone: 'neutral',
    soft: 'border-white/10 bg-white/[0.03] text-[color:var(--app-text-soft)]',
  },
  timeout: {
    icon: <Clock className="h-4 w-4" />,
    tone: 'warning',
    soft: 'border-amber-400/18 bg-amber-400/10 text-amber-100',
  },
};

const inputAuditBadgeConfig: Record<string, string> = {
  verified: 'bg-emerald-500/15 text-emerald-300',
  partial: 'bg-amber-500/15 text-amber-300',
  missing: 'bg-red-500/15 text-red-300',
  not_applicable: 'bg-white/8 text-white/55',
};



function SurfaceCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Pane tone="soft" className="p-5">
      <div className="app-eyebrow">{title}</div>
      <div className="mt-4">{children}</div>
    </Pane>
  );
}

interface AgentRunDetailProps {
  loading?: boolean;
  run: AgentRun | null;
  models: ModelConfig[];
  onCancel: (runId: string) => void;
  onIntervene?: (runId: string, action: 'nudge' | 'retry' | 'restart_role' | 'cancel' | 'evaluate') => void;
  onEvaluateRun?: (runId: string) => Promise<void>;
  onOpenConversation?: (id: string, title: string) => void;
  onOpenChatTab?: (id: string, title: string) => void;
  onOpenImprovementProposal?: (proposalId: string | null) => void;
  renderChat?: () => React.ReactNode;
  executiveMode?: boolean;
  systemImprovementProposalId?: string | null;
  systemImprovementProposalTitle?: string | null;
}

export default function AgentRunDetail({
  loading = false,
  run,
  models,
  onCancel,
  onIntervene,
  onEvaluateRun,
  onOpenConversation,
  onOpenChatTab,
  onOpenImprovementProposal,
  renderChat,
  executiveMode = false,
  systemImprovementProposalId = null,
  systemImprovementProposalTitle = null,
}: AgentRunDetailProps) {
  const { locale, t } = useI18n();
  const [tab, setTab] = useState<'result' | 'files' | 'review' | 'envelope' | 'trace' | 'chat'>('result');
  const [interveneLoading, setInterveneLoading] = useState(false);
  const [interveneError, setInterveneError] = useState<string | null>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [showConversationPanel, setShowConversationPanel] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationData, setConversationData] = useState<RunConversationFE | null>(null);
  const [conversationRunId, setConversationRunId] = useState<string | null>(null);
  const linkedProposalIdFromRun = run?.taskEnvelope?.constraints?.find((item) => item.startsWith('proposalId='))?.slice('proposalId='.length) || null;
  const linkedImprovementProposalId = systemImprovementProposalId || linkedProposalIdFromRun;
  const isSystemImprovementCodexRun = !!run && run.provider === 'codex-cli' && run.executorKind === 'prompt' && !!linkedImprovementProposalId;
  const hasConversationLink = !isSystemImprovementCodexRun && !!(run?.childConversationId || run?.sessionProvenance?.handle);

  const isRunActive = run ? ['queued', 'starting', 'running'].includes(run.status) : false;
  const { text: streamingText, isStreaming } = useRunStream({
    runId: run?.runId,
    enabled: isRunActive,
  });

  if (loading && !run) {
    return (
      <Pane tone="strong" className="p-6 md:p-8">
        <EmptyState
          icon={<Loader2 className="h-5 w-5 animate-spin" />}
          title={t('agent.loadingDetails')}
          body={t('common.loading')}
          className="min-h-[520px]"
        />
      </Pane>
    );
  }

  if (!run) {
    return (
      <Pane tone="strong" className="p-6 md:p-8">
        <EmptyState
          icon={<Bot className="h-6 w-6" />}
          title={t('agent.noTaskSelected')}
          body={t('agent.noTaskBody')}
          className="min-h-[520px]"
        />
      </Pane>
    );
  }

  const status = statusConfig[run.status] || statusConfig.queued;
  const workspaceName = getAgentRunWorkspaceName(run.workspace);
  const duration = getAgentRunDuration(run);
  const modelLabel = getModelLabel(run.model, models, { emptyLabel: t('agent.groupDefault') });
  const statusLabel = t(`common.status.${run.status}`);
  const displayTitle = isSystemImprovementCodexRun && systemImprovementProposalTitle
    ? systemImprovementProposalTitle
    : run.prompt;
  const summary = run.result?.summary?.trim() || '';
  const changedFiles = run.result?.changedFiles || [];
  const blockers = run.result?.blockers || [];
  const needsReview = run.result?.needsReview || [];
  const active = isAgentRunActive(run.status);

  const isPromptRun = run.executorKind === 'prompt';
  const isStaleActive = run.status === 'running' && !!run?.liveState?.staleSince;
  const canRestartRole = !isPromptRun && (isStaleActive || run.status === 'failed' || run.status === 'blocked' || run.status === 'cancelled');
  const canRetry = !isPromptRun && (run.status === 'failed' || run.status === 'blocked' || run.status === 'cancelled');
  const canCancel = active || run.status === 'blocked';
  const canDirectEvaluate = !!onEvaluateRun && !onIntervene;
  const outputArtifacts = run.resultEnvelope?.outputArtifacts || [];
  const verificationPassed = run.verificationPassed ?? run.resultEnvelope?.verificationPassed;
  const verificationKnown = typeof verificationPassed === 'boolean';
  const hasAttention = blockers.length > 0 || needsReview.length > 0 || run.status === 'failed' || run.status === 'blocked' || verificationPassed === false;

  const handleInterveneClick = async (action: 'nudge' | 'retry' | 'restart_role' | 'cancel' | 'evaluate') => {
    if (!onIntervene || !run.runId) return;
    setInterveneLoading(true);
    setInterveneError(null);
    try {
      await onIntervene(run.runId, action);
    } catch (e: unknown) {
      setInterveneError(e instanceof Error ? e.message : 'Intervention failed');
    }
    setInterveneLoading(false);
  };

  const handleDirectEvaluate = async () => {
    if (!onEvaluateRun || !run.runId) return;
    setInterveneLoading(true);
    setInterveneError(null);
    try {
      await onEvaluateRun(run.runId);
    } catch (e: unknown) {
      setInterveneError(e instanceof Error ? e.message : 'Evaluation failed');
    }
    setInterveneLoading(false);
  };

  const handleToggleConversationPanel = async () => {
    if (!showConversationPanel) {
      const needsFreshLoad = conversationRunId !== run.runId || !conversationData;
      if (needsFreshLoad) {
        setConversationLoading(true);
        setConversationRunId(run.runId);
        setConversationData(null);
        try {
          const data = await api.agentRunConversation(run.runId);
          setConversationData(data);
        } catch (err: unknown) {
          setConversationData({
            kind: 'unavailable',
            provider: run.provider,
            reason: err instanceof Error ? err.message : '当前无法读取 AI 对话。',
          });
        } finally {
          setConversationLoading(false);
        }
      }
      setShowConversationPanel(true);
      return;
    }

    setShowConversationPanel(false);
  };

  const resolveConversationTarget = async (): Promise<{ id: string; title: string } | null> => {
    if (!run) return null;
    if (run.childConversationId) {
      return {
        id: run.childConversationId,
        title: run.prompt,
      };
    }

    const data = conversationRunId === run.runId && conversationData
      ? conversationData
      : await api.agentRunConversation(run.runId);

    if (conversationRunId !== run.runId || !conversationData) {
      setConversationRunId(run.runId);
      setConversationData(data);
    }

    if (data.kind === 'conversation') {
      return {
        id: data.conversationId,
        title: data.title,
      };
    }

    if (data.kind === 'transcript' && data.viewerConversationId) {
      return {
        id: data.viewerConversationId,
        title: data.viewerTitle || run.prompt,
      };
    }

    return null;
  };

  const handleOpenConversation = async (titleOverride?: string) => {
    if (!onOpenConversation) return;
    const target = await resolveConversationTarget();
    if (!target) return;
    onOpenConversation(target.id, titleOverride || target.title);
  };

  const handleOpenChatTab = async (titleOverride?: string) => {
    if (!onOpenChatTab) return;
    const target = await resolveConversationTarget();
    if (!target) return;
    onOpenChatTab(target.id, titleOverride || target.title);
  };

  return (
    <Pane tone="strong" className="p-6 md:p-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1">
            <PaneHeader
              eyebrow={executiveMode ? '结果检查' : t('agent.selectedRun')}
              title={<span className="line-clamp-3">{displayTitle}</span>}
              meta={(
                <>
                  <StatusChip tone={status.tone}>{statusLabel}</StatusChip>
                  {verificationKnown && (
                    <StatusChip tone={verificationPassed ? 'success' : 'warning'}>
                      {verificationPassed ? '已通过校验' : '需要校验'}
                    </StatusChip>
                  )}
                  {!executiveMode && run.executorKind === 'prompt' && <StatusChip tone="info">Prompt</StatusChip>}
                  {!executiveMode && run.executionProfileSummary && <StatusChip tone="info">{run.executionProfileSummary.label}</StatusChip>}
                  {!executiveMode && run.reviewOutcome && <ReviewOutcomeBadge outcome={run.reviewOutcome} />}
                  {!executiveMode && run.provider && <StatusChip tone="info">{run.provider}</StatusChip>}
                  {!executiveMode && <StatusChip>{workspaceName}</StatusChip>}
                  {!executiveMode && <StatusChip>{modelLabel}</StatusChip>}
                  <StatusChip>{getAgentRunTimeAgo(run.createdAt, locale)}</StatusChip>
                  {duration && <StatusChip>{t('agent.duration', { value: duration })}</StatusChip>}
                  {!executiveMode && run.tokenUsage && (
                    <StatusChip>
                      {`${(run.tokenUsage.totalTokens / 1000).toFixed(1)}k tokens`}
                    </StatusChip>
                  )}
                </>
              )}
              actions={(
                <div className={cn('flex h-12 w-12 items-center justify-center rounded-[18px] border', status.soft)}>
                  {status.icon}
                </div>
              )}
            />
          </div>

          <div className="flex flex-wrap gap-3 xl:justify-end">
            {isStaleActive && onIntervene && (
              <Button
                variant="outline"
                className="h-11 rounded-[18px] border-sky-400/18 bg-sky-400/10 text-sky-100 hover:border-sky-400/30 hover:bg-sky-400/14 hover:text-white disabled:opacity-50"
                onClick={() => handleInterveneClick('nudge')}
                disabled={interveneLoading}
              >
                {interveneLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
                {t('agent.nudge', { defaultValue: 'Nudge' })}
              </Button>
            )}
            {canRestartRole && onIntervene && (
              <Button
                variant="outline"
                className="h-11 rounded-[18px] border-emerald-400/18 bg-emerald-400/10 text-emerald-100 hover:border-emerald-400/30 hover:bg-emerald-400/14 hover:text-white disabled:opacity-50"
                onClick={() => handleInterveneClick('restart_role')}
                disabled={interveneLoading}
              >
                {interveneLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCw className="mr-2 h-4 w-4" />}
                {t('agent.restartRole', { defaultValue: 'Restart Role' })}
              </Button>
            )}
            {canRetry && onIntervene && (
              <Button
                variant="outline"
                className="h-11 rounded-[18px] border-amber-400/18 bg-amber-400/10 text-amber-100 hover:border-amber-400/30 hover:bg-amber-400/14 hover:text-white disabled:opacity-50"
                onClick={() => handleInterveneClick('retry')}
                disabled={interveneLoading}
              >
                {interveneLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {t('agent.retryRun', { defaultValue: 'Retry' })}
              </Button>
            )}
            {canCancel && onIntervene && (
              <Button
                variant="outline"
                className="h-11 rounded-[18px] border-red-400/18 bg-red-400/10 text-red-100 hover:border-red-400/30 hover:bg-red-400/14 hover:text-white disabled:opacity-50"
                onClick={() => handleInterveneClick('cancel')}
                disabled={interveneLoading}
              >
                {interveneLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                {t('agent.cancelRun')}
              </Button>
            )}
            {canCancel && !onIntervene && (
              <Button
                variant="outline"
                className="h-11 rounded-[18px] border-red-400/18 bg-red-400/10 text-red-100 hover:border-red-400/30 hover:bg-red-400/14 hover:text-white disabled:opacity-50"
                onClick={() => onCancel(run.runId)}
              >
                <XCircle className="mr-2 h-4 w-4" />
                {t('agent.cancelRun')}
              </Button>
            )}
            {onIntervene && (!executiveMode || hasAttention) && (
              <Button
                variant="outline"
                className="h-11 rounded-[18px] border-purple-400/18 bg-purple-400/10 text-purple-100 hover:border-purple-400/30 hover:bg-purple-400/14 hover:text-white disabled:opacity-50"
                onClick={() => handleInterveneClick('evaluate')}
                disabled={interveneLoading}
              >
                {interveneLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                {t('agent.evaluate', { defaultValue: 'AI Diagnose' })}
              </Button>
            )}
            {canDirectEvaluate && (!executiveMode || hasAttention) && (
              <Button
                variant="outline"
                className="h-11 rounded-[18px] border-purple-400/18 bg-purple-400/10 text-purple-100 hover:border-purple-400/30 hover:bg-purple-400/14 hover:text-white disabled:opacity-50"
                onClick={handleDirectEvaluate}
                disabled={interveneLoading}
              >
                {interveneLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                {t('agent.evaluate', { defaultValue: 'AI Diagnose' })}
              </Button>
            )}
            {hasConversationLink && onOpenConversation && !executiveMode && (
              <Button
                variant="outline"
                className="h-11 rounded-[18px] border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]"
                onClick={() => { void handleOpenConversation(run.prompt); }}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('agent.openConversation')}
              </Button>
            )}
            {!isSystemImprovementCodexRun ? (
              <Button
                variant="outline"
                className="h-11 rounded-[18px] border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]"
                onClick={handleToggleConversationPanel}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {showConversationPanel ? '收起 AI 对话' : '查看 AI 对话'}
              </Button>
            ) : null}
            {isSystemImprovementCodexRun && linkedImprovementProposalId && onOpenImprovementProposal ? (
              <Button
                variant="outline"
                className="h-11 rounded-[18px] border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]"
                onClick={() => onOpenImprovementProposal(linkedImprovementProposalId)}
              >
                <FileCode2 className="mr-2 h-4 w-4" />
                查看系统改进详情
              </Button>
            ) : null}
          </div>
        </div>

        {isSystemImprovementCodexRun ? (
          <div className="rounded-[20px] border border-sky-400/18 bg-sky-400/10 px-4 py-3 text-sm leading-7 text-sky-100">
            这次执行来自 Codex CLI worktree runner。主证据是 worktree、diff、校验和发布检查，不是普通 AI 对话。
          </div>
        ) : null}

        {run.lastError && (
          <div className="rounded-[20px] border border-red-400/18 bg-red-400/10 px-4 py-3 text-sm leading-7 text-red-100">
            {run.lastError}
          </div>
        )}
        
        {interveneError && (
          <div className="rounded-[20px] border border-red-400/18 bg-red-400/10 px-4 py-3 text-sm leading-7 text-red-100">
            {interveneError}
          </div>
        )}

        {showConversationPanel && !isSystemImprovementCodexRun && (
          <SurfaceCard title="AI 对话">
            {conversationLoading ? (
              <div className="flex items-center gap-2 text-sm text-[var(--app-text-soft)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>正在加载 AI 对话…</span>
              </div>
            ) : conversationData?.kind === 'conversation' ? (
              <div className="space-y-3">
                <div className="text-sm leading-7 text-[var(--app-text-soft)]">
                  当前 provider 将 AI 对话保存在独立 conversation 中。
                </div>
                {onOpenConversation ? (
                  <Button
                    variant="outline"
                    className="h-10 rounded-[16px] border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]"
                    onClick={() => onOpenConversation(conversationData.conversationId, conversationData.title)}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    打开完整 AI 对话
                  </Button>
                ) : (
                  <div className="text-sm text-[var(--app-text-soft)]">当前页面未挂接 conversation viewer。</div>
                )}
              </div>
            ) : conversationData?.kind === 'transcript' ? (
              <div className="space-y-3">
                {conversationData.messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={cn(
                      'rounded-[18px] border px-4 py-3',
                      message.role === 'user'
                        ? 'border-sky-400/18 bg-sky-400/10'
                        : 'border-white/8 bg-white/[0.03]',
                    )}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                      {message.role === 'user' ? 'User' : 'Assistant'}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-[var(--app-text-soft)]">
                      {message.content}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm leading-7 text-[var(--app-text-soft)]">
                {conversationData?.reason || '当前没有可展示的 AI 对话内容。'}
              </div>
            )}
          </SurfaceCard>
        )}

        <InspectorTabs
          value={tab}
          onValueChange={(value) => {
            const newTab = value as typeof tab;
            setTab(newTab);
            if (newTab === 'chat' && hasConversationLink && onOpenChatTab) {
              void handleOpenChatTab(run.prompt);
            }
          }}
          tabs={[
            { value: 'result', label: t('agent.result') },
            { value: 'files', label: `${executiveMode ? '交付物' : t('agent.files')} ${changedFiles.length ? `(${changedFiles.length})` : ''}`.trim() },
            ...(!executiveMode ? [{ value: 'review' as const, label: `${t('agent.review')} ${(needsReview.length + blockers.length) ? `(${needsReview.length + blockers.length})` : ''}`.trim() }] : []),
            ...(!executiveMode && (run.taskEnvelope || run.resultEnvelope) ? [{ value: 'envelope' as const, label: `Envelope ${run.resultEnvelope?.outputArtifacts?.length ? `(${run.resultEnvelope.outputArtifacts.length})` : ''}`.trim() }] : []),
            ...(!executiveMode ? [{ value: 'trace' as const, label: t('agent.trace') }] : []),
            ...(!executiveMode && hasConversationLink ? [{ value: 'chat' as const, label: t('shell.conversations', { defaultValue: 'Conversation' }) }] : []),
          ]}
        />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {tab === 'result' && (
              <SurfaceCard title={t('agent.renderedResult')}>
                {summary ? (
                  <div
                    className="chat-markdown text-[15px] leading-7 text-[color:var(--app-text-soft)]"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }}
                  />
                ) : isStreaming && streamingText ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs text-sky-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Streaming...</span>
                    </div>
                    <div
                      className="chat-markdown text-[15px] leading-7 text-[color:var(--app-text-soft)]"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingText) }}
                    />
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-dashed border-[var(--app-border-soft)] bg-black/10 px-4 py-6 text-sm leading-7 text-[color:var(--app-text-soft)]">
                    {active ? t('agent.stillRunning') : t('agent.noSummary')}
                  </div>
                )}
              </SurfaceCard>
            )}

            {tab === 'files' && (
              <SurfaceCard title={t('agent.changedFiles')}>
                {changedFiles.length > 0 ? (
                  <div className="space-y-3">
                    {changedFiles.map(file => (
                      <div
                        key={file}
                        className="flex items-center gap-3 rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3"
                      >
                        <FileCode2 className="h-4 w-4 shrink-0 text-[var(--app-accent)]" />
                        <span className="min-w-0 truncate font-mono text-[12px] text-[var(--app-text-soft)]">{file}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-[var(--app-text-soft)]">{t('agent.noFileChanges')}</div>
                )}
              </SurfaceCard>
            )}

            {tab === 'review' && !executiveMode && (
              <div className="grid gap-5 lg:grid-cols-2">
                <SurfaceCard title={t('agent.reviewQueue')}>
                  {needsReview.length > 0 ? (
                    <div className="space-y-3">
                      {needsReview.map(item => (
                        <div key={item} className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3 text-sm leading-7 text-[var(--app-text)]">
                          {item}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--app-text-soft)]">{t('agent.noReview')}</div>
                  )}
                </SurfaceCard>

                <SurfaceCard title={t('agent.blockers')}>
                  {blockers.length > 0 ? (
                    <div className="space-y-3">
                      {blockers.map(item => (
                        <div key={item} className="rounded-[18px] border border-amber-400/18 bg-amber-400/10 px-4 py-3 text-sm leading-7 text-amber-100">
                          {item}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--app-text-soft)]">{t('agent.noBlockers')}</div>
                  )}
                </SurfaceCard>
              </div>
            )}

            {tab === 'envelope' && !executiveMode && (
              <div className="space-y-5">
                {run.taskEnvelope && (
                  <SurfaceCard title="Task Envelope">
                    <div className="space-y-3">
                      <div className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)] mb-1">Goal</div>
                        <div className="text-sm text-[var(--app-text)]">{run.taskEnvelope.goal}</div>
                      </div>
                      {run.taskEnvelope.taskId && (
                        <div className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)] mb-1">Task ID</div>
                          <div className="text-sm text-[var(--app-text)] font-mono">{run.taskEnvelope.taskId}</div>
                        </div>
                      )}
                      {run.taskEnvelope.requestedDeliverables && run.taskEnvelope.requestedDeliverables.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)] mb-2">Requested Deliverables</div>
                          <div className="space-y-1">
                            {run.taskEnvelope.requestedDeliverables.map((d, i) => (
                              <div key={i} className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2 text-xs font-mono text-[var(--app-text-soft)]">{d}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {run.taskEnvelope.successCriteria && run.taskEnvelope.successCriteria.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)] mb-2">Success Criteria</div>
                          <div className="space-y-1">
                            {run.taskEnvelope.successCriteria.map((c, i) => (
                              <div key={i} className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2 text-xs text-[var(--app-text-soft)]">{c}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {run.taskEnvelope.inputArtifacts && run.taskEnvelope.inputArtifacts.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)] mb-2">Input Artifacts</div>
                          <div className="space-y-2">
                            {run.taskEnvelope.inputArtifacts.map((art, i) => (
                              <div key={i} className="flex items-center gap-3 rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                                <Package className="h-4 w-4 shrink-0 text-sky-400" />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm text-[var(--app-text)] truncate">{art.title}</div>
                                  <div className="text-[11px] text-[var(--app-text-muted)] font-mono truncate">{art.path}</div>
                                </div>
                                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[var(--app-text-soft)]">{art.kind}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </SurfaceCard>
                )}

                {run.resultEnvelope && (
                  <SurfaceCard title="Result Envelope">
                    <div className="space-y-3">
                      {run.resultEnvelope.decision && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Decision</span>
                          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium',
                            run.resultEnvelope.decision === 'approved' || run.resultEnvelope.decision === 'delivered' ? 'bg-emerald-500/15 text-emerald-400' :
                              run.resultEnvelope.decision === 'rejected' || run.resultEnvelope.decision === 'blocked-by-team' ? 'bg-red-500/15 text-red-400' :
                                'bg-amber-500/15 text-amber-400'
                          )}>{run.resultEnvelope.decision}</span>
                        </div>
                      )}
                      {run.resultEnvelope.outputArtifacts && run.resultEnvelope.outputArtifacts.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)] mb-2">Output Artifacts</div>
                          <div className="space-y-2">
                            {run.resultEnvelope.outputArtifacts.map((art, i) => (
                              <div key={i} className="flex items-center gap-3 rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                                <FileCode2 className="h-4 w-4 shrink-0 text-[var(--app-accent)]" />
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm text-[var(--app-text)] truncate">{art.title}</div>
                                  <div className="text-[11px] text-[var(--app-text-muted)] font-mono truncate">{art.path}</div>
                                </div>
                                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[var(--app-text-soft)]">{art.kind}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {run.resultEnvelope.risks && run.resultEnvelope.risks.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)] mb-2">Risks</div>
                          <div className="space-y-1">
                            {run.resultEnvelope.risks.map((risk, i) => (
                              <div key={i} className="rounded-[14px] border border-amber-400/18 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">{risk}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {run.resultEnvelope.openQuestions && run.resultEnvelope.openQuestions.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)] mb-2">Open Questions</div>
                          <div className="space-y-1">
                            {run.resultEnvelope.openQuestions.map((q, i) => (
                              <div key={i} className="rounded-[14px] border border-sky-400/18 bg-sky-400/10 px-3 py-2 text-xs text-sky-100">{q}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {run.resultEnvelope.nextAction && (
                        <div className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)] mb-1">Next Action</div>
                          <div className="text-sm text-[var(--app-text)]">{run.resultEnvelope.nextAction}</div>
                        </div>
                      )}
                    </div>
                  </SurfaceCard>
                )}

                {run.sourceRunIds && run.sourceRunIds.length > 0 && (
                  <SurfaceCard title="Source Runs">
                    <div className="space-y-2">
                      {run.sourceRunIds.map(id => (
                        <div key={id} className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3 font-mono text-xs text-[var(--app-text-soft)]">
                          {id.slice(0, 8)}
                        </div>
                      ))}
                    </div>
                  </SurfaceCard>
                )}

                {run.artifactManifestPath && (
                  <SurfaceCard title="Artifact Manifest">
                    <div className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3 font-mono text-xs text-[var(--app-text-soft)]">
                      {run.artifactManifestPath}
                    </div>
                  </SurfaceCard>
                )}
              </div>
            )}

            {tab === 'trace' && !executiveMode && (
              <div className="space-y-5">
                <SurfaceCard title={t('agent.traceInfo')}>
                  <div className="rounded-[20px] border border-[var(--app-border-soft)] bg-[var(--app-raised)]">
                    {[
                      [t('agent.runId'), run.runId.slice(0, 8)],
                      [t('sidebar.selectWorkspace'), workspaceName],
                      ['Provider', run.provider || 'auto'],
                      [t('agent.model'), modelLabel],
                      [t('agent.created'), formatDateTime(run.createdAt, locale)],
                      [t('agent.finished'), formatDateTime(run.finishedAt, locale)],
                      ...(run.tokenUsage ? [
                        ['Input Tokens', run.tokenUsage.inputTokens.toLocaleString()],
                        ['Output Tokens', run.tokenUsage.outputTokens.toLocaleString()],
                        ['Total Tokens', run.tokenUsage.totalTokens.toLocaleString()],
                      ] : []),
                    ]
                      .filter(([, value]) => value)
                      .map(([label, value]) => (
                        <div key={label} className="flex items-center justify-between gap-4 border-b border-[var(--app-border-soft)] px-4 py-3 last:border-b-0">
                          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">{label}</span>
                          <span className="truncate text-right text-sm text-[var(--app-text)]">{value}</span>
                        </div>
                      ))}
                  </div>
                </SurfaceCard>

                {run.roles && run.roles.length > 0 && (
                  <SurfaceCard title="Role Observability">
                    <div className="space-y-3">
                      {run.roles.map((role, index) => {
                        const audit = role.inputReadAudit;
                        const auditLabel = audit?.status ? audit.status.replace(/_/g, ' ') : null;
                        const auditTone = audit?.status ? (inputAuditBadgeConfig[audit.status] || inputAuditBadgeConfig.not_applicable) : null;
                        return (
                          <div key={`${role.roleId}-${role.round}-${index}`} className="rounded-[20px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-[var(--app-text)]">{role.roleId}</span>
                              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--app-text-soft)]">
                                R{role.round}
                              </span>
                              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--app-text-soft)]">
                                {role.status}
                              </span>
                              {auditLabel && auditTone && (
                                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', auditTone)}>
                                  {auditLabel}
                                </span>
                              )}
                              {role.childConversationId && (
                                <span className="ml-auto font-mono text-[10px] text-[var(--app-text-muted)]">
                                  {role.childConversationId.slice(0, 8)}
                                </span>
                              )}
                            </div>
                            {audit?.summary && (
                              <div className="mt-2 text-sm leading-6 text-[var(--app-text-soft)]">{audit.summary}</div>
                            )}
                            {role.promptSnapshot && (
                              <div className="mt-3 rounded-[16px] border border-white/6 bg-black/15 px-3 py-3">
                                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Prompt Snapshot</div>
                                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-[var(--app-text-soft)]">
                                  {role.promptSnapshot}
                                </pre>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </SurfaceCard>
                )}
              </div>
            )}

            {tab === 'chat' && !executiveMode && renderChat && (
              <div className="h-[600px] overflow-hidden rounded-[20px] border border-[var(--app-border-soft)] bg-[linear-gradient(180deg,rgba(18,28,43,0.94)_0%,rgba(12,19,31,0.98)_100%)]">
                {renderChat()}
              </div>
            )}
          </div>

          <div className="space-y-5">
            <SurfaceCard title={executiveMode ? '检查结论' : 'Completion Evidence'}>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">{executiveMode ? '当前状态' : 'Run Status'}</div>
                    <div className="mt-1 text-sm font-medium text-[var(--app-text)]">{statusLabel}</div>
                  </div>
                  <div className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">{executiveMode ? '结果' : 'Result Status'}</div>
                    <div className="mt-1 text-sm font-medium text-[var(--app-text)]">{run.result?.status || run.resultEnvelope?.status || 'pending'}</div>
                  </div>
                  <div className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">{executiveMode ? '交付物' : 'Artifacts'}</div>
                    <div className="mt-1 text-sm font-medium text-[var(--app-text)]">{outputArtifacts.length}</div>
                  </div>
                  <div className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">{executiveMode ? '关注项' : 'Attention'}</div>
                    <div className="mt-1 text-sm font-medium text-[var(--app-text)]">
                      {hasAttention ? `${blockers.length + needsReview.length || 1} item(s)` : 'No issue'}
                    </div>
                  </div>
                </div>

                {verificationKnown && (
                  <div
                    className={cn(
                      'rounded-[18px] border px-4 py-3',
                      verificationPassed
                        ? 'border-emerald-400/18 bg-emerald-400/10 text-emerald-100'
                        : 'border-amber-400/18 bg-amber-400/10 text-amber-100',
                    )}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">Verification</div>
                    <div className="mt-1 text-sm font-medium">
                      {verificationPassed ? 'Passed' : 'Needs attention'}
                    </div>
                    {(run.reportedEventDate || run.reportedEventCount !== undefined) && (
                      <div className="mt-2 text-xs opacity-80">
                        {run.reportedEventDate && <span>Date: {run.reportedEventDate}</span>}
                        {run.reportedEventDate && run.reportedEventCount !== undefined && run.reportedEventCount !== null && <span> · </span>}
                        {run.reportedEventCount !== undefined && run.reportedEventCount !== null && <span>Count: {run.reportedEventCount}</span>}
                      </div>
                    )}
                  </div>
                )}

                {!executiveMode && run.resolutionReason && (
                  <div className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Resolution Reason</div>
                    <div className="mt-1 text-sm leading-6 text-[var(--app-text-soft)]">{run.resolutionReason}</div>
                  </div>
                )}
              </div>
            </SurfaceCard>

            {outputArtifacts.length > 0 && (
              <SurfaceCard title={executiveMode ? '主要交付物' : 'Output Artifacts'}>
                <div className="space-y-2">
                  {outputArtifacts.slice(0, 6).map((art) => (
                    <div key={art.id} className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                      <div className="text-sm text-[var(--app-text)] truncate">{art.title}</div>
                      {!executiveMode && (
                        <>
                          <div className="mt-1 truncate font-mono text-[11px] text-[var(--app-text-muted)]">{art.path}</div>
                          <div className="mt-2">
                            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[var(--app-text-soft)]">{art.kind}</span>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            )}

            {(run.reportApiResponse || run.artifactManifestPath || run.provider || run.resolvedWorkflowRef) && (
              <div className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)]/60 px-4 py-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => setShowTechnicalDetails((prev) => !prev)}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                    {executiveMode ? '技术细节（按需查看）' : 'Technical Details'}
                  </div>
                  <span className="text-xs text-[var(--app-text-soft)]">{showTechnicalDetails ? '收起' : '展开'}</span>
                </button>
                {showTechnicalDetails && (
                  <div className="mt-3 space-y-3">
                    {run.provider && (
                      <div className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Provider</div>
                        <div className="mt-1 text-sm text-[var(--app-text)]">{run.provider}</div>
                      </div>
                    )}
                    {run.resolvedWorkflowRef && (
                      <div className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Workflow</div>
                        <div className="mt-1 break-all text-sm text-[var(--app-text)]">{run.resolvedWorkflowRef}</div>
                      </div>
                    )}
                    {!executiveMode && (
                      <>
                        <div className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Workspace</div>
                          <div className="mt-1 break-all text-sm text-[var(--app-text)]">{workspaceName}</div>
                        </div>
                        <div className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Model</div>
                          <div className="mt-1 break-all text-sm text-[var(--app-text)]">{modelLabel}</div>
                        </div>
                      </>
                    )}
                    {run.reportApiResponse && (
                      <div className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Report API</div>
                        <div className="mt-1 break-all font-mono text-[11px] text-[var(--app-text-soft)]">{run.reportApiResponse}</div>
                      </div>
                    )}
                    {run.artifactManifestPath && (
                      <div className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Artifact Manifest</div>
                        <div className="mt-1 break-all font-mono text-[11px] text-[var(--app-text-soft)]">{run.artifactManifestPath}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Role Progress Timeline — additive, renders only when data exists */}
        {run.roles && run.roles.length > 0 && (
          <RoleTimeline roles={run.roles} />
        )}

        {/* Supervisor Review Log — additive, renders only when data exists */}
        {run.supervisorReviews && run.supervisorReviews.length > 0 && (
          <SupervisorReviewLog reviews={run.supervisorReviews} summary={run.supervisorSummary} />
        )}
      </div>
    </Pane>
  );
}
