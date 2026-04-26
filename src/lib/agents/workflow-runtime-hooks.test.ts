import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      path.join(workflowScriptsDir, 'fetch_context.py'),
      [
        '#!/usr/bin/env python3',
        'import json',
        'import sys',
        '',
        'out_path = sys.argv[sys.argv.index("--out") + 1]',
        'payload = {',
        '  "status": "ok",',
        '  "articleCount": 2,',
        '  "sourceArticleIds": [101, 202],',
        '  "articles": [',
        '    {"title": "First article", "summary": "Summary one", "url": "https://example.com/1"},',
        '    {"title": "Second article", "summary": "Summary two", "url": "https://example.com/2"}',
        '  ]',
        '}',
        'with open(out_path, "w", encoding="utf-8") as fh:',
        '    json.dump(payload, fh, ensure_ascii=False)',
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

  it('prepares digest context from canonical workflow scripts without requiring a skill', async () => {
    const hooks = await import('./workflow-runtime-hooks');

    const prepared = await hooks.prepareWorkflowRuntimeContext('/ai_digest', tempWorkspace, artifactDir);

    expect(prepared.promptAppendix).toContain('Prepared Daily Digest Context');
    expect(prepared.promptAppendix).toContain('Workflow scripts dir:');
    expect(prepared.promptAppendix).toContain('fetch_context.py');
    expect(prepared.promptAppendix).toContain('report_digest.py');
    expect(prepared.promptAppendix).toContain('Article count in context window: 2');
    expect(prepared.promptAppendix).toContain('First article');
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
});
