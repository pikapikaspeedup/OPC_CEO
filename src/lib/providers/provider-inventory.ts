import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import type { ProviderInventory } from './provider-availability';

export type StoredApiKeys = {
  anthropic?: string;
  openai?: string;
  gemini?: string;
  grok?: string;
};

export function getApiKeysPath(): string {
  return path.join(process.env.HOME ?? '~', '.gemini', 'antigravity', 'api-keys.json');
}

export function readStoredApiKeys(): StoredApiKeys {
  try {
    const filePath = getApiKeysPath();
    if (!fs.existsSync(filePath)) return {};
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return raw && typeof raw === 'object' ? (raw as StoredApiKeys) : {};
  } catch {
    return {};
  }
}

function commandExists(command: string): boolean {
  const result = spawnSync('which', [command], { encoding: 'utf-8' });
  return result.status === 0 && Boolean(result.stdout?.trim());
}

function resolveClaudeCodeInstall() {
  const envBin = process.env.CLAUDE_CODE_BIN?.trim();
  if (envBin && fs.existsSync(envBin)) {
    return { installed: true, source: 'env', command: envBin };
  }

  const siblingDist = path.resolve(process.cwd(), '../claude-code/dist/cli.js');
  const siblingDev = path.resolve(process.cwd(), '../claude-code/src/entrypoints/cli.tsx');
  if (fs.existsSync(siblingDist)) {
    return { installed: true, source: 'sibling-dist', command: siblingDist };
  }
  if (fs.existsSync(siblingDev)) {
    return { installed: true, source: 'sibling-dev', command: siblingDev };
  }
  if (commandExists('claude')) {
    return { installed: true, source: 'global', command: 'claude' };
  }

  return { installed: false, source: null, command: null };
}

export function getProviderInventory(): ProviderInventory {
  const keys = readStoredApiKeys();
  const codexAuthPath = path.join(
    process.env.CODEX_HOME?.trim() || path.join(process.env.HOME ?? '~', '.codex'),
    'auth.json',
  );
  const claudeSettingsPath = path.join(process.env.HOME ?? '~', '.claude', 'settings.json');
  const claudeStatePath = path.join(process.env.HOME ?? '~', '.claude.json');
  const claudeInstall = resolveClaudeCodeInstall();

  return {
    anthropic: { set: Boolean(keys.anthropic) },
    openai: { set: Boolean(keys.openai) },
    gemini: { set: Boolean(keys.gemini) },
    grok: { set: Boolean(keys.grok) },
    providers: {
      codex: {
        installed: commandExists('codex'),
      },
      nativeCodex: {
        installed: commandExists('codex'),
        loggedIn: fs.existsSync(codexAuthPath),
        authFilePath: fs.existsSync(codexAuthPath) ? codexAuthPath : null,
      },
      claudeCode: {
        installed: claudeInstall.installed,
        loginDetected: fs.existsSync(claudeSettingsPath) || fs.existsSync(claudeStatePath),
        command: claudeInstall.command,
        installSource: claudeInstall.source,
      },
    },
  };
}
