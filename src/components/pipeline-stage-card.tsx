'use client';

import {
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  SkipForward,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PipelineStageProgressFE, RoleProgressFE } from '@/lib/types';

interface PipelineStageCardProps {
  stage: PipelineStageProgressFE;
  stageTitle?: string;
  isSelected: boolean;
  isCurrentStage: boolean;
  roles?: RoleProgressFE[];
  selectedRoleKey?: string | null;
  onClick: () => void;
  onSelectRole?: (roleKey: string) => void;
}

const stageStatusConfig: Record<string, {
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
  label: string;
}> = {
  pending: {
    icon: <Clock className="h-4 w-4" />,
    color: 'text-white/40',
    bg: 'bg-white/5',
    border: 'border-white/8',
    label: 'Pending',
  },
  running: {
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    color: 'text-sky-400',
    bg: 'bg-sky-400/10',
    border: 'border-sky-400/20',
    label: 'Running',
  },
  completed: {
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/20',
    label: 'Completed',
  },
  failed: {
    icon: <AlertTriangle className="h-4 w-4" />,
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    border: 'border-red-400/20',
    label: 'Failed',
  },
  blocked: {
    icon: <AlertTriangle className="h-4 w-4" />,
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/20',
    label: 'Blocked',
  },
  cancelled: {
    icon: <Clock className="h-4 w-4" />,
    color: 'text-slate-300',
    bg: 'bg-slate-300/10',
    border: 'border-slate-300/20',
    label: 'Cancelled',
  },
  skipped: {
    icon: <SkipForward className="h-4 w-4" />,
    color: 'text-slate-400',
    bg: 'bg-slate-400/10',
    border: 'border-slate-400/20',
    label: 'Skipped',
  },
};

const roleStatusIcons: Record<string, { icon: React.ReactNode; color: string }> = {
  pending:   { icon: <Clock className="h-3 w-3" />,                      color: 'text-white/30' },
  queued:    { icon: <Clock className="h-3 w-3" />,                      color: 'text-white/30' },
  starting:  { icon: <Loader2 className="h-3 w-3 animate-spin" />,      color: 'text-sky-400' },
  running:   { icon: <Loader2 className="h-3 w-3 animate-spin" />,      color: 'text-sky-400' },
  completed: { icon: <CheckCircle2 className="h-3 w-3" />,              color: 'text-emerald-400' },
  blocked:   { icon: <AlertTriangle className="h-3 w-3" />,             color: 'text-amber-400' },
  failed:    { icon: <AlertTriangle className="h-3 w-3" />,             color: 'text-red-400' },
  cancelled: { icon: <Clock className="h-3 w-3" />,                     color: 'text-slate-300' },
};

const reviewDecisionColors: Record<string, string> = {
  approved: 'bg-emerald-500/15 text-emerald-400',
  revise: 'bg-amber-500/15 text-amber-400',
  rejected: 'bg-red-500/15 text-red-400',
};

function formatElapsedTime(startedAt?: string, finishedAt?: string): string | null {
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

function makeRoleKey(role: RoleProgressFE, index: number): string {
  return `${role.roleId}:${role.round}:${index}`;
}

export { makeRoleKey };

export default function PipelineStageCard({
  stage,
  stageTitle,
  isSelected,
  isCurrentStage,
  roles,
  selectedRoleKey,
  onClick,
  onSelectRole,
}: PipelineStageCardProps) {
  const config = stageStatusConfig[stage.status] || stageStatusConfig.pending;
  const displayTitle = stageTitle || stage.groupId;
  const isPending = stage.status === 'pending';
  const elapsed = formatElapsedTime(stage.startedAt, stage.completedAt);

  return (
    <div className="flex flex-col">
      {/* Stage header row */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${displayTitle} stage`}
        aria-selected={isSelected}
        className={cn(
          'group relative cursor-pointer rounded-2xl border p-4 transition-all duration-200',
          isPending && 'opacity-50',
          isSelected
            ? 'border-sky-400/30 bg-sky-400/[0.06] shadow-[0_0_20px_rgba(14,165,233,0.12)]'
            : 'border-white/8 bg-white/[0.02] hover:border-white/14 hover:bg-white/[0.04]',
          isCurrentStage && !isSelected && 'border-sky-400/15',
          stage.status === 'failed' && !isSelected && 'border-red-400/20 bg-red-400/[0.04]',
          stage.status === 'blocked' && !isSelected && 'border-amber-400/20 bg-amber-400/[0.04]',
          stage.status === 'cancelled' && !isSelected && 'border-slate-300/20 bg-slate-300/[0.04]',
        )}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors',
              config.border, config.bg, config.color,
              isCurrentStage && stage.status === 'running' && 'shadow-[0_0_15px_rgba(14,165,233,0.25)]',
            )}
          >
            {config.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-white/90" title={displayTitle}>
                {displayTitle}
              </span>
              {stage.attempts > 1 && (
                <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                  ×{stage.attempts}
                </span>
              )}
              {roles && roles.length > 0 && (
                <span className="shrink-0 rounded-full bg-white/8 px-1.5 py-0.5 text-[10px] font-medium text-white/40">
                  {roles.length} roles
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className={cn('text-[11px] font-medium uppercase tracking-wide', config.color)}>
                {config.label}
              </span>
              {elapsed && (
                <span className="text-[11px] text-white/30 font-mono">{elapsed}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Inline Role Progress sub-nodes */}
      {roles && roles.length > 0 && !isPending && (
        <div className="relative ml-[18px] border-l border-white/8 pl-5 pt-1 pb-1">
          {roles.map((role, index) => {
            const roleKey = makeRoleKey(role, index);
            const rs = roleStatusIcons[role.status] || roleStatusIcons.pending;
            const duration = formatElapsedTime(role.startedAt, role.finishedAt);
            const isRoleSelected = selectedRoleKey === roleKey;

            return (
              <div
                key={roleKey}
                role="button"
                tabIndex={0}
                className={cn(
                  'group/role relative flex flex-col gap-1 rounded-xl px-3 py-2 -ml-1 cursor-pointer transition-colors',
                  isRoleSelected
                    ? 'bg-sky-400/[0.08] border border-sky-400/20'
                    : 'hover:bg-white/[0.04] border border-transparent',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRole?.(roleKey);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectRole?.(roleKey);
                  }
                }}
              >
                <div className="flex items-center gap-2.5">
                  {/* Role status icon */}
                  <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/8 bg-white/[0.03]', rs.color)}>
                    {rs.icon}
                  </div>

                  {/* Role info */}
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
                {/* Role summary preview */}
                {role.result?.summary && (
                  <div className="ml-[34px] text-[11px] leading-4 text-white/35 line-clamp-1">
                    {role.result.summary.split('\n')[0].slice(0, 120)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
