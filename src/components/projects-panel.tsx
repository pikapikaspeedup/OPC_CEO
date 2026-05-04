'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import DepartmentSetupDialog from '@/components/department-setup-dialog';
import LocalFolderImportDialog from '@/components/local-folder-import-dialog';
import { useI18n } from '@/components/locale-provider';
import { formatRelativeTime } from '@/lib/i18n/formatting';
import { isTauriDesktop, selectLocalFolder } from '@/lib/desktop-folder-picker';
import {
  getDepartmentBoundWorkspaceUris,
  getDepartmentContextDocumentPaths,
  getDepartmentGroupKey,
  getDepartmentWorkspaceBindings,
  workspaceNameFromUri,
} from '@/lib/department-config';
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
  Package,
  Building2,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
  Activity,
  Link2,
  ArrowRight,
  ListChecks,
  Star,
  MoreHorizontal,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import ProjectWorkbench from '@/components/project-workbench';
import PipelineGenerateDialog from '@/components/pipeline-generate-dialog';
import SkillBrowser from '@/components/skill-browser';

import { generateCEOEvents } from '@/lib/ceo-events';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { NativeSelect } from '@/components/ui/native-select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  WorkspaceBadge,
  WorkspaceEmptyBlock,
  WorkspaceIconFrame,
  WorkspaceSectionHeader,
  WorkspaceStatusDot,
  WorkspaceSurface,
  workspaceFieldClassName,
  workspaceOutlineActionClassName,
} from '@/components/ui/workspace-primitives';
import type {
  AgentRun,
  Project,
  ModelConfig,
  SystemImprovementProposalFE,
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
  onSelectRun?: (runId: string, projectId?: string) => void;
  selectedProjectId?: string | null;
  selectedRunId?: string | null;
  /** Template definitions for resolving stage names */
  templates?: TemplateSummaryFE[];
  /** Available model configurations */
  models?: ModelConfig[];
  /** OPC: Department configurations keyed by workspace URI */
  departments?: Map<string, DepartmentConfig>;
  /** Optional controlled search used by the Projects page header */
  projectSearchQuery?: string;
  onProjectSearchQueryChange?: (query: string) => void;
  createProjectRequestToken?: number;
  onOpenDepartmentSettings?: () => void;
  /** Callback to resume a failed pipeline stage */
  onResume?: (projectId: string, stageId: string, action: ResumeAction, branchIndex?: number) => Promise<void>;
  /** Callback to cancel a run */
  onCancelRun?: (runId: string) => void;
  /** Callback to open a conversation */
  onOpenConversation?: (id: string, title: string) => void;
  onOpenImprovementProposal?: (proposalId: string | null) => void;
  refreshSignal?: number;
  onRefresh?: () => void;
  /** Called when user saves a department config via the ⚙️ dialog in PixelOffice */
  onDepartmentSaved?: (uri: string, config: DepartmentConfig) => void;
}

function extractSystemImprovementProposalIdFromGoal(goal: string | undefined): string | null {
  if (!goal) return null;
  const match = goal.match(/(?:^|\n)Proposal ID:\s*([^\n]+)/i);
  return match?.[1]?.trim() || null;
}

function extractSystemImprovementProposalIdFromRuns(runs: AgentRun[]): string | null {
  for (const run of runs) {
    const constraint = run.taskEnvelope?.constraints?.find((item) => item.startsWith('proposalId='));
    if (constraint) {
      return constraint.slice('proposalId='.length).trim() || null;
    }
  }
  return null;
}

function formatImprovementRisk(risk: SystemImprovementProposalFE['risk']): string {
  switch (risk) {
    case 'critical':
      return '关键风险';
    case 'high':
      return '高风险';
    case 'medium':
      return '中风险';
    case 'low':
      return '低风险';
    default:
      return '待评估';
  }
}

