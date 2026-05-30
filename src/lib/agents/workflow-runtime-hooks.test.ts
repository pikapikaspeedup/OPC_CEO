import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_TOP_CANDIDATE_ARTIFACT } from '../story-top-candidates';

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('workflow runtime hooks', () => {
  let tempGatewayHome: string;
  let tempWorkspace: string;
  let artifactDir: string;
  let previousGatewayHome: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    tempGatewayHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-runtime-home-'));
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-runtime-workspace-'));
    artifactDir = path.join(tempWorkspace, 'runs', 'run-1');
    fs.mkdirSync(artifactDir, { recursive: true });
    previousGatewayHome = process.env.AG_GATEWAY_HOME;
    process.env.AG_GATEWAY_HOME = tempGatewayHome;

    const workflowsDir = path.join(tempGatewayHome, 'assets', 'workflows');
    const workflowScriptsDir = path.join(tempGatewayHome, 'assets', 'workflow-scripts', 'ai_digest');
    fs.mkdirSync(workflowsDir, { recursive: true });
    fs.mkdirSync(workflowScriptsDir, { recursive: true });

    fs.writeFileSync(
      path.join(workflowsDir, 'ai_digest.md'),
      [
        '---',
        'runtimeProfile: daily-digest',
        'runtimeScriptsDir: ai_digest',
        '---',
        '# AI Digest',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(workflowsDir, 'platform_engineering_story_candidates.md'),
      [
        '---',
        'runtimeProfile: story-top-candidates',
        '---',
        '# Story Top Candidates',
      ].join('\n'),
      'utf-8',
    );

    fs.writeFileSync(
      path.join(workflowScriptsDir, 'report_digest.py'),
      [
        '#!/usr/bin/env python3',
        'import json',
        'import sys',
        '',
        'args = sys.argv[1:]',
        'input_path = args[args.index("--input") + 1]',
        'context_path = args[args.index("--context") + 1]',
        'payload_out = args[args.index("--payload-out") + 1] if "--payload-out" in args else None',
        '',
        'with open(input_path, "r", encoding="utf-8") as fh:',
        '    digest = json.load(fh)',
        'with open(context_path, "r", encoding="utf-8") as fh:',
        '    context = json.load(fh)',
        '',
        'payload = {',
        '    "digestDate": context.get("targetDate", "2026-04-22"),',
        '    "title": digest.get("title", ""),',
        '    "articleCount": len(digest.get("sourceArticleIds", [])),',
        '}',
        'if payload_out:',
        '    with open(payload_out, "w", encoding="utf-8") as fh:',
        '        json.dump(payload, fh, ensure_ascii=False)',
        '',
        'print(json.dumps({',
        '    "status": "ok",',
        '    "reportUrl": "https://api.aitrend.us/admin/digest/report",',
        '    "verifyApiUrl": "https://api.aitrend.us/digest?date=" + payload["digestDate"],',
        '    "verifyPageUrl": "https://www.aitrend.us/digest/" + payload["digestDate"],',
        '    "verifyPageStatus": 200,',
        '    "verifyApiResponse": {',
        '        "data": {',
        '            "exists": True,',
        '            "run": {',
        '                "id": 77,',
        '                "digestDate": payload["digestDate"],',
        '                "title": payload["title"],',
        '            }',
        '        }',
        '    }',
        '}, ensure_ascii=False))',
      ].join('\n'),
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(tempGatewayHome, { recursive: true, force: true });
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
    fs.rmSync(artifactDir, { recursive: true, force: true });
    if (previousGatewayHome === undefined) {
      delete process.env.AG_GATEWAY_HOME;
    } else {
      process.env.AG_GATEWAY_HOME = previousGatewayHome;
    }
  });

  it('finalizes digest workflow runs by reporting generated output and persisting verification artifacts', async () => {
    const hooks = await import('./workflow-runtime-hooks');

    fs.writeFileSync(
      path.join(artifactDir, 'prepared-ai-digest-context.json'),
      JSON.stringify({
        status: 'ok',
        targetDate: '2026-04-22',
        articleCount: 2,
        sourceArticleIds: [101, 202],
      }),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(artifactDir, 'digest_output.json'),
      JSON.stringify({
        title: 'OpenAI 发布新模型',
        summary: 'summary',
        contentHtml: '<div>digest</div>',
        sourceArticleIds: [101, 202],
      }),
      'utf-8',
    );

    const finalized = await hooks.finalizeWorkflowRun('/ai_digest', tempWorkspace, artifactDir, {
      status: 'completed',
      summary: '日报已生成',
      changedFiles: [],
      blockers: [],
      needsReview: [],
    });

    expect(finalized.status).toBe('completed');
    expect(finalized.summary).toContain('AI 日报已上报成功：2026-04-22');
    expect(finalized.summary).toContain('OpenAI 发布新模型');
    expect(finalized.reportedEventDate).toBe('2026-04-22');
    expect(finalized.reportedEventCount).toBe(2);
    expect(finalized.verificationPassed).toBe(true);
    expect(finalized.changedFiles).toContain('runs/run-1/daily-digest-report-payload.json');
    expect(finalized.changedFiles).toContain('runs/run-1/daily-digest-verification.json');
    expect(fs.existsSync(path.join(artifactDir, 'daily-digest-report-payload.json'))).toBe(true);
    expect(fs.existsSync(path.join(artifactDir, 'daily-digest-verification.json'))).toBe(true);
  });

  it('ingests story-top candidate artifacts into active self-improvement signals', async () => {
    const hooks = await import('./workflow-runtime-hooks');
    const store = await import('../company-kernel/self-improvement-store');
    const signalModule = await import('../company-kernel/story-top-candidate-signals');

    fs.mkdirSync(path.join(tempWorkspace, 'User Story', 'CEO Office'), { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, 'User Story', 'CEO Office', 'CEO 办公室.md'), '# test\n', 'utf-8');
    fs.writeFileSync(
      path.join(artifactDir, STORY_TOP_CANDIDATE_ARTIFACT),
      JSON.stringify([
        {
          sourcePath: 'User Story/CEO Office/CEO 办公室.md',
          storyText: '作为 CEO，我希望候选改进可以直接立项。',
          title: '系统改进：候选改进支持直接立项',
          summary: '当前候选改进从发现到立项还要跨层操作。',
          expectedOutcome: 'CEO 能在候选池里直接把高价值故事升格为正式提案。',
          severity: 'high',
          rationale: '这会直接缩短自迭代立项链路。',
          affectedAreas: ['frontend', 'runtime'],
        },
      ], null, 2),
      'utf-8',
    );

    const finalized = await hooks.finalizeWorkflowRun(
      '/platform_engineering_story_candidates',
      tempWorkspace,
      artifactDir,
      {
        status: 'completed',
        summary: '候选提炼完成',
        changedFiles: [],
        blockers: [],
        needsReview: [],
      },
    );

    expect(finalized.status).toBe('completed');
    expect(finalized.summary).toContain('Top 3 已刷新');
    expect(finalized.changedFiles).toContain(`runs/run-1/${STORY_TOP_CANDIDATE_ARTIFACT}`);
    const signals = store.listSystemImprovementSignals({ source: 'user-story-gap' });
    expect(signals.filter((signal) => signalModule.isActiveStoryTopCandidateSignal(signal))).toHaveLength(1);
    expect(signals[0]?.metadata?.candidateKind).toBe('story-top');
  });

  it('falls back to finalText JSON when story-top candidate artifact file was not written', async () => {
    const hooks = await import('./workflow-runtime-hooks');
    const store = await import('../company-kernel/self-improvement-store');
    const signalModule = await import('../company-kernel/story-top-candidate-signals');

    fs.mkdirSync(path.join(tempWorkspace, 'User Story', 'Settings'), { recursive: true });
    fs.writeFileSync(path.join(tempWorkspace, 'User Story', 'Settings', '个人偏好.md'), '# test\n', 'utf-8');

    const finalized = await hooks.finalizeWorkflowRun(
      '/platform_engineering_story_candidates',
      tempWorkspace,
      artifactDir,
      {
        status: 'completed',
        summary: '候选提炼完成',
        changedFiles: [],
        blockers: [],
        needsReview: [],
      },
      {
        workflowOutputText: [
          '```json',
          JSON.stringify([
            {
              sourcePath: 'User Story/Settings/个人偏好.md',
              storyText: '作为用户，我希望汇报详略可以真实影响 AI 行为。',
              title: '系统改进：个人偏好真正接入 AI 主链',
              summary: '当前个人偏好还没有真实作用到 AI 执行与汇报。',
              expectedOutcome: '用户偏好能稳定影响 AI 行为与输出。',
              severity: 'high',
              rationale: '这是 Settings 到 AI 主链的重要闭环缺口。',
              affectedAreas: ['provider', 'runtime'],
            },
          ], null, 2),
          '```',
        ].join('\n'),
      },
    );

    expect(finalized.status).toBe('completed');
    expect(fs.existsSync(path.join(artifactDir, STORY_TOP_CANDIDATE_ARTIFACT))).toBe(true);
    const signals = store.listSystemImprovementSignals({ source: 'user-story-gap' });
    expect(signals.filter((signal) => signalModule.isActiveStoryTopCandidateSignal(signal))).toHaveLength(1);
  });
});
