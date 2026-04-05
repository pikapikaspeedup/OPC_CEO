import { describe, expect, it, beforeEach } from 'vitest';
import {
  generatePipeline,
  confirmDraft,
  getDraft,
  isDraftConfirmed,
  extractJsonFromResponse,
  buildGenerationPrompt,
  _clearDrafts,
} from './pipeline-generator';
import { buildGenerationContext } from './generation-context';
import type { TemplateDefinition } from './pipeline-types';

const baseGroup = { title: 'G', description: 'g', executionMode: 'review-loop' as const, roles: [] };

function makeTemplate(): TemplateDefinition {
  return {
    id: 'test',
    kind: 'template',
    title: 'Test',
    description: 'test',
    groups: { dev: baseGroup, review: baseGroup },
    pipeline: [{ groupId: 'dev' }, { groupId: 'review' }],
  };
}

const VALID_LLM_RESPONSE = JSON.stringify({
  graphPipeline: {
    nodes: [
      { id: 'dev', kind: 'stage', groupId: 'dev' },
      { id: 'review', kind: 'stage', groupId: 'review' },
    ],
    edges: [{ from: 'dev', to: 'review' }],
  },
  title: 'Dev Pipeline',
  description: 'A simple dev pipeline',
  explanation: 'Two stages: development then review.',
});

const FENCED_LLM_RESPONSE = '```json\n' + VALID_LLM_RESPONSE + '\n```';

beforeEach(() => {
  _clearDrafts();
});

describe('extractJsonFromResponse', () => {
  it('parses bare JSON', () => {
    const result = extractJsonFromResponse(VALID_LLM_RESPONSE);
    expect(result.graphPipeline).toBeDefined();
    expect(result.graphPipeline!.nodes).toHaveLength(2);
  });

  it('parses fenced code block', () => {
    const result = extractJsonFromResponse(FENCED_LLM_RESPONSE);
    expect(result.graphPipeline).toBeDefined();
    expect(result.title).toBe('Dev Pipeline');
  });

  it('parses JSON with surrounding text', () => {
    const raw = 'Here is the pipeline:\n' + VALID_LLM_RESPONSE + '\nDone.';
    const result = extractJsonFromResponse(raw);
    expect(result.graphPipeline).toBeDefined();
  });

  it('throws on no JSON found', () => {
    expect(() => extractJsonFromResponse('no json here')).toThrow(/No valid JSON/);
  });
});

describe('buildGenerationPrompt', () => {
  it('includes goal in prompt', () => {
    const ctx = buildGenerationContext([makeTemplate()]);
    const prompt = buildGenerationPrompt({ goal: 'Build a web app' }, ctx);
    expect(prompt).toContain('Build a web app');
  });

  it('includes constraints', () => {
    const ctx = buildGenerationContext([]);
    const prompt = buildGenerationPrompt({
      goal: 'test',
      constraints: { maxStages: 5, allowFanOut: false, techStack: 'React' },
    }, ctx);
    expect(prompt).toContain('Maximum 5 stages');
    expect(prompt).toContain('Do NOT use fan-out');
    expect(prompt).toContain('React');
  });

  it('includes available groups', () => {
    const ctx = buildGenerationContext([makeTemplate()]);
    const prompt = buildGenerationPrompt({ goal: 'test' }, ctx);
    expect(prompt).toContain('dev:');
    expect(prompt).toContain('review:');
  });
});

describe('generatePipeline', () => {
  it('generates a valid draft', async () => {
    const callLLM = async () => VALID_LLM_RESPONSE;
    const result = await generatePipeline(
      { goal: 'Build a web app' },
      [makeTemplate()],
      callLLM,
    );

    expect(result.status).toBe('draft');
    expect(result.draftId).toBeDefined();
    expect(result.graphPipeline.nodes).toHaveLength(2);
    expect(result.templateMeta.title).toBe('Dev Pipeline');
    expect(result.explanation).toBe('Two stages: development then review.');
    expect(result.validation).toBeDefined();
    expect(result.risks).toBeDefined();
  });

  it('stores draft for later retrieval', async () => {
    const callLLM = async () => VALID_LLM_RESPONSE;
    const result = await generatePipeline({ goal: 'test' }, [makeTemplate()], callLLM);

    const draft = getDraft(result.draftId);
    expect(draft).not.toBeNull();
    expect(draft!.draftId).toBe(result.draftId);
  });

  it('throws on invalid LLM response (no graphPipeline)', async () => {
    const callLLM = async () => JSON.stringify({ title: 'no pipeline' });
    await expect(
      generatePipeline({ goal: 'test' }, [], callLLM),
    ).rejects.toThrow(/valid graphPipeline/);
  });

  it('throws on unparseable LLM response', async () => {
    const callLLM = async () => 'this is not json';
    await expect(
      generatePipeline({ goal: 'test' }, [], callLLM),
    ).rejects.toThrow();
  });

  it('includes validation results', async () => {
    const callLLM = async () => VALID_LLM_RESPONSE;
    const result = await generatePipeline({ goal: 'test' }, [makeTemplate()], callLLM);
    expect(result.validation.valid).toBe(true);
    expect(result.validation.dagErrors).toEqual([]);
  });
});

describe('confirmDraft', () => {
  it('confirms a valid draft', async () => {
    const callLLM = async () => VALID_LLM_RESPONSE;
    const draft = await generatePipeline({ goal: 'test' }, [makeTemplate()], callLLM);

    const result = await confirmDraft(draft.draftId);
    expect(result.saved).toBe(true);
    expect(result.templateId).toBeDefined();
    expect(isDraftConfirmed(draft.draftId)).toBe(true);
  });

  it('rejects expired/nonexistent draft', async () => {
    const result = await confirmDraft('nonexistent');
    expect(result.saved).toBe(false);
    expect(result.validationErrors).toContain('Draft not found or expired');
  });

  it('prevents double confirmation', async () => {
    const callLLM = async () => VALID_LLM_RESPONSE;
    const draft = await generatePipeline({ goal: 'test' }, [makeTemplate()], callLLM);

    await confirmDraft(draft.draftId);
    const second = await confirmDraft(draft.draftId);
    expect(second.saved).toBe(false);
    expect(second.validationErrors).toContain('Draft already confirmed');
  });

  it('applies template meta modifications', async () => {
    const callLLM = async () => VALID_LLM_RESPONSE;
    const draft = await generatePipeline({ goal: 'test' }, [makeTemplate()], callLLM);

    const result = await confirmDraft(draft.draftId, {
      templateMeta: { title: 'Modified Title' },
    });
    expect(result.saved).toBe(true);

    // The draft itself should be updated
    const stored = getDraft(draft.draftId);
    expect(stored!.templateMeta.title).toBe('Modified Title');
  });

  it('rejects when modifications introduce validation errors', async () => {
    const callLLM = async () => VALID_LLM_RESPONSE;
    const draft = await generatePipeline({ goal: 'test' }, [makeTemplate()], callLLM);

    // Modify to have a loop-start without config → validation error
    const result = await confirmDraft(draft.draftId, {
      graphPipeline: {
        nodes: [{ id: 'ls', kind: 'loop-start', groupId: 'dev' }],
        edges: [],
      },
    });
    expect(result.saved).toBe(false);
    expect(result.validationErrors!.length).toBeGreaterThan(0);
  });
});
