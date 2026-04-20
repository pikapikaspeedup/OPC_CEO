/**
 * OpenAI 模型映射
 * 从 claude-code/src/services/api/openai/modelMapping.ts 移植
 * 
 * 环境变量优先级:
 * 1. OPENAI_MODEL (全局覆盖)
 * 2. OPENAI_DEFAULT_{FAMILY}_MODEL (按家族)
 * 3. 默认映射表
 */

const DEFAULT_MODEL_MAP: Record<string, string> = {
  // Claude → OpenAI 映射
  'claude-opus-4-20250514': 'o3',
  'claude-sonnet-4-20250514': 'gpt-4o',
  'claude-3-5-sonnet-20241022': 'gpt-4o',
  'claude-3-5-haiku-20241022': 'gpt-4o-mini',
  'claude-3-opus-20240229': 'o3',
  'claude-3-sonnet-20240229': 'gpt-4o',
  'claude-3-haiku-20240307': 'gpt-4o-mini',
};

function getModelFamily(model: string): string | null {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return null;
}

export function resolveOpenAIModel(anthropicModel: string): string {
  // 1. Global override
  if (process.env.OPENAI_MODEL) {
    return process.env.OPENAI_MODEL;
  }

  // 2. Per-family override
  const family = getModelFamily(anthropicModel);
  if (family) {
    const envKey = `OPENAI_DEFAULT_${family.toUpperCase()}_MODEL`;
    const envVal = process.env[envKey];
    if (envVal) return envVal;

    // Backwards compat
    const anthKey = `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`;
    const anthVal = process.env[anthKey];
    if (anthVal) return anthVal;
  }

  // 3. Default map
  return DEFAULT_MODEL_MAP[anthropicModel] ?? anthropicModel;
}
