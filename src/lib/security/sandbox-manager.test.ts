import { describe, it, expect } from 'vitest';
import {
  isWriteAllowed,
  isReadAllowed,
  isNetworkAllowed,
  mergeSandboxRules,
} from './sandbox-manager';
import type { SandboxConfig, PermissionRule } from './types';
import { DEFAULT_SANDBOX_CONFIG } from './types';
import { buildRule } from './permission-engine';

const WORKSPACE = '/workspace/project';

describe('isWriteAllowed', () => {
  it('allows writes in workspace-write mode', () => {
    const result = isWriteAllowed('/workspace/project/src/foo.ts', WORKSPACE, DEFAULT_SANDBOX_CONFIG);
    expect(result.allowed).toBe(true);
  });

  it('denies writes outside workspace', () => {
    const result = isWriteAllowed('/etc/passwd', WORKSPACE, DEFAULT_SANDBOX_CONFIG);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('outside workspace');
  });

  it('denies writes to .git directory', () => {
    const result = isWriteAllowed('/workspace/project/.git/config', WORKSPACE, DEFAULT_SANDBOX_CONFIG);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('denyWrite');
  });

  it('denies writes to .env files', () => {
    const result = isWriteAllowed('/workspace/project/.env', WORKSPACE, DEFAULT_SANDBOX_CONFIG);
    expect(result.allowed).toBe(false);
  });

  it('denies writes to key files', () => {
    const result = isWriteAllowed('/workspace/project/secrets/api.key', WORKSPACE, DEFAULT_SANDBOX_CONFIG);
    expect(result.allowed).toBe(false);
  });

  it('denies all writes in read-only mode', () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, mode: 'read-only' };
    const result = isWriteAllowed('/workspace/project/src/foo.ts', WORKSPACE, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('read-only');
  });

  it('allows everything when sandbox disabled', () => {
    const config: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, enabled: false };
    const result = isWriteAllowed('/etc/passwd', WORKSPACE, config);
    expect(result.allowed).toBe(true);
  });

  it('blocks path traversal', () => {
    const result = isWriteAllowed('/workspace/project/../../../etc/passwd', WORKSPACE, DEFAULT_SANDBOX_CONFIG);
    expect(result.allowed).toBe(false);
  });
});

describe('isReadAllowed', () => {
  it('allows reading workspace files', () => {
    const result = isReadAllowed('/workspace/project/src/foo.ts', WORKSPACE, DEFAULT_SANDBOX_CONFIG);
    expect(result.allowed).toBe(true);
  });

  it('denies reading outside workspace', () => {
    const result = isReadAllowed('/etc/shadow', WORKSPACE, DEFAULT_SANDBOX_CONFIG);
    expect(result.allowed).toBe(false);
  });

  it('denies reading .env files', () => {
    const result = isReadAllowed('/workspace/project/.env', WORKSPACE, DEFAULT_SANDBOX_CONFIG);
    expect(result.allowed).toBe(false);
  });
});

describe('isNetworkAllowed', () => {
  const allowedConfig: SandboxConfig = {
    ...DEFAULT_SANDBOX_CONFIG,
    network: {
      allowExternalNetwork: true,
      allowedDomains: ['github.com', 'npmjs.org'],
      blockedDomains: ['evil.com'],
    },
  };

  it('allows listed domains', () => {
    expect(isNetworkAllowed('https://github.com/foo', allowedConfig).allowed).toBe(true);
  });

  it('allows subdomains of listed domains', () => {
    expect(isNetworkAllowed('https://api.github.com/repos', allowedConfig).allowed).toBe(true);
  });

  it('blocks unlisted domains', () => {
    expect(isNetworkAllowed('https://random-site.com', allowedConfig).allowed).toBe(false);
  });

  it('blocks explicitly blocked domains', () => {
    expect(isNetworkAllowed('https://evil.com/phish', allowedConfig).allowed).toBe(false);
  });

  it('denies all when external network disabled', () => {
    expect(isNetworkAllowed('https://github.com', DEFAULT_SANDBOX_CONFIG).allowed).toBe(false);
  });

  it('allows all domains when no allowedDomains specified', () => {
    const noFilter: SandboxConfig = {
      ...DEFAULT_SANDBOX_CONFIG,
      network: { allowExternalNetwork: true, allowedDomains: [], blockedDomains: [] },
    };
    expect(isNetworkAllowed('https://anything.com', noFilter).allowed).toBe(true);
  });

  it('rejects invalid URLs', () => {
    expect(isNetworkAllowed('not-a-url', allowedConfig).allowed).toBe(false);
  });
});

describe('mergeSandboxRules', () => {
  it('merges FileEdit allow rules into allowWrite', () => {
    const rules: PermissionRule[] = [buildRule('allow', 'FileEdit(dist/**)', 'department')];
    const merged = mergeSandboxRules(DEFAULT_SANDBOX_CONFIG, rules);
    expect(merged.filesystem.allowWrite).toContain('dist/**');
  });

  it('merges FileEdit deny rules into denyWrite', () => {
    const rules: PermissionRule[] = [buildRule('deny', 'FileEdit(config/**)', 'organization')];
    const merged = mergeSandboxRules(DEFAULT_SANDBOX_CONFIG, rules);
    expect(merged.filesystem.denyWrite).toContain('config/**');
  });

  it('merges WebFetch allow rules into allowedDomains', () => {
    const rules: PermissionRule[] = [buildRule('allow', 'WebFetch(domain:api.github.com)', 'organization')];
    const merged = mergeSandboxRules(DEFAULT_SANDBOX_CONFIG, rules);
    expect(merged.network.allowedDomains).toContain('api.github.com');
  });

  it('does not modify config when sandbox is disabled', () => {
    const disabled = { ...DEFAULT_SANDBOX_CONFIG, enabled: false };
    const rules: PermissionRule[] = [buildRule('allow', 'FileEdit(**)', 'organization')];
    const merged = mergeSandboxRules(disabled, rules);
    expect(merged).toBe(disabled); // Same reference — no mutation
  });
});
