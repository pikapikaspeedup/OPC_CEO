import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DepartmentConfig } from '../types';

// Mock project-registry
vi.mock('./project-registry', () => ({
  listProjects: vi.fn(() => []),
  createProject: vi.fn((input) => ({
    projectId: 'mock-pid-1',
    name: input.name,
    status: 'active',
    workspace: input.workspace,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runIds: [],
    goal: input.goal,
  })),
  getProject: vi.fn(() => null),
  updateProject: vi.fn((id, updates) => ({ projectId: id, ...updates })),
  addRunToProject: vi.fn(),
  initializePipelineState: vi.fn(),
  trackStageDispatch: vi.fn(),
}));

// Mock dispatch-service
vi.mock('./dispatch-service', () => ({
  executeDispatch: vi.fn(async () => ({ runId: 'mock-run-1' })),
}));

// Mock group-runtime
vi.mock('./group-runtime', () => ({
  cancelRun: vi.fn(async () => {}),
  interveneRun: vi.fn(async () => ({ status: 'intervened' })),
}));

// Mock asset-loader (used by ceo-prompts buildCompanyContext)
vi.mock('./asset-loader', () => ({
  AssetLoader: {
    loadAllTemplates: vi.fn(() => [{
      id: 'mock-tpl',
      title: 'Mock Template',
      description: '开发编码研究调研',
      groups: { 'mock-group': { title: 'Mock Group', description: '通用任务' } },
      pipeline: [{ groupId: 'mock-group', stageId: 'stage-0', stageType: 'task' }],
    }]),
  },
}));

// Mock run-registry
vi.mock('./run-registry', () => ({
  listRuns: vi.fn(() => []),
}));

// Mock llm-oneshot
vi.mock('./llm-oneshot', () => ({
  callLLMOneshot: vi.fn(async () => '{}'),
}));

// Mock pipeline-generator (extractJsonFromResponse)
vi.mock('./pipeline-generator', () => ({
  extractJsonFromResponse: vi.fn((raw: string) => JSON.parse(raw)),
  generatePipeline: vi.fn(),
}));

import { processCEOCommand, getCEOSystemPrompt } from './ceo-agent';
import { listProjects, createProject, updateProject } from './project-registry';
import { executeDispatch } from './dispatch-service';
import { cancelRun, interveneRun } from './group-runtime';
import { AssetLoader } from './asset-loader';
import { listRuns } from './run-registry';
import { callLLMOneshot } from './llm-oneshot';
import { extractJsonFromResponse } from './pipeline-generator';

function makeDepartments(entries: Array<{
  uri: string;
  name: string;
  type: string;
  skills?: Array<{ name: string; category: string; difficulty?: string }>;
  templateIds?: string[];
}>): Map<string, DepartmentConfig> {
  const map = new Map<string, DepartmentConfig>();
  for (const e of entries) {
    map.set(e.uri, {
      name: e.name,
      type: e.type,
      skills: (e.skills || []).map(s => ({ skillId: s.name, name: s.name, category: s.category, workflowRef: '', difficulty: (s.difficulty as 'junior' | 'mid' | 'senior') ?? 'mid' })),
      okr: null,
      ...(e.templateIds ? { templateIds: e.templateIds } : {}),
    });
  }
  return map;
}

/** Helper: make LLM return a specific decision JSON */
function mockLLMDecision(decision: Record<string, unknown>) {
  const json = JSON.stringify(decision);
  vi.mocked(callLLMOneshot).mockResolvedValue(json);
  vi.mocked(extractJsonFromResponse).mockReturnValue(decision);
}

// =========================================================================
// Fast-path tests (no LLM call)
// =========================================================================

