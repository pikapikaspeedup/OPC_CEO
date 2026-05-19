'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookText,
  Code2,
  Layers,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
  Target,
  Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Pane, PaneHeader, StatusChip } from '@/components/ui/app-shell';
import { api } from '@/lib/api';
import type {
  EvolutionProposalFE,
  EvolutionProposalKindFE,
  EvolutionProposalStatusFE,
  Workspace,
} from '@/lib/types';
import { cn } from '@/lib/utils';

interface EvolutionWorkspaceProps {
  workspaces: Workspace[];
  refreshSignal?: number;
}

const KIND_LABELS: Record<EvolutionProposalKindFE | 'all', string> = {
  all: 'All',
  sop: 'SOP',
  workflow: 'Workflow',
  skill: 'Skill',
  script: 'Script',
  rule: 'Rule',
};

const KIND_ICONS: Record<EvolutionProposalKindFE, React.ReactNode> = {
  sop: <BookText className="h-3.5 w-3.5" />,
  workflow: <Workflow className="h-3.5 w-3.5" />,
  skill: <Sparkles className="h-3.5 w-3.5" />,
  script: <Code2 className="h-3.5 w-3.5" />,
  rule: <Target className="h-3.5 w-3.5" />,
};

const STATUS_FILTERS: Array<{ id: EvolutionProposalStatusFE | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'evaluated', label: 'Evaluated' },
  { id: 'pending-approval', label: 'Pending' },
  { id: 'published', label: 'Published' },
  { id: 'rejected', label: 'Rejected' },
];

const STATUS_TONE: Record<EvolutionProposalStatusFE, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  'draft': 'neutral',
  'evaluated': 'info',
  'pending-approval': 'warning',
  'published': 'success',
  'rejected': 'danger',
};

const ALL_KINDS: EvolutionProposalKindFE[] = ['sop', 'workflow', 'skill', 'script', 'rule'];

