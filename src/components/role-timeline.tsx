'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RoleProgressFE, ReviewOutcome } from '@/lib/types';
import { Pane } from '@/components/ui/app-shell';

// ---------------------------------------------------------------------------
// ReviewOutcomeBadge
// ---------------------------------------------------------------------------

interface ReviewOutcomeBadgeProps {
  outcome: ReviewOutcome;
}

export function ReviewOutcomeBadge({ outcome }: ReviewOutcomeBadgeProps) {
  const config: Record<ReviewOutcome, { icon: React.ReactNode; color: string; bg: string; border: string; label: string }> = {
    approved: {
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      color: 'text-emerald-400',
      bg: 'bg-emerald-400/12',
      border: 'border-emerald-400/20',
      label: 'Approved',
    },
    rejected: {
      icon: <XCircle className="h-3.5 w-3.5" />,
      color: 'text-red-400',
      bg: 'bg-red-400/12',
      border: 'border-red-400/20',
      label: 'Rejected',
    },
    'revise-exhausted': {
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
      color: 'text-amber-400',
      bg: 'bg-amber-400/12',
      border: 'border-amber-400/20',
      label: 'Revise Exhausted',
    },
  };

  const c = config[outcome];
  if (!c) return null;

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold',
      c.bg, c.color, c.border,
    )}>
      {c.icon}
      <span>{c.label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SupervisorReviewLog
// ---------------------------------------------------------------------------

interface SupervisorReviewLogProps {
  reviews: Array<{
    id: string;
    round: number;
    stepCount: number;
    decision: { status: 'HEALTHY' | 'STUCK' | 'LOOPING' | 'DONE'; analysis: string; suggestedAction?: string };
    timestamp: string;
  }>;
  summary?: {
    totalRounds: number;
    healthyCount: number;
    stuckCount: number;
    loopingCount: number;
    doneCount: number;
    consecutiveStuckPeak: number;
    suggestedActions: string[];
  };
}

export function SupervisorReviewLog({ reviews, summary }: SupervisorReviewLogProps) {
  const [expanded, setExpanded] = useState(false);

  if (!reviews || reviews.length === 0) return null;

  const statusColors: Record<string, string> = {
    HEALTHY: 'text-emerald-400',
    DONE: 'text-emerald-400',
    STUCK: 'text-amber-400',
    LOOPING: 'text-red-400',
  };

  return (
    <Pane tone="soft" className="p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-sky-400" />
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
            Supervisor Reviews ({reviews.length})
          </span>
          {summary && (summary.stuckCount > 0 || summary.loopingCount > 0) && (
            <span className="text-[10px] font-mono text-amber-400">
              {summary.stuckCount > 0 && `${summary.stuckCount} stuck`}
              {summary.stuckCount > 0 && summary.loopingCount > 0 && ' · '}
              {summary.loopingCount > 0 && `${summary.loopingCount} looping`}
              {summary.consecutiveStuckPeak >= 3 && ' ⚠ cancel suggested'}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-white/40" />
        ) : (
          <ChevronDown className="h-4 w-4 text-white/40" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-2">
          {reviews.map((review) => (
            <div
              key={review.id}
              className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-white/50">
                    Round {review.round}
                  </span>
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase',
                    statusColors[review.decision.status] || 'text-white/40',
                  )}>
                    {review.decision.status}
                  </span>
                  {review.decision.suggestedAction && review.decision.suggestedAction !== 'none' && (
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-mono text-amber-300">
                      → {review.decision.suggestedAction}
                    </span>
                  )}
                  <span className="text-[10px] text-white/30 font-mono">
                    {review.stepCount} steps
                  </span>
                </div>
                <span className="text-[10px] text-white/30 font-mono">
                  {new Date(review.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {review.decision.analysis && (
                <p className="mt-1.5 text-[12px] leading-5 text-white/50 line-clamp-3">
                  {review.decision.analysis}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Pane>
  );
}

// ---------------------------------------------------------------------------
// RoleTimeline
// ---------------------------------------------------------------------------

interface RoleTimelineProps {
  roles: RoleProgressFE[];
}

const roleStatusConfig: Record<string, {
  icon: React.ReactNode;
  color: string;
  borderColor: string;
}> = {
  pending: {
    icon: <Clock className="h-3.5 w-3.5" />,
    color: 'text-white/30',
    borderColor: 'border-white/10',
  },
  running: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    color: 'text-sky-400',
    borderColor: 'border-sky-400/20',
  },
  completed: {
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    color: 'text-emerald-400',
    borderColor: 'border-emerald-400/20',
  },
  failed: {
    icon: <XCircle className="h-3.5 w-3.5" />,
    color: 'text-red-400',
    borderColor: 'border-red-400/20',
  },
};

function formatRoleDuration(startedAt?: string, finishedAt?: string): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

const reviewDecisionColors: Record<string, string> = {
  approved: 'bg-emerald-500/15 text-emerald-400',
  revise: 'bg-amber-500/15 text-amber-400',
  rejected: 'bg-red-500/15 text-red-400',
};

export default function RoleTimeline({ roles }: RoleTimelineProps) {
  if (!roles || roles.length === 0) return null;

  return (
    <Pane tone="soft" className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <User className="h-4 w-4 text-sky-400" />
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
          Role Progress
        </span>
      </div>

      <div className="relative flex flex-col gap-2">
        {/* Connecting line */}
        <div className="absolute left-[15px] top-4 bottom-4 w-px bg-gradient-to-b from-white/15 via-white/8 to-transparent" />

        {roles.map((role, index) => {
          const status = roleStatusConfig[role.status] || roleStatusConfig.pending;
          const duration = formatRoleDuration(role.startedAt, role.finishedAt);

          return (
            <div key={`${role.roleId}-${role.round}-${index}`} className="relative flex items-center gap-3">
              {/* Node */}
              <div className={cn(
                'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                status.borderColor,
                'bg-white/[0.03]',
                status.color,
              )}>
                {status.icon}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <span className="text-[12px] font-medium text-white/70 truncate">
                  {role.roleId}
                </span>
                <span className="shrink-0 text-[10px] font-mono text-white/30">
                  R{role.round}
                </span>
                {role.reviewDecision && (
                  <span className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase',
                    reviewDecisionColors[role.reviewDecision] || 'bg-white/5 text-white/40',
                  )}>
                    {role.reviewDecision}
                  </span>
                )}
                {duration && (
                  <span className="shrink-0 text-[10px] text-white/25 font-mono ml-auto">
                    {duration}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Pane>
  );
}