describe('processCEOCommand — fast paths', () => {
  beforeEach(() => {
    vi.mocked(listProjects).mockReturnValue([]);
    vi.mocked(updateProject).mockImplementation((id, updates) => ({ projectId: id, ...updates } as any));
    vi.mocked(callLLMOneshot).mockReset();
  });

  it('returns error for empty command', async () => {
    const result = await processCEOCommand('', makeDepartments([]));
    expect(result.success).toBe(false);
    expect(result.action).toBe('info');
    expect(result.message).toBe('请输入指令');
    expect(callLLMOneshot).not.toHaveBeenCalled();
  });

  it('returns error for whitespace-only command', async () => {
    const result = await processCEOCommand('   ', makeDepartments([]));
    expect(result.success).toBe(false);
    expect(result.action).toBe('info');
    expect(callLLMOneshot).not.toHaveBeenCalled();
  });

  // --- Status queries ---

  it('detects "状态" as status query (no LLM call)', async () => {
    const deps = makeDepartments([
      { uri: '/ws/dev', name: '开发部', type: 'build' },
    ]);
    const result = await processCEOCommand('公司状态', deps);
    expect(result.success).toBe(true);
    expect(result.action).toBe('info');
    expect(result.message).toContain('公司状态');
    expect(callLLMOneshot).not.toHaveBeenCalled();
  });

  it('detects "进度" as status query', async () => {
    const result = await processCEOCommand('项目进度怎样', makeDepartments([]));
    expect(result.action).toBe('info');
    expect(callLLMOneshot).not.toHaveBeenCalled();
  });

  it('includes active dept info in status response', async () => {
    vi.mocked(listProjects).mockReturnValue([
      { projectId: 'p1', name: 'X', status: 'active', workspace: '/ws/dev', createdAt: '', updatedAt: '', runIds: [], goal: '' } as any,
    ]);
    const deps = makeDepartments([
      { uri: '/ws/dev', name: '开发部', type: 'build' },
    ]);
    const result = await processCEOCommand('汇报', deps);
    expect(result.message).toContain('开发部');
    expect(result.message).toContain('1 活跃');
    expect(callLLMOneshot).not.toHaveBeenCalled();
  });
});

// =========================================================================
// Intervention tests (no LLM call)
// =========================================================================

describe('processCEOCommand — intervention intents', () => {
  const deps = makeDepartments([
    { uri: '/ws/dev', name: '研发部', type: 'build' },
  ]);

  beforeEach(() => {
    vi.mocked(listProjects).mockReturnValue([
      {
        projectId: 'proj-001',
        name: '优化首页性能',
        status: 'active',
        workspace: '/ws/dev',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        runIds: ['run-001'],
        goal: '优化首页加载速度',
      } as any,
    ]);
    vi.mocked(listRuns).mockReturnValue([
      { runId: 'run-001', status: 'running', groupId: 'g1', projectId: 'proj-001' } as any,
    ]);
    vi.mocked(updateProject).mockImplementation((id, updates) => ({ projectId: id, ...updates } as any));
    vi.mocked(cancelRun).mockResolvedValue(undefined);
    vi.mocked(interveneRun).mockResolvedValue({ status: 'intervened' } as any);
    vi.mocked(callLLMOneshot).mockReset();
  });

  it('cancels a project by name keyword (no LLM)', async () => {
    const result = await processCEOCommand('取消优化首页性能', deps);
    expect(result.action).toBe('cancel');
    expect(result.success).toBe(true);
    expect(result.projectId).toBe('proj-001');
    expect(cancelRun).toHaveBeenCalledWith('run-001');
    expect(updateProject).toHaveBeenCalledWith('proj-001', { status: 'cancelled' });
    expect(callLLMOneshot).not.toHaveBeenCalled();
  });

  it('pauses a project (no LLM)', async () => {
    const result = await processCEOCommand('暂停优化首页性能', deps);
    expect(result.action).toBe('pause');
    expect(result.success).toBe(true);
    expect(updateProject).toHaveBeenCalledWith('proj-001', { status: 'paused' });
    expect(callLLMOneshot).not.toHaveBeenCalled();
  });

  it('resumes a project (no LLM)', async () => {
    vi.mocked(listProjects).mockReturnValue([
      { projectId: 'proj-001', name: '优化首页性能', status: 'paused', workspace: '/ws/dev', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), runIds: [], goal: '' } as any,
    ]);
    vi.mocked(listRuns).mockReturnValue([]);
    const result = await processCEOCommand('恢复优化首页性能', deps);
    expect(result.action).toBe('resume');
    expect(result.success).toBe(true);
    expect(callLLMOneshot).not.toHaveBeenCalled();
  });

  it('retries a running project (no LLM)', async () => {
    const result = await processCEOCommand('重试优化首页性能', deps);
    expect(result.action).toBe('retry');
    expect(result.success).toBe(true);
    expect(interveneRun).toHaveBeenCalledWith('run-001', 'retry');
    expect(callLLMOneshot).not.toHaveBeenCalled();
  });

  it('skips current stage (no LLM)', async () => {
    const result = await processCEOCommand('跳过优化首页性能', deps);
    expect(result.action).toBe('skip');
    expect(result.success).toBe(true);
    expect(interveneRun).toHaveBeenCalledWith('run-001', 'nudge', '跳过当前阶段并继续执行下一个');
    expect(callLLMOneshot).not.toHaveBeenCalled();
  });

  it('skip fails gracefully when no active run', async () => {
    vi.mocked(listRuns).mockReturnValue([]);
    const result = await processCEOCommand('跳过优化首页性能', deps);
    expect(result.action).toBe('skip');
    expect(result.success).toBe(false);
    expect(callLLMOneshot).not.toHaveBeenCalled();
  });
});

