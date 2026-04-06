import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ProjectDefinition, ProjectPipelineState, PipelineStageProgress, BranchProgress } from './project-types';

// Mock dependencies
vi.mock('./asset-loader', () => ({
  AssetLoader: {
    getTemplate: vi.fn(),
  },
}));

vi.mock('./project-registry', () => ({
  getProject: vi.fn(),
  listProjects: vi.fn(() => []),
}));

vi.mock('./run-registry', () => ({
  getRun: vi.fn((runId: string) => {
    return { runId, reviewOutcome: 'approved', groupId: 'mock-group' };
  }),
}));

vi.mock('./group-registry', () => ({
  getGroup: vi.fn(() => ({ id: 'mock-group' })),
}));

vi.mock('./pipeline/pipeline-graph', () => ({
  validateTemplatePipeline: vi.fn(() => []),
  resolveStageId: vi.fn((stage: any) => stage.stageId || stage.groupId),
}));

import { analyzeProject, buildProjectGraph } from './project-diagnostics';
import { clearIRCache } from './pipeline/dag-compiler';
import { AssetLoader } from './asset-loader';
import { getProject } from './project-registry';
import { getRun } from './run-registry';

const mockGetProject = getProject as ReturnType<typeof vi.fn>;
const mockGetTemplate = AssetLoader.getTemplate as ReturnType<typeof vi.fn>;
const mockGetRun = getRun as ReturnType<typeof vi.fn>;

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
        { stageId: 'spec', groupId: 'spec-group', stageIndex: 0, status: 'completed', attempts: 1, runId: 'run-1' },
        { stageId: 'dev', groupId: 'dev-group', stageIndex: 1, status: 'running', attempts: 1, runId: 'run-2' },
        { stageId: 'test', groupId: 'test-group', stageIndex: 2, status: 'pending', attempts: 0 },
      ],
      activeStageIds: ['dev'],
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
      { stageId: 'test', groupId: 'test-group', autoTrigger: true, upstreamStageIds: ['dev'] },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearIRCache();
  // Re-establish default getRun implementation (clearAllMocks doesn't reset mockReturnValue)
  mockGetRun.mockImplementation((runId: string) => ({ runId, reviewOutcome: 'approved', groupId: 'mock-group' }));
});

describe('analyzeProject', () => {
  it('returns null for non-existent project', () => {
    mockGetProject.mockReturnValue(null);
    expect(analyzeProject('nonexistent')).toBeNull();
  });

  it('returns waiting health for project without pipeline state', () => {
    mockGetProject.mockReturnValue(makeProject({ pipelineState: undefined }));
    const result = analyzeProject('p-1');
    expect(result?.health).toBe('waiting');
    expect(result?.canReconcile).toBe(false);
    expect(result?.stages).toHaveLength(0);
  });

  it('returns running health for normal running project', () => {
    const project = makeProject();
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());
    mockGetRun.mockReturnValue({ status: 'running', liveState: {} });

    const result = analyzeProject('p-1');
    expect(result?.health).toBe('running');
    expect(result?.activeStageIds).toEqual(['dev']);
  });

  it('returns completed health for completed project', () => {
    const project = makeProject();
    project.pipelineState!.status = 'completed';
    project.pipelineState!.stages.forEach(s => { s.status = 'completed'; });
    project.pipelineState!.activeStageIds = [];
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());

    const result = analyzeProject('p-1');
    expect(result?.health).toBe('completed');
  });

  it('returns failed health for failed project', () => {
    const project = makeProject();
    project.pipelineState!.status = 'failed';
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());

    const result = analyzeProject('p-1');
    expect(result?.health).toBe('failed');
  });

  it('returns stale health when a run has staleSince', () => {
    const project = makeProject();
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());
    mockGetRun.mockReturnValue({ status: 'running', liveState: { staleSince: '2026-01-01T10:00:00Z' } });

    const result = analyzeProject('p-1');
    expect(result?.health).toBe('stale');
    const devStage = result?.stages.find(s => s.stageId === 'dev');
    expect(devStage?.staleSince).toBe('2026-01-01T10:00:00Z');
    expect(devStage?.recommendedActions).toContain('nudge');
  });

  it('returns waiting health with no active stages but pending exist', () => {
    const project = makeProject();
    project.pipelineState!.stages[1].status = 'completed';
    project.pipelineState!.activeStageIds = [];
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());

    const result = analyzeProject('p-1');
    expect(result?.health).toBe('waiting');
  });

  it('detects reconcile-eligible pending stage', () => {
    const project = makeProject();
    project.pipelineState!.stages[1].status = 'completed';
    project.pipelineState!.stages[1].runId = 'run-2';
    project.pipelineState!.activeStageIds = [];
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());

    const result = analyzeProject('p-1');
    expect(result?.canReconcile).toBe(true);
    const testStage = result?.stages.find(s => s.stageId === 'test');
    expect(testStage?.pendingReason).toContain('upstream completed');
    expect(testStage?.recommendedActions).toContain('reconcile');
  });

  it('returns orchestrationState=na for normal stages', () => {
    const project = makeProject();
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());
    mockGetRun.mockReturnValue({ status: 'running', liveState: {} });

    const result = analyzeProject('p-1');
    // All stages in this template are 'normal' type
    for (const stage of result?.stages || []) {
      expect(stage.orchestrationState).toBe('na');
    }
  });

  it('reports failed stage with resume/cancel actions', () => {
    const project = makeProject();
    project.pipelineState!.stages[1].status = 'failed';
    project.pipelineState!.stages[1].lastError = 'timeout';
    project.pipelineState!.activeStageIds = [];
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());

    const result = analyzeProject('p-1');
    const devStage = result?.stages.find(s => s.stageId === 'dev');
    expect(devStage?.recommendedActions).toContain('resume');
    expect(devStage?.recommendedActions).toContain('cancel');
  });
});

