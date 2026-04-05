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
  RotateCw,
  History,
  Save,
  Undo2,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Health badge
// ---------------------------------------------------------------------------

const healthConfig: Record<HealthStatus, { label: string; color: string; icon: typeof Activity }> = {
  running: { label: 'Running', color: 'text-sky-400 bg-sky-400/10', icon: Activity },
  waiting: { label: 'Waiting', color: 'text-amber-400 bg-amber-400/10', icon: Clock },
  blocked: { label: 'Blocked', color: 'text-orange-400 bg-orange-400/10', icon: AlertTriangle },
  stale: { label: 'Stale', color: 'text-red-400 bg-red-400/10', icon: AlertTriangle },
  failed: { label: 'Failed', color: 'text-red-500 bg-red-500/10', icon: XCircle },
  completed: { label: 'Completed', color: 'text-emerald-400 bg-emerald-400/10', icon: CheckCircle2 },
};

function HealthBadge({ health }: { health: HealthStatus }) {
  const cfg = healthConfig[health] || healthConfig.waiting;
  const Icon = cfg.icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', cfg.color)}>
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
      <div className="flex items-center justify-center py-12 text-white/40">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!diagnostics) {
    return (
      <div className="py-8 text-center text-sm text-white/40">
        No diagnostics available for this project.
      </div>
    );
  }

  const hasActions = reconcileResult?.actions.some(a => a.kind !== 'noop') ?? false;

  return (
    <div className="space-y-5">
      {/* Health overview */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/80">Project Health</h3>
          <HealthBadge health={diagnostics.health} />
        </div>

        <p className="text-xs text-white/50 leading-relaxed">{diagnostics.summary}</p>

        {diagnostics.activeStageIds.length > 0 && (
          <div className="text-xs text-white/40">
            <span className="text-white/60">Active stages: </span>
            {diagnostics.activeStageIds.join(', ')}
          </div>
        )}

        {diagnostics.recommendedActions.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs text-white/50 font-medium">Recommended:</span>
            {diagnostics.recommendedActions.map((action, i) => (
              <div key={i} className="text-xs text-amber-400/80 pl-3">• {action}</div>
            ))}
          </div>
        )}
      </div>

      {/* Stage diagnostics */}
      {diagnostics.stages.length > 0 && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
          <h3 className="text-sm font-semibold text-white/80">Stage Status</h3>
          <div className="divide-y divide-white/5">
            {diagnostics.stages.map((stage) => (
              <div key={stage.stageId} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-white/70">{stage.stageId}</span>
                  <span className={cn(
                    'text-[10px] uppercase tracking-wider font-semibold',
                    stage.status === 'completed' ? 'text-emerald-400' :
                    stage.status === 'running' ? 'text-sky-400' :
                    stage.status === 'failed' ? 'text-red-400' :
                    'text-white/40',
                  )}>
                    {stage.status}
                  </span>
                </div>
                {stage.pendingReason && (
                  <div className="text-[11px] text-white/40 mt-0.5">{stage.pendingReason}</div>
                )}
                {stage.recommendedActions.length > 0 && (
                  <div className="text-[11px] text-amber-400/70 mt-0.5">
                    {stage.recommendedActions.join('; ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Branch diagnostics */}
      {diagnostics.branches.length > 0 && (
        <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
          <h3 className="text-sm font-semibold text-white/80">Branch Health</h3>
          <div className="divide-y divide-white/5">
            {diagnostics.branches.map((branch) => (
              <div key={`${branch.parentStageId}-${branch.branchIndex}`} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/60">
                    {branch.parentStageId} / branch #{branch.branchIndex}
                  </span>
                  <HealthBadge health={branch.health} />
                </div>
                {branch.failureReason && (
                  <div className="text-[11px] text-red-400/70 mt-0.5">{branch.failureReason}</div>
                )}
                {branch.staleSince && (
                  <div className="text-[11px] text-amber-400/70 mt-0.5">Stale since {branch.staleSince}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reconcile */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/80">Reconcile</h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDryRun}
              disabled={reconciling || !diagnostics.canReconcile}
              className="h-7 text-xs"
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
                className="h-7 text-xs"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Execute
              </Button>
            )}
          </div>
        </div>

        {!diagnostics.canReconcile && (
          <p className="text-xs text-white/40">No reconcilable inconsistencies detected.</p>
        )}

        {reconcileResult && (
          <div className="space-y-1.5">
            <div className="text-xs text-white/50">
              {reconcileResult.dryRun ? 'Dry run result:' : 'Execution result:'}
            </div>
            {reconcileResult.actions.map((action, i) => (
              <ReconcileActionRow key={i} action={action} />
            ))}
          </div>
        )}
      </div>

      {/* Policy Compliance */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
        <h3 className="text-sm font-semibold text-white/80">Policy Compliance</h3>
        {policyLoading ? (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <Loader2 className="h-3 w-3 animate-spin" /> Checking policies...
          </div>
        ) : policyResult ? (
          policyResult.violations.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-emerald-400/80">
              <CheckCircle2 className="h-3.5 w-3.5" /> All policies satisfied
            </div>
          ) : (
            <div className="space-y-1.5">
              {!policyResult.allowed && (
                <div className="flex items-center gap-2 text-xs font-medium text-red-400">
                  <XCircle className="h-3.5 w-3.5" /> Blocked by policy
                </div>
              )}
              {policyResult.violations.map((v, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-[11px] leading-4',
                    v.action === 'block' ? 'border-red-400/20 bg-red-400/[0.06] text-red-300' :
                    v.action === 'pause' ? 'border-amber-400/20 bg-amber-400/[0.06] text-amber-300' :
                    'border-yellow-400/20 bg-yellow-400/[0.06] text-yellow-300',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium uppercase tracking-wide text-[10px]">{v.action}</span>
                    <span className="text-white/30 font-mono">{v.rule.resource}: {v.currentValue}/{v.rule.limit}</span>
                  </div>
                  <div className="mt-0.5">{v.message}</div>
                </div>
              ))}
            </div>
          )
        ) : (
          <p className="text-xs text-white/40">No policies configured.</p>
        )}
      </div>

      {/* Execution Journal (V5.2) */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setShowJournal(!showJournal)}
        >
          <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-violet-400/70" />
            Execution Journal
            {journalEntries.length > 0 && (
              <span className="text-[10px] font-normal text-white/30">({journalEntries.length})</span>
            )}
          </h3>
          {showJournal ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
        </button>

        {showJournal && (
          journalEntries.length > 0 ? (
            <div className="divide-y divide-white/5 max-h-64 overflow-y-auto">
              {journalEntries.map((entry, i) => {
                const typeColor =
                  entry.eventType.startsWith('gate') ? 'text-amber-400' :
                  entry.eventType.startsWith('loop') ? 'text-violet-400' :
                  entry.eventType.startsWith('switch') ? 'text-sky-400' :
                  entry.eventType.startsWith('checkpoint') ? 'text-emerald-400' :
                  'text-white/50';
                return (
                  <div key={i} className="py-1.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <span className={cn('text-[11px] font-mono', typeColor)}>{entry.eventType}</span>
                      <span className="text-[10px] text-white/30">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-white/30">{entry.nodeId}</span>
                      {entry.data && Object.keys(entry.data).length > 0 && (
                        <span className="text-[10px] text-white/25 truncate max-w-[200px]">
                          {Object.entries(entry.data).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-white/40">No journal entries recorded.</p>
          )
        )}
      </div>

      {/* Checkpoints (V5.2) */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setShowCheckpoints(!showCheckpoints)}
        >
          <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
            <Save className="h-3.5 w-3.5 text-emerald-400/70" />
            Checkpoints
            {checkpoints.length > 0 && (
              <span className="text-[10px] font-normal text-white/30">({checkpoints.length})</span>
            )}
          </h3>
          {showCheckpoints ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
        </button>

        {showCheckpoints && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCreateCheckpoint}
                disabled={checkpointLoading}
                className="h-7 text-xs"
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
                  className="h-7 text-xs"
                >
                  {restoring === '__replay__' ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                  Replay (latest)
                </Button>
              )}
            </div>

            {checkpoints.length > 0 ? (
              <div className="divide-y divide-white/5 max-h-48 overflow-y-auto">
                {[...checkpoints].reverse().map((cp) => (
                  <div key={cp.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-white/60 truncate max-w-[180px]" title={cp.id}>
                        {cp.id.slice(0, 8)}…
                      </span>
                      <span className="text-[10px] text-white/30">
                        {new Date(cp.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-white/40">
                        node: {cp.nodeId} · {cp.state.stages.length} stages
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRestoreCheckpoint(cp.id)}
                          disabled={restoring !== null}
                          className="h-6 text-[10px] px-2"
                        >
                          {restoring === cp.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3 mr-0.5" />}
                          Restore
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleReplay(cp.id)}
                          disabled={restoring !== null}
                          className="h-6 text-[10px] px-2"
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
              <p className="text-xs text-white/40">No checkpoints created yet.</p>
            )}
          </div>
        )}
      </div>

      {/* Audit log */}
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-2">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setShowAudit(!showAudit)}
        >
          <h3 className="text-sm font-semibold text-white/80">Recent Audit Events</h3>
          {showAudit ? <ChevronUp className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4 text-white/40" />}
        </button>

        {showAudit && (
          auditEvents.length > 0 ? (
            <div className="divide-y divide-white/5 max-h-60 overflow-y-auto">
              {auditEvents.map((event, i) => (
                <div key={i} className="py-1.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-white/50">{event.kind}</span>
                    <span className="text-[10px] text-white/30">
                      {new Date(event.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-white/40">{event.message}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-white/40">No audit events.</p>
          )
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reconcile action row
// ---------------------------------------------------------------------------

function ReconcileActionRow({ action }: { action: ReconcileAction }) {
  const kindColors: Record<string, string> = {
    'dispatch-stage': 'text-sky-400',
    'fan-out': 'text-purple-400',
    'complete-join': 'text-emerald-400',
    'sync-status': 'text-amber-400',
    'noop': 'text-white/40',
  };

  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={cn('font-mono shrink-0', kindColors[action.kind] || 'text-white/40')}>
        {action.kind}
      </span>
      <span className="text-white/50">{action.detail}</span>
    </div>
  );
}
