'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import type { GrowthProposalFE, KnowledgeDetail, KnowledgeItem, MemoryCandidateFE, Project, Workspace } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/locale-provider';
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  Link2,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ModeTabs, Pane, StatusChip } from '@/components/ui/app-shell';
import {
  WorkspaceEmptyBlock,
  WorkspaceIconFrame,
  WorkspaceSectionHeader,
  WorkspaceSurface,
} from '@/components/ui/workspace-primitives';
import DepartmentMemoryPanel from '@/components/department-memory-panel';
import KnowledgeBrowseWorkspace from '@/components/knowledge-browser-workspace';

interface KnowledgeWorkspaceProps {
  selectedId: string | null;
  searchQuery: string;
  projects: Project[];
  workspaces: Workspace[];
  refreshSignal?: number;
  onSelectKnowledge: (id: string, title: string, mode?: 'push' | 'replace') => void;
  onDeleted?: (deletedId: string) => void;
  onTitleChange?: (title: string | null) => void;
}

type MemoryCandidate = MemoryCandidateFE;
type GrowthProposal = GrowthProposalFE;

function refIcon(type: string) {
  if (type === 'workspace') return <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-400" />;
  if (type === 'run_id') return <Clock3 className="h-3.5 w-3.5 shrink-0 text-indigo-400" />;
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

const KnowledgeWorkspace = memo(function KnowledgeWorkspace({
  selectedId,
  searchQuery,
  projects,
  workspaces,
  refreshSignal = 0,
  onSelectKnowledge,
  onDeleted,
  onTitleChange,
}: KnowledgeWorkspaceProps) {
  const { locale, t } = useI18n();
  const [surfaceMode, setSurfaceMode] = useState<'browse' | 'governance'>('browse');
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
  const [summaryGenerating, setSummaryGenerating] = useState(false);
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
      const items = await api.knowledge({ limit: 120, sort: 'recent' });
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
    void loadKnowledgeItems();
  }, [loadKnowledgeItems, refreshSignal]);

  useEffect(() => {
    void loadMemoryCandidates();
    void loadGrowthProposals();
  }, [loadGrowthProposals, loadMemoryCandidates, refreshSignal]);

  useEffect(() => {
    if (!selectedId) {
      resetSelectionState();
      return;
    }

    void loadDetail(selectedId);
  }, [selectedId, loadDetail, resetSelectionState]);

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
      setKnowledgeItems((current) => current.map((item) => item.id === detail.id ? { ...item, title: titleDraft, summary: summaryDraft } : item));
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
      await loadKnowledgeItems();
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

  const handleGenerateSummary = async () => {
    if (!detail) return;

    setSummaryGenerating(true);
    setSaveMsg('');
    try {
      const result = await api.generateKnowledgeSummary(detail.id);
      const next = { ...detail, summary: result.summary };
      setDetail(next);
      setSummaryDraft(result.summary);
      setKnowledgeItems((current) => current.map((item) => (
        item.id === detail.id ? { ...item, summary: result.summary } : item
      )));
      setSaveMsg(`AI 摘要已更新 · ${result.provider}${result.model ? ` / ${result.model}` : ''}`);
      window.setTimeout(() => setSaveMsg(''), 2200);
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'AI 摘要生成失败');
      window.setTimeout(() => setSaveMsg(''), 2200);
    } finally {
      setSummaryGenerating(false);
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

  const activeArtifactContent = detail && activeArtifact ? (detail.artifacts[activeArtifact] || '') : '';
  const hasUnsavedArtifact = Boolean(activeArtifact && artifactDraft !== activeArtifactContent);
  const duplicateArtifactHeading = detail && activeArtifact
    ? normalizeHeading(extractFirstHeading(artifactDraft || activeArtifactContent)) === normalizeHeading(detail.title)
    : false;
  const recentWindowCount = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return knowledgeItems.filter((item) => new Date(item.timestamps.created || 0).getTime() >= cutoff).length;
  }, [knowledgeItems]);

  const activeAssetCount = useMemo(
    () => knowledgeItems.filter((item) => item.status === 'active').length,
    [knowledgeItems],
  );

  const totalReuseCount = useMemo(
    () => knowledgeItems.reduce((sum, item) => sum + (item.usageCount || 0), 0),
    [knowledgeItems],
  );

  const inactiveAssetCount = useMemo(() => {
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    return knowledgeItems.filter((item) => {
      const lastTouched = new Date(item.lastAccessedAt || item.timestamps.accessed || item.timestamps.modified || item.timestamps.created || 0).getTime();
      if (!Number.isFinite(lastTouched) || Number.isNaN(lastTouched)) {
        return item.status === 'stale' || item.status === 'conflicted';
      }
      return lastTouched < cutoff || item.status === 'stale' || item.status === 'conflicted';
    }).length;
  }, [knowledgeItems]);

  const reviewQueueCount = useMemo(() => {
    const openCandidates = memoryCandidates.filter(isOpenMemoryCandidate).length;
    const pendingGrowth = growthProposals.filter((proposal) => proposal.status === 'approval-required' || proposal.status === 'evaluated').length;
    return openCandidates + pendingGrowth;
  }, [growthProposals, memoryCandidates]);

  return (
    <>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KnowledgeMetricCard
            icon={<Clock3 className="h-4 w-4" />}
            label="最近沉淀"
            value={recentWindowCount}
            detail="近 7 天新增知识"
            note={recentWindowCount > 0 ? `+${recentWindowCount}` : '暂无新增'}
            tone={recentWindowCount > 0 ? 'accent' : 'neutral'}
          />
          <KnowledgeMetricCard
            icon={<Brain className="h-4 w-4" />}
            label="活跃资产"
            value={activeAssetCount}
            detail={`累计复用 ${totalReuseCount} 次`}
            tone={activeAssetCount > 0 ? 'info' : 'neutral'}
          />
          <KnowledgeMetricCard
            icon={<ShieldAlert className="h-4 w-4" />}
            label="待复核"
            value={reviewQueueCount}
            detail="候选记忆与增长提案"
            tone={reviewQueueCount > 0 ? 'warning' : 'success'}
          />
          <KnowledgeMetricCard
            icon={<RotateCcw className="h-4 w-4" />}
            label="低活跃资产"
            value={inactiveAssetCount}
            detail="60 天内未访问或已冲突"
            tone={inactiveAssetCount > 0 ? 'danger' : 'success'}
          />
        </div>

        <ModeTabs
          value={surfaceMode}
          onValueChange={(value) => setSurfaceMode(value === 'governance' ? 'governance' : 'browse')}
          tabs={[
            { value: 'browse', label: '浏览工作台' },
            { value: 'governance', label: '治理工作台' },
          ]}
        />

        {surfaceMode === 'browse' ? (
          <KnowledgeBrowseWorkspace
            locale={locale}
            selectedId={selectedId}
            detail={detail}
            detailLoading={detailLoading}
            knowledgeItems={knowledgeItems}
            knowledgeListLoading={knowledgeListLoading}
            searchQuery={searchQuery}
            projects={projects}
            workspaces={workspaces}
            activeArtifact={activeArtifact}
            viewMode={viewMode}
            artifactDraft={artifactDraft}
            editingMeta={editingMeta}
            titleDraft={titleDraft}
            summaryDraft={summaryDraft}
            saving={saving}
            saveMsg={saveMsg}
            summaryGenerating={summaryGenerating}
            hasUnsavedArtifact={hasUnsavedArtifact}
            duplicateArtifactHeading={duplicateArtifactHeading}
            onSelectKnowledge={onSelectKnowledge}
            onArtifactSelect={(artifactPath) => {
              setActiveArtifact(artifactPath);
              setViewMode('preview');
            }}
            onViewModeChange={setViewMode}
            onArtifactDraftChange={setArtifactDraft}
            onEditingMetaChange={setEditingMeta}
            onTitleDraftChange={setTitleDraft}
            onSummaryDraftChange={setSummaryDraft}
            onSaveMeta={() => { void handleSaveMeta(); }}
            onSaveArtifact={() => { void handleSaveArtifact(); }}
            onGenerateSummary={() => { void handleGenerateSummary(); }}
            onRequestDelete={() => setDeleteOpen(true)}
          />
        ) : (
          <div className="space-y-6">
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
            {workspaces.length > 0 ? (
              <Pane tone="strong" className="p-5">
                <DepartmentMemoryPanel workspaces={workspaces} selectedWorkspace={detail?.workspaceUri || workspaces[0]?.uri} />
              </Pane>
            ) : null}
          </div>
        )}
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-100">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              {t('knowledge.deleteTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('knowledge.deleteBody', { title: detail?.title || t('knowledge.items') })}
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

function KnowledgeMetricCard({
  icon,
  label,
  value,
  detail,
  note,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  detail: string;
  note?: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
}) {
  const iconToneClass: Record<typeof tone, string> = {
    neutral: 'border-[#dfe5ee] bg-[#f8fafc] text-[#667085]',
    success: 'border-emerald-100 bg-emerald-50 text-emerald-600',
    warning: 'border-amber-100 bg-amber-50 text-amber-600',
    danger: 'border-rose-100 bg-rose-50 text-rose-600',
    info: 'border-sky-100 bg-sky-50 text-sky-600',
    accent: 'border-[#cfe0ff] bg-[#eef4ff] text-[#2f6df6]',
  };
  const noteToneClass: Record<typeof tone, string> = {
    neutral: 'text-[#98a2b3]',
    success: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-rose-600',
    info: 'text-sky-600',
    accent: 'text-[#2f6df6]',
  };

  return (
    <div className="rounded-[12px] border border-[#dfe5ee] bg-white px-5 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border', iconToneClass[tone])}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-[#667085]">{label}</div>
          <div className="mt-1 text-[2rem] font-semibold leading-none tracking-[-0.03em] text-[#0f172a]">{value}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-5 text-[#98a2b3]">
            <span>{detail}</span>
            {note ? <span className={cn('font-medium', noteToneClass[tone])}>{note}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
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
