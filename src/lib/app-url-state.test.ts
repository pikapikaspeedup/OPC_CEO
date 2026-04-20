import { describe, expect, it } from 'vitest';
import { buildAppUrl, parseAppUrlState } from './app-url-state';

describe('app-url-state', () => {
  it('falls back to the projects section for invalid URLs', () => {
    expect(parseAppUrlState('?section=unknown&conversation=abc')).toEqual({
      section: 'projects',
      utilityPanel: null,
      conversationId: null,
      conversationTitle: null,
      projectId: null,
      knowledgeId: null,
      settingsTab: 'provider',
      settingsFocus: null,
    });
  });

  it('keeps only section-relevant targets when parsing', () => {
    expect(
      parseAppUrlState(
        '?section=ceo&conversation=local-native-codex-1&conversationTitle=CEO%20Office&project=p-1&knowledge=k-1',
      ),
    ).toEqual({
      section: 'ceo',
      utilityPanel: null,
      conversationId: 'local-native-codex-1',
      conversationTitle: 'CEO Office',
      projectId: null,
      knowledgeId: null,
      settingsTab: 'provider',
      settingsFocus: null,
    });
  });

  it('builds canonical URLs for settings over a selected project', () => {
    expect(
      buildAppUrl('/', {
        section: 'projects',
        utilityPanel: 'settings',
        conversationId: null,
        conversationTitle: null,
        projectId: 'proj-42',
        knowledgeId: null,
        settingsTab: 'api-keys',
        settingsFocus: 'third-party-provider',
      }),
    ).toBe('/?section=projects&panel=settings&tab=api-keys&focus=third-party-provider&project=proj-42');
  });

  it('round-trips conversation URLs with human-readable titles', () => {
    const url = buildAppUrl('/', {
      section: 'conversations',
      utilityPanel: null,
      conversationId: 'local-openai-api-7',
      conversationTitle: 'OpenAI API: demo',
      projectId: null,
      knowledgeId: null,
      settingsTab: 'provider',
      settingsFocus: null,
    });

    expect(url).toBe('/?section=conversations&conversation=local-openai-api-7&conversationTitle=OpenAI+API%3A+demo');
    expect(parseAppUrlState(url.split('?')[1] || '')).toEqual({
      section: 'conversations',
      utilityPanel: null,
      conversationId: 'local-openai-api-7',
      conversationTitle: 'OpenAI API: demo',
      projectId: null,
      knowledgeId: null,
      settingsTab: 'provider',
      settingsFocus: null,
    });
  });
});
