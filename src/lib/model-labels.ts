import type { ModelConfig } from './types';

export function getModelLabel(
  model: string | undefined,
  models: ModelConfig[],
  options?: {
    autoLabel?: string;
    emptyLabel?: string;
  },
): string {
  const autoLabel = options?.autoLabel || 'Auto';
  const emptyLabel = options?.emptyLabel || 'Group Default';

  if (!model) return emptyLabel;
  if (model === 'MODEL_AUTO') return autoLabel;

  return models.find(entry => entry.modelOrAlias?.model === model)?.label
    || model.replace(/^MODEL_PLACEHOLDER_/, '')
    || emptyLabel;
}
