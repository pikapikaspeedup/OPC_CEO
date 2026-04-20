// @ts-nocheck — lightweight stub, replaces full permissionsCore.ts
// Only exports the 2 functions used by bashPermissions.ts and bashCommandHelpers.ts

export function createPermissionRequestMessage(
  toolName: string,
  _input: unknown,
  _context?: unknown,
  message?: string,
): { toolName: string; message: string; input: unknown } {
  return {
    toolName,
    message: message || `Permission required for ${toolName}`,
    input: _input,
  }
}

export function getRuleByContentsForTool(
  rules: Array<{ toolName: string; ruleContent?: string }>,
  toolName: string,
  content?: string,
): { toolName: string; ruleContent?: string } | undefined {
  return rules.find(
    (r) =>
      r.toolName === toolName &&
      (content === undefined || r.ruleContent === content),
  )
}
