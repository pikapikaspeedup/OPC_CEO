'use client';

import type { AgentRun } from '@/lib/types';
import { cn } from '@/lib/utils';
import { isAgentRunActive, getAgentRunTimeAgo, getAgentRunDuration } from '@/lib/agent-run-utils';
import { useI18n } from '@/components/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  XCircle,
  Ban,
  AlertCircle,
  ShieldCheck,
  Package,
} from 'lucide-react';

const statusIcon: Record<string, React.ReactNode> = {
  queued: <Clock className="h-3.5 w-3.5" />,
  starting: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  completed: <CheckCircle2 className="h-3.5 w-3.5" />,
  failed: <XCircle className="h-3.5 w-3.5" />,
  cancelled: <Ban className="h-3.5 w-3.5" />,
  blocked: <AlertCircle className="h-3.5 w-3.5" />,
};

const statusColor: Record<string, string> = {
  queued: 'text-white/40',
  starting: 'text-sky-400',
  running: 'text-emerald-400',
  completed: 'text-emerald-400',
  failed: 'text-red-400',
  cancelled: 'text-white/40',
  blocked: 'text-amber-400',
};

interface PromptRunsSectionProps {
  runs: AgentRun[];
  onCancel: (runId: string) => void;
  selectedRunId?: string | null;
  onSelectRun?: (runId: string) => void;
  compactTimeline?: boolean;
}

export default function PromptRunsSection({
  runs,
  onCancel,
  selectedRunId = null,
  onSelectRun,
  compactTimeline = false,
}: PromptRunsSectionProps) {
  const { locale, t } = useI18n();

  if (runs.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 px-1 mb-3">
        <MessageSquare className="h-4 w-4 text-orange-400/60" />
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-400/60">
          {locale === 'zh' ? '执行记录' : 'Run History'}
        </span>
        <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-orange-500/30 text-orange-500/60">
          {runs.length}
        </Badge>
      </div>

      <div className={cn(compactTimeline ? 'relative space-y-2 pl-7' : 'space-y-2')}>
        {compactTimeline && runs.length > 1 && (
          <div className="absolute left-[12px] top-3 bottom-3 w-px bg-gradient-to-b from-white/12 via-white/8 to-transparent" />
        )}
        {runs.map((run) => {
          const active = isAgentRunActive(run.status);
          const duration = getAgentRunDuration(run);
          const icon = statusIcon[run.status] || statusIcon.queued;
          const color = statusColor[run.status] || statusColor.queued;
          const artifactCount = run.resultEnvelope?.outputArtifacts?.length || 0;
          const isSelected = selectedRunId === run.runId;
          const verificationKnown = typeof run.verificationPassed === 'boolean';

          return (
            <div
              key={run.runId}
              role={onSelectRun ? 'button' : undefined}
              tabIndex={onSelectRun ? 0 : undefined}
              onClick={() => onSelectRun?.(run.runId)}
              onKeyDown={(event) => {
                if (!onSelectRun) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectRun(run.runId);
                }
              }}
              className={cn(
                compactTimeline ? 'rounded-lg border px-3 py-2.5 transition-all' : 'rounded-xl border px-4 py-3 transition-all',
                onSelectRun && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50',
                active
                  ? 'border-orange-500/20 bg-orange-500/[0.04]'
                  : 'border-white/8 bg-white/[0.02]',
                isSelected && 'border-sky-400/28 bg-sky-400/[0.08] shadow-[0_0_0_1px_rgba(56,189,248,0.12)]',
              )}
            >
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  {compactTimeline && (
                    <span className={cn(
                      'absolute -left-[19px] top-1.5 h-2.5 w-2.5 rounded-full border border-slate-950',
                      run.status === 'completed' ? 'bg-emerald-400' :
                        run.status === 'failed' || run.status === 'blocked' ? 'bg-amber-400' :
                          active ? 'bg-sky-400' : 'bg-white/30',
                    )} />
                  )}
                  {!compactTimeline && <div className={cn('mt-0.5 shrink-0', color)}>{icon}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cn(compactTimeline ? 'text-[12px] font-medium line-clamp-1' : 'text-xs font-medium line-clamp-2 leading-snug')}>
                    {run.prompt}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      {getAgentRunTimeAgo(run.createdAt, locale)}
                    </span>
                    {duration && (
                      <span className="text-[10px] text-muted-foreground">
                        {t('agent.duration', { value: duration })}
                      </span>
                    )}
                  </div>
                </div>
                {active && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancel(run.runId);
                    }}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>

              {/* Summary preview */}
              {!compactTimeline && run.result?.summary && (
                <div className="mt-2 pl-6 text-[11px] leading-relaxed text-white/40 line-clamp-3">
                  {run.result.summary}
                </div>
              )}

              <div className={cn('mt-3 flex flex-wrap items-center gap-2', compactTimeline ? '' : 'pl-6')}>
                {artifactCount > 0 && (
                  <span className="inline-flex h-5 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 text-[10px] font-medium text-white/55">
                    <Package className="h-3 w-3" />
                    {artifactCount} deliverables
                  </span>
                )}
                {run.reportedEventCount !== undefined && run.reportedEventCount !== null && (
                  <span className="inline-flex h-5 items-center gap-1 rounded-full border border-emerald-400/18 bg-emerald-400/10 px-2 text-[10px] font-medium text-emerald-200">
                    <ShieldCheck className="h-3 w-3" />
                    {run.reportedEventCount} verified items
                  </span>
                )}
                {verificationKnown && (
                  <span className={cn(
                    'inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium',
                    run.verificationPassed
                      ? 'border-emerald-400/18 bg-emerald-400/10 text-emerald-200'
                      : 'border-amber-400/18 bg-amber-400/10 text-amber-200',
                  )}>
                    {run.verificationPassed ? 'Verification passed' : 'Verification pending'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