export default function EvolutionWorkspace({ workspaces, refreshSignal = 0 }: EvolutionWorkspaceProps) {
  const [proposals, setProposals] = useState<EvolutionProposalFE[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<EvolutionProposalKindFE | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<EvolutionProposalStatusFE | 'all'>('all');
  const [workspaceFilter, setWorkspaceFilter] = useState<string>('all');
  const [selectedProposal, setSelectedProposal] = useState<EvolutionProposalFE | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { workspaceUri?: string; kind?: EvolutionProposalKindFE; status?: string } = {};
      if (workspaceFilter !== 'all') params.workspaceUri = workspaceFilter;
      if (kindFilter !== 'all') params.kind = kindFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      const result = await api.evolutionProposals(params);
      setProposals(result.proposals || []);
    } catch (err) {
      setProposals([]);
      setError(err instanceof Error ? err.message : 'Failed to load evolution proposals');
    } finally {
      setLoading(false);
    }
  }, [kindFilter, statusFilter, workspaceFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshSignal]);

  const handleGenerate = useCallback(async () => {
    setBusyId('__generate__');
    setError(null);
    try {
      const payload: { workspaceUri?: string } = {};
      if (workspaceFilter !== 'all') payload.workspaceUri = workspaceFilter;
      await api.generateEvolutionProposals(payload);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate proposals');
    } finally {
      setBusyId(null);
    }
  }, [refresh, workspaceFilter]);

  const handleEvaluate = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await api.evaluateEvolutionProposal(id);
      await refresh();
      const next = proposals.find((p) => p.id === id);
      if (selectedProposal?.id === id && next) setSelectedProposal(next);
    } finally {
      setBusyId(null);
    }
  }, [refresh, proposals, selectedProposal]);

  const handlePublish = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await api.publishEvolutionProposal(id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const handleObserve = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await api.observeEvolutionProposal(id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const counts = useMemo(() => {
    const byKind: Record<string, number> = { all: proposals.length };
    const byStatus: Record<string, number> = { all: proposals.length };
    for (const p of proposals) {
      byKind[p.kind] = (byKind[p.kind] || 0) + 1;
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    }
    return { byKind, byStatus };
  }, [proposals]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      {/* Header */}
      <Pane tone="strong" className="space-y-4 p-5">
        <PaneHeader
          eyebrow="Business Evolution"
          title={(
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[var(--app-accent)]" />
              经验结晶 / 业务进化
            </span>
          )}
          meta={(
            <span className="text-xs text-[var(--app-text-muted)]">
              把跑过的 run / memory / knowledge 沉淀为可复用的 SOP / Workflow / Skill / Script / Rule
            </span>
          )}
          actions={(
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
                {loading
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <RefreshCw className="mr-2 h-4 w-4" />}
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={() => void handleGenerate()}
                disabled={busyId === '__generate__'}
              >
                {busyId === '__generate__'
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Sparkles className="mr-2 h-4 w-4" />}
                Generate Proposals
              </Button>
            </div>
          )}
        />

        {/* Workspace selector */}
        {workspaces.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--app-text-muted)]">Workspace:</span>
            <button
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                workspaceFilter === 'all'
                  ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
                  : 'border-[var(--app-border-soft)] text-[var(--app-text-soft)] hover:border-[var(--app-border-strong)]',
              )}
              onClick={() => setWorkspaceFilter('all')}
            >
              All
            </button>
            {workspaces.map((ws) => (
              <button
                key={ws.uri}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  workspaceFilter === ws.uri
                    ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
                    : 'border-[var(--app-border-soft)] text-[var(--app-text-soft)] hover:border-[var(--app-border-strong)]',
                )}
                onClick={() => setWorkspaceFilter(ws.uri)}
                title={ws.uri}
              >
                {ws.name || ws.uri.replace(/^file:\/\//, '').split('/').pop() || 'workspace'}
              </button>
            ))}
          </div>
        )}

        {/* Kind tabs */}
        <div className="flex flex-wrap gap-2">
          {(['all', ...ALL_KINDS] as const).map((kind) => (
            <button
              key={kind}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors',
                kindFilter === kind
                  ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
                  : 'border-[var(--app-border-soft)] text-[var(--app-text-soft)] hover:border-[var(--app-border-strong)]',
              )}
              onClick={() => setKindFilter(kind)}
            >
              {kind !== 'all' && KIND_ICONS[kind]}
              <span>{KIND_LABELS[kind]}</span>
              <span className="rounded-full bg-[var(--app-raised)] px-1.5 text-[10px] text-[var(--app-text-muted)]">
                {counts.byKind[kind] || 0}
              </span>
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                statusFilter === f.id
                  ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
                  : 'border-[var(--app-border-soft)] text-[var(--app-text-soft)] hover:border-[var(--app-border-strong)]',
              )}
              onClick={() => setStatusFilter(f.id)}
            >
              {f.label}
              <span className="ml-1.5 text-[10px] text-[var(--app-text-muted)]">
                {counts.byStatus[f.id] || 0}
              </span>
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </Pane>

      {/* Main: list + detail */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* List */}
        <Pane tone="strong" className="flex min-h-0 flex-[1.2] flex-col p-0">
          <div className="border-b border-[var(--app-border-soft)] px-4 py-3 text-xs text-[var(--app-text-muted)]">
            {proposals.length} proposals
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {loading && proposals.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-[var(--app-text-soft)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : proposals.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-[var(--app-text-soft)]">
                <Layers className="h-8 w-8 text-[var(--app-text-muted)]" />
                <div>暂无提议。点击 "Generate Proposals" 从已有 run / memory / knowledge 生成。</div>
              </div>
            ) : (
              <div className="space-y-2">
                {proposals.map((p) => (
                  <button
                    key={p.id}
                    className={cn(
                      'flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition-colors',
                      selectedProposal?.id === p.id
                        ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)]'
                        : 'border-[var(--app-border-soft)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-raised)]',
                    )}
                    onClick={() => setSelectedProposal(p)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {KIND_ICONS[p.kind]}
                          <span className="text-[10px] uppercase text-[var(--app-text-muted)]">{p.kind}</span>
                        </div>
                        <div className="mt-1 line-clamp-2 text-sm font-medium text-[var(--app-text)]">{p.title}</div>
                        <div className="mt-1 truncate text-[11px] text-[var(--app-text-muted)]">{p.targetRef}</div>
                      </div>
                      <StatusChip tone={STATUS_TONE[p.status]}>{p.status}</StatusChip>
                    </div>
                    {p.evidence.length > 0 && (
                      <div className="text-[11px] text-[var(--app-text-muted)]">
                        {p.evidence.length} evidence · {p.sourceKnowledgeIds.length} knowledge
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Pane>

        {/* Detail */}
        <Pane tone="strong" className="flex min-h-0 flex-[1.4] flex-col p-0">
          {!selectedProposal ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-[var(--app-text-soft)]">
              <Settings2 className="h-8 w-8 text-[var(--app-text-muted)]" />
              <div>选择左侧 proposal 查看详情</div>
            </div>
          ) : (
            <ProposalDetail
              proposal={selectedProposal}
              busyId={busyId}
              onEvaluate={() => void handleEvaluate(selectedProposal.id)}
              onPublish={() => void handlePublish(selectedProposal.id)}
              onObserve={() => void handleObserve(selectedProposal.id)}
            />
          )}
        </Pane>
      </div>
    </div>
  );
}

interface ProposalDetailProps {
  proposal: EvolutionProposalFE;
  busyId: string | null;
  onEvaluate: () => void;
  onPublish: () => void;
  onObserve: () => void;
}

function ProposalDetail({ proposal, busyId, onEvaluate, onPublish, onObserve }: ProposalDetailProps) {
  const isBusy = busyId === proposal.id;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--app-border-soft)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {KIND_ICONS[proposal.kind]}
              <span className="text-[10px] uppercase text-[var(--app-text-muted)]">{proposal.kind}</span>
              <StatusChip tone={STATUS_TONE[proposal.status]}>{proposal.status}</StatusChip>
            </div>
            <h3 className="mt-2 text-base font-semibold text-[var(--app-text)]">{proposal.title}</h3>
            <div className="mt-1 text-xs text-[var(--app-text-muted)]">{proposal.targetRef}</div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-3 flex flex-wrap gap-2">
          {proposal.status === 'draft' && (
            <Button size="sm" variant="outline" onClick={onEvaluate} disabled={isBusy}>
              {isBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Evaluate
            </Button>
          )}
          {proposal.status === 'evaluated' && (
            <Button size="sm" onClick={onPublish} disabled={isBusy}>
              {isBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Request Publish
            </Button>
          )}
          {proposal.status === 'published' && (
            <Button size="sm" variant="outline" onClick={onObserve} disabled={isBusy}>
              {isBusy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Refresh Rollout
            </Button>
          )}
          {proposal.status === 'pending-approval' && proposal.approvalRequestId && (
            <div className="text-[11px] text-[var(--app-text-muted)]">
              Awaiting approval #{proposal.approvalRequestId.slice(0, 8)}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 text-xs">
        <Section title="Rationale">
          <div className="text-sm text-[var(--app-text-soft)]">{proposal.rationale}</div>
        </Section>

        {proposal.evaluation && (
          <Section title="Evaluation">
            <div className="space-y-1 text-[var(--app-text-soft)]">
              <div>Recommendation: <span className="text-[var(--app-text)]">{proposal.evaluation.recommendation}</span></div>
              <div>Sample size: {proposal.evaluation.sampleSize} · Success: {(proposal.evaluation.successRate * 100).toFixed(0)}%</div>
              <div className="mt-1 text-xs text-[var(--app-text-soft)]">{proposal.evaluation.summary}</div>
            </div>
          </Section>
        )}

        {proposal.rollout && (
          <Section title="Rollout">
            <div className="space-y-1 text-[var(--app-text-soft)]">
              <div>Hits: {proposal.rollout.hitCount} · Last used: {proposal.rollout.lastUsedAt || '—'}</div>
              <div className="mt-1">{proposal.rollout.summary}</div>
            </div>
          </Section>
        )}

        <Section title={`Evidence (${proposal.evidence.length})`}>
          <div className="space-y-2">
            {proposal.evidence.map((e, idx) => (
              <div key={idx} className="rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-2.5">
                <div className="flex items-center gap-1.5">
                  <StatusChip tone="info">{e.source}</StatusChip>
                  <span className="text-[var(--app-text)]">{e.label}</span>
                </div>
                <div className="mt-1 text-[var(--app-text-soft)]">{e.detail}</div>
                {e.runIds && e.runIds.length > 0 && (
                  <div className="mt-1 text-[10px] text-[var(--app-text-muted)]">
                    {e.runIds.length} runs
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>

        {proposal.content && (
          <Section title="Content">
            <pre className="overflow-auto rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-2.5 text-[11px] leading-5 text-[var(--app-text-soft)] whitespace-pre-wrap">
              {proposal.content}
            </pre>
          </Section>
        )}

        {proposal.governanceNote && (
          <Section title="Governance Note">
            <div className="text-[var(--app-text-soft)]">{proposal.governanceNote}</div>
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--app-text-muted)]">{title}</div>
      {children}
    </div>
  );
}
