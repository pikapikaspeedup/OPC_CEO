/**
 * V6: Department Rules & Memory Sync
 *
 * Manages symlinks from `.department/rules/` and `.department/workflows/`
 * to IDE-specific locations (Antigravity, Codex CLI, Claude Code, Cursor).
 *
 * Also provides helpers for reading/writing persistent department memory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';

const log = createLogger('DepartmentSync');

// ---------------------------------------------------------------------------
// IDE Adapter definitions
// ---------------------------------------------------------------------------

export type IDETarget = 'antigravity' | 'codex' | 'claude-code' | 'cursor';

interface IDEAdapterConfig {
  /** Target file or directory for rules */
  rulesTarget: (workspace: string) => string | string[];
  /** Target directory for workflows (if supported) */
  workflowsTarget?: (workspace: string) => string;
  /** Whether this IDE supports multiple rule files or needs concatenation into one */
  supportsMultipleFiles: boolean;
}

const IDE_ADAPTERS: Record<IDETarget, IDEAdapterConfig> = {
  antigravity: {
    rulesTarget: (ws) => path.join(ws, '.agent', 'rules'),
    workflowsTarget: (ws) => path.join(ws, '.agent', 'workflows'),
    supportsMultipleFiles: true,
  },
  codex: {
    rulesTarget: (ws) => path.join(ws, 'AGENTS.md'),
    supportsMultipleFiles: false,
  },
  'claude-code': {
    rulesTarget: (ws) => path.join(ws, 'CLAUDE.md'),
    supportsMultipleFiles: false,
  },
  cursor: {
    rulesTarget: (ws) => path.join(ws, '.cursorrules'),
    supportsMultipleFiles: false,
  },
};

// ---------------------------------------------------------------------------
// Sync logic
// ---------------------------------------------------------------------------

/**
 * Sync department rules to a specific IDE target.
 *
 * For multi-file IDEs (Antigravity): creates symlinks per rule file.
 * For single-file IDEs (Codex/Claude/Cursor): concatenates all rules into one file.
 */
export function syncRulesToIDE(workspace: string, target: IDETarget): { synced: string[] } {
  const rulesDir = path.join(workspace, '.department', 'rules');
  const adapter = IDE_ADAPTERS[target];
  const synced: string[] = [];

  if (!fs.existsSync(rulesDir)) {
    log.info({ workspace, target }, 'No .department/rules/ found, skipping');
    return { synced };
  }

  const ruleFiles = fs.readdirSync(rulesDir).filter(f => f.endsWith('.md'));
  if (ruleFiles.length === 0) {
    log.info({ workspace, target }, 'No rule files found in .department/rules/');
    return { synced };
  }

  if (adapter.supportsMultipleFiles) {
    // Multi-file: symlink each rule file into target directory
    const targetDir = adapter.rulesTarget(workspace) as string;
    fs.mkdirSync(targetDir, { recursive: true });

    for (const file of ruleFiles) {
      const src = path.join(rulesDir, file);
      const dst = path.join(targetDir, file);
      safeSymlink(src, dst);
      synced.push(dst);
    }

    // Also sync workflows if the IDE supports it
    if (adapter.workflowsTarget) {
      const wfDir = path.join(workspace, '.department', 'workflows');
      if (fs.existsSync(wfDir)) {
        const targetWfDir = adapter.workflowsTarget(workspace);
        fs.mkdirSync(targetWfDir, { recursive: true });

        for (const file of fs.readdirSync(wfDir).filter(f => f.endsWith('.md'))) {
          const src = path.join(wfDir, file);
          const dst = path.join(targetWfDir, file);
          safeSymlink(src, dst);
          synced.push(dst);
        }
      }
    }
  } else {
    // Single-file: concatenate all rules + memory reference into one file
    const targetFile = adapter.rulesTarget(workspace) as string;
    const parts: string[] = [];

    for (const file of ruleFiles) {
      parts.push(fs.readFileSync(path.join(rulesDir, file), 'utf-8'));
    }

    // Append memory reference guidance
    parts.push(buildMemoryReferenceSection(workspace));

    // Append workflows if any
    const wfDir = path.join(workspace, '.department', 'workflows');
    if (fs.existsSync(wfDir)) {
      const wfFiles = fs.readdirSync(wfDir).filter(f => f.endsWith('.md'));
      for (const file of wfFiles) {
        parts.push(`\n## Workflow: ${file.replace('.md', '')}\n\n` +
          fs.readFileSync(path.join(wfDir, file), 'utf-8'));
      }
    }

    fs.writeFileSync(targetFile, parts.join('\n\n---\n\n'), 'utf-8');
    synced.push(targetFile);
  }

  log.info({ workspace, target, count: synced.length }, 'Rules synced to IDE');
  return { synced };
}

/** Sync to all supported IDE targets. */
export function syncRulesToAllIDEs(workspace: string): { results: Record<IDETarget, string[]> } {
  const results = {} as Record<IDETarget, string[]>;
  for (const target of Object.keys(IDE_ADAPTERS) as IDETarget[]) {
    const { synced } = syncRulesToIDE(workspace, target);
    results[target] = synced;
  }
  return { results };
}

// ---------------------------------------------------------------------------
// Memory reference builder
// ---------------------------------------------------------------------------

function buildMemoryReferenceSection(workspace: string): string {
  const memoryDir = path.join(workspace, '.department', 'memory');
  if (!fs.existsSync(memoryDir)) return '';

  const memoryFiles = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
  if (memoryFiles.length === 0) return '';

  const lines = [
    '## Department Memory',
    '',
    'Before starting any task, check the following files for relevant context:',
  ];

  for (const file of memoryFiles) {
    const name = file.replace('.md', '').replace(/-/g, ' ');
    lines.push(`- \`.department/memory/${file}\` — ${capitalize(name)}`);
  }

  lines.push('', 'Only read the files relevant to the current task.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeSymlink(src: string, dst: string): void {
  try {
    // Remove existing symlink or file
    if (fs.existsSync(dst) || fs.lstatSync(dst).isSymbolicLink()) {
      fs.unlinkSync(dst);
    }
  } catch {
    // File doesn't exist, which is fine
  }
  fs.symlinkSync(src, dst);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
