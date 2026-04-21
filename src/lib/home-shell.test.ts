import { describe, expect, it } from 'vitest';
import {
  countConfiguredDepartments,
  getAgentStateRefreshMs,
  getSidebarLoadPlan,
  getSidebarPollMs,
  isDepartmentConfigured,
  shouldShowShellSidebar,
} from './home-shell';

describe('home-shell', () => {
  it('treats a blank build department as unconfigured', () => {
    expect(isDepartmentConfigured({
      name: 'Engineering',
      type: 'build',
      skills: [],
      okr: null,
    })).toBe(false);
  });

  it('treats non-default signals as department configuration', () => {
    expect(isDepartmentConfigured({
      name: 'Research',
      type: 'research',
      skills: [],
      okr: null,
    })).toBe(true);

    expect(isDepartmentConfigured({
      name: 'Engineering',
      type: 'build',
      description: 'Ship product work',
      skills: [],
      okr: null,
    })).toBe(true);
  });

  it('counts configured departments across workspaces', () => {
    const departments = new Map([
      ['file:///ws-1', { name: 'Eng', type: 'build', skills: [], okr: null }],
      ['file:///ws-2', { name: 'Ops', type: 'operations', skills: [], okr: null }],
    ]);

    expect(countConfiguredDepartments([
      { uri: 'file:///ws-1' },
      { uri: 'file:///ws-2' },
      { uri: 'file:///ws-3' },
    ], departments)).toBe(1);
  });

  it('returns section-specific sidebar data plans', () => {
    expect(getSidebarLoadPlan('projects')).toEqual({
      conversations: false,
      knowledge: false,
      runtimeStatus: true,
      operationsAssets: false,
    });

    expect(getSidebarLoadPlan('operations')).toEqual({
      conversations: false,
      knowledge: false,
      runtimeStatus: true,
      operationsAssets: true,
    });

    expect(getSidebarLoadPlan('knowledge')).toEqual({
      conversations: false,
      knowledge: true,
      runtimeStatus: false,
      operationsAssets: false,
    });
  });

  it('slows down global polling for overview and settings', () => {
    expect(getAgentStateRefreshMs('overview', null)).toBe(15_000);
    expect(getAgentStateRefreshMs('projects', null)).toBe(5_000);
    expect(getAgentStateRefreshMs('projects', 'settings')).toBe(30_000);
  });

  it('uses slower sidebar polling for lower-change sections', () => {
    expect(getSidebarPollMs('conversations')).toBe(8_000);
    expect(getSidebarPollMs('projects')).toBe(15_000);
    expect(getSidebarPollMs('knowledge')).toBe(20_000);
  });

  it('hides the shell sidebar for overview and settings', () => {
    expect(shouldShowShellSidebar('overview', null)).toBe(false);
    expect(shouldShowShellSidebar('projects', 'settings')).toBe(false);
    expect(shouldShowShellSidebar('projects', null)).toBe(true);
  });
});
