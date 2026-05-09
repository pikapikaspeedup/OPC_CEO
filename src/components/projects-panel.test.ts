import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/project-workbench', async () => {
  const ReactModule = await import('react');
  return {
    default: () => ReactModule.createElement('div', { 'data-testid': 'project-workbench' }, 'mock-project-workbench'),
  };
});

vi.mock('@/components/agent-run-detail', async () => {
  const ReactModule = await import('react');
  return {
    default: ({ run }: { run: { runId: string; prompt: string } }) =>
      ReactModule.createElement('div', { 'data-testid': 'agent-run-detail' }, `agent-run-detail:${run.runId}:${run.prompt}`),
  };
});

vi.mock('@/components/pipeline-generate-dialog', async () => {
  const ReactModule = await import('react');
  return {
    default: () => ReactModule.createElement(ReactModule.Fragment, null),
  };
});

vi.mock('@/components/skill-browser', async () => {
  const ReactModule = await import('react');
  return {
    default: () => ReactModule.createElement(ReactModule.Fragment, null),
  };
});

vi.mock('@/components/department-setup-dialog', async () => {
  const ReactModule = await import('react');
  return {
    default: () => ReactModule.createElement(ReactModule.Fragment, null),
  };
});

vi.mock('@/components/local-folder-import-dialog', async () => {
  const ReactModule = await import('react');
  return {
    default: () => ReactModule.createElement(ReactModule.Fragment, null),
  };
});

vi.mock('@/lib/ceo-events', () => ({
  generateCEOEvents: () => [],
}));

import { LocaleProvider } from '@/components/locale-provider';
import type { AgentRun, DepartmentConfig, Workspace } from '@/lib/types';
import ProjectsPanel from './projects-panel';

const workspace: Workspace = {
  name: 'AI情报工作室',
  uri: 'file:///Users/darrel/Documents/baogaoai',
};

const departments = new Map<string, DepartmentConfig>([
  [workspace.uri, {
    name: 'AI情报工作室',
    type: 'research',
    provider: 'openai',
    skills: [],
    workspaceBindings: [
      {
        workspaceUri: workspace.uri,
        role: 'primary',
        writeAccess: true,
      },
    ],
  }],
]);

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    runId: 'run-only-1',
    stageId: 'daily-digest',
    workspace: workspace.uri,
    status: 'completed',
    createdAt: '2026-05-08T08:00:00.000Z',
    prompt: '整理 AI 日报',
    result: {
      status: 'completed',
      summary: 'AI 日报已生成',
      changedFiles: [],
      blockers: [],
      needsReview: [],
    },
    triggerContext: {
      source: 'scheduler',
      schedulerJobId: 'job-1',
    },
    ...overrides,
  };
}

function renderPanel({
  agentRuns,
  selectedRunId = null,
}: {
  agentRuns: AgentRun[];
  selectedRunId?: string | null;
}) {
  return renderToStaticMarkup(
    React.createElement(
      LocaleProvider,
      null,
      React.createElement(ProjectsPanel, {
        projects: [],
        agentRuns,
        workspaces: [workspace],
        departments,
        selectedProjectId: null,
        selectedStageId: null,
        selectedRunId,
        onSelectProject: () => undefined,
        onSelectRun: () => undefined,
        onCancelRun: () => undefined,
      }),
    ),
  );
}

describe('ProjectsPanel run-only results', () => {
  it('shows workspace-level recent run-only results when the workspace has no project', () => {
    const markup = renderPanel({
      agentRuns: [makeRun()],
    });

    expect(markup).toContain('最近运行结果');
    expect(markup).toContain('AI情报工作室');
    expect(markup).toContain('当前工作区暂无 Project，以下结果未挂到项目容器。');
    expect(markup).toContain('AI 日报已生成');
    expect(markup).toContain('1 条 run-only 结果');
    expect(markup).toContain('暂无项目');
    expect(markup).not.toContain('查看最近运行结果');
  });

  it('opens run-only detail mode directly from selectedRunId without requiring a project', () => {
    const run = makeRun({
      runId: 'run-only-detail',
      prompt: '生成 AI 情报日报',
      result: {
        status: 'completed',
        summary: '日报详情',
        changedFiles: [],
        blockers: [],
        needsReview: [],
      },
    });

    const markup = renderPanel({
      agentRuns: [run],
      selectedRunId: run.runId,
    });

    expect(markup).toContain('运行结果');
    expect(markup).toContain('未挂到 Project 的最近执行详情');
    expect(markup).toContain('scheduler');
    expect(markup).toContain('agent-run-detail:run-only-detail:生成 AI 情报日报');
  });
});
