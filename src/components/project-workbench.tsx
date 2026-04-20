'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  Project,
  AgentRun,
  ModelConfig,
  ResumeAction,
  TemplateStageSummaryFE,
  RoleProgressFE,
  TemplateSummaryFE,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useI18n } from '@/components/locale-provider';
import PipelineStageCard, { makeRoleKey } from '@/components/pipeline-stage-card';
import StageDetailPanel from '@/components/stage-detail-panel';
import RoleDetailPanel from '@/components/role-detail-panel';
import ProjectOpsPanel from '@/components/project-ops-panel';
import ProjectDagView from '@/components/project-dag-view';
import DeliverablesPanel from '@/components/deliverables-panel';
import PromptRunsSection from '@/components/prompt-runs-section';
import AgentRunDetail from '@/components/agent-run-detail';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Layers, ArrowRight, Activity, List, Network, ShieldCheck, Package } from 'lucide-react';

// ---------------------------------------------------------------------------
// Helper: resolve human-readable stage title from template stage summaries
// ---------------------------------------------------------------------------

export function resolveStageTitle(
  stageId: string | undefined,
  templateStages?: Record<string, TemplateStageSummaryFE>,
  fallbackTitle?: string,
): string {
  if (!stageId) return 'Unknown Stage';
  return fallbackTitle || templateStages?.[stageId]?.title || stageId;
}

// ---------------------------------------------------------------------------
// Selection target type
// ---------------------------------------------------------------------------

