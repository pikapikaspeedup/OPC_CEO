import { loadAIConfig } from './providers/ai-config';
import { getProviderInventory } from './providers/provider-inventory';
import type { ModelsResponse } from './types';

type ModelEntry = NonNullable<ModelsResponse['clientModelConfigs']>[number];

function makeEntry(label: string, model: string, isRecommended = false, tagTitle?: string): ModelEntry {
  return {
    label,
    modelOrAlias: { model },
    isRecommended,
    ...(tagTitle ? { tagTitle } : {}),
  };
}

export function buildProviderAwareModelResponse(): ModelsResponse {
  const inventory = getProviderInventory();
  const aiConfig = loadAIConfig();
  const entries: ModelEntry[] = [];

  if (inventory.providers.nativeCodex.loggedIn) {
    entries.push(makeEntry('Native Codex · GPT-5.4', 'gpt-5.4', true));
    entries.push(makeEntry('Native Codex · GPT-5.4 Mini', 'gpt-5.4-mini'));
  }

  if (inventory.anthropic.set) {
    entries.push(makeEntry('Claude API · Sonnet 4', 'claude-sonnet-4-20250514', true));
    entries.push(makeEntry('Claude API · Haiku 4', 'claude-haiku-4-20250404'));
  }

  if (inventory.openai.set) {
    entries.push(makeEntry('OpenAI API · GPT-4.1', 'gpt-4.1', true));
    entries.push(makeEntry('OpenAI API · GPT-4.1 Mini', 'gpt-4.1-mini'));
  }

  if (inventory.gemini.set) {
    entries.push(makeEntry('Gemini API · Gemini 2.5 Pro', 'gemini-2.5-pro', true));
    entries.push(makeEntry('Gemini API · Gemini 2.5 Flash', 'gemini-2.5-flash'));
  }

  if (inventory.grok.set) {
    entries.push(makeEntry('Grok API · Grok 3', 'grok-3', true));
    entries.push(makeEntry('Grok API · Grok 3 Mini', 'grok-3-mini'));
  }

  if (aiConfig.customProvider?.defaultModel) {
    entries.push(makeEntry(
      `Custom API · ${aiConfig.customProvider.defaultModel}`,
      aiConfig.customProvider.defaultModel,
      true,
      aiConfig.customProvider.vendor ? `Preset: ${aiConfig.customProvider.vendor}` : undefined,
    ));
  }

  const deduped = new Map<string, ModelEntry>();
  for (const entry of entries) {
    const model = entry.modelOrAlias?.model;
    if (!model || deduped.has(model)) continue;
    deduped.set(model, entry);
  }

  return {
    clientModelConfigs: [...deduped.values()],
  };
}

export function mergeModelResponses(primary: ModelsResponse, fallback: ModelsResponse): ModelsResponse {
  const merged = new Map<string, ModelEntry>();

  for (const entry of primary.clientModelConfigs || []) {
    const model = entry.modelOrAlias?.model;
    if (!model) continue;
    merged.set(model, entry);
  }

  for (const entry of fallback.clientModelConfigs || []) {
    const model = entry.modelOrAlias?.model;
    if (!model || merged.has(model)) continue;
    merged.set(model, entry);
  }

  return {
    ...primary,
    clientModelConfigs: [...merged.values()],
  };
}
