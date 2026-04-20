import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import type { BackendRunConfig } from '../../backends/types';
import type { ProviderId } from '../../providers';

let tmpDir: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadBridgeModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  const bridge = await import('../department-memory-bridge');
  const memoryHooks = await import('../../backends/memory-hooks');
  const knowledge = await import('../../knowledge');
  return {
    ...bridge,
    ...memoryHooks,
    knowledge,
  };
}

function makeConfig(workspace: string): BackendRunConfig {
  return {
    runId: 'test-run-001',
    workspacePath: workspace,
    prompt: 'test prompt',
  };
}

describe('Department Memory Bridge', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dept-mem-bridge-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.HOME = tmpDir;
    process.env.AG_GATEWAY_HOME = path.join(tmpDir, 'gateway-home');
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // initDepartmentMemoryV2
  // =========================================================================
  describe('initDepartmentMemoryV2', () => {
    it('should create shared/ + provider directories', async () => {
      const { initDepartmentMemoryV2, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);

      expect(fs.existsSync(path.join(tmpDir, '.department', 'memory', 'shared'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.department', 'memory', 'claude-engine'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.department', 'memory', 'codex'))).toBe(true);
    });

    it('should create default shared files', async () => {
      const { initDepartmentMemoryV2, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);

      const sharedDir = path.join(tmpDir, '.department', 'memory', 'shared');
      expect(fs.existsSync(path.join(sharedDir, 'decisions.md'))).toBe(true);
      expect(fs.existsSync(path.join(sharedDir, 'patterns.md'))).toBe(true);
    });

    it('should not overwrite existing files', async () => {
      const { initDepartmentMemoryV2, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);

      const decisionsPath = path.join(tmpDir, '.department', 'memory', 'shared', 'decisions.md');
      fs.writeFileSync(decisionsPath, 'Custom content');
      initDepartmentMemoryV2(tmpDir); // re-init

      expect(fs.readFileSync(decisionsPath, 'utf-8')).toBe('Custom content');
    });
  });

  // =========================================================================
  // readSharedDepartmentMemory
  // =========================================================================
  describe('readSharedDepartmentMemory', () => {
    it('should read shared/ directory when it exists', async () => {
      const { initDepartmentMemoryV2, readSharedDepartmentMemory, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, '.department', 'memory', 'shared', 'decisions.md'),
        'Use monorepo',
      );

      const result = readSharedDepartmentMemory(tmpDir);
      expect(result).toContain('Use monorepo');
    });

    it('should fall back to legacy flat structure', async () => {
      const { readSharedDepartmentMemory, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      // Legacy: .department/memory/knowledge.md (no shared/ dir)
      const memDir = path.join(tmpDir, '.department', 'memory');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, 'knowledge.md'), 'TypeScript strict');
      fs.writeFileSync(path.join(memDir, 'decisions.md'), 'Use Vitest');

      const result = readSharedDepartmentMemory(tmpDir);
      expect(result).toContain('TypeScript strict');
      expect(result).toContain('Use Vitest');
    });

    it('should return empty string when no memory exists', async () => {
      const { readSharedDepartmentMemory, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      expect(readSharedDepartmentMemory(tmpDir)).toBe('');
    });

    it('includes recent structured knowledge assets in shared memory', async () => {
      const { initDepartmentMemoryV2, readSharedDepartmentMemory, clearMemoryHooks, knowledge } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);
      knowledge.upsertKnowledgeAsset({
        id: 'knowledge-bridge',
        scope: 'department',
        workspaceUri: `file://${tmpDir}`,
        category: 'decision',
        title: 'Bridge structured knowledge',
        content: 'Structured knowledge should also appear in the shared memory context.',
        source: { type: 'run', runId: 'run-bridge' },
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
        status: 'active',
      });

      const result = readSharedDepartmentMemory(tmpDir);
      expect(result).toContain('Structured Knowledge Assets');
      expect(result).toContain('Bridge structured knowledge');
    });
  });

  // =========================================================================
  // readProviderDepartmentMemory
  // =========================================================================
  describe('readProviderDepartmentMemory', () => {
    it('should read provider-specific directory', async () => {
      const { initDepartmentMemoryV2, readProviderDepartmentMemory, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, '.department', 'memory', 'claude-engine', 'api-style.md'),
        'Use RESTful conventions',
      );

      const result = readProviderDepartmentMemory(tmpDir, 'claude-code' as ProviderId);
      expect(result).toContain('Use RESTful conventions');
    });

    it('should return empty for non-existent provider dir', async () => {
      const { initDepartmentMemoryV2, readProviderDepartmentMemory, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);
      const result = readProviderDepartmentMemory(tmpDir, 'codex' as ProviderId);
      // codex dir exists but is empty
      expect(result).toBe('');
    });
  });

  // =========================================================================
  // buildDepartmentMemoryForProvider
  // =========================================================================
  describe('buildDepartmentMemoryForProvider', () => {
    it('should combine shared + provider-specific + org memory', async () => {
      const { initDepartmentMemoryV2, buildDepartmentMemoryForProvider, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, '.department', 'memory', 'shared', 'decisions.md'),
        'Shared decision',
      );
      fs.writeFileSync(
        path.join(tmpDir, '.department', 'memory', 'claude-engine', 'coding.md'),
        'Claude-specific rule',
      );

      const result = buildDepartmentMemoryForProvider(tmpDir, 'claude-code' as ProviderId);
      expect(result.shared).toContain('Shared decision');
      expect(result.providerSpecific).toContain('Claude-specific rule');
      // organization memory might be empty (no org dir)
      expect(typeof result.organization).toBe('string');
    });
  });

  // =========================================================================
  // MemoryHook integration
  // =========================================================================
  describe('departmentMemoryHook', () => {
    it('should have correct id', async () => {
      const { departmentMemoryHook, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      expect(departmentMemoryHook.id).toBe('department-memory-bridge');
    });

    it('should return undefined when no .department/memory/ exists', async () => {
      const { departmentMemoryHook, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      const config = makeConfig(tmpDir);
      const result = await departmentMemoryHook.beforeRun!({
        providerId: 'codex' as ProviderId,
        config,
      });
      expect(result).toBeUndefined();
    });

    it('should return memory entries when department memory exists', async () => {
      const { initDepartmentMemoryV2, departmentMemoryHook, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, '.department', 'memory', 'shared', 'decisions.md'),
        'Important decision content',
      );

      const config = makeConfig(tmpDir);
      const result = await departmentMemoryHook.beforeRun!({
        providerId: 'codex' as ProviderId,
        config,
      });

      expect(result).toBeDefined();
      expect(result!.projectMemories).toBeDefined();
      expect(result!.projectMemories!.length).toBeGreaterThan(0);
      expect(result!.projectMemories![0].content).toContain('Important decision');
    });

    it('should return provider-specific memories for claude-engine', async () => {
      const { initDepartmentMemoryV2, departmentMemoryHook, clearMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, '.department', 'memory', 'claude-engine', 'rules.md'),
        'Claude-specific rule',
      );

      const config = makeConfig(tmpDir);
      const result = await departmentMemoryHook.beforeRun!({
        providerId: 'claude-code' as ProviderId,
        config,
      });

      expect(result).toBeDefined();
      const providerEntry = result!.projectMemories!.find(
        e => e.name === 'department-claude-engine',
      );
      expect(providerEntry).toBeDefined();
      expect(providerEntry!.content).toContain('Claude-specific rule');
    });
  });

  // =========================================================================
  // Full pipeline integration via applyBeforeRunMemoryHooks
  // =========================================================================
  describe('applyBeforeRunMemoryHooks integration', () => {
    it('should inject memory into BackendRunConfig.memoryContext', async () => {
      const {
        initDepartmentMemoryV2,
        departmentMemoryHook,
        clearMemoryHooks,
        registerMemoryHook,
        applyBeforeRunMemoryHooks,
      } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, '.department', 'memory', 'shared', 'patterns.md'),
        'Always write tests first',
      );

      // Register the hook
      registerMemoryHook(departmentMemoryHook);

      const config = makeConfig(tmpDir);
      const enriched = await applyBeforeRunMemoryHooks('codex' as ProviderId, config);

      expect(enriched.memoryContext).toBeDefined();
      expect(enriched.memoryContext!.projectMemories.length).toBeGreaterThan(0);
      expect(enriched.memoryContext!.projectMemories[0].content).toContain('Always write tests');
    });

    it('should not fail when no memory directory exists', async () => {
      const { departmentMemoryHook, clearMemoryHooks, registerMemoryHook, applyBeforeRunMemoryHooks } = await loadBridgeModules();
      clearMemoryHooks();
      registerMemoryHook(departmentMemoryHook);

      const config = makeConfig(tmpDir);
      const enriched = await applyBeforeRunMemoryHooks('codex' as ProviderId, config);

      // Should pass through config unchanged (no memory injected)
      expect(enriched.memoryContext).toBeUndefined();
    });

    it('should preserve existing memoryContext entries', async () => {
      const {
        initDepartmentMemoryV2,
        departmentMemoryHook,
        clearMemoryHooks,
        registerMemoryHook,
        applyBeforeRunMemoryHooks,
      } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);
      fs.writeFileSync(
        path.join(tmpDir, '.department', 'memory', 'shared', 'decisions.md'),
        'New from hook',
      );

      registerMemoryHook(departmentMemoryHook);

      const config = makeConfig(tmpDir);
      config.memoryContext = {
        projectMemories: [{
          type: 'project',
          name: 'existing',
          content: 'Pre-existing memory',
          updatedAt: new Date().toISOString(),
        }],
        departmentMemories: [],
        userPreferences: [],
      };

      const enriched = await applyBeforeRunMemoryHooks('codex' as ProviderId, config);

      // Should have both existing and new
      expect(enriched.memoryContext!.projectMemories.length).toBeGreaterThanOrEqual(2);
      const names = enriched.memoryContext!.projectMemories.map(e => e.name);
      expect(names).toContain('existing');
      expect(names).toContain('department-shared');
    });

    it('injects structured knowledge assets into project memories', async () => {
      const {
        initDepartmentMemoryV2,
        departmentMemoryHook,
        clearMemoryHooks,
        registerMemoryHook,
        applyBeforeRunMemoryHooks,
        knowledge,
      } = await loadBridgeModules();
      clearMemoryHooks();
      initDepartmentMemoryV2(tmpDir);
      knowledge.upsertKnowledgeAsset({
        id: 'knowledge-project-memory',
        scope: 'department',
        workspaceUri: `file://${tmpDir}`,
        category: 'decision',
        title: 'Use shared bridge retrieval',
        content: 'Structured knowledge should be present in memoryContext.projectMemories.',
        source: { type: 'run', runId: 'run-structured' },
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
        status: 'active',
      });

      registerMemoryHook(departmentMemoryHook);
      const enriched = await applyBeforeRunMemoryHooks('codex' as ProviderId, makeConfig(tmpDir));

      const combined = enriched.memoryContext?.projectMemories.map((entry) => entry.content).join('\n');
      expect(combined).toContain('Use shared bridge retrieval');
    });
  });
});
