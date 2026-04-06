import { describe, expect, it } from 'vitest';
import { pipelineToGraphPipeline, graphPipelineToPipeline } from './graph-pipeline-converter';
import type { PipelineStage } from './pipeline-types';
import type { GraphPipeline } from './graph-pipeline-types';

// ── pipeline[] → graphPipeline ──────────────────────────────────────────────

describe('pipelineToGraphPipeline', () => {
  it('converts linear pipeline with implicit edges', () => {
    const pipeline: PipelineStage[] = [
      { groupId: 'planning', autoTrigger: false },
      { stageId: 'dev', groupId: 'development', autoTrigger: true },
      { stageId: 'review', groupId: 'review', autoTrigger: true },
    ];

    const graph = pipelineToGraphPipeline(pipeline);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0].id).toBe('planning');
    expect(graph.nodes[1].id).toBe('dev');
    expect(graph.nodes[2].id).toBe('review');

    // Implicit linear edges
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges).toContainEqual({ from: 'planning', to: 'dev' });
    expect(graph.edges).toContainEqual({ from: 'dev', to: 'review' });
  });

  it('converts pipeline with explicit upstreamStageIds', () => {
    const pipeline: PipelineStage[] = [
      { stageId: 'a', groupId: 'g1', autoTrigger: false, upstreamStageIds: [] },
      { stageId: 'b', groupId: 'g2', autoTrigger: true, upstreamStageIds: ['a'] },
      { stageId: 'c', groupId: 'g3', autoTrigger: true, upstreamStageIds: ['a', 'b'] },
    ];

    const graph = pipelineToGraphPipeline(pipeline);

    expect(graph.edges).toHaveLength(3);
    expect(graph.edges).toContainEqual({ from: 'a', to: 'b' });
    expect(graph.edges).toContainEqual({ from: 'a', to: 'c' });
    expect(graph.edges).toContainEqual({ from: 'b', to: 'c' });
  });

  it('converts entry node (upstreamStageIds: []) to node with no incoming edges', () => {
    const pipeline: PipelineStage[] = [
      { stageId: 'entry', groupId: 'g1', autoTrigger: true, upstreamStageIds: [] },
    ];

    const graph = pipelineToGraphPipeline(pipeline);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
  });

  it('converts fan-out stage correctly', () => {
    const pipeline: PipelineStage[] = [
      { stageId: 'spec', groupId: 'g1', autoTrigger: false },
      {
        stageId: 'fan',
        groupId: 'g2',
        autoTrigger: true,
        stageType: 'fan-out',
        fanOutSource: { workPackagesPath: 'wp.json', perBranchTemplateId: 'branch-tmpl' },
      },
    ];

    const graph = pipelineToGraphPipeline(pipeline);
    const fanNode = graph.nodes.find(n => n.id === 'fan');
    expect(fanNode?.kind).toBe('fan-out');
    expect(fanNode?.fanOut?.workPackagesPath).toBe('wp.json');
    expect(fanNode?.fanOut?.perBranchTemplateId).toBe('branch-tmpl');
  });

  it('converts join stage correctly', () => {
    const pipeline: PipelineStage[] = [
      {
        stageId: 'merge',
        groupId: 'g1',
        autoTrigger: true,
        stageType: 'join',
        joinFrom: 'fan',
        joinPolicy: 'all',
        upstreamStageIds: ['fan'],
      },
    ];

    const graph = pipelineToGraphPipeline(pipeline);
    const joinNode = graph.nodes.find(n => n.id === 'merge');
    expect(joinNode?.kind).toBe('join');
    expect(joinNode?.join?.sourceNodeId).toBe('fan');
    expect(joinNode?.join?.policy).toBe('all');
  });

  it('preserves triggerOn and promptTemplate', () => {
    const pipeline: PipelineStage[] = [
      {
        stageId: 'a',
        groupId: 'g1',
        autoTrigger: true,
        triggerOn: 'completed',
        promptTemplate: '/custom-prompt',
      },
    ];

    const graph = pipelineToGraphPipeline(pipeline);
    expect(graph.nodes[0].triggerOn).toBe('completed');
    expect(graph.nodes[0].promptTemplate).toBe('/custom-prompt');
  });
});

// ── graphPipeline → pipeline[] ──────────────────────────────────────────────