describe('buildProjectGraph', () => {
  it('returns null for non-existent project', () => {
    mockGetProject.mockReturnValue(null);
    expect(buildProjectGraph('nonexistent')).toBeNull();
  });

  it('returns null for project without pipeline state', () => {
    mockGetProject.mockReturnValue(makeProject({ pipelineState: undefined }));
    expect(buildProjectGraph('p-1')).toBeNull();
  });

  it('builds correct graph for linear pipeline', () => {
    const project = makeProject();
    mockGetProject.mockReturnValue(project);
    mockGetTemplate.mockReturnValue(makeTemplate());

    const graph = buildProjectGraph('p-1');
    expect(graph?.nodes).toHaveLength(3);
    expect(graph?.edges).toHaveLength(2);

    const spec = graph?.nodes.find(n => n.stageId === 'spec');
    expect(spec?.status).toBe('completed');
    expect(spec?.active).toBe(false);

    const dev = graph?.nodes.find(n => n.stageId === 'dev');
    expect(dev?.status).toBe('running');
    expect(dev?.active).toBe(true);

    // Edges: spec->dev (explicit upstream), dev->test (explicit upstream)
    expect(graph?.edges).toContainEqual({ from: 'spec', to: 'dev' });
    expect(graph?.edges).toContainEqual({ from: 'dev', to: 'test' });
  });

  it('includes branch progress in graph nodes', () => {
    const project = makeProject();
    project.pipelineState!.stages[1].branches = [
      { branchIndex: 0, workPackageId: 'wp-1', workPackageName: 'WP 1', subProjectId: 'p-2', status: 'completed', runId: 'r-1' },
      { branchIndex: 1, workPackageId: 'wp-2', workPackageName: 'WP 2', subProjectId: 'p-3', status: 'running', runId: 'r-2' },
    ];
    mockGetProject.mockReturnValue(project);
    
    const template = makeTemplate();
    (template.pipeline[1] as any).stageType = 'fan-out';
    mockGetTemplate.mockReturnValue(template);

    const graph = buildProjectGraph('p-1');
    const devNode = graph?.nodes.find(n => n.stageId === 'dev');
    expect(devNode?.branchCompleted).toBe(1);
    expect(devNode?.branchTotal).toBe(2);
  });
});
