import {
  getDepartmentBoundWorkspaceUris,
  getDepartmentGroupKey,
} from '@/lib/department-config';
import type { DepartmentConfig, Workspace } from '@/lib/types';

export type ProjectTreeSectionSeed = {
  key: string;
  title: string;
  subtitle: string;
  primaryWorkspaceUri?: string;
  boundWorkspaceUris: string[];
  hasDepartmentConfig: boolean;
};

export function buildProjectTreeSectionSeeds(
  workspaces: Workspace[],
  departments: Map<string, DepartmentConfig> | undefined,
  projectSearch: string,
): ProjectTreeSectionSeed[] {
  const query = projectSearch.trim().toLowerCase();
  const sections = new Map<string, ProjectTreeSectionSeed>();

  for (const workspace of workspaces) {
    if (!workspace.uri) continue;

    const department = departments?.get(workspace.uri) || null;
    const primaryWorkspaceUri = getDepartmentGroupKey(department, workspace.uri, workspace.name);
    if (sections.has(primaryWorkspaceUri)) continue;

    const boundWorkspaceUris = department
      ? getDepartmentBoundWorkspaceUris(department, workspace.uri, workspace.name)
      : [workspace.uri];
    const searchable = [
      department?.name || workspace.name,
      department?.description || '',
      ...(department?.templateIds || []),
      ...boundWorkspaceUris,
    ].join(' ').toLowerCase();

    if (query && !searchable.includes(query)) continue;

    sections.set(primaryWorkspaceUri, {
      key: primaryWorkspaceUri,
      title: department?.name || workspace.name,
      subtitle: department ? `${boundWorkspaceUris.length} 个工作区` : '待配置部门',
      primaryWorkspaceUri,
      boundWorkspaceUris,
      hasDepartmentConfig: Boolean(department),
    });
  }

  return Array.from(sections.values());
}
