import type { AgentRunState } from '@/lib/agents/group-types';

/**
 * Shared project-normalization helpers — used by both /api/projects and /api/projects/[id].
 */

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function summarizeFailureText(text?: string): string | undefined {
  if (!text) return undefined;
  const firstMeaningfulLine = text
    .split('\n')
    .map(line => line.trim().replace(/^#+\s*/, ''))
    .find(line => line.length > 0);

  if (!firstMeaningfulLine) return undefined;
  return firstMeaningfulLine.length > 240
    ? `${firstMeaningfulLine.slice(0, 237)}...`
    : firstMeaningfulLine;
}

export function looksLikeCompletionText(text?: string): boolean {
  return !!text && /(?:^|[\s])(?:completed?|done|finished|ready)(?:$|[\s])|完成/.test(text);
}

export type ProjectRunLookup = (runId: string) => AgentRunState | null | undefined;

export function deriveRunFailureReason(run: AgentRunState | null | undefined): string | undefined {
  if (!run) return undefined;
  if (run.lastError) return run.lastError;
  if (run.result?.blockers?.length) return run.result.blockers[0];
  const failedRole = [...(run.roles || [])]
    .reverse()
    .find(role => role.result?.status === 'failed' || role.result?.status === 'blocked');
  if (failedRole?.result?.summary) {
    const summary = summarizeFailureText(failedRole.result.summary);
    if (run.status === 'failed' && failedRole.result.status === 'failed' && looksLikeCompletionText(summary)) {
      return 'Role failed after reporting completion; inspect child conversation error steps.';
    }
    return summary;
  }
  return summarizeFailureText(run.result?.summary);
}

/**
 * normalizeProject — enrich a project with derived runIds, childProjectIds,
 * and stage error messages resolved from the run registry.
 */
export function normalizeProject<T extends { runIds: string[]; pipelineState?: { stages: Array<{ runId?: string; status: string; lastError?: string; branches?: Array<{ subProjectId?: string }> }> } }>(
  project: T,
  options?: { getRunById?: ProjectRunLookup },
): T {
  const canonicalRunIds = new Set(project.runIds);
  const childProjectIds = new Set<string>();
  for (const stage of project.pipelineState?.stages || []) {
    if (stage.runId) canonicalRunIds.add(stage.runId);
    for (const branch of stage.branches || []) {
      if (branch.subProjectId) childProjectIds.add(branch.subProjectId);
    }
  }

  const normalizedPipelineState = project.pipelineState
      ? {
        ...project.pipelineState,
        stages: project.pipelineState.stages.map(stage => {
          const shouldDeriveError = stage.status === 'failed' || stage.status === 'blocked' || stage.status === 'cancelled';
          if (stage.lastError || !stage.runId || !shouldDeriveError) return stage;
          const derivedError = deriveRunFailureReason(options?.getRunById?.(stage.runId));
          return derivedError ? { ...stage, lastError: derivedError } : stage;
        }),
      }
    : undefined;

  return {
    ...project,
    runIds: Array.from(canonicalRunIds),
    childProjectIds: Array.from(childProjectIds),
    pipelineState: normalizedPipelineState,
  } as T;
}
