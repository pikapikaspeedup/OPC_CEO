/**
 * Unified stubs for external dependencies.
 * Replaces: analytics, growthbook, feature flags, sandbox, and other claude-code internals.
 */

// ============================================================
// Analytics stubs (already configured via configureAnalytics)
// ============================================================

let _logEvent: (name: string, data?: Record<string, unknown>) => void = () => {}
let _logForDebugging: (msg: string, ...args: unknown[]) => void = () => {}

export function configureAnalytics(
  logFn: (name: string, data?: Record<string, unknown>) => void,
): void {
  _logEvent = logFn
}

export function configureDebugLog(
  logFn: (msg: string, ...args: unknown[]) => void,
): void {
  _logForDebugging = logFn
}

export const logEvent = (name: string, data?: Record<string, unknown>) => _logEvent(name, data)
export const logForDebugging = (msg: string, ...args: unknown[]) => _logForDebugging(msg, ...args)

// ============================================================
// GrowthBook stub
// ============================================================

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  _featureName: string,
  defaultValue: T,
): T {
  return defaultValue
}

// ============================================================
// Feature flags stub
// ============================================================

let _featureFlags: Record<string, boolean> = {}

export function configureFeatureFlags(flags: Record<string, boolean>): void {
  _featureFlags = { ..._featureFlags, ...flags }
}

export function feature(name: string): boolean {
  return _featureFlags[name] ?? false
}

// ============================================================
// Sandbox Manager stub
// ============================================================

export class SandboxManager {
  static getSandboxManager(): SandboxManager | null {
    return null
  }

  static isSandboxActive(): boolean {
    return false
  }

  static isSandboxingEnabled(): boolean {
    return false
  }

  isSandboxAvailable(): boolean {
    return false
  }

  async ensureSandboxReady(): Promise<void> {}
}

// ============================================================
// APIUserAbortError stub
// ============================================================

export class APIUserAbortError extends Error {
  constructor(message = 'User aborted') {
    super(message)
    this.name = 'APIUserAbortError'
  }
}

export class AbortError extends Error {
  constructor(message = 'Aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

// ============================================================
// Runtime Context (injected by caller)
// ============================================================

export type SecurityContext = {
  /** Current working directory */
  cwd: string
  /** Original working directory at CLI start */
  originalCwd: string
  /** Project root directory */
  projectRoot: string
  /** All allowed working directories */
  workingDirectories: string[]
  /** Platform override */
  platform?: 'darwin' | 'linux' | 'win32'
  /** Whether running in a bare git repo */
  isBareGitRepo?: boolean
}

let _context: SecurityContext = {
  cwd: process.cwd(),
  originalCwd: process.cwd(),
  projectRoot: process.cwd(),
  workingDirectories: [process.cwd()],
}

export function configureSecurityContext(ctx: Partial<SecurityContext>): void {
  _context = { ..._context, ...ctx }
}

export function getSecurityContext(): SecurityContext {
  return _context
}

export function getCwd(): string {
  return _context.cwd
}

export function getOriginalCwd(): string {
  return _context.originalCwd
}

export function getProjectRoot(): string {
  return _context.projectRoot
}

export function allWorkingDirectories(): string[] {
  return _context.workingDirectories
}

export function getPlatform(): string {
  return _context.platform ?? process.platform
}

export function isCurrentDirectoryBareGitRepo(): boolean {
  return _context.isBareGitRepo ?? false
}

// ============================================================
// Utility stubs
// ============================================================

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value)
}

export function isEnvTruthy(name: string): boolean {
  const val = process.env[name]
  return val === '1' || val === 'true' || val === 'yes'
}

export function count<T>(arr: T[], predicate: (item: T) => boolean): number {
  return arr.reduce((acc, item) => acc + (predicate(item) ? 1 : 0), 0)
}

export function plural(n: number, singular: string, pluralStr?: string): string {
  return n === 1 ? singular : (pluralStr ?? `${singular}s`)
}

export function windowsPathToPosixPath(p: string): string {
  return p.replace(/\\/g, '/')
}

export function getDirectoryForPath(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/')
  return lastSlash === -1 ? '.' : filePath.substring(0, lastSlash)
}

// ============================================================
// Shell prefix stub (LLM-based classification — not available standalone)
// ============================================================

export function createCommandPrefixExtractor(_options?: unknown): (cmd: string) => Promise<string | null> {
  // LLM-based prefix extraction not available in standalone mode
  return async () => null
}

export function createSubcommandPrefixExtractor(_options?: unknown): (cmd: string) => Promise<string | null> {
  return async () => null
}

// ============================================================
// Settings stub
// ============================================================

export function getSettings_DEPRECATED(): Record<string, unknown> {
  return {}
}

// ============================================================
// Permission mode utilities
// ============================================================

export function permissionModeTitle(mode: string): string {
  const titles: Record<string, string> = {
    default: 'Default',
    acceptEdits: 'Accept Edits',
    plan: 'Plan',
    bypassPermissions: 'Full Auto',
    dontAsk: "Don't Ask",
  }
  return titles[mode] ?? mode
}

// ============================================================
// Bash classifier stub (ANT-only, not available externally)
// ============================================================

export const PROMPT_PREFIX = 'prompt:'

export type ClassifierResult = {
  classification: 'safe' | 'unsafe' | 'unknown'
  confidence: number
}

export function isClassifierPermissionsEnabled(): boolean {
  return false
}

export function classifyBashCommand(): ClassifierResult {
  return { classification: 'unknown', confidence: 0 }
}

export function getBashPromptDescriptions(): string[] {
  return []
}

// ============================================================
// MCP utils stub
// ============================================================

export function getToolNameForPermissionCheck(toolName: string): string {
  return toolName
}

export function mcpInfoFromString(_s: string): null {
  return null
}

// ============================================================
// Permission setup stubs
// ============================================================

export function getSettingSourceDisplayNameLowercase(source: string): string {
  return source.toLowerCase()
}

export const SETTING_SOURCES = {
  local: 'local',
  global: 'global',
  project: 'project',
} as const

// ============================================================
// Error stubs
// ============================================================

export function startsWithApiErrorPrefix(_msg: string): boolean {
  return false
}

// ============================================================
// Lazy schema stub
// ============================================================

export function lazySchema<T>(creator: () => T): () => T {
  let cached: T | undefined
  return () => {
    if (!cached) cached = creator()
    return cached
  }
}

// ============================================================
// System prompt type stub
// ============================================================

export function asSystemPrompt(text: string): { type: 'text'; text: string } {
  return { type: 'text', text }
}

// ============================================================
// Analytics metadata type
// ============================================================

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = Record<string, unknown>

// ============================================================
// Settings loader stubs
// ============================================================

export type SettingsJson = Record<string, unknown>
export type EditableSettingSource = 'local' | 'global' | 'project'

export function getSettingsForSource(_source: string): Record<string, unknown> {
  return {}
}

export function updateSettingsForSource(
  _source: string,
  _updater: (settings: Record<string, unknown>) => Record<string, unknown>,
): void {}

export function getFsImplementation() {
  return {
    readFile: async (p: string) => {
      const fs = await import('fs/promises')
      return fs.readFile(p, 'utf-8')
    },
    writeFile: async (p: string, data: string) => {
      const fs = await import('fs/promises')
      await fs.writeFile(p, data)
    },
    exists: async (p: string) => {
      try {
        const fs = await import('fs/promises')
        await fs.access(p)
        return true
      } catch {
        return false
      }
    },
  }
}

// ============================================================
// GrowthBook v2 stub
// ============================================================

export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  _featureName: string,
  defaultValue: T,
): T {
  return defaultValue
}
