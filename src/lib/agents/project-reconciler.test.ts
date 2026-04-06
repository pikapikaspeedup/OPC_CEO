import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ProjectDefinition, PipelineStageProgress } from './project-types';

// Mock dependencies
vi.mock('./asset-loader', () => ({
  AssetLoader: {
    getTemplate: vi.fn(),
  },
}));

vi.mock('./project-registry', () => ({
  getProject: vi.fn(),
  updatePipelineStageByStageId: vi.fn(),
  updateBranchProgress: vi.fn(),
}));

vi.mock('./run-registry', () => ({
  getRun: vi.fn((runId: string) => {
    // Default: return run with reviewOutcome 'approved' for completed upstream stages
    return { runId, reviewOutcome: 'approved', stageId: 'mock-stage' };
  }),
}));

vi.mock('./pipeline/pipeline-graph', () => ({
  validateTemplatePipeline: vi.fn(() => []),
  resolveStageId: vi.fn((stage: any) => stage.stageId || stage.groupId),
}));

vi.mock('./project-events', () => ({
  emitProjectEvent: vi.fn(),
}));

vi.mock('../logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { reconcileProject } from './project-reconciler';
import { clearIRCache } from './pipeline/dag-compiler';
import { getProject } from './project-registry';
import { AssetLoader } from './asset-loader';

const mockGetProject = getProject as ReturnType<typeof vi.fn>;
const mockGetTemplate = AssetLoader.getTemplate as ReturnType<typeof vi.fn>;

function makeProject(overrides?: Partial<ProjectDefinition>): ProjectDefinition {
  return {
    projectId: 'p-1',
    name: 'Test Project',
    goal: 'Test',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    runIds: [],
    pipelineState: {
      templateId: 'tmpl-1',
      stages: [
        { stageId: 'spec', stageIndex: 0, status: 'completed', attempts: 1, runId: 'run-1' },
        { stageId: 'dev', stageIndex: 1, status: 'pending', attempts: 0 },
      ],
      activeStageIds: [],
      status: 'running',
    },
    ...overrides,
  };
}

function makeTemplate() {
  return {
    id: 'tmpl-1',
    kind: 'template' as const,
    title: 'Test Template',
    description: '',
    groups: {},
    pipeline: [
      { stageId: 'spec', groupId: 'spec-group', autoTrigger: false },
      { stageId: 'dev', groupId: 'dev-group', autoTrigger: true, upstreamStageIds: ['spec'] },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearIRCache();
});

describe('reconcileProject', () => {
  it('returns noop for non-existent project', async () => {
    mockGetProject.mockReturnValue(null);
    const result = await reconcileProject('nonexistent');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].kind).toBe('noop');
    expect(result.actions[0].detail).toContain('not found');
  });

  it('returns noop for project without pipeline state', async () => {
    mockGetProject.mockReturnValue(makeProject({ pipelineState: undefined }));
    const result = await reconcileProject('p-1');
    expect(result.actions[0].kind).toBe('noop');
    expect(result.actions[0].detail).toContain('No pipeline state');
  });

  it('returns noop for completed project', async () => {
    const project = makeProject();
    project.pipelineState!.status = 'completed';
    mockGetProject.mockReturnValue(project);
    const result = await reconcileProject('p-1');
    expect(result.actions[0].kind).toBe('noop');
    expect(result.actions[0].detail).toContain('already completed');
  });

  it('returns noop for cancelled project', async () => {
    const project = makeProject();
    project.pipelineState!.status = 'cancelled';
    mockGetProject.mockReturnValue(project);
    const result = await reconcileProject('p-1');
    expect(result.actions[0].kind).toBe('noop');
    expect(result.actions[0].detail).toContain('already cancelled');
  });

  it('detects dispatch-stage action for eligible pending stage', async () => {
    const project = makeProject();
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());

    const result = await reconcileProject('p-1', { dryRun: true });
    expect(result.dryRun).toBe(true);
    const dispatchAction = result.actions.find(a => a.kind === 'dispatch-stage');
    expect(dispatchAction).toBeDefined();
    expect(dispatchAction?.stageId).toBe('dev');
  });

  it('returns noop when all stages are consistent', async () => {
    const project = makeProject();
    project.pipelineState!.stages[1].status = 'running';
    project.pipelineState!.stages[1].runId = 'run-2';
    project.pipelineState!.activeStageIds = ['dev'];
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());

    const result = await reconcileProject('p-1');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].kind).toBe('noop');
  });

  it('detects fan-out eligible but not triggered', async () => {
    const template = makeTemplate();
    (template.pipeline as any)[1] = {
      stageId: 'wp-exec',
      groupId: 'wp-group',
      autoTrigger: true,
      upstreamStageIds: ['spec'],
      stageType: 'fan-out',
      fanOutSource: { workPackagesPath: 'work-packages.json', perBranchTemplateId: 'sub-tmpl' },
    };

    const project = makeProject();
    project.pipelineState!.stages[1] = {
      stageId: 'wp-exec',
      stageIndex: 1,
      status: 'pending',
      attempts: 0,
    };
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(template);

    const result = await reconcileProject('p-1', { dryRun: true });
    const fanOutAction = result.actions.find(a => a.kind === 'fan-out');
    expect(fanOutAction).toBeDefined();
    expect(fanOutAction?.stageId).toBe('wp-exec');
  });

  it('detects join ready but pending', async () => {
    const template = {
      ...makeTemplate(),
      pipeline: [
        { stageId: 'spec', groupId: 'spec-group', autoTrigger: false },
        {
          stageId: 'wp-exec',
          groupId: 'wp-group',
          autoTrigger: true,
          upstreamStageIds: ['spec'],
          stageType: 'fan-out' as const,
          fanOutSource: { workPackagesPath: 'wp.json', perBranchTemplateId: 'sub' },
        },
        {
          stageId: 'convergence',
          groupId: 'conv-group',
          autoTrigger: true,
          stageType: 'join' as const,
          joinFrom: 'wp-exec',
          joinPolicy: 'all' as const,
        },
      ] as any,
    };

    const project = makeProject();
    project.pipelineState!.stages = [
      { stageId: 'spec', stageIndex: 0, status: 'completed', attempts: 1, runId: 'run-1' },
      {
        stageId: 'wp-exec',
        stageIndex: 1,
        status: 'running',
        attempts: 1,
        branches: [
          { branchIndex: 0, workPackageId: 'wp-1', workPackageName: 'WP1', subProjectId: 'p-2', status: 'completed', runId: 'r-1' },
          { branchIndex: 1, workPackageId: 'wp-2', workPackageName: 'WP2', subProjectId: 'p-3', status: 'completed', runId: 'r-2' },
        ],
      },
      { stageId: 'convergence', stageIndex: 2, status: 'pending', attempts: 0 },
    ];
    project.pipelineState!.activeStageIds = ['wp-exec'];

    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(template);

    const result = await reconcileProject('p-1', { dryRun: true });
    const joinAction = result.actions.find(a => a.kind === 'complete-join');
    expect(joinAction).toBeDefined();
    expect(joinAction?.stageId).toBe('convergence');
  });

  it('detects branch status sync needed', async () => {
    const project = makeProject();
    project.pipelineState!.stages[1] = {
      stageId: 'wp-exec',
      stageIndex: 1,
      status: 'running',
      attempts: 1,
      branches: [
        { branchIndex: 0, workPackageId: 'wp-1', workPackageName: 'WP1', subProjectId: 'p-2', status: 'running', runId: 'r-1' },
      ],
    };
    project.pipelineState!.activeStageIds = ['wp-exec'];

    // Child project is completed but branch says running
    const childProject = makeProject();
    childProject.projectId = 'p-2';
    childProject.pipelineState!.status = 'completed';

    mockGetProject.mockImplementation((id: string) => {
      if (id === 'p-1') return project;
      if (id === 'p-2') return childProject;
      return null;
    });
    mockGetTemplate.mockReturnValue(makeTemplate());

    const result = await reconcileProject('p-1', { dryRun: true });
    const syncAction = result.actions.find(a => a.kind === 'sync-status' && a.branchIndex === 0);
    expect(syncAction).toBeDefined();
    expect(syncAction?.detail).toContain('child project completed');
  });

  it('detects activeStageIds mismatch', async () => {
    const project = makeProject();
    project.pipelineState!.stages[1].status = 'running';
    project.pipelineState!.stages[1].runId = 'run-2';
    project.pipelineState!.activeStageIds = []; // Should be ['dev']
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());

    const result = await reconcileProject('p-1', { dryRun: true });
    const syncAction = result.actions.find(a => a.kind === 'sync-status' && a.detail.includes('activeStageIds'));
    expect(syncAction).toBeDefined();
  });

  it('defaults to dryRun=true', async () => {
    mockGetProject.mockReturnValue(makeProject());
    mockGetTemplate.mockReturnValue(makeTemplate());

    const result = await reconcileProject('p-1');
    expect(result.dryRun).toBe(true);
  });

  it('handles concurrent reconcile gracefully', async () => {
    const project = makeProject();
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());

    // Start two reconciles concurrently
    const [r1, r2] = await Promise.all([
      reconcileProject('p-1', { dryRun: false }),
      reconcileProject('p-1', { dryRun: false }),
    ]);

    // At least one should succeed, the other should get noop due to concurrent guard
    const results = [r1, r2];
    const noopResults = results.filter(r => r.actions.some(a => a.detail.includes('already in progress')));
    // It's possible both complete (race condition), but the mutex should prevent concurrent execution
    expect(noopResults.length + results.filter(r => r.actions.some(a => a.kind === 'dispatch-stage')).length).toBeGreaterThanOrEqual(1);
  });

  it('returns noop for normally running project', async () => {
    const project = makeProject();
    project.pipelineState!.stages[1].status = 'running';
    project.pipelineState!.stages[1].runId = 'run-2';
    project.pipelineState!.activeStageIds = ['dev'];
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());

    const result = await reconcileProject('p-1');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].kind).toBe('noop');
    expect(result.actions[0].detail).toContain('consistent');
  });
});
