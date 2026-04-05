import { describe, expect, it } from 'vitest';
import { validateGraphPipeline, compileGraphPipelineToIR } from './graph-compiler';
import { compilePipelineToIR } from './dag-compiler';
import type { GraphPipeline } from './graph-pipeline-types';
import type { TemplateDefinition } from './pipeline-types';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeLinearGraph(): GraphPipeline {
  return {
    nodes: [
      { id: 'spec', kind: 'stage', groupId: 'planning' },
      { id: 'dev', kind: 'stage', groupId: 'development' },
      { id: 'review', kind: 'stage', groupId: 'review' },
    ],
    edges: [
      { from: 'spec', to: 'dev' },
      { from: 'dev', to: 'review' },
    ],
  };
}

function makeDiamondGraph(): GraphPipeline {
  return {
    nodes: [
      { id: 'design', kind: 'stage', groupId: 'design' },
      { id: 'frontend', kind: 'stage', groupId: 'frontend-dev' },
      { id: 'backend', kind: 'stage', groupId: 'backend-dev' },
      { id: 'integration', kind: 'stage', groupId: 'integration', triggerOn: 'completed' },
    ],
    edges: [
      { from: 'design', to: 'frontend' },
      { from: 'design', to: 'backend' },
      { from: 'frontend', to: 'integration' },
      { from: 'backend', to: 'integration' },
    ],
  };
}

function makeFanOutJoinGraph(): GraphPipeline {
  return {
    nodes: [
      { id: 'planning', kind: 'stage', groupId: 'project-planning' },
      {
        id: 'wp-fanout',
        kind: 'fan-out',
        groupId: 'wp-orchestrator',
        fanOut: { workPackagesPath: 'docs/wp.json', perBranchTemplateId: 'wp-dev' },
      },
      {
        id: 'wp-join',
        kind: 'join',
        groupId: 'convergence',
        join: { sourceNodeId: 'wp-fanout', policy: 'all' },
      },
      { id: 'final', kind: 'stage', groupId: 'integration' },
    ],
    edges: [
      { from: 'planning', to: 'wp-fanout' },
      { from: 'wp-fanout', to: 'wp-join' },
      { from: 'wp-join', to: 'final' },
    ],
  };
}

// ── Validation Tests ────────────────────────────────────────────────────────

