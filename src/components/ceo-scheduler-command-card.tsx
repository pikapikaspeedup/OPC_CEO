'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, CheckCircle2, Loader2, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, type CEOCommandResult } from '@/lib/api';
import type { Workspace, Project, DepartmentConfig } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  workspaceFieldClassName,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';

interface CEOSchedulerCommandCardProps {
  workspaces: Workspace[];
  projects: Project[];
  departments: Map<string, DepartmentConfig>;
  onScheduled?: () => void;
  onOpenScheduler?: () => void;
  onRunDispatched?: (runId: string) => void;
  onProjectCreated?: (projectId: string) => void;
}

function formatNextRun(nextRunAt?: string | null): string {
  if (!nextRunAt) return '待计算';
  return new Date(nextRunAt).toLocaleString();
}

export default function CEOSchedulerCommandCard({
  workspaces,
  projects,
  departments,
  onScheduled,
  onOpenScheduler,
  onRunDispatched,
  onProjectCreated,
}: CEOSchedulerCommandCardProps) {
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CEOCommandResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const primaryDepartment = useMemo(() => {
    const entries = workspaces
      .map((workspace) => ({ workspace, department: departments.get(workspace.uri) }))
      .filter((entry) => entry.department?.type !== 'ceo');
    return entries[0] || null;
  }, [departments, workspaces]);

  const primaryProject = useMemo(
    () => projects.find((project) => project.status === 'active') || projects[0] || null,
    [projects],
  );

  const presets = useMemo(() => {
    const departmentName = primaryDepartment?.department?.name || '市场部';
    const healthProjectName = primaryProject?.name || '核心项目';
    return [
      `让${departmentName}分析最近一周的关键信号`,
      `每天工作日上午 9 点让${departmentName}创建一个日报任务项目，目标是汇总当前进行中的项目与风险`,
      `每周一上午 10 点巡检项目${healthProjectName}的健康度`,
    ];
  }, [primaryDepartment, primaryProject]);

  const handleSubmit = async () => {
    if (!command.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.ceoCommand(command.trim());
      setResult(response);
      if (response.success && response.action === 'create_scheduler_job') {
        onScheduled?.();
      }
      if (response.success && response.projectId) {
        onProjectCreated?.(response.projectId);
      }
      if (response.success && response.runId) {
        onRunDispatched?.(response.runId);
      }
    } catch (err: unknown) {
      setResult(null);
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: NonNullable<CEOCommandResult['suggestions']>[number]) => {
    if (suggestion.type === 'clarify_department') {
      setCommand(prev => `${prev} ${suggestion.label}`.trim());
      return;
    }
    if (suggestion.type === 'clarify_project') {
      setCommand(prev => `${prev} 项目 ${suggestion.label}`.trim());
      return;
    }
    if (suggestion.type === 'clarify_template') {
      setCommand(prev => `${prev} 模板 ${suggestion.description}`.trim());
      return;
    }
    setCommand(prev => `${prev} ${suggestion.label}`.trim());
  };

  return (
    <div className="rounded-[24px] border border-emerald-500/15 bg-[linear-gradient(135deg,rgba(16,185,129,0.08)_0%,rgba(255,255,255,0.98)_42%,rgba(248,250,252,0.94)_100%)] p-4 shadow-[0_18px_48px_rgba(28,44,73,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--app-text)]">
            <Sparkles className="h-4 w-4 text-emerald-700" />
            CEO 指令中心
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--app-text-soft)]">
            直接说业务意图，支持即时执行或创建定时任务。例如“让市场部分析竞品动态”或“每天 9 点让市场部生成日报”。
          </p>
        </div>
        <Button variant="outline" size="sm" className={cn('h-8 shrink-0 text-xs', workspaceOutlineActionClassName)} onClick={onOpenScheduler}>
          全部任务
          <ArrowUpRight className="ml-1 h-3 w-3" />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className="rounded-full border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-1.5 text-left text-[11px] text-[var(--app-text-soft)] transition-colors hover:border-[var(--app-border-strong)] hover:bg-white hover:text-[var(--app-text)]"
            onClick={() => setCommand(preset)}
          >
            {preset}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        <Textarea
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="例如：每周一上午 10 点巡检项目 Alpha 的健康度"
          className={cn('min-h-[108px] rounded-2xl text-sm', workspaceFieldClassName)}
        />

        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-[var(--app-text-muted)]">
            即时执行 / 每日 / 工作日 / 每周 / 明天 / 每隔 N 小时
          </div>
          <Button onClick={handleSubmit} disabled={loading || !command.trim()} className="h-9 bg-emerald-500 hover:bg-emerald-600 text-white">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            CEO 下令
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--app-text)]">
            <CheckCircle2 className={`h-4 w-4 ${result.success ? 'text-emerald-700' : 'text-amber-700'}`} />
            {result.success
              ? result.action === 'dispatch_prompt' ? 'CEO 已发起即时执行' : 'CEO 已处理该调度请求'
              : 'CEO 需要进一步确认'}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--app-text-soft)]">{result.message}</p>
          {result.action === 'dispatch_prompt' && result.runId ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--app-text-soft)]">
              <span className="rounded-full bg-orange-500/15 text-orange-700 px-2 py-1">Prompt Run</span>
              <span className="rounded-full bg-white px-2 py-1">Run: {result.runId.slice(0, 8)}</span>
            </div>
          ) : result.action === 'create_project' && result.projectId ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--app-text-soft)]">
              <span className="rounded-full bg-sky-500/15 text-sky-700 px-2 py-1">Ad-hoc Project</span>
              <span className="rounded-full bg-white px-2 py-1">Project: {result.projectId.slice(0, 8)}</span>
              {result.runId ? (
                <span className="rounded-full bg-white px-2 py-1">Run: {result.runId.slice(0, 8)}</span>
              ) : null}
            </div>
          ) : result.jobId ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--app-text-soft)]">
              <span className="rounded-full bg-white px-2 py-1">Job: {result.jobId.slice(0, 8)}</span>
              <span className="rounded-full bg-white px-2 py-1">Next: {formatNextRun(result.nextRunAt)}</span>
            </div>
          ) : null}
          {result.suggestions?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {result.suggestions.map((suggestion) => (
                <button
                  key={`${suggestion.type}-${suggestion.label}`}
                  type="button"
                  className="rounded-full border border-[var(--app-border-soft)] bg-white px-3 py-1.5 text-[11px] text-[var(--app-text-soft)] transition-colors hover:border-[var(--app-border-strong)] hover:text-[var(--app-text)]"
                  onClick={() => handleSuggestionClick(suggestion)}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
