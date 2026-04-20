import fs from 'fs';
import path from 'path';

import type { Rule, Skill, Workflow } from '../types';
import { GLOBAL_ASSETS_DIR } from './gateway-home';

type FrontmatterData = Record<string, string | string[] | boolean | number>;
export type CanonicalWorkflowRuntimeConfig = {
  runtimeProfile?: string;
  runtimeSkill?: string;
};

export type CanonicalAssetSource = 'canonical';

export interface CanonicalWorkflow extends Workflow {
  source: CanonicalAssetSource;
}

export interface CanonicalSkill extends Skill {
  source: CanonicalAssetSource;
  content: string;
}

export interface CanonicalRule extends Rule {
  source: CanonicalAssetSource;
}

const WORKFLOWS_DIR = path.join(GLOBAL_ASSETS_DIR, 'workflows');
const SKILLS_DIR = path.join(GLOBAL_ASSETS_DIR, 'skills');
const RULES_DIR = path.join(GLOBAL_ASSETS_DIR, 'rules');

function normalizeWorkflowName(name: string): string {
  return name.startsWith('/') ? name.slice(1) : name;
}

function parseFrontmatter(content: string): { data: FrontmatterData; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { data: {}, body: content };
  }

  const raw = match[1];
  const body = content.slice(match[0].length);
  const data: FrontmatterData = {};

  let activeListKey: string | null = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      activeListKey = null;
      continue;
    }

    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && activeListKey) {
      const list = Array.isArray(data[activeListKey]) ? [...(data[activeListKey] as string[])] : [];
      list.push(listMatch[1].trim());
      data[activeListKey] = list;
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kvMatch) {
      activeListKey = null;
      continue;
    }

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();
    activeListKey = rawValue === '' ? key : null;

    if (rawValue === '') {
      data[key] = [];
      continue;
    }

    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
      data[key] = rawValue.slice(1, -1);
      continue;
    }

    if (rawValue === 'true' || rawValue === 'false') {
      data[key] = rawValue === 'true';
      continue;
    }

    const num = Number(rawValue);
    if (!Number.isNaN(num) && rawValue !== '') {
      data[key] = num;
      continue;
    }

    data[key] = rawValue;
  }

  return { data, body };
}

function extractRuntimeConfig(content: string): CanonicalWorkflowRuntimeConfig {
  const { data } = parseFrontmatter(content);
  return {
    runtimeProfile: typeof data.runtimeProfile === 'string' ? data.runtimeProfile.trim() : undefined,
    runtimeSkill: typeof data.runtimeSkill === 'string' ? data.runtimeSkill.trim() : undefined,
  };
}

function extractDescription(content: string): string {
  const { data, body } = parseFrontmatter(content);
  const frontmatterDescription = data.description;
  if (typeof frontmatterDescription === 'string' && frontmatterDescription.trim()) {
    return frontmatterDescription.trim();
  }

  const firstMeaningfulLine = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));

  return firstMeaningfulLine || '';
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function listCanonicalWorkflows(): CanonicalWorkflow[] {
  if (!fs.existsSync(WORKFLOWS_DIR)) {
    return [];
  }

  return fs.readdirSync(WORKFLOWS_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const filePath = path.join(WORKFLOWS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const name = file.replace(/\.md$/i, '');
      return {
        name,
        description: extractDescription(content),
        path: filePath,
        content,
        scope: 'global',
        baseDir: GLOBAL_ASSETS_DIR,
        source: 'canonical' as const,
      };
    });
}

export function getCanonicalWorkflow(name: string): CanonicalWorkflow | null {
  const normalizedName = normalizeWorkflowName(name);
  const filePath = path.join(WORKFLOWS_DIR, `${normalizedName}.md`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return {
    name: normalizedName,
    description: extractDescription(content),
    path: filePath,
    content,
    scope: 'global',
    baseDir: GLOBAL_ASSETS_DIR,
    source: 'canonical',
  };
}

export function getCanonicalWorkflowRuntimeConfig(name: string): CanonicalWorkflowRuntimeConfig | null {
  const workflow = getCanonicalWorkflow(name);
  if (!workflow) {
    return null;
  }
  return extractRuntimeConfig(workflow.content || '');
}

export function saveCanonicalWorkflow(name: string, content: string): void {
  ensureDir(WORKFLOWS_DIR);
  fs.writeFileSync(path.join(WORKFLOWS_DIR, `${normalizeWorkflowName(name)}.md`), content, 'utf-8');
}

export function deleteCanonicalWorkflow(name: string): boolean {
  const filePath = path.join(WORKFLOWS_DIR, `${normalizeWorkflowName(name)}.md`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function listCanonicalSkills(): CanonicalSkill[] {
  if (!fs.existsSync(SKILLS_DIR)) {
    return [];
  }

  return fs.readdirSync(SKILLS_DIR)
    .filter((entry) => fs.existsSync(path.join(SKILLS_DIR, entry, 'SKILL.md')))
    .sort((a, b) => a.localeCompare(b))
    .map((entry) => {
      const filePath = path.join(SKILLS_DIR, entry, 'SKILL.md');
      const content = fs.readFileSync(filePath, 'utf-8');
      return {
        name: entry,
        description: extractDescription(content),
        path: filePath,
        baseDir: path.join(SKILLS_DIR, entry),
        scope: 'global',
        source: 'canonical' as const,
        content,
      };
    });
}

export function getCanonicalSkill(name: string): CanonicalSkill | null {
  const filePath = path.join(SKILLS_DIR, name, 'SKILL.md');
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return {
    name,
    description: extractDescription(content),
    path: filePath,
    baseDir: path.join(SKILLS_DIR, name),
    scope: 'global',
    source: 'canonical',
    content,
  };
}

export function saveCanonicalSkill(name: string, content: string): void {
  const skillDir = path.join(SKILLS_DIR, name);
  ensureDir(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf-8');
}

export function deleteCanonicalSkill(name: string): boolean {
  const skillDir = path.join(SKILLS_DIR, name);
  if (!fs.existsSync(skillDir)) return false;
  fs.rmSync(skillDir, { recursive: true, force: true });
  return true;
}

export function listCanonicalRules(): CanonicalRule[] {
  if (!fs.existsSync(RULES_DIR)) {
    return [];
  }

  return fs.readdirSync(RULES_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const filePath = path.join(RULES_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const name = file.replace(/\.md$/i, '');
      return {
        name,
        description: extractDescription(content),
        path: filePath,
        content,
        scope: 'global',
        baseDir: GLOBAL_ASSETS_DIR,
        source: 'canonical' as const,
      };
    });
}

export function getCanonicalRule(name: string): CanonicalRule | null {
  const filePath = path.join(RULES_DIR, `${name}.md`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return {
    name,
    description: extractDescription(content),
    path: filePath,
    content,
    scope: 'global',
    baseDir: GLOBAL_ASSETS_DIR,
    source: 'canonical',
  };
}

export function saveCanonicalRule(name: string, content: string): void {
  ensureDir(RULES_DIR);
  fs.writeFileSync(path.join(RULES_DIR, `${name}.md`), content, 'utf-8');
}

export function deleteCanonicalRule(name: string): boolean {
  const filePath = path.join(RULES_DIR, `${name}.md`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
