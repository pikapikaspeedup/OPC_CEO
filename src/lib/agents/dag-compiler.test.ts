import { describe, expect, it, beforeEach } from 'vitest';
import { compilePipelineToIR, clearIRCache, getOrCompileIR } from './dag-compiler';
import type { TemplateDefinition } from './pipeline-types';

const baseGroup = { title: 'G', description: 'g', executionMode: 'review-loop' as const, roles: [] };

function makeTemplate(overrides: Partial<TemplateDefinition> = {}): TemplateDefinition {
  return {
    id: 'test-template',
    kind: 'template',
    title: 'Test',
    description: 'test',
    groups: { a: baseGroup, b: baseGroup, c: baseGroup, d: baseGroup },
    pipeline: [],
    ...overrides,
  };
}

describe('compilePipelineToIR', () => {
  beforeEach(() => {
    clearIRCache();
  });

  // ── Linear pipeline ───────────────────────────────────────────────────

  describe('linear pipeline', () => {
    it('compiles a 3-stage linear pipeline correctly', () => {
      const t = makeTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true },
          { stageId: 'c', groupId: 'c', autoTrigger: true, triggerOn: 'completed' },
        ],
      });

      const ir = compilePipelineToIR(t);

      expect(ir.templateId).toBe('test-template');
      expect(ir.irVersion).toBe(1);
      expect(ir.nodes).toHaveLength(3);
      expect(ir.edges).toHaveLength(2);
      expect(ir.entryNodeIds).toEqual(['a']);

      // Nodes
      expect(ir.nodes[0]).toMatchObject({ id: 'a', kind: 'stage', groupId: 'a', autoTrigger: false, sourceIndex: 0 });
      expect(ir.nodes[1]).toMatchObject({ id: 'b', kind: 'stage', groupId: 'b', autoTrigger: true, sourceIndex: 1 });
      expect(ir.nodes[2]).toMatchObject({ id: 'c', kind: 'stage', triggerOn: 'completed', sourceIndex: 2 });

      // Edges (implicit linear)
      expect(ir.edges[0]).toMatchObject({ from: 'a', to: 'b' });
      expect(ir.edges[1]).toMatchObject({ from: 'b', to: 'c' });
    });

    it('uses groupId as stageId when no explicit stageId', () => {
      const t = makeTemplate({
        pipeline: [
          { groupId: 'a', autoTrigger: false },
          { groupId: 'b', autoTrigger: true },
        ],
      });

      const ir = compilePipelineToIR(t);
      expect(ir.nodes[0].id).toBe('a');
      expect(ir.nodes[1].id).toBe('b');
    });
  });

  // ── Multi-upstream DAG ────────────────────────────────────────────────

  describe('multi-upstream DAG', () => {
    it('compiles explicit upstreamStageIds into edges', () => {
      const t = makeTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: false, upstreamStageIds: [] },
          { stageId: 'c', groupId: 'c', autoTrigger: true, upstreamStageIds: ['a', 'b'] },
        ],
      });

      const ir = compilePipelineToIR(t);

      expect(ir.entryNodeIds).toEqual(['a', 'b']);
      expect(ir.edges).toHaveLength(2);
      expect(ir.edges).toContainEqual({ from: 'a', to: 'c' });
      expect(ir.edges).toContainEqual({ from: 'b', to: 'c' });
    });

    it('identifies multiple entry nodes', () => {
      const t = makeTemplate({
        pipeline: [
          { stageId: 'x', groupId: 'a', autoTrigger: false },
          { stageId: 'y', groupId: 'b', autoTrigger: false, upstreamStageIds: [] },
          { stageId: 'z', groupId: 'c', autoTrigger: true, upstreamStageIds: ['x'] },
        ],
      });

      const ir = compilePipelineToIR(t);
      expect(ir.entryNodeIds).toEqual(['x', 'y']);
    });

    it('implicit linear edge when no upstreamStageIds', () => {
      const t = makeTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: false },
          { stageId: 'c', groupId: 'c', autoTrigger: true, upstreamStageIds: ['a', 'b'] },
        ],
      });

      const ir = compilePipelineToIR(t);
      // b has no upstreamStageIds → implicit edge from a → b
      expect(ir.entryNodeIds).toEqual(['a']);
      expect(ir.edges).toHaveLength(3); // a→b (implicit), a→c, b→c
      expect(ir.edges).toContainEqual({ from: 'a', to: 'b' });
    });
  });

  // ── Fan-out / Join ────────────────────────────────────────────────────

  describe('fan-out / join pipeline', () => {
    it('compiles fan-out and join nodes with correct kind and config', () => {
      const t = makeTemplate({
        pipeline: [
          { stageId: 'planning', groupId: 'a', autoTrigger: false },
          {
            stageId: 'exec',
            groupId: 'b',
            autoTrigger: true,
            stageType: 'fan-out',
            upstreamStageIds: ['planning'],
            fanOutSource: { workPackagesPath: 'wp.json', perBranchTemplateId: 'branch-tmpl' },
          },
          {
            stageId: 'merge',
            groupId: 'c',
            autoTrigger: true,
            stageType: 'join',
            upstreamStageIds: ['exec'],
            joinFrom: 'exec',
            joinPolicy: 'all',
          },
        ],
      });

      const ir = compilePipelineToIR(t);

      // Fan-out node
      const fanOut = ir.nodes.find(n => n.id === 'exec')!;
      expect(fanOut.kind).toBe('fan-out');
      expect(fanOut.fanOut).toEqual({
        workPackagesPath: 'wp.json',
        perBranchTemplateId: 'branch-tmpl',
        contract: undefined,
      });

      // Join node
      const join = ir.nodes.find(n => n.id === 'merge')!;
      expect(join.kind).toBe('join');
      expect(join.join).toEqual({
        sourceNodeId: 'exec',
        policy: 'all',
        contract: undefined,
      });

      // Edges
      expect(ir.edges).toContainEqual({ from: 'planning', to: 'exec' });
      expect(ir.edges).toContainEqual({ from: 'exec', to: 'merge' });
    });

    it('carries maxConcurrency from fanOutSource into IR node', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'exec',
            groupId: 'a',
            autoTrigger: false,
            stageType: 'fan-out',
            fanOutSource: { workPackagesPath: 'wp.json', perBranchTemplateId: 'tmpl', maxConcurrency: 5 },
          },
        ],
      });

      const ir = compilePipelineToIR(t);
      expect(ir.nodes[0].fanOut?.maxConcurrency).toBe(5);
    });

    it('maxConcurrency defaults to undefined when not specified', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'exec',
            groupId: 'a',
            autoTrigger: false,
            stageType: 'fan-out',
            fanOutSource: { workPackagesPath: 'wp.json', perBranchTemplateId: 'tmpl' },
          },
        ],
      });

      const ir = compilePipelineToIR(t);
      expect(ir.nodes[0].fanOut?.maxConcurrency).toBeUndefined();
    });
  });

  // ── Contract propagation ──────────────────────────────────────────────

  describe('contract propagation', () => {
    it('carries V4.4 contracts into IR nodes', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            contract: {
              outputContract: [
                { id: 'plan', kind: 'report', pathPattern: 'docs/plan.md', format: 'md' },
              ],
            },
          },
          {
            stageId: 'b',
            groupId: 'b',
            autoTrigger: true,
            upstreamStageIds: ['a'],
            contract: {
              inputContract: [
                { id: 'plan', kind: 'report', format: 'md' },
              ],
            },
          },
        ],
      });

      const ir = compilePipelineToIR(t);

      expect(ir.nodes[0].contract?.outputContract).toHaveLength(1);
      expect(ir.nodes[0].contract?.outputContract?.[0].id).toBe('plan');
      expect(ir.nodes[1].contract?.inputContract).toHaveLength(1);
    });

    it('carries fanOutContract into fan-out node', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'exec',
            groupId: 'a',
            autoTrigger: false,
            stageType: 'fan-out',
            fanOutSource: { workPackagesPath: 'wp.json', perBranchTemplateId: 'tmpl' },
            fanOutContract: {
              branchInputContract: [{ id: 'wp', kind: 'data' }],
            },
          },
        ],
      });

      const ir = compilePipelineToIR(t);
      expect(ir.nodes[0].fanOut?.contract?.branchInputContract).toHaveLength(1);
    });

    it('carries joinMergeContract into join node', () => {
      const t = makeTemplate({
        pipeline: [
          { stageId: 'fanout', groupId: 'a', autoTrigger: false, stageType: 'fan-out',
            fanOutSource: { workPackagesPath: 'wp.json', perBranchTemplateId: 'tmpl' } },
          {
            stageId: 'join-stage',
            groupId: 'b',
            autoTrigger: true,
            stageType: 'join',
            upstreamStageIds: ['fanout'],
            joinFrom: 'fanout',
            joinMergeContract: {
              mergedOutputContract: [
                { id: 'merged', kind: 'report', pathPattern: 'merged.md' },
              ],
              mergeStrategy: 'concat',
            },
          },
        ],
      });

      const ir = compilePipelineToIR(t);
      const joinNode = ir.nodes.find(n => n.id === 'join-stage')!;
      expect(joinNode.join?.contract?.mergedOutputContract).toHaveLength(1);
      expect(joinNode.join?.contract?.mergeStrategy).toBe('concat');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty pipeline', () => {
      const t = makeTemplate({ pipeline: [] });
      const ir = compilePipelineToIR(t);
      expect(ir.nodes).toHaveLength(0);
      expect(ir.edges).toHaveLength(0);
      expect(ir.entryNodeIds).toHaveLength(0);
    });

    it('handles single-stage pipeline', () => {
      const t = makeTemplate({
        pipeline: [{ stageId: 'only', groupId: 'a', autoTrigger: false }],
      });
      const ir = compilePipelineToIR(t);
      expect(ir.nodes).toHaveLength(1);
      expect(ir.edges).toHaveLength(0);
      expect(ir.entryNodeIds).toEqual(['only']);
    });

    it('throws on invalid template (cycle)', () => {
      const t = makeTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false, upstreamStageIds: ['b'] },
          { stageId: 'b', groupId: 'b', autoTrigger: true, upstreamStageIds: ['a'] },
        ],
      });

      expect(() => compilePipelineToIR(t)).toThrow('Cannot compile');
    });

    it('throws on invalid template (missing upstream)', () => {
      const t = makeTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false, upstreamStageIds: ['nonexistent'] },
        ],
      });

      expect(() => compilePipelineToIR(t)).toThrow('Cannot compile');
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('produces structurally identical IR on repeated compilation (ignoring compiledAt)', () => {
      const t = makeTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true },
        ],
      });

      const ir1 = compilePipelineToIR(t);
      const ir2 = compilePipelineToIR(t);

      expect(ir1.nodes).toEqual(ir2.nodes);
      expect(ir1.edges).toEqual(ir2.edges);
      expect(ir1.entryNodeIds).toEqual(ir2.entryNodeIds);
      expect(ir1.templateId).toEqual(ir2.templateId);
      expect(ir1.irVersion).toEqual(ir2.irVersion);
    });
  });

  // ── Cache ─────────────────────────────────────────────────────────────

  describe('IR cache', () => {
    it('getOrCompileIR returns cached IR on second call', () => {
      const t = makeTemplate({
        pipeline: [{ stageId: 'a', groupId: 'a', autoTrigger: false }],
      });

      const ir1 = getOrCompileIR(t);
      const ir2 = getOrCompileIR(t);
      expect(ir1).toBe(ir2); // same reference
    });

    it('clearIRCache forces recompilation', () => {
      const t = makeTemplate({
        pipeline: [{ stageId: 'a', groupId: 'a', autoTrigger: false }],
      });

      const ir1 = getOrCompileIR(t);
      clearIRCache();
      const ir2 = getOrCompileIR(t);
      expect(ir1).not.toBe(ir2); // different reference
      expect(ir1.nodes).toEqual(ir2.nodes); // but same content
    });
  });
});
