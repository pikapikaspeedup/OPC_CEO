import { describe, expect, it } from 'vitest';

import { decodeDecisionTarget, encodeDecisionTarget } from './decision-control';

describe('decision control target encoding', () => {
  it('encodes system-improvement targets into compact URL-safe tokens', () => {
    const target = { kind: 'system-improvement-proposal' as const, proposalId: 'proposal-1' };
    const params = new URLSearchParams();
    params.set('decision', encodeDecisionTarget(target));

    expect(params.toString()).toBe('decision=si%7Eproposal-1');
    expect(decodeDecisionTarget(params.get('decision'))).toEqual(target);
  });

  it('round trips project stage gate targets', () => {
    const target = { kind: 'project-stage-gate' as const, projectId: 'project-1', stageId: 'stage-2' };
    const encoded = encodeDecisionTarget(target);

    expect(encoded).toBe('sg~project-1~stage-2');
    expect(decodeDecisionTarget(encoded)).toEqual(target);
  });
});
