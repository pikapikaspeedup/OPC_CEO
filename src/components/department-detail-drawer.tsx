'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import {
  getDepartmentContextDocumentPaths,
  getDepartmentWorkspaceBindings,
  workspaceNameFromUri,
} from '@/lib/department-config';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Settings,
  XCircle,
  Activity,
  Zap,
  Target,
  TrendingUp,
  Siren,
  Ticket,
  ClipboardList,
  BarChart3,
  ListChecks,
  UserRound,
  FlaskConical,
  Radio,
  Hammer,
} from 'lucide-react';
import type {
  Workspace,
  Project,
  DepartmentConfig,
  DailyDigestFE,
  DepartmentManagementOverviewFE,
} from '@/lib/types';
import PipelineMiniDAG from '@/components/pipeline-mini-dag';

interface DepartmentDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace;
  config: DepartmentConfig;
  projects: Project[];
  allWorkspaces?: Workspace[];
  onNavigateToProject?: (projectId: string) => void;
  onOpenSettings?: () => void;
}

export default function DepartmentDetailDrawer({
  open,
  onOpenChange,
  workspace,
  config,
  projects,
  allWorkspaces = [],
  onNavigateToProject,
  onOpenSettings,
}: DepartmentDetailDrawerProps) {
  const [digest, setDigest] = useState<DailyDigestFE | null>(null);
  const [quota, setQuota] = useState<{ daily: number; monthly: number; used: { daily: number; monthly: number } } | null>(null);
  const [managementOverview, setManagementOverview] = useState<DepartmentManagementOverviewFE | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const [digestResult, quotaResult, managementResult] = await Promise.allSettled([
        api.getDailyDigest(workspace.uri),
        api.getDepartmentQuota(workspace.uri),
        api.managementOverview(workspace.uri),
      ]);
      setDigest(digestResult.status === 'fulfilled' ? digestResult.value : null);
      setQuota(quotaResult.status === 'fulfilled' ? quotaResult.value.quota : null);
      setManagementOverview(managementResult.status === 'fulfilled' ? managementResult.value as DepartmentManagementOverviewFE : null);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [open, workspace.uri]);

  useEffect(() => { void load(); }, [load]);

  const TypeIcon = config.type === 'ceo'
    ? UserRound
    : config.type === 'research'
      ? FlaskConical
      : config.type === 'operations'
        ? Radio
        : Hammer;
  const activeProjects = projects.filter(p => p.status === 'active');
  const completedProjects = projects.filter(p => p.status === 'completed');
  const failedProjects = projects.filter(p => p.status === 'failed');
  const blockedProjects = projects.filter((project) => project.pipelineState?.stages?.some((stage) => stage.status === 'blocked'));
  const workspaceBindings = getDepartmentWorkspaceBindings(config, workspace.uri, workspace.name);
  const contextDocumentPaths = getDepartmentContextDocumentPaths(config);
  const workflowBoundSkillCount = config.skills.filter((skill) => skill.workflowRef?.trim()).length;
  const templateCount = config.templateIds?.length ?? 0;
  const boundWorkspaceEntries = workspaceBindings.map((binding) => ({
    binding,
    workspace: allWorkspaces.find((entry) => entry.uri === binding.workspaceUri) ?? {
      uri: binding.workspaceUri,
      name: binding.alias || workspaceNameFromUri(binding.workspaceUri),
    },
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto border-[var(--app-border-soft)] bg-[var(--app-surface)] text-[var(--app-text)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-accent)]">
              <TypeIcon className="h-5 w-5" />
            </span>
            <div>
              <div className="text-lg font-bold text-[var(--app-text)]">{config.name || workspace.name}</div>
              <div className="text-xs font-normal text-[var(--app-text-muted)]">{workspace.uri.split('/').pop()}</div>
            </div>
          </DialogTitle>
          <DialogDescription>
            部门经营指标、风险、项目、配额与日报明细。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--app-text-muted)]" />
          </div>
        ) : (
          <div className="space-y-5 mt-2">
            {/* OKR */}
            {config.okr?.objectives?.[0] && (
              <div className="space-y-2 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
                  <Target className="h-3.5 w-3.5 text-[var(--app-accent)]" /> OKR
                </div>
                <div className="text-sm text-[var(--app-text)]">{config.okr.objectives[0].title}</div>
                {config.okr.objectives[0].keyResults?.map((kr, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-[var(--app-text-soft)]">
                    <span className="text-[var(--app-text-muted)]">KR{i + 1}</span>
                    <span>{kr.description}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Stats summary */}
            <div className="grid grid-cols-4 gap-2">
              <StatBox icon={Activity} label="进行中" value={activeProjects.length} color="text-sky-700 bg-sky-400/10" />
              <StatBox icon={CheckCircle2} label="已完成" value={completedProjects.length} color="text-emerald-700 bg-emerald-400/10" />
              <StatBox icon={XCircle} label="失败" value={failedProjects.length} color="text-red-700 bg-red-400/10" />
              <StatBox icon={AlertTriangle} label="阻塞" value={blockedProjects.length} color="text-amber-700 bg-amber-400/10" />
            </div>

            <div className="space-y-2 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
                <Settings className="h-3.5 w-3.5 text-[var(--app-accent)]" /> 部门配置
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <MetricPill label="类型" value={config.type || 'build'} />
                <MetricPill label="Provider" value={config.provider || 'auto'} />
                <MetricPill label="技能" value={`${config.skills.length}`} />
                <MetricPill label="Workflow Skill" value={`${workflowBoundSkillCount}`} />
                <MetricPill label="模板" value={`${templateCount}`} />
                <MetricPill label="上下文文档" value={`${contextDocumentPaths.length}`} />
              </div>
            </div>

            <div className="space-y-2 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
                <ClipboardList className="h-3.5 w-3.5 text-[var(--app-accent)]" /> 工作区编排
              </div>
              <div className="space-y-2">
                {boundWorkspaceEntries.map(({ binding, workspace: boundWorkspace }) => (
                  <div key={binding.workspaceUri} className="rounded-lg border border-[var(--app-border-soft)] bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-[var(--app-text)]">
                          {binding.alias || boundWorkspace.name}
                        </div>
                        <div className="mt-1 truncate text-[10px] text-[var(--app-text-muted)]">{binding.workspaceUri}</div>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {binding.role === 'primary' ? '主执行' : binding.role === 'execution' ? '执行' : '上下文'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
              {contextDocumentPaths.length > 0 ? (
                <div className="rounded-lg border border-[var(--app-border-soft)] bg-white px-3 py-2">
                  <div className="text-[10px] uppercase tracking-widest text-[var(--app-text-muted)]">Context Docs</div>
                  <div className="mt-2 space-y-1">
                    {contextDocumentPaths.slice(0, 6).map((documentPath) => (
                      <div key={documentPath} className="truncate text-[11px] text-[var(--app-text-soft)]">
                        {documentPath}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {managementOverview && (
              <div className="space-y-2 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
                  <TrendingUp className="h-3.5 w-3.5 text-[var(--app-accent)]" /> 经营指标
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <MetricPill label="Throughput 30d" value={`${managementOverview.throughput30d}`} />
                  <MetricPill label="Workflow Hit" value={`${Math.round(managementOverview.workflowHitRate * 100)}%`} />
                  <MetricPill label="Recent Knowledge" value={`${managementOverview.recentKnowledge}`} />
                  <MetricPill label="Pending Approvals" value={`${managementOverview.pendingApprovals}`} />
                  <MetricPill
                    label="OKR Progress"
                    value={managementOverview.okrProgress !== null ? `${Math.round(managementOverview.okrProgress * 100)}%` : '—'}
                  />
                  <MetricPill label="Risks" value={`${managementOverview.risks.length}`} />
                </div>
              </div>
            )}

            {managementOverview && managementOverview.risks.length > 0 && (
              <div className="space-y-2 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
                  <Siren className="h-3.5 w-3.5 text-red-700" /> 风险
                </div>
                <div className="space-y-2">
                  {managementOverview.risks.slice(0, 4).map((risk, index) => (
                    <div key={`${risk.title}-${index}`} className="rounded-lg border border-[var(--app-border-soft)] bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium text-[var(--app-text)]">{risk.title}</div>
                        <div className={cn(
                          'rounded-full px-2 py-0.5 text-[10px]',
                          risk.level === 'critical' ? 'bg-red-500/10 text-red-700' :
                          risk.level === 'warning' ? 'bg-amber-500/10 text-amber-700' :
                          'bg-[var(--app-raised-2)] text-[var(--app-text-soft)]',
                        )}>
                          {risk.level}
                        </div>
                      </div>
                      {risk.description ? (
                        <div className="mt-1 text-[11px] text-[var(--app-text-soft)]">{risk.description}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Token Quota */}
            {quota && (quota.daily > 0 || quota.monthly > 0) && (
              <div className="space-y-2 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
                  <Ticket className="h-3.5 w-3.5 text-[var(--app-accent)]" /> Token 配额
                </div>
                {quota.daily > 0 && (
                  <QuotaBar label="今日" used={quota.used.daily} limit={quota.daily} />
                )}
                {quota.monthly > 0 && (
                  <QuotaBar label="本月" used={quota.used.monthly} limit={quota.monthly} />
                )}
              </div>
            )}

            {/* Active projects */}
            {activeProjects.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
                  <ClipboardList className="h-3.5 w-3.5 text-[var(--app-accent)]" /> 进行中项目
                </div>
                <div className="space-y-1.5">
                  {activeProjects.map(p => (
                    <ProjectRow
                      key={p.projectId}
                      project={p}
                      onNavigate={() => onNavigateToProject?.(p.projectId)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Blockers */}
            {(failedProjects.length > 0 || blockedProjects.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> 需要关注
                </div>
                <div className="space-y-1.5">
                  {[...failedProjects, ...blockedProjects].map(p => (
                    <ProjectRow
                      key={p.projectId}
                      project={p}
                      onNavigate={() => onNavigateToProject?.(p.projectId)}
                      highlight
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Daily digest summary */}
            {digest && (
              <div className="space-y-2 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
                  <BarChart3 className="h-3.5 w-3.5 text-[var(--app-accent)]" /> 今日日报
                </div>
                <div className="text-sm text-[var(--app-text-soft)]">{digest.summary || '暂无活动'}</div>
              </div>
            )}

            {/* Completed projects (recent 5) */}
            {completedProjects.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--app-text-muted)]">
                  <ListChecks className="h-3.5 w-3.5 text-emerald-700" /> 近期完成
                </div>
                <div className="space-y-1.5">
                  {completedProjects.slice(0, 5).map(p => (
                    <ProjectRow
                      key={p.projectId}
                      project={p}
                      onNavigate={() => onNavigateToProject?.(p.projectId)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 border-t border-[var(--app-border-soft)] pt-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-red-500/20 text-red-700 hover:bg-red-500/10"
                onClick={async () => {
                  if (!confirm(`确定要强制终止 ${config.name} 的工作区进程吗？这将杀死所有相关的语言服务器。`)) return;
                  try {
                    await api.killWorkspace(workspace.uri);
                  } catch { /* best effort */ }
                }}
              >
                <Zap className="h-3.5 w-3.5" />
                强制终止
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-[var(--app-border-soft)]"
                onClick={() => {
                  onOpenChange(false);
                  onOpenSettings?.();
                }}
              >
                <Settings className="h-3.5 w-3.5" />
                部门设置
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Sub-components ---

function StatBox({ icon: Icon, label, value, color }: { icon: typeof Activity; label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-3 text-center">
      <div className={cn('mx-auto flex h-7 w-7 items-center justify-center rounded-lg mb-1.5', color.split(' ')[1])}>
        <Icon className={cn('h-3.5 w-3.5', color.split(' ')[0])} />
      </div>
      <div className="text-lg font-bold text-[var(--app-text)] tabular-nums">{value}</div>
      <div className="text-[10px] text-[var(--app-text-muted)]">{label}</div>
    </div>
  );
}

function QuotaBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min((used / Math.max(limit, 1)) * 100, 100);
  const isDanger = pct >= 100;
  const isWarning = pct >= 80;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--app-text-soft)]">{label}</span>
        <span className={cn('font-mono tabular-nums', isDanger ? 'text-red-700' : isWarning ? 'text-amber-700' : 'text-[var(--app-text-soft)]')}>
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--app-raised-2)]">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            isDanger ? 'bg-red-500/70' : isWarning ? 'bg-amber-500/60' : 'bg-sky-500/60',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--app-border-soft)] bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-[var(--app-text-muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--app-text)]">{value}</div>
    </div>
  );
}

function ProjectRow({ project, onNavigate, highlight }: { project: Project; onNavigate?: () => void; highlight?: boolean }) {
  const stages = project.pipelineState?.stages || [];
  const done = stages.filter((stage) => stage.status === 'completed' || stage.status === 'skipped').length;
  const total = stages.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors hover:bg-[var(--app-raised)]',
        highlight ? 'border-red-500/20 bg-red-500/5' : 'border-[var(--app-border-soft)] bg-white',
      )}
      onClick={onNavigate}
    >
      <div className="flex-1 min-w-0">
        <div className="truncate text-[var(--app-text)]">{project.name}</div>
        {total > 0 && (
          <div className="flex items-center gap-2 mt-1">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--app-raised-2)]">
              <div className="h-full rounded-full bg-sky-500/60" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-[var(--app-text-muted)] tabular-nums">{done}/{total}</span>
          </div>
        )}
        {/* Pipeline DAG (B2) */}
        <PipelineMiniDAG projectId={project.projectId} className="mt-1.5" />
      </div>
      <Badge
        variant="outline"
        className={cn(
          'text-[10px] border-[var(--app-border-soft)]',
          project.status === 'active' ? 'text-sky-700' :
          project.status === 'completed' ? 'text-emerald-700' :
          project.status === 'failed' ? 'text-red-700' : 'text-[var(--app-text-muted)]',
        )}
      >
        {project.status}
      </Badge>
      {onNavigate && <ArrowUpRight className="h-3 w-3 shrink-0 text-[var(--app-text-muted)]" />}
    </div>
  );
}
