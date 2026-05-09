import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempHome: string;
let tempWorkspace: string;
let previousHome: string | undefined;
let previousGatewayHome: string | undefined;

async function loadModules() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
  return {
    ingest: await import('./story-top-candidate-signals'),
    signal: await import('./self-improvement-signal'),
    store: await import('./self-improvement-store'),
  };
}

describe('story-top candidate signals', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'story-top-candidates-home-'));
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'story-top-candidates-workspace-'));
    previousHome = process.env.HOME;
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.HOME = tempHome;
    process.env.AG_GATEWAY_HOME = path.join(tempHome, 'gateway-home');
    fs.mkdirSync(path.join(tempWorkspace, 'User Story', 'Settings'), { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, 'User Story', 'Settings', '个人偏好.md'), '# test\n', 'utf-8');
    fs.writeFileSync(path.join(tempWorkspace, 'User Story', 'Settings', 'Provider.md'), '# test\n', 'utf-8');
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__AG_GATEWAY_DB__;
    vi.resetModules();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousGatewayHome === undefined) delete process.env.AG_GATEWAY_HOME;
    else process.env.AG_GATEWAY_HOME = previousGatewayHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  });

  it('ingests story-top candidates and deactivates previous batch items', async () => {
    const modules = await loadModules();
    const artifactDir = path.join(tempWorkspace, 'demolong', 'runs', 'run-1');
    fs.mkdirSync(artifactDir, { recursive: true });

    modules.signal.createSystemImprovementSignal({
      id: 'system-improvement-signal:story-top:old',
      source: 'user-story-gap',
      title: '旧候选',
      summary: '旧候选摘要',
      evidenceRefs: [],
      affectedAreas: ['frontend'],
      severity: 'medium',
      metadata: {
        candidateKind: 'story-top',
        candidateActive: true,
        storyKey: 'old',
      },
    });

    fs.writeFileSync(path.join(artifactDir, 'story-top-candidates.json'), JSON.stringify([
      {
        sourcePath: 'User Story/Settings/个人偏好.md',
        storyText: '作为用户，我希望个人偏好页在 Provider 故障时仍可打开。',
        title: '系统改进：个人偏好页在 Provider 故障时可访问',
        summary: '当前个人偏好页被 Provider 依赖阻断。',
        expectedOutcome: '用户仍可查看并编辑个人偏好。',
        severity: 'high',
        rationale: '这是高频主路径缺口。',
        affectedAreas: ['provider', 'runtime', 'frontend'],
      },
      {
        sourcePath: 'User Story/Settings/Provider.md',
        storyText: '作为管理员，我希望 Provider 配置支持失效隔离。',
        title: '系统改进：Provider 配置支持失效隔离',
        summary: '当前 Provider 配置失败会影响整个设置页。',
        expectedOutcome: 'Provider 配置问题不再阻断其他设置。',
        severity: 'high',
        rationale: 'Settings 主链会被整体拖垮。',
      },
    ], null, 2), 'utf-8');

    const result = modules.ingest.ingestStoryTopCandidatesFromArtifact({
      workspacePath: tempWorkspace,
      workspaceUri: `file://${tempWorkspace}`,
      artifactAbsDir: artifactDir,
    });

    expect(result.count).toBe(2);
    const signals = modules.store.listSystemImprovementSignals({ source: 'user-story-gap' });
    const active = signals.filter((signal) => modules.ingest.isActiveStoryTopCandidateSignal(signal));
    expect(active).toHaveLength(2);
    expect(active.every((signal) => signal.metadata?.candidateActive === true)).toBe(true);
    expect(active.map((signal) => signal.title)).toContain('系统改进：个人偏好页在 Provider 故障时可访问');
    const old = modules.store.getSystemImprovementSignal('system-improvement-signal:story-top:old');
    expect(old?.metadata?.candidateActive).toBe(false);
  });
});