// =========================================================================
// LLM Decision tests (mocked LLM)
// =========================================================================

describe('processCEOCommand — LLM dispatch decision', () => {
  const deps = makeDepartments([
    { uri: '/ws/dev', name: '研发部', type: 'build', templateIds: ['mock-tpl'] },
    { uri: '/ws/ops', name: '运维部', type: 'operations' },
  ]);

  beforeEach(() => {
    vi.mocked(listProjects).mockReturnValue([]);
    vi.mocked(createProject).mockImplementation((input: any) => ({
      projectId: 'mock-pid-1', name: input.name, status: 'active',
      workspace: input.workspace, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), runIds: [], goal: input.goal,
    }));
    vi.mocked(executeDispatch).mockResolvedValue({ runId: 'mock-run-1' });
    vi.mocked(AssetLoader.loadAllTemplates).mockReturnValue([{
      id: 'mock-tpl',
      title: 'Mock Template',
      description: '开发编码研究调研',
      groups: { 'mock-group': { title: 'Mock Group' } },
      pipeline: [{ groupId: 'mock-group', stageId: 'stage-0', stageType: 'task' }],
    }] as any);
  });

  it('dispatches to correct department when LLM returns dispatch', async () => {
    mockLLMDecision({
      action: 'dispatch',
      workspace: '/ws/dev',
      templateId: 'mock-tpl',
      projectName: '新登录功能',
      goal: '开发一个新的登录页面',
      priority: 'normal',
      reasoning: '研发部有开发模板',
    });

    const result = await processCEOCommand('开发一个新的登录页面', deps);
    expect(result.success).toBe(true);
    expect(result.action).toBe('create_project');
    expect(result.message).toContain('研发部');
    expect(result.message).toContain('mock-tpl');
    expect(result.projectId).toBe('mock-pid-1');
    expect(result.runId).toBe('mock-run-1');
    expect(executeDispatch).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'mock-tpl',
      workspace: '/ws/dev',
    }));
  });

  it('persists ceoDecision to project via updateProject', async () => {
    mockLLMDecision({
      action: 'dispatch',
      workspace: '/ws/dev',
      templateId: 'mock-tpl',
      projectName: '新登录功能',
      goal: '开发登录',
      reasoning: '研发部适合',
    });

    await processCEOCommand('开发登录', deps);
    expect(updateProject).toHaveBeenCalledWith('mock-pid-1', expect.objectContaining({
      ceoDecision: expect.objectContaining({
        action: 'dispatch',
        command: '开发登录',
        reasoning: '研发部适合',
        departmentName: '研发部',
        templateId: 'mock-tpl',
        resolved: true,
      }),
    }));
  });

  it('reports error when LLM selects nonexistent workspace', async () => {
    mockLLMDecision({
      action: 'dispatch',
      workspace: '/ws/nonexistent',
      templateId: 'mock-tpl',
      projectName: '测试',
      goal: '测试',
      reasoning: '测试',
    });

    const result = await processCEOCommand('做一点事情', deps);
    expect(result.success).toBe(false);
    expect(result.action).toBe('report_to_human');
    expect(result.message).toContain('不存在');
  });

  it('blocks dispatch when department is overloaded', async () => {
    vi.mocked(listProjects).mockReturnValue(
      Array.from({ length: 5 }, (_, i) => ({
        projectId: `p${i}`, name: `P${i}`, status: 'active', workspace: '/ws/dev',
        createdAt: '', updatedAt: '', runIds: [], goal: '',
      } as any)),
    );

    mockLLMDecision({
      action: 'dispatch',
      workspace: '/ws/dev',
      templateId: 'mock-tpl',
      projectName: '新功能',
      goal: '开发新功能',
      reasoning: '研发部适合',
    });

    const result = await processCEOCommand('开发一个新功能', deps);
    expect(result.action).toBe('report_to_human');
    expect(result.message).toContain('负载较高');
  });

  it('still creates project if dispatch fails', async () => {
    vi.mocked(executeDispatch).mockRejectedValue(new Error('dispatch error'));

    mockLLMDecision({
      action: 'dispatch',
      workspace: '/ws/dev',
      templateId: 'mock-tpl',
      projectName: '新API',
      goal: '开发API',
      reasoning: '测试',
    });

    const result = await processCEOCommand('开发一个新API', deps);
    expect(result.success).toBe(true);
    expect(result.action).toBe('create_project');
    expect(result.projectId).toBe('mock-pid-1');
    expect(result.runId).toBeUndefined();
    expect(result.message).toContain('未能启动');
  });
});

