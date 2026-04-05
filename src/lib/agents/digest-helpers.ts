/**
 * Digest Helpers — Phase 3 (F5)
 *
 * Utility functions for generating daily digest data.
 */

import { listProjects } from './project-registry';
import { queryJournal, type JournalEntry } from './execution-journal';
import type { ProjectDefinition } from './project-types';

/**
 * Get all journal entries for a given workspace on a specific date.
 * Iterates through all projects in the workspace and collects matching entries.
 */
export function getJournalEntriesForDate(workspaceUri: string, date: string): JournalEntry[] {
  const projects = getProjectsByWorkspace(workspaceUri);
  const entries: JournalEntry[] = [];

  for (const project of projects) {
    const all = queryJournal(project.projectId);
    for (const entry of all) {
      if (entry.timestamp.startsWith(date)) {
        entries.push(entry);
      }
    }
  }

  return entries;
}

/**
 * Get all projects belonging to a specific workspace.
 */
export function getProjectsByWorkspace(workspaceUri: string): ProjectDefinition[] {
  const all = listProjects();
  return all.filter(p => p.workspace === workspaceUri);
}

/**
 * Generate a template-based summary (no LLM dependency).
 * Used as the initial summary strategy before Phase 5 LLM integration.
 */
export function templateSummary(
  completed: Array<{ name: string }>,
  inProgress: Array<{ name: string }>,
): string {
  const parts: string[] = [];
  if (completed.length) parts.push(`完成 ${completed.length} 项任务`);
  if (inProgress.length) parts.push(`${inProgress.length} 项进行中`);
  return parts.join('，') || '今日暂无活动';
}
