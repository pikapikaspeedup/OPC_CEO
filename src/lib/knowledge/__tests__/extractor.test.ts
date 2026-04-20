import { describe, expect, it } from 'vitest';

import { extractKnowledgeAssetsFromRun } from '../extractor';

describe('extractKnowledgeAssetsFromRun', () => {
  it('extracts decision and pattern assets from a completed run', () => {
    const assets = extractKnowledgeAssetsFromRun({
      runId: 'run-1234',
      workspaceUri: 'file:///tmp/workspace',
      result: {
        status: 'completed',
        summary: 'We decided to use Vitest for the new API module and updated the gateway route structure.',
        changedFiles: ['src/app/api/foo.ts', 'src/lib/bar.ts'],
        blockers: [],
        needsReview: [],
      },
      resolvedWorkflowRef: '/api_review',
      resolvedSkillRefs: ['testing'],
    });

    expect(assets.some((asset) => asset.category === 'decision')).toBe(true);
    expect(assets.some((asset) => asset.category === 'pattern')).toBe(true);
    expect(assets.every((asset) => asset.workspaceUri === 'file:///tmp/workspace')).toBe(true);
  });

  it('extracts lesson assets for blocked runs', () => {
    const assets = extractKnowledgeAssetsFromRun({
      runId: 'run-lesson',
      workspaceUri: 'file:///tmp/workspace',
      result: {
        status: 'blocked',
        summary: 'The run stalled because the provider key was missing.',
        changedFiles: [],
        blockers: ['Missing provider key'],
        needsReview: [],
      },
    });

    expect(assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'lesson',
          status: 'active',
        }),
      ]),
    );
  });

  it('turns workflowSuggestion into a workflow-proposal asset', () => {
    const assets = extractKnowledgeAssetsFromRun({
      runId: 'run-proposal',
      workspaceUri: 'file:///tmp/workspace',
      result: {
        status: 'completed',
        summary: 'Prompt run completed without a canonical workflow.',
        changedFiles: [],
        blockers: [],
        needsReview: [],
        promptResolution: {
          mode: 'skill',
          requestedWorkflowRefs: [],
          requestedSkillHints: ['research'],
          matchedWorkflowRefs: [],
          matchedSkillRefs: ['research'],
          resolutionReason: 'Skill fallback only.',
          workflowSuggestion: {
            shouldCreateWorkflow: true,
            source: 'skill',
            title: 'research-followup',
            reason: 'This task repeats often.',
            recommendedScope: 'department',
            evidence: {
              requestedWorkflowRefs: [],
              requestedSkillHints: ['research'],
              matchedWorkflowRefs: [],
              matchedSkillRefs: ['research'],
            },
          },
        },
      },
      promptResolution: {
        mode: 'skill',
        requestedWorkflowRefs: [],
        requestedSkillHints: ['research'],
        matchedWorkflowRefs: [],
        matchedSkillRefs: ['research'],
        resolutionReason: 'Skill fallback only.',
        workflowSuggestion: {
          shouldCreateWorkflow: true,
          source: 'skill',
          title: 'research-followup',
          reason: 'This task repeats often.',
          recommendedScope: 'department',
          evidence: {
            requestedWorkflowRefs: [],
            requestedSkillHints: ['research'],
            matchedWorkflowRefs: [],
            matchedSkillRefs: ['research'],
          },
        },
      },
    });

    expect(assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'workflow-proposal',
          status: 'proposal',
          title: 'research-followup',
        }),
      ]),
    );
  });
});
