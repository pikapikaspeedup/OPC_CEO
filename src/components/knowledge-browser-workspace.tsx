'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileText,
  FolderOpen,
  History,
  Layers3,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Star,
  Tag,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState, InspectorTabs, Pane, StatusChip } from '@/components/ui/app-shell';
import { api } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/i18n/formatting';
import { renderMarkdown } from '@/lib/render-markdown';
import type { KnowledgeDetail, KnowledgeItem, Project, Workspace } from '@/lib/types';
import { cn } from '@/lib/utils';

type BrowserFilter =
  | { kind: 'all'; value: 'all' }
  | { kind: 'workspace'; value: string }
  | { kind: 'category'; value: string }
  | { kind: 'status'; value: string }
  | { kind: 'tag'; value: string };

interface KnowledgeBrowseWorkspaceProps {
  locale: Locale;
  selectedId: string | null;
  detail: KnowledgeDetail | null;
  detailLoading: boolean;
  knowledgeItems: KnowledgeItem[];
  knowledgeListLoading: boolean;
  searchQuery: string;
  projects: Project[];
  workspaces: Workspace[];
  activeArtifact: string | null;
  viewMode: 'preview' | 'edit';
  artifactDraft: string;
  editingMeta: boolean;
  titleDraft: string;
  summaryDraft: string;
  saving: boolean;
  saveMsg: string;
  summaryGenerating: boolean;
  hasUnsavedArtifact: boolean;
  duplicateArtifactHeading: boolean;
  onSelectKnowledge: (id: string, title: string, mode?: 'push' | 'replace') => void;
  onArtifactSelect: (artifactPath: string) => void;
  onViewModeChange: (next: 'preview' | 'edit') => void;
  onArtifactDraftChange: (value: string) => void;
  onEditingMetaChange: (value: boolean) => void;
  onTitleDraftChange: (value: string) => void;
  onSummaryDraftChange: (value: string) => void;
  onSaveMeta: () => void;
  onSaveArtifact: () => void;
  onGenerateSummary: () => void;
  onRequestDelete: () => void;
}

