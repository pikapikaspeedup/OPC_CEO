import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger';
import { ARTIFACT_ROOT_DIR } from './gateway-home';
import { AssetLoader } from './asset-loader';
import { dispatchRun } from './group-runtime';
import { emitProjectEvent, onProjectEvent, type ProjectEvent } from './project-events';
import { getProject, listProjects, updateBranchProgress, updatePipelineStageByStageId, createProject, initializePipelineState, addRunToProject, trackStageDispatch } from './project-registry';
import { resolveStageId } from './pipeline/pipeline-graph';
import { getOrCompileIR } from './pipeline/dag-compiler';
import { getDownstreamNodes, canActivateNode, filterSourcesByNode } from './pipeline/dag-runtime';
import { getRun } from './run-registry';

const log = createLogger('FanOutController');

type WorkPackage = {
  id: string;
  name: string;
  goal: string;
};

const globalForFanOutController = globalThis as unknown as {
  __AG_FAN_OUT_CONTROLLER_INIT__?: boolean;
};

function getWorkspacePath(workspace?: string): string {
  return (workspace || '').replace(/^file:\/\//, '');
}

function readWorkPackages(projectId: string, stageId: string, workPackagesPath: string): WorkPackage[] {
  const project = getProject(projectId);
  if (!project?.pipelineState) {
    throw new Error(`Project not found or missing pipeline state: ${projectId}`);
  }

  const stage = project.pipelineState.stages.find(item => item.stageId === stageId);
  if (!stage?.runId) {
    throw new Error(`Upstream stage ${stageId} has no canonical run`);
  }

  const run = getRun(stage.runId);
  if (!run?.artifactDir) {
    throw new Error(`Upstream run ${stage.runId} has no artifact directory`);
  }

  const workspacePath = getWorkspacePath(project.workspace);
  const artifactPath = path.join(workspacePath, run.artifactDir, workPackagesPath);
  const workspaceRootPath = path.join(workspacePath, workPackagesPath);

  const fullPath = fs.existsSync(artifactPath)
    ? artifactPath
    : fs.existsSync(workspaceRootPath)
      ? workspaceRootPath
      : null;

  if (!fullPath) {
    throw new Error(`Work packages file not found at ${artifactPath} or ${workspaceRootPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.workPackages) ? parsed.workPackages : [];
  if (!Array.isArray(items)) {
    throw new Error(`Invalid work packages payload in ${fullPath}`);
  }

  return items.map((item: any, index: number) => ({
    id: item.id || `wp-${index + 1}`,
    name: item.name || `Work Package ${index + 1}`,
    goal: item.goal || item.prompt || item.name || `Execute work package ${index + 1}`,
  }));
}

async function dispatchInitialProjectStage(projectId: string): Promise<string> {
  const project = getProject(projectId);
  if (!project?.templateId || !project.workspace) {
    throw new Error(`Project ${projectId} is missing templateId or workspace`);
  }

  const template = AssetLoader.getTemplate(project.templateId);
  if (!template) {
    throw new Error(`Template not found: ${project.templateId}`);
  }

  // Support both pipeline[] and graphPipeline formats
  let initialStageId: string;
  if (template.pipeline && template.pipeline.length > 0) {
    const initialStage = template.pipeline[0];
    initialStageId = resolveStageId(initialStage);
  } else if (template.graphPipeline && template.graphPipeline.nodes.length > 0) {
    const ir = getOrCompileIR(template);
    const entryNodeId = ir.entryNodeIds[0];
    const entryNode = ir.nodes.find(n => n.id === entryNodeId);
    if (!entryNode) throw new Error(`Entry node not found in IR: ${entryNodeId}`);
    initialStageId = entryNode.id;
  } else {
    throw new Error(`Template ${project.templateId} has no pipeline or graphPipeline`);
  }

  initializePipelineState(project.projectId, project.templateId);
  const result = await dispatchRun({
    stageId: initialStageId,
    workspace: project.workspace,
    prompt: project.goal,
    projectId: project.projectId,
    pipelineId: project.templateId,
    templateId: project.templateId,
    pipelineStageId: initialStageId,
    pipelineStageIndex: 0,
  });

  addRunToProject(project.projectId, result.runId);
  trackStageDispatch(project.projectId, initialStageId, result.runId);
  return result.runId;
}

async function dispatchDownstreamStages(projectId: string, completedStageId: string): Promise<void> {
  const project = getProject(projectId);
  if (!project?.pipelineState || !project.workspace) return;
  const template = AssetLoader.getTemplate(project.pipelineState.templateId);
  if (!template) return;

  const ir = getOrCompileIR(template);
  const downstreamNodes = getDownstreamNodes(ir, completedStageId);

  for (const node of downstreamNodes) {
    // Skip fan-out and join nodes — handled by tryFanOut / tryJoin
    if (!node.autoTrigger || node.kind === 'fan-out' || node.kind === 'join') {
      continue;
    }

    const progress = project.pipelineState.stages.find(item => item.stageId === node.id);
    if (progress?.runId && progress.status !== 'pending') {
      continue;
    }

    const activation = canActivateNode(ir, node.id, project.pipelineState);
    if (!activation.canActivate) {
      continue;
    }

    const upstreamNodeIds = activation.upstreamNodeIds.length > 0
      ? activation.upstreamNodeIds
      : [completedStageId];
    const allSourceRunIds = upstreamNodeIds.flatMap(upstreamId => {
      const upstreamStage = project.pipelineState?.stages.find(item => item.stageId === upstreamId);
      if (!upstreamStage) return [];
      if (upstreamStage.runId) return [upstreamStage.runId];
      return (upstreamStage.branches || [])
        .map(branch => branch.runId)
        .filter(Boolean) as string[];
    });
    const sourceRunIds = filterSourcesByNode(ir, node.id, allSourceRunIds);

    const pipelineStage = template.pipeline?.find(s => resolveStageId(s) === node.id);
    const pipelineStageIndex = pipelineStage && template.pipeline ? template.pipeline.indexOf(pipelineStage) : undefined;

    const result = await dispatchRun({
      stageId: node.id,
      workspace: project.workspace,
      prompt: node.promptTemplate || project.goal,
      projectId: project.projectId,
      pipelineId: template.id,
      templateId: template.id,
      pipelineStageId: node.id,
      sourceRunIds,
      ...(pipelineStageIndex !== undefined ? { pipelineStageIndex } : {}),
    });

    addRunToProject(project.projectId, result.runId);
    trackStageDispatch(project.projectId, node.id, result.runId);
  }
}

async function tryFanOut(projectId: string, completedStageId: string): Promise<void> {
  const project = getProject(projectId);
  if (!project?.pipelineState || !project.workspace) return;
  const template = AssetLoader.getTemplate(project.pipelineState.templateId);
  if (!template) return;

  const ir = getOrCompileIR(template);
  const downstreamNodes = getDownstreamNodes(ir, completedStageId);

  for (const node of downstreamNodes) {
    if (node.kind !== 'fan-out' || !node.fanOut) {
      continue;
    }

    const progress = project.pipelineState.stages.find(item => item.stageId === node.id);
    if (progress?.branches?.length) {
      log.debug({ projectId, stageId: node.id }, 'Skip fanout: branches already exist');
      continue;
    }

    const activation = canActivateNode(ir, node.id, project.pipelineState);
    if (!activation.canActivate) {
      log.debug({ projectId, stageId: node.id, reason: activation.reason }, 'Skip fanout: cannot activate');
      continue;
    }

    const upstreamStageId = activation.upstreamNodeIds[0] || completedStageId;
    let workPackages: WorkPackage[];
    try {
      workPackages = readWorkPackages(projectId, upstreamStageId, node.fanOut.workPackagesPath);
    } catch (err: any) {
      log.error({ err: err.message, projectId, stageId: node.id }, 'Fanout readWorkPackages failed');
      updatePipelineStageByStageId(projectId, node.id, {
        status: 'failed',
        lastError: err.message,
      });
      continue;
    }

    updatePipelineStageByStageId(projectId, node.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    // V5.3: Prefer runtime override from project, fallback to IR value
    const overrideMaxC = (project.pipelineState?.templateOverrides as any)?.maxConcurrency;
    const irMaxC = node.fanOut.maxConcurrency;
    const maxC = typeof overrideMaxC === 'number' ? overrideMaxC : irMaxC;
    const unlimited = !maxC || maxC <= 0;

    for (let index = 0; index < workPackages.length; index += 1) {
      const workPackage = workPackages[index];
      const subProject = createProject({
        name: `${project.name} - ${workPackage.name}`,
        goal: workPackage.goal,
        templateId: node.fanOut.perBranchTemplateId,
        workspace: project.workspace,
        parentProjectId: project.projectId,
        parentStageId: node.id,
        branchIndex: index,
      });

      if (unlimited || index < maxC) {
        // Dispatch immediately
        updateBranchProgress(projectId, node.id, index, {
          workPackageId: workPackage.id,
          workPackageName: workPackage.name,
          subProjectId: subProject.projectId,
          status: 'running',
          startedAt: new Date().toISOString(),
        });

        try {
          const initialRunId = await dispatchInitialProjectStage(subProject.projectId);
          updateBranchProgress(projectId, node.id, index, { runId: initialRunId });
        } catch (err: any) {
          updateBranchProgress(projectId, node.id, index, {
            status: 'failed',
            lastError: err.message,
            completedAt: new Date().toISOString(),
          });
        }
      } else {
        // Queue for later dispatch
        log.info({ projectId, stageId: node.id, branchIndex: index, maxConcurrency: maxC }, 'Branch queued (maxConcurrency limit)');
        updateBranchProgress(projectId, node.id, index, {
          workPackageId: workPackage.id,
          workPackageName: workPackage.name,
          subProjectId: subProject.projectId,
          status: 'queued',
        });
      }
    }
  }
}

async function tryDispatchNextQueuedBranch(parentProjectId: string, fanOutStageId: string): Promise<void> {
  const project = getProject(parentProjectId);
  if (!project?.pipelineState) return;

  const stage = project.pipelineState.stages.find(s => s.stageId === fanOutStageId);
  if (!stage?.branches) return;

  // Read maxConcurrency: prefer runtime override stored on project, fallback to IR
  const template = AssetLoader.getTemplate(project.pipelineState.templateId);
  if (!template) return;
  const ir = getOrCompileIR(template);
  const fanOutNode = ir.nodes.find(n => n.id === fanOutStageId);
  const overrideMaxC = (project.pipelineState.templateOverrides as any)?.maxConcurrency;
  const maxC = typeof overrideMaxC === 'number' ? overrideMaxC : fanOutNode?.fanOut?.maxConcurrency;
  if (!maxC || maxC <= 0) return; // unlimited — nothing queued

  const runningCount = stage.branches.filter(b => b.status === 'running').length;
  if (runningCount >= maxC) return;

  const slotsAvailable = maxC - runningCount;
  const queued = stage.branches
    .filter(b => b.status === 'queued')
    .sort((a, b) => a.branchIndex - b.branchIndex);

  for (let i = 0; i < Math.min(slotsAvailable, queued.length); i++) {
    const branch = queued[i];
    log.info({ parentProjectId, stageId: fanOutStageId, branchIndex: branch.branchIndex }, 'Dispatching queued branch');

    updateBranchProgress(parentProjectId, fanOutStageId, branch.branchIndex, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    try {
      const initialRunId = await dispatchInitialProjectStage(branch.subProjectId);
      updateBranchProgress(parentProjectId, fanOutStageId, branch.branchIndex, { runId: initialRunId });
    } catch (err: any) {
      log.error({ err: err.message, parentProjectId, stageId: fanOutStageId, branchIndex: branch.branchIndex }, 'Queued branch dispatch failed');
      updateBranchProgress(parentProjectId, fanOutStageId, branch.branchIndex, {
        status: 'failed',
        lastError: err.message,
        completedAt: new Date().toISOString(),
      });
    }
  }
}

async function tryJoin(projectId: string, fanOutStageId: string): Promise<void> {
  const project = getProject(projectId);
  if (!project?.pipelineState) return;
  const template = AssetLoader.getTemplate(project.pipelineState.templateId);
  if (!template) return;

  const fanOutProgress = project.pipelineState.stages.find(item => item.stageId === fanOutStageId);
  if (!fanOutProgress?.branches?.length || !fanOutProgress.branches.every(branch => branch.status === 'completed' || branch.status === 'failed')) {
    return;
  }

  // Don't join if there are still queued branches
  if (fanOutProgress.branches.some(branch => branch.status === 'queued' || branch.status === 'running')) {
    return;
  }

  updatePipelineStageByStageId(projectId, fanOutStageId, {
    status: 'completed',
    completedAt: new Date().toISOString(),
  });

  // Write fan-out-summary.json
  try {
    if (project.workspace) {
      const summary = {
        completedAt: new Date().toISOString(),
        totalBranches: fanOutProgress.branches.length,
        succeeded: fanOutProgress.branches.filter(b => b.status === 'completed').length,
        failed: fanOutProgress.branches.filter(b => b.status === 'failed').length,
        branches: fanOutProgress.branches.map(b => ({
          index: b.branchIndex,
          name: b.workPackageName,
          status: b.status,
          subProjectId: b.subProjectId,
          duration: b.startedAt && b.completedAt
            ? `${((new Date(b.completedAt).getTime() - new Date(b.startedAt).getTime()) / 1000).toFixed(0)}s`
            : null,
        })),
      };
      const summaryPath = path.join(getProjectArtifactRoot(projectId, project.workspace), 'fan-out-summary.json');
      const summaryDir = path.dirname(summaryPath);
      if (!fs.existsSync(summaryDir)) fs.mkdirSync(summaryDir, { recursive: true });
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
      log.info({ projectId, stageId: fanOutStageId, path: summaryPath }, 'Fan-out summary written');
    }
  } catch (err: any) {
    log.warn({ err: err.message, projectId }, 'Failed to write fan-out-summary.json');
  }

  // Use IR to find join nodes whose sourceNodeId matches the fan-out stage
  const ir = getOrCompileIR(template);
  const joinNodes = ir.nodes.filter(n => n.kind === 'join' && n.join?.sourceNodeId === fanOutStageId);
  for (const joinNode of joinNodes) {
    const joinProgress = project.pipelineState.stages.find(item => item.stageId === joinNode.id);
    if (joinProgress?.status === 'completed') {
      continue;
    }

    updatePipelineStageByStageId(projectId, joinNode.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    updatePipelineStageByStageId(projectId, joinNode.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
    emitProjectEvent({ type: 'stage:completed', projectId, stageId: joinNode.id, runId: '', nodeKind: 'join' });
    await dispatchDownstreamStages(projectId, joinNode.id);
  }
}

async function handleProjectEvent(event: ProjectEvent): Promise<void> {
  if (event.type === 'stage:completed') {
    // Try fan-out first (handles fan-out downstream nodes)
    await tryFanOut(event.projectId, event.stageId);
    // Also dispatch regular auto-trigger downstream stages
    await dispatchDownstreamStages(event.projectId, event.stageId);
    return;
  }

  if (event.type === 'project:completed') {
    const project = getProject(event.projectId);
    if (!project?.parentProjectId || !project.parentStageId || project.branchIndex === undefined) {
      return;
    }

    const parentProject = getProject(project.parentProjectId);
    const branchProgress = parentProject?.pipelineState?.stages
      .find(stage => stage.stageId === project.parentStageId)
      ?.branches?.find(branch => branch.branchIndex === project.branchIndex);

    if (branchProgress?.status === 'completed') {
      return;
    }

    const outputRunId = [...(project.pipelineState?.stages || [])]
      .reverse()
      .find(stage => stage.runId && (stage.status === 'completed' || stage.status === 'skipped'))
      ?.runId;

    updateBranchProgress(project.parentProjectId, project.parentStageId, project.branchIndex, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      subProjectId: project.projectId,
      runId: outputRunId,
    });

    emitProjectEvent({
      type: 'branch:completed',
      parentProjectId: project.parentProjectId,
      parentStageId: project.parentStageId,
      branchIndex: project.branchIndex,
      subProjectId: project.projectId,
    });
    return;
  }

  // Dispatch next queued branch if concurrency slots are available
  if (event.type === 'branch:completed') {
    await tryDispatchNextQueuedBranch(event.parentProjectId, event.parentStageId);
    await tryJoin(event.parentProjectId, event.parentStageId);
  }
}

export function initializeFanOutController(): void {
  if (globalForFanOutController.__AG_FAN_OUT_CONTROLLER_INIT__) return;
  onProjectEvent('fan-out-controller', handleProjectEvent);
  globalForFanOutController.__AG_FAN_OUT_CONTROLLER_INIT__ = true;
  log.info('Fan-out controller initialized');
}

export async function scanFanOutBranchHealth(): Promise<void> {
  for (const project of listProjects()) {
    if (!project.pipelineState) continue;

    for (const stage of project.pipelineState.stages) {
      for (const branch of stage.branches || []) {
        if (!branch.subProjectId) continue;
        const childProject = getProject(branch.subProjectId);
        if (!childProject?.pipelineState) continue;

        if (childProject.pipelineState.status === 'failed' || childProject.pipelineState.status === 'cancelled') {
          if (branch.status !== 'failed') {
            updateBranchProgress(project.projectId, stage.stageId, branch.branchIndex, {
              status: 'failed',
              lastError: childProject.pipelineState.status,
              completedAt: new Date().toISOString(),
            });
          }
          continue;
        }

        if (branch.status !== 'running') continue;
        const activeStage = childProject.pipelineState.stages.find(item => item.status === 'running' && item.runId);
        const activeRun = activeStage?.runId ? getRun(activeStage.runId) : null;
        if (activeRun?.liveState?.staleSince) {
          log.warn({
            parentProjectId: project.projectId,
            parentStageId: stage.stageId,
            branchIndex: branch.branchIndex,
            subProjectId: branch.subProjectId,
            staleSince: activeRun.liveState.staleSince,
          }, 'Fan-out branch appears stale');
        }
      }
    }
  }
}

export function getProjectArtifactRoot(projectId: string, workspace: string): string {
  return path.join(getWorkspacePath(workspace), ARTIFACT_ROOT_DIR, 'projects', projectId);
}
