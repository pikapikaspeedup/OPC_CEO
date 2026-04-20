/**
 * Unified Gateway data root path.
 * 
 * All registries (projects, runs, conversations) and global assets
 * are stored under this directory. Supports AG_GATEWAY_HOME env override.
 * 
 * On first run, assets (templates, workflows, review-policies) are synced
 * from the repo's .agents/ directory to the global assets directory.
 */

import { homedir } from 'os';
import path from 'path';
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, cpSync } from 'fs';

const DEFAULT_HOME = path.join(homedir(), '.gemini', 'antigravity', 'gateway');

export const GATEWAY_HOME = process.env.AG_GATEWAY_HOME || DEFAULT_HOME;

if (!existsSync(GATEWAY_HOME)) {
  mkdirSync(GATEWAY_HOME, { recursive: true });
}

// Legacy registry files.
// Runtime persistence now lives in storage.sqlite; these are kept only so the
// one-shot migration/backfill path can import and archive old installs.
export const PROJECTS_FILE = path.join(GATEWAY_HOME, 'projects.json');
export const RUNS_FILE = path.join(GATEWAY_HOME, 'agent_runs.json');
export const CONVS_FILE = path.join(GATEWAY_HOME, 'local_conversations.json');
export const HIDDEN_WS_FILE = path.join(GATEWAY_HOME, 'hidden_workspaces.json');
export const SCHEDULED_JOBS_FILE = path.join(GATEWAY_HOME, 'scheduled_jobs.json');

// Global assets directory
export const GLOBAL_ASSETS_DIR = path.join(GATEWAY_HOME, 'assets');

// Per-workspace artifact directory name (relative to workspace root)
export const ARTIFACT_ROOT_DIR = 'demolong';

function syncFlatRepoDir(src: string, dest: string, ext: string): void {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const file of readdirSync(src)) {
    if (!file.endsWith(ext)) continue;
    copyFileSync(path.join(src, file), path.join(dest, file));
  }
}

function syncDirIfMissing(src: string, dest: string): void {
  if (!existsSync(src)) return;
  mkdirSync(path.dirname(dest), { recursive: true });
  if (!existsSync(dest)) {
    cpSync(src, dest, { recursive: true });
  }
}

/**
 * Sync repo assets to global directory on startup.
 * Repo-owned assets are refreshed on every startup; legacy home assets only
 * fill gaps when canonical targets are missing.
 */
function syncAssetsToGlobal(): void {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  syncFlatRepoDir(path.join(repoRoot, '.agents', 'assets', 'templates'), path.join(GLOBAL_ASSETS_DIR, 'templates'), '.json');
  syncFlatRepoDir(path.join(repoRoot, '.agents', 'assets', 'review-policies'), path.join(GLOBAL_ASSETS_DIR, 'review-policies'), '.json');
  syncFlatRepoDir(path.join(repoRoot, '.agents', 'workflows'), path.join(GLOBAL_ASSETS_DIR, 'workflows'), '.md');

  const legacyWorkflowDir = path.join(homedir(), '.gemini', 'antigravity', 'global_workflows');
  if (existsSync(legacyWorkflowDir)) {
    const canonicalWorkflowDir = path.join(GLOBAL_ASSETS_DIR, 'workflows');
    mkdirSync(canonicalWorkflowDir, { recursive: true });
    for (const file of readdirSync(legacyWorkflowDir)) {
      if (!file.endsWith('.md')) continue;
      const target = path.join(canonicalWorkflowDir, file);
      if (!existsSync(target)) {
        copyFileSync(path.join(legacyWorkflowDir, file), target);
      }
    }
  }

  const legacySkillsDir = path.join(homedir(), '.gemini', 'antigravity', 'skills');
  const repoSkillsDir = path.join(repoRoot, '.agents', 'skills');
  const canonicalSkillsDir = path.join(GLOBAL_ASSETS_DIR, 'skills');
  if (existsSync(repoSkillsDir)) {
    mkdirSync(canonicalSkillsDir, { recursive: true });
    for (const entry of readdirSync(repoSkillsDir)) {
      const src = path.join(repoSkillsDir, entry);
      const dst = path.join(canonicalSkillsDir, entry);
      try {
        if (!statSync(src).isDirectory()) continue;
      } catch {
        continue;
      }
      if (!existsSync(path.join(src, 'SKILL.md'))) continue;
      cpSync(src, dst, { recursive: true, force: true });
    }
  }
  if (existsSync(legacySkillsDir)) {
    mkdirSync(canonicalSkillsDir, { recursive: true });
    for (const entry of readdirSync(legacySkillsDir)) {
      const src = path.join(legacySkillsDir, entry);
      const dst = path.join(canonicalSkillsDir, entry);
      try {
        if (!statSync(src).isDirectory()) continue;
      } catch {
        continue;
      }
      if (!existsSync(path.join(src, 'SKILL.md'))) continue;
      syncDirIfMissing(src, dst);
    }
  }
}

syncAssetsToGlobal();
