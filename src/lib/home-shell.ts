import type { DepartmentConfig } from './types';

export type AppShellSection =
  | 'overview'
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
        conversations: true,
        knowledge: false,
        runtimeStatus: false,
        operationsAssets: false,
      };
    case 'knowledge':
      return {
        conversations: false,
        knowledge: true,
        runtimeStatus: false,
        operationsAssets: false,
      };
    case 'operations':
      return {
        conversations: false,
        knowledge: false,
        runtimeStatus: true,
        operationsAssets: true,
      };
    case 'projects':
      return {
        conversations: false,
        knowledge: false,
        runtimeStatus: true,
        operationsAssets: false,
      };
    case 'overview':
    default:
      return {
        conversations: false,
        knowledge: false,
        runtimeStatus: false,
        operationsAssets: false,
      };
  }
}

export function getSidebarPollMs(section: AppShellSection): number {
  switch (section) {
    case 'conversations':
    case 'ceo':
      return 8_000;
    case 'operations':
      return 10_000;
    case 'projects':
      return 15_000;
    case 'knowledge':
      return 20_000;
    case 'overview':
    default:
      return 30_000;
  }
}

export function getAgentStateRefreshMs(
  section: AppShellSection,
  utilityPanel: AppShellUtilityPanel,
): number {
  if (utilityPanel === 'settings') return 30_000;

  switch (section) {
    case 'overview':
    case 'knowledge':
      return 15_000;
    case 'projects':
    case 'conversations':
    case 'operations':
    case 'ceo':
    default:
      return 5_000;
  }
}

export function shouldShowShellSidebar(
  section: AppShellSection,
  utilityPanel: AppShellUtilityPanel,
): boolean {
  return utilityPanel === null && section !== 'overview';
}
