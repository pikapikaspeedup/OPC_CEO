'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell, Zap, Play, X, CheckCircle2, AlertTriangle,
  RotateCcw, SkipForward, Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ApprovalPanel from '@/components/approval-panel';
import type { CEOEvent, AgentRun, Project } from '@/lib/types';

// ─── Badge ────────────────────────────────────────────────────

function Badge({ count, color }: { count: number; color: string }) {
  if (count <= 0) return null;
  const label = count > 9 ? '9+' : String(count);
  return (
    <span className={cn(
      'absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold',
      color,
    )}>
      {label}
    </span>
  );
}

// ─── Drawer Shell ─────────────────────────────────────────────

function DrawerShell({ open, onClose, title, children, width = 400 }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: number;
}) {
  // Prevent scroll & close on Esc
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  // Portal to document.body to escape any overflow:hidden / stacking context
  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end">
      {/* Overlay */}
      <div className="absolute inset-0 bg-slate-900/18 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer */}
      <div
        className="relative flex flex-col border-l border-[var(--app-border-soft)] bg-[rgba(255,255,255,0.98)] shadow-[-20px_0_60px_rgba(28,44,73,0.16)] backdrop-blur-xl animate-in slide-in-from-right duration-300"
        style={{ width }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--app-border-soft)] px-5 py-4">
          <h2 className="text-sm font-semibold text-[var(--app-text)]">{title}</h2>
          <button
            className="rounded-lg p-1 text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-raised)] hover:text-[var(--app-text)]"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Event Icon ───────────────────────────────────────────────

function EventIcon({ type }: { type: CEOEvent['type'] }) {
  switch (type) {
    case 'critical': return <AlertTriangle className="h-4 w-4 text-red-700" />;
    case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-700" />;
    case 'info': return <Bell className="h-4 w-4 text-sky-700" />;
    case 'done': return <CheckCircle2 className="h-4 w-4 text-emerald-700" />;
  }
}

// ═══════════════════════════════════════════════════════════════
// NotificationIndicators — The 🔔⚡▶ indicators in header
// ═══════════════════════════════════════════════════════════════

interface NotificationIndicatorsProps {
  events: CEOEvent[];
  activeRuns: AgentRun[];
  projects: Project[];
  pendingApprovals: number;
  onEventAction?: (event: CEOEvent, action: NonNullable<CEOEvent['actions']>[number]) => void;
  onIntervene?: (runId: string, action: 'nudge' | 'retry' | 'restart_role' | 'cancel' | 'evaluate') => Promise<void>;
  onNavigateToProject?: (projectId: string) => void;
}

type DrawerType = 'approvals' | 'events' | 'runs' | null;

