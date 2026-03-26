'use client';

import { useState, useEffect, useCallback } from 'react';
import type {
  Project,
  AgentRun,
  ModelConfig,
  ResumeAction,
  TemplateGroupSummary,
  RoleProgressFE,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import PipelineStageCard, { makeRoleKey } from '@/components/pipeline-stage-card';
import StageDetailPanel from '@/components/stage-detail-panel';
import RoleDetailPanel from '@/components/role-detail-panel';
import { Layers, ArrowRight } from 'lucide-react';

// ---------------------------------------------------------------------------
// Helper: resolve human-readable stage title from template groups
// ---------------------------------------------------------------------------

export function resolveStageTitle(
  groupId: string,
  templateGroups?: Record<string, TemplateGroupSummary>,
): string {
  return templateGroups?.[groupId]?.title || groupId;
}

// ---------------------------------------------------------------------------
// Selection target type
// ---------------------------------------------------------------------------

type SelectionTarget =
  | { type: 'stage'; stageIndex: number }
  | { type: 'role'; stageIndex: number; roleKey: string };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProjectWorkbenchProps {
  project: Project;
  agentRuns: AgentRun[];
  templateGroups: Record<string, TemplateGroupSummary>;
  models: ModelConfig[];
  onResume: (projectId: string, stageIndex: number, action: ResumeAction) => Promise<void>;
  onCancelRun: (runId: string) => void;
  onOpenConversation?: (id: string, title: string) => void;
  onEvaluateRun?: (runId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectWorkbench({
  project,
  agentRuns,
  templateGroups,
  models,
  onResume,
  onCancelRun,
  onOpenConversation,
  onEvaluateRun,
}: ProjectWorkbenchProps) {
  const pipeline = project.pipelineState;
  const stages = pipeline?.stages || [];

  // Selection state
  const [selection, setSelection] = useState<SelectionTarget | null>(null);
  const [resumeLoadingStage, setResumeLoadingStage] = useState<number | null>(null);
  const [resumeErrors, setResumeErrors] = useState<Record<number, string>>({});

  // Reset selection when project changes
  useEffect(() => {
    setSelection(null);
    setResumeLoadingStage(null);
    setResumeErrors({});
  }, [project.projectId]);

  // Handle resume with loading + error
  const handleResume = useCallback(
    async (stageIndex: number, action: ResumeAction) => {
      setResumeLoadingStage(stageIndex);
      setResumeErrors((prev) => {
        const next = { ...prev };
        delete next[stageIndex];
        return next;
      });

      try {
        await onResume(project.projectId, stageIndex, action);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Resume failed';
        setResumeErrors((prev) => ({ ...prev, [stageIndex]: message }));
        setTimeout(() => {
          setResumeErrors((prev) => {
            const next = { ...prev };
            delete next[stageIndex];
            return next;
          });
        }, 5000);
      } finally {
        setResumeLoadingStage(null);
      }
    },
    [onResume, project.projectId],
  );

  // Resolve the run and role for the current selection
  const resolveSelection = () => {
    if (!selection) return { selectedStage: null, selectedRun: null, selectedRole: null };

    const stage = stages[selection.stageIndex] || null;
    const run = stage?.runId
      ? agentRuns.find((r) => r.runId === stage.runId) || null
      : null;

    if (selection.type === 'role' && run?.roles) {
      // Find the matching role by key
      const roleIndex = run.roles.findIndex((r, i) => makeRoleKey(r, i) === selection.roleKey);
      const role = roleIndex >= 0 ? run.roles[roleIndex] : null;
      return { selectedStage: stage, selectedRun: run, selectedRole: role };
    }

    return { selectedStage: stage, selectedRun: run, selectedRole: null };
  };

  const { selectedStage, selectedRun, selectedRole } = resolveSelection();

  // Has something selected → show right panel
  const hasSelection = selection !== null;

  // Pipeline progress
  const completedCount = stages.filter((s) => s.status === 'completed').length;
  const totalCount = stages.length;

  return (
    <div className={cn(
      'grid gap-5',
      hasSelection
        ? 'xl:grid-cols-[500px_minmax(0,1fr)] 2xl:grid-cols-[540px_minmax(0,1fr)]'
        : 'max-w-[600px]',
    )}>
      {/* Left panel — Pipeline stage timeline with inline roles */}
      <div className="space-y-4">
        {/* Pipeline progress header */}
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

        {/* Stage cards with inline roles */}
        <div className="relative flex flex-col gap-2">
          {stages.length > 1 && (
            <div className="absolute left-[23px] top-10 bottom-10 w-px bg-gradient-to-b from-white/12 via-white/6 to-transparent" />
          )}

          {stages.map((stage, index) => {
            const run = stage.runId
              ? agentRuns.find((r) => r.runId === stage.runId)
              : undefined;

            return (
              <div key={`${stage.groupId}-${stage.stageIndex}`} className="relative">
                {index > 0 && (
                  <div className="flex justify-center -mt-1 mb-1">
                    <ArrowRight className="h-3 w-3 text-white/15 rotate-90" />
                  </div>
                )}
                <PipelineStageCard
                  stage={stage}
                  stageTitle={resolveStageTitle(stage.groupId, templateGroups)}
                  isSelected={selection?.stageIndex === index && selection.type === 'stage'}
                  isCurrentStage={pipeline?.currentStageIndex === index}
                  roles={run?.roles}
                  selectedRoleKey={
                    selection?.stageIndex === index && selection.type === 'role'
                      ? selection.roleKey
                      : null
                  }
                  onClick={() =>
                    setSelection((prev) =>
                      prev?.type === 'stage' && prev.stageIndex === index
                        ? null // deselect
                        : { type: 'stage', stageIndex: index },
                    )
                  }
                  onSelectRole={(roleKey) =>
                    setSelection((prev) =>
                      prev?.type === 'role' && prev.stageIndex === index && prev.roleKey === roleKey
                        ? null // deselect
                        : { type: 'role', stageIndex: index, roleKey },
                    )
                  }
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Right panel — contextual detail (only when something is selected) */}
      {hasSelection && (
        <div>
          {selection.type === 'stage' && selectedStage ? (
            <StageDetailPanel
              stage={selectedStage}
              stageTitle={resolveStageTitle(selectedStage.groupId, templateGroups)}
              run={selectedRun}
              onResume={handleResume}
              resumeLoading={resumeLoadingStage === selectedStage.stageIndex}
              resumeError={resumeErrors[selectedStage.stageIndex] || null}
              onOpenConversation={onOpenConversation}
              onEvaluateRun={onEvaluateRun}
            />
          ) : selection.type === 'role' && selectedRun && selectedRole ? (
            <RoleDetailPanel
              role={selectedRole}
              run={selectedRun}
              stageTitle={resolveStageTitle(
                stages[selection.stageIndex]?.groupId || '',
                templateGroups,
              )}
              onOpenConversation={onOpenConversation}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
