'use client';

import { useState, useRef, useEffect } from 'react';
import { useI18n } from '@/components/locale-provider';
import { cn } from '@/lib/utils';
import { Activity, X, ChevronUp, ChevronDown, Bot } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface SupervisorReview {
  id: string;
  round: number;
  stepCount: number;
  decision: { status: 'HEALTHY' | 'STUCK' | 'LOOPING' | 'DONE', analysis: string, suggestedAction?: string };
  timestamp: string;
}

export interface ActiveTask {
  cascadeId: string;
  title: string;
  workspace: string;
  stepCount: number;
  totalSteps?: number;
  lastTaskBoundary?: {
    mode?: string;
    taskName?: string;
    taskStatus?: string;
    taskSummary?: string;
  };
  isActive: boolean;
  cascadeStatus?: string;
  supervisorReviews?: SupervisorReview[];
}

interface ActiveTasksPanelProps {
  tasks: ActiveTask[];
  onSelect: (cascadeId: string, title: string) => void;
  onDismiss: (cascadeId: string) => void;
  activeCascadeId?: string | null;
}

const modeColors: Record<string, string> = {
  planning: 'bg-blue-500',
  execution: 'bg-emerald-500',
  verification: 'bg-amber-500',
};

function getModeLabel(mode?: string): string {
  if (!mode) return '';
  const m = mode.replace('AGENT_MODE_', '').toLowerCase();
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function getModeColor(mode?: string): string {
  if (!mode) return 'bg-muted-foreground';
  const m = mode.replace('AGENT_MODE_', '').toLowerCase();
  return modeColors[m] || 'bg-muted-foreground';
}

function TaskItem({ task, isCurrentConversation, onSelect, onDismiss }: {
  task: ActiveTask;
  isCurrentConversation: boolean;
  onSelect: () => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const touchRef = useRef({ startX: 0, currentX: 0, swiping: false });
  const itemRef = useRef<HTMLDivElement>(null);
  const [swipeX, setSwipeX] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchRef.current.startX = e.touches[0].clientX;
    touchRef.current.swiping = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchRef.current.swiping) return;
    const dx = e.touches[0].clientX - touchRef.current.startX;
    touchRef.current.currentX = dx;
    setSwipeX(dx);
  };

  const handleTouchEnd = () => {
    if (Math.abs(touchRef.current.currentX) > 60) {
      setDismissed(true);
      setTimeout(onDismiss, 300);
    } else {
      setSwipeX(0);
    }
    touchRef.current.swiping = false;
    touchRef.current.currentX = 0;
  };

  if (dismissed) return null;

  const progressPct = task.totalSteps
    ? Math.min(100, Math.round((task.stepCount / task.totalSteps) * 100))
    : null;

  const mode = getModeLabel(task.lastTaskBoundary?.mode);
  const modeColor = getModeColor(task.lastTaskBoundary?.mode);

  return (
    <div
      ref={itemRef}
      className={cn(
        'cursor-pointer border-b border-[var(--app-border-soft)] px-3 py-3 transition-all last:border-b-0',
        isCurrentConversation ? 'bg-[var(--app-accent-soft)]' : 'hover:bg-white/[0.04]',
        dismissed && 'opacity-0 translate-x-full',
      )}
      style={{ transform: `translateX(${swipeX}px)`, opacity: dismissed ? 0 : 1 - Math.abs(swipeX) / 200 }}
      onClick={onSelect}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={cn(
            'w-2 h-2 rounded-full shrink-0',
            task.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40'
          )} />
        <span className="truncate text-xs font-medium text-[var(--app-text)]">{task.title || task.workspace}</span>
      </div>
        {mode && (
          <span className={cn(
            'text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded text-white shrink-0',
            modeColor
          )}>
            {mode}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-[var(--app-border-soft)]">
        {progressPct !== null ? (
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              task.isActive ? 'bg-gradient-to-r from-[var(--app-accent)] to-sky-400' : 'bg-muted-foreground/40'
            )}
            style={{ width: `${progressPct}%` }}
          />
        ) : (
          <div className={cn(
            'h-full rounded-full w-2/3',
            task.isActive ? 'bg-gradient-to-r from-[var(--app-accent)] to-sky-400 animate-pulse-subtle' : 'bg-muted-foreground/30'
          )} />
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-[var(--app-text-muted)]">
        <span className="truncate max-w-[200px]">
          {task.lastTaskBoundary?.taskStatus || (task.isActive ? t('activeTasks.working') : t('activeTasks.idle'))}
        </span>
        <span className="shrink-0 ml-2 font-mono">
          {task.stepCount}{task.totalSteps ? `/${task.totalSteps}` : ''} {t('activeTasks.steps', { count: '' }).trim()}
        </span>
      </div>

      {/* V3.5 AI Supervisor Logs */}
      {task.supervisorReviews && task.supervisorReviews.length > 0 && (
        <div className="mt-3 border-t border-[var(--app-border-soft)] pt-2 space-y-1.5">
          <div className="flex items-center text-[10px] font-semibold text-[var(--app-text-muted)] uppercase tracking-wider mb-2">
            <Bot className="w-3 h-3 mr-1" /> AI Supervisor
          </div>
          {task.supervisorReviews.map(rev => {
            const isWarning = rev.decision.status === 'STUCK' || rev.decision.status === 'LOOPING';
            const isDone = rev.decision.status === 'DONE';
            return (
              <div key={rev.id} className="flex flex-col gap-1 p-1.5 rounded bg-black/10 dark:bg-white/5">
                <div className="flex items-center gap-1.5">
                  <Badge variant={isWarning ? 'destructive' : isDone ? 'default' : 'secondary'} className="text-[9px] px-1 py-0 h-4">
                    {rev.decision.status}
                  </Badge>
                  {rev.decision.suggestedAction && rev.decision.suggestedAction !== 'none' && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 text-amber-400 border-amber-400/30">
                      → {rev.decision.suggestedAction}
                    </Badge>
                  )}
                  <span className="text-[9px] text-[var(--app-text-muted)]">R{rev.round} @ Step {rev.stepCount}</span>
                </div>
                <span className="text-[10px] text-[var(--app-text)] leading-tight">
                  {rev.decision.analysis}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ActiveTasksPanel({ tasks, onSelect, onDismiss, activeCascadeId }: ActiveTasksPanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);

  const activeTasks = tasks.filter(t => t.isActive);
  const taskCount = activeTasks.length;

  // Auto show/hide based on active tasks
  useEffect(() => {
    if (taskCount > 0) {
      const timer = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [taskCount]);

  // If nothing to show, render nothing
  if (!visible && taskCount === 0) return null;

  // Collapsed badge
  if (!expanded) {
    return (
      <button
        className={cn(
          'fixed bottom-24 right-6 z-50 flex items-center gap-2 rounded-full border px-3 py-2 shadow-lg transition-all',
          'border-[var(--app-border-soft)] bg-[rgba(9,17,27,0.92)] backdrop-blur-xl supports-[backdrop-filter]:bg-[rgba(9,17,27,0.84)]',
          'hover:scale-105 active:scale-95',
          taskCount > 0 ? 'border-[var(--app-accent)]/30' : 'opacity-60'
        )}
        onClick={() => setExpanded(true)}
      >
        <Activity className={cn('w-4 h-4', taskCount > 0 ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]')} />
        <span className={cn('text-xs font-semibold', taskCount > 0 ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]')}>
          {taskCount}
        </span>
        <ChevronUp className="w-3 h-3 text-[var(--app-text-muted)]" />
      </button>
    );
  }

  // Expanded panel
  return (
    <div className={cn(
      'fixed bottom-24 right-6 z-50 w-80 overflow-hidden rounded-[20px] border shadow-2xl',
      'border-[var(--app-border-soft)] bg-[rgba(9,17,27,0.94)] backdrop-blur-xl supports-[backdrop-filter]:bg-[rgba(9,17,27,0.84)]',
      'animate-in slide-in-from-bottom-4 fade-in duration-200',
    )}>
      <div className="flex items-center justify-between border-b border-[var(--app-border-soft)] bg-white/[0.03] px-3 py-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[var(--app-accent)]" />
          <span className="text-xs font-semibold text-[var(--app-text)]">
            {taskCount} {taskCount === 1 ? t('activeTasks.activeTask') : t('activeTasks.activeTasks')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-muted transition-colors"
            onClick={() => setExpanded(false)}
          >
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button
            className="p-1 rounded hover:bg-muted transition-colors"
            onClick={() => { setExpanded(false); setVisible(false); }}
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Task list */}
      <div className="max-h-[280px] overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[var(--app-text-muted)]">
            {t('activeTasks.noActiveTasks')}
          </div>
        ) : (
          tasks.map(task => (
            <TaskItem
              key={task.cascadeId}
              task={task}
              isCurrentConversation={task.cascadeId === activeCascadeId}
              onSelect={() => {
                onSelect(task.cascadeId, task.title || task.workspace);
                setExpanded(false);
              }}
              onDismiss={() => onDismiss(task.cascadeId)}
            />
          ))
        )}
      </div>
    </div>
  );
}
