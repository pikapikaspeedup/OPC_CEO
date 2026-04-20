'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, Clock, CheckCircle2, XCircle, MessageCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { ApprovalRequestFE, ApprovalSummaryFE } from '@/lib/types';

// ---------------------------------------------------------------------------
// Urgency badge
// ---------------------------------------------------------------------------

function UrgencyBadge({ urgency }: { urgency: ApprovalRequestFE['urgency'] }) {
  const cls = {
    critical: 'bg-red-500/10 border-red-500/20 text-red-300',
    high: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    normal: 'bg-sky-500/10 border-sky-500/20 text-sky-300',
    low: 'bg-white/5 border-white/10 text-white/50',
  }[urgency];

  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', cls)}>
      {urgency === 'critical' ? '紧急' : urgency === 'high' ? '高' : urgency === 'normal' ? '普通' : '低'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Type icon
// ---------------------------------------------------------------------------

function TypeIcon({ type }: { type: ApprovalRequestFE['type'] }) {
  const icons: Record<string, string> = {
    token_increase: '🪙',
    tool_access: '🔧',
    provider_change: '🔄',
    scope_extension: '📂',
    pipeline_approval: '🔗',
    proposal_publish: '🧬',
    other: '📋',
  };
  return <span className="text-sm">{icons[type] || '📋'}</span>;
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: ApprovalRequestFE['status'] }) {
  switch (status) {
    case 'pending': return <Clock className="h-3.5 w-3.5 text-amber-400" />;
    case 'approved': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
    case 'rejected': return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    case 'feedback': return <MessageCircle className="h-3.5 w-3.5 text-sky-400" />;
  }
}

// ---------------------------------------------------------------------------
// Request card
// ---------------------------------------------------------------------------

interface RequestCardProps {
  request: ApprovalRequestFE;
  onRespond: (id: string, action: 'approved' | 'rejected' | 'feedback', message?: string) => Promise<void>;
}

function RequestCard({ request, onRespond }: RequestCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [responding, setResponding] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [runContext, setRunContext] = useState<{ status: string; lastError?: string; prompt?: string; model?: string; elapsed?: string } | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  // Fetch run context when expanded and has runId
  useEffect(() => {
    if (!expanded || !request.runId || runContext) return;
    setLoadingContext(true);
    api.agentRun(request.runId)
      .then(run => {
        const elapsed = run.startedAt
          ? `${Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 60000)}m`
          : undefined;
        setRunContext({
          status: run.status,
          lastError: run.lastError,
          prompt: run.prompt,
          model: run.model,
          elapsed,
        });
      })
      .catch(() => {})
      .finally(() => setLoadingContext(false));
  }, [expanded, request.runId, runContext]);

  const handleAction = async (action: 'approved' | 'rejected') => {
    setResponding(true);
    try {
      await onRespond(request.id, action);
    } finally {
      setResponding(false);
    }
  };

  const handleFeedback = async () => {
    if (!feedbackText.trim()) return;
    setResponding(true);
    try {
      await onRespond(request.id, 'feedback', feedbackText.trim());
      setFeedbackText('');
      setShowFeedback(false);
    } finally {
      setResponding(false);
    }
  };

  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(request.createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins}分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    return `${Math.floor(hours / 24)}天前`;
  }, [request.createdAt]);

  const deptName = request.workspace.split('/').pop() || request.workspace;

  return (
    <div className={cn(
      'rounded-lg border px-4 py-3 transition-colors',
      request.urgency === 'critical'
        ? 'border-red-500/20 bg-red-500/[0.03]'
        : request.urgency === 'high'
        ? 'border-amber-500/20 bg-amber-500/[0.03]'
        : 'border-white/6 bg-white/[0.02]',
    )}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <TypeIcon type={request.type} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white/90 truncate">{request.title}</span>
            <UrgencyBadge urgency={request.urgency} />
            <StatusIcon status={request.status} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--app-text-muted)]">
            <span>{deptName}</span>
            <span>·</span>
            <span>{timeAgo}</span>
            {request.runId && (
              <>
                <span>·</span>
                <span className="font-mono text-[10px]">{request.runId.slice(0, 8)}</span>
              </>
            )}
          </div>
        </div>

        {/* Expand/collapse */}
        <button
          className="rounded-md p-1 text-[var(--app-text-muted)] hover:text-white hover:bg-white/10 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-white/6 pt-3">
          <p className="text-sm text-[var(--app-text-soft)] whitespace-pre-wrap">{request.description}</p>

          {/* Run context (C3) */}
          {request.runId && (
            <div className="rounded-md border border-white/8 bg-white/[0.02] px-3 py-2 space-y-1.5">
              <div className="text-[11px] font-medium text-[var(--app-text-muted)]">关联 Run 上下文</div>
              {loadingContext ? (
                <div className="flex items-center gap-1.5 text-xs text-[var(--app-text-muted)]">
                  <Loader2 className="h-3 w-3 animate-spin" /> 加载中...
                </div>
              ) : runContext ? (
                <div className="space-y-1">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 font-medium',
                      runContext.status === 'failed' ? 'bg-red-500/10 text-red-300' :
                      runContext.status === 'running' ? 'bg-sky-500/10 text-sky-300' :
                      'bg-white/5 text-white/60',
                    )}>{runContext.status}</span>
                    {runContext.model && <span className="text-[var(--app-text-muted)]">{runContext.model}</span>}
                    {runContext.elapsed && <span className="text-[var(--app-text-muted)]">{runContext.elapsed}</span>}
                  </div>
                  {runContext.prompt && (
                    <div className="text-xs text-[var(--app-text-soft)] truncate">
                      📝 {runContext.prompt.length > 80 ? runContext.prompt.slice(0, 80) + '…' : runContext.prompt}
                    </div>
                  )}
                  {runContext.lastError && (
                    <div className="rounded border border-red-500/15 bg-red-500/[0.03] px-2 py-1.5 text-xs text-red-300 font-mono whitespace-pre-wrap max-h-24 overflow-auto">
                      {runContext.lastError}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-[var(--app-text-muted)]">无法加载 Run 上下文</div>
              )}
            </div>
          )}

          {/* Response history */}
          {request.response && (
            <div className={cn(
              'rounded-md border px-3 py-2 text-sm',
              request.response.action === 'approved'
                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                : request.response.action === 'rejected'
                ? 'border-red-500/20 bg-red-500/5 text-red-300'
                : 'border-sky-500/20 bg-sky-500/5 text-sky-300',
            )}>
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <StatusIcon status={request.response.action === 'approved' ? 'approved' : request.response.action === 'rejected' ? 'rejected' : 'feedback'} />
                {request.response.action === 'approved' ? '已批准' : request.response.action === 'rejected' ? '已拒绝' : '已反馈'}
                <span className="text-[10px] opacity-60">via {request.response.channel}</span>
              </div>
              {request.response.message && (
                <p className="mt-1 text-xs opacity-80">{request.response.message}</p>
              )}
            </div>
          )}

          {/* Action buttons (only for pending) */}
          {request.status === 'pending' && (
            <div className="flex items-center gap-2">
              <button
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/25 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-40"
                onClick={() => handleAction('approved')}
                disabled={responding}
              >
                {responding ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                批准
              </button>
              <button
                className="flex items-center gap-1.5 rounded-lg bg-red-500/15 border border-red-500/25 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/25 transition-colors disabled:opacity-40"
                onClick={() => handleAction('rejected')}
                disabled={responding}
              >
                {responding ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                拒绝
              </button>
              <button
                className="flex items-center gap-1.5 rounded-lg bg-sky-500/15 border border-sky-500/25 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25 transition-colors"
                onClick={() => setShowFeedback(!showFeedback)}
              >
                <MessageCircle className="h-3 w-3" />
                反馈
              </button>
            </div>
          )}

          {/* Feedback input */}
          {showFeedback && request.status === 'pending' && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-sky-500/40"
                placeholder="输入额外说明..."
                value={feedbackText}
                onChange={e => setFeedbackText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleFeedback()}
                disabled={responding}
              />
              <button
                className="rounded-lg bg-sky-500/15 border border-sky-500/25 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25 transition-colors disabled:opacity-40"
                onClick={handleFeedback}
                disabled={responding || !feedbackText.trim()}
              >
                发送
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export interface ApprovalPanelProps {
  /** Auto-refresh interval in ms (default: 30000) */
  refreshInterval?: number;
}

export default function ApprovalPanel({ refreshInterval = 30_000 }: ApprovalPanelProps) {
  const [requests, setRequests] = useState<ApprovalRequestFE[]>([]);
  const [summary, setSummary] = useState<ApprovalSummaryFE | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending'>('pending');

  const loadData = useCallback(async () => {
    try {
      const result = await api.listApprovals(filter === 'pending' ? { status: 'pending' } : undefined);
      setRequests(result.requests);
      setSummary(result.summary);
    } catch {
      // silently fail — dashboard should stay usable
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, refreshInterval);
    return () => clearInterval(timer);
  }, [loadData, refreshInterval]);

  const handleRespond = useCallback(async (id: string, action: 'approved' | 'rejected' | 'feedback', message?: string) => {
    await api.respondApproval(id, action, message);
    await loadData();
  }, [loadData]);

  const pendingCount = summary?.pending ?? 0;

  if (loading) {
    return (
      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-5">
        <div className="flex items-center gap-2 text-sm text-[var(--app-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载审批请求...
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--app-text-soft)]">
          {pendingCount > 0 ? (
            <ShieldAlert className="h-4 w-4 text-amber-400" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          )}
          审批
          {pendingCount > 0 && (
            <span className="rounded-full bg-amber-500/15 border border-amber-500/25 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              {pendingCount} 待处理
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1 text-[10px]">
          <button
            className={cn(
              'rounded-md px-2 py-0.5 transition-colors',
              filter === 'pending' ? 'bg-white/10 text-white' : 'text-[var(--app-text-muted)] hover:text-white',
            )}
            onClick={() => setFilter('pending')}
          >
            待处理
          </button>
          <button
            className={cn(
              'rounded-md px-2 py-0.5 transition-colors',
              filter === 'all' ? 'bg-white/10 text-white' : 'text-[var(--app-text-muted)] hover:text-white',
            )}
            onClick={() => setFilter('all')}
          >
            全部
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
        {requests.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-4">
            <ShieldCheck className="h-8 w-8 text-emerald-400/40" />
            <span className="text-sm text-[var(--app-text-muted)]">
              {filter === 'pending' ? '没有待处理的审批请求' : '暂无审批请求'}
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {requests.map(req => (
              <RequestCard key={req.id} request={req} onRespond={handleRespond} />
            ))}
          </div>
        )}

        {/* Summary footer */}
        {summary && summary.total > 0 && (
          <div className="mt-3 flex items-center gap-3 border-t border-white/6 pt-3 text-[10px] text-[var(--app-text-muted)]">
            <span>总计 {summary.total}</span>
            {summary.approved > 0 && <span className="text-emerald-400">✓ {summary.approved} 已批准</span>}
            {summary.rejected > 0 && <span className="text-red-400">✕ {summary.rejected} 已拒绝</span>}
            {summary.feedback > 0 && <span className="text-sky-400">💬 {summary.feedback} 反馈中</span>}
          </div>
        )}
      </div>
    </div>
  );
}
