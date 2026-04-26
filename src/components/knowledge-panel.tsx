'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { renderMarkdown } from '@/lib/render-markdown';
import { formatRelativeTime } from '@/lib/i18n/formatting';
import { api } from '@/lib/api';
import type { GrowthProposalFE, KnowledgeDetail, KnowledgeItem, MemoryCandidateFE } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/locale-provider';
import {
  AlertTriangle,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  FileText,
  FolderOpen,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  RotateCcw,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, InspectorTabs, Pane, StatusChip } from '@/components/ui/app-shell';
import {
  WorkspaceEmptyBlock,
  WorkspaceIconFrame,
  WorkspaceListItem,
  WorkspaceSectionHeader,
  WorkspaceSurface,
} from '@/components/ui/workspace-primitives';

interface KnowledgeWorkspaceProps {
  selectedId: string | null;
  onDeleted?: (deletedId: string) => void;
  onTitleChange?: (title: string | null) => void;
}

type MemoryCandidate = MemoryCandidateFE;
type GrowthProposal = GrowthProposalFE;

function refIcon(type: string) {
  if (type === 'workspace') return <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-400" />;
  if (type === 'conversation_id') return <MessageSquare className="h-3.5 w-3.5 shrink-0 text-indigo-400" />;
  if (type === 'url') return <Link2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  return <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-muted)]" />;
}

