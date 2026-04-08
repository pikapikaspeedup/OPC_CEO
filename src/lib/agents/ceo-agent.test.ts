import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./prompt-executor', () => ({
  executePrompt: vi.fn(async () => ({ runId: 'prompt-run-ceo-1' })),
}));

import { executePrompt } from './prompt-executor';
import { buildSchedulerIntentPreview, processCEOCommand } from './ceo-agent';
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
});

describe('buildSchedulerIntentPreview', () => {
  it('parses weekday department report requests into create-project jobs', () => {
    const preview = buildSchedulerIntentPreview(
      '每天工作日上午 9 点让市场部生成日报，目标是汇总当前项目风险',
      makeDepartments(),
    );

    expect(preview.schedule).toMatchObject({
      type: 'cron',
      cronExpression: '0 9 * * 1-5',
    });
    expect(preview.actionDraft).toMatchObject({
      kind: 'create-project',
      departmentWorkspaceUri: 'file:///Users/darrel/Documents/marketing',
      templateId: 'universal-batch-template',
    });
  });

  it('parses explicit once schedules', () => {
    const preview = buildSchedulerIntentPreview(
      '明天上午 9 点让市场部创建一个 ad-hoc 项目，目标是整理 backlog',
      makeDepartments(),
    );

    expect(preview.schedule?.type).toBe('once');
    expect(preview.actionDraft).toMatchObject({
      kind: 'create-project',
      departmentWorkspaceUri: 'file:///Users/darrel/Documents/marketing',
    });
  });

  it('returns missing_schedule when cadence is absent', () => {
    const preview = buildSchedulerIntentPreview('让市场部生成日报', makeDepartments());
    expect(preview.error).toBe('missing_schedule');
    expect(preview.schedule).toBeNull();
  });

  it('keeps create-project intent while allowing explicit template selection', () => {
    const preview = buildSchedulerIntentPreview(
      '明天上午 10 点让设计部创建一个 ad-hoc 项目，模板 ux-driven-dev-template，目标是评审首页交互体验',
      makeDepartments(),
    );

    expect(preview.actionDraft).toMatchObject({
      kind: 'create-project',
      departmentWorkspaceUri: 'file:///Users/darrel/Documents/design',
      templateId: 'ux-driven-dev-template',
    });
  });

  it('degrades to project-only when no unique template and no execution intent', () => {
    const preview = buildSchedulerIntentPreview(
      '明天上午 10 点让设计部创建一个 ad-hoc 项目，只创建项目，目标是整理 backlog',
      makeDepartments(),
    );

    expect(preview.actionDraft).toMatchObject({
      kind: 'create-project',
      departmentWorkspaceUri: 'file:///Users/darrel/Documents/design',
    });
    expect(preview.actionDraft && 'templateId' in preview.actionDraft ? preview.actionDraft.templateId : undefined).toBeUndefined();
  });

  it('routes to dispatch-prompt when no unique template but has execution intent keywords', () => {
    const depts = new Map([
      ...makeDepartments(),
      ['file:///Users/darrel/Documents/ai-news', {
        name: 'AI 资讯部',
        type: 'operations',
        templateIds: [],
        skills: [],
        okr: null,
        description: '负责 AI 领域情报收集',
      }],
    ]);

    const preview = buildSchedulerIntentPreview(
      '明天上午 10 点让 AI 资讯部执行一次信号梳理',
      depts,
    );

    expect(preview.actionDraft).toMatchObject({
      kind: 'dispatch-prompt',
      workspace: 'file:///Users/darrel/Documents/ai-news',
    });
    expect(preview.actionDraft && 'prompt' in preview.actionDraft ? preview.actionDraft.prompt : '').toContain('信号梳理');
  });
});

describe('processCEOCommand — immediate Prompt Mode', () => {
  it('dispatches immediate prompt when command has execution intent and matches a department', async () => {
    const result = await processCEOCommand('让市场部分析最近一周的竞品动态', makeDepartments());

    expect(result.success).toBe(true);
    expect(result.action).toBe('dispatch_prompt');
    expect(result.runId).toBe('prompt-run-ceo-1');
    expect(result.message).toContain('市场部');
    expect(vi.mocked(executePrompt)).toHaveBeenCalledWith(expect.objectContaining({
      workspace: 'file:///Users/darrel/Documents/marketing',
      executionTarget: expect.objectContaining({ kind: 'prompt' }),
    }));
  });

  it('falls back to report_to_human when no department matches and no schedule intent', async () => {
    const result = await processCEOCommand('看看天气预报', makeDepartments());

    expect(result.success).toBe(false);
    expect(result.action).toBe('report_to_human');
    expect(vi.mocked(executePrompt)).not.toHaveBeenCalled();
  });

  it('returns failure message when executePrompt throws', async () => {
    vi.mocked(executePrompt).mockRejectedValueOnce(new Error('no provider'));

    const result = await processCEOCommand('让市场部执行一次内部审查', makeDepartments());

    expect(result.success).toBe(false);
    expect(result.action).toBe('report_to_human');
    expect(result.message).toContain('no provider');
  });
});