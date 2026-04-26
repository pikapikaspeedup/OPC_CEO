import { describe, expect, it } from 'vitest';
import { assessGenerationRisks, hasCriticalRisk } from './risk-assessor';
import type { GraphPipeline } from './pipeline/graph-pipeline-types';
import type { GenerationContext } from './generation-context';

const baseRole = { id: 'worker', workflow: '/dev-worker', timeoutMs: 1000, autoApprove: true };

function makeContext(): GenerationContext {
  return {
    workflows: ['/dev-worker'],
    executionModes: ['review-loop'],
    nodeKinds: ['stage', 'fan-out', 'join', 'gate', 'switch', 'loop-start', 'loop-end', 'subgraph-ref'],
    existingTemplates: [],
    outputSchema: {},
  };
}

function makeNode(
  id: string,
  overrides: Partial<GraphPipeline['nodes'][number]> = {},
): GraphPipeline['nodes'][number] {
  return {
    id,
    kind: 'stage',
    groupId: id,
    executionMode: 'review-loop',
    roles: [baseRole],
    ...overrides,
  };
}

function makeGraph(nodes: GraphPipeline['nodes'], edges: GraphPipeline['edges'] = []): GraphPipeline {
  return { nodes, edges };
}

describe('assessGenerationRisks', () => {
  it('returns info for normal pipeline', () => {
    const graph = makeGraph([
      makeNode('dev'),
      makeNode('review'),
    ]);
    const risks = assessGenerationRisks(graph, [], makeContext());
    expect(risks.every(r => r.severity === 'info')).toBe(true);
    expect(hasCriticalRisk(risks)).toBe(false);
  });

  it('warning when node count > 10', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      ...makeNode(`s${i}`, { groupId: 'dev' }),
    }));
    const risks = assessGenerationRisks(makeGraph(nodes), [], makeContext());
    expect(risks.some(r => r.severity === 'warning' && r.category === 'complexity')).toBe(true);
  });

  it('critical when node count > 20', () => {
    const nodes = Array.from({ length: 22 }, (_, i) => ({
      ...makeNode(`s${i}`, { groupId: 'dev' }),
    }));
    const risks = assessGenerationRisks(makeGraph(nodes), [], makeContext());
    expect(risks.some(r => r.severity === 'critical' && r.category === 'complexity')).toBe(true);
    expect(hasCriticalRisk(risks)).toBe(true);
  });

  it('critical when missing execution config', () => {
    const graph = makeGraph([
      makeNode('dev'),
      { id: 'mystery', kind: 'stage', groupId: 'mystery' },
    ]);
    const risks = assessGenerationRisks(graph, [], makeContext());
    expect(risks.some(r => r.severity === 'critical' && r.category === 'availability' && r.message.includes('mystery'))).toBe(true);
  });

  it('warning for fan-out nesting', () => {
    const graph = makeGraph(
      [
        makeNode('fo1', { kind: 'fan-out', groupId: 'dev' }),
        makeNode('fo2', { kind: 'fan-out', groupId: 'dev' }),
      ],
      [{ from: 'fo1', to: 'fo2' }],
    );
    const risks = assessGenerationRisks(graph, [], makeContext());
    expect(risks.some(r => r.severity === 'warning' && r.message.includes('Nested fan-out'))).toBe(true);
  });

  it('warning for high loop iterations', () => {
    const graph = makeGraph([
      {
        ...makeNode('ls', { kind: 'loop-start', groupId: 'dev' }),
        loop: { maxIterations: 5, terminationCondition: { type: 'always' }, pairedNodeId: 'le' },
      },
      {
        ...makeNode('le', { kind: 'loop-end', groupId: 'dev' }),
        loop: { maxIterations: 5, terminationCondition: { type: 'always' }, pairedNodeId: 'ls' },
      },
    ]);
    const risks = assessGenerationRisks(graph, [], makeContext());
    expect(risks.some(r => r.severity === 'warning' && r.category === 'cost')).toBe(true);
  });

  it('warning for switch without default', () => {
    const graph = makeGraph([
      {
        ...makeNode('router', { kind: 'switch', groupId: 'dev' }),
        switch: {
          branches: [{ label: 'a', condition: { type: 'always' }, targetNodeId: 'x' }],
        },
      },
    ]);
    const risks = assessGenerationRisks(graph, [], makeContext());
    expect(risks.some(r => r.severity === 'warning' && r.message.includes('no default'))).toBe(true);
  });

  it('info for stages without contracts', () => {
    const graph = makeGraph([
      makeNode('dev'),
    ]);
    const risks = assessGenerationRisks(graph, [], makeContext());
    expect(risks.some(r => r.severity === 'info' && r.message.includes('no contract'))).toBe(true);
  });

  it('critical when DAG validation has errors', () => {
    const risks = assessGenerationRisks(
      makeGraph([makeNode('a', { groupId: 'dev' })]),
      ['Cycle detected'],
      makeContext(),
    );
    expect(risks.some(r => r.severity === 'critical' && r.message.includes('Cycle detected'))).toBe(true);
  });

  it('sorts risks by severity (critical first)', () => {
    const graph = makeGraph(
      Array.from({ length: 22 }, (_, i) => ({
        ...makeNode(`s${i}`, { groupId: i === 0 ? 'unknown' : 'dev' }),
      })),
    );
    const risks = assessGenerationRisks(graph, [], makeContext());
    const severities = risks.map(r => r.severity);
    const critical = severities.indexOf('critical');
    const warning = severities.indexOf('warning');
    const info = severities.indexOf('info');
    if (critical !== -1 && warning !== -1) expect(critical).toBeLessThan(warning);
    if (warning !== -1 && info !== -1) expect(warning).toBeLessThan(info);
  });
});