describe('validateGraphPipeline', () => {
  it('accepts valid linear graph', () => {
    expect(validateGraphPipeline(makeLinearGraph())).toEqual([]);
  });

  it('accepts valid diamond graph', () => {
    expect(validateGraphPipeline(makeDiamondGraph())).toEqual([]);
  });

  it('accepts valid fan-out/join graph', () => {
    expect(validateGraphPipeline(makeFanOutJoinGraph())).toEqual([]);
  });

  it('rejects empty nodes', () => {
    const errors = validateGraphPipeline({ nodes: [], edges: [] });
    expect(errors).toContainEqual(expect.stringContaining('at least one node'));
  });

  it('rejects duplicate node IDs', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'a', kind: 'stage', groupId: 'g1' },
        { id: 'a', kind: 'stage', groupId: 'g2' },
      ],
      edges: [],
    };
    expect(validateGraphPipeline(graph)).toContainEqual(expect.stringContaining("Duplicate node id: 'a'"));
  });

  it('rejects edge referencing unknown nodes', () => {
    const graph: GraphPipeline = {
      nodes: [{ id: 'a', kind: 'stage', groupId: 'g1' }],
      edges: [{ from: 'a', to: 'nonexistent' }],
    };
    expect(validateGraphPipeline(graph)).toContainEqual(expect.stringContaining("unknown target node: 'nonexistent'"));
  });

  it('rejects self-loops', () => {
    const graph: GraphPipeline = {
      nodes: [{ id: 'a', kind: 'stage', groupId: 'g1' }],
      edges: [{ from: 'a', to: 'a' }],
    };
    expect(validateGraphPipeline(graph)).toContainEqual(expect.stringContaining("Self-loop"));
  });

  it('rejects fan-out node without fanOut config', () => {
    const graph: GraphPipeline = {
      nodes: [{ id: 'a', kind: 'fan-out', groupId: 'g1' }],
      edges: [],
    };
    expect(validateGraphPipeline(graph)).toContainEqual(expect.stringContaining("must have fanOut configuration"));
  });

  it('rejects join node without join config', () => {
    const graph: GraphPipeline = {
      nodes: [{ id: 'a', kind: 'join', groupId: 'g1' }],
      edges: [],
    };
    expect(validateGraphPipeline(graph)).toContainEqual(expect.stringContaining("must have join configuration"));
  });

  it('rejects kind mismatch: stage with fanOut config', () => {
    const graph: GraphPipeline = {
      nodes: [{
        id: 'a',
        kind: 'stage',
        groupId: 'g1',
        fanOut: { workPackagesPath: 'x', perBranchTemplateId: 'y' },
      }],
      edges: [],
    };
    expect(validateGraphPipeline(graph)).toContainEqual(expect.stringContaining("has fanOut configuration but kind is 'stage'"));
  });

  it('rejects join sourceNodeId pointing to non-fan-out node', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'a', kind: 'stage', groupId: 'g1' },
        { id: 'b', kind: 'join', groupId: 'g2', join: { sourceNodeId: 'a' } },
      ],
      edges: [{ from: 'a', to: 'b' }],
    };
    expect(validateGraphPipeline(graph)).toContainEqual(expect.stringContaining("must be a fan-out node"));
  });

  it('detects cycles', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'a', kind: 'stage', groupId: 'g1' },
        { id: 'b', kind: 'stage', groupId: 'g2' },
        { id: 'c', kind: 'stage', groupId: 'g3' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ],
    };
    expect(validateGraphPipeline(graph)).toContainEqual(expect.stringContaining("Cycle detected"));
  });

  it('rejects node without groupId', () => {
    const graph: GraphPipeline = {
      nodes: [{ id: 'a', kind: 'stage', groupId: '' }],
      edges: [],
    };
    expect(validateGraphPipeline(graph)).toContainEqual(expect.stringContaining("must have a groupId"));
  });
});

// ── Compiler Tests ──────────────────────────────────────────────────────────