type SelectionTarget =
  | { type: 'stage'; stageIndex: number }
  | { type: 'role'; stageIndex: number; roleKey: string }
  | { type: 'prompt-run'; runId: string };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProjectWorkbenchProps {
  project: Project;
  agentRuns: AgentRun[];
  templateStages: Record<string, TemplateStageSummaryFE>;
  models: ModelConfig[];
  onResume: (projectId: string, stageId: string, action: ResumeAction, branchIndex?: number) => Promise<void>;
  onCancelRun: (runId: string) => void;
  onOpenConversation?: (id: string, title: string) => void;
  onEvaluateRun?: (runId: string) => Promise<void>;
  /** Template definition — used to determine if DAG tab should show */
  template?: TemplateSummaryFE;
  /** Navigate to a different project (e.g. sub-project from fan-out) */
  onNavigateToProject?: (projectId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectWorkbench({
  project,
  agentRuns,
  templateStages,
  models,
  onResume,
  onCancelRun,
  onOpenConversation,
  onEvaluateRun,
  template,
  onNavigateToProject,
}: ProjectWorkbenchProps) {
  const pipeline = project.pipelineState;
  const stages = useMemo(() => pipeline?.stages ?? [], [pipeline?.stages]);

  // Determine if DAG tab should show (non-linear pipeline: fan-out, join, control-flow, or graphPipeline format)
  const showDagTab = useMemo(() => {
    // graphPipeline format is always a graph — always show DAG
    if (template?.format === 'graphPipeline') return true;
    if (!template?.pipeline) return false;
    return template.pipeline.some(s => s.stageType === 'fan-out' || s.stageType === 'join');
  }, [template]);

  // Selection state
  const [selection, setSelection] = useState<SelectionTarget | null>(null);
  const [resumeLoadingStage, setResumeLoadingStage] = useState<string | null>(null);
  const [resumeErrors, setResumeErrors] = useState<Record<string, string>>({});

  // Reset selection when project changes
  useEffect(() => {
    setSelection(null);
    setResumeLoadingStage(null);
    setResumeErrors({});
  }, [project.projectId]);

  // Handle resume with loading + error
  const handleResume = useCallback(
    async (stageId: string, action: ResumeAction, branchIndex?: number) => {
      setResumeLoadingStage(stageId);
      setResumeErrors((prev) => {
        const next = { ...prev };
        delete next[stageId];
        return next;
      });

      try {
        await onResume(project.projectId, stageId, action, branchIndex);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Resume failed';
        setResumeErrors((prev) => ({ ...prev, [stageId]: message }));
        setTimeout(() => {
          setResumeErrors((prev) => {
            const next = { ...prev };
            delete next[stageId];
            return next;
          });
        }, 5000);
      } finally {
        setResumeLoadingStage(null);
      }
    },
    [onResume, project.projectId],
  );

  // Handle gate approve/reject
  const handleGateApprove = useCallback(
    async (nodeId: string, input: { action: 'approve' | 'reject'; reason?: string }) => {
      await api.gateApprove(project.projectId, nodeId, input);
    },
    [project.projectId],
  );

  // Standalone prompt runs: prompt runs in this project that don't belong to any pipeline stage
  const stageRunIds = useMemo(() => new Set(stages.map(s => s.runId).filter(Boolean)), [stages]);
  const standalonePromptRuns = useMemo(
    () => agentRuns.filter(
      r => r.projectId === project.projectId && r.executorKind === 'prompt' && !stageRunIds.has(r.runId),
    ),
    [agentRuns, project.projectId, stageRunIds],
  );

  // Resolve the run and role for the current selection
  const resolveSelection = () => {
    if (!selection) {
      return { selectedStage: null, selectedRun: null, selectedRole: null, selectedPromptRun: null };
    }

    if (selection.type === 'prompt-run') {
      const promptRun = standalonePromptRuns.find((run) => run.runId === selection.runId) || null;
      return { selectedStage: null, selectedRun: promptRun, selectedRole: null, selectedPromptRun: promptRun };
    }

    const stage = stages[selection.stageIndex] || null;
    const run = stage?.runId
      ? agentRuns.find((r) => r.runId === stage.runId) || null
      : null;

    if (selection.type === 'role' && run?.roles) {
      // Find the matching role by key
      const roleIndex = run.roles.findIndex((r, i) => makeRoleKey(r, i) === selection.roleKey);
      const role = roleIndex >= 0 ? run.roles[roleIndex] : null;
      return { selectedStage: stage, selectedRun: run, selectedRole: role, selectedPromptRun: null };
    }

    return { selectedStage: stage, selectedRun: run, selectedRole: null, selectedPromptRun: null };
  };

  const { selectedStage, selectedRun, selectedRole, selectedPromptRun } = resolveSelection();

  // Has something selected → show right panel
  const hasSelection = selection !== null;

  // Pipeline progress
  const completedCount = stages.filter((s) => s.status === 'completed').length;
  const totalCount = stages.length;

  // View mode toggle: list vs graph (for non-linear pipelines)
  const [viewMode, setViewMode] = useState<'list' | 'graph'>(() => showDagTab ? 'graph' : 'list');

  // Sync viewMode when switching between linear/non-linear projects
  useEffect(() => {
    setViewMode(showDagTab ? 'graph' : 'list');
  }, [showDagTab]);

  // Find pending gate stages for quick review
  const pendingGates = useMemo(
    () => stages.filter(s => s.nodeKind === 'gate' && s.gateApproval?.status === 'pending'),
    [stages],
  );

  // Team summary across all stages
  const { t } = useI18n();
  const teamSummary = useMemo(() => {
    if (!stages.length) return null;
    const allRoles: RoleProgressFE[] = [];
    for (const stage of stages) {
      const run = agentRuns.find(r => r.runId === stage.runId);
      if (run?.roles) allRoles.push(...run.roles);
    }
    const working = allRoles.filter(r => r.status === 'running').length;
    const completed = allRoles.filter(r => r.status === 'completed').length;
    const pending = allRoles.filter(r => r.status === 'pending' || r.status === 'queued').length;
    const awaitingReview = allRoles.filter(r =>
      r.status === 'completed' && r.result && !r.reviewDecision
    ).length;
    return { total: allRoles.length, working, completed, pending, awaitingReview };
  }, [stages, agentRuns]);

  const promptOnlyProject = totalCount === 0 && standalonePromptRuns.length > 0;
  const primaryPromptRun = standalonePromptRuns[0] || null;
  const useCompactPromptRail = standalonePromptRuns.length > 1;
  const singlePromptOnlyFocused = promptOnlyProject && standalonePromptRuns.length === 1 && hasSelection && !!selectedPromptRun;

  useEffect(() => {
    if (!selection) return;

    if (selection.type === 'stage' || selection.type === 'role') {
      if (!stages[selection.stageIndex]) {
        setSelection(null);
      }
      return;
    }

    if (selection.type === 'prompt-run' && !standalonePromptRuns.some((run) => run.runId === selection.runId)) {
      setSelection(null);
    }
  }, [selection, stages, standalonePromptRuns]);

  useEffect(() => {
    if (selection || !promptOnlyProject || !primaryPromptRun) return;
    setSelection({ type: 'prompt-run', runId: primaryPromptRun.runId });
  }, [selection, promptOnlyProject, primaryPromptRun]);

  return (
    <Tabs defaultValue="pipeline">
      <TabsList className="mb-4">
        <TabsTrigger value="pipeline">
          <Layers className="h-3.5 w-3.5 mr-1" />
          Pipeline
        </TabsTrigger>
        <TabsTrigger value="operations">
          <Activity className="h-3.5 w-3.5 mr-1" />
          Operations
        </TabsTrigger>
        <TabsTrigger value="deliverables">
          <Package className="h-3.5 w-3.5 mr-1" />
          Deliverables
        </TabsTrigger>
      </TabsList>

      {/* Unified Pipeline tab */}
      <TabsContent value="pipeline">
        {/* Pending gate reviews — shown prominently at top */}
        {pendingGates.length > 0 && (
          <div className="mb-5 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="h-4 w-4 text-amber-400" />
              <span className="text-xs font-semibold uppercase tracking-widest text-amber-400/80">
                Pending Review · {pendingGates.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingGates.map(gate => (
                <button
                  key={gate.stageId}
                  className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/10 transition-colors"
                  onClick={() => {
                    const idx = stages.findIndex(s => s.stageId === gate.stageId);
                    if (idx >= 0) {
                      setViewMode('list'); // switch to list so detail panel is visible
                      setSelection({ type: 'stage', stageIndex: idx });
                    }
                  }}
                >
                  <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                  {resolveStageTitle(gate.stageId, templateStages, gate.title)}
                  <span className="text-[10px] text-amber-400/50">→ Review</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Team summary bar */}
        {teamSummary && teamSummary.total > 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-2 text-[11px] text-white/50 mb-4">
            <span>👥 {teamSummary.total} {t('role.summary.roles')}</span>
            {teamSummary.working > 0 && <span className="text-sky-400">🟢 {teamSummary.working} {t('role.summary.working')}</span>}
            {teamSummary.completed > 0 && <span className="text-emerald-400">✅ {teamSummary.completed} {t('role.summary.done')}</span>}
            {teamSummary.pending > 0 && <span className="text-white/40">⏳ {teamSummary.pending} {t('role.summary.queued')}</span>}
            {teamSummary.awaitingReview > 0 && <span className="text-amber-400">📝 {teamSummary.awaitingReview} {t('role.summary.awaitingReview')}</span>}
          </div>
        )}

        {/* View mode toggle for non-linear pipelines */}
        {showDagTab && (
          <div className="flex items-center gap-1 mb-4">
            <button
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors",
                viewMode === 'list'
                  ? "bg-white/10 text-white/80"
                  : "text-white/30 hover:text-white/50"
              )}
              onClick={() => setViewMode('list')}
            >
              <List className="h-3 w-3" />
              List
            </button>
            <button
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors",
                viewMode === 'graph'
                  ? "bg-white/10 text-white/80"
                  : "text-white/30 hover:text-white/50"
              )}
              onClick={() => setViewMode('graph')}
            >
              <Network className="h-3 w-3" />
              Graph
            </button>
          </div>
        )}

        {viewMode === 'graph' && showDagTab ? (
          /* Graph view (DAG) */
          <ProjectDagView
            projectId={project.projectId}
            onSelectStage={(stageId) => {
              const idx = stages.findIndex(s => s.stageId === stageId);
              if (idx >= 0) setSelection({ type: 'stage', stageIndex: idx });
            }}
          />
        ) : (
          /* List view (stage cards) */
          <div className={cn(
            'grid gap-5',
            singlePromptOnlyFocused
              ? 'max-w-[1200px]'
              : hasSelection
                ? 'xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]'
                : 'max-w-[600px]',
          )}>
            {!singlePromptOnlyFocused && (
              <div className="space-y-4">
                {!promptOnlyProject && (
                  <div className="flex items-center gap-3 px-1">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/60">
                      <Layers className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--app-text-muted)]">
                        Pipeline Stages
                      </div>
                      <div className="text-[11px] text-white/30">
                        {completedCount}/{totalCount} completed
                      </div>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/8">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 transition-all duration-500"
                          style={{ width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : '0%' }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Stage cards */}
                {stages.length > 0 && (
                  <div className="relative flex flex-col gap-2">
                    {stages.length > 1 && (
                      <div className="absolute left-[23px] top-10 bottom-10 w-px bg-gradient-to-b from-white/12 via-white/6 to-transparent" />
                    )}

                    {stages.map((stage, index) => {
                      const run = stage.runId
                        ? agentRuns.find((r) => r.runId === stage.runId)
                        : undefined;

                      return (
                        <div key={`${stage.stageId}-${stage.stageIndex}`} className="relative">
                          {index > 0 && (
                            <div className="flex justify-center -mt-1 mb-1">
                              <ArrowRight className="h-3 w-3 text-white/15 rotate-90" />
                            </div>
                          )}
                          <PipelineStageCard
                            stage={stage}
                            stageTitle={resolveStageTitle(stage.stageId, templateStages, stage.title)}
                            isSelected={selection?.type === 'stage' && selection.stageIndex === index}
                            isCurrentStage={pipeline?.activeStageIds?.includes(stage.stageId) || false}
                            roles={run?.roles}
                            selectedRoleKey={
                              selection?.type === 'role' && selection.stageIndex === index
                                ? selection.roleKey
                                : null
                            }
                            onClick={() =>
                              setSelection((prev) =>
                                prev?.type === 'stage' && prev.stageIndex === index
                                  ? null
                                  : { type: 'stage', stageIndex: index },
                              )
                            }
                            onSelectRole={(roleKey) =>
                              setSelection((prev) =>
                                prev?.type === 'role' && prev.stageIndex === index && prev.roleKey === roleKey
                                  ? null
                                  : { type: 'role', stageIndex: index, roleKey },
                              )
                            }
                            onNavigateToProject={onNavigateToProject}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Standalone Prompt Runs */}
                {standalonePromptRuns.length > 0 && (
                  <PromptRunsSection
                    runs={standalonePromptRuns}
                    onCancel={onCancelRun}
                    selectedRunId={selection?.type === 'prompt-run' ? selection.runId : null}
                    onSelectRun={(runId) => setSelection({ type: 'prompt-run', runId })}
                    compactTimeline={useCompactPromptRail}
                  />
                )}

                {stages.length === 0 && standalonePromptRuns.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-5 py-8 text-center">
                    <div className="text-sm font-medium text-white/70">No execution evidence yet</div>
                    <div className="mt-2 text-[12px] leading-6 text-white/40">
                      这个项目还没有 pipeline stage，也没有 prompt run。创建执行后，结果和产物会显示在这里。
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Right panel — stage detail / gate review */}
            {hasSelection && (
              <div>
                {selection.type === 'stage' && selectedStage ? (
                  <StageDetailPanel
                    stage={selectedStage}
                    stageTitle={resolveStageTitle(selectedStage.stageId, templateStages, selectedStage.title)}
                    run={selectedRun}
                    onResume={handleResume}
                    resumeLoading={resumeLoadingStage === selectedStage.stageId}
                    resumeError={resumeErrors[selectedStage.stageId] || null}
                    onOpenConversation={onOpenConversation}
                    onEvaluateRun={onEvaluateRun}
                    onGateApprove={handleGateApprove}
                  />
                ) : selection.type === 'prompt-run' && selectedPromptRun ? (
                  <AgentRunDetail
                    run={selectedPromptRun}
                    models={models}
                    onCancel={onCancelRun}
                    onEvaluateRun={onEvaluateRun}
                    onOpenConversation={onOpenConversation}
                    executiveMode
                  />
                ) : selection.type === 'role' && selectedRun && selectedRole ? (
                  <RoleDetailPanel
                    role={selectedRole}
                    run={selectedRun}
                    stageTitle={resolveStageTitle(
                      selection.type === 'role' ? (stages[selection.stageIndex]?.stageId || '') : '',
                      templateStages,
                      selection.type === 'role' ? stages[selection.stageIndex]?.title : undefined,
                    )}
                    onOpenConversation={onOpenConversation}
                  />
                ) : null}
              </div>
            )}
          </div>
        )}
      </TabsContent>

      {/* Operations tab */}
      <TabsContent value="operations">
        <ProjectOpsPanel projectId={project.projectId} />
      </TabsContent>

      {/* Deliverables tab */}
      <TabsContent value="deliverables">
        <DeliverablesPanel projectId={project.projectId} stages={stages} />
      </TabsContent>
    </Tabs>
  );
}
