/**
 * Sandbox Manager — Filesystem/Network Isolation
 *
 * Manages sandbox configuration for tool execution.
 * When using Codex CLI, delegates to its built-in sandbox.
 * When using LLM API directly, provides Gateway-enforced sandbox.
 *
 * CCB reference:
 * - src/utils/sandbox/sandbox-adapter.ts — SandboxManager
 * - RG8(...) — Merge permission rules into sandbox config
 * - HitCC 04-policy-sandbox-and-approval-backends.md — Sandbox merge logic
 *
 * Key insight from CCB:
 * Sandbox does NOT replace permission rules. It's an additional enforcement layer.
 * Edit(path) allow rules merge into sandbox allowWrite set.
 * WebFetch(domain:) allow rules merge into sandbox allowedDomains.
 */

import * as path from 'path';
import { createLogger } from '../logger';
import type {
  PermissionRule,
  SandboxConfig,
  SandboxFilesystem,
  SandboxNetwork,
} from './types';
import { DEFAULT_SANDBOX_CONFIG } from './types';

const log = createLogger('SandboxManager');

// ---------------------------------------------------------------------------
// Sandbox Rule Merging (adapted from CCB RG8)
// ---------------------------------------------------------------------------

/**
 * Merge permission rules into sandbox configuration.
 *
 * CCB reference: RG8(settings) — merges Edit/Read/WebFetch rules into sandbox
 *
 * @param baseConfig Base sandbox configuration
 * @param rules Active permission rules
 * @returns Merged sandbox configuration
 */
export function mergeSandboxRules(
  baseConfig: SandboxConfig,
  rules: PermissionRule[],
): SandboxConfig {
  if (!baseConfig.enabled) return baseConfig;

  const filesystem = { ...baseConfig.filesystem };
  const network = { ...baseConfig.network };

  for (const rule of rules) {
    const { toolName, ruleContent } = rule.value;

    // FileEdit/Edit rules → filesystem write permissions
    if ((toolName === 'FileEdit' || toolName === 'Edit') && ruleContent) {
      if (rule.behavior === 'allow') {
        filesystem.allowWrite = [...filesystem.allowWrite, ruleContent];
      } else if (rule.behavior === 'deny') {
        filesystem.denyWrite = [...filesystem.denyWrite, ruleContent];
      }
    }

    // Read rules → filesystem read permissions
    if (toolName === 'Read' && ruleContent) {
      if (rule.behavior === 'deny') {
        filesystem.denyRead = [...filesystem.denyRead, ruleContent];
      }
    }

    // WebFetch rules → network permissions
    if (toolName === 'WebFetch' && ruleContent?.startsWith('domain:')) {
      const domain = ruleContent.slice('domain:'.length);
      if (rule.behavior === 'allow') {
        network.allowedDomains = [...network.allowedDomains, domain];
      } else if (rule.behavior === 'deny') {
        network.blockedDomains = [...network.blockedDomains, domain];
      }
    }
  }

  return { ...baseConfig, filesystem, network };
}

// ---------------------------------------------------------------------------
// Path Validation
// ---------------------------------------------------------------------------

/**
 * Check if a file path is allowed for writing within the sandbox.
 *
 * @param filePath The path to check (absolute or workspace-relative)
 * @param workspace The workspace root path
 * @param sandbox The active sandbox configuration
 */
export function isWriteAllowed(
  filePath: string,
  workspace: string,
  sandbox: SandboxConfig,
): { allowed: boolean; reason: string } {
  if (!sandbox.enabled) {
    return { allowed: true, reason: 'Sandbox disabled' };
  }

  if (sandbox.mode === 'read-only') {
    return { allowed: false, reason: 'Sandbox is in read-only mode' };
  }

  // Resolve to workspace-relative path
  const relativePath = resolveRelativePath(filePath, workspace);
  if (!relativePath) {
    return { allowed: false, reason: 'Path is outside workspace' };
  }

  // Check deny list first (deny always wins)
  if (matchesAnyPattern(relativePath, sandbox.filesystem.denyWrite)) {
    return { allowed: false, reason: `Path matches denyWrite pattern` };
  }

  // Check allow list (in workspace-write mode, workspace is implicitly allowed)
  if (sandbox.mode === 'workspace-write') {
    return { allowed: true, reason: 'Workspace-write mode: within workspace' };
  }

  if (matchesAnyPattern(relativePath, sandbox.filesystem.allowWrite)) {
    return { allowed: true, reason: 'Path matches allowWrite pattern' };
  }

  return { allowed: false, reason: 'Path not in allowWrite list' };
}

/**
 * Check if a file path is allowed for reading within the sandbox.
 */
export function isReadAllowed(
  filePath: string,
  workspace: string,
  sandbox: SandboxConfig,
): { allowed: boolean; reason: string } {
  if (!sandbox.enabled) {
    return { allowed: true, reason: 'Sandbox disabled' };
  }

  const relativePath = resolveRelativePath(filePath, workspace);
  if (!relativePath) {
    return { allowed: false, reason: 'Path is outside workspace' };
  }

  // Check deny list first
  if (matchesAnyPattern(relativePath, sandbox.filesystem.denyRead)) {
    return { allowed: false, reason: 'Path matches denyRead pattern' };
  }

  return { allowed: true, reason: 'Read allowed' };
}

/**
 * Check if a network request to a domain is allowed.
 */
export function isNetworkAllowed(
  url: string,
  sandbox: SandboxConfig,
): { allowed: boolean; reason: string } {
  if (!sandbox.enabled) {
    return { allowed: true, reason: 'Sandbox disabled' };
  }

  if (!sandbox.network.allowExternalNetwork) {
    return { allowed: false, reason: 'External network access disabled' };
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }

  // Check blocked domains first (deny always wins)
  if (sandbox.network.blockedDomains.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
    return { allowed: false, reason: `Domain ${hostname} is blocked` };
  }

  // If no allowed domains specified, allow all (when external network is on)
  if (sandbox.network.allowedDomains.length === 0) {
    return { allowed: true, reason: 'All domains allowed' };
  }

  // Check allowed domains
  if (sandbox.network.allowedDomains.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
    return { allowed: true, reason: `Domain ${hostname} is in allowed list` };
  }

  return { allowed: false, reason: `Domain ${hostname} not in allowed list` };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a file path to workspace-relative. Returns null if outside workspace.
 */
function resolveRelativePath(filePath: string, workspace: string): string | null {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(workspace, filePath);
  const normalized = path.normalize(absolute);

  // Path traversal check
  if (!normalized.startsWith(path.normalize(workspace))) {
    return null;
  }

  return path.relative(workspace, normalized);
}

/**
 * Check if a relative path matches any pattern in a list.
 * Supports basic glob patterns: *, **, ?
 */
function matchesAnyPattern(relativePath: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    const regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '<<<DSTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/<<<DSTAR>>>/g, '.*');
    try {
      return new RegExp(`^${regexStr}$`).test(relativePath);
    } catch {
      return false;
    }
  });
}
