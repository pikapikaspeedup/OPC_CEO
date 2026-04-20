/**
 * Department Memory Bridge — Management Plane → Execution Plane
 *
 * Bridges department-level memory (shared + per-provider) into the
 * execution layer via the MemoryHooks system.
 *
 * Directory structure:
 *   .department/memory/
 *   ├── shared/              ← Shared across all providers
 *   │   ├── decisions.md
 *   │   └── patterns.md
 *   ├── claude-engine/       ← Claude Provider specific
 *   │   └── ...
 *   └── codex/               ← Codex Provider specific
 *       └── ...
 *
 * Falls back to legacy flat structure (knowledge.md/decisions.md/patterns.md)
 * if shared/ directory doesn't exist.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { ProviderId } from '../providers';
import type { MemoryEntry } from '../backends/types';
import type { BackendMemoryHook } from '../backends/memory-hooks';
import { registerMemoryHook } from '../backends/memory-hooks';
import { listRecentKnowledgeAssets } from '../knowledge';
import {
  readDepartmentMemory,
  readOrganizationMemory,
} from './department-memory';
import { createLogger } from '../logger';

const log = createLogger('DeptMemoryBridge');

// ---------------------------------------------------------------------------
// Provider name mapping
// ---------------------------------------------------------------------------

const PROVIDER_DIR_MAP: Record<string, string> = {
  'claude-code': 'claude-engine',
  'codex': 'codex',
  'gemini': 'codex',
  'antigravity': 'claude-engine',
};

function providerDirName(providerId: ProviderId): string {
  return PROVIDER_DIR_MAP[providerId as string] ?? 'claude-engine';
}

function workspacePathToUri(workspace: string): string {
  return workspace.startsWith('file://') ? workspace : `file://${workspace}`;
}

// ---------------------------------------------------------------------------
// Bridge read functions
// ---------------------------------------------------------------------------

/** Read shared department memory (decisions + patterns). */
export function readSharedDepartmentMemory(workspace: string): string {
  const sharedDir = path.join(workspace, '.department', 'memory', 'shared');
  const structuredAssets = listRecentKnowledgeAssets(5, workspacePathToUri(workspace))
    .filter((asset) => asset.status !== 'proposal')
    .map((asset) => `### ${asset.title}\n\n${asset.content.trim()}`);
  const structuredSection = structuredAssets.length > 0
    ? `## Structured Knowledge Assets\n\n${structuredAssets.join('\n\n---\n\n')}`
    : '';

  // Try new shared/ directory first
  if (fs.existsSync(sharedDir)) {
    const shared = readAllMarkdownInDir(sharedDir);
    return [shared, structuredSection].filter(Boolean).join('\n\n');
  }

  // Fall back to legacy flat structure
  const legacy = readDepartmentMemory(workspace);
  const parts: string[] = [];
  if (legacy.decisions) parts.push(`## Decisions\n\n${legacy.decisions}`);
  if (legacy.patterns) parts.push(`## Patterns\n\n${legacy.patterns}`);
  if (legacy.knowledge) parts.push(`## Knowledge\n\n${legacy.knowledge}`);
  if (structuredSection) parts.push(structuredSection);
  return parts.join('\n\n');
}

/** Read provider-specific department memory. */
export function readProviderDepartmentMemory(
  workspace: string,
  providerId: ProviderId,
): string {
  const dirName = providerDirName(providerId);
  const providerDir = path.join(workspace, '.department', 'memory', dirName);
  if (!fs.existsSync(providerDir)) return '';
  return readAllMarkdownInDir(providerDir);
}

/** Build complete memory content for a specific provider. */
export function buildDepartmentMemoryForProvider(
  workspace: string,
  providerId: ProviderId,
): { shared: string; providerSpecific: string; organization: string } {
  return {
    shared: readSharedDepartmentMemory(workspace),
    providerSpecific: readProviderDepartmentMemory(workspace, providerId),
    organization: readOrganizationMemory(),
  };
}

// ---------------------------------------------------------------------------
// Convert to MemoryEntry format (for BackendRunConfig.memoryContext)
// ---------------------------------------------------------------------------

function toMemoryEntries(
  content: string,
  type: 'project' | 'feedback' | 'user',
  name: string,
): MemoryEntry[] {
  if (!content.trim()) return [];
  return [{
    type,
    name,
    content: content.trim(),
    updatedAt: new Date().toISOString(),
  }];
}

// ---------------------------------------------------------------------------
// MemoryHook implementation
// ---------------------------------------------------------------------------

export const departmentMemoryHook: BackendMemoryHook = {
  id: 'department-memory-bridge',

  async beforeRun({ providerId, config }) {
    const workspace = config.workspacePath;
    if (!workspace) return;

    // Check if .department/memory/ exists at all
    const memDir = path.join(workspace, '.department', 'memory');
    if (!fs.existsSync(memDir)) {
      log.debug({ workspace: workspace.slice(-30) }, 'No .department/memory/, skipping');
      return;
    }

    const memory = buildDepartmentMemoryForProvider(workspace, providerId);

    const projectMemories: MemoryEntry[] = [
      ...toMemoryEntries(memory.shared, 'project', 'department-shared'),
      ...toMemoryEntries(memory.providerSpecific, 'project', `department-${providerDirName(providerId)}`),
    ];

    const departmentMemories: MemoryEntry[] = [
      ...toMemoryEntries(memory.organization, 'feedback', 'organization-memory'),
    ];

    if (projectMemories.length === 0 && departmentMemories.length === 0) {
      return;
    }

    log.info({
      workspace: workspace.slice(-30),
      providerId,
      sharedLen: memory.shared.length,
      providerLen: memory.providerSpecific.length,
      orgLen: memory.organization.length,
    }, 'Injecting department memory');

    return { projectMemories, departmentMemories };
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

let registered = false;

/** Register the department memory hook. Safe to call multiple times. */
export function registerDepartmentMemoryBridge(): void {
  if (registered) return;
  registerMemoryHook(departmentMemoryHook);
  registered = true;
  log.info('Department memory bridge registered');
}

// ---------------------------------------------------------------------------
// Directory initialization (extended for per-provider)
// ---------------------------------------------------------------------------

/** Initialize the department memory directory with shared + provider structure. */
export function initDepartmentMemoryV2(workspace: string): void {
  const baseDir = path.join(workspace, '.department', 'memory');

  // Create shared directory
  const sharedDir = path.join(baseDir, 'shared');
  fs.mkdirSync(sharedDir, { recursive: true });

  // Create default shared files if missing
  const sharedFiles: Record<string, string> = {
    'decisions.md': '# Department Decisions\n\nArchitectural and implementation decisions with rationale.\n\n---\n\n',
    'patterns.md': '# Department Patterns\n\nBest practices, coding conventions, and lessons learned.\n\n---\n\n',
  };

  for (const [filename, content] of Object.entries(sharedFiles)) {
    const filePath = path.join(sharedDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  }

  // Create provider directories (empty, ready for use)
  for (const dirName of ['claude-engine', 'codex']) {
    fs.mkdirSync(path.join(baseDir, dirName), { recursive: true });
  }

  log.info({ workspace: workspace.slice(-30) }, 'Department memory V2 initialized');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readAllMarkdownInDir(dir: string): string {
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort();
    return files
      .map(f => {
        try {
          return fs.readFileSync(path.join(dir, f), 'utf-8');
        } catch {
          return '';
        }
      })
      .filter(Boolean)
      .join('\n\n---\n\n');
  } catch {
    return '';
  }
}