export default function NotificationIndicators({
  events,
  activeRuns,
  projects,
  pendingApprovals,
  onEventAction,
  onIntervene,
  onNavigateToProject,
}: NotificationIndicatorsProps) {
  const [openDrawer, setOpenDrawer] = useState<DrawerType>(null);
  const [dismissedEventIds, setDismissedEventIds] = useState<Set<string>>(new Set());
  const [interventionLoading, setInterventionLoading] = useState<string | null>(null);
  const [snapshotNow, setSnapshotNow] = useState(() => Date.now());

  const visibleEvents = useMemo(
    () => events.filter(e => !dismissedEventIds.has(e.id)),
    [events, dismissedEventIds],
  );

  const criticalCount = useMemo(
    () => visibleEvents.filter(e => e.type === 'critical' || e.type === 'warning').length,
    [visibleEvents],
  );

  const handleIntervene = useCallback(async (runId: string, action: 'nudge' | 'retry' | 'restart_role' | 'cancel' | 'evaluate') => {
    setInterventionLoading(runId);
    try {
      await onIntervene?.(runId, action);
    } catch { /* silent */ }
    setInterventionLoading(null);
  }, [onIntervene]);

  return (
    <>
      {/* ─── Indicator Buttons ─── */}
      <div className="flex items-center gap-1">
        {/* Approvals */}
        <button
          className={cn(
            'relative rounded-lg p-2 text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-raised)] hover:text-[var(--app-text)]',
            openDrawer === 'approvals' && 'bg-[var(--app-raised)] text-[var(--app-text)]',
          )}
          title="审批请求"
          onClick={() => setOpenDrawer(openDrawer === 'approvals' ? null : 'approvals')}
        >
          <Bell className="h-4 w-4" />
          <Badge count={pendingApprovals} color="bg-red-500 text-white" />
        </button>

        {/* Events */}
        <button
          className={cn(
            'relative rounded-lg p-2 text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-raised)] hover:text-[var(--app-text)]',
            openDrawer === 'events' && 'bg-[var(--app-raised)] text-[var(--app-text)]',
            criticalCount > 0 && 'animate-pulse',
          )}
          title="事件通知"
          onClick={() => setOpenDrawer(openDrawer === 'events' ? null : 'events')}
        >
          <Zap className="h-4 w-4" />
          <Badge count={visibleEvents.length} color="bg-amber-500 text-black" />
        </button>

        {/* Active Runs */}
        <button
          className={cn(
            'relative rounded-lg p-2 text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-raised)] hover:text-[var(--app-text)]',
            openDrawer === 'runs' && 'bg-[var(--app-raised)] text-[var(--app-text)]',
          )}
          title="运行中任务"
          onClick={() => {
            setSnapshotNow(Date.now());
            setOpenDrawer(openDrawer === 'runs' ? null : 'runs');
          }}
        >
          <Play className="h-4 w-4" />
          <Badge count={activeRuns.length} color="bg-sky-500 text-white" />
        </button>
      </div>

      {/* ─── Approval Drawer ─── */}
      <DrawerShell
        open={openDrawer === 'approvals'}
        onClose={() => setOpenDrawer(null)}
        title={`审批请求 (${pendingApprovals})`}
      >
        <ApprovalPanel />
      </DrawerShell>

      {/* ─── Events Drawer ─── */}
      <DrawerShell
        open={openDrawer === 'events'}
        onClose={() => setOpenDrawer(null)}
        title={`事件 (${visibleEvents.length})`}
      >
        {visibleEvents.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--app-text-muted)]">暂无事件</div>
        ) : (
          <div className="space-y-2">
            {visibleEvents.map(event => (
              <div
                key={event.id}
                className={cn(
                  'rounded-lg border px-4 py-3 text-sm transition-colors',
                  event.type === 'critical' ? 'border-red-500/20 bg-red-500/5'
                    : event.type === 'warning' ? 'border-amber-500/20 bg-amber-500/5'
                    : 'border-[var(--app-border-soft)] bg-[var(--app-raised)]',
                )}
              >
                <div className="flex items-start gap-2">
                  <EventIcon type={event.type} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--app-text)]">{event.title}</div>
                    {event.description && (
                      <div className="mt-1 text-xs text-[var(--app-text-soft)]">{event.description}</div>
                    )}
                    {event.actions && event.actions.length > 0 && (
                      <div className="mt-2 flex gap-2">
                        {event.actions.map(action => (
                          <button
                            key={action.label}
                            className="rounded-md bg-[var(--app-raised-2)] px-2.5 py-1 text-xs font-medium text-[var(--app-text-soft)] transition-colors hover:text-[var(--app-text)]"
                            onClick={() => {
                              if (action.action === 'dismiss') {
                                setDismissedEventIds(prev => new Set(prev).add(event.id));
                              } else {
                                onEventAction?.(event, action);
                              }
                            }}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DrawerShell>

      {/* ─── Active Runs Drawer ─── */}
      <DrawerShell
        open={openDrawer === 'runs'}
        onClose={() => setOpenDrawer(null)}
        title={`Active Runs (${activeRuns.length})`}
        width={480}
      >
        {activeRuns.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--app-text-muted)]">当前没有运行中的任务</div>
        ) : (
          <div className="space-y-3">
            {activeRuns.map(run => {
              const elapsed = run.startedAt
                ? Math.floor((snapshotNow - new Date(run.startedAt).getTime()) / 1000)
                : 0;
              const mins = Math.floor(elapsed / 60);
              const secs = elapsed % 60;
              const wsName = run.workspace.split('/').pop() || run.workspace;
              const proj = run.projectId ? projects.find(p => p.projectId === run.projectId) : null;
              const isIntervening = interventionLoading === run.runId;

              return (
                <div key={run.runId} className="rounded-lg border border-sky-500/15 bg-sky-500/[0.03] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--app-text)]">
                        {proj?.name || (run.prompt.length > 50 ? run.prompt.slice(0, 50) + '…' : run.prompt)}
                      </div>
                      <div className="mt-0.5 flex gap-2 text-xs text-[var(--app-text-muted)]">
                        <span>{wsName}</span>
                        <span>·</span>
                        <span>{mins}m{secs}s</span>
                        {run.currentRound && run.maxRounds && (
                          <><span>·</span><span>R{run.currentRound}/{run.maxRounds}</span></>
                        )}
                        {run.model && (
                          <><span>·</span><span>{run.model}</span></>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Intervention buttons */}
                  <div className="mt-2 flex items-center gap-1.5 border-t border-[var(--app-border-soft)] pt-2">
                    <button
                      className="flex-1 rounded-md bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/15 disabled:opacity-30"
                      disabled={isIntervening}
                      onClick={() => handleIntervene(run.runId, 'retry')}
                    >
                      <RotateCcw className="h-3 w-3 inline mr-1" />重试
                    </button>
                    <button
                      className="flex-1 rounded-md bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-500/15 disabled:opacity-30"
                      disabled={isIntervening}
                      onClick={() => handleIntervene(run.runId, 'nudge')}
                    >
                      <SkipForward className="h-3 w-3 inline mr-1" />跳过
                    </button>
                    <button
                      className="flex-1 rounded-md bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-500/15 disabled:opacity-30"
                      disabled={isIntervening}
                      onClick={() => handleIntervene(run.runId, 'cancel')}
                    >
                      <Square className="h-3 w-3 inline mr-1" />取消
                    </button>
                    {proj && (
                      <button
                        className="rounded-md bg-[var(--app-raised-2)] px-3 py-1.5 text-xs font-medium text-[var(--app-text-soft)] transition-colors hover:text-[var(--app-text)]"
                        onClick={() => onNavigateToProject?.(proj.projectId)}
                      >
                        查看
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DrawerShell>
    </>
  );
}
