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

import { createRun, getRun, updateRun } from './run-registry';

describe('run-registry characterization', () => {
  beforeEach(() => {
    (globalThis as any).__AGENT_RUNS_REGISTRY_MAP?.clear();
    fs.rmSync(MOCK_GATEWAY_HOME, { recursive: true, force: true });
  });

  afterEach(() => {
    (globalThis as any).__AGENT_RUNS_REGISTRY_MAP?.clear();
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
});