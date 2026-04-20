/**
 * Minimal Tool interface types for standalone security-core.
 * Replaces full Tool.ts / BashTool.ts dependencies.
 */

import type { PermissionBehavior } from './permissions'

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = Record<string, unknown>

export interface PermissionRule {
  toolName: string
  ruleContent?: string
  behavior: PermissionBehavior
  source: string
}

export interface ToolPermissionContext {
  cwd: string
  permissionMode: string
  mode?: string
  permissionRules: PermissionRule[]
  alwaysAllowRules?: PermissionRule[]
  alwaysDenyRules?: PermissionRule[]
  alwaysAskRules?: PermissionRule[]
  abortController: AbortController
  options?: Record<string, unknown>
  projectRoot?: string
}

export interface AppState {
  permissions?: {
    allowRules?: PermissionRule[]
    denyRules?: PermissionRule[]
  }
}

export interface ToolUseContext extends ToolPermissionContext {
  sessionId?: string
  getAppState?: () => AppState
  options?: Record<string, unknown>
}

export interface Tool {
  name: string
  inputJSONSchema?: Record<string, unknown>
  inputSchema?: Record<string, unknown>
}

/**
 * BashTool stub
 */
export const BashTool: Tool = {
  name: 'BashTool' as const,
  inputJSONSchema: {},
  inputSchema: {
    properties: {
      command: { type: 'string' },
    },
  },
}

export type BashToolType = typeof BashTool

// Type used by analytics
export type CanUseToolFn = (toolName: string, input: unknown) => boolean | Promise<boolean>

