import { describe, expect, it } from 'vitest';
import { buildGenerationContext } from './generation-context';
import type { TemplateDefinition } from './pipeline-types';

const baseGroup = { title: 'G', description: 'g', executionMode: 'review-loop' as const, roles: [] };

function makeTemplate(overrides: Partial<TemplateDefinition> = {}): TemplateDefinition {
  return {
    id: 'test-tpl',
    kind: 'template',
    title: 'Test Template',
    description: 'A test template',
    groups: { dev: baseGroup, review: baseGroup },
    pipeline: [
      { groupId: 'dev' },
      { groupId: 'review' },
    ],
    ...overrides,
  };
}

describe('buildGenerationContext', () => {
  it('extracts groups from templates', () => {
    const ctx = buildGenerationContext([makeTemplate()]);
    expect(ctx.availableGroups).toHaveLength(2);
    expect(ctx.availableGroups.map(g => g.id).sort()).toEqual(['dev', 'review']);
  });

  it('deduplicates groups across templates', () => {
    const t1 = makeTemplate({ id: 't1', groups: { dev: baseGroup, qa: baseGroup } });
    const t2 = makeTemplate({ id: 't2', groups: { dev: baseGroup, deploy: baseGroup } });
    const ctx = buildGenerationContext([t1, t2]);
    // dev appears in both but should only appear once
    expect(ctx.availableGroups.filter(g => g.id === 'dev')).toHaveLength(1);
    expect(ctx.availableGroups).toHaveLength(3); // dev, qa, deploy
  });

  it('summarizes templates', () => {
    const tpl = makeTemplate();
    const ctx = buildGenerationContext([tpl]);
    expect(ctx.existingTemplates).toHaveLength(1);
    expect(ctx.existingTemplates[0].id).toBe('test-tpl');
    expect(ctx.existingTemplates[0].stageCount).toBe(2);
    expect(ctx.existingTemplates[0].hasFanOut).toBe(false);
  });

  it('detects fan-out in pipeline format', () => {
    const tpl = makeTemplate({
      pipeline: [
        { groupId: 'dev' },
        { groupId: 'split', stageType: 'fan-out' },
      ],
    });
    const ctx = buildGenerationContext([tpl]);
    expect(ctx.existingTemplates[0].hasFanOut).toBe(true);
  });

  it('detects fan-out in graphPipeline format', () => {
    const tpl = makeTemplate({
      graphPipeline: {
        nodes: [
          { id: 'dev', kind: 'stage', groupId: 'dev' },
          { id: 'split', kind: 'fan-out', groupId: 'split' },
        ],
        edges: [{ from: 'dev', to: 'split' }],
      },
    });
    const ctx = buildGenerationContext([tpl]);
    expect(ctx.existingTemplates[0].hasFanOut).toBe(true);
  });

  it('includes reference template when specified', () => {
    const tpl = makeTemplate({ id: 'ref-tpl' });
    const ctx = buildGenerationContext([tpl], 'ref-tpl');
    expect(ctx.referenceTemplate).toBeDefined();
    expect(ctx.referenceTemplate!.id).toBe('ref-tpl');
  });

  it('referenceTemplate is undefined when ID not found', () => {
    const ctx = buildGenerationContext([makeTemplate()], 'nonexistent');
    expect(ctx.referenceTemplate).toBeUndefined();
  });

  it('handles empty template list', () => {
    const ctx = buildGenerationContext([]);
    expect(ctx.availableGroups).toHaveLength(0);
    expect(ctx.existingTemplates).toHaveLength(0);
  });

  it('includes output schema', () => {
    const ctx = buildGenerationContext([]);
    expect(ctx.outputSchema).toBeDefined();
    expect((ctx.outputSchema as any).type).toBe('object');
  });
});
