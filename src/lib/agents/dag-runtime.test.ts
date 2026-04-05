import { describe, expect, it, vi, beforeEach } from 'vitest';
import { canActivateNode, getDownstreamNodes, getActivatableNodes, filterSourcesByNode, evaluateSwitch, evaluateLoopEnd } from './dag-runtime';
import { compilePipelineToIR, clearIRCache } from './dag-compiler';
import type { TemplateDefinition } from './pipeline-types';
import type { ProjectPipelineState, PipelineStageProgress, PipelineStageStatus } from './project-types';
import type { DagNode } from './dag-ir-types';
import type { DagIR } from './dag-ir-types';

// Mock run-registry and group-registry
vi.mock('./run-registry', () => ({
  getRun: vi.fn((runId: string) => {
    if (runId === 'run-approved') return { runId: 'run-approved', reviewOutcome: 'approved', groupId: 'g1' };
    if (runId === 'run-rejected') return { runId: 'run-rejected', reviewOutcome: 'rejected', groupId: 'g1' };
    if (runId === 'run-none') return { runId: 'run-none', groupId: 'g1' };
    if (runId === 'run-g2') return { runId: 'run-g2', groupId: 'g2' };
    return null;
  }),
}));

vi.mock('./group-registry', () => ({
  getGroup: vi.fn((groupId: string) => {
    if (groupId === 'filtered-group') {
      return { id: 'filtered-group', sourceContract: { acceptedSourceGroupIds: ['g1'] } };
    }
    return { id: groupId };
  }),
}));

const baseGroup = { title: 'G', description: 'g', executionMode: 'review-loop' as const, roles: [] };

function makeTemplate(overrides: Partial<TemplateDefinition> = {}): TemplateDefinition {
  return {
    id: 'test',
    kind: 'template',
    title: 'Test',
    description: 'test',
    groups: { a: baseGroup, b: baseGroup, c: baseGroup },
    pipeline: [],
    ...overrides,
  };
}

function makeStageProgress(stageId: string, status: PipelineStageStatus, runId?: string): PipelineStageProgress {
  return {
    stageId,
    groupId: stageId,
    stageIndex: 0,
    status,
    attempts: 0,
    ...(runId ? { runId } : {}),
  };
}

function makeProjectState(stages: PipelineStageProgress[]): ProjectPipelineState {
  return {
    templateId: 'test',
    stages,
    activeStageIds: stages.filter(s => s.status === 'running').map(s => s.stageId),
    status: 'running',
  };
}

function compileTemplate(overrides: Partial<TemplateDefinition> = {}): DagIR {
  return compilePipelineToIR(makeTemplate(overrides));
}

