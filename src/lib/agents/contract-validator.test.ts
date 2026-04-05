import { describe, expect, it } from 'vitest';
import { validateTemplateContracts } from './contract-validator';
import type { TemplateDefinition } from './pipeline-types';
import type { StageContract, FanOutContract, JoinMergeContract } from './contract-types';

// ── Test helpers ────────────────────────────────────────────────────────────

const baseGroup = { title: 'G', description: 'g', executionMode: 'review-loop' as const, roles: [] };

function makeTemplate(overrides: Partial<TemplateDefinition> = {}): TemplateDefinition {
  return {
    id: 'test-template',
    kind: 'template',
    title: 'Test',
    description: 'test',
    groups: { a: baseGroup, b: baseGroup, c: baseGroup },
    pipeline: [],
    ...overrides,
  };
}

// ── Output → Input compatibility ────────────────────────────────────────────

describe('validateTemplateContracts', () => {
  describe('output → input compatibility', () => {
    it('passes when upstream outputContract satisfies downstream inputContract', () => {
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

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('errors when required artifact is missing from upstream', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            contract: {
              outputContract: [
                { id: 'plan', kind: 'report', pathPattern: 'docs/plan.md' },
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
                { id: 'data', kind: 'data', format: 'json' },
              ],
            },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].stageId).toBe('b');
      expect(result.errors[0].message).toContain('data');
      expect(result.errors[0].relatedStageId).toBe('a');
    });

    it('errors on kind mismatch', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            contract: {
              outputContract: [
                { id: 'plan', kind: 'code', pathPattern: 'src/main.ts' },
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
                { id: 'plan', kind: 'report' },
              ],
            },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('plan');
    });

    it('skips optional (required=false) artifacts', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            contract: {
              outputContract: [],
            },
          },
          {
            stageId: 'b',
            groupId: 'b',
            autoTrigger: true,
            upstreamStageIds: ['a'],
            contract: {
              inputContract: [
                { id: 'optional-thing', kind: 'data', required: false },
              ],
            },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(true);
    });

    it('warns when upstream has no outputContract but downstream has inputContract', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            // no contract
          },
          {
            stageId: 'b',
            groupId: 'b',
            autoTrigger: true,
            upstreamStageIds: ['a'],
            contract: {
              inputContract: [
                { id: 'plan', kind: 'report' },
              ],
            },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(true); // warnings don't block
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings[0].message).toContain('no outputContract');
    });

    it('uses linear fallback when no explicit upstreamStageIds', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            contract: {
              outputContract: [
                { id: 'report', kind: 'report', pathPattern: 'out.md' },
              ],
            },
          },
          {
            stageId: 'b',
            groupId: 'b',
            autoTrigger: true,
            // no upstreamStageIds → falls back to previous stage 'a'
            contract: {
              inputContract: [
                { id: 'report', kind: 'report' },
              ],
            },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ── No-contract stages ──────────────────────────────────────────────────

  describe('no-contract stages', () => {
    it('passes when no stage has contracts', () => {
      const t = makeTemplate({
        pipeline: [
          { stageId: 'a', groupId: 'a', autoTrigger: false },
          { stageId: 'b', groupId: 'b', autoTrigger: true, upstreamStageIds: ['a'] },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  // ── Fan-out contracts ─────────────────────────────────────────────────

  describe('fan-out contracts', () => {
    it('warns when fan-out stage has no fanOutContract', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'fanout',
            groupId: 'a',
            autoTrigger: true,
            stageType: 'fan-out' as const,
            fanOutSource: { workPackagesPath: 'wp.json', perBranchTemplateId: 'branch-tmpl' },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.message.includes('no fanOutContract'))).toBe(true);
    });

    it('errors when branchInputContract entry missing id or kind', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'fanout',
            groupId: 'a',
            autoTrigger: true,
            stageType: 'fan-out' as const,
            fanOutSource: { workPackagesPath: 'wp.json', perBranchTemplateId: 'branch-tmpl' },
            fanOutContract: {
              branchInputContract: [
                { id: '', kind: 'data' }, // empty id
              ],
            },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('fanOutContract.branchInputContract');
    });
  });

  // ── Join merge contracts ──────────────────────────────────────────────

  describe('join merge contracts', () => {
    it('warns when join stage has no joinMergeContract', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'join-stage',
            groupId: 'a',
            autoTrigger: true,
            stageType: 'join' as const,
            joinFrom: 'fanout',
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.message.includes('no joinMergeContract'))).toBe(true);
    });

    it('errors when downstream inputContract unsatisfied by mergedOutputContract', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'join-stage',
            groupId: 'a',
            autoTrigger: true,
            stageType: 'join' as const,
            joinFrom: 'fanout',
            joinMergeContract: {
              mergedOutputContract: [
                { id: 'merged-report', kind: 'report', pathPattern: 'merged.md' },
              ],
            },
          },
          {
            stageId: 'post-join',
            groupId: 'b',
            autoTrigger: true,
            upstreamStageIds: ['join-stage'],
            contract: {
              inputContract: [
                { id: 'missing-artifact', kind: 'data' },
              ],
            },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(false);
      expect(result.errors[0].stageId).toBe('post-join');
      expect(result.errors[0].relatedStageId).toBe('join-stage');
    });

    it('passes when mergedOutputContract satisfies downstream', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'join-stage',
            groupId: 'a',
            autoTrigger: true,
            stageType: 'join' as const,
            joinFrom: 'fanout',
            joinMergeContract: {
              mergedOutputContract: [
                { id: 'merged-report', kind: 'report', pathPattern: 'merged.md', format: 'md' },
              ],
            },
          },
          {
            stageId: 'post-join',
            groupId: 'b',
            autoTrigger: true,
            upstreamStageIds: ['join-stage'],
            contract: {
              inputContract: [
                { id: 'merged-report', kind: 'report', format: 'md' },
              ],
            },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(true);
    });
  });

  // ── Artifact conflict detection ───────────────────────────────────────

  describe('artifact conflicts', () => {
    it('errors on duplicate artifact id across stages', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            contract: {
              outputContract: [
                { id: 'report', kind: 'report', pathPattern: 'a/report.md' },
              ],
            },
          },
          {
            stageId: 'b',
            groupId: 'b',
            autoTrigger: true,
            contract: {
              outputContract: [
                { id: 'report', kind: 'report', pathPattern: 'b/report.md' },
              ],
            },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("Artifact id 'report'");
    });

    it('errors on duplicate pathPattern across stages', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            contract: {
              outputContract: [
                { id: 'plan-a', kind: 'report', pathPattern: 'docs/output.md' },
              ],
            },
          },
          {
            stageId: 'b',
            groupId: 'b',
            autoTrigger: true,
            contract: {
              outputContract: [
                { id: 'plan-b', kind: 'report', pathPattern: 'docs/output.md' },
              ],
            },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('pathPattern');
    });

    it('allows same artifact id within the same stage (not a cross-stage conflict)', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            contract: {
              outputContract: [
                { id: 'unique-id', kind: 'report', pathPattern: 'docs/plan.md' },
              ],
            },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(true);
    });
  });

  // ── stageType ↔ contract consistency ──────────────────────────────────

  describe('stageType consistency', () => {
    it('warns when non-fan-out stage has fanOutContract', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            stageType: 'normal' as const,
            fanOutContract: { branchInputContract: [{ id: 'x', kind: 'data' }] },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.message.includes('fanOutContract'))).toBe(true);
    });

    it('warns when non-join stage has joinMergeContract', () => {
      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            stageType: 'normal' as const,
            joinMergeContract: { mergeStrategy: 'concat' },
          },
        ],
      });

      const result = validateTemplateContracts(t);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.message.includes('joinMergeContract'))).toBe(true);
    });
  });

  // ── Integration: validateTemplatePipeline includes contracts ──────────

  describe('pipeline-graph integration', () => {
    it('validateTemplatePipeline surfaces contract errors', async () => {
      const { validateTemplatePipeline } = await import('./pipeline-graph');

      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            contract: {
              outputContract: [
                { id: 'plan', kind: 'report', pathPattern: 'docs/plan.md' },
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
                { id: 'missing-data', kind: 'data' },
              ],
            },
          },
        ],
      });

      const errors = validateTemplatePipeline(t);
      expect(errors.some(e => e.includes('[Contract]'))).toBe(true);
    });

    it('validateTemplatePipeline passes when contracts match', async () => {
      const { validateTemplatePipeline } = await import('./pipeline-graph');

      const t = makeTemplate({
        pipeline: [
          {
            stageId: 'a',
            groupId: 'a',
            autoTrigger: false,
            contract: {
              outputContract: [
                { id: 'plan', kind: 'report', pathPattern: 'docs/plan.md' },
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
                { id: 'plan', kind: 'report' },
              ],
            },
          },
        ],
      });

      const errors = validateTemplatePipeline(t);
      expect(errors).toHaveLength(0);
    });
  });
});
