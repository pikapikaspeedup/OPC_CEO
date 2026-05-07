import * as fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { MOCK_GATEWAY_HOME, MOCK_RUNS_FILE } = vi.hoisted(() => {
  const base = `/tmp/ag-run-registry-${process.pid}-${Date.now()}`;
  return {
    MOCK_GATEWAY_HOME: base,
    MOCK_RUNS_FILE: `${base}/runs.json`,
  };
});

vi.mock('./gateway-home', () => ({
  GATEWAY_HOME: MOCK_GATEWAY_HOME,
  GLOBAL_ASSETS_DIR: `${MOCK_GATEWAY_HOME}/assets`,
  ARTIFACT_ROOT_DIR: 'demolong',
  RUNS_FILE: MOCK_RUNS_FILE,
}));

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createProject, addRunToProject } from './project-registry';
import { getPlatformEngineeringWorkspaceUri, ensurePlatformEngineeringWorkspaceSkeleton } from '../platform-engineering';
import { getSystemImprovementProposal } from '../company-kernel/self-improvement-store';
import { createRun, getRun, updateRun } from './run-registry';

const registryGlobals = globalThis as unknown as {
  __AGENT_RUNS_REGISTRY_MAP?: Map<string, unknown>;
  __PROJECT_REGISTRY_MAP?: Map<string, unknown>;
  __AG_GATEWAY_DB__?: unknown;
};

describe('run-registry characterization', () => {
  beforeEach(() => {
    registryGlobals.__AGENT_RUNS_REGISTRY_MAP?.clear();
    registryGlobals.__PROJECT_REGISTRY_MAP?.clear();
    delete registryGlobals.__AG_GATEWAY_DB__;
    fs.rmSync(MOCK_GATEWAY_HOME, { recursive: true, force: true });
  });

  afterEach(() => {
    registryGlobals.__AGENT_RUNS_REGISTRY_MAP?.clear();
    registryGlobals.__PROJECT_REGISTRY_MAP?.clear();
    delete registryGlobals.__AG_GATEWAY_DB__;
    fs.rmSync(MOCK_GATEWAY_HOME, { recursive: true, force: true });
  });

  it('does not infer pipelineStageId for prompt-style runs without templateId', () => {
    const run = createRun({
      stageId: 'prompt-mode',
      workspace: 'file:///tmp/workspace',
      prompt: '分析技术趋势',
      executorKind: 'prompt',
      executionTarget: { kind: 'prompt', skillHints: ['research'] },
    });

    expect(run.templateId).toBeUndefined();
    expect(run.pipelineStageId).toBeUndefined();
    expect(run.executorKind).toBe('prompt');
    expect(run.executionTarget).toEqual({ kind: 'prompt', skillHints: ['research'] });
    expect(getRun(run.runId)?.pipelineStageId).toBeUndefined();
  });

  it('infers pipelineStageId for template runs when templateId is present', () => {
    const run = createRun({
      stageId: 'implement',
      workspace: 'file:///tmp/workspace',
      prompt: '修复登录接口',
      templateId: 'coding-basic-template',
    });

    expect(run.templateId).toBe('coding-basic-template');
    expect(run.pipelineStageId).toBe('implement');
  });

  it('sets and clears finishedAt when moving into and out of terminal states', () => {
    const run = createRun({
      stageId: 'prompt-mode',
      workspace: 'file:///tmp/workspace',
      prompt: '整理日报',
    });

    const failed = updateRun(run.runId, { status: 'failed', lastError: 'boom' });
    expect(failed?.finishedAt).toBeTruthy();

    const recovered = updateRun(run.runId, { status: 'running' });
    expect(recovered?.finishedAt).toBeUndefined();
  });

  it('creates platform engineering entry approvals synchronously for observed failures', () => {
    ensurePlatformEngineeringWorkspaceSkeleton();
    const workspace = getPlatformEngineeringWorkspaceUri();
    const project = createProject({
      name: 'Platform engineering repair',
      goal: 'Repair a failed guarded task',
      workspace,
      templateId: 'development-template-1',
    });
    const run = createRun({
      stageId: 'delivery',
      workspace,
      prompt: 'Repair the guarded task',
      projectId: project.projectId,
      templateId: 'development-template-1',
      pipelineStageId: 'delivery',
    });
    addRunToProject(project.projectId, run.runId);

    updateRun(run.runId, {
      status: 'failed',
      lastError: 'boom',
      result: {
        status: 'failed',
        summary: 'guarded task failed',
        changedFiles: ['src/lib/agents/scheduler.ts'],
        blockers: ['scheduler failure'],
        needsReview: [],
      },
    });

    const proposal = getSystemImprovementProposal(`system-improvement-proposal:platform-run-failure:${run.runId}`);
    expect(proposal?.status).toBe('approval-required');
    expect(proposal?.approvalRequestId).toBeTruthy();
  });
});
