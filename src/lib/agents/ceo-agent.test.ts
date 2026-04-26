import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./prompt-executor', () => ({
  executePrompt: vi.fn(async () => ({ runId: 'prompt-run-ceo-1' })),
}));

vi.mock('./dispatch-service', () => ({
  executeDispatch: vi.fn(async () => ({ runId: 'dispatch-run-ceo-1' })),
}));

vi.mock('./project-registry', () => ({
  createProject: vi.fn((input: {
    workspace: string;
    name: string;
    goal: string;
    templateId?: string;
    projectType: string;
    skillHint?: string;
  }) => ({
    projectId: 'project-ceo-1',
    workspace: input.workspace,
    name: input.name,
    goal: input.goal,
    templateId: input.templateId,
    projectType: input.projectType,
    skillHint: input.skillHint,
  })),
  listProjects: vi.fn(() => []),
}));

vi.mock('./llm-oneshot', () => ({
  callLLMOneshot: vi.fn(async () => { throw new Error('LLM not available in test'); }),
}));

const mockAppendCEODecision = vi.fn();
const mockUpdateCEOActiveFocus = vi.fn();
vi.mock('../organization', () => ({
  appendCEODecision: (...args: unknown[]) => mockAppendCEODecision(...args),
  updateCEOActiveFocus: (...args: unknown[]) => mockUpdateCEOActiveFocus(...args),
}));

import { executePrompt } from './prompt-executor';
import { executeDispatch } from './dispatch-service';
import { callLLMOneshot } from './llm-oneshot';
import { createProject } from './project-registry';
import { processCEOCommand } from './ceo-agent';
import { deleteScheduledJob, listScheduledJobs, stopScheduler } from './scheduler';
import type { DepartmentConfig } from '../types';

function makeDepartments(): Map<string, DepartmentConfig> {
  return new Map([
    ['file:///Users/darrel/Documents/marketing', {
      name: '市场部',
      type: 'operations',
      templateIds: ['coding-basic-template', 'development-template-1'],
      skills: [],
      okr: null,
      description: '负责市场、SEO 和增长',
    }],
    ['file:///Users/darrel/Documents/design', {
      name: '设计部',
      type: 'build',
      templateIds: ['ux-driven-dev-template', 'design-review-template'],
      skills: [],
      okr: null,
      description: '负责设计和体验评审',
    }],
  ]);
}

beforeEach(() => {
  vi.mocked(executePrompt).mockClear();
  vi.mocked(executePrompt).mockResolvedValue({ runId: 'prompt-run-ceo-1' });
  vi.mocked(executeDispatch).mockClear();
  vi.mocked(executeDispatch).mockResolvedValue({ runId: 'dispatch-run-ceo-1' });
  vi.mocked(createProject).mockClear();
  vi.mocked(callLLMOneshot).mockReset();
  vi.mocked(callLLMOneshot).mockRejectedValue(new Error('LLM not available in test'));
  mockAppendCEODecision.mockReset();
  mockUpdateCEOActiveFocus.mockReset();
});

afterEach(() => {
  for (const job of listScheduledJobs()) {
    deleteScheduledJob(job.jobId);
  }
  stopScheduler();
});