function normalizeHeading(value: string) {
  return value.toLowerCase().replace(/[`*_#]/g, '').replace(/\s+/g, ' ').trim();
}

function extractFirstHeading(text: string) {
  const match = text.match(/^\s*#\s+(.+?)\s*$/m);
  return match?.[1]?.trim() || '';
}

function getArtifactLabel(path: string) {
  return path.split('/').pop() || path;
}

const KnowledgeWorkspace = memo(function KnowledgeWorkspace({
  selectedId,
  onDeleted,
  onTitleChange,
}: KnowledgeWorkspaceProps) {
  const { locale, t } = useI18n();
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'preview' | 'edit'>('preview');
  const [artifactDraft, setArtifactDraft] = useState('');
  const [editingMeta, setEditingMeta] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [knowledgeListLoading, setKnowledgeListLoading] = useState(false);
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [memoryCandidatesLoading, setMemoryCandidatesLoading] = useState(false);
  const [memoryCandidatesError, setMemoryCandidatesError] = useState('');
  const [memoryCandidateBusyId, setMemoryCandidateBusyId] = useState<string | null>(null);
  const [growthProposals, setGrowthProposals] = useState<GrowthProposal[]>([]);
  const [growthProposalsLoading, setGrowthProposalsLoading] = useState(false);
  const [growthProposalsError, setGrowthProposalsError] = useState('');
  const [growthProposalBusyId, setGrowthProposalBusyId] = useState<string | null>(null);

  const resetSelectionState = useCallback(() => {
    setDetail(null);
    setDetailLoading(false);
    setActiveArtifact(null);
    setViewMode('preview');
    setArtifactDraft('');
    setEditingMeta(false);
    setTitleDraft('');
    setSummaryDraft('');
    setSaveMsg('');
    setDeleteOpen(false);
    onTitleChange?.(null);
  }, [onTitleChange]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    setActiveArtifact(null);
    setViewMode('preview');
    setEditingMeta(false);
    setSaveMsg('');

    try {
      const data = await api.knowledgeDetail(id);
      const firstArtifact = data.artifactFiles[0] || null;

      setDetail(data);
      setActiveArtifact(firstArtifact);
      setArtifactDraft(firstArtifact ? (data.artifacts[firstArtifact] || '') : '');
      setTitleDraft(data.title);
      setSummaryDraft(data.summary);
      onTitleChange?.(data.title);
    } catch {
      setDetail(null);
      onTitleChange?.(null);
    } finally {
      setDetailLoading(false);
    }
  }, [onTitleChange]);

  const loadKnowledgeItems = useCallback(async () => {
    setKnowledgeListLoading(true);
    try {
      const items = await api.knowledge({ limit: 50 });
      setKnowledgeItems(items);
    } catch {
      setKnowledgeItems([]);
    } finally {
      setKnowledgeListLoading(false);
    }
  }, []);

  const loadMemoryCandidates = useCallback(async () => {
    setMemoryCandidatesLoading(true);
    setMemoryCandidatesError('');
    try {
      const response = await api.companyMemoryCandidates({ pageSize: 24 });
      setMemoryCandidates(response.items || []);
    } catch (err) {
      setMemoryCandidates([]);
      setMemoryCandidatesError(err instanceof Error ? err.message : 'Failed to load memory candidates');
    } finally {
      setMemoryCandidatesLoading(false);
    }
  }, []);

  const loadGrowthProposals = useCallback(async () => {
    setGrowthProposalsLoading(true);
    setGrowthProposalsError('');
    try {
      const response = await api.companyGrowthProposals({ pageSize: 24 });
      setGrowthProposals(response.items || []);
    } catch (err) {
      setGrowthProposals([]);
      setGrowthProposalsError(err instanceof Error ? err.message : 'Failed to load growth proposals');
    } finally {
      setGrowthProposalsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      resetSelectionState();
      void loadKnowledgeItems();
      void loadMemoryCandidates();
      void loadGrowthProposals();
      return;
    }

    void loadDetail(selectedId);
    void loadGrowthProposals();
  }, [selectedId, loadDetail, loadKnowledgeItems, loadMemoryCandidates, loadGrowthProposals, resetSelectionState]);

  useEffect(() => {
    if (!detail || !activeArtifact) {
      setArtifactDraft('');
      return;
    }

    setArtifactDraft(detail.artifacts[activeArtifact] || '');
  }, [detail, activeArtifact]);

  const handleSaveMeta = async () => {
    if (!detail) return;

    setSaving(true);
    try {
      await api.updateKnowledge(detail.id, { title: titleDraft, summary: summaryDraft });
      const next = { ...detail, title: titleDraft, summary: summaryDraft };
      setDetail(next);
      setEditingMeta(false);
      setSaveMsg(t('knowledge.saved'));
      onTitleChange?.(titleDraft);
      window.setTimeout(() => setSaveMsg(''), 1800);
    } catch {
      setSaveMsg(t('knowledge.saveFailed'));
      window.setTimeout(() => setSaveMsg(''), 1800);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveArtifact = async () => {
    if (!detail || !activeArtifact) return;

    setSaving(true);
    try {
      await api.updateKnowledgeArtifact(detail.id, activeArtifact, artifactDraft);
      setDetail({
        ...detail,
        artifacts: {
          ...detail.artifacts,
          [activeArtifact]: artifactDraft,
        },
      });
      setSaveMsg(t('knowledge.saved'));
      window.setTimeout(() => setSaveMsg(''), 1800);
    } catch {
      setSaveMsg(t('knowledge.saveFailed'));
      window.setTimeout(() => setSaveMsg(''), 1800);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!detail) return;

    setDeleting(true);
    try {
      await api.deleteKnowledge(detail.id);
      onDeleted?.(detail.id);
      setDeleteOpen(false);
      resetSelectionState();
    } finally {
      setDeleting(false);
    }
  };

  const handlePromoteMemoryCandidate = async (candidateId: string) => {
    setMemoryCandidateBusyId(candidateId);
    setMemoryCandidatesError('');
    try {
      await api.promoteCompanyMemoryCandidate(candidateId);
      await Promise.all([loadMemoryCandidates(), loadKnowledgeItems()]);
    } catch (err) {
      setMemoryCandidatesError(err instanceof Error ? err.message : 'Failed to promote memory candidate');
    } finally {
      setMemoryCandidateBusyId(null);
    }
  };

  const handleRejectMemoryCandidate = async (candidateId: string) => {
    setMemoryCandidateBusyId(candidateId);
    setMemoryCandidatesError('');
    try {
      await api.rejectCompanyMemoryCandidate(candidateId, 'Rejected from Knowledge review');
      await loadMemoryCandidates();
    } catch (err) {
      setMemoryCandidatesError(err instanceof Error ? err.message : 'Failed to reject memory candidate');
    } finally {
      setMemoryCandidateBusyId(null);
    }
  };

  const handleGenerateGrowthProposals = async () => {
    setGrowthProposalsLoading(true);
    setGrowthProposalsError('');
    try {
      await api.generateCompanyGrowthProposals({ limit: 20 });
      await loadGrowthProposals();
    } catch (err) {
      setGrowthProposalsError(err instanceof Error ? err.message : 'Failed to generate growth proposals');
    } finally {
      setGrowthProposalsLoading(false);
    }
  };

  const handleGenerateGrowthProposalForCandidate = async (candidate: MemoryCandidate) => {
    setMemoryCandidateBusyId(candidate.id);
    setGrowthProposalsError('');
    try {
      await api.generateCompanyGrowthProposals({
        ...(candidate.workspaceUri ? { workspaceUri: candidate.workspaceUri } : {}),
        limit: 20,
      });
      await loadGrowthProposals();
    } catch (err) {
      setGrowthProposalsError(err instanceof Error ? err.message : 'Failed to generate growth proposal');
    } finally {
      setMemoryCandidateBusyId(null);
    }
  };

  const handleEvaluateGrowthProposal = async (proposalId: string) => {
    setGrowthProposalBusyId(proposalId);
    setGrowthProposalsError('');
    try {
      await api.evaluateCompanyGrowthProposal(proposalId);
      await loadGrowthProposals();
    } catch (err) {
      setGrowthProposalsError(err instanceof Error ? err.message : 'Failed to evaluate growth proposal');
    } finally {
      setGrowthProposalBusyId(null);
    }
  };

  const handleApproveGrowthProposal = async (proposalId: string) => {
    setGrowthProposalBusyId(proposalId);
    setGrowthProposalsError('');
    try {
      await api.approveCompanyGrowthProposal(proposalId);
      await loadGrowthProposals();
    } catch (err) {
      setGrowthProposalsError(err instanceof Error ? err.message : 'Failed to approve growth proposal');
    } finally {
      setGrowthProposalBusyId(null);
    }
  };

  const handleDryRunGrowthProposal = async (proposalId: string) => {
    setGrowthProposalBusyId(proposalId);
    setGrowthProposalsError('');
    try {
      await api.dryRunCompanyGrowthProposal(proposalId);
      await loadGrowthProposals();
    } catch (err) {
      setGrowthProposalsError(err instanceof Error ? err.message : 'Failed to dry-run growth proposal');
    } finally {
      setGrowthProposalBusyId(null);
    }
  };

  const handleRejectGrowthProposal = async (proposalId: string) => {
    setGrowthProposalBusyId(proposalId);
    setGrowthProposalsError('');
    try {
      await api.rejectCompanyGrowthProposal(proposalId, 'Rejected from Knowledge growth review');
      await loadGrowthProposals();
    } catch (err) {
      setGrowthProposalsError(err instanceof Error ? err.message : 'Failed to reject growth proposal');
    } finally {
      setGrowthProposalBusyId(null);
    }
  };

  const handlePublishGrowthProposal = async (proposalId: string) => {
    setGrowthProposalBusyId(proposalId);
    setGrowthProposalsError('');
    try {
      await api.publishCompanyGrowthProposal(proposalId);
      await loadGrowthProposals();
    } catch (err) {
      setGrowthProposalsError(err instanceof Error ? err.message : 'Failed to publish growth proposal');
    } finally {
      setGrowthProposalBusyId(null);
    }
  };

  const handleObserveGrowthProposal = async (proposalId: string) => {
    setGrowthProposalBusyId(proposalId);
    setGrowthProposalsError('');
    try {
      await api.observeCompanyGrowthProposal(proposalId);
      await loadGrowthProposals();
    } catch (err) {
      setGrowthProposalsError(err instanceof Error ? err.message : 'Failed to observe growth proposal');
    } finally {
      setGrowthProposalBusyId(null);
    }
  };

  const modifiedLabel = detail ? formatRelativeTime(detail.timestamps.modified, locale) : '';
  const activeArtifactContent = detail && activeArtifact ? (detail.artifacts[activeArtifact] || '') : '';
  const hasUnsavedArtifact = Boolean(activeArtifact && artifactDraft !== activeArtifactContent);
  const duplicateArtifactHeading = detail && activeArtifact
    ? normalizeHeading(extractFirstHeading(artifactDraft || activeArtifactContent)) === normalizeHeading(detail.title)
    : false;
  const linkedKnowledgeProposals = detail
    ? growthProposals.filter((proposal) => proposal.sourceKnowledgeIds.includes(detail.id))
    : [];

  if (!selectedId) {
    const recentItems = [...knowledgeItems]
      .sort((a, b) => a.timestamps.created.localeCompare(b.timestamps.created) > 0 ? -1 : 1)
      .slice(0, 5);
    const highReuse = [...knowledgeItems]
      .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
      .filter((item) => (item.usageCount || 0) > 0)
      .slice(0, 5);
    const staleItems = knowledgeItems
      .filter((item) => item.status === 'stale' || item.status === 'conflicted')
      .slice(0, 5);
    const proposalSignals = knowledgeItems
      .filter((item) => item.status === 'proposal')
      .slice(0, 5);

    return (
      <Pane tone="strong" className="min-h-[620px] p-6 md:p-8">
        <div className="space-y-6">
          <EmptyState
            icon={<BookOpen className="h-6 w-6" />}
            title={t('knowledge.emptyTitle')}
            body={t('knowledge.emptySubtitle')}
            className="min-h-[220px]"
          />
          <div className="grid gap-4 lg:grid-cols-4">
            <KnowledgeListCard
              title="Recent Additions"
              loading={knowledgeListLoading}
              items={recentItems}
              emptyText="暂无新增知识"
            />
            <KnowledgeListCard
              title="High Reuse"
              loading={knowledgeListLoading}
              items={highReuse}
              emptyText="暂无高复用知识"
              showUsage
            />
            <KnowledgeListCard
              title="Stale / Conflict"
              loading={knowledgeListLoading}
              items={staleItems}
              emptyText="暂无陈旧或冲突知识"
              showStatus
            />
            <KnowledgeListCard
              title="Proposal Signals"
              loading={knowledgeListLoading}
              items={proposalSignals}
              emptyText="暂无待演化信号"
              showStatus
            />
          </div>
          <MemoryCandidateReviewBoard
            candidates={memoryCandidates}
            proposals={growthProposals}
            loading={memoryCandidatesLoading}
            error={memoryCandidatesError}
            busyId={memoryCandidateBusyId}
            onRefresh={loadMemoryCandidates}
            onPromote={handlePromoteMemoryCandidate}
            onReject={handleRejectMemoryCandidate}
            onGenerateProposal={handleGenerateGrowthProposalForCandidate}
          />
          <GrowthProposalBoard
            proposals={growthProposals}
            loading={growthProposalsLoading}
            error={growthProposalsError}
            busyId={growthProposalBusyId}
            onRefresh={loadGrowthProposals}
            onGenerate={handleGenerateGrowthProposals}
            onEvaluate={handleEvaluateGrowthProposal}
            onApprove={handleApproveGrowthProposal}
            onDryRun={handleDryRunGrowthProposal}
            onReject={handleRejectGrowthProposal}
            onPublish={handlePublishGrowthProposal}
            onObserve={handleObserveGrowthProposal}
          />
        </div>
      </Pane>
    );
  }

  if (detailLoading || !detail) {
    return (
      <Pane tone="strong" className="min-h-[620px] p-6 md:p-8">
        <EmptyState
          icon={<Loader2 className="h-5 w-5 animate-spin" />}
          title={t('common.loading')}
          body={t('knowledge.detail')}
          className="min-h-[520px]"
        />
      </Pane>
    );
  }

  return (
    <>
      <Pane tone="strong" className="min-h-[680px] overflow-hidden">
        <div className="grid min-h-[680px] lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-[var(--app-border-soft)] lg:border-b-0 lg:border-r">
            <div className="border-b border-[var(--app-border-soft)] px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {editingMeta ? (
                    <div className="mt-3 space-y-3">
                      <input
                        className="w-full rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--app-border-strong)]"
                        value={titleDraft}
                        placeholder={t('knowledge.titlePlaceholder')}
                        onChange={(event) => setTitleDraft(event.target.value)}
                      />
                      <textarea
                        className="min-h-[140px] w-full resize-y rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2 text-sm leading-7 outline-none focus:border-[var(--app-border-strong)]"
                        value={summaryDraft}
                        placeholder={t('knowledge.summaryPlaceholder')}
                        onChange={(event) => setSummaryDraft(event.target.value)}
                      />
                    </div>
                  ) : (
                    <>
                      {!duplicateArtifactHeading ? (
                        <div className="mt-3 text-xl font-semibold leading-tight text-[var(--app-text)]">{detail.title}</div>
                      ) : null}
                      <p
                        className={cn(
                          'max-w-prose text-sm leading-7 text-[var(--app-text-soft)]',
                          duplicateArtifactHeading ? 'mt-0' : 'mt-3',
                        )}
                      >
                        {detail.summary || t('knowledge.noSummary')}
                      </p>
                    </>
                  )}
                </div>

                {!editingMeta ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-full"
                    aria-label={t('common.edit')}
                    onClick={() => setEditingMeta(true)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>

              {editingMeta ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={() => setEditingMeta(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button size="sm" className="h-9 rounded-full" onClick={handleSaveMeta} disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    {t('common.save')}
                  </Button>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <StatusChip>{detail.artifactFiles.length} {t('knowledge.artifacts')}</StatusChip>
                {modifiedLabel ? <StatusChip>{t('knowledge.modified')} {modifiedLabel}</StatusChip> : null}
                <StatusChip>{t('knowledge.created')} {formatRelativeTime(detail.timestamps.created, locale)}</StatusChip>
                <StatusChip>{t('knowledge.accessed')} {formatRelativeTime(detail.timestamps.accessed, locale)}</StatusChip>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="px-2 app-eyebrow">{t('knowledge.artifacts')}</div>
              <div className="mt-3 space-y-2">
                {detail.artifactFiles.map(file => {
                  const isActive = activeArtifact === file;
                  const label = getArtifactLabel(file);
                  const secondary = label === file ? null : file;

                  return (
                    <button
                      key={file}
                      type="button"
                      className={cn(
                        'flex w-full items-start gap-3 rounded-[18px] border px-3 py-3 text-left transition-all',
                        isActive
                          ? 'border-[var(--app-border-strong)] bg-[var(--app-accent-soft)] shadow-[0_16px_36px_rgba(0,0,0,0.18)]'
                          : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-raised-2)]',
                      )}
                      onClick={() => {
                        setActiveArtifact(file);
                        setViewMode('preview');
                      }}
                    >
                      <div
                        className={cn(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border',
                          isActive
                            ? 'border-[var(--app-border-strong)] bg-[rgba(88,243,212,0.12)] text-[var(--app-accent)]'
                            : 'border-[var(--app-border-soft)] bg-[rgba(255,255,255,0.02)] text-[var(--app-text-muted)]',
                        )}
                      >
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className={cn('truncate text-sm leading-6', isActive ? 'font-semibold text-[var(--app-text)]' : 'text-[var(--app-text)]')}>
                          {label}
                        </div>
                        {secondary ? (
                          <div className="truncate font-mono text-[11px] text-[var(--app-text-muted)]">{secondary}</div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 border-t border-[var(--app-border-soft)] px-2 pt-6">
                <div className="app-eyebrow">{t('knowledge.references')}</div>
                {detail.references.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {detail.references.map((reference, index) => (
                      <div
                        key={`${reference.type}-${reference.value}-${index}`}
                        className="flex items-center gap-3 rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2.5"
                      >
                        {refIcon(reference.type)}
                        <span className="truncate font-mono text-[11px] text-[var(--app-text-soft)]">{reference.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">{t('knowledge.noReferences')}</p>
                )}
              </div>

              <div className="mt-6 border-t border-[var(--app-border-soft)] px-2 pt-6">
                <div className="app-eyebrow">Linked Growth</div>
                {linkedKnowledgeProposals.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {linkedKnowledgeProposals.slice(0, 4).map((proposal) => (
                      <div
                        key={proposal.id}
                        className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-[var(--app-text)]">{proposal.title}</span>
                          <StatusChip tone={proposal.risk === 'high' ? 'danger' : proposal.risk === 'medium' ? 'warning' : 'success'}>
                            {proposal.score}
                          </StatusChip>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <StatusChip>{proposal.kind}</StatusChip>
                          <StatusChip>{proposal.status}</StatusChip>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">No linked growth proposals.</p>
                )}
              </div>
            </div>

            <div className="border-t border-[var(--app-border-soft)] p-4">
              <Button
                variant="outline"
                className="w-full rounded-[18px] border-red-400/18 bg-red-400/10 text-red-700 hover:border-red-400/30 hover:bg-red-400/14 hover:text-red-800"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('knowledge.deleteItem')}
              </Button>
            </div>
          </aside>

          <div className="min-h-0 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-border-soft)] px-5 py-4">
              <div className="min-w-0">
                <div className="mt-2 truncate font-mono text-sm text-[var(--app-text)]">
                  {activeArtifact || t('knowledge.selectArtifact')}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {saveMsg ? (
                  <StatusChip tone="success">
                    <Check className="mr-1 h-3.5 w-3.5" />
                    {saveMsg}
                  </StatusChip>
                ) : null}
                {hasUnsavedArtifact ? <StatusChip tone="warning">{t('knowledge.unsaved')}</StatusChip> : null}
                {activeArtifact ? (
                  <InspectorTabs
                    value={viewMode}
                    onValueChange={(value) => setViewMode(value === 'edit' ? 'edit' : 'preview')}
                    tabs={[
                      { value: 'preview', label: t('common.preview') },
                      { value: 'edit', label: t('common.edit') },
                    ]}
                  />
                ) : null}
                {activeArtifact ? (
                  <Button
                    size="sm"
                    className="h-10 rounded-full px-4"
                    onClick={handleSaveArtifact}
                    disabled={saving || !hasUnsavedArtifact}
                  >
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    {t('common.save')}
                  </Button>
                ) : null}
              </div>
            </div>

            {!activeArtifact ? (
              <EmptyState
                icon={<FileText className="h-5 w-5" />}
                title={t('knowledge.selectArtifact')}
                className="min-h-[420px]"
              />
            ) : viewMode === 'edit' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-[var(--app-border-soft)] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--app-text-muted)]">
                  {t('knowledge.markdownSource')}
                </div>
                <textarea
                  className="min-h-0 flex-1 resize-none bg-[var(--app-ink)] px-5 py-4 font-mono text-sm leading-7 text-[var(--app-text)] outline-none"
                  value={artifactDraft}
                  onChange={(event) => setArtifactDraft(event.target.value)}
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-[88ch] px-6 py-8 xl:px-10">
                  <div
                    className="chat-markdown text-[15px] leading-7 text-[var(--app-text-soft)]"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(artifactDraft) }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </Pane>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-100">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              {t('knowledge.deleteTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('knowledge.deleteBody', { title: detail.title })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

export default KnowledgeWorkspace;

function KnowledgeListCard({
  title,
  items,
  loading,
  emptyText,
  showUsage,
  showStatus,
}: {
  title: string;
  items: KnowledgeItem[];
  loading: boolean;
  emptyText: string;
  showUsage?: boolean;
  showStatus?: boolean;
}) {
  return (
    <WorkspaceSurface>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">{title}</div>
      {loading ? (
        <div className="mt-4 text-sm text-[var(--app-text-muted)]">Loading…</div>
      ) : items.length > 0 ? (
        <div className="mt-4 space-y-2">
          {items.map((item) => (
            <WorkspaceListItem
              key={item.id}
              title={item.title}
              description={item.summary}
              actions={(showUsage || showStatus) ? (
                <>
                  {showUsage ? <StatusChip>{item.usageCount || 0} uses</StatusChip> : null}
                  {showStatus && item.status ? <StatusChip>{item.status}</StatusChip> : null}
                </>
              ) : null}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 text-sm text-[var(--app-text-muted)]">{emptyText}</div>
      )}
    </WorkspaceSurface>
  );
}

function isOpenMemoryCandidate(candidate: MemoryCandidate): boolean {
  return candidate.status === 'candidate' || candidate.status === 'pending-review';
}

function memoryCandidateTone(status: MemoryCandidate['status']): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'promoted' || status === 'auto-promoted') return 'success';
  if (status === 'pending-review') return 'warning';
  if (status === 'rejected' || status === 'archived') return 'danger';
  return 'info';
}

function memoryCandidateStatusLabel(status: MemoryCandidate['status']): string {
  if (status === 'pending-review') return 'pending';
  if (status === 'auto-promoted') return 'auto';
  return status;
}

function memoryCandidateConflictTone(candidate: MemoryCandidate): 'neutral' | 'warning' | 'danger' {
  if (candidate.conflicts.some((conflict) => conflict.severity === 'high')) return 'danger';
  if (candidate.conflicts.some((conflict) => conflict.severity === 'medium')) return 'warning';
  return 'neutral';
}

function memoryCandidateScoreTone(score: number): 'neutral' | 'success' | 'warning' {
  if (score >= 75) return 'success';
  if (score >= 50) return 'warning';
  return 'neutral';
}

function formatEvidenceTarget(ref: MemoryCandidate['evidenceRefs'][number]): string {
  return ref.artifactPath || ref.filePath || ref.apiRoute || ref.runId || ref.label;
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MemoryCandidateReviewBoard({
  candidates,
  proposals,
  loading,
  error,
  busyId,
  onRefresh,
  onPromote,
  onReject,
  onGenerateProposal,
}: {
  candidates: MemoryCandidate[];
  proposals: GrowthProposal[];
  loading: boolean;
  error: string;
  busyId: string | null;
  onRefresh: () => Promise<void>;
  onPromote: (candidateId: string) => Promise<void>;
  onReject: (candidateId: string) => Promise<void>;
  onGenerateProposal: (candidate: MemoryCandidate) => Promise<void>;
}) {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const openCount = candidates.filter(isOpenMemoryCandidate).length;
  const visibleCandidates = candidates.slice(0, 8);
  const effectiveSelectedCandidateId = visibleCandidates.some((candidate) => candidate.id === selectedCandidateId)
    ? selectedCandidateId
    : visibleCandidates[0]?.id;
  const selectedCandidate = visibleCandidates.find((candidate) => candidate.id === effectiveSelectedCandidateId) || null;

  return (
    <WorkspaceSurface padding="lg" className="space-y-4">
      <WorkspaceSectionHeader
        eyebrow="Company Memory"
        title="候选记忆"
        icon={<Brain className="h-4 w-4" />}
        actions={(
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-full"
            disabled={loading}
            onClick={() => void onRefresh()}
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={openCount > 0 ? 'warning' : 'success'}>{openCount} open</StatusChip>
        <StatusChip>{candidates.length} loaded</StatusChip>
        {selectedCandidate ? <StatusChip>{selectedCandidate.score.total} score</StatusChip> : null}
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-[18px] border border-red-400/18 bg-red-400/10 px-4 py-3 text-sm text-red-700">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{error}</span>
        </div>
      ) : null}

      {loading && visibleCandidates.length === 0 ? (
        <WorkspaceEmptyBlock
          icon={<Loader2 className="h-5 w-5 animate-spin" />}
          title="Loading candidates"
        />
      ) : visibleCandidates.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
          <div className="space-y-2">
            {visibleCandidates.map((candidate) => {
              const selected = selectedCandidate?.id === candidate.id;

              return (
                <div
                  key={candidate.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'cursor-pointer rounded-[22px] border p-3 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--app-accent)]/35',
                    selected
                      ? 'border-[var(--app-border-strong)] bg-[var(--app-accent-soft)] shadow-[0_18px_44px_rgba(15,23,42,0.10)]'
                      : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-raised-2)]',
                  )}
                  onClick={() => setSelectedCandidateId(candidate.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedCandidateId(candidate.id);
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <WorkspaceIconFrame tone={memoryCandidateTone(candidate.status)} className="mt-0.5">
                      <Brain className="h-4 w-4" />
                    </WorkspaceIconFrame>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-sm font-semibold text-[var(--app-text)]">{candidate.title}</div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--app-text-soft)]">{candidate.content}</div>
                    </div>
                    <StatusChip tone={memoryCandidateScoreTone(candidate.score.total)}>{candidate.score.total}</StatusChip>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <StatusChip tone={memoryCandidateTone(candidate.status)}>{memoryCandidateStatusLabel(candidate.status)}</StatusChip>
                    <StatusChip>{candidate.kind}</StatusChip>
                    <StatusChip>{candidate.evidenceRefs.length} evidence</StatusChip>
                    {candidate.conflicts.length > 0 ? (
                      <StatusChip tone={memoryCandidateConflictTone(candidate)}>{candidate.conflicts.length} conflicts</StatusChip>
                    ) : null}
                    {candidate.volatility !== 'stable' ? <StatusChip tone="warning">{candidate.volatility}</StatusChip> : null}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedCandidate ? (
            <MemoryCandidateDetail
              candidate={selectedCandidate}
              linkedProposals={proposals.filter((proposal) => proposal.sourceCandidateIds.includes(selectedCandidate.id))}
              busy={busyId === selectedCandidate.id}
              onPromote={onPromote}
              onReject={onReject}
              onGenerateProposal={onGenerateProposal}
            />
          ) : null}
        </div>
      ) : (
        <WorkspaceEmptyBlock
          icon={<Brain className="h-5 w-5" />}
          title="No memory candidates"
        />
      )}
    </WorkspaceSurface>
  );
}

function GrowthProposalBoard({
  proposals,
  loading,
  error,
  busyId,
  onRefresh,
  onGenerate,
  onEvaluate,
  onApprove,
  onDryRun,
  onReject,
  onPublish,
  onObserve,
}: {
  proposals: GrowthProposal[];
  loading: boolean;
  error: string;
  busyId: string | null;
  onRefresh: () => Promise<void>;
  onGenerate: () => Promise<void>;
  onEvaluate: (proposalId: string) => Promise<void>;
  onApprove: (proposalId: string) => Promise<void>;
  onDryRun: (proposalId: string) => Promise<void>;
  onReject: (proposalId: string) => Promise<void>;
  onPublish: (proposalId: string) => Promise<void>;
  onObserve: (proposalId: string) => Promise<void>;
}) {
  const visibleProposals = proposals.slice(0, 8);
  const publishableCount = proposals.filter((proposal) => proposal.status === 'evaluated' || proposal.status === 'approved').length;

  return (
    <WorkspaceSurface padding="lg" className="space-y-4">
      <WorkspaceSectionHeader
        eyebrow="Company Growth"
        title="增长提案"
        icon={<Sparkles className="h-4 w-4" />}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-full"
              disabled={loading}
              onClick={() => void onRefresh()}
            >
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
            <Button
              size="sm"
              className="h-9 rounded-full"
              disabled={loading}
              onClick={() => void onGenerate()}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Generate
            </Button>
          </div>
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusChip>{proposals.length} loaded</StatusChip>
        <StatusChip tone={publishableCount > 0 ? 'success' : 'neutral'}>{publishableCount} publishable</StatusChip>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-[18px] border border-red-400/18 bg-red-400/10 px-4 py-3 text-sm text-red-700">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{error}</span>
        </div>
      ) : null}

      {loading && visibleProposals.length === 0 ? (
        <WorkspaceEmptyBlock
          icon={<Loader2 className="h-5 w-5 animate-spin" />}
          title="Loading growth proposals"
        />
      ) : visibleProposals.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {visibleProposals.map((proposal) => {
            const scriptDryRun = proposal.metadata?.scriptDryRun as { status?: string } | undefined;
            const scriptNeedsDryRun = proposal.kind === 'script' && scriptDryRun?.status !== 'passed';
            return (
            <div key={proposal.id} className="rounded-[22px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
              <div className="flex items-start gap-3">
                <WorkspaceIconFrame tone={proposal.risk === 'high' ? 'danger' : proposal.risk === 'medium' ? 'warning' : 'success'}>
                  <Sparkles className="h-4 w-4" />
                </WorkspaceIconFrame>
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-1 text-sm font-semibold text-[var(--app-text)]">{proposal.title}</div>
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--app-text-soft)]">{proposal.summary}</div>
                </div>
                <StatusChip tone={memoryCandidateScoreTone(proposal.score)}>{proposal.score}</StatusChip>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <StatusChip>{proposal.kind}</StatusChip>
                <StatusChip tone={proposal.risk === 'high' ? 'danger' : proposal.risk === 'medium' ? 'warning' : 'success'}>{proposal.risk}</StatusChip>
                <StatusChip>{proposal.status}</StatusChip>
                {proposal.kind === 'script' ? <StatusChip tone={scriptDryRun?.status === 'passed' ? 'success' : 'warning'}>dry-run {scriptDryRun?.status || 'required'}</StatusChip> : null}
                <StatusChip>{proposal.sourceRunIds.length} runs</StatusChip>
                <StatusChip>{proposal.evidenceRefs.length} evidence</StatusChip>
              </div>
              {proposal.evaluation?.reasons.length ? (
                <div className="mt-3 rounded-[16px] border border-[var(--app-border-soft)] bg-white/60 px-3 py-2 text-[11px] leading-5 text-[var(--app-text-soft)]">
                  {proposal.evaluation.reasons.slice(0, 2).join(' ')}
                </div>
              ) : null}
              {proposal.publishedAssetRef ? (
                <div className="mt-3 truncate rounded-[16px] border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-700">
                  {proposal.publishedAssetRef}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-full"
                  disabled={busyId === proposal.id || proposal.status === 'published' || proposal.status === 'rejected' || proposal.status === 'observing'}
                  onClick={() => void onEvaluate(proposal.id)}
                >
                  {busyId === proposal.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Eval
                </Button>
                {proposal.status === 'approval-required' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full"
                    disabled={busyId === proposal.id}
                    onClick={() => void onApprove(proposal.id)}
                  >
                    Approve
                  </Button>
                ) : null}
                {scriptNeedsDryRun ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full"
                    disabled={busyId === proposal.id}
                    onClick={() => void onDryRun(proposal.id)}
                  >
                    Dry-run
                  </Button>
                ) : null}
                {(proposal.status === 'evaluated' || proposal.status === 'approved') ? (
                  <Button
                    size="sm"
                    className="h-8 rounded-full"
                    disabled={busyId === proposal.id || scriptNeedsDryRun}
                    onClick={() => void onPublish(proposal.id)}
                  >
                    Publish
                  </Button>
                ) : null}
                {proposal.status === 'published' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full"
                    disabled={busyId === proposal.id}
                    onClick={() => void onObserve(proposal.id)}
                  >
                    Observe
                  </Button>
                ) : null}
                {proposal.status !== 'published' && proposal.status !== 'observing' && proposal.status !== 'rejected' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-full text-red-600 hover:text-red-700"
                    disabled={busyId === proposal.id}
                    onClick={() => void onReject(proposal.id)}
                  >
                    Reject
                  </Button>
                ) : null}
              </div>
            </div>
          );
          })}
        </div>
      ) : (
        <WorkspaceEmptyBlock
          icon={<Sparkles className="h-5 w-5" />}
          title="No growth proposals"
        />
      )}
    </WorkspaceSurface>
  );
}

function MemoryCandidateDetail({
  candidate,
  linkedProposals,
  busy,
  onPromote,
  onReject,
  onGenerateProposal,
}: {
  candidate: MemoryCandidate;
  linkedProposals: GrowthProposal[];
  busy: boolean;
  onPromote: (candidateId: string) => Promise<void>;
  onReject: (candidateId: string) => Promise<void>;
  onGenerateProposal: (candidate: MemoryCandidate) => Promise<void>;
}) {
  const open = isOpenMemoryCandidate(candidate);
  const canGenerateProposal = candidate.kind === 'workflow-proposal'
    || candidate.kind === 'skill-proposal'
    || candidate.kind === 'pattern';
  const scoreRows: Array<[string, number]> = [
    ['Evidence', candidate.score.evidence],
    ['Reuse', candidate.score.reuse],
    ['Specificity', candidate.score.specificity],
    ['Stability', candidate.score.stability],
    ['Novelty', candidate.score.novelty],
    ['Risk', candidate.score.risk],
  ];

  return (
    <WorkspaceSurface padding="md" tone={open ? 'warning' : 'neutral'} className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="app-eyebrow">Review Detail</div>
          <h3 className="mt-2 text-lg font-semibold leading-tight text-[var(--app-text)]">{candidate.title}</h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusChip tone={memoryCandidateTone(candidate.status)}>{memoryCandidateStatusLabel(candidate.status)}</StatusChip>
          <StatusChip tone={memoryCandidateScoreTone(candidate.score.total)}>{candidate.score.total}</StatusChip>
        </div>
      </div>

      <div className="rounded-[20px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-4 py-3 text-sm leading-7 text-[var(--app-text-soft)]">
        {candidate.content}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {scoreRows.map(([label, value]) => (
          <div key={label} className="rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-[var(--app-text)]">{label}</span>
              <span className="font-mono text-[var(--app-text-soft)]">{value}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--app-border-soft)]">
              <div
                className="h-full rounded-full bg-[var(--app-accent)]"
                style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <MemoryCandidateDetailSection title="Evidence" empty="No evidence">
          {candidate.evidenceRefs.map((ref) => (
            <div key={ref.id} className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2.5">
              <div className="flex items-center gap-2">
                {refIcon(ref.type)}
                <span className="truncate text-xs font-semibold text-[var(--app-text)]">{ref.label}</span>
                <StatusChip>{ref.type}</StatusChip>
              </div>
              <div className="mt-1 truncate font-mono text-[11px] text-[var(--app-text-muted)]">{formatEvidenceTarget(ref)}</div>
              {ref.excerpt ? <div className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--app-text-soft)]">{ref.excerpt}</div> : null}
            </div>
          ))}
        </MemoryCandidateDetailSection>

        <MemoryCandidateDetailSection title="Signals" empty="No signals">
          {candidate.reasons.map((reason, index) => (
            <div key={`${reason}-${index}`} className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2 text-xs leading-5 text-[var(--app-text-soft)]">
              {reason}
            </div>
          ))}
        </MemoryCandidateDetailSection>
      </div>

      {candidate.conflicts.length > 0 ? (
        <MemoryCandidateDetailSection title="Conflicts" empty="No conflicts">
          {candidate.conflicts.map((conflict) => (
            <div key={`${conflict.knowledgeId}-${conflict.reason}`} className="rounded-[16px] border border-red-400/18 bg-red-400/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-[11px] text-red-700">{conflict.knowledgeId}</span>
                <StatusChip tone={conflict.severity === 'high' ? 'danger' : conflict.severity === 'medium' ? 'warning' : 'neutral'}>
                  {conflict.severity}
                </StatusChip>
              </div>
              <div className="mt-1 text-xs leading-5 text-red-700">{conflict.reason}</div>
            </div>
          ))}
        </MemoryCandidateDetailSection>
      ) : null}

      <MemoryCandidateDetailSection title="Growth Proposals" empty="No linked proposals">
        {linkedProposals.map((proposal) => (
          <div key={proposal.id} className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-[var(--app-text)]">{proposal.title}</span>
              <StatusChip tone={proposal.risk === 'high' ? 'danger' : proposal.risk === 'medium' ? 'warning' : 'success'}>
                {proposal.score}
              </StatusChip>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusChip>{proposal.kind}</StatusChip>
              <StatusChip>{proposal.status}</StatusChip>
              <StatusChip>{proposal.sourceRunIds.length} runs</StatusChip>
            </div>
          </div>
        ))}
      </MemoryCandidateDetailSection>

      <div className="grid gap-2 rounded-[18px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-3 text-xs text-[var(--app-text-soft)] md:grid-cols-2">
        <div className="min-w-0">
          <span className="text-[var(--app-text-muted)]">Run </span>
          <span className="font-mono">{candidate.sourceRunId}</span>
        </div>
        <div className="min-w-0">
          <span className="text-[var(--app-text-muted)]">Capsule </span>
          <span className="font-mono">{candidate.sourceCapsuleId}</span>
        </div>
        {candidate.promotedKnowledgeId ? (
          <div className="min-w-0">
            <span className="text-[var(--app-text-muted)]">Knowledge </span>
            <span className="font-mono">{candidate.promotedKnowledgeId}</span>
          </div>
        ) : null}
        {candidate.rejectedReason ? (
          <div className="min-w-0">
            <span className="text-[var(--app-text-muted)]">Rejected </span>
            <span>{candidate.rejectedReason}</span>
          </div>
        ) : null}
        <div>
          <span className="text-[var(--app-text-muted)]">Created </span>
          <span>{formatShortDate(candidate.createdAt)}</span>
        </div>
        <div>
          <span className="text-[var(--app-text-muted)]">Updated </span>
          <span>{formatShortDate(candidate.updatedAt)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-9 rounded-full"
          disabled={!open || busy}
          onClick={() => void onPromote(candidate.id)}
        >
          {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-2 h-3.5 w-3.5" />}
          Promote
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-full"
          disabled={!open || busy}
          onClick={() => void onReject(candidate.id)}
        >
          <XCircle className="mr-2 h-3.5 w-3.5" />
          Reject
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-full"
          disabled={!canGenerateProposal || busy}
          onClick={() => void onGenerateProposal(candidate)}
        >
          {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
          Generate proposal
        </Button>
      </div>
    </WorkspaceSurface>
  );
}

function MemoryCandidateDetailSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: ReactNode;
}) {
  const childArray = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];

  return (
    <div className="space-y-2">
      <div className="app-eyebrow">{title}</div>
      {childArray.length > 0 ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <div className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-3 text-xs text-[var(--app-text-muted)]">
          {empty}
        </div>
      )}
    </div>
  );
}
