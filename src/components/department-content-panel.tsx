'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BookOpen,
  ChevronDown,
  FileText,
  Folder,
  FolderTree,
  Loader2,
  PackageOpen,
  RefreshCw,
} from 'lucide-react';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/i18n/formatting';
import { Button } from '@/components/ui/button';
import {
  WorkspaceBadge,
  WorkspaceEmptyBlock,
  WorkspaceSectionHeader,
  WorkspaceSurface,
} from '@/components/ui/workspace-primitives';
import type {
  DepartmentContentResponse,
  DepartmentFileTreeNode,
  DepartmentOutputTreeNode,
} from '@/lib/types';

type ContentMode = 'files' | 'outputs';

interface DepartmentContentPanelProps {
  workspaceUri: string | null;
  title: string;
  locale: 'en' | 'zh';
}

function countOutputItems(nodes: DepartmentOutputTreeNode[]): number {
  return nodes.reduce((sum, node) => {
    if (node.type === 'item') return sum + 1;
    return sum + countOutputItems(node.children || []);
  }, 0);
}

function renderMarkdown(content: string) {
  const lines = content.split('\n');
  const blocks: ReactNode[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        blocks.push(
          <pre key={`code-${index}`} className="overflow-x-auto rounded-[10px] bg-[#0f172a] p-3 text-[12px] leading-5 text-slate-100">
            <code>{codeLines.join('\n')}</code>
          </pre>,
        );
        codeLines = [];
      }
      inCode = !inCode;
      return;
    }

    if (inCode) {
      codeLines.push(line);
      return;
    }

    if (!line.trim()) {
      blocks.push(<div key={`spacer-${index}`} className="h-2" />);
      return;
    }

    if (line.startsWith('# ')) {
      blocks.push(<h1 key={index} className="text-xl font-semibold text-[var(--app-text)]">{line.slice(2)}</h1>);
      return;
    }
    if (line.startsWith('## ')) {
      blocks.push(<h2 key={index} className="pt-2 text-lg font-semibold text-[var(--app-text)]">{line.slice(3)}</h2>);
      return;
    }
    if (line.startsWith('### ')) {
      blocks.push(<h3 key={index} className="pt-1 text-sm font-semibold text-[var(--app-text)]">{line.slice(4)}</h3>);
      return;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      blocks.push(
        <div key={index} className="flex gap-2 text-sm leading-6 text-[var(--app-text-soft)]">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--app-text-muted)]" />
          <span>{line.replace(/^\s*[-*]\s+/, '')}</span>
        </div>,
      );
      return;
    }
    if (line.startsWith('>')) {
      blocks.push(
        <blockquote key={index} className="border-l-2 border-[var(--app-border-strong)] pl-3 text-sm leading-6 text-[var(--app-text-soft)]">
          {line.replace(/^>\s?/, '')}
        </blockquote>,
      );
      return;
    }

    blocks.push(<p key={index} className="text-sm leading-6 text-[var(--app-text-soft)]">{line}</p>);
  });

  if (codeLines.length > 0) {
    blocks.push(
      <pre key="code-final" className="overflow-x-auto rounded-[10px] bg-[#0f172a] p-3 text-[12px] leading-5 text-slate-100">
        <code>{codeLines.join('\n')}</code>
      </pre>,
    );
  }

  return blocks;
}

