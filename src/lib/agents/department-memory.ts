/**
 * V6: Department Memory — Persistent Knowledge System
 *
 * Three-layer memory architecture:
 *   1. Organization-level (~/.gemini/antigravity/memory/) — shared across departments
 *   2. Department-level (workspace/.department/memory/) — per-workspace knowledge
 *   3. Session-level (in-memory, per run) — not persisted here
 *
 * Memory files are plain Markdown, readable by both humans and AI agents.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';

const log = createLogger('DepartmentMemory');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  timestamp: string;
  source: string;     // e.g. runId, "manual", "ceo"
  content: string;
}

export type MemoryCategory = 'knowledge' | 'decisions' | 'patterns';

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/** Read all department-level memory for a workspace. */
export function readDepartmentMemory(workspace: string): Record<MemoryCategory, string> {
  const memoryDir = path.join(workspace, '.department', 'memory');
  return {
    knowledge: readMemoryFile(memoryDir, 'knowledge.md'),
    decisions: readMemoryFile(memoryDir, 'decisions.md'),
    patterns: readMemoryFile(memoryDir, 'patterns.md'),
  };
}

/** Read organization-level memory. */
export function readOrganizationMemory(): string {
  const memoryDir = path.join(process.env.HOME || '~', '.gemini', 'antigravity', 'memory');
  if (!fs.existsSync(memoryDir)) return '';
  try {
    const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
    return files
      .map(f => fs.readFileSync(path.join(memoryDir, f), 'utf-8'))
      .join('\n\n---\n\n');
  } catch {
    return '';
  }
}

function readMemoryFile(dir: string, filename: string): string {
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/** Append an entry to a specific department memory category. */
export function appendDepartmentMemory(
  workspace: string,
  category: MemoryCategory,
  entry: MemoryEntry,
): void {
  const memoryDir = path.join(workspace, '.department', 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  const filePath = path.join(memoryDir, `${category}.md`);
  const header = `### ${entry.timestamp} (${entry.source})\n\n`;
  const content = `${header}${entry.content}\n\n---\n\n`;

  fs.appendFileSync(filePath, content, 'utf-8');
  log.info({ workspace: workspace.slice(-30), category, source: entry.source }, 'Memory appended');
}

/** Append an entry to organization-level memory. */
export function appendOrganizationMemory(
  filename: string,
  entry: MemoryEntry,
): void {
  const memoryDir = path.join(process.env.HOME || '~', '.gemini', 'antigravity', 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  const filePath = path.join(memoryDir, filename);
  const header = `### ${entry.timestamp} (${entry.source})\n\n`;
  const content = `${header}${entry.content}\n\n---\n\n`;

  fs.appendFileSync(filePath, content, 'utf-8');
  log.info({ filename, source: entry.source }, 'Organization memory appended');
}

// ---------------------------------------------------------------------------
// Run completion → memory extraction
// ---------------------------------------------------------------------------

/**
 * Extract knowledge from a completed run and persist as department memory.
 *
 * This is called by group-runtime after a run completes successfully.
 * It extracts key decisions, patterns, and knowledge from the run result.
 */
export function extractAndPersistMemory(
  workspace: string,
  runId: string,
  summary: string,
  changedFiles: string[],
): void {
  if (!summary || summary.length < 50) return; // Too short to extract anything useful

  const timestamp = new Date().toISOString();
  const shortRunId = runId.slice(0, 8);

  // Extract decisions (look for decision-related keywords)
  const decisionPatterns = /(?:decided|chose|selected|switched to|using|adopted|opted for|went with|picked)\s+(.+?)(?:\.|$)/gi;
  const decisions: string[] = [];
  let match;
  while ((match = decisionPatterns.exec(summary)) !== null) {
    decisions.push(match[0].trim());
  }

  if (decisions.length > 0) {
    appendDepartmentMemory(workspace, 'decisions', {
      timestamp,
      source: `run:${shortRunId}`,
      content: decisions.map(d => `- ${d}`).join('\n'),
    });
  }

  // Record changed files as knowledge about active areas
  if (changedFiles.length > 0) {
    const filesSummary = changedFiles.length > 10
      ? `${changedFiles.slice(0, 10).join(', ')} (+${changedFiles.length - 10} more)`
      : changedFiles.join(', ');

    appendDepartmentMemory(workspace, 'knowledge', {
      timestamp,
      source: `run:${shortRunId}`,
      content: `Files modified: ${filesSummary}\n\nSummary: ${summary.slice(0, 500)}`,
    });
  }

  log.info({ workspace: workspace.slice(-30), runId: shortRunId, decisions: decisions.length, files: changedFiles.length }, 'Memory extracted from run');
}

// ---------------------------------------------------------------------------
// Memory initialization
// ---------------------------------------------------------------------------

/** Initialize the memory directory structure for a workspace. */
export function initDepartmentMemory(workspace: string): void {
  const memoryDir = path.join(workspace, '.department', 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });

  const files: Record<string, string> = {
    'knowledge.md': '# Department Knowledge\n\nTechnical knowledge, stack preferences, and domain context.\n\n---\n\n',
    'decisions.md': '# Department Decisions\n\nArchitectural and implementation decisions with rationale.\n\n---\n\n',
    'patterns.md': '# Department Patterns\n\nBest practices, coding conventions, and lessons learned.\n\n---\n\n',
  };

  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(memoryDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  }

  log.info({ workspace: workspace.slice(-30) }, 'Department memory initialized');
}
