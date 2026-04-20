export function parseMcpToolName(toolName: string): {
  serverName: string;
  toolName: string | undefined;
} | null {
  if (!toolName.startsWith('mcp__')) {
    return null;
  }

  const body = toolName.slice('mcp__'.length);

  if (!body) {
    return null;
  }

  const parts = body.split('__');
  const serverName = parts.shift();

  if (!serverName) {
    return null;
  }

  return {
    serverName,
    toolName: parts.length > 0 ? parts.join('__') : undefined,
  };
}

export function mcpToolMatchesRule(
  toolName: string,
  ruleToolName: string,
): boolean {
  const parsedToolName = parseMcpToolName(toolName);
  const parsedRuleToolName = parseMcpToolName(ruleToolName);

  if (!parsedToolName || !parsedRuleToolName) {
    return false;
  }

  if (parsedToolName.serverName !== parsedRuleToolName.serverName) {
    return false;
  }

  if (
    parsedRuleToolName.toolName === undefined ||
    parsedRuleToolName.toolName === '*'
  ) {
    return parsedToolName.toolName !== undefined;
  }

  return parsedToolName.toolName === parsedRuleToolName.toolName;
}