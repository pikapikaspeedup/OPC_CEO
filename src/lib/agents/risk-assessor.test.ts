import { describe, expect, it } from 'vitest';
import { assessGenerationRisks, hasCriticalRisk, type RiskAssessment } from './risk-assessor';
import type { GraphPipeline } from './pipeline/graph-pipeline-types';
import type { GenerationContext } from './generation-context';

function makeContext(groups: string[] = ['dev', 'review', 'deploy']): GenerationContext {
  return {
    availableGroups: groups.map(id => ({ id, title: id, description: '', roles: [] })),
    existingTemplates: [],
    outputSchema: {},
  };
}

function makeGraph(nodes: GraphPipeline['nodes'], edges: GraphPipeline['edges'] = []): GraphPipeline {
  return { nodes, edges };
}

describe('assessGenerationRisks', () => {
  it('returns info for normal pipeline', () => {
    const graph = makeGraph([
      { id: 'dev', kind: 'stage', groupId: 'dev' },
      { id: 'review', kind: 'stage', groupId: 'review' },
    ]);
    const risks = assessGenerationRisks(graph, [], makeContext());
    expect(risks.every(r => r.severity === 'info')).toBe(true);
    expect(hasCriticalRisk(risks)).toBe(false);
  });

  it('warning when node count > 10', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `s${i}`, kind: 'stage' as const, groupId: 'dev',
    }));
    const risks = assessGenerationRisks(makeGraph(nodes), [], makeContext());
    expect(risks.some(r => r.severity === 'warning' && r.category === 'complexity')).toBe(true);
  });

  it('critical when node count > 20', () => {
    const nodes = Array.from({ length: 22 }, (_, i) => ({
      id: `s${i}`, kind: 'stage' as const, groupId: 'dev',
    }));
    const risks = assessGenerationRisks(makeGraph(nodes), [], makeContext());
    expect(risks.some(r => r.severity === 'critical' && r.category === 'complexity')).toBe(true);
    expect(hasCriticalRisk(risks)).toBe(true);
  });

  it('critical when referencing unknown groupId', () => {
    const graph = makeGraph([
      { id: 'dev', kind: 'stage', groupId: 'dev' },
      { id: 'mystery', kind: 'stage', groupId: 'unknown-group' },
    ]);
    const risks = assessGenerationRisks(graph, [], makeContext());
    expect(risks.some(r => r.severity === 'critical' && r.message.includes('unknown-group'))).toBe(true);
  });

  it('warning for fan-out nesting', () => {
    const graph = makeGraph(
      [
        { id: 'fo1', kind: 'fan-out', groupId: 'dev' },
        { id: 'fo2', kind: 'fan-out', groupId: 'dev' },
      ],
      [{ from: 'fo1', to: 'fo2' }],
    );
    const risks = assessGenerationRisks(graph, [], makeContext());
    expect(risks.some(r => r.severity === 'warning' && r.message.includes('Nested fan-out'))).toBe(true);
  });

  it('warning for high loop iterations', () => {
    const graph = makeGraph([
      {
        id: 'ls', kind: 'loop-start', groupId: 'dev',
        loop: { maxIterations: 5, terminationCondition: { type: 'always' }, pairedNodeId: 'le' },
      },
      {
        id: 'le', kind: 'loop-end', groupId: 'dev',
        loop: { maxIterations: 5, terminationCondition: { type: 'always' }, pairedNodeId: 'ls' },
      },
    ]);
    const risks = assessGenerationRisks(graph, [], makeContext());
    expect(risks.some(r => r.severity === 'warning' && r.category === 'cost')).toBe(true);
  });

  it('warning for switch without default', () => {
    const graph = makeGraph([
      {
        id: 'router', kind: 'switch', groupId: 'dev',
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
      { id: 'dev', kind: 'stage', groupId: 'dev' },
    ]);
    const risks = assessGenerationRisks(graph, [], makeContext());
    expect(risks.some(r => r.severity === 'info' && r.message.includes('no contract'))).toBe(true);
  });

  it('critical when DAG validation has errors', () => {
    const risks = assessGenerationRisks(
      makeGraph([{ id: 'a', kind: 'stage', groupId: 'dev' }]),
      ['Cycle detected'],
      makeContext(),
    );
    expect(risks.some(r => r.severity === 'critical' && r.message.includes('Cycle detected'))).toBe(true);
  });

  it('sorts risks by severity (critical first)', () => {
    const graph = makeGraph(
      Array.from({ length: 22 }, (_, i) => ({
        id: `s${i}`, kind: 'stage' as const, groupId: i === 0 ? 'unknown' : 'dev',
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
