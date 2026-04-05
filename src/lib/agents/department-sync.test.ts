import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { syncRulesToIDE, syncRulesToAllIDEs } from './department-sync';

describe('department-sync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join('/tmp', `test-dept-sync-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('syncRulesToIDE', () => {
    it('returns empty when no .department/rules/ exists', () => {
      const { synced } = syncRulesToIDE(tmpDir, 'codex');
      expect(synced).toEqual([]);
    });

    it('returns empty when rules dir has no .md files', () => {
      const rulesDir = path.join(tmpDir, '.department', 'rules');
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, 'config.json'), '{}');

      const { synced } = syncRulesToIDE(tmpDir, 'codex');
      expect(synced).toEqual([]);
    });

    it('concatenates rules into single AGENTS.md for codex target', () => {
      const rulesDir = path.join(tmpDir, '.department', 'rules');
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, 'coding-standards.md'), '# Coding Standards\nUse TypeScript.');
      fs.writeFileSync(path.join(rulesDir, 'testing-policy.md'), '# Testing Policy\nWrite tests.');

      const { synced } = syncRulesToIDE(tmpDir, 'codex');
      expect(synced).toHaveLength(1);
      expect(synced[0]).toBe(path.join(tmpDir, 'AGENTS.md'));

      const content = fs.readFileSync(synced[0], 'utf-8');
      expect(content).toContain('Coding Standards');
      expect(content).toContain('Testing Policy');
    });

    it('concatenates rules into CLAUDE.md for claude-code target', () => {
      const rulesDir = path.join(tmpDir, '.department', 'rules');
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, 'rules.md'), '# Department Rules');

      const { synced } = syncRulesToIDE(tmpDir, 'claude-code');
      expect(synced).toHaveLength(1);
      expect(synced[0]).toBe(path.join(tmpDir, 'CLAUDE.md'));
    });

    it('concatenates rules into .cursorrules for cursor target', () => {
      const rulesDir = path.join(tmpDir, '.department', 'rules');
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, 'rules.md'), '# Rules');

      const { synced } = syncRulesToIDE(tmpDir, 'cursor');
      expect(synced).toHaveLength(1);
      expect(synced[0]).toBe(path.join(tmpDir, '.cursorrules'));
    });

    it('creates symlinks for antigravity target (multi-file)', () => {
      const rulesDir = path.join(tmpDir, '.department', 'rules');
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, 'rule1.md'), '# Rule 1');
      fs.writeFileSync(path.join(rulesDir, 'rule2.md'), '# Rule 2');

      const { synced } = syncRulesToIDE(tmpDir, 'antigravity');
      expect(synced).toHaveLength(2);

      // Verify symlinks were created
      for (const file of synced) {
        expect(fs.existsSync(file)).toBe(true);
        expect(fs.lstatSync(file).isSymbolicLink()).toBe(true);
      }
    });

    it('includes memory reference section for single-file targets', () => {
      const rulesDir = path.join(tmpDir, '.department', 'rules');
      const memoryDir = path.join(tmpDir, '.department', 'memory');
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, 'rules.md'), '# Rules');
      fs.writeFileSync(path.join(memoryDir, 'knowledge.md'), '# Knowledge');

      syncRulesToIDE(tmpDir, 'codex');
      const content = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('Department Memory');
      expect(content).toContain('.department/memory/knowledge.md');
    });

    it('includes workflows for single-file targets', () => {
      const rulesDir = path.join(tmpDir, '.department', 'rules');
      const wfDir = path.join(tmpDir, '.department', 'workflows');
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.mkdirSync(wfDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, 'rules.md'), '# Rules');
      fs.writeFileSync(path.join(wfDir, 'ci-check.md'), '# CI Check Workflow');

      syncRulesToIDE(tmpDir, 'codex');
      const content = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf-8');
      expect(content).toContain('Workflow: ci-check');
      expect(content).toContain('CI Check Workflow');
    });
  });

  describe('syncRulesToAllIDEs', () => {
    it('returns results for all targets', () => {
      const rulesDir = path.join(tmpDir, '.department', 'rules');
      fs.mkdirSync(rulesDir, { recursive: true });
      fs.writeFileSync(path.join(rulesDir, 'rules.md'), '# Rules');

      const { results } = syncRulesToAllIDEs(tmpDir);
      expect(results).toHaveProperty('antigravity');
      expect(results).toHaveProperty('codex');
      expect(results).toHaveProperty('claude-code');
      expect(results).toHaveProperty('cursor');

      // Each should have synced at least one file
      expect(results.codex.length).toBeGreaterThanOrEqual(1);
      expect(results['claude-code'].length).toBeGreaterThanOrEqual(1);
      expect(results.cursor.length).toBeGreaterThanOrEqual(1);
    });
  });
});
