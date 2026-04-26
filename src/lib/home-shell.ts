import type { DepartmentConfig } from './types';

export type AppShellSection =
  | 'ceo'
  | 'projects'
  | 'conversations'
  | 'knowledge'
  | 'operations';

export type AppShellUtilityPanel = 'settings' | null;

export interface SidebarLoadPlan {
  conversations: boolean;
  knowledge: boolean;
  runtimeStatus: boolean;
  operationsAssets: boolean;
}

export function isDepartmentConfigured(config: DepartmentConfig | null | undefined): boolean {
  if (!config) return false;
  if (config.type !== 'build') return true;
  if (config.description?.trim()) return true;
  if (config.okr) return true;
  if (config.skills.length > 0) return true;
  if ((config.templateIds?.length || 0) > 0) return true;
  return false;
}

export function countConfiguredDepartments(
  workspaces: Array<{ uri: string }>,
  departments: Map<string, DepartmentConfig>,
): number {
  return workspaces.reduce((count, workspace) => (
    count + (isDepartmentConfigured(departments.get(workspace.uri)) ? 1 : 0)
  ), 0);
}

export function getSidebarLoadPlan(section: AppShellSection): SidebarLoadPlan {
  switch (section) {
    case 'conversations':
      return {
        conversations: true,
        knowledge: false,
        runtimeStatus: true,
        operationsAssets: false,
      };
    case 'ceo':
      return {
        conversations: false,
        knowledge: false,
        runtimeStatus: false,
        operationsAssets: false,
      };
    case 'knowledge':
      return {
        conversations: false,
        knowledge: false,
        runtimeStatus: false,
        operationsAssets: false,
      };
    case 'operations':
      return {
        conversations: false,
        knowledge: false,
        runtimeStatus: false,
        operationsAssets: false,
      };
    case 'projects':
      return {
        conversations: false,
        knowledge: false,
        runtimeStatus: false,
        operationsAssets: false,
      };
    default:
      return {
        conversations: true,
        knowledge: false,
        runtimeStatus: false,
        operationsAssets: false,
      };
  }
}

export function getSidebarPollMs(section: AppShellSection): number {
  switch (section) {
    case 'conversations':
      return 8_000;
    case 'ceo':
    case 'operations':
    case 'projects':
    case 'knowledge':
      return 60_000;
    default:
      return 8_000;
  }
}

export function getAgentStateRefreshMs(
  section: AppShellSection,
  utilityPanel: AppShellUtilityPanel,
): number {
  void section;
  void utilityPanel;
  return 60_000;
}

export function shouldShowShellSidebar(
  _section: AppShellSection,
  utilityPanel: AppShellUtilityPanel,
): boolean {
  return utilityPanel === null;
}
