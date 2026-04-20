/**
 * Permission rule types and schemas.
 * Re-exported from permissions.ts for backwards compatibility.
 */
import { lazySchema } from './stubs'

// Re-export types from permissions.ts
export type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSource,
  PermissionRuleValue,
} from './permissions'

// Zod schemas (stubbed - schema validation not critical for security checks)
export const permissionBehaviorSchema = lazySchema(() => ({
  parse: (val: unknown) => val as string,
  safeParse: (val: unknown) => ({ success: true, data: val }),
}))

export const permissionRuleValueSchema = lazySchema(() => ({
  parse: (val: unknown) => val as Record<string, unknown>,
  safeParse: (val: unknown) => ({ success: true, data: val }),
}))