describe('compileGraphPipelineToIR', () => {
  it('compiles linear graph to correct IR', () => {
    const ir = compileGraphPipelineToIR('t1', makeLinearGraph());

    expect(ir.templateId).toBe('t1');
    expect(ir.nodes).toHaveLength(3);
    expect(ir.edges).toHaveLength(2);
    expect(ir.entryNodeIds).toEqual(['spec']);
    expect(ir.irVersion).toBe(1);
  });

  it('compiles diamond graph with correct entry and edges', () => {
    const ir = compileGraphPipelineToIR('t2', makeDiamondGraph());

    expect(ir.entryNodeIds).toEqual(['design']);
    expect(ir.edges).toHaveLength(4);

    const integration = ir.nodes.find(n => n.id === 'integration');
    expect(integration?.triggerOn).toBe('completed');
  });

  it('compiles fan-out/join with correct node configs', () => {
    const ir = compileGraphPipelineToIR('t3', makeFanOutJoinGraph());

    const fanOut = ir.nodes.find(n => n.id === 'wp-fanout');
    expect(fanOut?.kind).toBe('fan-out');
    expect(fanOut?.fanOut?.workPackagesPath).toBe('docs/wp.json');

    const join = ir.nodes.find(n => n.id === 'wp-join');
    expect(join?.kind).toBe('join');
    expect(join?.join?.sourceNodeId).toBe('wp-fanout');
    expect(join?.join?.policy).toBe('all');
  });

  it('carries maxConcurrency from graphPipeline fan-out node into IR', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'planning', kind: 'stage', groupId: 'project-planning' },
        {
          id: 'wp-fanout',
          kind: 'fan-out',
          groupId: 'wp-orchestrator',
          fanOut: { workPackagesPath: 'docs/wp.json', perBranchTemplateId: 'wp-dev', maxConcurrency: 3 },
        },
      ],
      edges: [{ from: 'planning', to: 'wp-fanout' }],
    };
    const ir = compileGraphPipelineToIR('t', graph);
    expect(ir.nodes.find(n => n.id === 'wp-fanout')?.fanOut?.maxConcurrency).toBe(3);
  });

  it('sets autoTrigger defaults correctly', () => {
    const ir = compileGraphPipelineToIR('t1', makeLinearGraph());

    // All nodes default to autoTrigger: true
    for (const node of ir.nodes) {
      expect(node.autoTrigger).toBe(true);
    }
  });

  it('sets triggerOn defaults correctly', () => {
    const ir = compileGraphPipelineToIR('t1', makeLinearGraph());

    // All nodes default to triggerOn: 'approved'
    for (const node of ir.nodes) {
      expect(node.triggerOn).toBe('approved');
    }
  });

  it('preserves explicit autoTrigger=false', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'a', kind: 'stage', groupId: 'g1', autoTrigger: false },
      ],
      edges: [],
    };
    const ir = compileGraphPipelineToIR('t', graph);
    expect(ir.nodes[0].autoTrigger).toBe(false);
  });

  it('identifies multiple entry nodes', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'a', kind: 'stage', groupId: 'g1' },
        { id: 'b', kind: 'stage', groupId: 'g2' },
        { id: 'c', kind: 'stage', groupId: 'g3' },
      ],
      edges: [
        { from: 'a', to: 'c' },
        { from: 'b', to: 'c' },
      ],
    };
    const ir = compileGraphPipelineToIR('t', graph);
    expect(ir.entryNodeIds).toEqual(['a', 'b']);
  });

  it('throws on invalid graph', () => {
    const graph: GraphPipeline = { nodes: [], edges: [] };
    expect(() => compileGraphPipelineToIR('t', graph)).toThrow('Cannot compile graphPipeline');
  });

  it('preserves edge conditions', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'a', kind: 'stage', groupId: 'g1' },
        { id: 'b', kind: 'stage', groupId: 'g2' },
      ],
      edges: [{ from: 'a', to: 'b', condition: 'result.score > 80' }],
    };
    const ir = compileGraphPipelineToIR('t', graph);
    expect(ir.edges[0].condition).toBe('result.score > 80');
  });
});

// ── Equivalence Tests ───────────────────────────────────────────────────────

describe('graphPipeline ↔ pipeline[] IR equivalence', () => {
  it('linear graph produces equivalent IR to linear pipeline', () => {
    // Compile via pipeline[]
    const pipelineTemplate: TemplateDefinition = {
      id: 'equiv-test',
      kind: 'template',
      title: 'Test',
      description: '',
      groups: {},
      pipeline: [
        { stageId: 'spec', groupId: 'planning', autoTrigger: false },
        { stageId: 'dev', groupId: 'development', autoTrigger: true, upstreamStageIds: ['spec'] },
        { stageId: 'review', groupId: 'review', autoTrigger: true, upstreamStageIds: ['dev'] },
      ],
    };
    const pipelineIR = compilePipelineToIR(pipelineTemplate);

    // Compile via graphPipeline
    const graphIR = compileGraphPipelineToIR('equiv-test', {
      nodes: [
        { id: 'spec', kind: 'stage', groupId: 'planning', autoTrigger: false },
        { id: 'dev', kind: 'stage', groupId: 'development' },
        { id: 'review', kind: 'stage', groupId: 'review' },
      ],
      edges: [
        { from: 'spec', to: 'dev' },
        { from: 'dev', to: 'review' },
      ],
    });

    // Structural equivalence (ignoring compiledAt timestamp)
    expect(graphIR.templateId).toBe(pipelineIR.templateId);
    expect(graphIR.nodes.map(n => n.id)).toEqual(pipelineIR.nodes.map(n => n.id));
    expect(graphIR.edges.map(e => ({ from: e.from, to: e.to }))).toEqual(
      pipelineIR.edges.map(e => ({ from: e.from, to: e.to })),
    );
    expect(graphIR.entryNodeIds).toEqual(pipelineIR.entryNodeIds);

    // Node configs match
    for (const gNode of graphIR.nodes) {
      const pNode = pipelineIR.nodes.find(n => n.id === gNode.id)!;
      expect(gNode.kind).toBe(pNode.kind);
      expect(gNode.groupId).toBe(pNode.groupId);
      expect(gNode.autoTrigger).toBe(pNode.autoTrigger);
      expect(gNode.triggerOn).toBe(pNode.triggerOn);
    }
  });
});

