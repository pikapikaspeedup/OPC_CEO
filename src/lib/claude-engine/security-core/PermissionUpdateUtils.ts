// @ts-nocheck — lightweight stub, replaces full PermissionUpdateUtils.ts
// Only exports what is used by bashPermissions.ts and pathValidation.ts

export function extractRules(
  settings: Record<string, unknown>,
  behavior: string,
): Array<{ toolName: string; ruleContent?: string; behavior: string; source: string }> {
  const key = `always${behavior.charAt(0).toUpperCase() + behavior.slice(1)}Rules`
  const rules = settings[key]
  if (!Array.isArray(rules)) return []
  return rules.map((r: any) => ({
    toolName: r.toolName || r,
    ruleContent: r.ruleContent,
    behavior,
    source: 'settings',
  }))
}

export function createReadRuleSuggestion(
  toolName: string,
  command: string,
): { toolName: string; ruleContent: string } {
  return { toolName, ruleContent: command }
}
