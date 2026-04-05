/**
 * CEO Agent — Tool Implementations (Phase 5)
 *
 * These are the tools the AI CEO can invoke to interact with the system.
 * Each tool wraps existing backend APIs.
 */

import { listProjects, createProject, getProject } from './project-registry';
import type { DepartmentConfig } from '../types';
import { createLogger } from '../logger';

const log = createLogger('CEOTools');

/**
 * List all departments with their current status.
 */
export function listDepartments(
  departments: Map<string, DepartmentConfig>,
): Array<{
  workspaceUri: string;
  name: string;
  type: string;
  skillCount: number;
  activeProjects: number;
}> {
  const allProjects = listProjects();
  const result = [];

  for (const [uri, config] of departments) {
    const wsProjects = allProjects.filter(p => p.workspace === uri);
    result.push({
      workspaceUri: uri,
      name: config.name,
      type: config.type,
      skillCount: config.skills.length,
      activeProjects: wsProjects.filter(p => p.status === 'active').length,
    });
  }

  return result;
}

/**
 * Get skills for a specific department.
 */
export function getDepartmentSkills(
  workspaceUri: string,
  departments: Map<string, DepartmentConfig>,
): Array<{ name: string; category: string; difficulty?: string }> | null {
  const dept = departments.get(workspaceUri);
  if (!dept) return null;
  return dept.skills.map(s => ({
    name: s.name,
    category: s.category,
    difficulty: s.difficulty,
  }));
}

/**
 * Get department load assessment.
 */
export function getDepartmentLoad(
  workspaceUri: string,
  departments: Map<string, DepartmentConfig>,
): { name: string; active: number; completed: number; failed: number; load: 'low' | 'medium' | 'high' } | null {
  const dept = departments.get(workspaceUri);
  if (!dept) return null;

  const allProjects = listProjects();
  const wsProjects = allProjects.filter(p => p.workspace === workspaceUri);
  const active = wsProjects.filter(p => p.status === 'active').length;
  const completed = wsProjects.filter(p => p.status === 'completed').length;
  const failed = wsProjects.filter(p => p.status === 'failed').length;

  const load = active >= 5 ? 'high' : active >= 2 ? 'medium' : 'low';

  return { name: dept.name, active, completed, failed, load };
}

/**
 * Create a project via the CEO agent.
 */
export function ceoCreateProject(params: {
  name: string;
  goal: string;
  workspace: string;
  projectType?: 'coordinated' | 'adhoc' | 'strategic';
  skillHint?: string;
  priority?: 'urgent' | 'high' | 'normal' | 'low';
}): { projectId: string; name: string } {
  const project = createProject({
    name: params.name,
    goal: params.goal,
    workspace: params.workspace,
    templateId: '',
    projectType: params.projectType || 'adhoc',
    skillHint: params.skillHint,
    priority: params.priority,
  });

  log.info({ projectId: project.projectId, name: project.name }, 'CEO created project');
  return { projectId: project.projectId, name: project.name };
}

/**
 * Get project status.
 */
export function getProjectStatus(
  projectId: string,
): { projectId: string; name: string; status: string; stagesSummary?: string } | null {
  const project = getProject(projectId);
  if (!project) return null;

  const stages = project.pipelineState?.stages || [];
  const completed = stages.filter(s => s.status === 'completed' || s.status === 'skipped').length;
  const stagesSummary = stages.length > 0 ? `${completed}/${stages.length} stages` : undefined;

  return {
    projectId: project.projectId,
    name: project.name,
    status: project.status,
    stagesSummary,
  };
}
