'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import { renderMarkdown } from '@/lib/render-markdown';
import { formatRelativeTime } from '@/lib/i18n/formatting';
import { api } from '@/lib/api';
import type { KnowledgeDetail, KnowledgeItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/locale-provider';
import {
  AlertTriangle,
  BookOpen,
  Check,
  FileText,
  FolderOpen,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, InspectorTabs, Pane, StatusChip } from '@/components/ui/app-shell';

interface KnowledgeWorkspaceProps {
  selectedId: string | null;
  onDeleted?: (deletedId: string) => void;
  onTitleChange?: (title: string | null) => void;
}



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

  useEffect(() => {
    if (!selectedId) {
      resetSelectionState();
      void loadKnowledgeItems();
      return;
    }

    void loadDetail(selectedId);
  }, [selectedId, loadDetail, loadKnowledgeItems, resetSelectionState]);

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

  const modifiedLabel = detail ? formatRelativeTime(detail.timestamps.modified, locale) : '';
  const activeArtifactContent = detail && activeArtifact ? (detail.artifacts[activeArtifact] || '') : '';
  const hasUnsavedArtifact = Boolean(activeArtifact && artifactDraft !== activeArtifactContent);
  const duplicateArtifactHeading = detail && activeArtifact
    ? normalizeHeading(extractFirstHeading(artifactDraft || activeArtifactContent)) === normalizeHeading(detail.title)
    : false;

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
            </div>

            <div className="border-t border-[var(--app-border-soft)] p-4">
              <Button
                variant="outline"
                className="w-full rounded-[18px] border-red-400/18 bg-red-400/10 text-red-100 hover:border-red-400/30 hover:bg-red-400/14 hover:text-white"
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
    <div className="rounded-[22px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">{title}</div>
      {loading ? (
        <div className="mt-4 text-sm text-[var(--app-text-muted)]">Loading…</div>
      ) : items.length > 0 ? (
        <div className="mt-4 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-raised-2)] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm font-medium text-[var(--app-text)]">{item.title}</div>
                {showUsage ? <StatusChip>{item.usageCount || 0} uses</StatusChip> : null}
                {showStatus && item.status ? <StatusChip>{item.status}</StatusChip> : null}
              </div>
              <div className="mt-1 line-clamp-2 text-xs leading-6 text-[var(--app-text-soft)]">
                {item.summary}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 text-sm text-[var(--app-text-muted)]">{emptyText}</div>
      )}
    </div>
  );
}
