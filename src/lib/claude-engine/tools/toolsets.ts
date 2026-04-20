/**
 * Toolset System — 按场景组合工具
 * 
 * 借鉴 Hermes Agent 的 Toolset 模式：
 * - 按使用场景分组工具（research/coding/safe/full 等）
 * - 支持组合（includes 引用其他 toolset）
 * - 减少发送给 API 的 tool schema token（每个 tool schema ~200 tokens）
 */

import type { Tool } from '../types';
import { ToolRegistry } from './registry';

// ─── Types ──────────────────────────────────────────────────────

export type ToolsetDefinition = {
  description: string;
  /** Individual tool names in this toolset */
  tools: string[];
  /** Other toolsets to include (recursive composition) */
  includes: string[];
};

// ─── Built-in Toolset Definitions ───────────────────────────────

export const TOOLSETS: Record<string, ToolsetDefinition> = {
  // ── Basic categories ──────────────────────────────────────────

  web: {
    description: 'Web research and content extraction',
    tools: ['WebFetchTool', 'WebSearchTool'],
    includes: [],
  },

  file: {
    description: 'File read/write/edit operations',
    tools: ['FileReadTool', 'FileWriteTool', 'FileEditTool', 'NotebookEditTool'],
    includes: [],
  },

  search: {
    description: 'Code search tools (glob, grep)',
    tools: ['GlobTool', 'GrepTool'],
    includes: [],
  },

  shell: {
    description: 'Shell execution',
    tools: ['BashTool'],
    includes: [],
  },

  task: {
    description: 'Task management',
    tools: ['TaskCreateTool', 'TaskUpdateTool', 'TaskListTool', 'TaskGetTool', 'TodoWriteTool'],
    includes: [],
  },

  planning: {
    description: 'Planning mode tools',
    tools: ['EnterPlanModeTool', 'ExitPlanModeTool', 'VerifyPlanExecutionTool'],
    includes: [],
  },

  skill: {
    description: 'Skill lookup and management',
    tools: ['SkillTool', 'SkillManageTool'],
    includes: [],
  },

  memory: {
    description: 'Session search and history',
    tools: ['SessionSearchTool'],
    includes: [],
  },

  mcp: {
    description: 'MCP resource tools',
    tools: ['ListMcpResourcesTool', 'ReadMcpResourceTool'],
    includes: [],
  },

  // ── Composite toolsets ────────────────────────────────────────

  research: {
    description: 'Research mode — read-only tools for investigation',
    tools: ['AskUserQuestionTool', 'ToolSearchTool', 'ConfigTool'],
    includes: ['web', 'search', 'file', 'memory'],
  },

  coding: {
    description: 'Software development — file ops + shell + search',
    tools: ['AgentTool', 'AskUserQuestionTool', 'ToolSearchTool', 'ConfigTool'],
    includes: ['file', 'shell', 'search', 'task', 'planning', 'skill'],
  },

  safe: {
    description: 'Safe mode — no file writes, no shell',
    tools: ['FileReadTool', 'GlobTool', 'GrepTool', 'AskUserQuestionTool', 'ToolSearchTool'],
    includes: ['web', 'memory'],
  },

  full: {
    description: 'Full toolset — all available tools',
    tools: [],
    includes: ['file', 'shell', 'search', 'web', 'task', 'planning', 'skill', 'memory', 'mcp'],
  },
};

// ─── Resolver ───────────────────────────────────────────────────

/**
 * Resolve a toolset name to a flat list of tool names.
 * Handles recursive includes with cycle detection.
 */
export function resolveToolset(
  name: string,
  customToolsets?: Record<string, ToolsetDefinition>,
): string[] {
  const allToolsets = { ...TOOLSETS, ...customToolsets };
  const resolved = new Set<string>();
  const visited = new Set<string>();

  function resolve(toolsetName: string): void {
    if (visited.has(toolsetName)) return; // cycle protection
    visited.add(toolsetName);

    const def = allToolsets[toolsetName];
    if (!def) return;

    for (const tool of def.tools) {
      resolved.add(tool);
    }

    for (const included of def.includes) {
      resolve(included);
    }
  }

  resolve(name);
  return Array.from(resolved);
}

/**
 * Filter a registry's tools to only those in the specified toolset.
 */
export function filterByToolset(
  registry: ToolRegistry,
  toolsetName: string,
  customToolsets?: Record<string, ToolsetDefinition>,
): Tool[] {
  const allowedNames = new Set(resolveToolset(toolsetName, customToolsets));
  return registry.getAll().filter(tool => allowedNames.has(tool.name));
}

/**
 * List all available toolsets with their descriptions.
 */
export function listToolsets(
  customToolsets?: Record<string, ToolsetDefinition>,
): Array<{ name: string; description: string; toolCount: number }> {
  const all = { ...TOOLSETS, ...customToolsets };
  return Object.entries(all).map(([name, def]) => ({
    name,
    description: def.description,
    toolCount: resolveToolset(name, customToolsets).length,
  }));
}

/**
 * Estimate token savings from using a toolset vs full.
 * Average tool schema is ~200 tokens.
 */
export function estimateTokenSavings(
  toolsetName: string,
  fullToolCount: number,
  customToolsets?: Record<string, ToolsetDefinition>,
): { toolsetTools: number; savedTools: number; estimatedTokensSaved: number } {
  const toolsetTools = resolveToolset(toolsetName, customToolsets).length;
  const savedTools = Math.max(0, fullToolCount - toolsetTools);
  return {
    toolsetTools,
    savedTools,
    estimatedTokensSaved: savedTools * 200, // ~200 tokens per tool schema
  };
}
