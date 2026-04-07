'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, CalendarClock, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, type CEOCommandResult } from '@/lib/api';
import type { Workspace, Project, DepartmentConfig } from '@/lib/types';

interface CEOSchedulerCommandCardProps {
  workspaces: Workspace[];
  projects: Project[];
  departments: Map<string, DepartmentConfig>;
  onScheduled?: () => void;
  onOpenScheduler?: () => void;
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
      `每天工作日上午 9 点让${departmentName}生成日报，目标是汇总当前进行中的项目与风险`,
      `每周一上午 10 点巡检项目${healthProjectName}的健康度`,
      `明天上午 9 点让${departmentName}创建一个 ad-hoc 项目，目标是整理本周 backlog 并给出优先级建议`,
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
    <div className="rounded-2xl border border-emerald-500/15 bg-[linear-gradient(135deg,rgba(16,185,129,0.08)_0%,rgba(15,23,42,0.3)_100%)] p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white/90">
            <Sparkles className="h-4 w-4 text-emerald-300" />
            用一句话创建定时任务
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-white/50">
            直接说业务意图，例如“每天工作日上午 9 点让市场部生成日报”。系统会自动翻译成 Scheduler Job。
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8 shrink-0 text-xs" onClick={onOpenScheduler}>
          全部任务
          <ArrowUpRight className="ml-1 h-3 w-3" />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-left text-[11px] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
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
          className="min-h-[108px] border-white/10 bg-black/25 text-sm text-white/85 placeholder:text-white/25"
        />

        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-white/35">
            支持：每日 / 工作日 / 每周 / 明天 / 每隔 N 小时
          </div>
          <Button onClick={handleSubmit} disabled={loading || !command.trim()} className="h-9 bg-emerald-500 hover:bg-emerald-600 text-white">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-2 h-4 w-4" />}
            由 CEO 创建
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-white/90">
            <CheckCircle2 className={`h-4 w-4 ${result.success ? 'text-emerald-300' : 'text-amber-300'}`} />
            {result.success ? 'CEO 已处理该调度请求' : 'CEO 需要进一步确认'}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-white/55">{result.message}</p>
          {result.jobId ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/45">
              <span className="rounded-full bg-white/[0.05] px-2 py-1">Job: {result.jobId.slice(0, 8)}</span>
              <span className="rounded-full bg-white/[0.05] px-2 py-1">Next: {formatNextRun(result.nextRunAt)}</span>
            </div>
          ) : null}
          {result.suggestions?.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {result.suggestions.map((suggestion) => (
                <button
                  key={`${suggestion.type}-${suggestion.label}`}
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[11px] text-white/75 transition-colors hover:bg-white/[0.1] hover:text-white"
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