'use client';

import { useState } from 'react';
import {
  Lock,
  Plus,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import type { TemplateNodeFE, TemplateGroupDetailFE } from '@/lib/types';
import { EXECUTION_MODE_LABELS } from '@/components/template-constants';

// ---------------------------------------------------------------------------
// NodeEditor — inline editing for a node's properties
// ---------------------------------------------------------------------------

export function NodeEditor({
  node,
  group,
  onChange,
  onRemove,
  edges,
  allNodeIds,
  onAddEdge,
  onRemoveEdge,
}: {
  node: TemplateNodeFE;
  group?: TemplateGroupDetailFE;
  onChange: (updates: Partial<TemplateNodeFE>) => void;
  onRemove?: () => void;
  edges?: { from: string; to: string; condition?: string }[];
  allNodeIds?: string[];
  onAddEdge?: (from: string, to: string) => void;
  onRemoveEdge?: (from: string, to: string) => void;
}) {
  const upstream = edges?.filter(e => e.to === node.id) ?? [];
  const downstream = edges?.filter(e => e.from === node.id) ?? [];

  return (
    <div
      className="mt-4 border-t border-white/8 pt-4 space-y-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400">编辑节点属性</div>
        {onRemove && (
          <button
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] text-red-400 border border-red-500/20 hover:bg-red-500/10 transition-colors"
            onClick={onRemove}
          >
            <Trash2 className="h-2.5 w-2.5" /> 删除节点
          </button>
        )}
      </div>

      {/* Auto trigger */}
      <div className="flex items-center justify-between">
        <label className="text-xs text-[var(--app-text-soft)]">自动触发</label>
        <button
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors',
            node.autoTrigger !== false
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-white/5 text-white/40 border-white/10',
          )}
          onClick={() => onChange({ autoTrigger: node.autoTrigger === false })}
        >
          {node.autoTrigger !== false ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
          {node.autoTrigger !== false ? '开启' : '关闭'}
        </button>
      </div>

      {/* Trigger On */}
      <div className="flex items-center justify-between">
        <label className="text-xs text-[var(--app-text-soft)]">触发条件</label>
        <div className="flex gap-1">
          {(['approved', 'completed', 'any'] as const).map(v => (
            <button
              key={v}
              className={cn(
                'rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors',
                (node.triggerOn ?? 'approved') === v
                  ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                  : 'bg-white/5 text-white/30 border-white/8 hover:text-white/60',
              )}
              onClick={() => onChange({ triggerOn: v })}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Gate-specific settings */}
      {node.kind === 'gate' && (
        <>
          <div className="flex items-center justify-between">
            <label className="text-xs text-[var(--app-text-soft)]">审批方式</label>
            <button
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                node.gate?.autoApprove
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-400 border-amber-500/30',
              )}
              onClick={() => onChange({ gate: { ...node.gate, autoApprove: !node.gate?.autoApprove } })}
            >
              {node.gate?.autoApprove ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {node.gate?.autoApprove ? '自动审批' : '人工审批'}
            </button>
          </div>
        </>
      )}

      {/* Fan-out settings */}
      {node.kind === 'fan-out' && node.fanOut && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-[var(--app-text-soft)]">最大并发数</label>
            <Input
              type="number"
              min={0}
              value={node.fanOut.maxConcurrency ?? 0}
              onChange={(e) => onChange({
                fanOut: { ...node.fanOut!, maxConcurrency: parseInt(e.target.value) || 0 },
              })}
              className="w-20 h-7 text-xs bg-white/5"
            />
          </div>
          <div className="text-[10px] text-[var(--app-text-muted)]">0 = 无限制</div>
        </div>
      )}

      {/* Loop settings */}
      {(node.kind === 'loop-start') && node.loop && (
        <div className="flex items-center justify-between">
          <label className="text-xs text-[var(--app-text-soft)]">最大迭代次数</label>
          <Input
            type="number"
            min={1}
            max={10}
            value={node.loop.maxIterations}
            onChange={(e) => onChange({
              loop: { ...node.loop!, maxIterations: parseInt(e.target.value) || 1 },
            })}
            className="w-20 h-7 text-xs bg-white/5"
          />
        </div>
      )}

      {/* Label */}
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs text-[var(--app-text-soft)] shrink-0">节点标签</label>
        <Input
          value={node.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value })}
          className="h-7 text-xs bg-white/5 max-w-[200px]"
          placeholder={node.id}
        />
      </div>

      {/* Group info (read-only) */}
      {group && (
        <div className="rounded-lg border border-white/6 bg-white/[0.02] p-2 text-[10px] text-[var(--app-text-muted)]">
          <span className="font-semibold">Group:</span> {group.title} · {EXECUTION_MODE_LABELS[group.executionMode ?? ''] ?? group.executionMode} · {group.roles.length} 角色
        </div>
      )}

      {/* Edge management */}
      {edges && onRemoveEdge && (
        <div className="space-y-2 border-t border-white/8 pt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">连线管理</div>

          {upstream.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-[var(--app-text-muted)]">上游 ({upstream.length})</span>
              {upstream.map(e => (
                <div key={e.from} className="flex items-center justify-between rounded border border-white/6 px-2 py-1 text-[10px]">
                  <span className="font-mono text-white/60">{e.from} → <span className="text-white/90">{node.id}</span></span>
                  <button
                    className="text-red-400/60 hover:text-red-400 ml-2"
                    onClick={() => onRemoveEdge(e.from, e.to)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {downstream.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-[var(--app-text-muted)]">下游 ({downstream.length})</span>
              {downstream.map(e => (
                <div key={e.to} className="flex items-center justify-between rounded border border-white/6 px-2 py-1 text-[10px]">
                  <span className="font-mono text-white/60"><span className="text-white/90">{node.id}</span> → {e.to}</span>
                  {e.condition && <span className="text-amber-400 text-[9px] mx-1">[{e.condition}]</span>}
                  <button
                    className="text-red-400/60 hover:text-red-400 ml-2"
                    onClick={() => onRemoveEdge(e.from, e.to)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Quick add downstream edge */}
          {onAddEdge && allNodeIds && (
            <QuickEdgeAdder
              currentNodeId={node.id}
              allNodeIds={allNodeIds}
              existingDownstream={downstream.map(e => e.to)}
              onAdd={(toId) => onAddEdge(node.id, toId)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuickEdgeAdder — dropdown to quickly connect current node to another
// ---------------------------------------------------------------------------

function QuickEdgeAdder({
  currentNodeId,
  allNodeIds,
  existingDownstream,
  onAdd,
}: {
  currentNodeId: string;
  allNodeIds: string[];
  existingDownstream: string[];
  onAdd: (toId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const candidates = allNodeIds.filter(id => id !== currentNodeId && !existingDownstream.includes(id));

  if (candidates.length === 0) return null;

  return (
    <div className="relative">
      <button
        className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300"
        onClick={() => setOpen(!open)}
      >
        <Plus className="h-3 w-3" /> 添加下游连线
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-48 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-[var(--app-surface)] shadow-lg">
          {candidates.map(id => (
            <button
              key={id}
              className="w-full text-left px-2.5 py-1.5 text-[10px] font-mono text-white/70 hover:bg-white/[0.06] transition-colors"
              onClick={() => { onAdd(id); setOpen(false); }}
            >
              → {id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
