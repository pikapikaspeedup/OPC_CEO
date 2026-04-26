'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type {
  ProjectDiagnosticsResponse,
  ReconcileResponse,
  ReconcileAction,
  AuditEvent,
  HealthStatus,
} from '@/lib/api';
import type { PolicyEvalResultFE, JournalEntryFE, CheckpointFE } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Activity,
  ShieldCheck,
  AlertTriangle,
  Clock,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  History,
  Save,
  Undo2,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  WorkspaceEmptyBlock,
  WorkspaceSurface,
  workspaceGhostActionClassName,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';

// ---------------------------------------------------------------------------
// Health badge
// ---------------------------------------------------------------------------

const healthConfig: Record<HealthStatus, { label: string; color: string; icon: typeof Activity }> = {
  running: { label: 'Running', color: 'border-sky-500/20 bg-sky-500/10 text-sky-700', icon: Activity },
  waiting: { label: 'Waiting', color: 'border-amber-500/20 bg-amber-500/10 text-amber-700', icon: Clock },
  blocked: { label: 'Blocked', color: 'border-orange-500/20 bg-orange-500/10 text-orange-700', icon: AlertTriangle },
  stale: { label: 'Stale', color: 'border-red-500/20 bg-red-500/10 text-red-700', icon: AlertTriangle },
  failed: { label: 'Failed', color: 'border-red-500/20 bg-red-500/10 text-red-700', icon: XCircle },
  completed: { label: 'Completed', color: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700', icon: CheckCircle2 },
};

function HealthBadge({ health }: { health: HealthStatus }) {
  const cfg = healthConfig[health] || healthConfig.waiting;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium', cfg.color)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProjectOpsPanelProps {
  projectId: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectOpsPanel({ projectId }: ProjectOpsPanelProps) {
  const [diagnostics, setDiagnostics] = useState<ProjectDiagnosticsResponse | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [reconcileResult, setReconcileResult] = useState<ReconcileResponse | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [policyResult, setPolicyResult] = useState<PolicyEvalResultFE | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [journalEntries, setJournalEntries] = useState<JournalEntryFE[]>([]);
  const [showJournal, setShowJournal] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointFE[]>([]);
  const [showCheckpoints, setShowCheckpoints] = useState(false);
  const [checkpointLoading, setCheckpointLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [diag, events] = await Promise.all([
        api.projectDiagnostics(projectId),
        api.auditEvents({ projectId, limit: 20 }),
      ]);
      setDiagnostics(diag);
      setAuditEvents(events);

      // Fetch journal entries (latest 50)
      api.queryJournal(projectId, { limit: 50 })
        .then(r => setJournalEntries(r.entries))
        .catch(() => {});

      // Fetch checkpoints
      api.listCheckpoints(projectId)
        .then(r => setCheckpoints(r.checkpoints))
        .catch(() => {});

      // Check policy compliance
      setPolicyLoading(true);
      try {
        const usage: Record<string, number> = {
          runs: diag.stages.filter(s => s.status === 'running').length,
          stages: diag.stages.length,
          branches: diag.branches.length,
        };
        const result = await api.checkPolicy({ projectId }, usage);
        setPolicyResult(result);
      } catch {
        // Policy check is optional
      } finally {
        setPolicyLoading(false);
      }
    } catch {
      // Silently handle — diagnostics may not be available yet
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDryRun = async () => {
    setReconciling(true);
    try {
      const result = await api.reconcileProject(projectId, true);
      setReconcileResult(result);
    } catch {
      // handled
    } finally {
      setReconciling(false);
    }
  };

  const handleExecute = async () => {
    setReconciling(true);
    try {
      const result = await api.reconcileProject(projectId, false);
      setReconcileResult(result);
      // Refresh diagnostics after real reconcile
      await fetchData();
    } catch {
      // handled
    } finally {
      setReconciling(false);
    }
  };

  const handleCreateCheckpoint = async () => {
    setCheckpointLoading(true);
    try {
      await api.createCheckpoint(projectId);
      const r = await api.listCheckpoints(projectId);
      setCheckpoints(r.checkpoints);
    } catch {
      // handled
    } finally {
      setCheckpointLoading(false);
    }
  };

  const handleRestoreCheckpoint = async (checkpointId: string) => {
    setRestoring(checkpointId);
    try {
      await api.restoreCheckpoint(projectId, checkpointId);
      await fetchData();
    } catch {
      // handled
    } finally {
      setRestoring(null);
    }
  };

  const handleReplay = async (checkpointId?: string) => {
    setRestoring(checkpointId ?? '__replay__');
    try {
      await api.replayProject(projectId, checkpointId);
      await fetchData();
    } catch {
      // handled
    } finally {
      setRestoring(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--app-text-muted)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!diagnostics) {
    return (
      <WorkspaceEmptyBlock title="No diagnostics available for this project." className="py-8" />
    );
  }

  const hasActions = reconcileResult?.actions.some(a => a.kind !== 'noop') ?? false;

  return (
    <div className="space-y-5">
      {/* Health overview */}
      <WorkspaceSurface padding="sm" className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--app-text)]">Project Health</h3>
          <HealthBadge health={diagnostics.health} />
        </div>

        <p className="text-xs leading-relaxed text-[var(--app-text-soft)]">{diagnostics.summary}</p>

        {diagnostics.activeStageIds.length > 0 && (
          <div className="text-xs text-[var(--app-text-muted)]">
            <span className="text-[var(--app-text-soft)]">Active stages: </span>
            {diagnostics.activeStageIds.join(', ')}
          </div>
        )}

        {diagnostics.recommendedActions.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs font-medium text-[var(--app-text-soft)]">Recommended:</span>
            {diagnostics.recommendedActions.map((action, i) => (
              <div key={i} className="pl-3 text-xs text-amber-700">• {action}</div>
            ))}
          </div>
        )}
      </WorkspaceSurface>

      {/* Stage diagnostics */}
      {diagnostics.stages.length > 0 && (
        <WorkspaceSurface padding="sm" className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--app-text)]">Stage Status</h3>
          <div className="divide-y divide-[var(--app-border-soft)]">
            {diagnostics.stages.map((stage) => (
              <div key={stage.stageId} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--app-text)]">{stage.stageId}</span>
                  <span className={cn(
                    'text-[10px] uppercase tracking-wider font-semibold',
                    stage.status === 'completed' ? 'text-emerald-600' :
                    stage.status === 'running' ? 'text-sky-600' :
                    stage.status === 'failed' ? 'text-red-600' :
                    'text-[var(--app-text-muted)]',
                  )}>
                    {stage.status}
                  </span>
                </div>
                {stage.pendingReason && (
                  <div className="mt-0.5 text-[11px] text-[var(--app-text-muted)]">{stage.pendingReason}</div>
                )}
                {stage.recommendedActions.length > 0 && (
                  <div className="mt-0.5 text-[11px] text-amber-700">
                    {stage.recommendedActions.join('; ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </WorkspaceSurface>
      )}

      {/* Branch diagnostics */}
      {diagnostics.branches.length > 0 && (
        <WorkspaceSurface padding="sm" className="space-y-2">
          <h3 className="text-sm font-semibold text-[var(--app-text)]">Branch Health</h3>
          <div className="divide-y divide-[var(--app-border-soft)]">
            {diagnostics.branches.map((branch) => (
              <div key={`${branch.parentStageId}-${branch.branchIndex}`} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--app-text-soft)]">
                    {branch.parentStageId} / branch #{branch.branchIndex}
                  </span>
                  <HealthBadge health={branch.health} />
                </div>
                {branch.failureReason && (
                  <div className="mt-0.5 text-[11px] text-red-700">{branch.failureReason}</div>
                )}
                {branch.staleSince && (
                  <div className="mt-0.5 text-[11px] text-amber-700">Stale since {branch.staleSince}</div>
                )}
              </div>
            ))}
          </div>
        </WorkspaceSurface>
      )}

      {/* Reconcile */}
      <WorkspaceSurface padding="sm" className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--app-text)]">Reconcile</h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDryRun}
              disabled={reconciling || !diagnostics.canReconcile}
              className={cn('h-7 text-xs', workspaceOutlineActionClassName)}
            >
              {reconciling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <ShieldCheck className="h-3 w-3 mr-1" />}
              Dry Run
            </Button>
            {reconcileResult && hasActions && reconcileResult.dryRun && (
              <Button
              variant="default"
              size="sm"
              onClick={handleExecute}
              disabled={reconciling}
              className="h-7 rounded-full bg-[var(--app-accent)] px-3 text-xs font-semibold text-white hover:brightness-105"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Execute
              </Button>
            )}
          </div>
        </div>

        {!diagnostics.canReconcile && (
          <p className="text-xs text-[var(--app-text-muted)]">No reconcilable inconsistencies detected.</p>
        )}

        {reconcileResult && (
          <div className="space-y-1.5">
            <div className="text-xs text-[var(--app-text-soft)]">
              {reconcileResult.dryRun ? 'Dry run result:' : 'Execution result:'}
            </div>
            {reconcileResult.actions.map((action, i) => (
              <ReconcileActionRow key={i} action={action} />
            ))}
          </div>
        )}
      </WorkspaceSurface>

      {/* Policy Compliance */}
      <WorkspaceSurface padding="sm" className="space-y-2">
        <h3 className="text-sm font-semibold text-[var(--app-text)]">Policy Compliance</h3>
        {policyLoading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--app-text-muted)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Checking policies...
          </div>
        ) : policyResult ? (
          policyResult.violations.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> All policies satisfied
            </div>
          ) : (
            <div className="space-y-1.5">
              {!policyResult.allowed && (
                <div className="flex items-center gap-2 text-xs font-medium text-red-700">
                  <XCircle className="h-3.5 w-3.5" /> Blocked by policy
                </div>
              )}
              {policyResult.violations.map((v, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-[11px] leading-4',
                    v.action === 'block' ? 'border-red-500/20 bg-red-500/[0.06] text-red-700' :
                    v.action === 'pause' ? 'border-amber-500/20 bg-amber-500/[0.06] text-amber-700' :
                    'border-yellow-500/20 bg-yellow-500/[0.06] text-yellow-700',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium uppercase tracking-wide text-[10px]">{v.action}</span>
                    <span className="font-mono text-[var(--app-text-muted)]">{v.rule.resource}: {v.currentValue}/{v.rule.limit}</span>
                  </div>
                  <div className="mt-0.5">{v.message}</div>
                </div>
              ))}
            </div>
          )
        ) : (
          <p className="text-xs text-[var(--app-text-muted)]">No policies configured.</p>
        )}
      </WorkspaceSurface>

      {/* Execution Journal (V5.2) */}
      <WorkspaceSurface padding="sm" className="space-y-2">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setShowJournal(!showJournal)}
        >
          <h3 className="text-sm font-semibold text-[var(--app-text)] flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-sky-600" />
            Execution Journal
            {journalEntries.length > 0 && (
              <span className="text-[10px] font-normal text-[var(--app-text-muted)]">({journalEntries.length})</span>
            )}
          </h3>
          {showJournal ? <ChevronUp className="h-4 w-4 text-[var(--app-text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--app-text-muted)]" />}
        </button>

        {showJournal && (
          journalEntries.length > 0 ? (
            <div className="max-h-64 divide-y divide-[var(--app-border-soft)] overflow-y-auto">
              {journalEntries.map((entry, i) => {
                const typeColor =
                  entry.eventType.startsWith('gate') ? 'text-amber-700' :
                  entry.eventType.startsWith('loop') ? 'text-violet-700' :
                  entry.eventType.startsWith('switch') ? 'text-sky-700' :
                  entry.eventType.startsWith('checkpoint') ? 'text-emerald-700' :
                  'text-[var(--app-text-soft)]';
                return (
                  <div key={i} className="py-1.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <span className={cn('text-[11px] font-mono', typeColor)}>{entry.eventType}</span>
                      <span className="text-[10px] text-[var(--app-text-muted)]">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-[var(--app-text-muted)]">{entry.nodeId}</span>
                      {entry.data && Object.keys(entry.data).length > 0 && (
                        <span className="max-w-[200px] truncate text-[10px] text-[var(--app-text-muted)]">
                          {Object.entries(entry.data).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <WorkspaceEmptyBlock title="No journal entries recorded." className="py-6" />
          )
        )}
      </WorkspaceSurface>

      {/* Checkpoints (V5.2) */}
      <WorkspaceSurface padding="sm" className="space-y-2">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setShowCheckpoints(!showCheckpoints)}
        >
          <h3 className="text-sm font-semibold text-[var(--app-text)] flex items-center gap-2">
            <Save className="h-3.5 w-3.5 text-emerald-700" />
            Checkpoints
            {checkpoints.length > 0 && (
              <span className="text-[10px] font-normal text-[var(--app-text-muted)]">({checkpoints.length})</span>
            )}
          </h3>
          {showCheckpoints ? <ChevronUp className="h-4 w-4 text-[var(--app-text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--app-text-muted)]" />}
        </button>

        {showCheckpoints && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCreateCheckpoint}
                disabled={checkpointLoading}
                className={cn('h-7 text-xs', workspaceOutlineActionClassName)}
              >
                {checkpointLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                Create Checkpoint
              </Button>
              {checkpoints.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleReplay()}
                  disabled={restoring !== null}
                  className={cn('h-7 text-xs', workspaceOutlineActionClassName)}
                >
                  {restoring === '__replay__' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                  Replay (latest)
                </Button>
              )}
            </div>

            {checkpoints.length > 0 ? (
              <div className="max-h-48 divide-y divide-[var(--app-border-soft)] overflow-y-auto">
                {[...checkpoints].reverse().map((cp) => (
                  <div key={cp.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <span className="max-w-[180px] truncate font-mono text-[11px] text-[var(--app-text-soft)]" title={cp.id}>
                        {cp.id.slice(0, 8)}…
                      </span>
                      <span className="text-[10px] text-[var(--app-text-muted)]">
                        {new Date(cp.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-[var(--app-text-muted)]">
                        node: {cp.nodeId} · {cp.state.stages.length} stages
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRestoreCheckpoint(cp.id)}
                          disabled={restoring !== null}
                          className={cn('h-6 px-2 text-[10px]', workspaceGhostActionClassName)}
                        >
                          {restoring === cp.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3 mr-0.5" />}
                          Restore
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleReplay(cp.id)}
                          disabled={restoring !== null}
                          className={cn('h-6 px-2 text-[10px]', workspaceGhostActionClassName)}
                        >
                          <Play className="h-3 w-3 mr-0.5" />
                          Replay
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <WorkspaceEmptyBlock title="No checkpoints created yet." className="py-6" />
            )}
          </div>
        )}
      </WorkspaceSurface>

      {/* Audit log */}
      <WorkspaceSurface padding="sm" className="space-y-2">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setShowAudit(!showAudit)}
        >
          <h3 className="text-sm font-semibold text-[var(--app-text)]">Recent Audit Events</h3>
          {showAudit ? <ChevronUp className="h-4 w-4 text-[var(--app-text-muted)]" /> : <ChevronDown className="h-4 w-4 text-[var(--app-text-muted)]" />}
        </button>

        {showAudit && (
          auditEvents.length > 0 ? (
            <div className="max-h-60 divide-y divide-[var(--app-border-soft)] overflow-y-auto">
              {auditEvents.map((event, i) => (
                <div key={i} className="py-1.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-[var(--app-text-soft)]">{event.kind}</span>
                    <span className="text-[10px] text-[var(--app-text-muted)]">
                      {new Date(event.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--app-text-muted)]">{event.message}</div>
                </div>
              ))}
            </div>
          ) : (
            <WorkspaceEmptyBlock title="No audit events." className="py-6" />
          )
        )}
      </WorkspaceSurface>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reconcile action row
// ---------------------------------------------------------------------------

function ReconcileActionRow({ action }: { action: ReconcileAction }) {
  const kindColors: Record<string, string> = {
    'dispatch-stage': 'text-sky-700',
    'fan-out': 'text-violet-700',
    'complete-join': 'text-emerald-700',
    'sync-status': 'text-amber-700',
    'noop': 'text-[var(--app-text-muted)]',
  };

  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={cn('font-mono shrink-0', kindColors[action.kind] || 'text-[var(--app-text-muted)]')}>
        {action.kind}
      </span>
      <span className="text-[var(--app-text-soft)]">{action.detail}</span>
    </div>
  );
}