// ── Gate Node (V5.2) ──────────────────────────────────────────────────────

describe('gate node validation', () => {
  it('accepts valid gate node', () => {
    const errors = validateGraphPipeline({
      nodes: [
        { id: 'dev', kind: 'stage', groupId: 'dev' },
        { id: 'gate', kind: 'gate', groupId: 'approval', gate: { autoApprove: false } },
        { id: 'deploy', kind: 'stage', groupId: 'deploy' },
      ],
      edges: [
        { from: 'dev', to: 'gate' },
        { from: 'gate', to: 'deploy' },
      ],
    });
    expect(errors).toEqual([]);
  });

  it('accepts gate node without explicit gate config', () => {
    const errors = validateGraphPipeline({
      nodes: [
        { id: 'dev', kind: 'stage', groupId: 'dev' },
        { id: 'gate', kind: 'gate', groupId: 'approval' },
      ],
      edges: [{ from: 'dev', to: 'gate' }],
    });
    expect(errors).toEqual([]);
  });

  it('rejects gate config on non-gate node', () => {
    const errors = validateGraphPipeline({
      nodes: [
        { id: 'dev', kind: 'stage', groupId: 'dev', gate: { autoApprove: true } } as any,
      ],
      edges: [],
    });
    expect(errors.some(e => e.includes('gate configuration') && e.includes("'dev'"))).toBe(true);
  });
});

describe('gate node compilation', () => {
  it('compiles gate node with explicit config', () => {
    const ir = compileGraphPipelineToIR('tpl', {
      nodes: [
        { id: 'dev', kind: 'stage', groupId: 'dev' },
        { id: 'gate', kind: 'gate', groupId: 'approval', gate: { autoApprove: true, approvalPrompt: 'OK?' } },
        { id: 'deploy', kind: 'stage', groupId: 'deploy' },
      ],
      edges: [
        { from: 'dev', to: 'gate' },
        { from: 'gate', to: 'deploy' },
      ],
    });

    const gateNode = ir.nodes.find(n => n.id === 'gate')!;
    expect(gateNode.kind).toBe('gate');
    expect(gateNode.gate).toBeDefined();
    expect(gateNode.gate!.autoApprove).toBe(true);
    expect(gateNode.gate!.approvalPrompt).toBe('OK?');
  });

  it('compiles gate node with default config', () => {
    const ir = compileGraphPipelineToIR('tpl', {
      nodes: [
        { id: 'dev', kind: 'stage', groupId: 'dev' },
        { id: 'gate', kind: 'gate', groupId: 'approval' },
      ],
      edges: [{ from: 'dev', to: 'gate' }],
    });

    const gateNode = ir.nodes.find(n => n.id === 'gate')!;
    expect(gateNode.gate).toBeDefined();
    expect(gateNode.gate!.autoApprove).toBe(false);
  });
});

// ── Switch Node (V5.2) ───────────────────────────────────────────────────

