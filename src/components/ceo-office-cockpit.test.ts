import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/chat', async () => {
  const ReactModule = await import('react');
  return {
    default: ({ conversationId }: { conversationId?: string | null }) =>
      ReactModule.createElement(
        'div',
        { 'data-testid': 'mock-chat', 'data-thread': conversationId ?? '' },
        `mock-chat-${conversationId ?? 'none'}`,
      ),
  };
});

vi.mock('@/components/chat-input', async () => {
  const ReactModule = await import('react');
  return {
    default: ({ activeId }: { activeId?: string }) =>
      ReactModule.createElement(
        'div',
        { 'data-testid': 'mock-chat-input', 'data-thread': activeId ?? '' },
        `mock-chat-input-${activeId ?? 'none'}`,
      ),
  };
});

vi.mock('@/components/ceo-dashboard', async () => {
  const ReactModule = await import('react');
  return {
    default: () => ReactModule.createElement('div', { 'data-testid': 'mock-ceo-dashboard' }, 'mock-ceo-dashboard'),
  };
});

vi.mock('@/components/approval-panel', async () => {
  const ReactModule = await import('react');
  return {
    default: () => ReactModule.createElement('div', { 'data-testid': 'mock-approval-panel' }, 'mock-approval-panel'),
  };
});

vi.mock('@/components/department-detail-drawer', async () => {
  const ReactModule = await import('react');
  return {
    default: () => ReactModule.createElement(ReactModule.Fragment, null),
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    me: () => Promise.resolve(null),
    ceoRoutine: () => Promise.resolve(null),
    managementOverview: () => Promise.resolve(null),
    companyLoopPolicies: () => Promise.resolve({ items: [] }),
    companyLoopRuns: () => Promise.resolve({ items: [] }),
    companyLoopDigests: () => Promise.resolve({ items: [] }),
    systemImprovementSignals: () => Promise.resolve({ items: [], total: 0 }),
    systemImprovementProposals: () => Promise.resolve({ items: [] }),
    ceoDecisions: () => Promise.resolve({ items: [] }),
    getDailyDigest: () => Promise.resolve(null),
    generateSystemImprovementProposal: () => Promise.resolve(null),
    runCompanyLoopNow: () => Promise.resolve(null),
    updateCompanyLoopPolicy: () => Promise.resolve(null),
  },
}));

import { LocaleProvider } from '@/components/locale-provider';
import CeoOfficeCockpit from './ceo-office-cockpit';

type CockpitProps = React.ComponentProps<typeof CeoOfficeCockpit>;

function baseProps(overrides: Partial<CockpitProps> = {}): CockpitProps {
  const defaults: CockpitProps = {
    locale: 'zh',
    connected: true,
    activeId: null,
    activeTitle: '',
    steps: null,
    loading: false,
    isActive: false,
    isRunning: false,
    sendError: null,
    currentModel: 'MODEL_AUTO',
    models: [],
    skills: [],
    workflows: [],
    agenticMode: true,
    activeRuns: [],
    pendingApprovals: 0,
    projects: [],
    workspaces: [],
    departments: new Map(),
    configuredDepartmentCount: 0,
    ceoHistory: [],
    ceoPriorityTasks: [],
    ceoRecentEvents: [],
    refreshSignal: 0,
    onCreateCeoConversation: () => undefined,
    onOpenProjects: () => undefined,
    onOpenKnowledge: () => undefined,
    onNavigateToKnowledge: () => undefined,
    onOpenOps: () => undefined,
    onOpenImprovementProposal: () => undefined,
    onOpenSettings: () => undefined,
    onSelectConversation: () => undefined,
    onNavigateToProject: () => undefined,
    onOpenDecisionTarget: () => undefined,
    onSend: () => undefined,
    onCancel: () => undefined,
    onProceed: () => undefined,
    onModelChange: () => undefined,
    onAgenticModeChange: () => undefined,
    onDepartmentSaved: () => undefined,
    onRefreshDashboard: () => undefined,
  };
  return { ...defaults, ...overrides };
}

function render(props: Partial<CockpitProps> = {}): string {
  return renderToStaticMarkup(
    React.createElement(LocaleProvider, null, React.createElement(CeoOfficeCockpit, baseProps(props))),
  );
}

describe('CeoOfficeCockpit layout', () => {
  it('renders the welcome state with sample prompts when no active thread', () => {
    const markup = render({ activeId: null });

    expect(markup).toContain('data-testid="ceo-office-welcome"');
    expect(markup).toContain('data-testid="welcome-input"');
    expect(markup).toContain('data-testid="welcome-submit"');
    expect(markup).toContain('今天公司哪些事最值得我关心？');
    // No active chat workspace yet
    expect(markup).not.toContain('data-testid="mock-chat"');
    expect(markup).not.toContain('data-testid="mock-chat-input"');
  });

  it('renders the chat workspace when a thread is active', () => {
    const markup = render({ activeId: 'thread-42', activeTitle: '研发部规划' });

    expect(markup).toContain('data-testid="ceo-chat-workspace"');
    expect(markup).toContain('data-testid="mock-chat"');
    expect(markup).toContain('data-thread="thread-42"');
    expect(markup).toContain('data-testid="mock-chat-input"');
    // Welcome state is replaced
    expect(markup).not.toContain('data-testid="ceo-office-welcome"');
  });

  it('shows the operations sidebar by default with operational widgets', () => {
    const markup = render({ activeId: 'thread-7' });

    expect(markup).toContain('data-testid="ceo-ops-sidebar"');
    expect(markup).toContain('待审批');
    expect(markup).toContain('风险项目');
    expect(markup).toContain('活跃任务');
    expect(markup).toContain('今日关注');
  });

  it('does not render the removed "打开完整线程" / small thread workbench buttons', () => {
    const markup = render({ activeId: 'thread-7', activeTitle: '研发部规划' });

    expect(markup).not.toContain('打开完整线程');
    expect(markup).not.toContain('查看线程');
    expect(markup).not.toContain('收起线程');
    expect(markup).not.toContain('CEO 指令中心');
  });

  it('exposes thread switcher and ops toggle controls in the top bar', () => {
    const markup = render({ activeId: 'thread-7' });

    expect(markup).toContain('data-testid="cockpit-thread-toggle"');
    expect(markup).toContain('data-testid="cockpit-ops-toggle"');
    expect(markup).toContain('data-testid="cockpit-ops-mobile-toggle"');
  });

  it('renders status pills reflecting current state in the top bar', () => {
    const approvedMarkup = render({ activeId: null, pendingApprovals: 0, projects: [] });
    expect(approvedMarkup).toContain('审批已清');
    expect(approvedMarkup).toContain('风险清零');
    expect(approvedMarkup).toContain('无活跃任务');

    const busyMarkup = render({
      activeId: null,
      pendingApprovals: 3,
      projects: [
        { id: 'p1', status: 'failed', name: 'p1', workspace: 'ws', updatedAt: new Date().toISOString() } as never,
      ],
      activeRuns: [{ runId: 'r1' } as never],
    });
    expect(busyMarkup).toContain('3 待审批');
    expect(busyMarkup).toContain('1 风险项目');
    expect(busyMarkup).toContain('1 活跃任务');
  });
});
