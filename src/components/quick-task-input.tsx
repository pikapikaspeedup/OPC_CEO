'use client';

import { useState, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Workspace, DepartmentConfig, ModelConfig } from '@/lib/types';

interface QuickTaskInputProps {
  workspaces: Workspace[];
  departments?: Map<string, DepartmentConfig>;
  models?: ModelConfig[];
  onSubmit: (task: { goal: string; workspace: string; model?: string }) => void | Promise<void>;
}

function generateTaskName(goal: string): string {
  const trimmed = goal.trim().slice(0, 20);
  return trimmed + (goal.length > 20 ? '...' : '');
}

export { generateTaskName };

export default function QuickTaskInput({ workspaces, departments, models, onSubmit }: QuickTaskInputProps) {
  const [goal, setGoal] = useState('');
  const [workspace, setWorkspace] = useState(workspaces[0]?.uri || '');
  const [model, setModel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = goal.trim().length > 0 && workspace.length > 0 && !submitting;

  // Resolve display name for a workspace
  const getDisplayName = (ws: Workspace) => {
    const dept = departments?.get(ws.uri);
    return dept?.name || ws.name;
  };

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ goal: goal.trim(), workspace, ...(model ? { model } : {}) });
      setGoal('');
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, goal, workspace, model, onSubmit]);

  // Filter models that have a valid model ID
  const availableModels = models?.filter(m => m.modelOrAlias?.model) || [];

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 space-y-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">
        <span>💬</span>
        <span>快速任务</span>
        {submitting && (
          <span className="flex items-center gap-1 text-sky-400/70 animate-pulse normal-case tracking-normal font-normal">
            <Loader2 className="h-3 w-3 animate-spin" />
            AI 分析中...
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
          placeholder="说点什么... (如:&quot;修复登录bug&quot;)"
          disabled={submitting}
          className={cn(
            'flex-1 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/80 placeholder:text-white/25 focus:border-sky-400/30 focus:outline-none transition-opacity',
            submitting && 'opacity-50 cursor-not-allowed',
          )}
        />
        <select
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
          disabled={submitting}
          className={cn(
            'rounded-lg border border-white/8 bg-white/[0.03] px-2 py-2 text-xs text-white/60 focus:border-sky-400/30 focus:outline-none',
            submitting && 'opacity-50 cursor-not-allowed',
          )}
        >
          {workspaces.map((ws) => (
            <option key={ws.uri} value={ws.uri}>{getDisplayName(ws)}</option>
          ))}
        </select>
        {availableModels.length > 0 && (
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={submitting}
            className={cn(
              'rounded-lg border border-white/8 bg-white/[0.03] px-2 py-2 text-xs text-white/60 focus:border-sky-400/30 focus:outline-none max-w-[140px]',
              submitting && 'opacity-50 cursor-not-allowed',
            )}
          >
            <option value="">自动选择模型</option>
            {availableModels.map((m) => (
              <option key={m.modelOrAlias!.model} value={m.modelOrAlias!.model}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        <button
          disabled={!canSubmit}
          onClick={handleSubmit}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
            canSubmit
              ? 'bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 border border-sky-500/30'
              : 'bg-white/5 text-white/20 border border-white/8 cursor-not-allowed',
          )}
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {submitting ? 'AI 决策中...' : '派发'}
        </button>
      </div>
    </div>
  );
}