describe('switch node validation', () => {
  it('accepts valid switch node', () => {
    const errors = validateGraphPipeline({
      nodes: [
        { id: 'analysis', kind: 'stage', groupId: 'analysis' },
        {
          id: 'router', kind: 'switch', groupId: 'router',
          switch: {
            branches: [
              { label: 'simple', condition: { type: 'field-match', field: 'complexity', value: 'low' }, targetNodeId: 'quick' },
            ],
            defaultTargetNodeId: 'quick',
          },
        },
        { id: 'quick', kind: 'stage', groupId: 'quick' },
      ],
      edges: [{ from: 'analysis', to: 'router' }, { from: 'router', to: 'quick' }],
    });
    expect(errors).toEqual([]);
  });

  it('rejects switch node without config', () => {
    const errors = validateGraphPipeline({
      nodes: [
        { id: 'router', kind: 'switch', groupId: 'router' },
      ],
      edges: [],
    });
    expect(errors.some(e => e.includes('switch configuration'))).toBe(true);
  });

  it('rejects switch config on non-switch node', () => {
    const errors = validateGraphPipeline({
      nodes: [
        { id: 'dev', kind: 'stage', groupId: 'dev', switch: { branches: [], defaultTargetNodeId: 'x' } } as any,
      ],
      edges: [],
    });
    expect(errors.some(e => e.includes('switch configuration') && e.includes("'dev'"))).toBe(true);
  });

  it('rejects switch branch referencing unknown target', () => {
    const errors = validateGraphPipeline({
      nodes: [
        {
          id: 'router', kind: 'switch', groupId: 'router',
          switch: {
            branches: [
              { label: 'x', condition: { type: 'always' }, targetNodeId: 'nonexistent' },
            ],
          },
        },
      ],
      edges: [],
    });
    expect(errors.some(e => e.includes('nonexistent'))).toBe(true);
  });

  it('rejects switch default referencing unknown node', () => {
    const errors = validateGraphPipeline({
      nodes: [
        {
          id: 'router', kind: 'switch', groupId: 'router',
          switch: {
            branches: [],
            defaultTargetNodeId: 'ghost',
          },
        },
      ],
      edges: [],
    });
    expect(errors.some(e => e.includes('ghost'))).toBe(true);
  });
});

describe('switch node compilation', () => {
  it('compiles switch node with branches', () => {
    const ir = compileGraphPipelineToIR('tpl', {
      nodes: [
        { id: 'analysis', kind: 'stage', groupId: 'analysis' },
        {
          id: 'router', kind: 'switch', groupId: 'router',
          switch: {
            branches: [
              { label: 'fast', condition: { type: 'field-match', field: 'speed', value: 'high' }, targetNodeId: 'fast-path' },
              { label: 'slow', condition: { type: 'field-compare', field: 'score', operator: 'lt', value: 50 }, targetNodeId: 'slow-path' },
            ],
            defaultTargetNodeId: 'fast-path',
          },
        },
        { id: 'fast-path', kind: 'stage', groupId: 'fast' },
        { id: 'slow-path', kind: 'stage', groupId: 'slow' },
      ],
      edges: [
        { from: 'analysis', to: 'router' },
        { from: 'router', to: 'fast-path' },
        { from: 'router', to: 'slow-path' },
      ],
    });

    const switchNode = ir.nodes.find(n => n.id === 'router')!;
    expect(switchNode.kind).toBe('switch');
    expect(switchNode.switch).toBeDefined();
    expect(switchNode.switch!.branches).toHaveLength(2);
    expect(switchNode.switch!.branches[0].label).toBe('fast');
    expect(switchNode.switch!.defaultTargetNodeId).toBe('fast-path');
  });
});

// ── Loop Validation (V5.2) ──────────────────────────────────────────────────

