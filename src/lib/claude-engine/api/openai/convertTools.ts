/**
 * Anthropic 工具定义 → OpenAI function tools 转换
 * 从 claude-code/src/services/api/openai/convertTools.ts 移植
 */
import type { APITool } from '../types';

export type OpenAITool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
};

/**
 * Convert Anthropic tool definitions to OpenAI function tool format.
 */
export function anthropicToolsToOpenAI(tools: APITool[]): OpenAITool[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

/**
 * Convert Anthropic tool_choice to OpenAI format.
 */
export function anthropicToolChoiceToOpenAI(
  toolChoice?: { type: string; name?: string },
): 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } } | undefined {
  if (!toolChoice) return undefined;

  switch (toolChoice.type) {
    case 'auto':
      return 'auto';
    case 'none':
      return 'none';
    case 'any':
      return 'required';
    case 'tool':
      if (toolChoice.name) {
        return { type: 'function', function: { name: toolChoice.name } };
      }
      return 'auto';
    default:
      return 'auto';
  }
}