describe('processCEOCommand — playbook-driven routing', () => {
  it('injects CEO playbook content into the LLM parser prompt', async () => {
    vi.mocked(callLLMOneshot).mockImplementationOnce(async (prompt) => {
      expect(prompt).toContain('<ceo-playbook>');
      expect(prompt).toContain('CEO 决策与派发工作流');
      expect(prompt).toContain('<ceo-scheduler-playbook>');
      expect(prompt).toContain('CEO 定时调度 + 即时执行工作流');
      expect(prompt).toContain('部门分配、是否走 template、是否走 prompt，必须由 playbook');
      return JSON.stringify({
        isSchedule: false,
        isImmediate: false,
        isStatusQuery: true,
        scheduleType: null,
        cronExpression: null,
        intervalMs: null,
        scheduledAt: null,
        scheduleLabel: null,
        actionKind: 'create-project',
        departmentName: null,
        projectName: null,
        templateId: null,
        goal: '状态',
        skillHint: null,
      });
    });

    const result = await processCEOCommand('公司状态如何', makeDepartments());

    expect(result.success).toBe(true);
    expect(result.action).toBe('info');
  });

  it('maps LLM immediate dispatch-prompt output into an ad-hoc project prompt run', async () => {
    vi.mocked(callLLMOneshot).mockResolvedValueOnce(JSON.stringify({
      isSchedule: false,
      isImmediate: true,
      isStatusQuery: false,
      scheduleType: null,
      cronExpression: null,
      intervalMs: null,
      scheduledAt: null,
      scheduleLabel: null,
      actionKind: 'dispatch-prompt',
      departmentName: '市场部',
      projectName: null,
      templateId: null,
      goal: '分析竞品动态',
      skillHint: null,
    }));

    const result = await processCEOCommand('让市场部分析竞品动态', makeDepartments());

    expect(result.success).toBe(true);
    expect(result.action).toBe('create_project');
    expect(result.projectId).toBe('project-ceo-1');
    expect(result.runId).toBe('prompt-run-ceo-1');
    expect(vi.mocked(createProject)).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'file:///Users/darrel/Documents/marketing',
      projectType: 'adhoc',
    }));
    expect(vi.mocked(executePrompt)).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'file:///Users/darrel/Documents/marketing',
      projectId: 'project-ceo-1',
      executionTarget: expect.objectContaining({ kind: 'prompt' }),
    }));
    expect(mockAppendCEODecision).toHaveBeenCalled();
    expect(mockUpdateCEOActiveFocus).toHaveBeenCalledWith(['分析竞品动态']);
  });

  it('maps LLM immediate create-project output with templateId into template dispatch', async () => {
    vi.mocked(callLLMOneshot).mockResolvedValueOnce(JSON.stringify({
      isSchedule: false,
      isImmediate: true,
      isStatusQuery: false,
      scheduleType: null,
      cronExpression: null,
      intervalMs: null,
      scheduledAt: null,
      scheduleLabel: null,
      actionKind: 'create-project',
      departmentName: '市场部',
      projectName: null,
      templateId: 'coding-basic-template',
      goal: '处理一个即时任务',
      skillHint: null,
    }));

    const result = await processCEOCommand(
      '让市场部使用 coding-basic-template 处理一个即时任务',
      makeDepartments(),
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe('create_project');
    expect(result.projectId).toBe('project-ceo-1');
    expect(result.runId).toBe('dispatch-run-ceo-1');
    expect(vi.mocked(executeDispatch)).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-ceo-1',
      templateId: 'coding-basic-template',
      workspace: 'file:///Users/darrel/Documents/marketing',
    }));
  });

  it('maps LLM scheduled dispatch-prompt output into a scheduler job', async () => {
    vi.mocked(callLLMOneshot).mockResolvedValueOnce(JSON.stringify({
      isSchedule: true,
      isImmediate: false,
      isStatusQuery: false,
      scheduleType: 'interval',
      cronExpression: null,
      intervalMs: 5000,
      scheduledAt: null,
      scheduleLabel: '每隔5秒',
      actionKind: 'dispatch-prompt',
      departmentName: '市场部',
      projectName: null,
      templateId: null,
      goal: '分析竞品动态',
      skillHint: null,
    }));

    const result = await processCEOCommand('每隔5秒让市场部分析竞品动态', makeDepartments());

    expect(result.success).toBe(true);
    expect(result.action).toBe('create_scheduler_job');
    expect(result.message).toContain('每隔5秒');
    expect(result.message).toContain('Prompt Mode');
  });

  it('falls back to status summary only when LLM/playbook parsing is unavailable', async () => {
    const result = await processCEOCommand('状态', makeDepartments());

    expect(result.success).toBe(true);
    expect(result.action).toBe('info');
  });

  it('refuses to auto-route execution when LLM/playbook parsing is unavailable', async () => {
    const result = await processCEOCommand('让市场部分析竞品动态', makeDepartments());

    expect(result.success).toBe(false);
    expect(result.action).toBe('report_to_human');
    expect(result.message).toContain('避免用硬编码规则');
    expect(vi.mocked(executePrompt)).not.toHaveBeenCalled();
    expect(vi.mocked(executeDispatch)).not.toHaveBeenCalled();
  });
});