function normalizeHeading(value: string) {
  return value.toLowerCase().replace(/[`*_#]/g, '').replace(/\s+/g, ' ').trim();
}

function extractFirstHeading(text: string) {
  const match = text.match(/^\s*#\s+(.+?)\s*$/m);
  return match?.[1]?.trim() || '';
}

function getArtifactLabel(filePath: string) {
  return filePath.split('/').pop() || filePath;
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatTimelineDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildSearchText(item: KnowledgeItem) {
  return [
    item.title,
    item.summary,
    item.category,
    item.workspaceUri,
    item.status,
    item.sourceType,
    ...(item.tags || []),
    ...item.references.map((reference) => `${reference.type}:${reference.value}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function countMemoryEntries(memory: { knowledge?: string; decisions?: string; patterns?: string } | null): number {
  if (!memory) return 0;
  return Object.values(memory).reduce((sum, content) => {
    if (!content) return sum;
    return sum + (content.match(/^### /gm)?.length || 0);
  }, 0);
}

function deriveMemoryHighlights(memory: { knowledge?: string; decisions?: string; patterns?: string } | null) {
  if (!memory) return [] as Array<{ label: string; body: string }>;

  const labels: Array<keyof typeof memory> = ['knowledge', 'decisions', 'patterns'];
  const result: Array<{ label: string; body: string }> = [];

  for (const label of labels) {
    const content = memory[label];
    if (!content) continue;
    const entries = content.split(/\n---\n/).map((entry) => entry.trim()).filter(Boolean);
    for (const entry of entries.slice(0, 2)) {
      const lines = entry.split('\n').map((line) => line.trim()).filter(Boolean);
      const body = lines.filter((line) => !line.startsWith('### ')).join(' ');
      if (body) {
        result.push({ label, body });
      }
    }
  }

  return result.slice(0, 3);
}

function toneForStatus(status?: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'active') return 'success';
  if (status === 'stale') return 'warning';
  if (status === 'conflicted') return 'danger';
  if (status === 'proposal') return 'info';
  return 'neutral';
}

function labelForCategory(category?: string) {
  if (category === 'domain-knowledge') return '领域知识';
  if (category === 'workflow-proposal') return '流程提案';
  if (category === 'skill-proposal') return '技能提案';
  if (category === 'pattern') return '模式';
  if (category === 'decision') return '决策';
  if (category === 'lesson') return '复盘';
  return category || '知识';
}

function labelForStatus(status?: string) {
  if (status === 'active') return '已活跃';
  if (status === 'proposal') return '待复核';
  if (status === 'stale') return '低活跃';
  if (status === 'conflicted') return '冲突';
  return status || '知识';
}

function labelForSourceType(sourceType?: string) {
  if (sourceType === 'manual') return '人工沉淀';
  if (sourceType === 'run') return '运行输出';
  if (sourceType === 'ceo') return 'CEO 指令';
  if (sourceType === 'system') return '系统归档';
  return '来源未标注';
}

function workspaceLabelForUri(workspaceUri: string | undefined, workspaces: Workspace[]) {
  if (!workspaceUri) return '未绑定部门';
  return workspaces.find((workspace) => workspace.uri === workspaceUri)?.name || workspaceUri.split('/').pop() || workspaceUri;
}

function stripLeadingHeading(markdown: string) {
  return markdown.replace(/^\s*#\s+.+?\n+/, '');
}

function extractKeyPoints(summary: string, artifactContent: string, tags: string[]) {
  const bullets = artifactContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);

  if (bullets.length > 0) {
    return bullets.slice(0, 4);
  }

  const sentences = [summary, artifactContent]
    .join('\n')
    .split(/[。！？\n]/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .filter((line) => line.length >= 12);

  if (sentences.length > 0) {
    return sentences.slice(0, 4);
  }

  return tags.slice(0, 4).map((tag) => `${tag} 相关知识需要继续补充内容。`);
}

function buildVersionLabel(index: number, total: number) {
  const minor = Math.max(total - index - 1, 0);
  return `v1.${minor}`;
}

function referencePrimaryText(reference: { type: string; value: string }, workspaces: Workspace[]) {
  if (reference.type === 'workspace') return workspaceLabelForUri(reference.value, workspaces);
  if (reference.type === 'url') {
    try {
      const url = new URL(reference.value);
      return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
    } catch {
      return reference.value;
    }
  }
  return reference.value;
}

function referenceSecondaryText(reference: { type: string; value: string }) {
  if (reference.type === 'workspace') return '工作区上下文';
  if (reference.type === 'run_id') return '运行记录';
  if (reference.type === 'url') return '外部文档';
  if (reference.type === 'source') return '来源标注';
  if (reference.type === 'scope') return '知识作用域';
  return reference.type;
}

function statusDotClass(status: Project['status']) {
  if (status === 'active') return 'bg-emerald-500';
  if (status === 'failed' || status === 'cancelled') return 'bg-rose-500';
  if (status === 'paused') return 'bg-amber-500';
  if (status === 'completed') return 'bg-sky-500';
  return 'bg-slate-400';
}

function initials(label: string) {
  const parts = label.split(/[\s/-]+/).filter(Boolean);
  return (parts[0]?.[0] || label[0] || 'K').toUpperCase();
}

function refIcon(type: string) {
  if (type === 'workspace') return <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-500" />;
  if (type === 'run_id') return <Clock3 className="h-3.5 w-3.5 shrink-0 text-indigo-500" />;
  if (type === 'url') return <Link2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />;
  if (type === 'source') return <Layers3 className="h-3.5 w-3.5 shrink-0 text-violet-500" />;
  if (type === 'scope') return <BookOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />;
  return <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-muted)]" />;
}

function buildTimeline(detail: KnowledgeDetail | null) {
  if (!detail) return [] as Array<{ label: string; timestamp: string; detail: string }>;

  const rows = [
    { label: '初始创建', timestamp: detail.timestamps.created, detail: '知识条目进入知识库' },
    { label: '最近修改', timestamp: detail.timestamps.modified, detail: `${detail.artifactFiles.length} 个产物文件` },
    { label: '最近访问', timestamp: detail.timestamps.accessed, detail: `${detail.usageCount || 0} 次复用` },
  ].filter((item) => item.timestamp);

  const deduped: Array<{ label: string; timestamp: string; detail: string }> = [];
  for (const row of rows) {
    if (deduped.some((existing) => existing.timestamp === row.timestamp && existing.detail === row.detail)) continue;
    deduped.push(row);
  }
  return deduped.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export default function KnowledgeBrowseWorkspace({
  locale,
  selectedId,
  detail,
  detailLoading,
  knowledgeItems,
  knowledgeListLoading,
  searchQuery,
  projects,
  workspaces,
  activeArtifact,
  viewMode,
  artifactDraft,
  editingMeta,
  titleDraft,
  summaryDraft,
  saving,
  saveMsg,
  summaryGenerating,
  hasUnsavedArtifact,
  duplicateArtifactHeading,
  onSelectKnowledge,
  onArtifactSelect,
  onViewModeChange,
  onArtifactDraftChange,
  onEditingMetaChange,
  onTitleDraftChange,
  onSummaryDraftChange,
  onSaveMeta,
  onSaveArtifact,
  onGenerateSummary,
  onRequestDelete,
}: KnowledgeBrowseWorkspaceProps) {
  const [filter, setFilter] = useState<BrowserFilter>({ kind: 'all', value: 'all' });
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [showAllReferences, setShowAllReferences] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const autoSelectedRef = useRef<string | null>(null);

  const workspaceCounts = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const item of knowledgeItems) {
      if (!item.workspaceUri) continue;
      const label = workspaces.find((workspace) => workspace.uri === item.workspaceUri)?.name || item.workspaceUri.split('/').pop() || item.workspaceUri;
      const current = map.get(item.workspaceUri);
      map.set(item.workspaceUri, { label, count: (current?.count || 0) + 1 });
    }
    return [...map.entries()].map(([value, meta]) => ({ value, ...meta })).sort((a, b) => b.count - a.count);
  }, [knowledgeItems, workspaces]);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of knowledgeItems) {
      if (!item.category) continue;
      map.set(item.category, (map.get(item.category) || 0) + 1);
    }
    return [...map.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  }, [knowledgeItems]);

  const statusCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of knowledgeItems) {
      if (!item.status) continue;
      map.set(item.status, (map.get(item.status) || 0) + 1);
    }
    return [...map.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  }, [knowledgeItems]);

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of knowledgeItems) {
      for (const tag of item.tags || []) {
        map.set(tag, (map.get(tag) || 0) + 1);
      }
    }
    return [...map.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [knowledgeItems]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    return knowledgeItems.filter((item) => {
      if (filter.kind === 'workspace' && item.workspaceUri !== filter.value) return false;
      if (filter.kind === 'category' && item.category !== filter.value) return false;
      if (filter.kind === 'status' && item.status !== filter.value) return false;
      if (filter.kind === 'tag' && !(item.tags || []).includes(filter.value)) return false;
      if (normalizedQuery && !buildSearchText(item).includes(normalizedQuery)) return false;
      return true;
    });
  }, [filter, knowledgeItems, normalizedQuery]);

  useEffect(() => {
    if (knowledgeListLoading || filteredItems.length === 0) return;
    if (selectedId && filteredItems.some((item) => item.id === selectedId)) return;

    const fallback = filteredItems[0];
    if (!fallback) return;
    if (autoSelectedRef.current === fallback.id) return;

    autoSelectedRef.current = fallback.id;
    onSelectKnowledge(fallback.id, fallback.title, 'replace');
  }, [filteredItems, knowledgeListLoading, onSelectKnowledge, selectedId]);

  useEffect(() => {
    if (selectedId && autoSelectedRef.current === selectedId) {
      autoSelectedRef.current = null;
    }
  }, [selectedId]);

  const selectedItem = useMemo(() => {
    return knowledgeItems.find((item) => item.id === selectedId) || filteredItems[0] || null;
  }, [filteredItems, knowledgeItems, selectedId]);

  const workspaceLabel = workspaceLabelForUri(selectedItem?.workspaceUri, workspaces);
  const activeArtifactContent = detail && activeArtifact ? (detail.artifacts[activeArtifact] || '') : '';
  const artifactHeadingMatchesTitle = detail && activeArtifact
    ? normalizeHeading(extractFirstHeading(artifactDraft || activeArtifactContent)) === normalizeHeading(detail.title)
    : duplicateArtifactHeading;
  const timeline = buildTimeline(detail);
  const relatedProjects = useMemo(() => {
    if (!detail) return [] as Project[];
    return [...projects]
      .filter((project) => {
        const sameWorkspace = detail.workspaceUri ? project.workspace === detail.workspaceUri : false;
        const sameRun = detail.sourceRunId ? project.runIds.includes(detail.sourceRunId) : false;
        return sameWorkspace || sameRun;
      })
      .sort((a, b) => {
        const aRunMatch = detail.sourceRunId && a.runIds.includes(detail.sourceRunId) ? 1 : 0;
        const bRunMatch = detail.sourceRunId && b.runIds.includes(detail.sourceRunId) ? 1 : 0;
        if (aRunMatch !== bRunMatch) return bRunMatch - aRunMatch;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [detail, projects]);
  const previewArtifactContent = artifactHeadingMatchesTitle ? stripLeadingHeading(artifactDraft) : artifactDraft;
  const keyPoints = useMemo(
    () => extractKeyPoints(detail?.summary || '', previewArtifactContent, detail?.tags || []),
    [detail?.summary, detail?.tags, previewArtifactContent],
  );
  const detailMeta = useMemo(() => {
    if (!detail) return [] as string[];
    return [
      workspaceLabelForUri(detail.workspaceUri, workspaces),
      labelForCategory(detail.category),
      labelForSourceType(detail.sourceType),
      detail.confidence != null ? `置信度 ${Math.round(detail.confidence * 100)}%` : null,
      `更新于 ${formatShortDate(detail.timestamps.modified)}`,
    ].filter(Boolean) as string[];
  }, [detail, workspaces]);
  const normalizedDirectoryQuery = directoryQuery.trim().toLowerCase();
  const visibleCategoryCounts = useMemo(
    () => categoryCounts.filter((category) => !normalizedDirectoryQuery || labelForCategory(category.value).toLowerCase().includes(normalizedDirectoryQuery)),
    [categoryCounts, normalizedDirectoryQuery],
  );
  const visibleWorkspaceCounts = useMemo(
    () => workspaceCounts.filter((workspace) => !normalizedDirectoryQuery || workspace.label.toLowerCase().includes(normalizedDirectoryQuery)),
    [normalizedDirectoryQuery, workspaceCounts],
  );
  const visibleStatusCounts = useMemo(
    () => statusCounts.filter((status) => !normalizedDirectoryQuery || labelForStatus(status.value).toLowerCase().includes(normalizedDirectoryQuery)),
    [normalizedDirectoryQuery, statusCounts],
  );
  const visibleTagCounts = useMemo(
    () => tagCounts.filter((tag) => !normalizedDirectoryQuery || tag.value.toLowerCase().includes(normalizedDirectoryQuery)),
    [normalizedDirectoryQuery, tagCounts],
  );
  const visibleReferences = showAllReferences ? detail?.references || [] : (detail?.references || []).slice(0, 5);
  const visibleProjects = showAllProjects ? relatedProjects : relatedProjects.slice(0, 3);
  const visibleTimeline = showAllVersions ? timeline : timeline.slice(0, 3);

  return (
    <div className="grid gap-4 xl:grid-cols-[240px_340px_minmax(0,1fr)_296px]">
      <Pane tone="strong" className="min-h-[760px] overflow-hidden rounded-[12px] p-0">
        <div className="border-b border-[var(--app-border-soft)] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-base font-semibold text-[#0f172a]">知识目录</div>
            <button
              type="button"
              onClick={() => {
                setFilter({ kind: 'all', value: 'all' });
                setDirectoryQuery('');
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#dfe5ee] bg-white text-[#667085] transition-colors hover:border-[#cfd8e6] hover:bg-[#f8fafc] hover:text-[#0f172a]"
              aria-label="重置目录筛选"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <label className="relative mt-3 flex h-10 items-center rounded-[10px] border border-[#dfe5ee] bg-white pl-9 pr-3 text-sm text-[#475467]">
            <Search className="absolute left-3 h-4 w-4 text-[#98a2b3]" />
            <input
              value={directoryQuery}
              onChange={(event) => setDirectoryQuery(event.target.value)}
              placeholder="搜索目录或标签"
              className="h-full w-full bg-transparent outline-none placeholder:text-[#98a2b3]"
            />
          </label>
        </div>

        <div className="space-y-5 px-3 py-4">
          <div className="space-y-1">
            <DirectorySection
              title="全部知识"
              count={knowledgeItems.length}
              active={filter.kind === 'all'}
              onClick={() => setFilter({ kind: 'all', value: 'all' })}
              icon={<Layers3 className="h-4 w-4" />}
            />
          </div>

          <DirectoryGroup title="分类">
            {visibleCategoryCounts.map((category) => (
              <DirectoryRow
                key={category.value}
                label={labelForCategory(category.value)}
                count={category.count}
                active={filter.kind === 'category' && filter.value === category.value}
                onClick={() => setFilter({ kind: 'category', value: category.value })}
              />
            ))}
          </DirectoryGroup>

          <DirectoryGroup title="工作区">
            {visibleWorkspaceCounts.slice(0, 8).map((workspace) => (
              <DirectoryRow
                key={workspace.value}
                label={workspace.label}
                count={workspace.count}
                active={filter.kind === 'workspace' && filter.value === workspace.value}
                onClick={() => setFilter({ kind: 'workspace', value: workspace.value })}
              />
            ))}
          </DirectoryGroup>

          <DirectoryGroup title="状态">
            {visibleStatusCounts.map((status) => (
              <DirectoryRow
                key={status.value}
                label={labelForStatus(status.value)}
                count={status.count}
                active={filter.kind === 'status' && filter.value === status.value}
                onClick={() => setFilter({ kind: 'status', value: status.value })}
              />
            ))}
          </DirectoryGroup>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-[#0f172a]">标签</div>
              <div className="text-[11px] text-[#98a2b3]">{visibleTagCounts.length}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleTagCounts.length > 0 ? visibleTagCounts.map((tag) => (
                <button
                  key={tag.value}
                  type="button"
                  onClick={() => setFilter({ kind: 'tag', value: tag.value })}
                  className={cn(
                    'inline-flex min-h-8 items-center rounded-[999px] border px-3 text-xs font-medium transition-colors',
                    filter.kind === 'tag' && filter.value === tag.value
                      ? 'border-[#9bbcff] bg-[#eef4ff] text-[#245ee8]'
                      : 'border-[#dfe5ee] bg-[#f8fafc] text-[#475467] hover:border-[#cfd8e6] hover:bg-white',
                  )}
                >
                  {tag.value}
                </button>
              )) : (
                <div className="text-xs text-[var(--app-text-muted)]">暂无标签</div>
              )}
            </div>
          </div>
        </div>
      </Pane>

      <Pane tone="strong" className="min-h-[760px] overflow-hidden rounded-[12px] p-0">
        <div className="flex items-center justify-between border-b border-[var(--app-border-soft)] px-4 py-4">
          <div className="flex items-baseline gap-2">
            <div className="text-base font-semibold text-[#0f172a]">知识列表</div>
            <div className="text-sm font-medium text-[#98a2b3]">({filteredItems.length})</div>
          </div>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#dfe5ee] bg-white px-2.5 text-xs font-medium text-[#475467]"
          >
            最近更新
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        {knowledgeListLoading ? (
          <div className="flex min-h-[680px] items-center justify-center text-sm text-[var(--app-text-muted)]">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在加载知识列表
          </div>
        ) : filteredItems.length > 0 ? (
          <div className="mt-1 max-h-[700px] space-y-1 overflow-y-auto px-2 py-2">
            {filteredItems.map((item) => {
              const selected = item.id === selectedItem?.id;
              const itemWorkspaceLabel = workspaceLabelForUri(item.workspaceUri, workspaces);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectKnowledge(item.id, item.title)}
                  className={cn(
                    'w-full rounded-[10px] border px-3 py-3 text-left transition-all',
                    selected
                      ? 'border-[#9bbcff] bg-[#eef4ff] shadow-[0_10px_24px_rgba(47,109,246,0.08)]'
                      : 'border-transparent bg-white hover:border-[#dfe5ee] hover:bg-[#f8fbff]',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border',
                      selected ? 'border-[#9bbcff] bg-white text-[#245ee8]' : 'border-[#dfe5ee] bg-[#f8fafc] text-[#667085]',
                    )}>
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="line-clamp-2 text-sm font-semibold leading-5 text-[#0f172a]">{item.title}</div>
                        <div className="shrink-0 text-[11px] text-[#98a2b3]">{formatShortDate(item.lastAccessedAt || item.timestamps.modified)}</div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#98a2b3]">
                        <span>{labelForCategory(item.category)}</span>
                        <span className="text-[#c1c8d5]">•</span>
                        <span>{itemWorkspaceLabel}</span>
                        <span className="text-[#c1c8d5]">•</span>
                        <span>{labelForStatus(item.status)}</span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-xs leading-5 text-[#667085]">{item.summary || '暂无摘要'}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.tags?.slice(0, 2).map((tag) => <StatusChip key={tag}>#{tag}</StatusChip>)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<BookOpen className="h-5 w-5" />}
            title="没有匹配的知识"
            body="调整搜索词、目录筛选或新建一条知识。"
            className="min-h-[680px]"
          />
        )}
      </Pane>

      <Pane tone="strong" className="min-h-[760px] overflow-hidden rounded-[12px]">
        {detailLoading ? (
          <EmptyState
            icon={<Loader2 className="h-5 w-5 animate-spin" />}
            title="正在加载知识详情"
            body="准备正文、产物和上下文信息。"
            className="min-h-[760px]"
          />
        ) : detail ? (
          <div className="flex min-h-[760px] flex-col">
            <div className="border-b border-[var(--app-border-soft)] px-5 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {editingMeta ? (
                    <div className="space-y-3">
                      <input
                        value={titleDraft}
                        onChange={(event) => onTitleDraftChange(event.target.value)}
                        className="w-full rounded-[14px] border border-[#dfe5ee] bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-[#9bbcff] focus:ring-4 focus:ring-[#2f6df6]/10"
                        placeholder="知识项标题"
                      />
                      <textarea
                        value={summaryDraft}
                        onChange={(event) => onSummaryDraftChange(event.target.value)}
                        className="min-h-[120px] w-full rounded-[14px] border border-[#dfe5ee] bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-[#9bbcff] focus:ring-4 focus:ring-[#2f6df6]/10"
                        placeholder="补一段摘要，说明这条知识的用途和边界。"
                      />
                    </div>
                  ) : (
                    <>
                      {!artifactHeadingMatchesTitle ? (
                        <h2 className="text-[22px] font-semibold leading-tight text-[#0f172a]">{detail.title}</h2>
                      ) : null}
                      <div className={cn('mt-3 flex flex-wrap gap-2', artifactHeadingMatchesTitle ? 'mt-0' : '')}>
                        {detailMeta.map((meta) => <MetaPill key={meta}>{meta}</MetaPill>)}
                        <MetaPill>{buildVersionLabel(0, Math.max(timeline.length, 1))}</MetaPill>
                      </div>
                      <p className={cn('max-w-[72ch] text-sm leading-7 text-[#667085]', artifactHeadingMatchesTitle ? 'mt-4' : 'mt-4')}>
                        {detail.summary || '这条知识还没有摘要。'}
                      </p>
                    </>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <StatusChip tone={toneForStatus(detail.status)}>{labelForStatus(detail.status)}</StatusChip>
                    <StatusChip>{labelForCategory(detail.category)}</StatusChip>
                    {detail.scope ? <StatusChip>{detail.scope === 'organization' ? '组织级' : '部门级'}</StatusChip> : null}
                    <StatusChip>{detail.artifactFiles.length} 产物</StatusChip>
                    {detail.tags?.map((tag) => <StatusChip key={tag}>#{tag}</StatusChip>)}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#dfe5ee] bg-white text-[#667085] transition-colors hover:border-[#cfd8e6] hover:bg-[#f8fafc] hover:text-[#0f172a]"
                    aria-label="收藏知识"
                  >
                    <Star className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#dfe5ee] bg-white text-[#667085] transition-colors hover:border-[#cfd8e6] hover:bg-[#f8fafc] hover:text-[#0f172a]"
                    aria-label="更多操作"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {!editingMeta ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-[8px]"
                      onClick={onGenerateSummary}
                      disabled={summaryGenerating || saving}
                    >
                      {summaryGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      AI 摘要
                    </Button>
                  ) : null}
                  {!editingMeta ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-[8px]"
                      onClick={() => onEditingMetaChange(true)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      编辑
                      <ChevronDown className="ml-1 h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-[8px] border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50"
                    onClick={onRequestDelete}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除
                  </Button>
                </div>
              </div>

              {editingMeta ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="h-9 rounded-full" onClick={() => onEditingMetaChange(false)}>
                    取消
                  </Button>
                  <Button size="sm" className="h-9 rounded-full" onClick={onSaveMeta} disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    保存元数据
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="border-b border-[var(--app-border-soft)] px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {detail.artifactFiles.map((file) => {
                    const active = activeArtifact === file;
                    return (
                      <button
                        key={file}
                        type="button"
                        onClick={() => onArtifactSelect(file)}
                        className={cn(
                          'inline-flex min-h-9 items-center rounded-[8px] border px-3 text-sm transition-colors',
                          active
                            ? 'border-[#9bbcff] bg-[#eef4ff] text-[#245ee8]'
                            : 'border-[#dfe5ee] bg-white text-[#475467] hover:border-[#cfd8e6] hover:bg-[#f8fbff]',
                        )}
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        {getArtifactLabel(file)}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {saveMsg ? <StatusChip tone="success">{saveMsg}</StatusChip> : null}
                  {hasUnsavedArtifact ? <StatusChip tone="warning">未保存更改</StatusChip> : null}
                  {activeArtifact ? (
                    <InspectorTabs
                      value={viewMode}
                      onValueChange={(value) => onViewModeChange(value === 'edit' ? 'edit' : 'preview')}
                      tabs={[
                        { value: 'preview', label: '预览' },
                        { value: 'edit', label: '编辑' },
                      ]}
                    />
                  ) : null}
                  {activeArtifact ? (
                    <Button size="sm" className="h-9 rounded-[8px] px-4" onClick={onSaveArtifact} disabled={saving || !hasUnsavedArtifact}>
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      保存正文
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            {!activeArtifact ? (
              <EmptyState
                icon={<FileText className="h-5 w-5" />}
                title="选择一个产物文件"
                body="在上方切换正文、摘要或附属产物。"
                className="min-h-[520px]"
              />
            ) : viewMode === 'edit' ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-[var(--app-border-soft)] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#98a2b3]">
                  Markdown Source
                </div>
                <textarea
                  value={artifactDraft}
                  onChange={(event) => onArtifactDraftChange(event.target.value)}
                  spellCheck={false}
                  className="min-h-0 flex-1 resize-none bg-[#fbfcfe] px-5 py-4 font-mono text-sm leading-7 text-[#0f172a] outline-none"
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-[86ch] px-6 py-7">
                  <KnowledgeArticleSection title="结构化摘要" icon={<Sparkles className="h-4 w-4" />}>
                    <p className="text-sm leading-7 text-[#475467]">{detail.summary || '这条知识还没有结构化摘要。'}</p>
                  </KnowledgeArticleSection>

                  {keyPoints.length ? (
                    <KnowledgeArticleSection title="核心要点" icon={<CheckCircle2 className="h-4 w-4" />} className="mt-6">
                      <ul className="space-y-2 text-sm leading-7 text-[#475467]">
                        {keyPoints.map((point) => (
                          <li key={point} className="flex gap-3">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2f6df6]" />
                            <span>{point}</span>
                          </li>
                        ))}
                      </ul>
                    </KnowledgeArticleSection>
                  ) : null}

                  <div className="mt-7 border-t border-[var(--app-border-soft)] pt-6">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#0f172a]">
                      <BookOpen className="h-4 w-4 text-[#2f6df6]" />
                      正文内容
                    </div>
                    <div
                      className="chat-markdown mt-4 text-[15px] leading-7 text-[#344054]"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(previewArtifactContent) }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<BookOpen className="h-5 w-5" />}
            title="知识详情暂不可用"
            body="选择左侧知识条目后，这里会展示正文和产物。"
            className="min-h-[760px]"
          />
        )}
      </Pane>

      <div className="space-y-4">
        <Pane tone="strong" className="rounded-[12px] p-4">
          <SectionHeader
            title="来源引用"
            action={detail?.references.length && detail.references.length > 5 ? (
              <button type="button" className="text-xs font-medium text-[#2f6df6]" onClick={() => setShowAllReferences((value) => !value)}>
                {showAllReferences ? '收起' : `查看全部 (${detail.references.length})`}
              </button>
            ) : null}
          />
          {detail?.references.length ? (
            <div className="mt-3 divide-y divide-[#eef2f7]">
              {visibleReferences.map((reference, index) => (
                <div key={`${reference.type}-${reference.value}-${index}`} className="flex items-start gap-3 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#dfe5ee] bg-[#f8fafc]">
                    {refIcon(reference.type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[#0f172a]">{referencePrimaryText(reference, workspaces)}</div>
                    <div className="mt-1 text-xs text-[#98a2b3]">{referenceSecondaryText(reference)}</div>
                  </div>
                  <div className="shrink-0 text-[11px] text-[#98a2b3]">{formatShortDate(detail.timestamps.modified)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 text-sm text-[var(--app-text-muted)]">当前知识还没有来源引用。</div>
          )}
        </Pane>

        <Pane tone="strong" className="rounded-[12px] p-4">
          <SectionHeader
            title="关联项目"
            action={relatedProjects.length > 3 ? (
              <button type="button" className="text-xs font-medium text-[#2f6df6]" onClick={() => setShowAllProjects((value) => !value)}>
                {showAllProjects ? '收起' : `查看全部 (${relatedProjects.length})`}
              </button>
            ) : null}
          />
          {relatedProjects.length ? (
            <div className="mt-3 divide-y divide-[#eef2f7]">
              {visibleProjects.map((project) => (
                <div key={project.projectId} className="flex items-start gap-3 py-3">
                  <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', statusDotClass(project.status))} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[#0f172a]">{project.name}</div>
                    <div className="mt-1 text-xs text-[#98a2b3]">
                      {workspaceLabelForUri(project.workspace, workspaces)} · {labelForStatus(project.status)}
                    </div>
                  </div>
                  <div className="shrink-0 text-[11px] text-[#98a2b3]">{formatRelativeTime(project.updatedAt, locale)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 text-sm text-[var(--app-text-muted)]">当前还没有稳定的项目关联。</div>
          )}
        </Pane>

        <DepartmentMemorySummary key={selectedItem?.workspaceUri || 'none'} workspaceUri={selectedItem?.workspaceUri} workspaceLabel={workspaceLabel} />

        <Pane tone="strong" className="rounded-[12px] p-4">
          <SectionHeader
            title="版本历史"
            action={timeline.length > 3 ? (
              <button type="button" className="text-xs font-medium text-[#2f6df6]" onClick={() => setShowAllVersions((value) => !value)}>
                {showAllVersions ? '收起' : `查看全部 (${timeline.length})`}
              </button>
            ) : <History className="h-4 w-4 text-[#98a2b3]" />}
          />
          {timeline.length ? (
            <div className="mt-3 divide-y divide-[#eef2f7]">
              {visibleTimeline.map((item, index) => (
                <div key={`${item.label}-${item.timestamp}`} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#0f172a]">{buildVersionLabel(index, timeline.length)}</div>
                    <div className="mt-1 text-xs text-[#667085]">{item.detail}</div>
                    <div className="mt-1 text-[11px] text-[#98a2b3]">{item.label}</div>
                  </div>
                  <div className="shrink-0 text-[11px] text-[#98a2b3]">{formatTimelineDate(item.timestamp)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 text-sm text-[var(--app-text-muted)]">暂无可展示的时间线。</div>
          )}
        </Pane>
      </div>
    </div>
  );
}

function DirectorySection({
  title,
  count,
  active,
  onClick,
  icon,
}: {
  title: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-[10px] border px-3 py-3 text-left transition-colors',
        active ? 'border-[#9bbcff] bg-[#eef4ff]' : 'border-[#dfe5ee] bg-white hover:border-[#cfd8e6] hover:bg-[#f8fbff]',
      )}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-[#0f172a]">
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-[#dfe5ee] bg-white text-[#2f6df6]">
          {icon}
        </span>
        {title}
      </span>
      <span className="text-sm text-[#98a2b3]">{count}</span>
    </button>
  );
}

function DirectoryGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-[#0f172a]">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DirectoryRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left text-sm transition-colors',
        active ? 'bg-[#eef4ff] text-[#245ee8]' : 'text-[#475467] hover:bg-[#f8fbff] hover:text-[#0f172a]',
      )}
    >
      <span className="flex items-center gap-2 truncate">
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-[#245ee8]' : 'text-[#c1c8d5]')} />
        <span className="truncate">{label}</span>
      </span>
      <span className="ml-3 text-xs text-[#98a2b3]">{count}</span>
    </button>
  );
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-h-7 items-center rounded-[999px] border border-[#dfe5ee] bg-[#f8fafc] px-3 text-[11px] font-medium text-[#667085]">
      {children}
    </span>
  );
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm font-semibold text-[#0f172a]">{title}</div>
      {action || null}
    </div>
  );
}

function KnowledgeArticleSection({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-[10px] border border-[#e6ebf2] bg-[#fbfcfe] px-4 py-4', className)}>
      <div className="flex items-center gap-2 text-sm font-semibold text-[#0f172a]">
        <span className="text-[#2f6df6]">{icon}</span>
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function DepartmentMemorySummary({
  workspaceUri,
  workspaceLabel,
}: {
  workspaceUri?: string;
  workspaceLabel: string;
}) {
  const [loading, setLoading] = useState(false);
  const [memory, setMemory] = useState<{ knowledge?: string; decisions?: string; patterns?: string } | null>(null);
  const [recentAssets, setRecentAssets] = useState<KnowledgeItem[]>([]);

  useEffect(() => {
    if (!workspaceUri) {
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [memoryResponse, assets] = await Promise.all([
          api.getDepartmentMemory(workspaceUri).catch(() => ({ memory: null })),
          api.knowledge({ workspace: workspaceUri, limit: 3, sort: 'recent' }).catch(() => [] as KnowledgeItem[]),
        ]);
        if (cancelled) return;
        setMemory((memoryResponse as { memory?: { knowledge?: string; decisions?: string; patterns?: string } | null }).memory || null);
        setRecentAssets(assets);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [workspaceUri]);

  const visibleMemory = workspaceUri ? memory : null;
  const visibleRecentAssets = workspaceUri ? recentAssets : [];
  const visibleLoading = workspaceUri ? loading : false;
  const highlights = deriveMemoryHighlights(visibleMemory);
  const entryCount = countMemoryEntries(visibleMemory);

  return (
    <Pane tone="strong" className="rounded-[12px] p-4">
      <SectionHeader title="部门记忆" action={<div className="text-xs font-medium text-[#2f6df6]">查看全部 ({entryCount})</div>} />
      <div className="mt-1 text-xs text-[#98a2b3]">{workspaceUri ? workspaceLabel : '当前知识未绑定部门工作区'}</div>

      {visibleLoading ? (
        <div className="mt-4 flex items-center text-sm text-[var(--app-text-muted)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载部门记忆
        </div>
      ) : workspaceUri ? (
        <div className="mt-4 space-y-3">
          {visibleRecentAssets.length ? (
            <div className="divide-y divide-[#eef2f7]">
              {visibleRecentAssets.map((item) => (
                <div key={item.id} className="flex items-start gap-3 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eef4ff] text-xs font-semibold text-[#245ee8]">
                    {initials(workspaceLabel)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[#0f172a]">{workspaceLabel}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-[#667085]">{item.title}</div>
                  </div>
                  <div className="shrink-0 text-[11px] text-[#98a2b3]">上次引用：{formatRelativeTime(item.lastAccessedAt || item.timestamps.modified, 'zh')}</div>
                </div>
              ))}
            </div>
          ) : null}

          {highlights.length ? (
            <div className="divide-y divide-[#eef2f7]">
              {highlights.map((item, index) => (
                <div key={`${item.label}-${index}`} className="py-3">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#98a2b3]">
                    {item.label === 'knowledge' ? <BookOpen className="h-3.5 w-3.5" /> : item.label === 'decisions' ? <Layers3 className="h-3.5 w-3.5" /> : <Tag className="h-3.5 w-3.5" />}
                    <span>{item.label}</span>
                  </div>
                  <div className="mt-2 line-clamp-3 text-xs leading-5 text-[#667085]">{item.body}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--app-text-muted)]">暂无可展示的部门记忆摘要。</div>
          )}
        </div>
      ) : (
        <div className="mt-4 text-sm text-[var(--app-text-muted)]">将知识绑定到工作区后，这里会显示对应部门的沉淀与上下文。</div>
      )}
    </Pane>
  );
}