describe('processCEOCommand — LLM suggest_add_template decision', () => {
  const deps = makeDepartments([
    { uri: '/ws/dev', name: '研发部', type: 'build' },
  ]);

  beforeEach(() => {
    vi.mocked(listProjects).mockReturnValue([]);
    vi.mocked(createProject).mockImplementation((input: any) => ({
      projectId: 'mock-pid-1', name: input.name, status: 'active',
      workspace: input.workspace, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), runIds: [], goal: input.goal,
    }));
  });

  it('returns needs_decision with suggestions', async () => {
    mockLLMDecision({
      action: 'suggest_add_template',
      workspace: '/ws/dev',
      templateId: 'some-tpl',
      departmentName: '研发部',
      projectName: '新功能',
      goal: '开发新功能',
      reasoning: '研发部没有关联此模板',
    });

    const result = await processCEOCommand('开发新功能', deps);
    expect(result.action).toBe('needs_decision');
    expect(result.success).toBe(true);
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions!.some(s => s.type === 'suggest_add_template')).toBe(true);
    expect(result.suggestions!.some(s => s.type === 'auto_generate_and_dispatch')).toBe(true);
  });

  it('persists unresolved ceoDecision with suggestions', async () => {
    mockLLMDecision({
      action: 'suggest_add_template',
      workspace: '/ws/dev',
      templateId: 'some-tpl',
      departmentName: '研发部',
      projectName: '新功能',
      goal: '开发新功能',
      reasoning: '研发部没有关联此模板',
    });

    await processCEOCommand('开发新功能', deps);
    expect(updateProject).toHaveBeenCalledWith('mock-pid-1', expect.objectContaining({
      ceoDecision: expect.objectContaining({
        action: 'suggest_add_template',
        resolved: false,
        suggestions: expect.arrayContaining([
          expect.objectContaining({ type: 'suggest_add_template' }),
        ]),
      }),
    }));
  });
});

describe('processCEOCommand — LLM create_template decision', () => {
  const deps = makeDepartments([
    { uri: '/ws/dev', name: '研发部', type: 'build' },
  ]);

  beforeEach(() => {
    vi.mocked(listProjects).mockReturnValue([]);
    vi.mocked(createProject).mockImplementation((input: any) => ({
      projectId: 'mock-pid-1', name: input.name, status: 'active',
      workspace: input.workspace, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), runIds: [], goal: input.goal,
    }));
  });

  it('returns needs_decision with template creation options', async () => {
    mockLLMDecision({
      action: 'create_template',
      workspace: '/ws/dev',
      departmentName: '研发部',
      projectName: '特殊任务',
      goal: '做一件特殊的事',
      templateGoal: '需要包含审批和并行阶段',
      reasoning: '现有模板都不适合',
    });

    const result = await processCEOCommand('做一件特殊的事', deps);
    expect(result.action).toBe('needs_decision');
    expect(result.suggestions!.some(s => s.type === 'auto_generate_and_dispatch')).toBe(true);
    expect(result.suggestions!.some(s => s.type === 'create_template')).toBe(true);
  });
});