function FileNode({
  node,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  node: DepartmentFileTreeNode;
  selectedPath?: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isDirectory = node.type === 'directory';
  const isSelected = selectedPath === node.path;

  return (
    <div>
      <button
        type="button"
        className={cn(
          'flex min-h-8 w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--app-raised)]',
          isSelected ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]' : 'text-[var(--app-text-soft)]',
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => {
          if (isDirectory) {
            setOpen(value => !value);
            return;
          }
          onSelect(node.path);
        }}
      >
        {isDirectory ? (
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90')} />
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isDirectory ? <Folder className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{node.name}</span>
        {node.rootLabel && depth === 0 ? <span className="ml-auto text-[10px] text-[var(--app-text-muted)]">{node.rootLabel}</span> : null}
      </button>
      {isDirectory && open && node.children?.length ? (
        <div className="mt-0.5">
          {node.children.map(child => (
            <FileNode key={child.id} node={child} selectedPath={selectedPath} onSelect={onSelect} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function OutputNode({
  node,
  selectedPath,
  onSelectPath,
  depth = 0,
}: {
  node: DepartmentOutputTreeNode;
  selectedPath?: string;
  onSelectPath: (path: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const selected = node.output?.markdownPath && selectedPath === node.output.markdownPath;

  if (node.type === 'item' && node.output) {
    return (
      <button
        type="button"
        className={cn(
          'flex min-h-9 w-full items-start gap-2 rounded-[8px] px-2 py-2 text-left transition-colors hover:bg-[var(--app-raised)]',
          selected ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]' : 'text-[var(--app-text-soft)]',
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => node.output?.markdownPath && onSelectPath(node.output.markdownPath)}
      >
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{node.output.title}</span>
          <span className="mt-0.5 block truncate text-[10px] text-[var(--app-text-muted)]">
            {node.output.kind} · {node.output.status}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="flex min-h-8 w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-xs text-[var(--app-text-soft)] transition-colors hover:bg-[var(--app-raised)]"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => setOpen(value => !value)}
      >
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !open && '-rotate-90')} />
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-medium">{node.name}</span>
        {typeof node.count === 'number' ? <span className="ml-auto text-[10px] text-[var(--app-text-muted)]">{node.count}</span> : null}
      </button>
      {open && node.children?.length ? (
        <div className="mt-0.5">
          {node.children.map(child => (
            <OutputNode key={child.id} node={child} selectedPath={selectedPath} onSelectPath={onSelectPath} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function DepartmentContentPanel({ workspaceUri, title, locale }: DepartmentContentPanelProps) {
  const [mode, setMode] = useState<ContentMode>('outputs');
  const [data, setData] = useState<DepartmentContentResponse | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (path?: string) => {
    if (!workspaceUri) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.getDepartmentContent(workspaceUri, path);
      setData(response);
      setSelectedPath(response.selectedFile?.path || path);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setData(null);
    setSelectedPath(undefined);
    if (workspaceUri) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceUri]);

  const outputCount = useMemo(() => countOutputItems(data?.outputTree || []), [data]);

  if (!workspaceUri) return null;

  return (
    <WorkspaceSurface className="space-y-3" padding="sm">
      <WorkspaceSectionHeader
        title="部门内容"
        description={title}
        icon={<BookOpen className="h-4 w-4" />}
        actions={(
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === 'outputs' ? 'default' : 'outline'}
              className="h-8 gap-1.5 rounded-[8px]"
              onClick={() => setMode('outputs')}
            >
              <PackageOpen className="h-3.5 w-3.5" />
              产出物
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'files' ? 'default' : 'outline'}
              className="h-8 gap-1.5 rounded-[8px]"
              onClick={() => setMode('files')}
            >
              <FolderTree className="h-3.5 w-3.5" />
              文件
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 w-8 rounded-[8px] p-0" onClick={() => void load(selectedPath)}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}
      />

      {error ? (
        <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="max-h-[520px] overflow-y-auto rounded-[10px] border border-[var(--app-border-soft)] bg-white p-2">
          {loading && !data ? (
            <div className="flex items-center justify-center py-10 text-xs text-[var(--app-text-muted)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中
            </div>
          ) : mode === 'files' ? (
            data?.fileTree.length ? (
              <div className="space-y-1">
                {data.fileTree.map(node => (
                  <FileNode key={node.id} node={node} selectedPath={selectedPath} onSelect={(path) => void load(path)} />
                ))}
              </div>
            ) : (
              <WorkspaceEmptyBlock icon={<FolderTree className="h-5 w-5" />} title="暂无可读文件" description="当前部门还没有可展示的 reading root。" />
            )
          ) : data?.outputTree.length ? (
            <div className="space-y-1">
              {data.outputTree.map(node => (
                <OutputNode key={node.id} node={node} selectedPath={selectedPath} onSelectPath={(path) => void load(path)} />
              ))}
            </div>
          ) : (
            <WorkspaceEmptyBlock icon={<PackageOpen className="h-5 w-5" />} title="暂无产出物" description="正式产出会显示在这里。" />
          )}
        </div>

        <div className="min-h-[360px] rounded-[10px] border border-[var(--app-border-soft)] bg-white p-4">
          {data?.selectedFile ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--app-border-soft)] pb-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--app-text)]">{data.selectedFile.name}</div>
                  <div className="mt-1 truncate text-[11px] text-[var(--app-text-muted)]">{data.selectedFile.path}</div>
                </div>
                <div className="flex items-center gap-2">
                  <WorkspaceBadge tone="neutral">{Math.round(data.selectedFile.size / 1024)} KB</WorkspaceBadge>
                  <WorkspaceBadge tone="info">{formatRelativeTime(data.selectedFile.modifiedAt, locale)}</WorkspaceBadge>
                </div>
              </div>
              <div className="max-h-[520px] space-y-2 overflow-y-auto pr-2">
                {renderMarkdown(data.selectedFile.content)}
              </div>
            </div>
          ) : (
            <WorkspaceEmptyBlock
              icon={mode === 'files' ? <FileText className="h-5 w-5" /> : <PackageOpen className="h-5 w-5" />}
              title={mode === 'files' ? '选择 Markdown 文件' : `${outputCount} 个产出物`}
              description={mode === 'files' ? '从左侧文件目录树选择 Markdown。' : '从左侧产出物重组树选择有正文的产出物。'}
            />
          )}
        </div>
      </div>
    </WorkspaceSurface>
  );
}
