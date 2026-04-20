/**
 * Gemini 模型映射
 * 从 claude-code/src/services/api/gemini/modelMapping.ts 移植
 * 
 * 环境变量优先级:
 * 1. GEMINI_MODEL (全局覆盖)
 * 2. GEMINI_DEFAULT_{FAMILY}_MODEL
 * 3. 默认映射
 */

const DEFAULT_GEMINI_MAP: Record<string, string> = {
  'claude-opus-4-20250514': 'gemini-2.5-pro',
  'claude-sonnet-4-20250514': 'gemini-2.5-flash',
  'claude-3-5-sonnet-20241022': 'gemini-2.5-flash',
  'claude-3-5-haiku-20241022': 'gemini-2.0-flash-lite',
};

function getModelFamily(model: string): string | null {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return null;
}

export function resolveGeminiModel(anthropicModel: string): string {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;

  const family = getModelFamily(anthropicModel);
  if (family) {
    const envKey = `GEMINI_DEFAULT_${family.toUpperCase()}_MODEL`;
    const envVal = process.env[envKey];
    if (envVal) return envVal;
  }

  return DEFAULT_GEMINI_MAP[anthropicModel] ?? anthropicModel;
}
