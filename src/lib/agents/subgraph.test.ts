/**
 * Tests for V5.4 Subgraph Expansion
 * - SubgraphDefinition types
 * - Validation of subgraph-ref nodes
 * - Compile-time expansion of subgraph-ref nodes into DagIR
 */

import { describe, it, expect } from 'vitest';
import { validateGraphPipeline, compileGraphPipelineToIR } from './graph-compiler';
import type { GraphPipeline } from './graph-pipeline-types';
import type { SubgraphDefinition } from './subgraph-types';

// ── Test Helpers ────────────────────────────────────────────────────────────

function makeSubgraph(overrides?: Partial<SubgraphDefinition>): SubgraphDefinition {
  return {
    id: 'code-review-sg',
    kind: 'subgraph',
    title: 'Code Review Subgraph',
    graphPipeline: {
      nodes: [
        { id: 'review', kind: 'stage', groupId: 'code-review' },
        { id: 'fix', kind: 'stage', groupId: 'code-fix' },
      ],
      edges: [
        { from: 'review', to: 'fix' },
      ],
    },
    inputs: [{ id: 'in', nodeId: 'review' }],
    outputs: [{ id: 'out', nodeId: 'fix' }],
    ...overrides,
  };
}

function makeSubgraphResolver(subgraphs: SubgraphDefinition[]) {
  const map = new Map(subgraphs.map(s => [s.id, s]));
  return (id: string) => map.get(id) ?? null;
}

// ── Validation Tests ────────────────────────────────────────────────────────

describe('subgraph-ref validation', () => {
  it('accepts valid subgraph-ref node', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'start', kind: 'stage', groupId: 'init' },
        { id: 'review', kind: 'subgraph-ref', groupId: 'placeholder', subgraphRef: { subgraphId: 'code-review-sg' } },
        { id: 'deploy', kind: 'stage', groupId: 'deploy' },
      ],
      edges: [
        { from: 'start', to: 'review' },
        { from: 'review', to: 'deploy' },
      ],
    };
    const errors = validateGraphPipeline(graph);
    expect(errors).toEqual([]);
  });

  it('rejects subgraph-ref without subgraphRef config', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'ref', kind: 'subgraph-ref', groupId: 'placeholder' },
      ],
      edges: [],
    };
    const errors = validateGraphPipeline(graph);
    expect(errors).toContain("Subgraph-ref node 'ref' must have subgraphRef configuration");
  });

  it('rejects non-subgraph-ref node with subgraphRef config', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'bad', kind: 'stage', groupId: 'foo', subgraphRef: { subgraphId: 'x' } },
      ],
      edges: [],
    };
    const errors = validateGraphPipeline(graph);
    expect(errors).toContain("Node 'bad' has subgraphRef configuration but kind is 'stage'");
  });
});

// ── Expansion Tests ─────────────────────────────────────────────────────────

