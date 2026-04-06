import { describe, expect, it } from 'vitest';
import { validateTemplatePipeline } from './pipeline-graph';
import type { TemplateDefinition } from './pipeline-types';

describe('validateTemplatePipeline', () => {
  it('accepts linear templates without explicit stage ids', () => {
    const template: TemplateDefinition = {
      id: 'linear-template',
      kind: 'template',
      title: 'Linear',
      description: 'linear',
      groups: {
        a: { title: 'A', description: 'A', executionMode: 'review-loop', roles: [] },
        b: { title: 'B', description: 'B', executionMode: 'review-loop', roles: [] },
      },
      pipeline: [
        { groupId: 'a', autoTrigger: false },
        { groupId: 'b', autoTrigger: true, triggerOn: 'approved' },
      ],
    };

    expect(validateTemplatePipeline(template)).toEqual([]);
  });

  it('rejects missing upstream references', () => {
    const template: TemplateDefinition = {
      id: 'dag-template',
      kind: 'template',
      title: 'Dag',
      description: 'dag',
      groups: {
        a: { title: 'A', description: 'A', executionMode: 'review-loop', roles: [] },
        b: { title: 'B', description: 'B', executionMode: 'review-loop', roles: [] },
      },
      pipeline: [
        { stageId: 'a', groupId: 'a', autoTrigger: false },
        { stageId: 'b', groupId: 'b', autoTrigger: true, upstreamStageIds: ['missing'] },
      ],
    };

    const errors = validateTemplatePipeline(template);
    expect(errors.some(error => error.includes('missing upstream'))).toBe(true);
  });

  it('rejects cycles', () => {
    const template: TemplateDefinition = {
      id: 'cyclic-template',
      kind: 'template',
      title: 'Cycle',
      description: 'cycle',
      groups: {
        a: { title: 'A', description: 'A', executionMode: 'review-loop', roles: [] },
        b: { title: 'B', description: 'B', executionMode: 'review-loop', roles: [] },
      },
      pipeline: [
        { stageId: 'a', groupId: 'a', autoTrigger: false, upstreamStageIds: ['b'] },
        { stageId: 'b', groupId: 'b', autoTrigger: true, upstreamStageIds: ['a'] },
      ],
    };

    const errors = validateTemplatePipeline(template);
    expect(errors.some(error => error.includes('Cycle detected'))).toBe(true);
  });
});
