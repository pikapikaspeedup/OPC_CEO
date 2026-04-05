/**
 * Security Policy Loader — Organization/Department Policy Resolution
 *
 * Loads and merges security policies from multiple sources:
 * 1. Organization default (ai-config.json → security section)
 * 2. Department override (.department/config.json → security section)
 * 3. Group override (GroupDefinition → permissionMode)
 *
 * CCB reference:
 * - permissionsLoader.ts — loads rules from user/project/local settings
 * - managed policy — allowManagedPermissionRulesOnly
 * - HitCC 04-policy-sandbox-and-approval-backends.md
 *
 * OPC adaptation:
 * - Policy sources are organization > department > group (not user/project/local)
 * - When managedRulesOnly is true, department/group rules are ignored
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../logger';
import type { PermissionMode, PermissionRule, SecurityPolicy, SandboxConfig } from './types';
import { DEFAULT_SECURITY_POLICY } from './types';

const log = createLogger('PolicyLoader');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GATEWAY_HOME = path.join(
  process.env.HOME ?? process.env.USERPROFILE ?? '/tmp',
  '.gemini',
  'antigravity',
);

const SECURITY_POLICY_PATH = path.join(GATEWAY_HOME, 'security-policy.json');
const DEPARTMENT_CONFIG_FILE = '.department/config.json';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cachedPolicy: SecurityPolicy | null = null;

export function resetPolicyCache(): void {
  cachedPolicy = null;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Load the organization-level security policy.
 *
 * @returns The security policy (default if no config file exists)
 */
export function loadSecurityPolicy(): SecurityPolicy {
  if (cachedPolicy) return cachedPolicy;

  try {
    if (fs.existsSync(SECURITY_POLICY_PATH)) {
      const raw = fs.readFileSync(SECURITY_POLICY_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      cachedPolicy = {
        ...DEFAULT_SECURITY_POLICY,
        ...parsed,
        sandbox: { ...DEFAULT_SECURITY_POLICY.sandbox, ...(parsed.sandbox ?? {}) },
        bash: { ...DEFAULT_SECURITY_POLICY.bash, ...(parsed.bash ?? {}) },
      };
      log.info('Security policy loaded from file');
    } else {
      cachedPolicy = { ...DEFAULT_SECURITY_POLICY };
      log.info('Using default security policy');
    }
  } catch (err: any) {
    log.warn({ err: err.message }, 'Failed to load security policy, using default');
    cachedPolicy = { ...DEFAULT_SECURITY_POLICY };
  }

  return cachedPolicy!;
}

/**
 * Resolve the effective security configuration for a specific workspace.
 *
 * Merges: organization policy + department config + group overrides
 *
 * @param workspace Workspace path
 * @param groupOverrides Optional group-level overrides
 * @returns Resolved security settings
 */
export function resolveSecurityConfig(
  workspace: string,
  groupOverrides?: {
    permissionMode?: PermissionMode
    additionalAllowRules?: PermissionRule[]
    additionalDenyRules?: PermissionRule[]
  },
): {
  mode: PermissionMode
  rules: PermissionRule[]
  sandbox: SandboxConfig
} {
  const orgPolicy = loadSecurityPolicy();

  // Start with organization-level settings
  let mode: PermissionMode = orgPolicy.defaultMode;
  const rules: PermissionRule[] = [...orgPolicy.denyRules, ...orgPolicy.allowRules];

  // If managedRulesOnly, skip department/group rules
  if (!orgPolicy.managedRulesOnly) {
    // Load department-level overrides
    const deptConfig = loadDepartmentSecurityConfig(workspace);
    if (deptConfig) {
      if (deptConfig.permissionMode) mode = deptConfig.permissionMode;
      if (deptConfig.allowRules) rules.push(...deptConfig.allowRules);
      if (deptConfig.denyRules) rules.push(...deptConfig.denyRules);
    }

    // Apply group-level overrides
    if (groupOverrides) {
      if (groupOverrides.permissionMode) mode = groupOverrides.permissionMode;
      if (groupOverrides.additionalAllowRules) rules.push(...groupOverrides.additionalAllowRules);
      if (groupOverrides.additionalDenyRules) rules.push(...groupOverrides.additionalDenyRules);
    }
  }

  // Merge sandbox config with permission rules
  const sandbox = orgPolicy.sandbox;

  return { mode, rules, sandbox };
}

// ---------------------------------------------------------------------------
// Department config loading
// ---------------------------------------------------------------------------

interface DepartmentSecurityConfig {
  permissionMode?: PermissionMode
  allowRules?: PermissionRule[]
  denyRules?: PermissionRule[]
}

function loadDepartmentSecurityConfig(workspace: string): DepartmentSecurityConfig | null {
  try {
    const configPath = path.join(workspace, DEPARTMENT_CONFIG_FILE);
    if (!fs.existsSync(configPath)) return null;

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);

    const config: DepartmentSecurityConfig = {};

    if (parsed.security?.permissionMode) {
      config.permissionMode = parsed.security.permissionMode;
    }

    // Parse allow/deny rules from department config
    if (parsed.security?.allowRules) {
      config.allowRules = parseRuleArray(parsed.security.allowRules, 'allow', 'department');
    }
    if (parsed.security?.denyRules) {
      config.denyRules = parseRuleArray(parsed.security.denyRules, 'deny', 'department');
    }

    return config;
  } catch (err: any) {
    log.debug({ workspace, err: err.message }, 'No department security config');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRuleArray(
  rules: string[],
  behavior: 'allow' | 'deny',
  source: PermissionRule['source'],
): PermissionRule[] {
  return rules.map(ruleStr => {
    const match = ruleStr.match(/^([^(]+)(?:\(([^)]*)\))?$/);
    return {
      source,
      behavior,
      value: {
        toolName: match?.[1] ?? ruleStr,
        ruleContent: match?.[2] ?? undefined,
      },
    };
  });
}
