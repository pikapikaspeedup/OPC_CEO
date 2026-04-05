import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock asset-loader since it loads YAML workflow files
vi.mock('./asset-loader', () => ({
  AssetLoader: {
    resolveWorkflowContent: vi.fn((ref: string) => `[WORKFLOW: ${ref}]`),
  },
}));

import {
  getCopiedArtifactPath,
  formatPromptArtifactLines,
  buildRolePrompt,
  buildRoleSwitchPrompt,
  buildDeliveryPrompt,
  extractReviewDecision,
  parseDecisionMarker,
} from './prompt-builder';

describe('getCopiedArtifactPath', () => {
  it('returns input/<shortId>/<path> format', () => {
    const result = getCopiedArtifactPath({
      id: 'a1',
      kind: 'spec',
      title: 'Design',
      path: 'architecture/design.md',
      sourceRunId: 'abcdef12-3456-7890-abcd-ef1234567890',
    });
    expect(result).toBe('input/abcdef12/architecture/design.md');
  });

  it('uses "unknown" when sourceRunId is missing', () => {
    const result = getCopiedArtifactPath({ id: 'a2', kind: 'doc', title: 'Readme', path: 'readme.md' });
    expect(result).toBe('input/unknown/readme.md');
  });
});

describe('formatPromptArtifactLines', () => {
  it('returns fallback message when no artifacts', () => {
    const lines = formatPromptArtifactLines('artifactDir/', []);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('None were provided');
  });

  it('formats artifact with title and source', () => {
    const lines = formatPromptArtifactLines('runs/123/', [
      {
        id: 'a3',
        kind: 'spec',
        path: 'design.md',
        title: 'Architecture Design',
        sourceRunId: 'aabbccdd-1234-5678-9012-aabbccddeeff',
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[1] Architecture Design (spec)');
    expect(lines[0]).toContain('runs/123/input/aabbccdd/design.md');
    expect(lines[0]).toContain('sourceRunId=aabbccdd');
  });

  it('uses title as label', () => {
    const lines = formatPromptArtifactLines('dir/', [
      { id: 'a4', kind: 'test-result', title: 'Test Results', path: 'tests.json' },
    ]);
    expect(lines[0]).toContain('[1] Test Results (test-result)');
  });
});

describe('buildRolePrompt', () => {
  const role = {
    id: 'architect',
    workflow: 'workflows/architect.yaml',
    timeoutMs: 60000,
    autoApprove: false,
  };

  it('includes workflow content', () => {
    const prompt = buildRolePrompt(role, 'Build login', 'art/', '/abs/art/', 1, false);
    expect(prompt).toContain('[WORKFLOW: workflows/architect.yaml]');
  });

  it('includes original goal', () => {
    const prompt = buildRolePrompt(role, 'Build login page', 'art/', '/abs/art/', 1, false);
    expect(prompt).toContain('Build login page');
  });

  it('generates author prompt for round 1', () => {
    const prompt = buildRolePrompt(role, 'goal', 'art/', '/abs/art/', 1, false);
    expect(prompt).toContain('Author assignment');
    expect(prompt).toContain('Write specs to');
  });

  it('generates revision prompt for round > 1', () => {
    const prompt = buildRolePrompt(role, 'goal', 'art/', '/abs/art/', 2, false);
    expect(prompt).toContain('Revision assignment');
    expect(prompt).toContain('review-round-1.md');
  });

  it('generates reviewer prompt when isReviewer=true', () => {
    const prompt = buildRolePrompt(role, 'goal', 'art/', '/abs/art/', 1, true);
    expect(prompt).toContain('Review assignment');
    expect(prompt).toContain('result-round-1.json');
  });

  it('includes execution rules', () => {
    const prompt = buildRolePrompt(role, 'goal', 'art/', '/abs/art/', 1, false);
    expect(prompt).toContain('Execution rules');
    expect(prompt).toContain('Read the task envelope first');
  });

  it('includes input artifacts when provided', () => {
    const prompt = buildRolePrompt(
      role, 'goal', 'art/', '/abs/art/', 1, false,
      [{ id: 'a5', kind: 'spec', path: 'design.md', title: 'My Spec', sourceRunId: '11223344-abcd-5678-9012-aabbccddeeff' }],
    );
    expect(prompt).toContain('My Spec (spec)');
  });
});

describe('buildRoleSwitchPrompt', () => {
  const role = {
    id: 'architect',
    workflow: 'workflows/architect.yaml',
    timeoutMs: 60000,
    autoApprove: false,
  };

  it('includes role continuation header', () => {
    const prompt = buildRoleSwitchPrompt(role, 2, 'art/', '/abs/art/', 'Build login');
    expect(prompt).toContain('ROLE CONTINUATION');
    expect(prompt).toContain('Round 2');
    expect(prompt).toContain('architect');
  });

  it('references previous round review feedback', () => {
    const prompt = buildRoleSwitchPrompt(role, 3, 'art/', '/abs/art/', 'goal');
    expect(prompt).toContain('review-round-2.md');
  });
});

describe('buildDeliveryPrompt', () => {
  const role = {
    id: 'developer',
    workflow: 'workflows/delivery.yaml',
    timeoutMs: 120000,
    autoApprove: false,
  };

  it('includes delivery assignment instructions', () => {
    const prompt = buildDeliveryPrompt(role, 'Implement feature', 'art/', '/tmp/test-abs-dir/');
    expect(prompt).toContain('Delivery assignment');
    expect(prompt).toContain('delivery-packet.json');
  });

  it('includes work package path when it exists', () => {
    // Create a real work package file instead of mocking fs
    const wpDir = path.join('/tmp', `test-wp-${Date.now()}`);
    fs.mkdirSync(path.join(wpDir, 'work-package'), { recursive: true });
    fs.writeFileSync(path.join(wpDir, 'work-package', 'work-package.json'), '{}');

    try {
      const prompt = buildDeliveryPrompt(role, 'goal', 'art/', wpDir + '/');
      expect(prompt).toContain('Work package');
    } finally {
      fs.rmSync(wpDir, { recursive: true, force: true });
    }
  });
});

describe('parseDecisionMarker', () => {
  it('parses DECISION: APPROVED', () => {
    expect(parseDecisionMarker('DECISION: APPROVED')).toBe('approved');
  });

  it('parses bold markdown format', () => {
    expect(parseDecisionMarker('**DECISION:** REVISE')).toBe('revise');
  });

  it('parses case-insensitive', () => {
    expect(parseDecisionMarker('decision: Rejected')).toBe('rejected');
  });

  it('returns null for no match', () => {
    expect(parseDecisionMarker('No decision here')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDecisionMarker('')).toBeNull();
  });
});

describe('extractReviewDecision', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join('/tmp', `test-review-${Date.now()}`);
    fs.mkdirSync(path.join(tmpDir, 'review'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads decision from result-round-N.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'review', 'result-round-1.json'),
      JSON.stringify({ decision: 'approved' }),
    );

    const decision = extractReviewDecision(tmpDir, 1, [], {
      status: 'completed',
      summary: '',
      changedFiles: [],
      blockers: [],
      needsReview: [],
    });
    expect(decision).toBe('approved');
  });

  it('reads decision from review markdown DECISION marker', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'review', 'review-round-1.md'),
      '# Review\n\nSome comments.\n\n**DECISION:** REVISE\n\nPlease fix X.',
    );

    const decision = extractReviewDecision(tmpDir, 1, [], {
      status: 'completed',
      summary: '',
      changedFiles: [],
      blockers: [],
      needsReview: [],
    });
    expect(decision).toBe('revise');
  });

  it('falls back to steps when no file found', () => {
    const steps = [
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        plannerResponse: { modifiedResponse: 'DECISION: REJECTED' },
      },
    ];

    const decision = extractReviewDecision(tmpDir, 1, steps, {
      status: 'completed',
      summary: '',
      changedFiles: [],
      blockers: [],
      needsReview: [],
    });
    expect(decision).toBe('rejected');
  });

  it('throws when no decision found anywhere', () => {
    expect(() =>
      extractReviewDecision(tmpDir, 1, [], {
        status: 'completed',
        summary: 'No decision',
        changedFiles: [],
        blockers: [],
        needsReview: [],
      }),
    ).toThrow('Missing explicit review decision');
  });
});