describe('processCEOCommand — LLM report_to_human decision', () => {
  it('returns report_to_human from LLM', async () => {
    mockLLMDecision({
      action: 'report_to_human',
      reportTitle: '无法处理',
      reportDescription: '指令不明确',
      reasoning: '指令太模糊',
    });

    const result = await processCEOCommand('做点什么', new Map());
    expect(result.action).toBe('report_to_human');
    expect(result.message).toContain('无法处理');
  });
});

describe('processCEOCommand — LLM multi_dispatch decision', () => {
  const deps = makeDepartments([
    { uri: '/ws/dev', name: '研发部', type: 'build' },
    { uri: '/ws/ops', name: '运营部', type: 'operations' },
  ]);

  beforeEach(() => {
    vi.mocked(listProjects).mockReturnValue([]);
    let counter = 0;
    vi.mocked(createProject).mockImplementation((input: any) => ({
      projectId: `collab-pid-${++counter}`,
      name: input.name, status: 'active',
      workspace: input.workspace, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), runIds: [], goal: input.goal,
    }));
    vi.mocked(executeDispatch).mockResolvedValue({ runId: 'mock-run-collab' });
  });

  it('creates multiple projects for multi_dispatch', async () => {
    mockLLMDecision({
      action: 'multi_dispatch',
      dispatches: [
        { workspace: '/ws/dev', templateId: 'tpl-a' },
        { workspace: '/ws/ops', templateId: 'tpl-b' },
      ],
      projectName: '用户增长',
      goal: '研发和运营联合推动用户增长',
      reasoning: '需要多部门协作',
    });

    const result = await processCEOCommand('研发和运营一起做用户增长', deps);
    expect(result.action).toBe('multi_create');
    expect(result.success).toBe(true);
    expect(result.projectIds?.length).toBe(2);
    expect(result.message).toContain('研发部');
    expect(result.message).toContain('运营部');
  });
});

describe('processCEOCommand — LLM failure handling', () => {
  it('returns error when LLM call fails', async () => {
    vi.mocked(callLLMOneshot).mockRejectedValue(new Error('LLM connection timeout'));
    vi.mocked(listProjects).mockReturnValue([]);

    const result = await processCEOCommand('做一个新功能', makeDepartments([
      { uri: '/ws/dev', name: '研发部', type: 'build' },
    ]));
    expect(result.success).toBe(false);
    expect(result.action).toBe('report_to_human');
    expect(result.message).toContain('决策失败');
    expect(result.message).toContain('LLM connection timeout');
  });

  it('returns error when LLM returns invalid JSON', async () => {
    vi.mocked(callLLMOneshot).mockResolvedValue('not json');
    vi.mocked(extractJsonFromResponse).mockImplementation(() => { throw new Error('Invalid JSON'); });
    vi.mocked(listProjects).mockReturnValue([]);

    const result = await processCEOCommand('做一个新功能', makeDepartments([
      { uri: '/ws/dev', name: '研发部', type: 'build' },
    ]));
    expect(result.success).toBe(false);
    expect(result.action).toBe('report_to_human');
  });
});

// =========================================================================
// getCEOSystemPrompt tests
// =========================================================================

describe('getCEOSystemPrompt', () => {
  beforeEach(() => {
    vi.mocked(listProjects).mockReturnValue([]);
    vi.mocked(AssetLoader.loadAllTemplates).mockReturnValue([{
      id: 'mock-tpl',
      title: 'Mock Template',
      description: '开发编码',
      groups: { 'mock-group': { title: 'Mock Group' } },
      pipeline: [{ groupId: 'mock-group', stageId: 's0', stageType: 'task' }],
    }] as any);
  });

  it('returns a non-empty string', () => {
    const prompt = getCEOSystemPrompt(makeDepartments([
      { uri: '/ws/dev', name: '研发', type: 'build' },
    ]));
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
  });

  it('includes department name in prompt', () => {
    const prompt = getCEOSystemPrompt(makeDepartments([
      { uri: '/ws/alpha', name: 'Alpha研发队', type: 'build' },
    ]));
    expect(prompt).toContain('Alpha研发队');
  });

  it('includes template info in prompt', () => {
    const prompt = getCEOSystemPrompt(makeDepartments([
      { uri: '/ws/dev', name: '研发', type: 'build' },
    ]));
    expect(prompt).toContain('mock-tpl');
    expect(prompt).toContain('Mock Template');
  });
});
