'use client';

import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import type { DailyDigestFE } from '@/lib/types';

interface DailyDigestCardProps {
  digest: DailyDigestFE;
  onNavigateToProject: (projectId: string) => void;
}

export default function DailyDigestCard({ digest, onNavigateToProject }: DailyDigestCardProps) {
  const dateLabel = (() => {
    const [y, m, d] = digest.date.split('-');
    if (digest.period === 'month') return `${parseInt(m)}月`;
    if (digest.period === 'week') {
      const end = new Date(`${y}-${m}-${d}T00:00:00Z`);
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - 6);
      return `${start.getUTCMonth() + 1}/${start.getUTCDate()} - ${end.getUTCMonth() + 1}/${end.getUTCDate()}`;
    }
    return `${parseInt(m)}月${parseInt(d)}日`;
  })();

  const periodLabel = digest.period === 'month' ? '月报' : digest.period === 'week' ? '周报' : '日报';

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          📊 {dateLabel} {periodLabel} — {digest.departmentName}
        </h3>
      </div>

      <p className="text-sm text-[var(--app-text-soft)]">{digest.summary}</p>

      {/* Completed tasks */}
      {digest.tasksCompleted.length > 0 && (
        <div className="space-y-1.5">
          {digest.tasksCompleted.map(task => (
            <button
              key={task.projectId}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-emerald-400/80 hover:bg-white/5 transition-colors"
              onClick={() => onNavigateToProject(task.projectId)}
            >
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{task.projectName}</span>
            </button>
          ))}
        </div>
      )}

      {/* In-progress tasks */}
      {digest.tasksInProgress.length > 0 && (
        <div className="space-y-1.5">
          {digest.tasksInProgress.map(task => (
            <button
              key={task.projectId}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-sky-400/80 hover:bg-white/5 transition-colors"
              onClick={() => onNavigateToProject(task.projectId)}
            >
              <Loader2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{task.projectName}</span>
              {task.progress && (
                <span className="ml-auto text-xs text-[var(--app-text-muted)]">({task.progress})</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Blockers */}
      {digest.blockers.length > 0 && (
        <div className="space-y-1.5">
          {digest.blockers.map(blocker => (
            <div
              key={blocker.projectId}
              className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-amber-400/80"
            >
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <div>
                <span>{blocker.description}</span>
                {blocker.since && (
                  <span className="ml-1 text-xs text-[var(--app-text-muted)]">
                    ({blocker.since.slice(0, 10)})
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Token usage */}
      {digest.tokenUsage && (
        <div className="flex items-center gap-4 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-[var(--app-text-muted)]">
          <span>🪙 Token 消耗</span>
          <span>输入: {(digest.tokenUsage.inputTokens / 1000).toFixed(1)}k</span>
          <span>输出: {(digest.tokenUsage.outputTokens / 1000).toFixed(1)}k</span>
          <span className="ml-auto font-medium text-amber-400/70">
            ≈ ${digest.tokenUsage.estimatedCostUsd.toFixed(2)}
          </span>
        </div>
      )}

      {/* Empty state */}
      {digest.tasksCompleted.length === 0 && digest.tasksInProgress.length === 0 && digest.blockers.length === 0 && (
        <p className="text-sm text-[var(--app-text-muted)] text-center py-2">今日暂无活动</p>
      )}
    </div>
  );
}