function formatImprovementStatus(status: SystemImprovementProposalFE['status']): string {
  switch (status) {
    case 'approval-required':
      return '待审批';
    case 'approved':
      return '已批准';
    case 'in-progress':
      return '进行中';
    case 'testing':
      return '测试中';
    case 'ready-to-merge':
      return '待合并';
    case 'published':
      return '已发布';
    case 'observing':
      return '观察中';
    case 'rejected':
      return '已拒绝';
    case 'rolled-back':
      return '已回滚';
    case 'needs-evidence':
      return '待补证据';
    case 'draft':
    default:
      return '草稿';
  }
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const config = {
    active: { color: 'text-sky-400', bg: 'bg-sky-400/10', border: 'border-sky-400/20', icon: RotateCw },
    completed: { color: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20', icon: CheckCircle2 },
    failed: { color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/20', icon: AlertTriangle },
    cancelled: { color: 'text-[var(--app-text-muted)]', bg: 'bg-[var(--app-raised)]', border: 'border-[var(--app-border-soft)]', icon: XCircle },
    paused: { color: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20', icon: Pause },
    archived: { color: 'text-[var(--app-text-muted)]', bg: 'bg-[var(--app-raised)]', border: 'border-[var(--app-border-soft)]', icon: Clock },
    skipped: { color: 'text-[var(--app-text-muted)]', bg: 'bg-[var(--app-raised)]', border: 'border-[var(--app-border-soft)]', icon: SkipForward },
  }[status] || { color: 'text-[var(--app-text-muted)]', bg: 'bg-[var(--app-raised)]', border: 'border-[var(--app-border-soft)]', icon: Clock };

  const Icon = config.icon;
  // Use status title from i18n
  const label = t(`projects.status.${status}`) || status;

  return (
    <div className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', config.bg, config.color, config.border)}>
      <Icon className={cn("h-3.5 w-3.5", config.color, status === 'active' && 'animate-spin-slow')} />
      <span className={config.color}>{label}</span>
    </div>
  );
}

type WorkspaceTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

type ProjectFilterValue = 'all' | 'active' | 'attention' | 'completed';
const PROJECT_FILTER_OPTIONS: Array<{ value: ProjectFilterValue; label: string }> = [
  { value: 'all', label: '全部项目' },
  { value: 'active', label: '进行中' },
  { value: 'attention', label: '关注项' },
  { value: 'completed', label: '历史项目' },
];
const PROJECT_SURFACE_CLASS = 'rounded-[10px] border-[#dfe5ee] bg-white shadow-[0_8px_22px_rgba(28,44,73,0.05)]';
const PROJECT_INSET_CARD_CLASS = 'rounded-[10px] border border-[#dfe5ee] bg-white';
const PROJECT_NAME_NOISE_RE = /(^test$|^tmp$|^temp$|^demo$|^python$|^测试$|auto[- ]?trigger|auto[- ]?test|final auto)/i;

function isClosedProjectStatus(status: string) {
  return ['completed', 'archived', 'cancelled'].includes(status);
}

function isActiveProjectStatus(status: string) {
  return status === 'active';
}

function isNoisyProjectName(name: string | undefined) {
  const value = (name || '').trim();
  if (!value) return true;
  if (PROJECT_NAME_NOISE_RE.test(value)) return true;
  if (value.toLowerCase().includes('test')) return true;
  if (value.includes('自动触发')) return true;
  if (value.length <= 3) return true;
  return false;
}

function isNoisyWorkspaceLabel(label: string) {
  const value = label.trim().toLowerCase();
  return value.startsWith('file_') || value.includes('llmagent');
}

function getStatusTone(status: string): WorkspaceTone {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled' || status === 'blocked') return 'danger';
  if (status === 'paused' || status === 'queued' || status === 'starting') return 'warning';
  if (status === 'active' || status === 'running') return 'info';
  return 'neutral';
}

function getProjectProgress(project: Project) {
  const stages = project.pipelineState?.stages || [];

  if (stages.length > 0) {
    const completed = stages.filter(stage => stage.status === 'completed' || stage.status === 'skipped').length;
    const running = stages.filter(stage => stage.status === 'running').length;
    const percent = Math.round((completed / stages.length) * 100);

    return {
      completed,
      total: stages.length,
      running,
      percent,
      label: `${completed}/${stages.length} stages`,
    };
  }

  const fallbackPercent: Record<Project['status'], number> = {
    active: 34,
    paused: 42,
    failed: 18,
    cancelled: 0,
    archived: 100,
    completed: 100,
  };

  return {
    completed: project.status === 'completed' || project.status === 'archived' ? 1 : 0,
    total: 1,
    running: project.status === 'active' ? 1 : 0,
    percent: fallbackPercent[project.status] ?? 0,
    label: project.templateId ? 'Template ready' : 'Awaiting pipeline',
  };
}

function getWorkspaceLabel(
  workspace: string | undefined,
  workspaces: Workspace[],
  departments?: Map<string, DepartmentConfig>,
) {
  if (!workspace) return 'Unassigned';
  const departmentName = departments?.get(workspace)?.name;
  if (departmentName) return departmentName;
  const workspaceName = workspaces.find(item => item.uri === workspace)?.name;
  if (workspaceName) return workspaceName;

  const parts = workspace.split('/').filter(Boolean);
  const lastPart = parts[parts.length - 1] || workspace;
  if (!workspace.includes('/') && workspace.startsWith('file_')) {
    const compactParts = workspace.split('_').filter(Boolean);
    return compactParts[compactParts.length - 1] || lastPart;
  }
  return lastPart;
}

function getProjectAttentionCount(project: Project, runs: AgentRun[]) {
  const stageIssues = (project.pipelineState?.stages || []).filter(stage =>
    stage.status === 'failed' || stage.status === 'blocked' || stage.gateApproval?.status === 'pending',
  ).length;
  const runIssues = runs.filter(run =>
    run.projectId === project.projectId && ['failed', 'blocked'].includes(run.status),
  ).length;
  const projectIssue = project.status === 'failed' || project.status === 'paused' ? 1 : 0;
  const decisionIssue = project.ceoDecision && !project.ceoDecision.resolved ? 1 : 0;

  return stageIssues + runIssues + projectIssue + decisionIssue;
}

function inferRestoreProjectStatus(project: Project): Project['status'] {
  const pipelineStatus = project.pipelineState?.status;
  if (pipelineStatus === 'running') return 'active';
  if (pipelineStatus === 'completed') return 'completed';
  if (pipelineStatus === 'failed') return 'failed';
  if (pipelineStatus === 'cancelled') return 'cancelled';
  if (pipelineStatus === 'paused') return 'paused';

  const stages = project.pipelineState?.stages || [];
  if (stages.some((stage) => stage.status === 'failed' || stage.status === 'blocked')) return 'failed';
  if (stages.some((stage) => stage.status === 'running' || stage.status === 'pending')) return 'active';
  if (stages.length > 0 && stages.every((stage) => stage.status === 'completed' || stage.status === 'skipped')) return 'completed';

  return project.runIds.length > 0 ? 'completed' : 'active';
}

function getTemplateLabel(templateId: string | undefined, templates?: TemplateSummaryFE[]) {
  if (!templateId) return 'No template';
  return templates?.find(template => template.id === templateId)?.title || templateId;
}

function getProjectActivityTime(project: Project, runs: AgentRun[]) {
  const latestRun = runs
    .filter(run => run.projectId === project.projectId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  return latestRun?.createdAt || project.updatedAt || project.createdAt;
}

function getProjectPresentationScore(project: Project, runs: AgentRun[]) {
  const progress = getProjectProgress(project);
  const attentionCount = getProjectAttentionCount(project, runs);
  const relatedRunCount = runs.filter(run => run.projectId === project.projectId).length;
  const nameLength = (project.name || '').trim().length;
  const workspacePenalty = isNoisyWorkspaceLabel(getWorkspaceLabel(project.workspace, [], undefined)) ? 14 : 0;
  let score = 0;

  score += isNoisyProjectName(project.name) ? -42 : 36;
  score += project.status === 'active' ? 18 : project.status === 'failed' || project.status === 'paused' ? 8 : 0;
  score += attentionCount > 0 ? 6 : 0;
  score += Math.min(12, progress.total * 4);
  score += Math.min(10, relatedRunCount * 2);
  score += project.goal?.trim() ? 6 : 0;
  score += project.templateId ? 4 : 0;
  score += nameLength >= 6 && nameLength <= 28 ? 8 : nameLength > 48 ? -4 : 0;
  score -= workspacePenalty;

  return score;
}

type ProjectBlockerItem = {
  key: string;
  title: string;
  detail: string;
  tone: WorkspaceTone;
  projectId?: string;
};

type ProjectNextStepItem = {
  key: string;
  title: string;
  detail: string;
  action: 'dispatch' | 'detail' | 'generate';
  projectId?: string;
};

type ProjectTreeSection = {
  key: string;
  title: string;
  subtitle: string;
  tone: WorkspaceTone;
  projects: Project[];
  totalCount: number;
  primaryWorkspaceUri?: string;
  boundWorkspaceUris: string[];
  hasDepartmentConfig: boolean;
};

function getRunDisplayTitle(run: AgentRun): string {
  const title = run.result?.summary
    || run.resultEnvelope?.summary
    || run.taskEnvelope?.goal
    || run.prompt
    || run.stageId
    || run.runId;

  return String(title);
}

function getRunDuration(run: AgentRun) {
  const startedAt = run.startedAt || run.createdAt;
  const endedAt = run.finishedAt || new Date().toISOString();
  const diffMs = Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
  const totalSeconds = Math.round(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getRunOwnerLabel(run: AgentRun, workspaces: Workspace[], departments?: Map<string, DepartmentConfig>) {
  return getWorkspaceLabel(run.workspace, workspaces, departments);
}

function buildProjectBlockers(project: Project, runs: AgentRun[]): ProjectBlockerItem[] {
  const stageBlockers = (project.pipelineState?.stages || [])
    .filter(stage => stage.status === 'failed' || stage.status === 'blocked' || stage.gateApproval?.status === 'pending')
    .map(stage => ({
      key: `stage-${stage.stageId}`,
      title: String(stage.gateApproval?.status === 'pending' ? '等待审批确认' : stage.title || stage.stageId),
      detail: stage.lastError || (stage.gateApproval?.status === 'pending' ? 'Gate approval pending' : `Stage status: ${stage.status}`),
      tone: stage.gateApproval?.status === 'pending' ? 'warning' as const : 'danger' as const,
      projectId: project.projectId,
    }));

  const runBlockers = runs
    .filter(run => run.projectId === project.projectId && ['failed', 'blocked'].includes(run.status))
    .map(run => ({
      key: `run-${run.runId}`,
      title: getRunDisplayTitle(run),
      detail: run.lastError || `Run status: ${run.status}`,
      tone: 'danger' as const,
      projectId: project.projectId,
    }));

  const decisionBlocker = project.ceoDecision && !project.ceoDecision.resolved
    ? [{
        key: `decision-${project.projectId}`,
        title: '等待 CEO 决策',
        detail: project.ceoDecision.reasoning || project.ceoDecision.command,
        tone: 'warning' as const,
        projectId: project.projectId,
      }]
    : [];

  return [...stageBlockers, ...runBlockers, ...decisionBlocker].slice(0, 3);
}

function buildProjectNextSteps(project: Project, runs: AgentRun[]): ProjectNextStepItem[] {
  const pendingStages = (project.pipelineState?.stages || [])
    .filter(stage => stage.status === 'pending' || stage.status === 'running')
    .map(stage => ({
      key: `stage-${stage.stageId}`,
      title: String(stage.status === 'running' ? `${stage.title || stage.stageId} 进行中` : `${stage.title || stage.stageId} 待启动`),
      detail: stage.runId ? `Run ${stage.runId.slice(0, 8)}` : '等待执行资源',
      action: 'detail' as const,
      projectId: project.projectId,
    }));

  if (pendingStages.length > 0) return pendingStages.slice(0, 3);

  if (!project.pipelineState) {
    return [
      {
        key: 'dispatch',
        title: '选择模板并派发',
        detail: project.templateId ? getTemplateLabel(project.templateId) : '可使用 AI Generate Pipeline 创建模板',
        action: 'dispatch',
        projectId: project.projectId,
      },
      {
        key: 'review-goal',
        title: '确认项目目标',
        detail: project.goal || '补充任务目标和验收口径',
        action: 'detail',
        projectId: project.projectId,
      },
    ];
  }

  const latestRun = runs.find(run => run.projectId === project.projectId);
  return [
    {
      key: 'review',
      title: project.status === 'completed' ? '复盘交付结果' : '查看执行详情',
      detail: latestRun ? getRunDisplayTitle(latestRun) : '进入详情查看 pipeline、产物和日志',
      action: 'detail',
      projectId: project.projectId,
    },
  ];
}

export default function ProjectsPanel({
  projects,
  agentRuns,
  workspaces,
  onSelectProject,
  onSelectRun,
  selectedProjectId,
  selectedRunId,
  templates,
  models,
  departments,
  projectSearchQuery,
  onProjectSearchQueryChange,
  createProjectRequestToken,
  onOpenDepartmentSettings,
  onRefresh,
  onResume,
  onCancelRun,
  onOpenConversation,
  onOpenImprovementProposal,
  refreshSignal = 0,
  onDepartmentSaved: _onDepartmentSaved,
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
  const [departmentDialogWorkspaceUri, setDepartmentDialogWorkspaceUri] = useState<string | null>(null);
  const [createDepartmentDialogOpen, setCreateDepartmentDialogOpen] = useState(false);
  const [createDepartmentPath, setCreateDepartmentPath] = useState('');
  const [creatingDepartment, setCreatingDepartment] = useState(false);
  const [extraDepartmentWorkspaces, setExtraDepartmentWorkspaces] = useState<Workspace[]>([]);
  const [departmentActionError, setDepartmentActionError] = useState<string | null>(null);
  const [localProjectSearch, setLocalProjectSearch] = useState('');
  const projectSearch = projectSearchQuery ?? localProjectSearch;
  const setProjectSearch = useCallback((query: string) => {
    if (onProjectSearchQueryChange) {
      onProjectSearchQueryChange(query);
      return;
    }
    setLocalProjectSearch(query);
  }, [onProjectSearchQueryChange]);
  const [projectFilter, setProjectFilter] = useState<ProjectFilterValue>('all');
  const [browseFocusedProjectId, setBrowseFocusedProjectId] = useState<string | null>(null);
  const [showAllTreeSections, setShowAllTreeSections] = useState(false);
  const lastCreateRequestTokenRef = useRef(createProjectRequestToken ?? 0);


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
  const allDepartmentWorkspaces = useMemo(() => {
    const merged = new Map<string, Workspace>();
    workspaces.forEach((workspace) => merged.set(workspace.uri, workspace));
    extraDepartmentWorkspaces.forEach((workspace) => merged.set(workspace.uri, workspace));
    return [...merged.values()];
  }, [extraDepartmentWorkspaces, workspaces]);
  const departmentDialogWorkspace = departmentDialogWorkspaceUri
    ? allDepartmentWorkspaces.find((workspace) => workspace.uri === departmentDialogWorkspaceUri) || null
    : null;
  const departmentDialogConfig = departmentDialogWorkspace
    ? departments?.get(departmentDialogWorkspace.uri) ?? {
        name: departmentDialogWorkspace.name,
        type: 'build' as const,
        skills: [],
        okr: null,
      }
    : null;

  // CEO command quick-task feedback
  const [ceoToast, setCeoToast] = useState<{ success: boolean; message: string } | null>(null);
  // Per-project pending CEO suggestions (for needs_decision projects)
  const [pendingSuggestions, setPendingSuggestions] = useState<Record<string, import('@/lib/api').CEOSuggestion[]>>({});

  // Auto-dismiss CEO toast
  useEffect(() => {
    if (!ceoToast) return;
    const timer = setTimeout(() => setCeoToast(null), 5000);
    return () => clearTimeout(timer);
  }, [ceoToast]);



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
  const [focusedProjectRuns, setFocusedProjectRuns] = useState<AgentRun[]>([]);
  const [focusedProjectRunsProjectId, setFocusedProjectRunsProjectId] = useState<string | null>(null);

  const openDepartmentDialog = useCallback((targetWorkspaceUri?: string | null) => {
    if (targetWorkspaceUri) {
      setDepartmentDialogWorkspaceUri(targetWorkspaceUri);
      setDepartmentActionError(null);
      return;
    }
    onOpenDepartmentSettings?.();
  }, [onOpenDepartmentSettings]);

  const handleCreateDepartment = useCallback(() => {
    setDepartmentActionError(null);
    setCreateDepartmentPath('');
    setCreateDepartmentDialogOpen(true);
  }, []);

  const handleBrowseCreateDepartment = useCallback(async () => {
    const selectedPath = await selectLocalFolder('选择要作为部门主目录的文件夹');
    if (!selectedPath) return;
    setCreateDepartmentPath(selectedPath);
  }, []);

  const handleConfirmCreateDepartment = useCallback(async () => {
    const normalizedPath = createDepartmentPath.trim();
    if (!normalizedPath) {
      setDepartmentActionError('请输入部门主目录路径');
      return;
    }

    setCreatingDepartment(true);
    setDepartmentActionError(null);
    try {
      const result = await api.importWorkspace(normalizedPath);
      setExtraDepartmentWorkspaces((prev) => {
        const merged = new Map(prev.map((workspace) => [workspace.uri, workspace]));
        merged.set(result.workspace.uri, result.workspace);
        return [...merged.values()];
      });
      setCreateDepartmentDialogOpen(false);
      setCreateDepartmentPath('');
      setDepartmentDialogWorkspaceUri(result.workspace.uri);
      onRefresh?.();
    } catch (error) {
      setDepartmentActionError(error instanceof Error ? error.message : '新建部门失败');
    } finally {
      setCreatingDepartment(false);
    }
  }, [createDepartmentPath, onRefresh]);

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

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();

    return sortedProjects.filter(project => {
      const attentionCount = getProjectAttentionCount(project, agentRuns);
      const matchesFilter =
        projectFilter === 'all'
        || (projectFilter === 'active' && isActiveProjectStatus(project.status))
        || (projectFilter === 'attention' && attentionCount > 0)
        || (projectFilter === 'completed' && isClosedProjectStatus(project.status));

      if (!matchesFilter) return false;
      if (!query) return true;

      const searchable = [
        project.name,
        project.goal,
        project.status,
        project.templateId || '',
        getWorkspaceLabel(project.workspace, workspaces, departments),
      ].join(' ').toLowerCase();

      return searchable.includes(query);
    });
  }, [agentRuns, departments, projectFilter, projectSearch, sortedProjects, workspaces]);

  const projectTreeSections = useMemo(() => {
    const sections = new Map<string, ProjectTreeSection>();

    for (const project of filteredProjects) {
      const statusGroup = isClosedProjectStatus(project.status);
      const workspaceName = workspaces.find((workspace) => workspace.uri === project.workspace)?.name;
      const department = project.workspace && departments
        ? departments.get(project.workspace) || null
        : null;
      const primaryWorkspaceUri = !statusGroup && project.workspace
        ? getDepartmentGroupKey(department, project.workspace, workspaceName)
        : undefined;
      const boundWorkspaceUris = !statusGroup && project.workspace
        ? (department
          ? getDepartmentBoundWorkspaceUris(department, project.workspace, workspaceName)
          : [project.workspace])
        : [];
      const key = statusGroup ? `status-${project.status}` : (primaryWorkspaceUri || project.workspace || 'unassigned');
      const title = statusGroup
        ? project.status === 'completed' ? 'Completed' : project.status === 'archived' ? 'Archived' : 'Cancelled'
        : department?.name || getWorkspaceLabel(project.workspace, workspaces, departments);
      const existing = sections.get(key);
      const tone = getStatusTone(project.status);
      const subtitle = statusGroup
        ? 'Historical projects'
        : department
          ? `${boundWorkspaceUris.length} 个工作区`
          : '待配置部门';

      if (existing) {
        existing.projects.push(project);
        existing.totalCount += 1;
      } else {
        sections.set(key, {
          key,
          title,
          subtitle,
          tone,
          projects: [project],
          totalCount: 1,
          primaryWorkspaceUri,
          boundWorkspaceUris,
          hasDepartmentConfig: Boolean(department),
        });
      }
    }

    return Array.from(sections.values()).sort((left, right) => {
      const leftClosed = left.key.startsWith('status-') ? 1 : 0;
      const rightClosed = right.key.startsWith('status-') ? 1 : 0;
      if (leftClosed !== rightClosed) return leftClosed - rightClosed;
      return left.title.localeCompare(right.title);
    });
  }, [departments, filteredProjects, workspaces]);

  const openTreeSections = useMemo(() => {
    return projectTreeSections
      .filter(section => !section.key.startsWith('status-'))
      .map(section => {
        const sortedSectionProjects = [...section.projects].sort((left, right) => {
          const leftPresentation = getProjectPresentationScore(left, agentRuns);
          const rightPresentation = getProjectPresentationScore(right, agentRuns);
          if (leftPresentation !== rightPresentation) return rightPresentation - leftPresentation;
          const leftAttention = getProjectAttentionCount(left, agentRuns);
          const rightAttention = getProjectAttentionCount(right, agentRuns);
          if (leftAttention !== rightAttention) return rightAttention - leftAttention;
          if (left.status !== right.status) {
            if (left.status === 'active') return -1;
            if (right.status === 'active') return 1;
          }
          return new Date(getProjectActivityTime(right, agentRuns)).getTime() - new Date(getProjectActivityTime(left, agentRuns)).getTime();
        });
        const showcaseProjects = sortedSectionProjects.filter(project => !isNoisyProjectName(project.name));
        const displayProjects = (showcaseProjects.length > 0 ? showcaseProjects : sortedSectionProjects).slice(0, 4);
        const activeCount = sortedSectionProjects.filter(project => project.status === 'active').length;
        const attentionCount = sortedSectionProjects.filter(project => getProjectAttentionCount(project, agentRuns) > 0).length;
        const showcaseCount = showcaseProjects.length;
        const topPresentation = displayProjects[0] ? getProjectPresentationScore(displayProjects[0], agentRuns) : -100;
        const sectionPresentationScore = topPresentation + activeCount * 8 + attentionCount * 5 + showcaseCount * 4 - (isNoisyWorkspaceLabel(section.title) ? 24 : 0);

        return {
          ...section,
          projects: displayProjects,
          hiddenCount: Math.max(0, section.totalCount - displayProjects.length),
          activeCount,
          showcaseCount,
          sectionPresentationScore,
        };
      })
      .sort((left, right) => {
        if (left.sectionPresentationScore !== right.sectionPresentationScore) {
          return right.sectionPresentationScore - left.sectionPresentationScore;
        }
        if (left.activeCount !== right.activeCount) return right.activeCount - left.activeCount;
        return right.totalCount - left.totalCount;
      });
  }, [agentRuns, projectTreeSections]);

  const closedTreeSections = useMemo(() => {
    return projectTreeSections
      .filter(section => section.key.startsWith('status-'))
      .map(section => ({
        ...section,
        projects: [...section.projects].sort((left, right) =>
          new Date(getProjectActivityTime(right, agentRuns)).getTime() - new Date(getProjectActivityTime(left, agentRuns)).getTime(),
        ),
        hiddenCount: 0,
        activeCount: 0,
      }));
  }, [agentRuns, projectTreeSections]);

  useEffect(() => {
    if (projectSearch.trim() || projectFilter !== 'all') {
      setShowAllTreeSections(false);
    }
  }, [projectFilter, projectSearch]);

  const visibleOpenTreeSections = useMemo(() => {
    if (projectSearch.trim() || projectFilter !== 'all') return openTreeSections;
    const showcaseSections = openTreeSections.filter(section => section.showcaseCount > 0);
    const prioritizedSections = showcaseSections.length >= 4
      ? showcaseSections
      : [...showcaseSections, ...openTreeSections.filter(section => section.showcaseCount === 0 && section.activeCount > 0)];
    if (showAllTreeSections) return openTreeSections;
    return prioritizedSections.slice(0, 4);
  }, [openTreeSections, projectFilter, projectSearch, showAllTreeSections]);

  const visibleTreeSections = useMemo(() => {
    if (projectFilter === 'completed') return closedTreeSections;
    return visibleOpenTreeSections;
  }, [closedTreeSections, projectFilter, visibleOpenTreeSections]);

  const extraOpenSectionCount = useMemo(() => {
    if (projectSearch.trim() || projectFilter !== 'all') return 0;
    return Math.max(0, openTreeSections.length - 4);
  }, [openTreeSections, projectFilter, projectSearch]);

  const closedProjects = useMemo(() => {
    return filteredProjects
      .filter(project => isClosedProjectStatus(project.status))
      .sort((left, right) => new Date(getProjectActivityTime(right, agentRuns)).getTime() - new Date(getProjectActivityTime(left, agentRuns)).getTime());
  }, [agentRuns, filteredProjects]);

  const visibleTreeProjects = useMemo(
    () => visibleTreeSections.flatMap((section) => section.projects),
    [visibleTreeSections],
  );

  const browseFocusProject = useMemo(() => {
    const explicitProject = browseFocusedProjectId
      ? visibleTreeProjects.find((project) => project.projectId === browseFocusedProjectId) || null
      : null;
    if (explicitProject) return explicitProject;

    if (visibleTreeProjects.length > 0) {
      return visibleTreeProjects.find((project) => projectFilter === 'completed' || !isClosedProjectStatus(project.status))
        || visibleTreeProjects[0]
        || null;
    }

    if (projectSearch.trim() || projectFilter !== 'all') {
      return null;
    }

    const candidateProjects = sortedProjects
      .filter((project) => !['archived', 'cancelled'].includes(project.status))
      .sort((left, right) => {
        const leftScore = getProjectPresentationScore(left, agentRuns);
        const rightScore = getProjectPresentationScore(right, agentRuns);
        if (leftScore !== rightScore) return rightScore - leftScore;
        return new Date(getProjectActivityTime(right, agentRuns)).getTime() - new Date(getProjectActivityTime(left, agentRuns)).getTime();
      });

    return candidateProjects.find((project) =>
      project.status === 'active' && !isNoisyProjectName(project.name),
    ) || candidateProjects.find((project) =>
      getProjectAttentionCount(project, agentRuns) > 0 && !isNoisyProjectName(project.name),
    ) || candidateProjects[0]
      || sortedProjects[0]
      || null;
  }, [agentRuns, browseFocusedProjectId, projectFilter, projectSearch, sortedProjects, visibleTreeProjects]);

  const browseFocusRuns = useMemo(() => {
    if (!browseFocusProject) return [];
    const runs = focusedProjectRunsProjectId === browseFocusProject.projectId
      ? focusedProjectRuns
      : agentRuns.filter(run => run.projectId === browseFocusProject.projectId);
    return [...runs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [agentRuns, browseFocusProject, focusedProjectRuns, focusedProjectRunsProjectId]);

  const browseFocusChildren = useMemo(() => {
    if (!browseFocusProject) return [];
    return childProjectsByParent.get(browseFocusProject.projectId) || [];
  }, [browseFocusProject, childProjectsByParent]);

  const browseFocusWorkspaceProjects = useMemo(() => {
    if (!browseFocusProject?.workspace) return [];
    return sortedProjects
      .filter(project => project.workspace === browseFocusProject.workspace && project.projectId !== browseFocusProject.projectId)
      .sort((left, right) => {
        const leftScore = getProjectPresentationScore(left, agentRuns);
        const rightScore = getProjectPresentationScore(right, agentRuns);
        if (leftScore !== rightScore) return rightScore - leftScore;
        return new Date(getProjectActivityTime(right, agentRuns)).getTime() - new Date(getProjectActivityTime(left, agentRuns)).getTime();
      });
  }, [agentRuns, browseFocusProject, sortedProjects]);

  const browseFocusContextRuns = useMemo(() => {
    if (!browseFocusProject?.workspace) return browseFocusRuns;
    const primaryIds = new Set([
      browseFocusProject.projectId,
      ...browseFocusChildren.map(project => project.projectId),
    ]);
    const workspaceIds = new Set([
      browseFocusProject.projectId,
      ...browseFocusWorkspaceProjects.map(project => project.projectId),
      ...browseFocusChildren.map(project => project.projectId),
    ]);
    const runsById = new Map<string, AgentRun>();
    agentRuns.forEach((run) => runsById.set(run.runId, run));
    if (focusedProjectRunsProjectId === browseFocusProject.projectId) {
      focusedProjectRuns.forEach((run) => runsById.set(run.runId, run));
    }
    const runsSource = Array.from(runsById.values());

    return runsSource
      .filter(run => {
        if (!run.projectId) return false;
        return primaryIds.has(run.projectId) || (run.workspace === browseFocusProject.workspace && workspaceIds.has(run.projectId));
      })
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }, [
    agentRuns,
    browseFocusChildren,
    browseFocusProject,
    browseFocusRuns,
    browseFocusWorkspaceProjects,
    focusedProjectRuns,
    focusedProjectRunsProjectId,
  ]);

  const browseFocusDepartment = useMemo(() => {
    if (!browseFocusProject?.workspace || !departments) return null;
    return departments.get(browseFocusProject.workspace) || null;
  }, [browseFocusProject?.workspace, departments]);
  const browseFocusWorkspaceBindings = useMemo(() => {
    if (!browseFocusProject?.workspace) return [];
    return getDepartmentWorkspaceBindings(
      browseFocusDepartment,
      browseFocusProject.workspace,
      getWorkspaceLabel(browseFocusProject.workspace, workspaces, departments),
    );
  }, [browseFocusDepartment, browseFocusProject?.workspace, departments, workspaces]);
  const browseFocusContextDocs = useMemo(
    () => getDepartmentContextDocumentPaths(browseFocusDepartment),
    [browseFocusDepartment],
  );

  const browseFocusProgress = browseFocusProject ? getProjectProgress(browseFocusProject) : null;
  const browseFocusAttentionCount = browseFocusProject ? getProjectAttentionCount(browseFocusProject, browseFocusRuns) : 0;
  const browseFocusStages = browseFocusProject?.pipelineState?.stages || [];
  const browseFocusBlockers = browseFocusProject
    ? buildProjectBlockers(browseFocusProject, browseFocusRuns)
    : [];
  const browseFocusNextSteps = browseFocusProject
    ? buildProjectNextSteps(browseFocusProject, browseFocusRuns)
    : [];
  const browseFocusWorkspaceBlockers = useMemo(() => {
    if (!browseFocusProject) return [];

    const siblingProjectIssues = browseFocusWorkspaceProjects
      .filter(project => getProjectAttentionCount(project, agentRuns) > 0)
      .slice(0, 2)
      .map(project => ({
        key: `workspace-project-${project.projectId}`,
        title: project.name,
        detail: project.goal || `${project.status} · ${getWorkspaceLabel(project.workspace, workspaces, departments)}`,
        tone: getProjectAttentionCount(project, agentRuns) > 1 ? 'danger' as const : 'warning' as const,
        projectId: project.projectId,
      }));

    const siblingRunIssues = browseFocusContextRuns
      .filter(run => run.projectId !== browseFocusProject.projectId && ['failed', 'blocked'].includes(run.status))
      .slice(0, 2)
      .map(run => ({
        key: `workspace-run-${run.runId}`,
        title: getRunDisplayTitle(run),
        detail: run.lastError || `${getRunOwnerLabel(run, workspaces, departments)} · ${run.status}`,
        tone: 'danger' as const,
        projectId: run.projectId || undefined,
      }));

    return [...siblingProjectIssues, ...siblingRunIssues];
  }, [agentRuns, browseFocusContextRuns, browseFocusProject, browseFocusWorkspaceProjects, departments, workspaces]);
  const browseFocusWorkspaceNextSteps = useMemo(() => {
    if (!browseFocusProject) return [];

    const activeSiblingProjects = browseFocusWorkspaceProjects
      .filter(project => project.status === 'active')
      .slice(0, 2)
      .map(project => ({
        key: `workspace-next-${project.projectId}`,
        title: `继续推进 ${project.name}`,
        detail: project.goal || `${getWorkspaceLabel(project.workspace, workspaces, departments)} · ${getProjectProgress(project).percent}%`,
        action: 'detail' as const,
        projectId: project.projectId,
      }));

    const runningSiblingRun = browseFocusContextRuns.find(run =>
      run.projectId !== browseFocusProject.projectId && ['running', 'starting', 'queued'].includes(run.status),
    );

    return runningSiblingRun
      ? [
          {
            key: `workspace-run-next-${runningSiblingRun.runId}`,
            title: `${getRunDisplayTitle(runningSiblingRun)} 进行中`,
            detail: `${getRunOwnerLabel(runningSiblingRun, workspaces, departments)} · ${getRunDuration(runningSiblingRun)}`,
            action: 'detail' as const,
            projectId: runningSiblingRun.projectId || undefined,
          },
          ...activeSiblingProjects,
        ]
      : activeSiblingProjects;
  }, [browseFocusContextRuns, browseFocusProject, browseFocusWorkspaceProjects, departments, workspaces]);
  const browseFocusAllBlockers = [...browseFocusBlockers, ...browseFocusWorkspaceBlockers].slice(0, 4);
  const browseFocusAllNextSteps = [...browseFocusNextSteps, ...browseFocusWorkspaceNextSteps]
    .filter((item, index, items) => items.findIndex(candidate => candidate.key === item.key) === index)
    .slice(0, 4);

  useEffect(() => {
    if (!browseFocusedProjectId) return;
    if (projects.some(project => project.projectId === browseFocusedProjectId)) return;
    setBrowseFocusedProjectId(null);
  }, [browseFocusedProjectId, projects]);

  useEffect(() => {
    if (!browseFocusedProjectId) return;
    if (visibleTreeProjects.some((project) => project.projectId === browseFocusedProjectId)) return;
    setBrowseFocusedProjectId(null);
  }, [browseFocusedProjectId, visibleTreeProjects]);

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

  const detailFocusProjectId = useMemo(() => {
    if (!detailProject) return null;
    const children = childProjectsByParent.get(detailProject.projectId) || [];
    const activeChildId = children.find((project) => project.projectId === selectedProjectId)?.projectId || null;
    return activeChildId || detailProject.projectId;
  }, [childProjectsByParent, detailProject, selectedProjectId]);

  const focusedRunsProjectId = detailProject
    ? detailFocusProjectId
    : (browseFocusProject?.projectId || null);

  // OPC Phase 3: CEO events (hooks must be at component top level)
  const allStages = useMemo(() =>
    projects.flatMap(p => p.pipelineState?.stages || []),
    [projects],
  );
  generateCEOEvents(projects, allStages);

  const [deptConfig, setDeptConfig] = useState<DepartmentConfig | null>(null);
  const [showDeptContext, setShowDeptContext] = useState(false);
  const [linkedImprovementProposal, setLinkedImprovementProposal] = useState<SystemImprovementProposalFE | null>(null);

  useEffect(() => {
    if (!detailProject?.workspace) { setDeptConfig(null); return; }
    if (departments) {
      setDeptConfig(departments.get(detailProject.workspace) || null);
      return;
    }
    api.getDepartment(detailProject.workspace)
      .then(setDeptConfig)
      .catch(() => setDeptConfig(null));
  }, [departments, detailProject?.workspace]);

  useEffect(() => {
    setShowDeptContext(false);
  }, [detailProject?.projectId, selectedProjectId]);

  const detailFocusProject = useMemo(() => {
    if (!detailFocusProjectId) return null;
    return projects.find((project) => project.projectId === detailFocusProjectId) || null;
  }, [detailFocusProjectId, projects]);

  const detailFocusRuns = useMemo(() => {
    if (!detailFocusProject) return [];
    const runs = focusedProjectRunsProjectId === detailFocusProject.projectId
      ? focusedProjectRuns
      : agentRuns.filter((run) => run.projectId === detailFocusProject.projectId);
    return [...runs].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }, [agentRuns, detailFocusProject, focusedProjectRuns, focusedProjectRunsProjectId]);

  const linkedImprovementProposalId = useMemo(() => {
    if (!detailFocusProject) return null;
    return extractSystemImprovementProposalIdFromGoal(detailFocusProject.goal)
      || extractSystemImprovementProposalIdFromRuns(detailFocusRuns);
  }, [detailFocusProject, detailFocusRuns]);

  useEffect(() => {
    let cancelled = false;

    if (!linkedImprovementProposalId) {
      setLinkedImprovementProposal(null);
      return;
    }

    api.systemImprovementProposal(linkedImprovementProposalId)
      .then((proposal) => {
        if (!cancelled) {
          setLinkedImprovementProposal(proposal);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinkedImprovementProposal(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [linkedImprovementProposalId, refreshSignal]);

  useEffect(() => {
    if (!focusedRunsProjectId) {
      setFocusedProjectRuns([]);
      setFocusedProjectRunsProjectId(null);
      return;
    }

    let cancelled = false;
    const loadRuns = async () => {
      try {
        const runs = await api.agentRunsByFilterAll({ projectId: focusedRunsProjectId }, { pageSize: 100 });
        if (!cancelled) {
          setFocusedProjectRunsProjectId(focusedRunsProjectId);
          setFocusedProjectRuns(runs);
        }
      } catch {
        if (!cancelled) {
          setFocusedProjectRunsProjectId(focusedRunsProjectId);
          setFocusedProjectRuns([]);
        }
      }
    };

    void loadRuns();
    const interval = setInterval(() => {
      void loadRuns();
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [focusedRunsProjectId]);

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

  const requestDeleteProject = (id: string) => {
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

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    requestDeleteProject(id);
  };

  const requestArchiveProject = (project: Project, archived: boolean) => {
    if (archived) {
      setConfirmDialog({
        message: t('projects.archiveConfirm'),
        onConfirm: async () => {
          try {
            await api.updateProject(project.projectId, { status: 'archived' });
            onRefresh?.();
          } catch (err) {
            showFlash(err instanceof Error ? err.message : '归档项目失败');
          }
        },
      });
    } else {
      void (async () => {
        try {
          await api.updateProject(project.projectId, { status: inferRestoreProjectStatus(project) });
          onRefresh?.();
        } catch (err) {
          showFlash(err instanceof Error ? err.message : '恢复项目失败');
        }
      })();
    }
  };

  const handleArchive = (e: React.MouseEvent, project: Project, archived: boolean) => {
    e.stopPropagation();
    requestArchiveProject(project, archived);
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

  const openCreateDialog = useCallback(() => {
    setFormData({
      name: '',
      goal: '',
      workspace: workspaces[0]?.uri || '',
      templateId: '',
    });
    setIsCreateDialogOpen(true);
  }, [workspaces]);

  useEffect(() => {
    const nextToken = createProjectRequestToken ?? 0;
    if (!nextToken || nextToken === lastCreateRequestTokenRef.current) return;
    lastCreateRequestTokenRef.current = nextToken;
    openCreateDialog();
  }, [createProjectRequestToken, openCreateDialog]);

  const requestEditProject = (project: Project) => {
    setEditingProject(project);
    setFormData({
      name: project.name,
      goal: project.goal,
      workspace: project.workspace || workspaces[0]?.uri || '',
      templateId: project.templateId || '',
    });
    setIsEditDialogOpen(true);
  };

  const openEditDialog = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    requestEditProject(project);
  };

  const openDispatchProject = (project: Project) => {
    setDispatchingProject(project);
    setDispatchData({
      templateId: project.templateId || templates?.[0]?.id || '',
      prompt: project.goal || '',
    });
    setIsDispatchDialogOpen(true);
  };

  const openDispatchDialog = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    openDispatchProject(project);
  };

  return (
    <>
      {sortedProjects.length === 0 ? (
        <div className="space-y-6">

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

          <WorkspaceSurface className="flex flex-col items-center justify-center border-dashed py-12 text-center">
            <FolderKanban className="mb-4 h-12 w-12 text-[var(--app-accent)]/40" />
            <h3 className="text-lg font-medium text-[var(--app-text)]">{t('projects.noProjects')}</h3>
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
          </WorkspaceSurface>
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
          const viewProjectRunsSource = focusedProjectRunsProjectId === viewProject.projectId
            ? focusedProjectRuns
            : agentRuns.filter((run) => run.projectId === viewProject.projectId);
          const viewProjectRuns = [...viewProjectRunsSource]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          const latestProjectRun = viewProjectRuns[0] || null;
          const hasProjectPromptRuns = viewProjectRuns.some((run) => run.executorKind === 'prompt');
          const outputArtifactCount = viewProjectRuns.reduce(
            (sum, run) => sum + (run.resultEnvelope?.outputArtifacts?.length || 0),
            0,
          );
          const completedRunCount = viewProjectRuns.filter((run) => run.status === 'completed').length;
          const latestVerifiedRun = viewProjectRuns.find((run) => typeof run.verificationPassed === 'boolean') || null;
          const latestAttentionCount = (latestProjectRun?.result?.blockers?.length || 0) + (latestProjectRun?.result?.needsReview?.length || 0);
          const workflowBoundSkills = deptConfig?.skills.filter((skill) => skill.workflowRef?.trim()).length || 0;
          const departmentTemplateCount = deptConfig?.templateIds?.length || 0;
          const departmentWorkspaceBindings = detailProject.workspace && deptConfig
            ? getDepartmentWorkspaceBindings(
                deptConfig,
                detailProject.workspace,
                getWorkspaceLabel(detailProject.workspace, workspaces, departments),
              )
            : [];
          const departmentContextDocs = deptConfig
            ? getDepartmentContextDocumentPaths(deptConfig)
            : [];

          return (
            <div className="space-y-4">
              {/* Back button + action bar */}
              <div className="flex items-center justify-between">
                <button
                  className="flex items-center gap-2 text-sm text-[var(--app-text-soft)] transition-colors hover:text-[var(--app-text)]"
                  onClick={() => (onSelectProject as (id: string | null) => void)?.(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>{t('projects.title')}</span>
                </button>
                <div className="flex items-center gap-2">
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
                    className="gap-1.5 text-[var(--app-text-soft)] hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]"
                    onClick={(e) => openEditDialog(e, project)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "gap-1.5",
                      project.status === 'archived' ? "text-amber-600 hover:bg-amber-400/10" : "text-[var(--app-text-muted)] hover:bg-[var(--app-raised-2)]"
                    )}
                    onClick={(e) => handleArchive(e, project, project.status !== 'archived')}
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
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-accent)] shadow-inner">
                  <FolderKanban className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold text-[var(--app-text)]">{project.name}</h2>
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
                  {linkedImprovementProposal ? (
                    <div className="mt-3 max-w-4xl rounded-[12px] border border-[#dfe5ee] bg-[#fbfdff] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[#eef4ff] px-2.5 py-1 text-[11px] font-semibold text-[#2563eb]">系统改进项目</span>
                        <span className="rounded-full bg-[#fff7ed] px-2.5 py-1 text-[11px] font-semibold text-[#d97706]">{formatImprovementRisk(linkedImprovementProposal.risk)}</span>
                        <span className="rounded-full bg-[#f3f4f6] px-2.5 py-1 text-[11px] font-semibold text-[#64748b]">{formatImprovementStatus(linkedImprovementProposal.status)}</span>
                      </div>
                      <div className="mt-3 text-[15px] leading-7 text-[var(--app-text-soft)]">
                        {linkedImprovementProposal.summary}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-[var(--app-text-muted)]">
                        <span>{linkedImprovementProposal.affectedFiles.length} 个受影响文件</span>
                        <span>{linkedImprovementProposal.protectedAreas.length} 个保护范围</span>
                        <span>{linkedImprovementProposal.testPlan.length} 条测试计划</span>
                      </div>
                      {onOpenImprovementProposal ? (
                        <div className="mt-3">
                          <Button
                            variant="outline"
                            onClick={() => onOpenImprovementProposal(linkedImprovementProposal.id)}
                            className="h-8 rounded-[9px] border-[#dfe5ee] bg-white px-3 text-[12px] text-[#0f172a] hover:bg-[#f8fafc]"
                          >
                            查看系统改进详情
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : project.goal ? (
                    <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-[var(--app-text-soft)]">
                      {project.goal}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className={cn(PROJECT_SURFACE_CLASS, 'grid overflow-hidden md:grid-cols-2 xl:grid-cols-4')}>
                <div className="border-b border-[#dfe5ee] px-4 py-3 xl:border-b-0 xl:border-r">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">最近执行</div>
                  <div className="mt-2 flex items-center gap-2">
                    {latestProjectRun ? <StatusBadge status={latestProjectRun.status} /> : <StatusBadge status={viewProject.status} />}
                    <span className="text-[12px] text-[var(--app-text-soft)]">
                      {latestProjectRun ? formatRelativeTime(latestProjectRun.createdAt, locale) : '暂无执行记录'}
                    </span>
                  </div>
                  <div className="mt-2 text-[12px] text-[var(--app-text-soft)]">
                    {viewProjectRuns.length} 次项目运行
                  </div>
                </div>

                <div className="border-b border-[#dfe5ee] px-4 py-3 xl:border-b-0 xl:border-r">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">结果摘要</div>
                  <div className="mt-2 line-clamp-2 text-[13px] leading-6 text-[var(--app-text)]">
                    {latestProjectRun?.result?.summary || latestProjectRun?.resultEnvelope?.summary || '暂无结果摘要'}
                  </div>
                  <div className="mt-2 text-[12px] text-[var(--app-text-soft)]">
                    {completedRunCount} 次已完成运行
                  </div>
                </div>

                <div className="border-b border-[#dfe5ee] px-4 py-3 md:border-b-0 xl:border-r">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">交付产物</div>
                  <div className="mt-2 inline-flex items-center gap-2 text-[14px] font-semibold text-[var(--app-text)]">
                    <Package className="h-4 w-4 text-violet-500/70" />
                    {outputArtifactCount} 个产物
                  </div>
                  <div className="mt-2 text-[12px] text-[var(--app-text-soft)]">
                    来自 {viewProjectRuns.length} 次运行
                  </div>
                </div>

                <div className="px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">关注项</div>
                  <div className="mt-2 inline-flex items-center gap-2 text-[14px] font-semibold text-[var(--app-text)]">
                    <ShieldCheck className={cn(
                      'h-4 w-4',
                      latestAttentionCount === 0 && latestVerifiedRun?.verificationPassed !== false ? 'text-emerald-500/70' : 'text-amber-500/70',
                    )} />
                    {latestAttentionCount > 0
                      ? `${latestAttentionCount} 项待处理`
                      : latestVerifiedRun?.verificationPassed === false
                        ? '需要复核'
                        : '无异常'}
                  </div>
                  <div className="mt-2 text-[12px] text-[var(--app-text-soft)]">
                    {latestVerifiedRun?.reportedEventCount !== undefined && latestVerifiedRun?.reportedEventCount !== null
                      ? `${latestVerifiedRun.reportedEventCount} 项校验结果${latestVerifiedRun.reportedEventDate ? ` · ${latestVerifiedRun.reportedEventDate}` : ''}`
                      : '暂无额外校验'}
                  </div>
                </div>
              </div>

              {children.length > 0 && (
                <WorkspaceSurface className="space-y-2" padding="sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--app-text)]">关联项目</div>
                    <div className="text-[11px] text-[var(--app-text-muted)]">
                      {activeChildId ? `已聚焦 ${children.length} 个子项目中的 1 个` : `${children.length} 个子项目`}
                    </div>
                  </div>

                  <div className="-mx-1 overflow-x-auto px-1 pb-1">
                    <div className="flex min-w-max gap-2">
                      <button
                        type="button"
                        className={cn(
                          'min-w-[156px] rounded-[999px] border px-3 py-2 text-left transition-all',
                          !activeChildId
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 shadow-[0_8px_18px_rgba(16,185,129,0.12)]'
                            : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface)]',
                        )}
                        onClick={() => onSelectProject?.(project.projectId)}
                      >
                        <div className="flex items-center gap-2">
                          <FolderKanban className="h-4 w-4 shrink-0" />
                          <span className="text-sm font-semibold">主项目</span>
                          <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-medium text-[var(--app-text-muted)]">
                            {project.pipelineState?.stages?.length || 0} 阶段
                          </span>
                        </div>
                      </button>

                      {children.map((child) => {
                        const childProgress = getProjectProgress(child);
                        const childAttention = getProjectAttentionCount(child, agentRuns);
                        const childSelected = activeChildId === child.projectId;

                        return (
                          <button
                            key={child.projectId}
                            type="button"
                            className={cn(
                              'min-w-[176px] rounded-[999px] border px-3 py-2 text-left transition-all',
                              childSelected
                                ? 'border-violet-500/30 bg-violet-500/10 text-violet-700 shadow-[0_8px_18px_rgba(139,92,246,0.12)]'
                                : 'border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-soft)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface)]',
                            )}
                            onClick={() => onSelectProject?.(child.projectId)}
                          >
                            <div className="flex items-center gap-2">
                              <GitBranch className="h-4 w-4 shrink-0" />
                              <span className="truncate text-sm font-semibold text-[var(--app-text)]">{child.name}</span>
                              <WorkspaceStatusDot tone={getStatusTone(child.status)} pulse={child.status === 'active'} />
                              <span className={cn(
                                'ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                                childAttention > 0 ? 'bg-amber-400/15 text-amber-700' : 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]',
                              )}>
                                {childProgress.percent}%
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </WorkspaceSurface>
              )}

              {/* First-layer execution workspace */}
              {viewProject.pipelineState || hasProjectPromptRuns ? (
                (() => {
                  const templateId = viewProject.pipelineState?.templateId || viewProject.templateId || '';
                  const template = templates?.find(t => t.id === templateId);
                  const templateStages = template?.stages || {};
                  const viewStages = viewProject.pipelineState?.stages || [];
                  const scopedSelectedRunId = selectedRunId && viewProjectRuns.some((run) => run.runId === selectedRunId)
                    ? selectedRunId
                    : null;
                  const prefersFanOutSelection = Boolean(
                    children.length > 0
                    || viewStages.some((stage) => stage.nodeKind === 'fan-out' || (stage.branches?.length || 0) > 0),
                  );
                  const inferredStage = (() => {
                    const pickStage = (
                      predicate: (stage: typeof viewStages[number]) => boolean,
                    ) => viewStages.find((stage) => predicate(stage)) || null;

                    return (
                      pickStage((stage) => stage.status === 'running')
                      || pickStage((stage) => stage.status === 'failed' || stage.status === 'blocked' || stage.gateApproval?.status === 'pending')
                      || (prefersFanOutSelection
                        ? pickStage((stage) => stage.nodeKind === 'fan-out' || (stage.branches?.length || 0) > 0)
                        : null)
                      || pickStage((stage) => stage.status === 'completed')
                      || pickStage(() => true)
                    );
                  })();
                  const inferredRunId = scopedSelectedRunId
                    || inferredStage?.runId
                    || viewProjectRuns.find((run) => run.executorKind === 'prompt')?.runId
                    || null;
                  const inferredStageId = scopedSelectedRunId ? null : inferredStage?.stageId || null;

                  return (
                    <ProjectWorkbench
                      project={viewProject}
                      selectedRunId={inferredRunId}
                      selectedStageId={inferredStageId}
                      agentRuns={viewProjectRuns}
                      templateStages={templateStages}
                      models={models || []}
                      onResume={onResume || (async () => { })}
                      onCancelRun={onCancelRun || (() => { })}
                      onOpenConversation={onOpenConversation}
                      onEvaluateRun={handleEvaluateRun}
                      onNavigateToProject={onSelectProject}
                      systemImprovementProposalId={linkedImprovementProposal?.id || linkedImprovementProposalId}
                      systemImprovementProposalTitle={linkedImprovementProposal?.title || null}
                      onOpenImprovementProposal={onOpenImprovementProposal}
                      template={template}
                      stickySelection
                      defaultSelectionMode={prefersFanOutSelection ? 'fanout-first' : 'auto'}
                      defaultViewMode="list"
                    />
                  );
                })()
              ) : null}

              {/* Department context */}
              {deptConfig && (
                <WorkspaceSurface>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-accent)]">
                          <Building2 className="h-4 w-4" />
                        </span>
                        <span className="text-sm font-semibold text-[var(--app-text)]">{deptConfig.name}</span>
                        <WorkspaceBadge>{deptConfig.type}</WorkspaceBadge>
                      </div>
                      {deptConfig.description && (
                        <p className="mt-3 max-w-4xl text-[13px] leading-6 text-[var(--app-text-soft)] line-clamp-2">
                          {deptConfig.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn('h-9 gap-1.5 rounded-full px-4', workspaceOutlineActionClassName)}
                      onClick={() => setShowDeptContext((prev) => !prev)}
                    >
                      {showDeptContext ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {showDeptContext ? '收起部门上下文' : '查看部门上下文'}
                    </Button>
                  </div>

                  {showDeptContext && (
                    <div className="mt-4 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                      <div className="space-y-3">
                        <WorkspaceSurface padding="sm">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Context Role</div>
                          <div className="mt-1 text-sm text-[var(--app-text)]">Skills / workflows / provider</div>
                        </WorkspaceSurface>
                        <WorkspaceSurface padding="sm" className="space-y-2">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Context Snapshot</div>
                          <div className="text-[12px] text-[var(--app-text-soft)]">{deptConfig.skills.length} skills</div>
                          <div className="text-[12px] text-[var(--app-text-soft)]">{workflowBoundSkills} workflow-bound</div>
                          <div className="text-[12px] text-[var(--app-text-soft)]">{departmentTemplateCount} templates</div>
                          <div className="text-[12px] text-[var(--app-text-soft)]">{departmentWorkspaceBindings.length} workspaces</div>
                          <div className="text-[12px] text-[var(--app-text-soft)]">{departmentContextDocs.length} context docs</div>
                          {deptConfig.provider && <div className="text-[12px] text-[var(--app-text-soft)]">provider: {deptConfig.provider}</div>}
                        </WorkspaceSurface>
                        {departmentWorkspaceBindings.length > 0 && (
                          <WorkspaceSurface padding="sm" className="space-y-2">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Workspace Bindings</div>
                            {departmentWorkspaceBindings.map((binding) => (
                              <div key={binding.workspaceUri} className="rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0 truncate text-[12px] text-[var(--app-text)]">
                                    {binding.alias || workspaceNameFromUri(binding.workspaceUri)}
                                  </div>
                                  <WorkspaceBadge tone={binding.role === 'context' ? 'neutral' : binding.role === 'primary' ? 'info' : 'success'}>
                                    {binding.role === 'primary' ? '主执行' : binding.role === 'execution' ? '执行' : '上下文'}
                                  </WorkspaceBadge>
                                </div>
                                <div className="mt-1 truncate text-[10px] text-[var(--app-text-muted)]">{binding.workspaceUri}</div>
                              </div>
                            ))}
                          </WorkspaceSurface>
                        )}
                        {departmentContextDocs.length > 0 && (
                          <WorkspaceSurface padding="sm" className="space-y-2">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">Context Docs</div>
                            {departmentContextDocs.slice(0, 5).map((documentPath) => (
                              <div key={documentPath} className="truncate text-[11px] text-[var(--app-text-soft)]">
                                {documentPath}
                              </div>
                            ))}
                          </WorkspaceSurface>
                        )}
                        {deptConfig.okr && deptConfig.okr.objectives.length > 0 && (
                          <WorkspaceSurface padding="sm" className="space-y-3">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">OKR Snapshot</div>
                            {deptConfig.okr.objectives.slice(0, 2).map((obj, i) => (
                              <div key={i} className="space-y-1.5">
                                <div className="text-[12px] text-[var(--app-text)]">{obj.title}</div>
                                {obj.keyResults.slice(0, 2).map((kr, j) => {
                                  const pct = kr.target > 0 ? Math.round((kr.current / kr.target) * 100) : 0;
                                  return (
                                    <div key={j} className="space-y-1">
                                      <div className="flex items-center justify-between gap-3 text-[10px] text-[var(--app-text-soft)]">
                                        <span className="truncate">{kr.description}</span>
                                        <span className="tabular-nums">{pct}%</span>
                                      </div>
                                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--app-raised-2)]">
                                        <div
                                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400"
                                          style={{ width: `${Math.min(pct, 100)}%` }}
                                        />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </WorkspaceSurface>
                        )}
                      </div>
                      <div className="min-w-0">
                        {deptConfig.skills.length > 0 ? (
                          <SkillBrowser skills={deptConfig.skills} />
                        ) : (
                          <WorkspaceEmptyBlock title="暂无部门技能定义" />
                        )}
                      </div>
                    </div>
                  )}
                </WorkspaceSurface>
              )}

              {/* ── CEO Decision Card (Phase 6) ── */}
              {viewProject.ceoDecision && (
                <WorkspaceSurface tone={viewProject.ceoDecision.resolved ? 'neutral' : 'warning'} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{viewProject.ceoDecision.resolved ? '🤖' : '⚠️'}</span>
                    <span className="text-sm font-semibold text-[var(--app-text)]">
                      {viewProject.ceoDecision.resolved ? 'AI 决策记录' : '等待 CEO 审批'}
                    </span>
                    <WorkspaceBadge>{viewProject.ceoDecision.action}</WorkspaceBadge>
                    {viewProject.ceoDecision.resolved && (
                      <span className="text-[10px] text-emerald-400/60 ml-auto">✓ 已执行</span>
                    )}
                    {!viewProject.ceoDecision.resolved && (
                      <span className="text-[10px] text-amber-400/70 ml-auto animate-pulse">待审批</span>
                    )}
                  </div>

                  {/* Original command */}
                  <WorkspaceSurface padding="sm">
                    <div className="text-[10px] text-[var(--app-text-muted)] mb-1">CEO 指令</div>
                    <div className="text-sm text-[var(--app-text-soft)] italic">&ldquo;{viewProject.ceoDecision.command}&rdquo;</div>
                  </WorkspaceSurface>

                  {/* AI reasoning */}
                  <WorkspaceSurface padding="sm">
                    <div className="text-[10px] text-[var(--app-text-muted)] mb-1">AI 决策依据</div>
                    <div className="text-[12px] text-[var(--app-text-soft)] leading-relaxed">{viewProject.ceoDecision.reasoning}</div>
                  </WorkspaceSurface>

                  {/* Decision metadata */}
                  <div className="flex flex-wrap gap-3 text-[11px] text-[var(--app-text-muted)]">
                    {viewProject.ceoDecision.departmentName && (
                      <div className="flex items-center gap-1">
                        <span>部门:</span>
                        <span className="text-[var(--app-text-soft)]">{viewProject.ceoDecision.departmentName}</span>
                      </div>
                    )}
                    {viewProject.ceoDecision.templateId && (
                      <div className="flex items-center gap-1">
                        <span>模板:</span>
                        <span className="text-sky-400/60">{viewProject.ceoDecision.templateId}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <span>决策时间:</span>
                      <span className="text-[var(--app-text-soft)]">{new Date(viewProject.ceoDecision.decidedAt).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Interactive suggestions (unresolved only) */}
                  {!viewProject.ceoDecision.resolved && viewProject.ceoDecision.suggestions?.length && (
                    <div className="space-y-2 pt-1">
                      <div className="text-xs font-medium text-amber-300/80 mb-1">请选择操作：</div>
                      {viewProject.ceoDecision.suggestions.map((s, i) => (
                        <button
                          key={i}
                          className="group flex w-full items-start gap-3 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3 text-left transition-all hover:border-amber-500/30 hover:bg-[var(--app-raised)]"
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
                          <span className="mt-0.5 text-[var(--app-text-muted)] transition-colors group-hover:text-amber-600">→</span>
                          <div className="flex-1">
                            <span className="text-sm font-medium text-[var(--app-text)] transition-colors group-hover:text-amber-700">{s.label}</span>
                            <p className="mt-0.5 text-[11px] text-[var(--app-text-soft)]">{s.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </WorkspaceSurface>
              )}

              {!viewProject.pipelineState && !hasProjectPromptRuns ? (
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
                      <WorkspaceSurface tone="warning" className="space-y-3">
                        <div className="flex items-center gap-3 mb-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
                            <AlertTriangle className="h-4 w-4" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-[var(--app-text)]">
                              {hasNeedsDecision ? '需要您的决策' : '待派发'}
                            </h3>
                            <p className="text-xs text-[var(--app-text-soft)]">
                              {hasNeedsDecision
                                ? '系统未找到合适的执行模板，请选择以下操作之一'
                                : '项目已创建，选择模板后可立即开始执行'}
                            </p>
                          </div>
                        </div>

                        {/* Task info */}
                        <div className="mb-3 rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-3">
                          <div className="mb-1 text-xs text-[var(--app-text-muted)]">任务目标</div>
                          <div className="text-sm text-[var(--app-text)]">{viewProject.goal || viewProject.name}</div>
                          {viewProject.workspace && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-xs text-[var(--app-text-muted)]">工作区:</span>
                              <span className="text-xs text-[var(--app-text-soft)]">{viewProject.workspace.split('/').pop()}</span>
                            </div>
                          )}
                        </div>

                        {/* CEO suggestions (needs_decision) */}
                        {hasNeedsDecision && (
                          <div className="space-y-2">
                            <div className="mb-2 text-xs font-medium text-amber-700">可选操作：</div>
                            {projectSuggestions.map((s, i) => (
                              <button
                                key={i}
                                className="group flex w-full items-start gap-3 rounded-xl border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-3 text-left transition-all hover:border-sky-400/30 hover:bg-[var(--app-raised)]"
                                onClick={async () => {
                                  if (s.type === 'reassign_department' && s.payload?.workspace) {
                                    try {
                                      await api.dispatchRun({
                                        workspace: s.payload.workspace,
                                        templateId: s.payload.templateId || '',
                                        stageId: s.payload.stageId || '',
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
                                <span className="mt-0.5 text-[var(--app-text-muted)] transition-colors group-hover:text-sky-600">→</span>
                                <div className="flex-1">
                                  <span className="text-sm font-medium text-[var(--app-text)] transition-colors group-hover:text-sky-700">{s.label}</span>
                                  <p className="mt-0.5 text-[11px] text-[var(--app-text-soft)]">{s.description}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </WorkspaceSurface>

                      {/* Manual dispatch panel */}
                      <WorkspaceSurface className="space-y-3" padding="lg">
                        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--app-text-muted)]">手动选择模板派发</h4>
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
                        <p className="mt-2 text-[11px] text-[var(--app-text-soft)]">
                          或者 <button onClick={() => setIsGenerateDialogOpen(true)} className="text-sky-400 hover:underline">用 AI 生成新模板</button>
                        </p>
                      </WorkspaceSurface>
                    </div>
                  );
                })()
              ) : null}
            </div>
          );
        })()
      ) : (
        /* ── Browse mode: reference-aligned Projects operating surface ── */
        <div className="space-y-3">

          {ceoToast && (
            <div className={cn(
              'rounded-[20px] border px-4 py-3 text-sm whitespace-pre-line',
              ceoToast.success
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-700'
                : 'border-amber-400/20 bg-amber-400/10 text-amber-700',
            )}>
              {ceoToast.message}
            </div>
          )}

          <div className="grid items-start gap-3 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[310px_minmax(0,1fr)_310px] 2xl:grid-cols-[330px_minmax(0,1fr)_340px]">
            <WorkspaceSurface className={cn('space-y-3', PROJECT_SURFACE_CLASS)} padding="sm">
              <WorkspaceSectionHeader
                title="项目树"
                description={projectSearch.trim() || projectFilter !== 'all'
                  ? `${filteredProjects.length} visible / ${sortedProjects.length} total`
                  : '先建部门，再在部门下推进项目'}
                icon={<FolderKanban className="h-4 w-4" />}
                actions={(
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={cn('h-8 gap-1.5 rounded-[8px]', workspaceOutlineActionClassName)}
                      onClick={() => void handleCreateDepartment()}
                    >
                      <Building2 className="h-4 w-4" />
                      新建部门
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1.5 rounded-[8px]"
                      onClick={openCreateDialog}
                    >
                      <Plus className="h-4 w-4" />
                      新建项目
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]"
                        aria-label="Filter projects"
                      >
                        <Filter className="h-3.5 w-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        {PROJECT_FILTER_OPTIONS.map((option) => (
                          <DropdownMenuItem key={option.value} onClick={() => setProjectFilter(option.value)}>
                            <span className="flex h-4 w-4 items-center justify-center">
                              {projectFilter === option.value ? <Check className="h-3.5 w-3.5" /> : null}
                            </span>
                            {option.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              />

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--app-text-muted)]" />
                <Input
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder="搜索项目、部门或模板"
                  className={cn('h-9 rounded-[8px] pl-9 text-sm', workspaceFieldClassName)}
                />
              </div>

              {departmentActionError ? (
                <div className="rounded-[8px] border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
                  {departmentActionError}
                </div>
              ) : null}

              {filteredProjects.length === 0 ? (
                <WorkspaceEmptyBlock
                  icon={<Search className="h-5 w-5" />}
                  title="没有匹配项目"
                  description="调整搜索或筛选条件后再查看，或者先创建一个部门。"
                >
                  <Button size="sm" className="mt-4 gap-2 rounded-[8px]" onClick={() => void handleCreateDepartment()}>
                    <Building2 className="h-4 w-4" />
                    新建部门
                  </Button>
                </WorkspaceEmptyBlock>
              ) : (
                <div className="max-h-[670px] space-y-3 overflow-y-auto pr-1">
                  {visibleTreeSections.map(section => (
                    <div key={section.key} className="space-y-2">
                      <div className="flex h-8 items-center justify-between gap-3 px-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-muted)]" />
                          {section.key.startsWith('status-') ? (
                            <FolderKanban className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-muted)]" />
                          ) : (
                            <Building2 className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-muted)]" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-[var(--app-text)]">{section.title}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[10px] text-[var(--app-text-muted)]">
                          {!section.key.startsWith('status-') ? (
                            <button
                              type="button"
                              className="inline-flex h-6 items-center rounded-full border border-[var(--app-border-soft)] px-2 text-[10px] transition-colors hover:bg-[var(--app-raised)] hover:text-[var(--app-text)]"
                              onClick={() => openDepartmentDialog(section.primaryWorkspaceUri)}
                            >
                              设置
                            </button>
                          ) : null}
                          <WorkspaceStatusDot tone={section.tone} pulse={section.tone === 'info'} />
                          <span>{section.activeCount > 0 ? '进行中' : section.subtitle}</span>
                          <span>{section.totalCount}</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        {section.projects.map(project => {
                          const progress = getProjectProgress(project);
                          const attentionCount = getProjectAttentionCount(project, agentRuns);
                          const itemActive = browseFocusProject?.projectId === project.projectId;

                          return (
                            <div
                              key={project.projectId}
                              role="button"
                              tabIndex={0}
                              className={cn(
                'group flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-1.5 text-left transition-all',
                                itemActive
                                  ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]'
                                  : 'text-[var(--app-text-soft)] hover:bg-[var(--app-raised)] hover:text-[var(--app-text)]',
                              )}
                              onClick={() => setBrowseFocusedProjectId(project.projectId)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  setBrowseFocusedProjectId(project.projectId);
                                }
                              }}
                            >
                              <WorkspaceStatusDot tone={getStatusTone(project.status)} pulse={project.status === 'active'} className="shrink-0" />
                              <div className="min-w-0 flex-1">
                                <div className={cn('truncate text-sm font-medium', itemActive ? 'text-[var(--app-accent)]' : 'text-[var(--app-text)]')}>
                                  {project.name}
                                </div>
                                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--app-text-muted)]">
                                  <span className="truncate">{project.goal || getWorkspaceLabel(project.workspace, workspaces, departments)}</span>
                                  <span className="shrink-0 tabular-nums">{progress.percent}%</span>
                                </div>
                              </div>
                              <span className={cn('shrink-0 rounded-full px-1.5 py-0.5 text-[10px]', attentionCount > 0 ? 'bg-amber-400/10 text-amber-700' : 'text-[var(--app-text-muted)]')}>
                                {attentionCount > 0 ? attentionCount : project.status}
                              </span>
                            </div>
                          );
                        })}
                        {section.hiddenCount > 0 ? (
                          <button
                            type="button"
                            className="flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left text-[11px] text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-raised)] hover:text-[var(--app-text)]"
                            onClick={() => setProjectSearch(section.title)}
                          >
                            <span>查看其余 {section.hiddenCount} 个项目</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {extraOpenSectionCount > 0 ? (
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-3 text-left transition-colors hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface)]"
                      onClick={() => setShowAllTreeSections((prev) => !prev)}
                    >
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--app-text)]">
                        <FolderKanban className="h-4 w-4 text-[var(--app-accent)]" />
                        {showAllTreeSections ? '收起其他部门' : `查看其余 ${extraOpenSectionCount} 个部门`}
                      </span>
                      <ChevronDown className={cn('h-4 w-4 text-[var(--app-text-muted)] transition-transform', showAllTreeSections && 'rotate-180')} />
                    </button>
                  ) : null}
                  {closedProjects.length > 0 ? (
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] px-3 py-3 text-left transition-colors hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface)]"
                      onClick={() => setProjectFilter(projectFilter === 'completed' ? 'all' : 'completed')}
                    >
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--app-text)]">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        已完成项目
                      </span>
                      <span className="text-xs font-medium text-[var(--app-text-muted)]">{closedProjects.length}</span>
                    </button>
                  ) : null}
                </div>
              )}
            </WorkspaceSurface>

            <div className="space-y-3">
              <WorkspaceSurface className={cn('space-y-3', PROJECT_SURFACE_CLASS)} padding="sm">
                {browseFocusProject && browseFocusProgress ? (() => {
                  const templateId = browseFocusProject.pipelineState?.templateId || browseFocusProject.templateId;
                  const template = templates?.find(item => item.id === templateId);
                  const observedStageItems = browseFocusStages.slice(0, 5).map((stage) => ({
                    key: stage.stageId,
                    title: stage.title || template?.stages?.[stage.stageId]?.title || stage.stageId,
                    status: stage.status,
                    detail: stage.status === 'running'
                      ? `进行中 · ${browseFocusProgress.percent}%`
                      : stage.status === 'completed'
                        ? '已完成'
                        : stage.status === 'failed' || stage.status === 'blocked'
                          ? '需要处理'
                          : '待开始',
                  }));
                  const stageItems = observedStageItems;
                  const hasObservedStages = stageItems.length > 0;
                  const templateStageCount = template?.pipeline?.length || 0;

                  return (
                    <>
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex min-w-0 gap-3">
	                          <WorkspaceIconFrame tone={browseFocusAttentionCount > 0 ? 'warning' : 'info'} className="h-11 w-11 rounded-[10px]">
                            <Activity className="h-5 w-5" />
                          </WorkspaceIconFrame>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[var(--app-text-soft)]">
                              执行工作台
                            </div>
                            <h3 className="mt-1 truncate text-2xl font-semibold tracking-[0] text-[var(--app-text)]">
                              {browseFocusProject.name}
                            </h3>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <WorkspaceBadge tone="neutral">{getWorkspaceLabel(browseFocusProject.workspace, workspaces, departments)}</WorkspaceBadge>
                              <StatusBadge status={browseFocusProject.status} />
                              <WorkspaceBadge tone="info">{getTemplateLabel(templateId, templates)}</WorkspaceBadge>
                              <span className="text-xs text-[var(--app-text-muted)]">
                                {formatRelativeTime(getProjectActivityTime(browseFocusProject, browseFocusRuns), locale)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
	                            className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]"
                            aria-label="Star project"
                          >
                            <Star className="h-4 w-4" />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger
	                              className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] text-[var(--app-text-muted)] transition-colors hover:bg-[var(--app-raised-2)] hover:text-[var(--app-text)]"
                              aria-label="More project actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={() => requestEditProject(browseFocusProject)}>
                                <Pencil className="h-4 w-4" />
                                编辑项目
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openDispatchProject(browseFocusProject)}>
                                <Play className="h-4 w-4" />
                                新建运行
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => requestArchiveProject(browseFocusProject, browseFocusProject.status !== 'archived')}>
                                {browseFocusProject.status === 'archived' ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                                {browseFocusProject.status === 'archived' ? '恢复项目' : '归档项目'}
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onClick={() => requestDeleteProject(browseFocusProject.projectId)}>
                                <Trash2 className="h-4 w-4" />
                                删除项目
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button
                            variant="outline"
	                            className={cn('h-9 gap-2 rounded-[8px] px-4', workspaceOutlineActionClassName)}
                            onClick={() => onSelectProject?.(browseFocusProject.projectId)}
                          >
                            打开详情
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

	                      <p className="max-w-4xl text-sm leading-6 text-[var(--app-text-soft)]">
                        目标：{browseFocusProject.goal || '该项目尚未补充目标说明。'}
                      </p>

	                      <div className={cn(PROJECT_INSET_CARD_CLASS, 'p-4')}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-[var(--app-text)]">阶段进度</div>
                          <div className="text-xs text-[var(--app-text-muted)]">
                            {hasObservedStages
                              ? browseFocusProgress.label
                              : templateStageCount > 0
                                ? `${templateStageCount} 个模板阶段，尚未生成运行状态`
                                : '尚无阶段数据'}
                          </div>
                        </div>
                        {hasObservedStages ? (
                          <div
                            className="relative mt-5 grid gap-3"
                            style={{ gridTemplateColumns: `repeat(${stageItems.length}, minmax(0, 1fr))` }}
                          >
                            <div className="absolute left-5 right-5 top-4 h-px bg-[var(--app-border-soft)]" />
                            {stageItems.map((stage, index) => {
                              const done = stage.status === 'completed' || stage.status === 'skipped';
                              const active = stage.status === 'running';
                              const failed = stage.status === 'failed' || stage.status === 'blocked';

                              return (
                                <div key={stage.key} className="relative z-10 min-w-0 text-center">
                                  <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full border bg-[var(--app-surface)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                                    <span className={cn(
                                      'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                                      done && 'bg-emerald-500 text-white',
                                      active && 'bg-[var(--app-accent)] text-white',
                                      failed && 'bg-red-500 text-white',
                                      !done && !active && !failed && 'bg-[var(--app-raised-2)] text-[var(--app-text-muted)]',
                                    )}>
                                      {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                                    </span>
                                  </div>
                                  <div className="mt-2 truncate text-[11px] font-medium text-[var(--app-text)]">{stage.title}</div>
                                  <div className={cn(
                                    'mt-1 truncate text-[10px]',
                                    done && 'text-emerald-700',
                                    active && 'text-[var(--app-accent)]',
                                    failed && 'text-red-600',
                                    !done && !active && !failed && 'text-[var(--app-text-muted)]',
                                  )}>{stage.detail}</div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-[8px] border border-dashed border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-5 text-sm leading-6 text-[var(--app-text-soft)]">
                            {templateStageCount > 0
                              ? `已绑定 ${getTemplateLabel(templateId, templates)}，首次派发后这里会显示真实阶段运行状态。`
                              : '当前项目还没有可展示的 pipeline 阶段数据。'}
                          </div>
                        )}
                      </div>

	                      <div className={PROJECT_INSET_CARD_CLASS}>
                        <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border-soft)] px-4 py-3">
                          <div className="text-sm font-semibold text-[var(--app-text)]">最近运行</div>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--app-accent)] hover:underline"
                            onClick={() => onSelectProject?.(browseFocusProject.projectId)}
                          >
                            查看全部运行
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {browseFocusContextRuns.length > 0 ? (
                          <div className="divide-y divide-[var(--app-border-soft)]">
                            {browseFocusContextRuns.slice(0, 5).map(run => (
                              <button
                                key={run.runId}
                                type="button"
                                className="grid w-full grid-cols-[minmax(0,1fr)] items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-[var(--app-surface)] sm:grid-cols-[minmax(0,1fr)_120px_72px_24px] sm:gap-3"
                                onClick={() => onSelectRun?.(run.runId, run.projectId)}
                              >
                                <div className="flex min-w-0 items-start gap-3">
                                  <span className={cn(
                                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                                    run.status === 'completed' && 'bg-emerald-400/12 text-emerald-700',
                                    (run.status === 'failed' || run.status === 'blocked') && 'bg-red-400/12 text-red-600',
                                    (run.status === 'running' || run.status === 'starting' || run.status === 'queued') && 'bg-sky-400/12 text-sky-700',
                                    !['completed', 'failed', 'blocked', 'running', 'starting', 'queued'].includes(run.status) && 'bg-[var(--app-raised-2)] text-[var(--app-text-muted)]',
                                  )}>
                                    <Activity className="h-4 w-4" />
                                  </span>
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-[var(--app-text)]">{getRunDisplayTitle(run)}</div>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--app-text-muted)]">
                                      <span>{run.status}</span>
                                      <span>{formatRelativeTime(run.createdAt, locale)}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="hidden truncate text-xs text-[var(--app-text-soft)] sm:block">{getRunOwnerLabel(run, workspaces, departments)}</div>
                                <div className="hidden text-right text-xs tabular-nums text-[var(--app-text-muted)] sm:block">{getRunDuration(run)}</div>
                                <div className="hidden justify-end sm:flex">
                                  <WorkspaceStatusDot tone={getStatusTone(run.status)} />
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <WorkspaceEmptyBlock
                            icon={<Workflow className="h-5 w-5" />}
                            title="暂无执行记录"
                            description="选择模板或生成新模板后，这里会显示项目运行。"
                          >
                            <Button
                              size="sm"
                              className="mt-4 gap-2 rounded-full"
                              onClick={(event) => openDispatchDialog(event, browseFocusProject)}
                            >
                              <Play className="h-3.5 w-3.5" />
                              派发项目
                            </Button>
                          </WorkspaceEmptyBlock>
                        )}
                      </div>
                    </>
                  );
                })() : (
                  <WorkspaceEmptyBlock
                    icon={<FolderKanban className="h-5 w-5" />}
                    title="暂无项目可展示"
                    description="创建项目后会显示项目树和执行工作台。"
                  />
                )}
              </WorkspaceSurface>

	              <div className="grid gap-3 xl:grid-cols-2">
	                <WorkspaceSurface className={PROJECT_SURFACE_CLASS} padding="sm">
                  <WorkspaceSectionHeader
                    title={`阻塞项 ${browseFocusAllBlockers.length}`}
                    description="从项目状态、审批和最近运行中提取"
                    icon={<AlertTriangle className="h-4 w-4" />}
                    actions={browseFocusAllBlockers.length > 0 ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--app-accent)] hover:underline"
                        onClick={() => browseFocusProject ? onSelectProject?.(browseFocusProject.projectId) : undefined}
                      >
                        查看全部阻塞项
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  />
                  <div className="mt-4 space-y-2">
                    {browseFocusAllBlockers.length > 0 ? (
                      browseFocusAllBlockers.map((item, index) => (
                        <button
                          key={`${item.title}-${index}`}
                          type="button"
                          className={cn(
	                            'flex w-full items-start gap-3 rounded-[8px] border p-3 text-left transition-colors',
                            item.tone === 'danger' && 'border-red-200 bg-red-50/80 hover:bg-red-50',
                            item.tone === 'warning' && 'border-amber-200 bg-amber-50/80 hover:bg-amber-50',
                            item.tone === 'info' && 'border-sky-200 bg-sky-50/80 hover:bg-sky-50',
                            item.tone === 'neutral' && 'border-[var(--app-border-soft)] bg-[var(--app-raised)] hover:bg-[var(--app-surface)]',
                          )}
                          onClick={() => {
                            const targetProjectId = item.projectId || browseFocusProject?.projectId;
                            if (targetProjectId) onSelectProject?.(targetProjectId);
                          }}
                        >
                          <WorkspaceStatusDot tone={item.tone} pulse={item.tone === 'danger'} className="mt-1" />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-[var(--app-text)]">{item.title}</div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--app-text-soft)]">{item.detail}</div>
                          </div>
                          <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[var(--app-text-muted)]" />
                        </button>
                      ))
                    ) : (
                      <WorkspaceEmptyBlock
                        icon={<ShieldCheck className="h-5 w-5" />}
                        title="暂无阻塞项"
                        description="当前聚焦项目没有失败运行、待审批或暂停状态。"
                      />
                    )}
                  </div>
                </WorkspaceSurface>

	                <WorkspaceSurface className={PROJECT_SURFACE_CLASS} padding="sm">
                  <WorkspaceSectionHeader
                    title={`下一步 ${browseFocusAllNextSteps.length}`}
                    description="保留可执行操作，不进入详情也能推进"
                    icon={<ListChecks className="h-4 w-4" />}
                    actions={browseFocusAllNextSteps.length > 0 ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--app-accent)] hover:underline"
                        onClick={() => browseFocusProject ? onSelectProject?.(browseFocusProject.projectId) : undefined}
                      >
                        查看全部下一步
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  />
                  <div className="mt-4 space-y-2">
                    {browseFocusAllNextSteps.length > 0 ? (
                      browseFocusAllNextSteps.map((item, index) => (
                        <button
                          key={`${item.title}-${index}`}
                          type="button"
                          className={cn(
	                            'flex w-full items-center gap-3 rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-3 text-left transition-colors hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface)]',
                            item.action === 'dispatch' && 'border-sky-200 bg-sky-50/70',
                          )}
                          onClick={() => {
                            if (!browseFocusProject) return;
                            if (item.action === 'dispatch') {
                              openDispatchProject(browseFocusProject);
                              return;
                            }
                            if (item.action === 'detail') {
                              onSelectProject?.(item.projectId || browseFocusProject.projectId);
                              return;
                            }
                            setIsGenerateDialogOpen(true);
                          }}
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--app-raised-2)] text-[var(--app-accent)]">
                            {item.action === 'dispatch' ? <Play className="h-4 w-4" /> : item.action === 'detail' ? <ArrowRight className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-[var(--app-text)]">{item.title}</div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--app-text-soft)]">{item.detail}</div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <WorkspaceEmptyBlock title="暂无下一步" description="创建或聚焦项目后会生成执行动作。" />
                    )}
                  </div>
                </WorkspaceSurface>
              </div>
            </div>

	            <aside className="space-y-3 lg:col-span-2 xl:col-span-1">
              <WorkspaceSurface className={cn('space-y-3', PROJECT_SURFACE_CLASS)} padding="sm">
                <WorkspaceSectionHeader
                  title="执行概览"
                  description="只展示真实 pipeline 和运行投影"
                  icon={<Activity className="h-4 w-4" />}
                />
                {browseFocusProject && browseFocusProgress ? (() => {
                  const runTotal = browseFocusRuns.length;
                  const completedRunCount = browseFocusRuns.filter((run) => run.status === 'completed').length;
                  const activeStageCount = browseFocusStages.filter((stage) => stage.status === 'running').length;
                  const latestRun = browseFocusRuns[0] || browseFocusContextRuns[0] || null;

                  return (
                    <div className={cn('space-y-4 p-4', PROJECT_INSET_CARD_CLASS)}>
                      <div className="flex items-center justify-between gap-3">
                        <StatusBadge status={browseFocusProject.status} />
                        <span className="text-xs text-[var(--app-text-muted)]">
                          {formatRelativeTime(getProjectActivityTime(browseFocusProject, browseFocusRuns), locale)}
                        </span>
                      </div>

                      {browseFocusStages.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3 text-xs text-[var(--app-text-soft)]">
                            <span>阶段完成</span>
                            <span className="font-medium tabular-nums text-[var(--app-text)]">{browseFocusProgress.completed}/{browseFocusProgress.total}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-[var(--app-raised-2)]">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                browseFocusAttentionCount > 0 ? 'bg-amber-500' : 'bg-emerald-500',
                              )}
                              style={{ width: `${Math.max(4, browseFocusProgress.percent)}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-[8px] border border-dashed border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-2 text-xs leading-5 text-[var(--app-text-soft)]">
                          暂无阶段运行数据，项目派发后会显示真实 pipeline 状态。
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: '项目运行', value: runTotal > 0 ? `${completedRunCount}/${runTotal}` : '0' },
                          { label: '活跃阶段', value: String(activeStageCount) },
                          { label: '关注项', value: String(browseFocusAttentionCount) },
                          { label: '子项目', value: String(browseFocusChildren.length) },
                        ].map((item) => (
                          <div key={item.label} className="rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-2">
                            <div className="text-[11px] text-[var(--app-text-muted)]">{item.label}</div>
                            <div className="mt-1 text-sm font-semibold tabular-nums text-[var(--app-text)]">{item.value}</div>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-1 text-xs text-[var(--app-text-soft)]">
                        <div className="flex items-center justify-between gap-3">
                          <span>模板</span>
                          <span className="truncate text-right text-[var(--app-text)]">{getTemplateLabel(browseFocusProject.pipelineState?.templateId || browseFocusProject.templateId, templates)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>最新执行</span>
                          <span className="truncate text-right text-[var(--app-text)]">
                            {latestRun ? getRunDisplayTitle(latestRun) : '暂无执行记录'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })() : (
                  <WorkspaceEmptyBlock title="暂无执行概览" />
                )}
              </WorkspaceSurface>

              <WorkspaceSurface className={cn('space-y-3', PROJECT_SURFACE_CLASS)} padding="sm">
                <WorkspaceSectionHeader
                  title="执行工作区"
                  description="真实工作区绑定和部门配置"
                  icon={<Building2 className="h-4 w-4" />}
                />
                {browseFocusProject ? (
                  (() => {
                    const workspaceLabel = getWorkspaceLabel(browseFocusProject.workspace, workspaces, departments);
                    const workflowBoundCount = browseFocusDepartment?.skills.filter((skill) => skill.workflowRef?.trim()).length || 0;
                    const templateCount = browseFocusDepartment?.templateIds?.length || 0;
                    const skillCount = browseFocusDepartment?.skills.length || 0;
                    const primaryBinding = browseFocusWorkspaceBindings.find((binding) => binding.role === 'primary') || null;

                    return (
	                      <div className={cn(PROJECT_INSET_CARD_CLASS, 'p-4')}>
                        <div className="flex items-start gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-[var(--app-accent)] text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)]">
                            <Building2 className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-[var(--app-text)]">{workspaceLabel}</div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--app-text-soft)]">
                              {browseFocusProject.workspace || '未绑定工作区'}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {browseFocusDepartment?.type ? <WorkspaceBadge>{browseFocusDepartment.type}</WorkspaceBadge> : null}
                          {browseFocusDepartment?.provider ? <WorkspaceBadge tone="info">{browseFocusDepartment.provider}</WorkspaceBadge> : null}
                          <WorkspaceBadge tone="neutral">{browseFocusProject.projectType || '未标注类型'}</WorkspaceBadge>
                          {primaryBinding ? (
                            <WorkspaceBadge tone="success">
                              默认执行：{primaryBinding.alias || workspaceNameFromUri(primaryBinding.workspaceUri)}
                            </WorkspaceBadge>
                          ) : null}
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          {[
                            { label: '技能', value: String(skillCount) },
                            { label: '工作流技能', value: String(workflowBoundCount) },
                            { label: '模板', value: String(templateCount) },
                            { label: '绑定目录', value: String(browseFocusWorkspaceBindings.length) },
                          ].map((item) => (
                            <div key={item.label} className="rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-2">
                              <div className="text-[11px] text-[var(--app-text-muted)]">{item.label}</div>
                              <div className="mt-1 text-sm font-semibold tabular-nums text-[var(--app-text)]">{item.value}</div>
                            </div>
                          ))}
                        </div>
                        {browseFocusWorkspaceBindings.length > 0 ? (
                          <div className="mt-4 space-y-2">
                            {browseFocusWorkspaceBindings.map((binding) => (
                              <div key={binding.workspaceUri} className="rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-[12px] font-medium text-[var(--app-text)]">
                                      {binding.alias || workspaceNameFromUri(binding.workspaceUri)}
                                    </div>
                                    <div className="mt-1 truncate text-[10px] text-[var(--app-text-muted)]">{binding.workspaceUri}</div>
                                  </div>
                                  <WorkspaceBadge tone={binding.role === 'context' ? 'neutral' : binding.role === 'primary' ? 'info' : 'success'}>
                                    {binding.role === 'primary' ? '主执行' : binding.role === 'execution' ? '执行' : '上下文'}
                                  </WorkspaceBadge>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {browseFocusContextDocs.length > 0 ? (
                          <div className="mt-4 rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-3">
                            <div className="text-[11px] font-medium text-[var(--app-text)]">潜在上下文文档</div>
                            <div className="mt-2 space-y-1">
                              {browseFocusContextDocs.slice(0, 4).map((documentPath) => (
                                <div key={documentPath} className="truncate text-[10px] text-[var(--app-text-muted)]">
                                  {documentPath}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="mt-4 text-[11px] text-[var(--app-text-muted)]">
                          绑定模板：<span className="text-[var(--app-text)]">{getTemplateLabel(browseFocusProject.pipelineState?.templateId || browseFocusProject.templateId, templates)}</span>
                        </div>
                        {browseFocusDepartment ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className={cn('mt-4 gap-2 rounded-[8px]', workspaceOutlineActionClassName)}
                            onClick={() => openDepartmentDialog(
                              browseFocusDepartment
                                ? getDepartmentGroupKey(
                                    browseFocusDepartment,
                                    browseFocusProject.workspace || '',
                                    workspaceLabel,
                                  )
                                : browseFocusProject.workspace,
                            )}
                          >
                            <Building2 className="h-4 w-4" />
                            编辑部门
                          </Button>
                        ) : null}
                      </div>
                    );
                  })()
                ) : (
                  <WorkspaceEmptyBlock title="暂无执行工作区" />
                )}
              </WorkspaceSurface>

              <WorkspaceSurface className={cn('space-y-3', PROJECT_SURFACE_CLASS)} padding="sm">
                <WorkspaceSectionHeader
                  title="关联运行"
                  description="子项目和最近执行"
                  icon={<Link2 className="h-4 w-4" />}
                  actions={browseFocusProject ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--app-accent)] hover:underline"
                      onClick={() => onSelectProject?.(browseFocusProject.projectId)}
                    >
                      查看全部
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                />
                <div className="space-y-2">
                  {browseFocusChildren.slice(0, 3).map(child => (
                    <button
                      key={child.projectId}
                      type="button"
	                      className="flex w-full items-start gap-3 rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-3 text-left transition-colors hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface)]"
                      onClick={() => onSelectProject?.(child.projectId)}
                    >
                      <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-[var(--app-accent)]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--app-text)]">{child.name}</div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--app-text-soft)]">
                          <WorkspaceStatusDot tone={getStatusTone(child.status)} />
                          <span>{child.status}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                  {browseFocusChildren.length === 0 && browseFocusContextRuns.length === 0 ? (
                    <WorkspaceEmptyBlock title="暂无关联推进" />
                  ) : null}
                  {browseFocusContextRuns.slice(0, browseFocusChildren.length > 0 ? 2 : 4).map(run => (
                    <button
                      key={run.runId}
                      type="button"
	                      className="flex w-full items-start gap-3 rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-raised)] p-3 text-left transition-colors hover:border-[var(--app-border-strong)] hover:bg-[var(--app-surface)]"
                      onClick={() => onSelectRun?.(run.runId, run.projectId)}
                    >
                      <Activity className="mt-0.5 h-4 w-4 shrink-0 text-[var(--app-accent)]" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[var(--app-text)]">{getRunDisplayTitle(run)}</div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--app-text-soft)]">
                          <WorkspaceStatusDot tone={getStatusTone(run.status)} pulse={run.status === 'running'} />
                          <span>{run.status}</span>
                          <span>{formatRelativeTime(run.createdAt, locale)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </WorkspaceSurface>

              <WorkspaceSurface className={cn('space-y-3', PROJECT_SURFACE_CLASS)} padding="sm">
                <WorkspaceSectionHeader
                  title="快捷操作"
                  icon={<Sparkles className="h-4 w-4" />}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={browseFocusProject ? () => openDispatchProject(browseFocusProject) : openCreateDialog}
	                    className="justify-start gap-2 rounded-[8px]"
                  >
                    {browseFocusProject ? <Play className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {browseFocusProject ? '新建运行' : '新建项目'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={openCreateDialog}
	                    className={cn('justify-start gap-2 rounded-[8px]', workspaceOutlineActionClassName)}
                  >
                    <Plus className="h-4 w-4" />
                    创建项目
                  </Button>
                  {browseFocusProject ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={(event) => openEditDialog(event, browseFocusProject)}
	                        className={cn('justify-start gap-2 rounded-[8px]', workspaceOutlineActionClassName)}
                      >
                        <Pencil className="h-4 w-4" />
                        编辑项目
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className={cn(
                            'inline-flex h-10 items-center justify-start gap-2 rounded-[8px] border px-3 text-sm font-medium',
                            workspaceOutlineActionClassName,
                          )}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                          更多操作
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setIsGenerateDialogOpen(true)}>
                            <Sparkles className="h-4 w-4" />
                            AI 生成
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openDepartmentDialog(
                              browseFocusDepartment
                                ? getDepartmentGroupKey(
                                    browseFocusDepartment,
                                    browseFocusProject.workspace || '',
                                    getWorkspaceLabel(browseFocusProject.workspace, workspaces, departments),
                                  )
                                : browseFocusProject.workspace,
                            )}
                          >
                            <Building2 className="h-4 w-4" />
                            部门设置
                          </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => requestArchiveProject(browseFocusProject, browseFocusProject.status !== 'archived')}>
                            {browseFocusProject.status === 'archived' ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                            {browseFocusProject.status === 'archived' ? '恢复项目' : '归档项目'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => requestDeleteProject(browseFocusProject.projectId)}
                          >
                            <Trash2 className="h-4 w-4" />
                            删除项目
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => setIsGenerateDialogOpen(true)}
                        className={cn('justify-start gap-2 rounded-[8px]', workspaceOutlineActionClassName)}
                      >
                        <Sparkles className="h-4 w-4" />
                        AI Generate
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className={cn(
                            'inline-flex h-10 items-center justify-start gap-2 rounded-[8px] border px-3 text-sm font-medium',
                            workspaceOutlineActionClassName,
                          )}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                          更多操作
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => void handleCreateDepartment()}>
                            <Building2 className="h-4 w-4" />
                            新建部门
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              </WorkspaceSurface>
            </aside>
          </div>
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
                className={workspaceFieldClassName}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">{t('projects.projectGoal')}</label>
              <Textarea
                value={formData.goal}
                onChange={(e) => setFormData({ ...formData, goal: e.target.value })}
                placeholder="What are we building?"
                className={cn('min-h-[100px]', workspaceFieldClassName)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">{t('projects.workspace')}</label>
              <NativeSelect
                value={formData.workspace || ''}
                onChange={(e) => setFormData({ ...formData, workspace: e.target.value })}
                className={workspaceFieldClassName}
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
                className={workspaceFieldClassName}
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
                className={workspaceFieldClassName}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--app-text-soft)]">{t('projects.projectGoal')}</label>
              <Textarea
                value={formData.goal}
                onChange={(e) => setFormData({ ...formData, goal: e.target.value })}
                className={cn('min-h-[100px]', workspaceFieldClassName)}
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
                  className={cn('flex-1', workspaceFieldClassName)}
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
                        <span className="ml-1 font-mono text-[10px] text-[var(--app-text-muted)]">({lintResult.format})</span>
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
                    <span className="text-[10px] text-[var(--app-text-muted)]">{convertMessage}</span>
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
                className={cn('min-h-[120px]', workspaceFieldClassName)}
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

      <LocalFolderImportDialog
        open={createDepartmentDialogOpen}
        title="新建部门"
        description="先指定一个部门主目录。导入成功后会立即进入部门配置弹窗，你可以继续补齐部门资料、绑定更多目录和上下文文档。"
        inputLabel="部门主目录"
        placeholder="/Users/xxx/my-project"
        helperText={isTauriDesktop()
          ? '桌面模式下可直接浏览本机文件夹；也可以手动输入绝对路径。'
          : '当前是 Web 模式，请输入本机绝对路径。若要使用系统文件夹选择器，请从 Tauri 桌面壳进入。'}
        confirmLabel="导入并继续配置"
        value={createDepartmentPath}
        error={departmentActionError}
        submitting={creatingDepartment}
        supportsNativeBrowse={isTauriDesktop()}
        onValueChange={setCreateDepartmentPath}
        onOpenChange={(open) => {
          setCreateDepartmentDialogOpen(open);
          if (!open) {
            setCreatingDepartment(false);
            setCreateDepartmentPath('');
            setDepartmentActionError(null);
          }
        }}
        onBrowse={handleBrowseCreateDepartment}
        onConfirm={handleConfirmCreateDepartment}
      />

      {departmentDialogWorkspace && departmentDialogConfig ? (
        <DepartmentSetupDialog
          workspaceUri={departmentDialogWorkspace.uri}
          workspaceName={departmentDialogWorkspace.name}
          initialConfig={departmentDialogConfig}
          availableWorkspaces={allDepartmentWorkspaces}
          open={!!departmentDialogWorkspaceUri}
          onOpenChange={(open) => {
            if (!open) {
              setDepartmentDialogWorkspaceUri(null);
            }
          }}
          onWorkspaceImported={(workspace) => {
            setExtraDepartmentWorkspaces((prev) => {
              const merged = new Map(prev.map((entry) => [entry.uri, entry]));
              merged.set(workspace.uri, workspace);
              return [...merged.values()];
            });
            onRefresh?.();
          }}
          onSaved={(config) => {
            _onDepartmentSaved?.(departmentDialogWorkspace.uri, config);
            setDepartmentDialogWorkspaceUri(null);
            onRefresh?.();
          }}
        />
      ) : null}

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
            <DialogTitle>{t('common.confirm') || '确认'}</DialogTitle>
          </DialogHeader>
          <p className="py-4 text-sm text-[var(--app-text-soft)]">{confirmDialog?.message}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDialog(null)}>{t('common.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={() => { confirmDialog?.onConfirm(); setConfirmDialog(null); }}
            >
              {t('common.confirm') || '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
