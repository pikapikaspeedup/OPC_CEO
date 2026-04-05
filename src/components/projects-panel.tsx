'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/components/locale-provider';
import { formatRelativeTime } from '@/lib/i18n/formatting';
import {
  FolderKanban,
  Clock,
  Workflow,
  Pause,
  CheckCircle2,
  RotateCw,
  AlertTriangle,
  XCircle,
  Plus,
  Pencil,
  Trash2,
  Archive,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  GitBranch,
  ShieldCheck,
  Loader2,
  ArrowLeft,
  Repeat,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ProjectWorkbench from '@/components/project-workbench';
import PipelineGenerateDialog from '@/components/pipeline-generate-dialog';
import SkillBrowser from '@/components/skill-browser';
import TemplateBrowser from '@/components/template-browser';
import QuickTaskInput, { generateTaskName } from '@/components/quick-task-input';
import CEODashboard from '@/components/ceo-dashboard';
import { generateCEOEvents } from '@/lib/ceo-events';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NativeSelect } from '@/components/ui/native-select';
import type {
  AgentRun,
  Project,
  ModelConfig,
  Workspace,
  TemplateSummaryFE,
  ResumeAction,
  DepartmentConfig,
} from '@/lib/types';

interface ProjectsPanelProps {
  projects: Project[];
  agentRuns: AgentRun[];
  workspaces: Workspace[];
  onSelectProject?: (projectId: string) => void;
  onOpenOperations?: () => void;
  onSelectRun?: (runId: string) => void;
  selectedProjectId?: string | null;
  /** Template definitions for resolving stage names */
  templates?: TemplateSummaryFE[];
  /** Available model configurations */
  models?: ModelConfig[];
  /** OPC: Department configurations keyed by workspace URI */
  departments?: Map<string, DepartmentConfig>;
  /** Callback to resume a failed pipeline stage */
  onResume?: (projectId: string, stageId: string, action: ResumeAction, branchIndex?: number) => Promise<void>;
  /** Callback to cancel a run */
  onCancelRun?: (runId: string) => void;
  /** Callback to open a conversation */
  onOpenConversation?: (id: string, title: string) => void;
  onRefresh?: () => void;
  /** Called when user saves a department config via the ⚙️ dialog in PixelOffice */
  onDepartmentSaved?: (uri: string, config: DepartmentConfig) => void;
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const config = {
    active: { color: 'text-sky-400', bg: 'bg-sky-400/10', border: 'border-sky-400/20', icon: RotateCw },
    completed: { color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20', icon: CheckCircle2 },
    failed: { color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20', icon: AlertTriangle },
    cancelled: { color: 'text-slate-300', bg: 'bg-slate-400/10', border: 'border-slate-400/20', icon: XCircle },
    paused: { color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20', icon: Pause },
    archived: { color: 'text-slate-400', bg: 'bg-slate-400/10', border: 'border-slate-400/20', icon: Clock },
    skipped: { color: 'text-slate-400', bg: 'bg-slate-400/10', border: 'border-slate-400/20', icon: SkipForward },
  }[status] || { color: 'text-slate-400', bg: 'bg-slate-400/10', border: 'border-slate-400/20', icon: Clock };

  const Icon = config.icon;
  // Use status title from i18n
  const label = t(`projects.status.${status as any}` as any) || status;

  return (
    <div className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', config.bg, config.color, config.border)}>
      <Icon className={cn("h-3.5 w-3.5", config.color, status === 'active' && 'animate-spin-slow')} />
      <span className={config.color}>{label}</span>
    </div>
  );
}

export default function ProjectsPanel({
  projects,
  agentRuns,
  workspaces,
  onSelectProject,
  onOpenOperations,
  selectedProjectId,
  templates,
  models,
  departments,
  onRefresh,
  onResume,
  onCancelRun,
  onOpenConversation,
  onDepartmentSaved,
}: ProjectsPanelProps) {
  const { t, locale } = useI18n();

  const handleEvaluateRun = async (runId: string) => {
    await api.interveneRun(runId, { action: 'evaluate' });
    onRefresh?.();
  };

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDispatchDialogOpen, setIsDispatchDialogOpen] = useState(false);
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [dispatchingProject, setDispatchingProject] = useState<Project | null>(null);
  const [browseView, setBrowseView] = useState<'projects' | 'templates'>('projects');

  const [formData, setFormData] = useState({
    name: '',
    goal: '',
    workspace: workspaces[0]?.uri || '',
    templateId: '',
  });

  const [dispatchData, setDispatchData] = useState({
    templateId: '',
    prompt: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // CEO command quick-task feedback
  const [ceoToast, setCeoToast] = useState<{ success: boolean; message: string } | null>(null);
  const [ceoSuggestions, setCeoSuggestions] = useState<import('@/lib/api').CEOSuggestion[] | null>(null);
  // Per-project pending CEO suggestions (for needs_decision projects)
  const [pendingSuggestions, setPendingSuggestions] = useState<Record<string, import('@/lib/api').CEOSuggestion[]>>({});

  // Auto-dismiss CEO toast
  useEffect(() => {
    if (!ceoToast) return;
    const timer = setTimeout(() => setCeoToast(null), 5000);
    return () => clearTimeout(timer);
  }, [ceoToast]);

  /**
   * Shared handler for CEO command responses from QuickTaskInput.
   * 
   * Design principle: after CEO creates a task, ALWAYS navigate to the project
   * detail page so the CEO can see the decision process and run status.
   * - create_project → project detail shows running pipeline
   * - needs_decision → project detail shows decision panel with suggestions
   * - report_to_human → toast with guidance (no project created)
   */
  const handleQuickTaskSubmit = useCallback(async ({ goal, workspace, model }: { goal: string; workspace: string; model?: string }) => {
    setCeoSuggestions(null);
    setCeoToast(null);
    try {
      const dept = departments?.get(workspace);
      const routedGoal = dept ? `让${dept.name}${goal}` : goal;
      const result = await api.ceoCommand(routedGoal, model ? { model } : undefined);

      switch (result.action) {
        case 'create_project':
        case 'multi_create':
          // Success — project created and run dispatched → navigate to detail
          setCeoToast({ success: true, message: result.message });
          onRefresh?.();
          if (result.projectId) {
            onSelectProject?.(result.projectId);
          } else if (result.projectIds?.[0]) {
            onSelectProject?.(result.projectIds[0]);
          }
          break;

        case 'needs_decision':
          // Project created but needs CEO decision → navigate to detail with suggestions
          setCeoToast({ success: false, message: result.message });
          // Store suggestions so project detail page can render them
          if (result.projectId && result.suggestions?.length) {
            setPendingSuggestions(prev => ({ ...prev, [result.projectId!]: result.suggestions! }));
          }
          onRefresh?.();
          if (result.projectId) {
            onSelectProject?.(result.projectId);
          }
          break;

        case 'report_to_human':
          // Could not match department — show guidance toast
          setCeoToast({ success: false, message: `${result.message}\n💡 试试指定部门名称，例如："让研发部做..." 或先在上方部门网格中配置一个部门。` });
          break;

        case 'info':
          setCeoToast({ success: true, message: result.message });
          break;

        default:
          setCeoToast({ success: result.success, message: result.message });
          if (result.projectId) {
            onRefresh?.();
          }
          break;
      }
    } catch (err) {
      console.error('CEO command failed:', err);
      setCeoToast({ success: false, message: '指令执行失败，请稍后重试' });
    }
  }, [departments, onRefresh, onSelectProject]);

  // User-visible error/success flash
  const [actionError, setActionError] = useState<string | null>(null);
  const showFlash = useCallback((msg: string, durationMs = 4000) => {
    setActionError(msg);
    const t = setTimeout(() => setActionError(null), durationMs);
    return () => clearTimeout(t);
  }, []);

  // Confirm dialog state (replaces window.confirm)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);

  // Template lint/validate state
  const [lintResult, setLintResult] = useState<{ valid: boolean; format?: string; errors: Array<{ path: string; message: string }>; warnings: Array<{ path: string; message: string }> } | null>(null);
  const [lintLoading, setLintLoading] = useState(false);
  const [convertLoading, setConvertLoading] = useState(false);
  const [convertMessage, setConvertMessage] = useState<string | null>(null);

  const handleLintTemplate = async (templateId: string) => {
    setLintLoading(true);
    setLintResult(null);
    setConvertMessage(null);
    try {
      const result = await api.validateTemplate({ templateId });
      // Map ValidateResponse fields to the display shape
      const errors = [
        ...result.dagErrors.map(m => ({ path: 'DAG', message: m })),
        ...result.contractErrors.map(e => ({ path: e.stageId, message: `${e.field}: ${e.message}` })),
      ];
      const warnings = result.contractWarnings.map(w => ({ path: w.stageId, message: w.message }));
      setLintResult({ valid: result.valid, format: result.format, errors, warnings });
    } catch {
      setLintResult({ valid: false, errors: [{ path: '', message: 'Validation failed' }], warnings: [] });
    } finally {
      setLintLoading(false);
    }
  };

  const handleConvertTemplate = async () => {
    if (!lintResult?.format) return;
    setConvertLoading(true);
    setConvertMessage(null);
    try {
      const direction = lintResult.format === 'pipeline' ? 'pipeline-to-graph' as const : 'graph-to-pipeline' as const;
      await api.convertTemplate({ direction });
      setConvertMessage(`Converted to ${direction === 'pipeline-to-graph' ? 'graphPipeline' : 'pipeline'} format`);
    } catch {
      setConvertMessage('Conversion failed');
    } finally {
      setConvertLoading(false);
    }
  };

  // Sort projects by newest first, separate top-level from sub-projects
  const sortedProjects = useMemo(() => {
    return [...projects]
      .filter(p => !p.parentProjectId) // Only top-level projects
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [projects]);

  // Build lookup of child projects by parent ID
  const childProjectsByParent = useMemo(() => {
    const map = new Map<string, typeof projects>();
    for (const p of projects) {
      if (p.parentProjectId) {
        const existing = map.get(p.parentProjectId) || [];
        existing.push(p);
        map.set(p.parentProjectId, existing);
      }
    }
    return map;
  }, [projects]);

  // In detail mode, resolve the top-level project to display
  const detailProject = useMemo(() => {
    if (!selectedProjectId) return null;
    // Direct match on top-level project
    const direct = projects.find(p => p.projectId === selectedProjectId && !p.parentProjectId);
    if (direct) return direct;
    // Selected a child → show its parent
    const child = projects.find(p => p.projectId === selectedProjectId);
    if (child?.parentProjectId) {
      return projects.find(p => p.projectId === child.parentProjectId) || null;
    }
    return null;
  }, [selectedProjectId, projects]);

  // OPC Phase 3: CEO events (hooks must be at component top level)
  const allStages = useMemo(() =>
    projects.flatMap(p => p.pipelineState?.stages || []),
    [projects],
  );
  const ceoEvents = useMemo(() =>
    generateCEOEvents(projects, allStages),
    [projects, allStages],
  );

  const [deptConfig, setDeptConfig] = useState<DepartmentConfig | null>(null);

  useEffect(() => {
    if (!detailProject?.workspace) { setDeptConfig(null); return; }
    api.getDepartment(detailProject.workspace)
      .then(setDeptConfig)
      .catch(() => setDeptConfig(null));
  }, [detailProject?.workspace]);

  const handleCreate = async () => {
    setIsSubmitting(true);
    try {
      await api.createProject(formData);
      setIsCreateDialogOpen(false);
      onRefresh?.();
    } catch (err) {
      showFlash(err instanceof Error ? err.message : '创建项目失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingProject) return;
    setIsSubmitting(true);
    try {
      await api.updateProject(editingProject.projectId, {
        name: formData.name,
        goal: formData.goal,
      });
      setIsEditDialogOpen(false);
      setEditingProject(null);
      onRefresh?.();
    } catch (err) {
      showFlash(err instanceof Error ? err.message : '更新项目失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setConfirmDialog({
      message: t('projects.deleteConfirm'),
      onConfirm: async () => {
        try {
          await api.deleteProject(id);
          onRefresh?.();
        } catch (err) {
          showFlash(err instanceof Error ? err.message : '删除项目失败');
        }
      },
    });
  };

  const handleArchive = (e: React.MouseEvent, id: string, archived: boolean) => {
    e.stopPropagation();
    if (archived) {
      setConfirmDialog({
        message: t('projects.archiveConfirm'),
        onConfirm: async () => {
          try {
            await api.updateProject(id, { status: 'archived' });
            onRefresh?.();
          } catch (err) {
            showFlash(err instanceof Error ? err.message : '归档项目失败');
          }
        },
      });
    } else {
      void (async () => {
        try {
          await api.updateProject(id, { status: 'active' });
          onRefresh?.();
        } catch (err) {
          showFlash(err instanceof Error ? err.message : '恢复项目失败');
        }
      })();
    }
  };

  const handleDispatch = async () => {
    if (!dispatchingProject) return;
    setIsSubmitting(true);
    try {
      await api.dispatchRun({
        projectId: dispatchingProject.projectId,
        templateId: dispatchData.templateId,
        workspace: dispatchingProject.workspace || workspaces[0]?.uri || '',
        prompt: dispatchData.prompt,
      });
      setIsDispatchDialogOpen(false);
      onRefresh?.();
    } catch (err) {
      showFlash(err instanceof Error ? err.message : '派发流水线失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCreateDialog = () => {
    setFormData({
      name: '',
      goal: '',
      workspace: workspaces[0]?.uri || '',
      templateId: '',
    });
    setIsCreateDialogOpen(true);
  };

  const openEditDialog = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setEditingProject(project);
    setFormData({
      name: project.name,
      goal: project.goal,
      workspace: project.workspace || workspaces[0]?.uri || '',
      templateId: project.templateId || '',
    });
    setIsEditDialogOpen(true);
  };

  const openDispatchDialog = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setDispatchingProject(project);
    setDispatchData({
      templateId: project.templateId || templates?.[0]?.id || '',
      prompt: project.goal || '',
    });
    setIsDispatchDialogOpen(true);
  };

  return (
    <>
      {sortedProjects.length === 0 ? (
        <div className="space-y-6">
          {/* Quick task + CEO Dashboard even when no projects */}
          {workspaces.length > 0 && (
            <QuickTaskInput
              workspaces={workspaces}
              departments={departments}
              models={models}
              onSubmit={handleQuickTaskSubmit}
            />
          )}

          {/* CEO response toast */}
          {ceoToast && (
            <div className={cn(
              'rounded-xl border px-4 py-3 text-sm whitespace-pre-line',
              ceoToast.success
                ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                : 'border-amber-500/20 bg-amber-500/5 text-amber-300',
            )}>
              {ceoToast.message}
            </div>
          )}

          <CEODashboard
            workspaces={workspaces}
            projects={projects}
            departments={departments || new Map()}
            onSelectDepartment={() => { }}
            onDepartmentSaved={onDepartmentSaved}
            onNavigateToProject={(id) => onSelectProject?.(id)}
            onOpenScheduler={onOpenOperations}
          />

          <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.02] py-12 text-center">
            <FolderKanban className="mb-4 h-12 w-12 text-white/20" />
            <h3 className="text-lg font-medium text-white/80">{t('projects.noProjects')}</h3>
            <p className="mt-2 text-sm text-[var(--app-text-soft)]">
              {t('projects.createPrompt')}
            </p>
            <Button onClick={openCreateDialog} className="mt-6 gap-2 rounded-full">
              <Plus className="h-4 w-4" />
              {t('projects.createProject')}
            </Button>
            <Button variant="ghost" onClick={() => setIsGenerateDialogOpen(true)} className="mt-2 gap-2 rounded-full">
              <Sparkles className="h-4 w-4 text-purple-400" />
              {t('generate.title')}
            </Button>
          </div>
        </div>
      ) : detailProject ? (
        /* ── Detail mode: only the selected project ── */
        (() => {
          const project = detailProject;
          const children = childProjectsByParent.get(project.projectId) || [];
          const activeChildId = children.find(c => c.projectId === selectedProjectId)?.projectId || null;
          const viewProject = activeChildId
            ? children.find(c => c.projectId === activeChildId) || project
            : project;

          return (
            <div className="space-y-4">
              {/* Back button + action bar */}
              <div className="flex items-center justify-between">
                <button
                  className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
                  onClick={() => (onSelectProject as (id: string | null) => void)?.(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>{t('projects.title')}</span>
                </button>
                <div className="flex items-center gap-1">
                  {!project.pipelineState && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-sky-400 hover:bg-sky-400/10 hover:text-sky-300"
                      onClick={(e) => openDispatchDialog(e, project)}
                    >
                      <Play className="h-3.5 w-3.5" />
                      {t('projects.dispatchPipeline')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-white/60 hover:bg-white/10 hover:text-white"
                    onClick={(e) => openEditDialog(e, project)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "gap-1.5",
                      project.status === 'archived' ? "text-amber-400 hover:bg-amber-400/10" : "text-slate-400 hover:bg-slate-400/10"
                    )}
                    onClick={(e) => handleArchive(e, project.projectId, project.status !== 'archived')}
                  >
                    {project.status === 'archived' ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-red-400 hover:bg-red-400/10 hover:text-red-300"
                    onClick={(e) => handleDelete(e, project.projectId)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Project header */}
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] border border-white/10 text-white/80 shadow-inner">
                  <FolderKanban className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold text-white">{project.name}</h2>
                    <StatusBadge status={project.status} />
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-sm text-[var(--app-text-muted)]">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{formatRelativeTime(project.createdAt, locale)}</span>
                    </div>
                    {project.templateId && (
                      <div className="flex items-center gap-1">
                        <Workflow className="h-3.5 w-3.5" />
                        <span>{project.templateId}</span>
                      </div>
                    )}
                  </div>
                  {project.goal && (
                    <p className="mt-2 text-[15px] leading-relaxed text-[var(--app-text-soft)] max-w-3xl">
                      {project.goal}
                    </p>
                  )}
                </div>
              </div>

              {/* Department info (OPC V7) */}
              {deptConfig && (
                <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📦</span>
                    <span className="text-sm font-semibold text-white/80">{deptConfig.name}</span>
                    <span className="text-[10px] rounded-full bg-white/8 px-2 py-0.5 text-white/40 uppercase">
                      {deptConfig.type}
                    </span>
                    {deptConfig.skills.length > 0 && (
                      <span className="text-[10px] text-white/30">{deptConfig.skills.length} skills</span>
                    )}
                    {deptConfig.okr && (
                      <span className="text-[10px] text-white/30">{deptConfig.okr.period} OKR</span>
                    )}
                  </div>
                  {deptConfig.okr && deptConfig.okr.objectives.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-white/40">🎯 OKR</div>
                      {deptConfig.okr.objectives.map((obj, i) => (
                        <div key={i} className="space-y-1">
                          <div className="text-[12px] text-white/60">{obj.title}</div>
                          {obj.keyResults.map((kr, j) => {
                            const pct = kr.target > 0 ? Math.round((kr.current / kr.target) * 100) : 0;
                            return (
                              <div key={j} className="flex items-center gap-2 ml-2">
                                <span className="text-[10px] text-white/40 min-w-[100px] truncate">{kr.description}</span>
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/8">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 transition-all"
                                    style={{ width: `${Math.min(pct, 100)}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-white/30 tabular-nums">{pct}%</span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                  {deptConfig.skills.length > 0 && (
                    <SkillBrowser skills={deptConfig.skills} />
                  )}
                </div>
              )}

              {/* ── CEO Decision Card (Phase 6) ── */}
              {viewProject.ceoDecision && (
                <div className={cn(
                  'rounded-xl border p-4 space-y-3',
                  viewProject.ceoDecision.resolved
                    ? 'border-white/8 bg-white/[0.02]'
                    : 'border-amber-500/20 bg-amber-500/5',
                )}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">{viewProject.ceoDecision.resolved ? '🤖' : '⚠️'}</span>
                    <span className="text-sm font-semibold text-white/80">
                      {viewProject.ceoDecision.resolved ? 'AI 决策记录' : '等待 CEO 审批'}
                    </span>
                    <span className="text-[10px] rounded-full bg-white/8 px-2 py-0.5 text-white/40">
                      {viewProject.ceoDecision.action}
                    </span>
                    {viewProject.ceoDecision.resolved && (
                      <span className="text-[10px] text-emerald-400/60 ml-auto">✓ 已执行</span>
                    )}
                    {!viewProject.ceoDecision.resolved && (
                      <span className="text-[10px] text-amber-400/70 ml-auto animate-pulse">待审批</span>
                    )}
                  </div>

                  {/* Original command */}
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
                    <div className="text-[10px] text-white/30 mb-1">CEO 指令</div>
                    <div className="text-sm text-white/70 italic">&ldquo;{viewProject.ceoDecision.command}&rdquo;</div>
                  </div>

                  {/* AI reasoning */}
                  <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
                    <div className="text-[10px] text-white/30 mb-1">🧠 AI 决策依据</div>
                    <div className="text-[12px] text-white/60 leading-relaxed">{viewProject.ceoDecision.reasoning}</div>
                  </div>

                  {/* Decision metadata */}
                  <div className="flex flex-wrap gap-3 text-[11px] text-white/40">
                    {viewProject.ceoDecision.departmentName && (
                      <div className="flex items-center gap-1">
                        <span className="text-white/25">部门:</span>
                        <span className="text-white/60">{viewProject.ceoDecision.departmentName}</span>
                      </div>
                    )}
                    {viewProject.ceoDecision.templateId && (
                      <div className="flex items-center gap-1">
                        <span className="text-white/25">模板:</span>
                        <span className="text-sky-400/60">{viewProject.ceoDecision.templateId}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <span className="text-white/25">决策时间:</span>
                      <span className="text-white/50">{new Date(viewProject.ceoDecision.decidedAt).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Interactive suggestions (unresolved only) */}
                  {!viewProject.ceoDecision.resolved && viewProject.ceoDecision.suggestions?.length && (
                    <div className="space-y-2 pt-1">
                      <div className="text-xs font-medium text-amber-300/80 mb-1">请选择操作：</div>
                      {viewProject.ceoDecision.suggestions.map((s, i) => (
                        <button
                          key={i}
                          className="flex w-full items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-left hover:bg-white/[0.06] hover:border-amber-500/30 transition-all group"
                          onClick={async () => {
                            if (s.type === 'suggest_add_template' && s.payload?.workspace) {
                              try {
                                showFlash('⏳ 正在添加模板并派发...');
                                const ws = s.payload.workspace;
                                const deptResp = await api.getDepartment(ws).catch(() => null);
                                if (deptResp && s.payload.templateId) {
                                  const existingIds = deptResp.templateIds || [];
                                  if (!existingIds.includes(s.payload.templateId)) {
                                    await api.updateDepartment(ws, {
                                      ...deptResp,
                                      templateIds: [...existingIds, s.payload.templateId],
                                    });
                                  }
                                }
                                if (s.payload.projectId && s.payload.goal && s.payload.templateId) {
                                  await api.dispatchRun({
                                    workspace: ws,
                                    templateId: s.payload.templateId,
                                    projectId: s.payload.projectId,
                                    prompt: s.payload.goal,
                                  });
                                }
                                await api.updateProject(viewProject.projectId, {
                                  ceoDecision: { ...viewProject.ceoDecision!, resolved: true },
                                });
                                onRefresh?.();
                                showFlash('✅ 模板已添加，任务已派发');
                              } catch (e) {
                                showFlash(e instanceof Error ? e.message : '操作失败');
                              }
                            } else if (s.type === 'auto_generate_and_dispatch') {
                              try {
                                showFlash('⏳ AI 正在生成模板...');
                                const genResult = await api.generatePipeline({
                                  goal: s.payload?.goal || viewProject.goal || viewProject.name,
                                });
                                if (!genResult?.draftId) {
                                  showFlash('模板生成失败，请手动创建');
                                  return;
                                }
                                showFlash('⏳ 正在确认并保存模板...');
                                const confirmed = await api.confirmDraft(genResult.draftId);
                                if (!confirmed?.templateId) {
                                  showFlash('模板保存失败，请手动确认');
                                  return;
                                }
                                const ws = s.payload?.workspace || viewProject.workspace;
                                if (ws) {
                                  const deptResp = await api.getDepartment(ws).catch(() => null);
                                  if (deptResp) {
                                    await api.updateDepartment(ws, {
                                      ...deptResp,
                                      templateIds: [...(deptResp.templateIds || []), confirmed.templateId],
                                    });
                                  }
                                }
                                showFlash('⏳ 正在派发任务...');
                                await api.dispatchRun({
                                  projectId: viewProject.projectId,
                                  templateId: confirmed.templateId,
                                  workspace: ws || workspaces[0]?.uri || '',
                                  prompt: viewProject.goal || '',
                                });
                                await api.updateProject(viewProject.projectId, {
                                  ceoDecision: { ...viewProject.ceoDecision!, resolved: true },
                                });
                                onRefresh?.();
                                showFlash('✅ 模板已生成并开始执行');
                              } catch (e) {
                                showFlash(e instanceof Error ? e.message : 'AI 生成失败');
                              }
                            } else if (s.type === 'create_template') {
                              setIsGenerateDialogOpen(true);
                            }
                          }}
                        >
                          <span className="mt-0.5 text-white/30 group-hover:text-amber-400 transition-colors">→</span>
                          <div className="flex-1">
                            <span className="text-sm font-medium text-white/80 group-hover:text-white transition-colors">{s.label}</span>
                            <p className="text-[11px] text-white/40 mt-0.5">{s.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Branch tabs (if has children) */}
              {children.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <button
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                      !activeChildId
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.1)]"
                        : "bg-white/[0.03] text-white/40 border border-white/6 hover:text-white/60 hover:border-white/12"
                    )}
                    onClick={() => onSelectProject?.(project.projectId)}
                  >
                    <FolderKanban className="h-3 w-3" />
                    Overview
                  </button>
                  {children.map(child => {
                    const cStages = child.pipelineState?.stages;
                    const cDone = cStages?.filter(s => s.status === 'completed' || s.status === 'skipped').length ?? 0;
                    const cTotal = cStages?.length ?? 0;
                    const isActive = activeChildId === child.projectId;
                    return (
                      <button
                        key={child.projectId}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                          isActive
                            ? "bg-violet-500/15 text-violet-300 border border-violet-500/30 shadow-[0_0_8px_rgba(139,92,246,0.1)]"
                            : "bg-white/[0.03] text-white/40 border border-white/6 hover:text-white/60 hover:border-white/12"
                        )}
                        onClick={() => onSelectProject?.(child.projectId)}
                      >
                        <GitBranch className="h-3 w-3" />
                        <span className="truncate max-w-[140px]">{child.name}</span>
                        {cTotal > 0 && (
                          <span className={cn(
                            "text-[10px] tabular-nums",
                            cDone === cTotal ? "text-emerald-400/60" : "text-white/25"
                          )}>
                            {cDone}/{cTotal}
                          </span>
                        )}
                        <span className={cn(
                          "h-2 w-2 rounded-full shrink-0",
                          child.status === 'completed' ? 'bg-emerald-400' :
                            child.status === 'active' ? 'bg-sky-400 animate-pulse' :
                              child.status === 'failed' ? 'bg-red-400' :
                                child.status === 'paused' ? 'bg-amber-400' :
                                  'bg-slate-400'
                        )} title={child.status} />
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Workbench content */}
              {viewProject.pipelineState ? (
                (() => {
                  const templateId = viewProject.pipelineState?.templateId || viewProject.templateId || '';
                  const template = templates?.find(t => t.id === templateId);
                  const templateGroups = template?.groups || {};

                  return (
                    <ProjectWorkbench
                      project={viewProject}
                      agentRuns={agentRuns}
                      templateGroups={templateGroups}
                      models={models || []}
                      onResume={onResume || (async () => { })}
                      onCancelRun={onCancelRun || (() => { })}
                      onOpenConversation={onOpenConversation}
                      onEvaluateRun={handleEvaluateRun}
                      onNavigateToProject={onSelectProject}
                    />
                  );
                })()
              ) : (
                /* ── No pipeline yet: show Decision Panel ── */
                (() => {
                  const projectSuggestions = pendingSuggestions[viewProject.projectId]
                    || (viewProject.ceoDecision && !viewProject.ceoDecision.resolved
                      ? viewProject.ceoDecision.suggestions?.map(s => ({ ...s, payload: s.payload || {} }))
                      : undefined);
                  const hasNeedsDecision = !!projectSuggestions?.length;

                  return (
                    <div className="space-y-4">
                      {/* Project status */}
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="h-8 w-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                            <span className="text-lg">📋</span>
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-white/90">
                              {hasNeedsDecision ? '需要您的决策' : '待派发'}
                            </h3>
                            <p className="text-xs text-white/40">
                              {hasNeedsDecision
                                ? '系统未找到合适的执行模板，请选择以下操作之一'
                                : '项目已创建，选择模板后可立即开始执行'}
                            </p>
                          </div>
                        </div>

                        {/* Task info */}
                        <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3 mb-3">
                          <div className="text-xs text-white/40 mb-1">任务目标</div>
                          <div className="text-sm text-white/80">{viewProject.goal || viewProject.name}</div>
                          {viewProject.workspace && (
                            <div className="flex items-center gap-2 mt-2">
                              <span className="text-xs text-white/30">工作区:</span>
                              <span className="text-xs text-white/50">{viewProject.workspace.split('/').pop()}</span>
                            </div>
                          )}
                        </div>

                        {/* CEO suggestions (needs_decision) */}
                        {hasNeedsDecision && (
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-amber-300/80 mb-2">可选操作：</div>
                            {projectSuggestions.map((s, i) => (
                              <button
                                key={i}
                                className="flex w-full items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-left hover:bg-white/[0.06] hover:border-white/12 transition-all group"
                                onClick={async () => {
                                  if (s.type === 'reassign_department' && s.payload?.workspace) {
                                    try {
                                      await api.dispatchRun({
                                        workspace: s.payload.workspace,
                                        groupId: s.payload.groupId || '',
                                        projectId: viewProject.projectId,
                                        prompt: viewProject.goal,
                                      });
                                      setPendingSuggestions(prev => {
                                        const next = { ...prev };
                                        delete next[viewProject.projectId];
                                        return next;
                                      });
                                      // Mark CEO decision resolved
                                      if (viewProject.ceoDecision) {
                                        api.updateProject(viewProject.projectId, {
                                          ceoDecision: { ...viewProject.ceoDecision, resolved: true },
                                        }).catch(() => {});
                                      }
                                      onRefresh?.();
                                    } catch (e) {
                                      showFlash(e instanceof Error ? e.message : '转派失败');
                                    }
                                  } else if (s.type === 'auto_generate_and_dispatch') {
                                    // AI auto-generate template → associate to dept → dispatch
                                    try {
                                      showFlash('⏳ AI 正在生成模板...');
                                      const genResult = await api.generatePipeline({
                                        goal: s.payload?.goal || viewProject.goal || viewProject.name,
                                      });
                                      if (!genResult?.draftId) {
                                        showFlash('模板生成失败，请手动创建');
                                        return;
                                      }
                                      showFlash('⏳ 正在确认并保存模板...');
                                      const confirmed = await api.confirmDraft(genResult.draftId);
                                      if (!confirmed?.templateId) {
                                        showFlash('模板保存失败，请手动确认');
                                        return;
                                      }
                                      // Associate template to department
                                      const ws = s.payload?.workspace || viewProject.workspace;
                                      if (ws) {
                                        const dept = departments?.get(ws);
                                        if (dept) {
                                          await api.updateDepartment(ws, {
                                            ...dept,
                                            templateIds: [...(dept.templateIds || []), confirmed.templateId],
                                          });
                                        }
                                      }
                                      showFlash('⏳ 正在派发任务...');
                                      await api.dispatchRun({
                                        projectId: viewProject.projectId,
                                        templateId: confirmed.templateId,
                                        workspace: ws || workspaces[0]?.uri || '',
                                        prompt: viewProject.goal || '',
                                      });
                                      setPendingSuggestions(prev => {
                                        const next = { ...prev };
                                        delete next[viewProject.projectId];
                                        return next;
                                      });
                                      // Mark CEO decision resolved
                                      if (viewProject.ceoDecision) {
                                        await api.updateProject(viewProject.projectId, {
                                          ceoDecision: { ...viewProject.ceoDecision, resolved: true },
                                        });
                                      }
                                      onRefresh?.();
                                      showFlash('✅ 模板已生成并开始执行');
                                    } catch (e) {
                                      showFlash(e instanceof Error ? e.message : 'AI 生成失败，请手动创建');
                                    }
                                  } else if (s.type === 'create_template') {
                                    setIsGenerateDialogOpen(true);
                                  } else if (s.type === 'use_template') {
                                    showFlash('请在下方模板选择器中选择模板，然后点击派发');
                                  }
                                }}
                              >
                                <span className="mt-0.5 text-white/30 group-hover:text-sky-400 transition-colors">→</span>
                                <div className="flex-1">
                                  <span className="text-sm font-medium text-white/80 group-hover:text-white transition-colors">{s.label}</span>
                                  <p className="text-[11px] text-white/40 mt-0.5">{s.description}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Manual dispatch panel */}
                      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-5">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-3">手动选择模板派发</h4>
                        <div className="flex gap-3">
                          <NativeSelect
                            value={dispatchData.templateId}
                            onChange={(e) => setDispatchData(prev => ({ ...prev, templateId: e.target.value }))}
                            className="flex-1"
                          >
                            <option value="">选择执行模板...</option>
                            {templates?.map(t => (
                              <option key={t.id} value={t.id}>{t.title || t.id}</option>
                            ))}
                          </NativeSelect>
                          <Button
                            disabled={!dispatchData.templateId || isSubmitting}
                            onClick={async () => {
                              setIsSubmitting(true);
                              try {
                                await api.dispatchRun({
                                  projectId: viewProject.projectId,
                                  templateId: dispatchData.templateId,
                                  workspace: viewProject.workspace || workspaces[0]?.uri || '',
                                  prompt: viewProject.goal || '',
                                });
                                setPendingSuggestions(prev => {
                                  const next = { ...prev };
                                  delete next[viewProject.projectId];
                                  return next;
                                });
                                onRefresh?.();
                              } catch (e) {
                                showFlash(e instanceof Error ? e.message : '派发失败');
                              } finally {
                                setIsSubmitting(false);
                              }
                            }}
                            className="gap-2 rounded-full"
                          >
                            <Play className="h-3.5 w-3.5" />
                            派发
                          </Button>
                        </div>
                        <p className="text-[11px] text-white/30 mt-2">
                          或者 <button onClick={() => setIsGenerateDialogOpen(true)} className="text-sky-400 hover:underline">用 AI 生成新模板</button>
                        </p>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          );
        })()
      ) : (
        /* ── Browse mode: project card grid ── */
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-white">{t('projects.title')}</h2>
              {/* View toggle: Projects vs Templates */}
              <div className="flex items-center rounded-full border border-white/8 bg-white/[0.02] p-0.5 ml-3">
                <button
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    browseView === 'projects' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60',
                  )}
                  onClick={() => setBrowseView('projects')}
                >
                  <FolderKanban className="h-3 w-3" />
                  项目
                </button>
                <button
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    browseView === 'templates' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60',
                  )}
                  onClick={() => setBrowseView('templates')}
                >
                  <Layers className="h-3 w-3" />
                  模板工坊
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setIsGenerateDialogOpen(true)} className="gap-2 rounded-full">
                <Sparkles className="h-4 w-4 text-purple-400" />
                {t('generate.title')}
              </Button>
              <Button onClick={openCreateDialog} className="gap-2 rounded-full">
                <Plus className="h-4 w-4" />
                {t('projects.createProject')}
              </Button>
            </div>
          </div>

          {/* Template Browser view */}
          {browseView === 'templates' ? (
            <TemplateBrowser
              templates={templates || []}
              onGenerate={() => setIsGenerateDialogOpen(true)}
              onRefresh={onRefresh}
              onSelectForDispatch={(templateId) => {
                // Switch to projects view and open create dialog pre-filled with this template
                setBrowseView('projects');
                setFormData(prev => ({ ...prev, templateId }));
                setIsCreateDialogOpen(true);
              }}
            />
          ) : (
            <>

              {/* Quick task input (V8) */}
              {workspaces.length > 0 && (
                <QuickTaskInput
                  workspaces={workspaces}
                  departments={departments}
                  models={models}
                  onSubmit={handleQuickTaskSubmit}
                />
              )}

              {/* CEO response toast */}
              {ceoToast && (
                <div className={cn(
                  'rounded-xl border px-4 py-3 text-sm whitespace-pre-line',
                  ceoToast.success
                    ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                    : 'border-amber-500/20 bg-amber-500/5 text-amber-300',
                )}>
                  {ceoToast.message}
                </div>
              )}

              {/* CEO Dashboard (V9) — pinned at top */}
              <CEODashboard
                workspaces={workspaces}
                projects={projects}
                departments={departments || new Map()}
                onSelectDepartment={() => { }}
                onDepartmentSaved={onDepartmentSaved}
                onNavigateToProject={(id) => onSelectProject?.(id)}
                onOpenScheduler={onOpenOperations}
              />

            </>
          )}
        </div>
      )}

      {/* Shared Dialogs */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('projects.createProject')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">{t('projects.projectName')}</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. My Website Redesign"
                className="bg-white/5"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">{t('projects.projectGoal')}</label>
              <Textarea
                value={formData.goal}
                onChange={(e) => setFormData({ ...formData, goal: e.target.value })}
                placeholder="What are we building?"
                className="bg-white/5 min-h-[100px]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">{t('projects.workspace')}</label>
              <NativeSelect
                value={formData.workspace || ''}
                onChange={(e) => setFormData({ ...formData, workspace: e.target.value })}
                className="bg-white/5"
              >
                {workspaces.map((w) => (
                  <option key={w.uri} value={w.uri}>{w.name}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">{t('projects.selectTemplate')} (Optional)</label>
              <NativeSelect
                value={formData.templateId || 'none'}
                onChange={(e) => setFormData({ ...formData, templateId: e.target.value === 'none' ? '' : e.target.value })}
                className="bg-white/5"
              >
                <option value="none">No template</option>
                {templates?.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleCreate} disabled={isSubmitting || !formData.name || !formData.goal || !formData.workspace}>
              {isSubmitting ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('projects.editProject')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">{t('projects.projectName')}</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-white/5"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">{t('projects.projectGoal')}</label>
              <Textarea
                value={formData.goal}
                onChange={(e) => setFormData({ ...formData, goal: e.target.value })}
                className="bg-white/5 min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsEditDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleUpdate} disabled={isSubmitting || !formData.name || !formData.goal}>
              {isSubmitting ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDispatchDialogOpen} onOpenChange={(open) => { setIsDispatchDialogOpen(open); if (!open) { setLintResult(null); } }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('projects.dispatchPipeline')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">{t('projects.selectTemplate')}</label>
              <div className="flex gap-2">
                <NativeSelect
                  value={dispatchData.templateId || ''}
                  onChange={(e) => { if (e.target.value) { setDispatchData({ ...dispatchData, templateId: e.target.value }); setLintResult(null); } }}
                  className="flex-1 bg-white/5"
                >
                  <option value="" disabled>Select template</option>
                  {templates?.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </NativeSelect>
                {dispatchData.templateId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-10 text-xs gap-1.5"
                    disabled={lintLoading}
                    onClick={() => handleLintTemplate(dispatchData.templateId)}
                  >
                    {lintLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                    Validate
                  </Button>
                )}
              </div>
              {lintResult && (
                <div className="space-y-1 mt-2">
                  {lintResult.errors.length === 0 && lintResult.warnings.length === 0 ? (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Template is valid
                      {lintResult.format && (
                        <span className="text-[10px] text-white/40 font-mono ml-1">({lintResult.format})</span>
                      )}
                    </div>
                  ) : (
                    <>
                      {lintResult.errors.map((e, i) => (
                        <div key={`err-${i}`} className="text-xs text-red-400 flex items-start gap-1.5">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          <span>{e.path ? `${e.path}: ` : ''}{e.message}</span>
                        </div>
                      ))}
                      {lintResult.warnings.map((w, i) => (
                        <div key={`warn-${i}`} className="text-xs text-amber-400 flex items-start gap-1.5">
                          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                          <span>{w.path ? `${w.path}: ` : ''}{w.message}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
              {/* Convert format button */}
              {lintResult?.format && lintResult.valid && (
                <div className="flex items-center gap-2 mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] gap-1"
                    disabled={convertLoading}
                    onClick={handleConvertTemplate}
                  >
                    {convertLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Repeat className="h-3 w-3" />}
                    Convert to {lintResult.format === 'pipeline' ? 'graphPipeline' : 'pipeline'}
                  </Button>
                  {convertMessage && (
                    <span className="text-[10px] text-white/40">{convertMessage}</span>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">{t('projects.pipelineGoal')}</label>
              <Textarea
                value={dispatchData.prompt}
                onChange={(e) => setDispatchData({ ...dispatchData, prompt: e.target.value })}
                placeholder="What should this pipeline achieve?"
                className="bg-white/5 min-h-[120px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDispatchDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleDispatch} disabled={isSubmitting || !dispatchData.templateId || !dispatchData.prompt}>
              {isSubmitting ? t('common.loading') : t('projects.startPipeline')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PipelineGenerateDialog
        open={isGenerateDialogOpen}
        onOpenChange={setIsGenerateDialogOpen}
        templates={templates}
        onConfirmed={() => onRefresh?.()}
      />

      {/* Error flash banner */}
      {actionError && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-red-400/30 bg-red-500/15 px-5 py-3 text-sm text-red-200 shadow-lg backdrop-blur">
          {actionError}
        </div>
      )}

      {/* Confirm dialog (replaces window.confirm) */}
      <Dialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('common.confirm' as any) || '确认'}</DialogTitle>
          </DialogHeader>
          <p className="py-4 text-sm text-[var(--app-text-soft)]">{confirmDialog?.message}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDialog(null)}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}
            >
              {t('common.confirm' as any) || '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
