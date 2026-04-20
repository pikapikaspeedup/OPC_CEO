/**
 * SkillStore — 技能持久化管理
 * 借鉴 Hermes Agent 的 Skills 系统，实现过程性记忆
 * 
 * 目录结构:
 *   ~/.claude-engine/skills/<skill-name>/SKILL.md
 *   <workspace>/.claude/skills/<skill-name>/SKILL.md
 */

import { mkdir, readFile, writeFile, readdir, stat, unlink, rmdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

// ─── Types ──────────────────────────────────────────────────────

export type SkillMetadata = {
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  usageCount: number;
  source: 'learned' | 'manual' | 'imported';
};

export type SkillEntry = {
  name: string;
  path: string;
  description: string;
  content: string;
  metadata: SkillMetadata;
  scope: 'global' | 'project';
};

// ─── Constants ──────────────────────────────────────────────────

const GLOBAL_SKILLS_DIR = join(homedir(), '.claude-engine', 'skills');
const METADATA_FILE = 'meta.json';
const SKILL_FILE = 'SKILL.md';

// ─── SkillStore ────────────────────────────────────────────────

export class SkillStore {
  private globalDir: string;
  private projectDir: string | null;

  constructor(workspacePath?: string) {
    this.globalDir = GLOBAL_SKILLS_DIR;
    this.projectDir = workspacePath
      ? join(workspacePath, '.claude', 'skills')
      : null;
  }

  /**
   * List all available skills (global + project).
   */
  async listSkills(): Promise<SkillEntry[]> {
    const skills: SkillEntry[] = [];

    // Global skills
    const globalSkills = await this.scanDir(this.globalDir, 'global');
    skills.push(...globalSkills);

    // Project skills
    if (this.projectDir) {
      const projectSkills = await this.scanDir(this.projectDir, 'project');
      skills.push(...projectSkills);
    }

    // Sort by usage count (most used first), then by updatedAt
    skills.sort((a, b) => {
      if (b.metadata.usageCount !== a.metadata.usageCount) {
        return b.metadata.usageCount - a.metadata.usageCount;
      }
      return b.metadata.updatedAt.localeCompare(a.metadata.updatedAt);
    });

    return skills;
  }

  /**
   * Get a specific skill by name.
   */
  async getSkill(name: string): Promise<SkillEntry | null> {
    // Check project first, then global
    if (this.projectDir) {
      const skill = await this.loadSkill(join(this.projectDir, name), 'project');
      if (skill) return skill;
    }

    const skill = await this.loadSkill(join(this.globalDir, name), 'global');
    return skill;
  }

  /**
   * Create or update a skill.
   */
  async saveSkill(
    name: string,
    content: string,
    options: {
      description?: string;
      tags?: string[];
      scope?: 'global' | 'project';
      source?: 'learned' | 'manual' | 'imported';
    } = {},
  ): Promise<SkillEntry> {
    const scope = options.scope ?? 'global';
    const baseDir = scope === 'project' && this.projectDir
      ? this.projectDir
      : this.globalDir;
    const skillDir = join(baseDir, sanitizeName(name));
    const skillPath = join(skillDir, SKILL_FILE);
    const metaPath = join(skillDir, METADATA_FILE);

    await mkdir(skillDir, { recursive: true });

    // Load existing metadata if updating
    let existingMeta: SkillMetadata | null = null;
    try {
      const metaContent = await readFile(metaPath, 'utf-8');
      existingMeta = JSON.parse(metaContent) as SkillMetadata;
    } catch { /* new skill */ }

    const now = new Date().toISOString();
    const description = options.description
      ?? extractDescription(content)
      ?? name;

    const metadata: SkillMetadata = {
      name: sanitizeName(name),
      description,
      createdAt: existingMeta?.createdAt ?? now,
      updatedAt: now,
      tags: options.tags ?? existingMeta?.tags ?? [],
      usageCount: existingMeta?.usageCount ?? 0,
      source: options.source ?? existingMeta?.source ?? 'manual',
    };

    await writeFile(skillPath, content, 'utf-8');
    await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

    return {
      name: metadata.name,
      path: skillPath,
      description: metadata.description,
      content,
      metadata,
      scope,
    };
  }

  /**
   * Delete a skill.
   */
  async deleteSkill(name: string, scope?: 'global' | 'project'): Promise<boolean> {
    const dirs: string[] = [];
    if (scope === 'project' && this.projectDir) {
      dirs.push(join(this.projectDir, name));
    } else if (scope === 'global') {
      dirs.push(join(this.globalDir, name));
    } else {
      // Try project first, then global
      if (this.projectDir) dirs.push(join(this.projectDir, name));
      dirs.push(join(this.globalDir, name));
    }

    for (const skillDir of dirs) {
      try {
        const skillPath = join(skillDir, SKILL_FILE);
        const metaPath = join(skillDir, METADATA_FILE);
        await unlink(skillPath).catch(() => {});
        await unlink(metaPath).catch(() => {});
        await rmdir(skillDir).catch(() => {});
        return true;
      } catch { /* continue */ }
    }

    return false;
  }

  /**
   * Record that a skill was used (increment usage count).
   */
  async recordUsage(name: string): Promise<void> {
    const skill = await this.getSkill(name);
    if (!skill) return;

    const metaPath = join(
      skill.scope === 'project' && this.projectDir
        ? this.projectDir
        : this.globalDir,
      name,
      METADATA_FILE,
    );

    skill.metadata.usageCount += 1;
    skill.metadata.updatedAt = new Date().toISOString();

    await writeFile(metaPath, JSON.stringify(skill.metadata, null, 2), 'utf-8');
  }

  /**
   * Search skills by query (matches name, description, tags, content).
   */
  async searchSkills(query: string): Promise<SkillEntry[]> {
    const all = await this.listSkills();
    const queryLower = query.toLowerCase();

    return all.filter(skill => {
      if (skill.name.toLowerCase().includes(queryLower)) return true;
      if (skill.description.toLowerCase().includes(queryLower)) return true;
      if (skill.metadata.tags.some(t => t.toLowerCase().includes(queryLower))) return true;
      if (skill.content.toLowerCase().includes(queryLower)) return true;
      return false;
    });
  }

  /**
   * Build skills summary for system prompt injection.
   * Returns a concise list of available skills.
   */
  async buildSkillsSummary(): Promise<string> {
    const skills = await this.listSkills();
    if (skills.length === 0) return '';

    const lines = [
      'You have access to the following learned skills:',
      '',
    ];

    for (const skill of skills.slice(0, 30)) {
      const tags = skill.metadata.tags.length > 0
        ? ` [${skill.metadata.tags.join(', ')}]`
        : '';
      const usageNote = skill.metadata.usageCount > 0
        ? ` (used ${skill.metadata.usageCount}x)`
        : '';
      lines.push(`- **${skill.name}**: ${skill.description}${tags}${usageNote}`);
    }

    lines.push('');
    lines.push('When a task matches a skill, use the SkillTool to view its full content before proceeding.');
    lines.push('After completing a complex multi-step task, consider saving your approach as a new skill using SkillManageTool.');

    return lines.join('\n');
  }

  // ── Private ───────────────────────────────────────────────────

  private async scanDir(dir: string, scope: 'global' | 'project'): Promise<SkillEntry[]> {
    const skills: SkillEntry[] = [];

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skill = await this.loadSkill(join(dir, entry.name), scope);
        if (skill) skills.push(skill);
      }
    } catch { /* dir doesn't exist */ }

    return skills;
  }

  private async loadSkill(skillDir: string, scope: 'global' | 'project'): Promise<SkillEntry | null> {
    const skillPath = join(skillDir, SKILL_FILE);
    const metaPath = join(skillDir, METADATA_FILE);
    const name = basename(skillDir);

    try {
      const content = await readFile(skillPath, 'utf-8');
      let metadata: SkillMetadata;

      try {
        const metaContent = await readFile(metaPath, 'utf-8');
        metadata = JSON.parse(metaContent) as SkillMetadata;
      } catch {
        // No metadata file — create default
        metadata = {
          name,
          description: extractDescription(content) ?? name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          tags: [],
          usageCount: 0,
          source: 'manual',
        };
      }

      return {
        name,
        path: skillPath,
        description: metadata.description,
        content,
        metadata,
        scope,
      };
    } catch {
      return null;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractDescription(content: string): string | null {
  const firstLine = content.split('\n').find(l => l.trim().length > 0);
  if (!firstLine) return null;
  return firstLine.replace(/^#+\s*/, '').trim().slice(0, 200);
}