describe('dag-runtime', () => {
  beforeEach(() => {
    clearIRCache();
  });

  // ── canActivateNode ─────────────────────────────────────────────────

  describe('canActivateNode', () => {
    it('entry node (no upstream) → can activate', () => {
      const ir = compileTemplate({
        pipeline: [{ stageId: 'a', groupId: 'a', autoTrigger: false }],
      });
      const state = makeProjectState([makeStageProgress('a', 'pending')]);
      const result = canActivateNode(ir, 'a', state);
      expect(result.canActivate).toBe(true);
      expect(result.upstreamNodeIds).toHaveLength(0);
    });

    it('upstream pending → cannot activate', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true },
        ],
      });
      const state = makeProjectState([
        makeStageProgress('a', 'pending'),
        makeStageProgress('b', 'pending'),
      ]);
      const result = canActivateNode(ir, 'b', state);
      expect(result.canActivate).toBe(false);
      expect(result.pendingUpstreamIds).toContain('a');
    });

    it('upstream completed → can activate', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true, triggerOn: 'completed' },
        ],
      });
      const state = makeProjectState([
        makeStageProgress('a', 'completed'),
        makeStageProgress('b', 'pending'),
      ]);
      const result = canActivateNode(ir, 'b', state);
      expect(result.canActivate).toBe(true);
    });

    it('triggerOn approved — upstream approved → can activate', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true, triggerOn: 'approved' },
        ],
      });
      const state = makeProjectState([
        makeStageProgress('a', 'completed', 'run-approved'),
        makeStageProgress('b', 'pending'),
      ]);
      const result = canActivateNode(ir, 'b', state);
      expect(result.canActivate).toBe(true);
    });

    it('triggerOn approved — upstream not approved → cannot activate', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true, triggerOn: 'approved' },
        ],
      });
      const state = makeProjectState([
        makeStageProgress('a', 'completed', 'run-rejected'),
        makeStageProgress('b', 'pending'),
      ]);
      const result = canActivateNode(ir, 'b', state);
      expect(result.canActivate).toBe(false);
    });

    it('triggerOn approved — upstream completed but no review → cannot activate', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true },  // default triggerOn = 'approved'
        ],
      });
      const state = makeProjectState([
        makeStageProgress('a', 'completed', 'run-none'),
        makeStageProgress('b', 'pending'),
      ]);
      const result = canActivateNode(ir, 'b', state);
      expect(result.canActivate).toBe(false);
    });

    it('multi-upstream — all completed → can activate', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: false, upstreamStageIds: [] },
          { stageId: 'c', groupId: 'c', autoTrigger: true, upstreamStageIds: ['a', 'b'], triggerOn: 'completed' },
        ],
      });
      const state = makeProjectState([
        makeStageProgress('a', 'completed'),
        makeStageProgress('b', 'completed'),
        makeStageProgress('c', 'pending'),
      ]);
      const result = canActivateNode(ir, 'c', state);
      expect(result.canActivate).toBe(true);
    });

    it('multi-upstream — one pending → cannot activate', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: false, upstreamStageIds: [] },
          { stageId: 'c', groupId: 'c', autoTrigger: true, upstreamStageIds: ['a', 'b'], triggerOn: 'completed' },
        ],
      });
      const state = makeProjectState([
        makeStageProgress('a', 'completed'),
        makeStageProgress('b', 'pending'),
        makeStageProgress('c', 'pending'),
      ]);
      const result = canActivateNode(ir, 'c', state);
      expect(result.canActivate).toBe(false);
      expect(result.pendingUpstreamIds).toEqual(['b']);
    });

    it('non-existent node → cannot activate', () => {
      const ir = compileTemplate({
        pipeline: [{ stageId: 'a', groupId: 'a', autoTrigger: false }],
      });
      const state = makeProjectState([]);
      const result = canActivateNode(ir, 'nonexistent', state);
      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  // ── getDownstreamNodes ──────────────────────────────────────────────

  describe('getDownstreamNodes', () => {
    it('returns single downstream', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true },
        ],
      });
      const ds = getDownstreamNodes(ir, 'a');
      expect(ds).toHaveLength(1);
      expect(ds[0].id).toBe('b');
    });

    it('returns multiple downstreams (fan-out pattern)', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'root', groupId: 'a', autoTrigger: false },
          { stageId: 'child1', groupId: 'b', autoTrigger: true, upstreamStageIds: ['root'] },
          { stageId: 'child2', groupId: 'c', autoTrigger: true, upstreamStageIds: ['root'] },
        ],
      });
      const ds = getDownstreamNodes(ir, 'root');
      expect(ds).toHaveLength(2);
      expect(ds.map(n => n.id).sort()).toEqual(['child1', 'child2']);
    });

    it('returns empty for terminal node', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true },
        ],
      });
      expect(getDownstreamNodes(ir, 'b')).toHaveLength(0);
    });
  });

  // ── getActivatableNodes ─────────────────────────────────────────────

  describe('getActivatableNodes', () => {
    it('returns only pending nodes that can activate', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true, triggerOn: 'completed' },
          { stageId: 'c', groupId: 'c', autoTrigger: true, triggerOn: 'completed' },
        ],
      });
      const state = makeProjectState([
        makeStageProgress('a', 'completed'),
        makeStageProgress('b', 'pending'),
        makeStageProgress('c', 'pending'),
      ]);
      const activatable = getActivatableNodes(ir, state);
      // Only 'b' can activate (b depends on a which is completed)
      // 'c' depends on 'b' which is pending
      expect(activatable).toHaveLength(1);
      expect(activatable[0].nodeId).toBe('b');
    });

    it('skips running and completed nodes', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true, triggerOn: 'completed' },
        ],
      });
      const state = makeProjectState([
        makeStageProgress('a', 'running'),
        makeStageProgress('b', 'completed'),
      ]);
      const activatable = getActivatableNodes(ir, state);
      expect(activatable).toHaveLength(0);
    });
  });

  // ── filterSourcesByNode ─────────────────────────────────────────────

  describe('filterSourcesByNode', () => {
    it('filters runs by group sourceContract', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'target', groupId: 'filtered-group', autoTrigger: false },
        ],
      });
      const result = filterSourcesByNode(ir, 'target', ['run-approved', 'run-g2']);
      // filtered-group accepts g1 only; run-approved is g1, run-g2 is g2
      expect(result).toEqual(['run-approved']);
    });

    it('returns all when no sourceContract', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'target', groupId: 'a', autoTrigger: false },
        ],
      });
      const result = filterSourcesByNode(ir, 'target', ['run-approved', 'run-g2']);
      expect(result).toEqual(['run-approved', 'run-g2']);
    });

    it('returns empty array as-is', () => {
      const ir = compileTemplate({
        pipeline: [
          { stageId: 'target', groupId: 'a', autoTrigger: false },
        ],
      });
      expect(filterSourcesByNode(ir, 'target', [])).toEqual([]);
    });
  });

  // ── Gate Activation (V5.2) ──────────────────────────────────────────

  describe('gate activation', () => {
    function makeGateIR(): DagIR {
      return {
        templateId: 'test',
        nodes: [
          { id: 'dev', kind: 'stage', groupId: 'a', autoTrigger: true, triggerOn: 'completed' },
          { id: 'gate', kind: 'gate', groupId: 'a', autoTrigger: true, triggerOn: 'completed', gate: { autoApprove: false } },
          { id: 'deploy', kind: 'stage', groupId: 'a', autoTrigger: true, triggerOn: 'completed' },
        ],
        edges: [
          { from: 'dev', to: 'gate' },
          { from: 'gate', to: 'deploy' },
        ],
        entryNodeIds: ['dev'],
        compiledAt: new Date().toISOString(),
        irVersion: 1,
      };
    }

    it('gate: upstream pending → cannot activate', () => {
      const ir = makeGateIR();
      const state = makeProjectState([
        makeStageProgress('dev', 'pending'),
        makeStageProgress('gate', 'pending'),
      ]);
      const result = canActivateNode(ir, 'gate', state);
      expect(result.canActivate).toBe(false);
      expect(result.pendingUpstreamIds).toContain('dev');
    });

    it('gate: upstream completed, no approval → waiting for approval', () => {
      const ir = makeGateIR();
      const state = makeProjectState([
        makeStageProgress('dev', 'completed'),
        makeStageProgress('gate', 'pending'),
      ]);
      const result = canActivateNode(ir, 'gate', state);
      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain('waiting for approval');
    });

    it('gate: upstream completed, approval pending → waiting', () => {
      const ir = makeGateIR();
      const state = makeProjectState([
        makeStageProgress('dev', 'completed'),
        { ...makeStageProgress('gate', 'pending'), gateApproval: { status: 'pending' } },
      ]);
      const result = canActivateNode(ir, 'gate', state);
      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain('waiting for approval');
    });

    it('gate: approved → can activate', () => {
      const ir = makeGateIR();
      const state = makeProjectState([
        makeStageProgress('dev', 'completed'),
        { ...makeStageProgress('gate', 'pending'), gateApproval: { status: 'approved', decidedAt: new Date().toISOString() } },
      ]);
      const result = canActivateNode(ir, 'gate', state);
      expect(result.canActivate).toBe(true);
    });

    it('gate: rejected → cannot activate', () => {
      const ir = makeGateIR();
      const state = makeProjectState([
        makeStageProgress('dev', 'completed'),
        { ...makeStageProgress('gate', 'pending'), gateApproval: { status: 'rejected', reason: 'security concern' } },
      ]);
      const result = canActivateNode(ir, 'gate', state);
      expect(result.canActivate).toBe(false);
      expect(result.reason).toContain('rejected');
    });

    it('gate: autoApprove mode → can activate without approval', () => {
      const ir: DagIR = {
        templateId: 'test',
        nodes: [
          { id: 'dev', kind: 'stage', groupId: 'a', autoTrigger: true, triggerOn: 'completed' },
          { id: 'gate', kind: 'gate', groupId: 'a', autoTrigger: true, triggerOn: 'completed', gate: { autoApprove: true } },
        ],
        edges: [{ from: 'dev', to: 'gate' }],
        entryNodeIds: ['dev'],
        compiledAt: new Date().toISOString(),
        irVersion: 1,
      };
      const state = makeProjectState([
        makeStageProgress('dev', 'completed'),
        makeStageProgress('gate', 'pending'),
      ]);
      const result = canActivateNode(ir, 'gate', state);
      expect(result.canActivate).toBe(true);
    });

    it('downstream of gate: gate not completed → cannot activate', () => {
      const ir = makeGateIR();
      const state = makeProjectState([
        makeStageProgress('dev', 'completed'),
        makeStageProgress('gate', 'pending'),
        makeStageProgress('deploy', 'pending'),
      ]);
      const result = canActivateNode(ir, 'deploy', state);
      expect(result.canActivate).toBe(false);
    });

    it('downstream of gate: gate completed → can activate', () => {
      const ir = makeGateIR();
      const state = makeProjectState([
        makeStageProgress('dev', 'completed'),
        makeStageProgress('gate', 'completed'),
        makeStageProgress('deploy', 'pending'),
      ]);
      const result = canActivateNode(ir, 'deploy', state);
      expect(result.canActivate).toBe(true);
    });

    it('getActivatableNodes excludes gate waiting for approval', () => {
      const ir = makeGateIR();
      const state = makeProjectState([
        makeStageProgress('dev', 'completed'),
        makeStageProgress('gate', 'pending'),
        makeStageProgress('deploy', 'pending'),
      ]);
      const activatable = getActivatableNodes(ir, state);
      expect(activatable).toHaveLength(0);
    });

    it('getActivatableNodes includes approved gate', () => {
      const ir = makeGateIR();
      const state = makeProjectState([
        makeStageProgress('dev', 'completed'),
        { ...makeStageProgress('gate', 'pending'), gateApproval: { status: 'approved', decidedAt: new Date().toISOString() } },
        makeStageProgress('deploy', 'pending'),
      ]);
      const activatable = getActivatableNodes(ir, state);
      expect(activatable).toHaveLength(1);
      expect(activatable[0].nodeId).toBe('gate');
    });
  });

  // ── Switch Evaluation (V5.2) ────────────────────────────────────────

  describe('switch evaluation', () => {
    function makeSwitchNode(): DagNode {
      return {
        id: 'router',
        kind: 'switch',
        groupId: 'router',
        autoTrigger: true,
        triggerOn: 'completed',
        switch: {
          branches: [
            {
              label: 'simple',
              condition: { type: 'field-match', field: 'analysis.complexity', value: 'low' },
              targetNodeId: 'quick-dev',
            },
            {
              label: 'complex',
              condition: { type: 'field-compare', field: 'analysis.storyPoints', operator: 'gt', value: 20 },
              targetNodeId: 'full-dev',
            },
          ],
          defaultTargetNodeId: 'quick-dev',
        },
      };
    }

    it('selects first matching branch', () => {
      const result = evaluateSwitch(makeSwitchNode(), {
        upstreamOutputs: { analysis: { complexity: 'low', storyPoints: 5 } },
      });
      expect(result.selectedBranch).toBe('simple');
      expect(result.activateNodeId).toBe('quick-dev');
    });

    it('selects second branch when first does not match', () => {
      const result = evaluateSwitch(makeSwitchNode(), {
        upstreamOutputs: { analysis: { complexity: 'high', storyPoints: 30 } },
      });
      expect(result.selectedBranch).toBe('complex');
      expect(result.activateNodeId).toBe('full-dev');
    });

    it('falls back to default when no branch matches', () => {
      const result = evaluateSwitch(makeSwitchNode(), {
        upstreamOutputs: { analysis: { complexity: 'medium', storyPoints: 10 } },
      });
      expect(result.selectedBranch).toBe('default');
      expect(result.activateNodeId).toBe('quick-dev');
    });

    it('throws when no match and no default', () => {
      const node: DagNode = {
        id: 'router',
        kind: 'switch',
        groupId: 'router',
        autoTrigger: true,
        triggerOn: 'completed',
        switch: {
          branches: [
            { label: 'only', condition: { type: 'field-match', field: 'x', value: 'y' }, targetNodeId: 'target' },
          ],
          // no defaultTargetNodeId
        },
      };
      expect(() =>
        evaluateSwitch(node, { upstreamOutputs: { x: 'z' } }),
      ).toThrow(/no condition matched/);
    });

    it('throws when called on non-switch node', () => {
      const node: DagNode = {
        id: 'stage',
        kind: 'stage',
        groupId: 'g',
        autoTrigger: true,
        triggerOn: 'completed',
      };
      expect(() =>
        evaluateSwitch(node, { upstreamOutputs: {} }),
      ).toThrow(/non-switch/);
    });

    it('includes evaluation explanation in result', () => {
      const result = evaluateSwitch(makeSwitchNode(), {
        upstreamOutputs: { analysis: { complexity: 'low' } },
      });
      expect(result.explanation).toContain('simple');
    });
  });

  // ── Loop Evaluation (V5.2) ──────────────────────────────────────────

  describe('loop evaluation', () => {
    function makeLoopEndNode(overrides: Partial<DagNode['loop']> = {}): DagNode {
      return {
        id: 'loop-end-1',
        kind: 'loop-end',
        groupId: 'loop-end-1',
        autoTrigger: true,
        triggerOn: 'completed',
        loop: {
          maxIterations: 5,
          terminationCondition: { type: 'field-match', field: 'result.status', value: 'pass' },
          pairedNodeId: 'loop-start-1',
          checkpointPerIteration: false,
          ...overrides,
        },
      };
    }

    it('terminates when condition is met', () => {
      const result = evaluateLoopEnd(makeLoopEndNode(), {
        upstreamOutputs: { result: { status: 'pass' } },
      }, 2);
      expect(result.action).toBe('terminate');
      expect(result.reason).toBe('condition-met');
      expect(result.iteration).toBe(2);
      expect(result.explanation).toContain('Termination condition met');
    });

    it('continues when condition not met and under limit', () => {
      const result = evaluateLoopEnd(makeLoopEndNode(), {
        upstreamOutputs: { result: { status: 'fail' } },
      }, 2);
      expect(result.action).toBe('continue');
      expect(result.reason).toBe('condition-not-met');
      expect(result.iteration).toBe(3); // incremented
      expect(result.explanation).toContain('continuing');
    });

    it('force terminates at max iterations', () => {
      const result = evaluateLoopEnd(makeLoopEndNode(), {
        upstreamOutputs: { result: { status: 'fail' } },
      }, 5);
      expect(result.action).toBe('terminate');
      expect(result.reason).toBe('max-iterations-reached');
      expect(result.iteration).toBe(5);
      expect(result.explanation).toContain('Max iterations');
    });

    it('terminates on first iteration when condition already met', () => {
      const result = evaluateLoopEnd(makeLoopEndNode(), {
        upstreamOutputs: { result: { status: 'pass' } },
      }, 1);
      expect(result.action).toBe('terminate');
      expect(result.reason).toBe('condition-met');
      expect(result.iteration).toBe(1);
    });

    it('continues on iteration just below max', () => {
      const result = evaluateLoopEnd(makeLoopEndNode(), {
        upstreamOutputs: { result: { status: 'fail' } },
      }, 4);
      expect(result.action).toBe('continue');
      expect(result.iteration).toBe(5);
    });

    it('uses always condition to terminate immediately', () => {
      const node = makeLoopEndNode({ terminationCondition: { type: 'always' } });
      const result = evaluateLoopEnd(node, { upstreamOutputs: {} }, 1);
      expect(result.action).toBe('terminate');
      expect(result.reason).toBe('condition-met');
    });

    it('throws when called on non-loop-end node', () => {
      const node: DagNode = {
        id: 'stage',
        kind: 'stage',
        groupId: 'g',
        autoTrigger: true,
        triggerOn: 'completed',
      };
      expect(() => evaluateLoopEnd(node, { upstreamOutputs: {} }, 1)).toThrow(/non-loop-end/);
    });

    it('uses field-compare condition for type-aware termination', () => {
      const node = makeLoopEndNode({
        terminationCondition: { type: 'field-compare', field: 'metrics.score', operator: 'gte', value: 90 },
      });
      // Score below threshold → continue
      const r1 = evaluateLoopEnd(node, { upstreamOutputs: { metrics: { score: 85 } } }, 1);
      expect(r1.action).toBe('continue');

      // Score at threshold → terminate
      const r2 = evaluateLoopEnd(node, { upstreamOutputs: { metrics: { score: 90 } } }, 2);
      expect(r2.action).toBe('terminate');
      expect(r2.reason).toBe('condition-met');
    });

    it('single-iteration loop (maxIterations=1) terminates if no match', () => {
      const node = makeLoopEndNode({ maxIterations: 1 });
      const result = evaluateLoopEnd(node, {
        upstreamOutputs: { result: { status: 'fail' } },
      }, 1);
      expect(result.action).toBe('terminate');
      expect(result.reason).toBe('max-iterations-reached');
    });
  });
});
