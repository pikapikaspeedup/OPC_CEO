import type { AppShellSection } from './home-shell';

export type AppUrlSection = AppShellSection;
export type AppUrlUtilityPanel = 'settings' | null;
export type AppUrlSettingsTab = 'profile' | 'provider' | 'api-keys' | 'scenes' | 'mcp' | 'messaging';
export type AppUrlSettingsFocus = 'third-party-provider' | null;

export interface AppUrlState {
  section: AppUrlSection;
  utilityPanel: AppUrlUtilityPanel;
  conversationId: string | null;
  conversationTitle: string | null;
  projectId: string | null;
  knowledgeId: string | null;
  settingsTab: AppUrlSettingsTab;
  settingsFocus: AppUrlSettingsFocus;
}

const VALID_SECTIONS = new Set<AppUrlSection>(['overview', 'conversations', 'projects', 'knowledge', 'operations', 'ceo']);
const VALID_SETTINGS_TABS = new Set<AppUrlSettingsTab>(['profile', 'provider', 'api-keys', 'scenes', 'mcp', 'messaging']);

function cleanParam(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function parseAppUrlState(search: string | URLSearchParams): AppUrlState {
  const params = typeof search === 'string'
    ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
    : search;

  const rawSection = cleanParam(params.get('section'));
  const rawTab = cleanParam(params.get('tab'));
  const rawFocus = cleanParam(params.get('focus'));
  const section = rawSection && VALID_SECTIONS.has(rawSection as AppUrlSection)
    ? rawSection as AppUrlSection
    : 'overview';

  return {
    section,
    utilityPanel: cleanParam(params.get('panel')) === 'settings' ? 'settings' : null,
    conversationId: section === 'ceo' || section === 'conversations'
      ? cleanParam(params.get('conversation'))
      : null,
    conversationTitle: section === 'ceo' || section === 'conversations'
      ? cleanParam(params.get('conversationTitle'))
      : null,
    projectId: section === 'projects' ? cleanParam(params.get('project')) : null,
    knowledgeId: section === 'knowledge' ? cleanParam(params.get('knowledge')) : null,
    settingsTab: rawTab && VALID_SETTINGS_TABS.has(rawTab as AppUrlSettingsTab)
      ? rawTab as AppUrlSettingsTab
      : 'provider',
    settingsFocus: rawFocus === 'third-party-provider' ? 'third-party-provider' : null,
  };
}

export function buildAppUrl(pathname: string, state: AppUrlState): string {
  const params = new URLSearchParams();

  params.set('section', state.section);

  if (state.utilityPanel === 'settings') {
    params.set('panel', 'settings');
    params.set('tab', state.settingsTab);
    if (state.settingsFocus) {
      params.set('focus', state.settingsFocus);
    }
  }

  if ((state.section === 'ceo' || state.section === 'conversations') && state.conversationId) {
    params.set('conversation', state.conversationId);
    if (state.conversationTitle) {
      params.set('conversationTitle', state.conversationTitle);
    }
  }

  if (state.section === 'projects' && state.projectId) {
    params.set('project', state.projectId);
  }

  if (state.section === 'knowledge' && state.knowledgeId) {
    params.set('knowledge', state.knowledgeId);
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