describe('loop node validation', () => {
  it('accepts valid loop-start / loop-end pair', () => {
    const errors = validateGraphPipeline({
      nodes: [
        { id: 'init', kind: 'stage', groupId: 'init' },
        {
          id: 'ls', kind: 'loop-start', groupId: 'ls',
          loop: { maxIterations: 5, terminationCondition: { type: 'always' }, pairedNodeId: 'le' },
        },
        { id: 'body', kind: 'stage', groupId: 'body' },
        {
          id: 'le', kind: 'loop-end', groupId: 'le',
          loop: { maxIterations: 5, terminationCondition: { type: 'always' }, pairedNodeId: 'ls' },
        },
      ],
      edges: [
        { from: 'init', to: 'ls' },
        { from: 'ls', to: 'body' },
        { from: 'body', to: 'le' },
      ],
    });
    expect(errors).toEqual([]);
  });

  it('rejects loop-start without loop config', () => {
    const errors = validateGraphPipeline({
      nodes: [
        { id: 'ls', kind: 'loop-start', groupId: 'ls' },
      ],
      edges: [],
    });
    expect(errors.some(e => e.includes('loop configuration'))).toBe(true);
  });

  it('rejects loop config on non-loop node', () => {
    const errors = validateGraphPipeline({
      nodes: [
        { id: 'dev', kind: 'stage', groupId: 'dev', loop: { maxIterations: 3, terminationCondition: { type: 'always' }, pairedNodeId: 'x' } } as any,
      ],
      edges: [],
    });
    expect(errors.some(e => e.includes('loop configuration') && e.includes("'dev'"))).toBe(true);
  });

  it('rejects maxIterations < 1', () => {
    const errors = validateGraphPipeline({
      nodes: [
        {
          id: 'ls', kind: 'loop-start', groupId: 'ls',
          loop: { maxIterations: 0, terminationCondition: { type: 'always' }, pairedNodeId: 'le' },
        },
        {
          id: 'le', kind: 'loop-end', groupId: 'le',
          loop: { maxIterations: 0, terminationCondition: { type: 'always' }, pairedNodeId: 'ls' },
        },
      ],
      edges: [],
    });
    expect(errors.some(e => e.includes('maxIterations') && e.includes('>= 1'))).toBe(true);
  });

  it('rejects pairedNodeId referencing non-existent node', () => {
    const errors = validateGraphPipeline({
      nodes: [
        {
          id: 'ls', kind: 'loop-start', groupId: 'ls',
          loop: { maxIterations: 3, terminationCondition: { type: 'always' }, pairedNodeId: 'ghost' },
        },
      ],
      edges: [],
    });
    expect(errors.some(e => e.includes('ghost'))).toBe(true);
  });

  it('rejects loop-start paired with another loop-start', () => {
    const errors = validateGraphPipeline({
      nodes: [
        {
          id: 'ls1', kind: 'loop-start', groupId: 'ls1',
          loop: { maxIterations: 3, terminationCondition: { type: 'always' }, pairedNodeId: 'ls2' },
        },
        {
          id: 'ls2', kind: 'loop-start', groupId: 'ls2',
          loop: { maxIterations: 3, terminationCondition: { type: 'always' }, pairedNodeId: 'ls1' },
        },
      ],
      edges: [],
    });
    expect(errors.some(e => e.includes('loop-end') && e.includes("'ls1'"))).toBe(true);
  });
});

describe('loop node compilation', () => {
  it('compiles loop-start and loop-end nodes', () => {
    const ir = compileGraphPipelineToIR('tpl', {
      nodes: [
        {
          id: 'ls', kind: 'loop-start', groupId: 'ls',
          loop: { maxIterations: 10, terminationCondition: { type: 'field-match', field: 'status', value: 'done' }, pairedNodeId: 'le' },
        },
        { id: 'body', kind: 'stage', groupId: 'body' },
        {
          id: 'le', kind: 'loop-end', groupId: 'le',
          loop: { maxIterations: 10, terminationCondition: { type: 'field-match', field: 'status', value: 'done' }, pairedNodeId: 'ls', checkpointPerIteration: true },
        },
      ],
      edges: [
        { from: 'ls', to: 'body' },
        { from: 'body', to: 'le' },
      ],
    });

    const loopStart = ir.nodes.find(n => n.id === 'ls')!;
    expect(loopStart.kind).toBe('loop-start');
    expect(loopStart.loop).toBeDefined();
    expect(loopStart.loop!.maxIterations).toBe(10);
    expect(loopStart.loop!.pairedNodeId).toBe('le');
    expect(loopStart.loop!.checkpointPerIteration).toBe(false); // loop-start defaults to false

    const loopEnd = ir.nodes.find(n => n.id === 'le')!;
    expect(loopEnd.kind).toBe('loop-end');
    expect(loopEnd.loop!.terminationCondition.type).toBe('field-match');
    expect(loopEnd.loop!.checkpointPerIteration).toBe(true);
  });
});
