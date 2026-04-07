import { describe, expect, it } from 'vitest';
import { buildSchedulerIntentPreview } from './ceo-agent';
import type { DepartmentConfig } from '../types';

function makeDepartments(): Map<string, DepartmentConfig> {
  return new Map([
    ['file:///Users/darrel/Documents/marketing', {
      name: '市场部',
      type: 'operations',
      skills: [],
      okr: null,
      description: '负责市场、SEO 和增长',
    }],
    ['file:///Users/darrel/Documents/design', {
      name: '设计部',
      type: 'build',
      skills: [],
      okr: null,
      description: '负责设计和体验评审',
    }],
  ]);
}

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
});