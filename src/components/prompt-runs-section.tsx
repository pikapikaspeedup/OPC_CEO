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
}

export default function PromptRunsSection({ runs, onCancel }: PromptRunsSectionProps) {
  const { locale, t } = useI18n();

  if (runs.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 px-1 mb-3">
        <MessageSquare className="h-4 w-4 text-orange-400/60" />
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-400/60">
          Prompt Runs
        </span>
        <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-orange-500/30 text-orange-500/60">
          {runs.length}
        </Badge>
      </div>

      <div className="space-y-2">
        {runs.map((run) => {
          const active = isAgentRunActive(run.status);
          const duration = getAgentRunDuration(run);
          const icon = statusIcon[run.status] || statusIcon.queued;
          const color = statusColor[run.status] || statusColor.queued;

          return (
            <div
              key={run.runId}
              className={cn(
                'rounded-xl border px-4 py-3 transition-all',
                active
                  ? 'border-orange-500/20 bg-orange-500/[0.04]'
                  : 'border-white/8 bg-white/[0.02]',
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn('mt-0.5 shrink-0', color)}>{icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium line-clamp-2 leading-snug">
                    {run.prompt}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-1.5">
                    <Badge
                      variant="outline"
                      className="text-[9px] h-4 px-1.5 border-orange-500/30 text-orange-500/80 bg-orange-500/10"
                    >
                      Prompt
                    </Badge>
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
                    onClick={() => onCancel(run.runId)}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>

              {/* Summary preview */}
              {run.result?.summary && (
                <div className="mt-2 pl-6 text-[11px] leading-relaxed text-white/40 line-clamp-3">
                  {run.result.summary}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
