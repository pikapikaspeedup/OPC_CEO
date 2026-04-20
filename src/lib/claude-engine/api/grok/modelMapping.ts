/**
 * Grok 模型映射
 * 从 claude-code/src/services/api/grok/modelMapping.ts 移植
 * 
 * 环境变量:
 * 1. GROK_MODEL (全局覆盖)
 * 2. GROK_MODEL_MAP (JSON, 如 {"opus":"grok-4","sonnet":"grok-3"})
 * 3. GROK_DEFAULT_{FAMILY}_MODEL
 * 4. 默认映射
 */

const DEFAULT_GROK_MAP: Record<string, string> = {
  opus: 'grok-3',
  sonnet: 'grok-3-mini',
  haiku: 'grok-3-mini',
};

function getModelFamily(model: string): string | null {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return null;
}

export function resolveGrokModel(anthropicModel: string): string {
  // 1. Global override
  if (process.env.GROK_MODEL) return process.env.GROK_MODEL;

  // 2. JSON model map
  if (process.env.GROK_MODEL_MAP) {
    try {
      const map = JSON.parse(process.env.GROK_MODEL_MAP) as Record<string, string>;
      const family = getModelFamily(anthropicModel);
      if (family && map[family]) return map[family];
    } catch { /* ignore bad JSON */ }
  }

  // 3. Per-family env var
  const family = getModelFamily(anthropicModel);
  if (family) {
    const envKey = `GROK_DEFAULT_${family.toUpperCase()}_MODEL`;
    const envVal = process.env[envKey];
    if (envVal) return envVal;
  }

  // 4. Default
  return (family && DEFAULT_GROK_MAP[family]) || anthropicModel;
}