describe('subgraph expansion', () => {
  it('expands a simple subgraph-ref into prefixed nodes', () => {
    const sg = makeSubgraph();
    const graph: GraphPipeline = {
      nodes: [
        { id: 'start', kind: 'stage', groupId: 'init' },
        { id: 'review', kind: 'subgraph-ref', groupId: 'placeholder', subgraphRef: { subgraphId: 'code-review-sg' } },
        { id: 'deploy', kind: 'stage', groupId: 'deploy' },
      ],
      edges: [
        { from: 'start', to: 'review' },
        { from: 'review', to: 'deploy' },
      ],
    };

    const ir = compileGraphPipelineToIR('test', graph, makeSubgraphResolver([sg]));

    // Should have 4 nodes: start, review.review, review.fix, deploy
    expect(ir.nodes).toHaveLength(4);
    expect(ir.nodes.map(n => n.id).sort()).toEqual([
      'deploy', 'review.fix', 'review.review', 'start',
    ]);

    // Entry node should be 'start'
    expect(ir.entryNodeIds).toEqual(['start']);
  });

  it('rewires edges through expanded subgraph', () => {
    const sg = makeSubgraph();
    const graph: GraphPipeline = {
      nodes: [
        { id: 'start', kind: 'stage', groupId: 'init' },
        { id: 'review', kind: 'subgraph-ref', groupId: 'placeholder', subgraphRef: { subgraphId: 'code-review-sg' } },
        { id: 'deploy', kind: 'stage', groupId: 'deploy' },
      ],
      edges: [
        { from: 'start', to: 'review' },
        { from: 'review', to: 'deploy' },
      ],
    };

    const ir = compileGraphPipelineToIR('test', graph, makeSubgraphResolver([sg]));

    // Edges:
    // start → review.review (entry of subgraph)
    // review.review → review.fix (internal subgraph edge)
    // review.fix → deploy (exit of subgraph → deploy)
    const edgePairs = ir.edges.map(e => `${e.from} → ${e.to}`);
    expect(edgePairs).toContain('start → review.review');
    expect(edgePairs).toContain('review.review → review.fix');
    expect(edgePairs).toContain('review.fix → deploy');
    expect(edgePairs).toHaveLength(3);
  });

  it('throws when subgraph is not found', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'ref', kind: 'subgraph-ref', groupId: 'placeholder', subgraphRef: { subgraphId: 'missing' } },
      ],
      edges: [],
    };

    expect(() => compileGraphPipelineToIR('test', graph, () => null))
      .toThrow("Subgraph 'missing' not found");
  });

  it('prefixes loop pairedNodeId inside expanded subgraph', () => {
    const loopSg: SubgraphDefinition = {
      id: 'loop-sg',
      kind: 'subgraph',
      title: 'Loop Subgraph',
      graphPipeline: {
        nodes: [
          {
            id: 'ls', kind: 'loop-start', groupId: 'loop-ctrl',
            loop: {
              maxIterations: 3,
              terminationCondition: { type: 'always' },
              pairedNodeId: 'le',
            },
          },
          { id: 'body', kind: 'stage', groupId: 'work' },
          {
            id: 'le', kind: 'loop-end', groupId: 'loop-ctrl',
            loop: {
              maxIterations: 3,
              terminationCondition: { type: 'always' },
              pairedNodeId: 'ls',
            },
          },
        ],
        edges: [
          { from: 'ls', to: 'body' },
          { from: 'body', to: 'le' },
        ],
      },
      inputs: [{ id: 'in', nodeId: 'ls' }],
      outputs: [{ id: 'out', nodeId: 'le' }],
    };

    const graph: GraphPipeline = {
      nodes: [
        { id: 'myloop', kind: 'subgraph-ref', groupId: 'placeholder', subgraphRef: { subgraphId: 'loop-sg' } },
      ],
      edges: [],
    };

    const ir = compileGraphPipelineToIR('test', graph, makeSubgraphResolver([loopSg]));

    const ls = ir.nodes.find(n => n.id === 'myloop.ls')!;
    const le = ir.nodes.find(n => n.id === 'myloop.le')!;
    expect(ls.loop!.pairedNodeId).toBe('myloop.le');
    expect(le.loop!.pairedNodeId).toBe('myloop.ls');
  });

  it('prefixes switch targetNodeId inside expanded subgraph', () => {
    const switchSg: SubgraphDefinition = {
      id: 'switch-sg',
      kind: 'subgraph',
      title: 'Switch Subgraph',
      graphPipeline: {
        nodes: [
          {
            id: 'sw', kind: 'switch', groupId: 'router',
            switch: {
              branches: [
                { label: 'A', condition: { type: 'always' }, targetNodeId: 'a' },
              ],
              defaultTargetNodeId: 'b',
            },
          },
          { id: 'a', kind: 'stage', groupId: 'path-a' },
          { id: 'b', kind: 'stage', groupId: 'path-b' },
        ],
        edges: [
          { from: 'sw', to: 'a' },
          { from: 'sw', to: 'b' },
        ],
      },
      inputs: [{ id: 'in', nodeId: 'sw' }],
      outputs: [{ id: 'out-a', nodeId: 'a' }, { id: 'out-b', nodeId: 'b' }],
    };

    const graph: GraphPipeline = {
      nodes: [
        { id: 'mysw', kind: 'subgraph-ref', groupId: 'placeholder', subgraphRef: { subgraphId: 'switch-sg' } },
      ],
      edges: [],
    };

    const ir = compileGraphPipelineToIR('test', graph, makeSubgraphResolver([switchSg]));

    const sw = ir.nodes.find(n => n.id === 'mysw.sw')!;
    expect(sw.switch!.branches[0].targetNodeId).toBe('mysw.a');
    expect(sw.switch!.defaultTargetNodeId).toBe('mysw.b');
  });

  it('prefixes join sourceNodeId inside expanded subgraph', () => {
    const fanOutSg: SubgraphDefinition = {
      id: 'fanout-sg',
      kind: 'subgraph',
      title: 'FanOut Subgraph',
      graphPipeline: {
        nodes: [
          {
            id: 'fo', kind: 'fan-out', groupId: 'splitter',
            fanOut: { workPackagesPath: 'items', perBranchTemplateId: 'branch-t' },
          },
          {
            id: 'jo', kind: 'join', groupId: 'merger',
            join: { sourceNodeId: 'fo' },
          },
        ],
        edges: [
          { from: 'fo', to: 'jo' },
        ],
      },
      inputs: [{ id: 'in', nodeId: 'fo' }],
      outputs: [{ id: 'out', nodeId: 'jo' }],
    };

    const graph: GraphPipeline = {
      nodes: [
        { id: 'myfo', kind: 'subgraph-ref', groupId: 'placeholder', subgraphRef: { subgraphId: 'fanout-sg' } },
      ],
      edges: [],
    };

    const ir = compileGraphPipelineToIR('test', graph, makeSubgraphResolver([fanOutSg]));

    const jo = ir.nodes.find(n => n.id === 'myfo.jo')!;
    expect(jo.join!.sourceNodeId).toBe('myfo.fo');
  });

  it('handles multiple subgraph-refs in one graph', () => {
    const sg1: SubgraphDefinition = {
      id: 'sg-a',
      kind: 'subgraph',
      title: 'Subgraph A',
      graphPipeline: {
        nodes: [{ id: 'step', kind: 'stage', groupId: 'work-a' }],
        edges: [],
      },
      inputs: [{ id: 'in', nodeId: 'step' }],
      outputs: [{ id: 'out', nodeId: 'step' }],
    };

    const sg2: SubgraphDefinition = {
      id: 'sg-b',
      kind: 'subgraph',
      title: 'Subgraph B',
      graphPipeline: {
        nodes: [{ id: 'step', kind: 'stage', groupId: 'work-b' }],
        edges: [],
      },
      inputs: [{ id: 'in', nodeId: 'step' }],
      outputs: [{ id: 'out', nodeId: 'step' }],
    };

    const graph: GraphPipeline = {
      nodes: [
        { id: 'ref-a', kind: 'subgraph-ref', groupId: 'placeholder', subgraphRef: { subgraphId: 'sg-a' } },
        { id: 'ref-b', kind: 'subgraph-ref', groupId: 'placeholder', subgraphRef: { subgraphId: 'sg-b' } },
      ],
      edges: [
        { from: 'ref-a', to: 'ref-b' },
      ],
    };

    const ir = compileGraphPipelineToIR('test', graph, makeSubgraphResolver([sg1, sg2]));

    // Both subgraphs have a 'step' node, but prefixed differently
    expect(ir.nodes.map(n => n.id).sort()).toEqual(['ref-a.step', 'ref-b.step']);
    // Edge should connect exit of ref-a to entry of ref-b
    expect(ir.edges).toContainEqual(expect.objectContaining({ from: 'ref-a.step', to: 'ref-b.step' }));
  });

  it('compiles without resolver — subgraph-ref nodes pass through', () => {
    // When no resolver is provided, subgraph-ref nodes stay as-is in the IR
    const graph: GraphPipeline = {
      nodes: [
        { id: 'start', kind: 'stage', groupId: 'init' },
        { id: 'ref', kind: 'subgraph-ref', groupId: 'placeholder', subgraphRef: { subgraphId: 'unknown' } },
      ],
      edges: [
        { from: 'start', to: 'ref' },
      ],
    };

    const ir = compileGraphPipelineToIR('test', graph);
    expect(ir.nodes).toHaveLength(2);
    expect(ir.nodes.find(n => n.id === 'ref')!.kind).toBe('subgraph-ref');
  });

  it('handles subgraph with multi-entry and multi-exit nodes', () => {
    const multiSg: SubgraphDefinition = {
      id: 'multi-sg',
      kind: 'subgraph',
      title: 'Multi-entry/exit',
      graphPipeline: {
        nodes: [
          { id: 'a', kind: 'stage', groupId: 'work-a' },
          { id: 'b', kind: 'stage', groupId: 'work-b' },
        ],
        edges: [],  // No internal edges → both are entry AND exit
      },
      inputs: [{ id: 'in-a', nodeId: 'a' }, { id: 'in-b', nodeId: 'b' }],
      outputs: [{ id: 'out-a', nodeId: 'a' }, { id: 'out-b', nodeId: 'b' }],
    };

    const graph: GraphPipeline = {
      nodes: [
        { id: 'pre', kind: 'stage', groupId: 'pre' },
        { id: 'multi', kind: 'subgraph-ref', groupId: 'placeholder', subgraphRef: { subgraphId: 'multi-sg' } },
        { id: 'post', kind: 'stage', groupId: 'post' },
      ],
      edges: [
        { from: 'pre', to: 'multi' },
        { from: 'multi', to: 'post' },
      ],
    };

    const ir = compileGraphPipelineToIR('test', graph, makeSubgraphResolver([multiSg]));

    // pre → multi.a, pre → multi.b (fan to both entries)
    // multi.a → post, multi.b → post (both exits to post)
    expect(ir.edges).toHaveLength(4);
    const edgePairs = ir.edges.map(e => `${e.from} → ${e.to}`).sort();
    expect(edgePairs).toEqual([
      'multi.a → post',
      'multi.b → post',
      'pre → multi.a',
      'pre → multi.b',
    ]);
  });
});