describe('graphPipelineToPipeline', () => {
  it('converts linear graph to pipeline with correct order', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'review', kind: 'stage', groupId: 'review' },
        { id: 'dev', kind: 'stage', groupId: 'development' },
        { id: 'spec', kind: 'stage', groupId: 'planning' },
      ],
      edges: [
        { from: 'spec', to: 'dev' },
        { from: 'dev', to: 'review' },
      ],
    };

    const pipeline = graphPipelineToPipeline(graph);

    // Topologically sorted
    expect(pipeline.map(s => s.stageId)).toEqual(['spec', 'dev', 'review']);

    // Check upstream IDs
    expect(pipeline[0].upstreamStageIds).toEqual([]); // entry
    expect(pipeline[1].upstreamStageIds).toEqual(['spec']);
    expect(pipeline[2].upstreamStageIds).toEqual(['dev']);
  });

  it('converts diamond graph with multiple upstreams', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'design', kind: 'stage', groupId: 'g1' },
        { id: 'frontend', kind: 'stage', groupId: 'g2' },
        { id: 'backend', kind: 'stage', groupId: 'g3' },
        { id: 'integration', kind: 'stage', groupId: 'g4' },
      ],
      edges: [
        { from: 'design', to: 'frontend' },
        { from: 'design', to: 'backend' },
        { from: 'frontend', to: 'integration' },
        { from: 'backend', to: 'integration' },
      ],
    };

    const pipeline = graphPipelineToPipeline(graph);

    // design first, then backend/frontend (alphabetical), then integration
    expect(pipeline[0].stageId).toBe('design');
    expect(pipeline[pipeline.length - 1].stageId).toBe('integration');

    const integrationStage = pipeline.find(s => s.stageId === 'integration');
    expect(integrationStage?.upstreamStageIds).toContain('frontend');
    expect(integrationStage?.upstreamStageIds).toContain('backend');
  });

  it('converts fan-out/join nodes correctly', () => {
    const graph: GraphPipeline = {
      nodes: [
        { id: 'spec', kind: 'stage', groupId: 'g1' },
        {
          id: 'fan',
          kind: 'fan-out',
          groupId: 'g2',
          fanOut: { workPackagesPath: 'wp.json', perBranchTemplateId: 'br' },
        },
        {
          id: 'join',
          kind: 'join',
          groupId: 'g3',
          join: { sourceNodeId: 'fan', policy: 'all' },
        },
      ],
      edges: [
        { from: 'spec', to: 'fan' },
        { from: 'fan', to: 'join' },
      ],
    };

    const pipeline = graphPipelineToPipeline(graph);

    const fanStage = pipeline.find(s => s.stageId === 'fan');
    expect(fanStage?.stageType).toBe('fan-out');
    expect(fanStage?.fanOutSource?.workPackagesPath).toBe('wp.json');

    const joinStage = pipeline.find(s => s.stageId === 'join');
    expect(joinStage?.stageType).toBe('join');
    expect(joinStage?.joinFrom).toBe('fan');
    expect(joinStage?.joinPolicy).toBe('all');
  });

  it('defaults autoTrigger to true', () => {
    const graph: GraphPipeline = {
      nodes: [{ id: 'a', kind: 'stage', groupId: 'g1' }],
      edges: [],
    };
    const pipeline = graphPipelineToPipeline(graph);
    expect(pipeline[0].autoTrigger).toBe(true);
  });
});

// ── Round-trip Tests ────────────────────────────────────────────────────────

describe('round-trip conversion', () => {
  it('pipeline → graph → pipeline preserves structure', () => {
    const original: PipelineStage[] = [
      { stageId: 'spec', groupId: 'planning', autoTrigger: false, upstreamStageIds: [] },
      { stageId: 'dev', groupId: 'development', autoTrigger: true, upstreamStageIds: ['spec'] },
      { stageId: 'review', groupId: 'review', autoTrigger: true, upstreamStageIds: ['dev'] },
    ];

    const graph = pipelineToGraphPipeline(original);
    const roundTripped = graphPipelineToPipeline(graph);

    expect(roundTripped.map(s => s.stageId)).toEqual(original.map(s => s.stageId));

    for (let i = 0; i < original.length; i++) {
      expect(roundTripped[i].groupId).toBe(original[i].groupId);
      expect(roundTripped[i].autoTrigger).toBe(original[i].autoTrigger);
      expect(roundTripped[i].upstreamStageIds?.sort()).toEqual(original[i].upstreamStageIds?.sort());
    }
  });

  it('graph → pipeline → graph preserves structure', () => {
    const original: GraphPipeline = {
      nodes: [
        { id: 'a', kind: 'stage', groupId: 'g1', autoTrigger: false },
        { id: 'b', kind: 'stage', groupId: 'g2' },
        { id: 'c', kind: 'stage', groupId: 'g3' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    };

    const pipeline = graphPipelineToPipeline(original);
    const roundTripped = pipelineToGraphPipeline(pipeline);

    expect(roundTripped.nodes.map(n => n.id).sort()).toEqual(original.nodes.map(n => n.id).sort());
    expect(roundTripped.edges.map(e => `${e.from}->${e.to}`).sort()).toEqual(
      original.edges.map(e => `${e.from}->${e.to}`).sort(),
    );
  });
});
