/**
 * Department Sync — Canonical Assets → IDE Mirrors
 *
 * Source of truth:
 *   1. workspace/.department/config.json
 *   2. gateway/assets/workflows|skills|rules
 *   3. workspace/.department/memory
 *
 * Output:
 *   - Antigravity: workspace/.agents/rules + workspace/.agents/workflows
 *   - Codex / Claude Code / Cursor: single-file instructions with embedded
 *     department rules, memory references, and allowed workflow catalog
 */

import * as fs from 'fs';
import * as path from 'path';

import { getCanonicalWorkflow } from './canonical-assets';
import {
  buildDepartmentIdentityRule,
  getTemplateWorkflowRefs,
  readDepartmentConfig,
} from './department-capability-registry';
import { createLogger } from '../logger';

const log = createLogger('DepartmentSync');

export type IDETarget = 'antigravity' | 'codex' | 'claude-code' | 'cursor';

interface IDEAdapterConfig {
  rulesTarget: (workspace: string) => string;
  workflowsTarget?: (workspace: string) => string;
  supportsMultipleFiles: boolean;
}

const IDE_ADAPTERS: Record<IDETarget, IDEAdapterConfig> = {
  antigravity: {
    rulesTarget: (workspace) => path.join(workspace, '.agents', 'rules'),
    workflowsTarget: (workspace) => path.join(workspace, '.agents', 'workflows'),
    supportsMultipleFiles: true,
  },
  codex: {
    rulesTarget: (workspace) => path.join(workspace, 'AGENTS.md'),
    supportsMultipleFiles: false,
  },
  'claude-code': {
    rulesTarget: (workspace) => path.join(workspace, 'CLAUDE.md'),
    supportsMultipleFiles: false,
  },
  cursor: {
    rulesTarget: (workspace) => path.join(workspace, '.cursorrules'),
    supportsMultipleFiles: false,
  },
};

type SyncArtifact = { name: string; content: string };

function readLocalDepartmentRules(workspace: string): SyncArtifact[] {
  const canonicalDir = path.join(workspace, '.department', 'rules');
  const legacyDir = path.join(workspace, '.agents', 'rules');
  const seen = new Set<string>();
  const artifacts: SyncArtifact[] = [];

  for (const dir of [canonicalDir, legacyDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((entry) => entry.endsWith('.md')).sort()) {
      const name = file.replace(/\.md$/i, '');
      if (name === 'department-identity' || seen.has(name)) continue;
      seen.add(name);
      artifacts.push({
        name,
        content: fs.readFileSync(path.join(dir, file), 'utf-8'),
      });
    }
  }

  return artifacts;
}

function collectWorkflowRefs(workspace: string): string[] {
  const config = readDepartmentConfig(workspace);
  const refs = new Set<string>();

  for (const skill of config.skills ?? []) {
    const workflowRef = skill.workflowRef?.trim();
    if (workflowRef) {
      refs.add(workflowRef.startsWith('/') ? workflowRef : `/${workflowRef}`);
    }
  }

  for (const templateId of config.templateIds ?? []) {
    for (const ref of getTemplateWorkflowRefs(templateId)) {
      refs.add(ref);
    }
  }

  return [...refs];
}

function collectWorkflowArtifacts(workspace: string): SyncArtifact[] {
  return collectWorkflowRefs(workspace)
    .map((ref) => getCanonicalWorkflow(ref))
    .filter((workflow): workflow is NonNullable<ReturnType<typeof getCanonicalWorkflow>> => Boolean(workflow))
    .map((workflow) => ({
      name: workflow.name,
      content: workflow.content || '',
    }));
}

function buildMemoryReferenceSection(workspace: string): string {
  const memoryDir = path.join(workspace, '.department', 'memory');
  if (!fs.existsSync(memoryDir)) return '';

  const sections: string[] = ['## Department Memory', '', 'Read relevant memory files before executing the task:'];
  const walk = (dir: string, relative = '.department/memory') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        sections.push(`- \`${rel}\``);
      }
    }
  };

  walk(memoryDir);
  sections.push('', 'Only read the files relevant to the current task.');
  return sections.join('\n');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function renderSingleFileInstructions(workspace: string): string {
  const config = readDepartmentConfig(workspace);
  const identity = buildDepartmentIdentityRule(config, workspace);
  const localRules = readLocalDepartmentRules(workspace);
  const workflows = collectWorkflowArtifacts(workspace);
  const parts = [identity];

  if (localRules.length > 0) {
    parts.push('## Department Rules');
    for (const rule of localRules) {
      parts.push(`### ${rule.name}`, rule.content.trim());
    }
  }

  const memorySection = buildMemoryReferenceSection(workspace);
  if (memorySection) {
    parts.push(memorySection);
  }

  if (workflows.length > 0) {
    parts.push('## Department Workflows');
    parts.push('Use these workflows when appropriate for this department.');
    for (const workflow of workflows) {
      parts.push(`### ${workflow.name}`, workflow.content.trim());
    }
  }

  return parts.join('\n\n');
}

function syncAntigravity(workspace: string): string[] {
  const rulesDir = IDE_ADAPTERS.antigravity.rulesTarget(workspace);
  const workflowsDir = IDE_ADAPTERS.antigravity.workflowsTarget!(workspace);
  const synced: string[] = [];

  ensureDir(rulesDir);
  ensureDir(workflowsDir);

  const config = readDepartmentConfig(workspace);
  const identity = buildDepartmentIdentityRule(config, workspace);
  const identityPath = path.join(rulesDir, 'department-identity.md');
  writeFile(identityPath, identity);
  synced.push(identityPath);

  for (const rule of readLocalDepartmentRules(workspace)) {
    const target = path.join(rulesDir, `${rule.name}.md`);
    writeFile(target, rule.content);
    synced.push(target);
  }

  for (const workflow of collectWorkflowArtifacts(workspace)) {
    const target = path.join(workflowsDir, `${workflow.name}.md`);
    writeFile(target, workflow.content);
    synced.push(target);
  }

  return synced;
}

export function syncRulesToIDE(workspace: string, target: IDETarget): { synced: string[] } {
  const adapter = IDE_ADAPTERS[target];
  if (adapter.supportsMultipleFiles) {
    const synced = syncAntigravity(workspace);
    log.info({ workspace, target, count: synced.length }, 'Department assets synced to IDE mirror');
    return { synced };
  }

  const targetFile = adapter.rulesTarget(workspace);
  writeFile(targetFile, renderSingleFileInstructions(workspace));
  log.info({ workspace, target }, 'Department assets synced to single-file IDE target');
  return { synced: [targetFile] };
}

export function syncRulesToAllIDEs(workspace: string): { results: Record<IDETarget, string[]> } {
  const results = {} as Record<IDETarget, string[]>;
  for (const target of Object.keys(IDE_ADAPTERS) as IDETarget[]) {
    results[target] = syncRulesToIDE(workspace, target).synced;
  }
  return { results };
}
