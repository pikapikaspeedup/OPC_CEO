'use client';

import {
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import type { TemplatePipelineStageFE, TemplateGroupDetailFE } from '@/lib/types';
import { EXECUTION_MODE_LABELS } from '@/components/template-constants';

// ---------------------------------------------------------------------------
// StageEditor — inline editing for linear pipeline stage properties
// ---------------------------------------------------------------------------

export function StageEditor({
  stage,
  group,
  onChange,
  allGroupIds,
}: {
  stage: TemplatePipelineStageFE;
  group?: TemplateGroupDetailFE;
  onChange: (updates: Partial<TemplatePipelineStageFE>) => void;
  allGroupIds?: string[];
}) {
  return (
    <div
      className="mt-4 border-t border-white/8 pt-4 space-y-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400">编辑阶段属性</div>

      {/* Stage ID */}
      <div className="flex items-center justify-between gap-3">
        <label className="text-xs text-[var(--app-text-soft)] shrink-0">阶段 ID</label>
        <Input
          value={stage.stageId ?? ''}
          onChange={(e) => onChange({ stageId: e.target.value })}
          className="h-7 text-xs bg-white/5 max-w-[200px] font-mono"
          placeholder="stage-id"
        />
      </div>

      {/* Group ID selector */}
      {allGroupIds && allGroupIds.length > 0 && (
        <div className="flex items-center justify-between">
          <label className="text-xs text-[var(--app-text-soft)]">所属 Group</label>
          <div className="flex flex-wrap gap-1">
            {allGroupIds.map(gid => (
              <button
                key={gid}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors',
                  stage.groupId === gid
                    ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                    : 'bg-white/5 text-white/30 border-white/8 hover:text-white/60',
                )}
                onClick={() => onChange({ groupId: gid })}
              >
                {gid}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Auto trigger */}
      <div className="flex items-center justify-between">
        <label className="text-xs text-[var(--app-text-soft)]">自动触发</label>
        <button
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors',
            stage.autoTrigger
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-white/5 text-white/40 border-white/10',
          )}
          onClick={() => onChange({ autoTrigger: !stage.autoTrigger })}
        >
          {stage.autoTrigger ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
          {stage.autoTrigger ? '开启' : '关闭'}
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
                (stage.triggerOn ?? 'approved') === v
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

      {/* Stage type */}
      <div className="flex items-center justify-between">
        <label className="text-xs text-[var(--app-text-soft)]">阶段类型</label>
        <div className="flex gap-1">
          {['normal', 'fan-out', 'join'].map(v => (
            <button
              key={v}
              className={cn(
                'rounded-full px-2.5 py-1 text-[10px] font-medium border transition-colors',
                (stage.stageType ?? 'normal') === v
                  ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                  : 'bg-white/5 text-white/30 border-white/8 hover:text-white/60',
              )}
              onClick={() => onChange({ stageType: v })}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Fan-out settings (when stageType is fan-out) */}
      {stage.stageType === 'fan-out' && (
        <div className="space-y-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
          <div className="text-[10px] font-semibold text-violet-400">Fan-Out 配置</div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-[var(--app-text-soft)]">最大并发数</label>
            <Input
              type="number"
              min={0}
              value={stage.fanOutSource?.maxConcurrency ?? 0}
              onChange={(e) => onChange({
                fanOutSource: {
                  workPackagesPath: stage.fanOutSource?.workPackagesPath ?? '',
                  perBranchTemplateId: stage.fanOutSource?.perBranchTemplateId ?? '',
                  maxConcurrency: parseInt(e.target.value) || 0,
                },
              })}
              className="w-20 h-7 text-xs bg-white/5"
            />
          </div>
        </div>
      )}

      {/* Group info */}
      {group && (
        <div className="rounded-lg border border-white/6 bg-white/[0.02] p-2 text-[10px] text-[var(--app-text-muted)]">
          <span className="font-semibold">Group:</span> {group.title} · {EXECUTION_MODE_LABELS[group.executionMode ?? ''] ?? group.executionMode} · {group.roles.length} 角色
        </div>
      )}
    </div>
  );
}
