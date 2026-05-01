import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    observer: await import('./platform-engineering-observer'),
    platform: await import('../platform-engineering'),
    projectRegistry: await import('../agents/project-registry'),
    signalStore: await import('./self-improvement-store'),
  };
}

describe('platform engineering observer', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-engineering-observer-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
    vi.resetModules();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('creates a signal and proposal for observed platform engineering project failures', async () => {
    const modules = await loadModules();
    const workspacePath = modules.platform.getPlatformEngineeringWorkspacePath();
    fs.mkdirSync(workspacePath, { recursive: true });

    const project = modules.projectRegistry.createProject({
      name: 'Guarded core fix',
      goal: 'Repair the core software safely',
      workspace: modules.platform.getPlatformEngineeringWorkspaceUri(),
    });

    const result = modules.observer.observeRunFailureForPlatformEngineering({
      runId: 'run-platform-failure-1',
      projectId: project.projectId,
      stageId: 'delivery',
      workspace: modules.platform.getPlatformEngineeringWorkspaceUri(),
      prompt: 'Fix the issue',
      status: 'failed',
      createdAt: '2026-04-30T10:00:00.000Z',
      finishedAt: '2026-04-30T10:02:00.000Z',
      lastError: 'Scheduler crashed while processing a protected-core task.',
      resolvedWorkflowRef: '/guarded_core_dev',
      result: {
        status: 'failed',
        summary: 'Scheduler crashed while processing a protected-core task.',
        changedFiles: ['src/lib/agents/scheduler.ts'],
        blockers: ['scheduler failure'],
        needsReview: [],
      },
    });

    expect(result.signal?.source).toBe('runtime-error');
    expect(result.proposal?.linkedRunIds).toEqual(['run-platform-failure-1']);
    expect(result.proposal?.affectedFiles).toContain('src/lib/agents/scheduler.ts');
    expect(modules.signalStore.getSystemImprovementSignal(result.signal!.id)?.metadata?.projectId).toBe(project.projectId);
  });

  it('creates user story gap signals from unsupported stories', async () => {
    const modules = await loadModules();
    const userStoryRoot = path.join(tempHome, 'User Story', 'Projects');
    fs.mkdirSync(userStoryRoot, { recursive: true });
    fs.writeFileSync(
      path.join(userStoryRoot, '项目工作台.md'),
      [
        '# Projects',
        '',
        '- [支持] 示例支持故事',
        '- [不支持] 我希望自动生成系统改进 proposal',
        '- [不支持] 我希望批准后自动创建平台工程项目',
        '',
      ].join('\n'),
      'utf-8',
    );

    const signals = modules.observer.syncPlatformEngineeringUserStoryGapSignals({
      userStoryRoot: path.join(tempHome, 'User Story'),
      force: true,
    });

    expect(signals).toHaveLength(1);
    expect(signals[0].source).toBe('user-story-gap');
    expect(signals[0].recurrence).toBe(2);
    expect(String(signals[0].metadata?.sourcePath)).toContain('User Story/Projects/项目工作台.md');
  });
});
