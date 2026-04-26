'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Copy,
  GitBranch,
  Layers,
  Link,
  Loader2,
  Minus,
  Network,
  Play,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Workflow,
  X,
  Lock,
  Unlock,
  Repeat,
  Split,
  Merge,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type {
  TemplateSummaryFE,
  TemplateDetailFE,
  TemplateNodeFE,
  TemplatePipelineStageFE,
} from '@/lib/types';
import { DAGView } from '@/components/dag-view';
import { NODE_KIND_META } from '@/components/template-constants';
import { NodeEditor } from '@/components/template-node-editor';
import { StageEditor } from '@/components/template-stage-editor';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TemplateBrowserProps {
  templates: TemplateSummaryFE[];
  onSelectForDispatch?: (templateId: string) => void;
  onGenerate?: () => void;
  onRefresh?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TemplateBrowser({
  templates,
  onSelectForDispatch,
  onGenerate,
  onRefresh,
}: TemplateBrowserProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TemplateDetailFE | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Auto-clearing flash message
  const showFlash = useCallback((msg: string, durationMs = 4000) => {
    setSaveMessage(msg);
    setTimeout(() => setSaveMessage(prev => prev === msg ? null : prev), durationMs);
  }, []);

  // Clone/delete state
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [cloneId, setCloneId] = useState('');
  const [cloneTitle, setCloneTitle] = useState('');
  const [cloning, setCloning] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dagViewMode, setDagViewMode] = useState<'graph' | 'list'>('graph');
  const [dagNodeOffsets, setDagNodeOffsets] = useState<Record<string, { dx: number; dy: number }>>({});

  // DAG edit state
  const [showAddNodeDialog, setShowAddNodeDialog] = useState(false);
  const [newNodeId, setNewNodeId] = useState('');
  const [newNodeKind, setNewNodeKind] = useState<string>('stage');
  const [newNodeStageConfigId, setNewNodeStageConfigId] = useState('');
  const [newNodeLabel, setNewNodeLabel] = useState('');
  const [showAddEdgeDialog, setShowAddEdgeDialog] = useState(false);
  const [newEdgeFrom, setNewEdgeFrom] = useState('');
  const [newEdgeTo, setNewEdgeTo] = useState('');
  const [newEdgeCondition, setNewEdgeCondition] = useState('');

  // Track unsaved changes
  const [localDetail, setLocalDetail] = useState<TemplateDetailFE | null>(null);
  const hasChanges = localDetail && detail && JSON.stringify(localDetail) !== JSON.stringify(detail);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const d = await api.pipelineDetail(id);
      setDetail(d);
      setLocalDetail(d);
    } catch {
      setDetail(null);
      setLocalDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // Validation errors from the last save attempt
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const handleSave = async () => {
    if (!localDetail || !selectedId) return;
    setSaving(true);
    setSaveMessage(null);
    setValidationErrors([]);
    try {
      // Pre-validate before saving
      const validation = await api.validateTemplate({ template: localDetail });
      if (!validation.valid) {
        const errs = [
          ...validation.dagErrors,
          ...validation.contractErrors.map(e => `[${e.stageId}] ${e.field}: ${e.message}`),
        ];
        setValidationErrors(errs);
        showFlash('校验失败');
        return;
      }

      await api.updatePipeline(selectedId, localDetail as unknown as Record<string, unknown>);
      setDetail(localDetail);
      showFlash('保存成功', 2000);
      onRefresh?.();
    } catch {
      showFlash('保存失败');
    } finally {
      setSaving(false);
    }
  };

  // DAG mutation helpers
  const addNode = (node: TemplateNodeFE) => {
    if (!localDetail?.graphPipeline) return;
    setLocalDetail({
      ...localDetail,
      graphPipeline: {
        ...localDetail.graphPipeline,
        nodes: [...localDetail.graphPipeline.nodes, node],
      },
    });
  };

  const removeNode = (nodeId: string) => {
    if (!localDetail?.graphPipeline) return;
    setLocalDetail({
      ...localDetail,
      graphPipeline: {
        nodes: localDetail.graphPipeline.nodes.filter(n => n.id !== nodeId),
        edges: localDetail.graphPipeline.edges.filter(e => e.from !== nodeId && e.to !== nodeId),
      },
    });
    if (editingNodeId === nodeId) setEditingNodeId(null);
  };

  const addEdge = (from: string, to: string, condition?: string) => {
    if (!localDetail?.graphPipeline) return;
    // Prevent duplicate
    if (localDetail.graphPipeline.edges.some(e => e.from === from && e.to === to)) return;
    setLocalDetail({
      ...localDetail,
      graphPipeline: {
        ...localDetail.graphPipeline,
        edges: [...localDetail.graphPipeline.edges, { from, to, ...(condition ? { condition } : {}) }],
      },
    });
  };

  const removeEdge = (from: string, to: string) => {
    if (!localDetail?.graphPipeline) return;
    setLocalDetail({
      ...localDetail,
      graphPipeline: {
        ...localDetail.graphPipeline,
        edges: localDetail.graphPipeline.edges.filter(e => !(e.from === from && e.to === to)),
      },
    });
  };

  // Template highlights — detect patterns
  const getTemplatePatterns = (t: TemplateSummaryFE) => {
    const patterns: string[] = [];
    const stageTypes = t.pipeline?.map(s => s.stageType) ?? [];
    if (t.format === 'graphPipeline') patterns.push('DAG');
    else patterns.push('Pipeline');
    if (stageTypes.includes('fan-out')) patterns.push('Fan-Out');
    if (stageTypes.includes('join')) patterns.push('Join');
    if (stageTypes.includes('gate')) patterns.push('Gate');
    if (stageTypes.includes('switch')) patterns.push('Switch');
    if (stageTypes.includes('loop-start') || stageTypes.includes('loop-end')) patterns.push('Loop');
    const stageConfigCount = Object.keys(t.stages).length;
    const stageCount = t.pipeline?.length ?? 0;
    if (stageCount === 1 && stageConfigCount === 1) patterns.push('单阶段');
    else if (stageCount > 3) patterns.push('多阶段');
    return patterns;
  };

  // =================== List View ===================
  if (!selectedId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-bold text-white">
            <Layers className="h-5 w-5 text-indigo-400" />
            模板工坊
          </h3>
          {onGenerate && (
            <Button variant="ghost" onClick={onGenerate} className="gap-2 rounded-full text-sm">
              <Sparkles className="h-4 w-4 text-purple-400" />
              AI 生成新模板
            </Button>
          )}
        </div>

        {/* Pattern legend */}
        <div className="flex flex-wrap gap-2 text-[10px] text-[var(--app-text-muted)]">
          <span className="flex items-center gap-1"><Play className="h-3 w-3 text-sky-400" /> Stage</span>
          <span className="flex items-center gap-1"><Split className="h-3 w-3 text-violet-400" /> Fan-Out</span>
          <span className="flex items-center gap-1"><Merge className="h-3 w-3 text-blue-400" /> Join</span>
          <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-amber-400" /> Gate</span>
          <span className="flex items-center gap-1"><Repeat className="h-3 w-3 text-teal-400" /> Loop</span>
          <span className="flex items-center gap-1"><GitBranch className="h-3 w-3 text-orange-400" /> Switch</span>
        </div>

        {/* Search bar */}
        {templates.length > 3 && (
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索模板名称或 ID…"
            className="h-8 text-xs bg-white/[0.03] border-white/8"
          />
        )}

        {(() => {
          const q = searchQuery.toLowerCase().trim();
          const filtered = q
            ? templates.filter(t => t.title.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
            : templates;

          if (filtered.length === 0) {
            return (
              <div className="py-12 text-center text-[var(--app-text-muted)]">
                <Layers className="mx-auto h-10 w-10 mb-3 text-white/15" />
                {q ? <p>未找到匹配「{searchQuery}」的模板</p> : <p>暂无模板</p>}
                {onGenerate && !q && (
                  <Button variant="ghost" onClick={onGenerate} className="mt-3 gap-2 rounded-full">
                    <Sparkles className="h-4 w-4 text-purple-400" />
                    创建第一个模板
                  </Button>
                )}
              </div>
            );
          }

          return (
          <div className="grid gap-3">
            {filtered.map(t => {
              const patterns = getTemplatePatterns(t);
              const stageConfigCount = Object.keys(t.stages).length;
              const stageCount = t.pipeline?.length ?? 0;
              const roleCount = Object.values(t.stages).reduce((sum, stageConfig) => sum + (stageConfig.roleIds?.length ?? 0), 0);

              return (
                <div
                  key={t.id}
                  className="group relative rounded-xl border border-white/8 bg-white/[0.03] p-4 hover:bg-white/[0.06] hover:border-white/12 transition-all cursor-pointer"
                  onClick={() => setSelectedId(t.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Workflow className="h-4 w-4 text-indigo-400 shrink-0" />
                        <h4 className="text-sm font-semibold text-white truncate">{t.title}</h4>
                      </div>
                      <p className="mt-1 text-xs text-[var(--app-text-muted)] font-mono truncate">{t.id}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-white/20 group-hover:text-white/50 shrink-0 transition-colors" />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {patterns.map(p => (
                      <Badge key={p} variant="outline" className="text-[10px] px-1.5 py-0 h-5">{p}</Badge>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center gap-4 text-[11px] text-[var(--app-text-muted)]">
                    <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> {stageCount} {t.format === 'graphPipeline' ? '节点' : '阶段'}</span>
                    <span className="flex items-center gap-1"><Network className="h-3 w-3" /> {stageConfigCount} Stage Config</span>
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {roleCount} 角色</span>
                  </div>

                  {/* Mini pipeline visualization */}
                  {stageCount > 0 && (
                    <div className="mt-3 flex items-center gap-1 overflow-hidden">
                      {t.pipeline.slice(0, 8).map((stage, i) => {
                        const meta = NODE_KIND_META[stage.stageType ?? 'stage'] ?? NODE_KIND_META['stage'];
                        const Icon = meta.icon;
                        return (
                          <div key={i} className="flex items-center gap-1">
                            {i > 0 && <div className="w-3 h-px bg-white/15" />}
                            <div className={cn('flex items-center gap-1 rounded-full border px-1.5 py-0.5', meta.color)} title={stage.stageId}>
                              <Icon className="h-2.5 w-2.5" />
                              <span className="text-[9px] truncate max-w-[60px]">{t.stages[stage.stageId]?.title ?? stage.title ?? stage.stageId}</span>
                            </div>
                          </div>
                        );
                      })}
                      {stageCount > 8 && <span className="text-[10px] text-white/30">+{stageCount - 8}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          );
        })()}
      </div>
    );
  }

  // =================== Detail View ===================
  const tmpl = localDetail;
  const nodes = tmpl?.graphPipeline?.nodes ?? [];
  const edges = tmpl?.graphPipeline?.edges ?? [];
  const pipelineStages = tmpl?.pipeline ?? [];
  const isGraphFormat = !!tmpl?.graphPipeline;

  return (
    <div className="space-y-4 max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
          onClick={() => { setSelectedId(null); setDetail(null); setLocalDetail(null); setEditingNodeId(null); setDagNodeOffsets({}); }}
        >
          <ArrowLeft className="h-4 w-4" />
          返回模板列表
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {onSelectForDispatch && (
            <Button variant="outline" size="sm" className="gap-1.5 text-sky-400" onClick={() => onSelectForDispatch(selectedId)}>
              <Play className="h-3.5 w-3.5" /> 使用此模板
            </Button>
          )}
          {hasChanges && (
            <>
              <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                保存修改
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-white/40 hover:text-white/70"
                onClick={() => { setLocalDetail(detail); setValidationErrors([]); setSaveMessage(null); }}
              >
                <X className="h-3.5 w-3.5" /> 放弃
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="gap-1.5 text-white/50 hover:text-white" onClick={() => { setCloneId(''); setCloneTitle(''); setShowCloneDialog(true); }}>
            <Copy className="h-3.5 w-3.5" /> 克隆
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 text-red-400/70 hover:text-red-400" onClick={() => setShowDeleteConfirm(true)}>
            <Trash2 className="h-3.5 w-3.5" /> 删除
          </Button>
          {saveMessage && (
            <span className={cn('text-xs', saveMessage === '保存成功' ? 'text-emerald-400' : 'text-red-400')}>
              {saveMessage}
            </span>
          )}
        </div>
      </div>

      {/* Validation errors panel */}
      {validationErrors.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-red-400">校验失败 ({validationErrors.length} 项错误)</span>
            <button className="text-white/30 hover:text-white/60" onClick={() => setValidationErrors([])}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="space-y-1">
            {validationErrors.map((err, i) => (
              <li key={i} className="text-[11px] text-red-300/80 flex items-start gap-1.5">
                <span className="text-red-400 shrink-0 mt-0.5">•</span>
                <span className="font-mono">{err}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {detailLoading ? (
        <div className="py-16 text-center">
          <Loader2 className="h-6 w-6 mx-auto animate-spin text-white/30" />
        </div>
      ) : !tmpl ? (
        <div className="py-16 text-center text-[var(--app-text-muted)]">模板加载失败</div>
      ) : (
        <>
          {/* Template meta — editable */}
          <div className="rounded-xl border border-white/8 bg-white/[0.03] p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 border border-indigo-500/20">
                <Workflow className="h-5 w-5 text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <Input
                  value={tmpl.title}
                  onChange={(e) => localDetail && setLocalDetail({ ...localDetail, title: e.target.value })}
                  className="text-xl font-bold text-white bg-transparent border-none px-0 h-auto focus-visible:ring-0 focus-visible:ring-offset-0 hover:bg-white/5 rounded"
                  placeholder="模板标题"
                />
                <p className="text-xs text-[var(--app-text-muted)] font-mono mt-0.5">{tmpl.id}</p>
              </div>
            </div>
            <Textarea
              value={tmpl.description ?? ''}
              onChange={(e) => localDetail && setLocalDetail({ ...localDetail, description: e.target.value })}
              className="text-sm text-[var(--app-text-soft)] bg-transparent border-none px-0 min-h-0 h-8 focus-visible:ring-0 focus-visible:ring-offset-0 hover:bg-white/5 rounded resize-none"
              placeholder="添加模板描述…"
              rows={1}
              onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }}
            />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant="outline" className="text-[10px]">
                {isGraphFormat ? 'graphPipeline (DAG)' : 'pipeline (线性)'}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {Object.keys(tmpl.stages).length} Stage Configs
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {isGraphFormat ? nodes.length : pipelineStages.length} Stages
              </Badge>
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-[10px] text-[var(--app-text-muted)]">默认模型:</span>
                <Input
                  value={tmpl.defaultModel ?? ''}
                  onChange={(e) => localDetail && setLocalDetail({ ...localDetail, defaultModel: e.target.value || undefined })}
                  className="h-5 text-[10px] bg-white/5 border-white/10 w-40 px-1.5"
                  placeholder="未指定"
                />
              </div>
            </div>
          </div>

          {/* Node/Stage visualization */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--app-text-soft)]">
                <Network className="h-4 w-4" />
                {isGraphFormat ? 'DAG 节点' : '管线阶段'}
                <span className="text-[10px] text-[var(--app-text-muted)]">(点击可编辑)</span>
              </h3>
              {isGraphFormat && (
                <div className="flex items-center gap-2">
                  <button
                    className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[10px] text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                    onClick={() => {
                      setNewNodeId('');
                      setNewNodeKind('stage');
                      setNewNodeStageConfigId(Object.keys(tmpl.stages)[0] ?? '');
                      setNewNodeLabel('');
                      setShowAddNodeDialog(true);
                    }}
                  >
                    <Plus className="h-3 w-3" /> 节点
                  </button>
                  <button
                    className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[10px] text-sky-400 hover:bg-sky-500/10 transition-colors"
                    onClick={() => {
                      setNewEdgeFrom('');
                      setNewEdgeTo('');
                      setNewEdgeCondition('');
                      setShowAddEdgeDialog(true);
                    }}
                  >
                    <Link className="h-3 w-3" /> 连线
                  </button>
                  <div className="flex rounded-lg border border-white/10 overflow-hidden text-[10px]">
                    <button
                      className={cn('px-2.5 py-1 transition-colors', dagViewMode === 'graph' ? 'bg-indigo-500/20 text-indigo-300' : 'text-white/40 hover:text-white/60')}
                      onClick={() => setDagViewMode('graph')}
                    >
                      图形
                    </button>
                    <button
                      className={cn('px-2.5 py-1 transition-colors', dagViewMode === 'list' ? 'bg-indigo-500/20 text-indigo-300' : 'text-white/40 hover:text-white/60')}
                      onClick={() => setDagViewMode('list')}
                    >
                      列表
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* DAG graph visualization */}
            {isGraphFormat && dagViewMode === 'graph' && (
              <DAGView
                nodes={nodes}
                edges={edges}
                selectedNodeId={editingNodeId}
                onNodeClick={(id) => setEditingNodeId(editingNodeId === id ? null : id)}
                nodeOffsets={dagNodeOffsets}
                onNodeDragEnd={(nodeId, dx, dy) => {
                  setDagNodeOffsets(prev => ({ ...prev, [nodeId]: { dx, dy } }));
                }}
              />
            )}

            {isGraphFormat && dagViewMode === 'graph' && editingNodeId && (() => {
              const node = nodes.find(n => n.id === editingNodeId);
              if (!node) return null;
              const stageConfig = tmpl.stages[node.id];
              return (
                <NodeEditor
                  node={node}
                  stageConfig={stageConfig}
                  edges={edges}
                  allNodeIds={nodes.map(n => n.id)}
                  onAddEdge={addEdge}
                  onRemoveEdge={removeEdge}
                  onRemove={() => removeNode(node.id)}
                  onChange={(updated) => {
                    if (!localDetail?.graphPipeline) return;
                    setLocalDetail({
                      ...localDetail,
                      graphPipeline: {
                        ...localDetail.graphPipeline,
                        nodes: localDetail.graphPipeline.nodes.map(n => n.id === node.id ? { ...n, ...updated } : n),
                      },
                    });
                  }}
                />
              );
            })()}

            {isGraphFormat && dagViewMode === 'list' ? (
              /* --- graphPipeline nodes --- */
              <div className="space-y-2">
                {nodes.map((node) => {
                  const meta = NODE_KIND_META[node.kind] ?? NODE_KIND_META['stage'];
                  const Icon = meta.icon;
                  const stageConfig = tmpl.stages[node.id];
                  const isEditing = editingNodeId === node.id;
                  const downstream = edges.filter(e => e.from === node.id).map(e => e.to);
                  const upstream = edges.filter(e => e.to === node.id).map(e => e.from);

                  return (
                    <div
                      key={node.id}
                      className={cn(
                        'rounded-xl border p-4 transition-all cursor-pointer',
                        isEditing
                          ? 'border-indigo-500/40 bg-indigo-500/5 shadow-[0_0_15px_rgba(99,102,241,0.1)]'
                          : 'border-white/8 bg-white/[0.02] hover:border-white/15',
                      )}
                      onClick={() => setEditingNodeId(isEditing ? null : node.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn('flex items-center justify-center h-8 w-8 rounded-lg border', meta.color)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">{node.label ?? node.id}</span>
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">{meta.label}</Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--app-text-muted)]">
                            <span className="font-mono">{node.id}</span>
                            <span>→ stage: {node.id}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-[var(--app-text-muted)]">
                          {node.autoTrigger !== false ? (
                            <span className="flex items-center gap-0.5 text-emerald-400"><ToggleRight className="h-3 w-3" /> 自动触发</span>
                          ) : (
                            <span className="flex items-center gap-0.5 text-amber-400"><ToggleLeft className="h-3 w-3" /> 手动触发</span>
                          )}
                          {node.triggerOn && <span>on: {node.triggerOn}</span>}
                        </div>
                      </div>

                      {/* Connection info */}
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                        {upstream.length > 0 && (
                          <span className="text-[var(--app-text-muted)]">
                            ← 上游: {upstream.join(', ')}
                          </span>
                        )}
                        {downstream.length > 0 && (
                          <span className="text-[var(--app-text-muted)]">
                            → 下游: {downstream.join(', ')}
                          </span>
                        )}
                      </div>

                      {/* Special config badges */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {node.kind === 'gate' && (
                          <Badge variant="outline" className={cn('text-[9px] gap-1', node.gate?.autoApprove ? 'text-emerald-400' : 'text-amber-400')}>
                            {node.gate?.autoApprove ? <Unlock className="h-2.5 w-2.5" /> : <Lock className="h-2.5 w-2.5" />}
                            {node.gate?.autoApprove ? '自动审批' : '人工审批'}
                          </Badge>
                        )}
                        {node.kind === 'fan-out' && node.fanOut && (
                          <Badge variant="outline" className="text-[9px] gap-1 text-violet-400">
                            <Split className="h-2.5 w-2.5" />
                            分支模板: {node.fanOut.perBranchTemplateId}
                            {node.fanOut.maxConcurrency ? ` (max ${node.fanOut.maxConcurrency})` : ''}
                          </Badge>
                        )}
                        {node.kind === 'join' && node.join && (
                          <Badge variant="outline" className="text-[9px] gap-1 text-blue-400">
                            <Merge className="h-2.5 w-2.5" />
                            等待: {node.join.sourceNodeId}
                          </Badge>
                        )}
                        {(node.kind === 'loop-start' || node.kind === 'loop-end') && node.loop && (
                          <Badge variant="outline" className="text-[9px] gap-1 text-teal-400">
                            <Repeat className="h-2.5 w-2.5" />
                            最大迭代: {node.loop.maxIterations}
                          </Badge>
                        )}
                      </div>

                      {/* Expanded editing view */}
                      {isEditing && (
                        <NodeEditor
                          node={node}
                          stageConfig={stageConfig}
                          edges={edges}
                          allNodeIds={nodes.map(n => n.id)}
                          onAddEdge={addEdge}
                          onRemoveEdge={removeEdge}
                          onRemove={() => removeNode(node.id)}
                          onChange={(updated) => {
                            if (!localDetail?.graphPipeline) return;
                            setLocalDetail({
                              ...localDetail,
                              graphPipeline: {
                                ...localDetail.graphPipeline,
                                nodes: localDetail.graphPipeline.nodes.map(n => n.id === node.id ? { ...n, ...updated } : n),
                              },
                            });
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {!isGraphFormat && (
              /* --- Linear pipeline stages --- */
              <div className="space-y-2">
                {pipelineStages.map((stage, i) => {
                  const stageConfig = tmpl.stages[stage.stageId];
                  const isEditing = editingNodeId === stage.stageId;

                  return (
                    <div
                      key={stage.stageId}
                      className={cn(
                        'rounded-xl border p-4 transition-all cursor-pointer',
                        isEditing ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-white/8 bg-white/[0.02] hover:border-white/15',
                      )}
                      onClick={() => setEditingNodeId(isEditing ? null : stage.stageId)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-bold">
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-semibold text-white">{stageConfig?.title ?? stage.title ?? stage.stageId}</span>
                          <div className="text-[11px] text-[var(--app-text-muted)] font-mono">stage: {stage.stageId}</div>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px]">
                          {/* Reorder & delete */}
                          <button
                            className="text-white/20 hover:text-white/60 disabled:opacity-20"
                            disabled={i === 0}
                            title="上移"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!localDetail?.pipeline || i === 0) return;
                              const arr = [...localDetail.pipeline];
                              [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                              setLocalDetail({ ...localDetail, pipeline: arr });
                            }}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="text-white/20 hover:text-white/60 disabled:opacity-20"
                            disabled={i === pipelineStages.length - 1}
                            title="下移"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!localDetail?.pipeline || i === pipelineStages.length - 1) return;
                              const arr = [...localDetail.pipeline];
                              [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
                              setLocalDetail({ ...localDetail, pipeline: arr });
                            }}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="text-red-400/40 hover:text-red-400"
                            title="删除阶段"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!localDetail?.pipeline) return;
                              setLocalDetail({ ...localDetail, pipeline: localDetail.pipeline.filter((_, si) => si !== i) });
                              if (editingNodeId === stage.stageId) setEditingNodeId(null);
                            }}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <div className="w-px h-3 bg-white/10 mx-0.5" />
                          {stage.autoTrigger ? (
                            <span className="text-emerald-400">自动</span>
                          ) : (
                            <span className="text-amber-400">手动</span>
                          )}
                          {stage.triggerOn && <span className="text-[var(--app-text-muted)]">on: {stage.triggerOn}</span>}
                          {stage.stageType && stage.stageType !== 'normal' && (
                            <Badge variant="outline" className="text-[9px]">{stage.stageType}</Badge>
                          )}
                        </div>
                      </div>

                      {/* Inline stage editor */}
                      {isEditing && (
                        <StageEditor
                          stage={stage}
                          stageConfig={stageConfig}
                          onChange={(updated) => {
                            if (!localDetail?.pipeline) return;
                            setLocalDetail({
                              ...localDetail,
                              pipeline: localDetail.pipeline.map((s, si) =>
                                si === i ? { ...s, ...updated } : s,
                              ),
                            });
                          }}
                        />
                      )}
                    </div>
                  );
                })}
                {/* Add stage button */}
                <button
                  className="w-full rounded-xl border border-dashed border-white/10 hover:border-white/20 py-3 flex items-center justify-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors"
                  onClick={() => {
                    if (!localDetail) return;
                    const defaultStageConfig = Object.values(tmpl.stages)[0];
                    const idx = (localDetail.pipeline?.length ?? 0);
                    const newStage: TemplatePipelineStageFE = {
                      stageId: `stage-${idx + 1}`,
                      title: defaultStageConfig?.title || `Stage ${idx + 1}`,
                      description: defaultStageConfig?.description,
                      executionMode: defaultStageConfig?.executionMode || 'legacy-single',
                      roles: defaultStageConfig?.roles || [],
                      reviewPolicyId: defaultStageConfig?.reviewPolicyId,
                      capabilities: defaultStageConfig?.capabilities,
                      sourceContract: defaultStageConfig?.sourceContract,
                      autoTrigger: true,
                      triggerOn: 'approved',
                      stageType: 'normal',
                    };
                    setLocalDetail({
                      ...localDetail,
                      pipeline: [...(localDetail.pipeline ?? []), newStage],
                    });
                    setEditingNodeId(newStage.stageId);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> 添加阶段
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Clone Dialog */}
      <Dialog open={showCloneDialog} onOpenChange={setShowCloneDialog}>
        <DialogContent className="border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--app-text)]">克隆模板</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-[var(--app-text-muted)] mb-1 block">新模板 ID（必填）</label>
              <Input
                value={cloneId}
                onChange={(e) => setCloneId(e.target.value)}
                placeholder="my-new-template"
                className="font-mono text-sm"
              />
              <p className="mt-1 text-[10px] text-[var(--app-text-muted)]">小写字母、数字、连字符，至少两个字符</p>
            </div>
            <div>
              <label className="text-xs text-[var(--app-text-muted)] mb-1 block">标题（可选）</label>
              <Input
                value={cloneTitle}
                onChange={(e) => setCloneTitle(e.target.value)}
                placeholder={tmpl?.title ? `${tmpl.title}（副本）` : ''}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCloneDialog(false)}>取消</Button>
            <Button
              size="sm"
              disabled={!cloneId || cloning}
              onClick={async () => {
                setCloning(true);
                try {
                  await api.clonePipeline(selectedId!, cloneId, cloneTitle || undefined);
                  setShowCloneDialog(false);
                  onRefresh?.();
                  setSelectedId(cloneId);
                  loadDetail(cloneId);
                  showFlash('克隆成功', 2000);
                } catch (err: unknown) {
                  showFlash(`克隆失败: ${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  setCloning(false);
                }
              }}
            >
              {cloning ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              确认克隆
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--app-text)]">确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--app-text-muted)] py-2">
            确定要删除模板 <span className="font-mono text-[var(--app-text)]">{selectedId}</span> 吗？此操作不可撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>取消</Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await api.deletePipeline(selectedId!);
                  setShowDeleteConfirm(false);
                  setSelectedId(null);
                  setDetail(null);
                  setLocalDetail(null);
                  onRefresh?.();
                } catch (err: unknown) {
                  showFlash(`删除失败: ${err instanceof Error ? err.message : String(err)}`);
                  setShowDeleteConfirm(false);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Node Dialog */}
      <Dialog open={showAddNodeDialog} onOpenChange={setShowAddNodeDialog}>
        <DialogContent className="border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--app-text)]">添加 DAG 节点</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-[var(--app-text-muted)] mb-1 block">节点 ID（必填）</label>
              <Input
                value={newNodeId}
                onChange={(e) => setNewNodeId(e.target.value)}
                placeholder="my-node"
                className="font-mono text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--app-text-muted)] mb-1 block">标签</label>
              <Input
                value={newNodeLabel}
                onChange={(e) => setNewNodeLabel(e.target.value)}
                placeholder="可选显示名称"
                className="text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--app-text-muted)] mb-1.5 block">节点类型</label>
              <div className="flex flex-wrap gap-1.5">
                {(['stage', 'fan-out', 'join', 'gate', 'switch', 'loop-start', 'loop-end', 'subgraph-ref'] as const).map(k => (
                  <button
                    key={k}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors',
                      newNodeKind === k
                        ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                        : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
                    )}
                    onClick={() => setNewNodeKind(k)}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--app-text-muted)] mb-1.5 block">复制现有 Stage Config</label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(tmpl?.stages ?? {}).map(([stageId, stageConfig]) => (
                  <button
                    key={stageId}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors',
                      newNodeStageConfigId === stageId
                        ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                        : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
                    )}
                    onClick={() => setNewNodeStageConfigId(stageId)}
                  >
                    {stageConfig.title || stageId}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowAddNodeDialog(false)}>取消</Button>
            <Button
              size="sm"
              disabled={!newNodeId || !newNodeStageConfigId || nodes.some(n => n.id === newNodeId)}
              onClick={() => {
                const kind = newNodeKind as TemplateNodeFE['kind'];
                const baseStageConfig = tmpl?.stages?.[newNodeStageConfigId];
                const base: TemplateNodeFE = {
                  id: newNodeId,
                  kind,
                  title: baseStageConfig?.title || newNodeLabel || newNodeId,
                  description: baseStageConfig?.description,
                  executionMode: baseStageConfig?.executionMode || (kind === 'stage' ? 'legacy-single' : 'orchestration'),
                  roles: baseStageConfig?.roles || [],
                  reviewPolicyId: baseStageConfig?.reviewPolicyId,
                  capabilities: baseStageConfig?.capabilities,
                  sourceContract: baseStageConfig?.sourceContract,
                  label: newNodeLabel || undefined,
                  autoTrigger: true,
                };
                // Initialize kind-specific sub-fields
                if (kind === 'gate') base.gate = { autoApprove: false };
                if (kind === 'fan-out') base.fanOut = { workPackagesPath: '', perBranchTemplateId: '', maxConcurrency: 0 };
                if (kind === 'join') base.join = { sourceNodeId: '' };
                if (kind === 'loop-start' || kind === 'loop-end') base.loop = { maxIterations: 3, pairedNodeId: '' };
                addNode(base);
                setShowAddNodeDialog(false);
                setEditingNodeId(newNodeId);
              }}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> 添加节点
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Edge Dialog */}
      <Dialog open={showAddEdgeDialog} onOpenChange={setShowAddEdgeDialog}>
        <DialogContent className="border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--app-text)]">添加连线</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-[var(--app-text-muted)] mb-1.5 block">起始节点</label>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {nodes.map(n => (
                  <button
                    key={n.id}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[10px] font-mono border transition-colors',
                      newEdgeFrom === n.id
                        ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                        : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
                    )}
                    onClick={() => setNewEdgeFrom(n.id)}
                  >
                    {n.label ?? n.id}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--app-text-muted)] mb-1.5 block">目标节点</label>
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {nodes.filter(n => n.id !== newEdgeFrom).map(n => (
                  <button
                    key={n.id}
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[10px] font-mono border transition-colors',
                      newEdgeTo === n.id
                        ? 'bg-sky-500/15 text-sky-400 border-sky-500/30'
                        : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-muted)] hover:text-[var(--app-text)]',
                    )}
                    onClick={() => setNewEdgeTo(n.id)}
                  >
                    {n.label ?? n.id}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--app-text-muted)] mb-1 block">条件表达式（可选）</label>
              <Input
                value={newEdgeCondition}
                onChange={(e) => setNewEdgeCondition(e.target.value)}
                placeholder='如: decision == "approved"'
                className="text-sm font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowAddEdgeDialog(false)}>取消</Button>
            <Button
              size="sm"
              disabled={!newEdgeFrom || !newEdgeTo || edges.some(e => e.from === newEdgeFrom && e.to === newEdgeTo)}
              onClick={() => {
                addEdge(newEdgeFrom, newEdgeTo, newEdgeCondition || undefined);
                setShowAddEdgeDialog(false);
              }}
            >
              <Link className="h-3.5 w-3.5 mr-1" /> 添加连线
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
