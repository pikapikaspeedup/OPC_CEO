import * as fs from 'node:fs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

import { loadAIConfig, resetAIConfigCache, saveAIConfig } from '@/lib/providers/ai-config';
import { findUnavailableProviders, formatProviderValidationError } from '@/lib/providers/provider-availability';
import { getProviderInventory, getApiKeysPath, readStoredApiKeys, type StoredApiKeys } from '@/lib/providers/provider-inventory';
import type { AIProviderConfig } from '@/lib/providers/types';

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

const MCP_CONFIG_PATH = path.join(homedir(), '.gemini/antigravity/mcp_config.json');

function ensureMcpConfigDir(): void {
  const dir = path.dirname(MCP_CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readMcpConfig(): { servers: Array<Record<string, unknown>> } {
  try {
    const content = readFileSync(MCP_CONFIG_PATH, 'utf-8');
    if (!content.trim()) {
      return { servers: [] };
    }
    const parsed = JSON.parse(content) as { servers?: Array<Record<string, unknown>> };
    return { servers: parsed.servers ?? [] };
  } catch {
    return { servers: [] };
  }
}

function writeMcpConfig(config: { servers: Array<Record<string, unknown>> }): void {
  ensureMcpConfigDir();
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function handleAIConfigGet(): Promise<Response> {
  try {
    return json(loadAIConfig());
  } catch {
    return json({ error: 'Failed to load AI config' }, { status: 500 });
  }
}

export async function handleAIConfigPut(req: Request): Promise<Response> {
  try {
    const body = await req.json() as AIProviderConfig;
    if (!body.defaultProvider) {
      return json({ error: 'defaultProvider is required' }, { status: 400 });
    }

    const inventory = getProviderInventory();
    const invalidProviders = findUnavailableProviders(body, inventory);
    if (invalidProviders.length > 0) {
      return json(
        { error: formatProviderValidationError(invalidProviders), issues: invalidProviders },
        { status: 400 },
      );
    }

    resetAIConfigCache();
    saveAIConfig(body);
    return json({ ok: true });
  } catch {
    return json({ error: 'Failed to save AI config' }, { status: 500 });
  }
}

export async function handleApiKeysGet(): Promise<Response> {
  return json(getProviderInventory());
}

export async function handleApiKeysPut(req: Request): Promise<Response> {
  try {
    const body = await req.json() as {
      anthropic?: string;
      openai?: string;
      gemini?: string;
      grok?: string;
    };
    const keys = readStoredApiKeys() as StoredApiKeys;

    if (typeof body.anthropic === 'string') {
      keys.anthropic = body.anthropic.trim() || undefined;
    }
    if (typeof body.openai === 'string') {
      keys.openai = body.openai.trim() || undefined;
    }
    if (typeof body.gemini === 'string') {
      keys.gemini = body.gemini.trim() || undefined;
    }
    if (typeof body.grok === 'string') {
      keys.grok = body.grok.trim() || undefined;
    }

    const filePath = getApiKeysPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(keys, null, 2));

    return json({ ok: true });
  } catch {
    return json({ error: 'Failed to save API keys' }, { status: 500 });
  }
}

export async function handleApiKeysTestPost(req: Request): Promise<Response> {
  try {
    const body = await req.json() as { provider: string; apiKey: string; baseUrl?: string };
    const { provider, apiKey, baseUrl } = body;

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return json({ status: 'invalid', error: 'No API key provided' });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      if (provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'x-api-key': apiKey.trim(),
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-20250404',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });

        clearTimeout(timeoutId);
        if (response.status === 401) {
          return json({ status: 'invalid', error: 'Invalid API key' });
        }
        if (response.ok || (response.status >= 400 && response.status < 500)) {
          return json({ status: 'ok' });
        }
        return json({ status: 'error', error: `HTTP ${response.status}` });
      }

      if (provider === 'openai' || provider === 'openai-api') {
        const endpoint = baseUrl?.replace(/\/+$/, '') || 'https://api.openai.com';
        const response = await fetch(`${endpoint}/v1/models`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
          },
        });

        clearTimeout(timeoutId);
        if (response.status === 401) {
          return json({ status: 'invalid', error: 'Invalid API key' });
        }
        if (response.ok || (response.status >= 400 && response.status < 500)) {
          return json({ status: 'ok' });
        }
        return json({ status: 'error', error: `HTTP ${response.status}` });
      }

      if (provider === 'gemini' || provider === 'gemini-api') {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`, {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        if (response.status === 401 || response.status === 403) {
          return json({ status: 'invalid', error: 'Invalid API key' });
        }
        if (response.ok) {
          return json({ status: 'ok' });
        }
        return json({ status: 'error', error: `HTTP ${response.status}` });
      }

      if (provider === 'grok' || provider === 'grok-api') {
        const endpoint = baseUrl?.replace(/\/+$/, '') || 'https://api.x.ai/v1';
        const response = await fetch(`${endpoint}/models`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
          },
        });

        clearTimeout(timeoutId);
        if (response.status === 401 || response.status === 403) {
          return json({ status: 'invalid', error: 'Invalid API key' });
        }
        if (response.ok) {
          return json({ status: 'ok' });
        }
        return json({ status: 'error', error: `HTTP ${response.status}` });
      }

      if (provider === 'custom') {
        if (!baseUrl) {
          return json({ status: 'error', error: 'Custom provider requires baseUrl' });
        }

        let endpoint = '';
        try {
          endpoint = new URL(baseUrl).toString().replace(/\/+$/, '');
        } catch {
          return json({ status: 'error', error: 'base URL invalid' });
        }

        const response = await fetch(`${endpoint}/v1/models`, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey.trim()}`,
          },
        });

        clearTimeout(timeoutId);
        if (response.status === 401) {
          return json({ status: 'invalid', error: 'Invalid API key' });
        }
        if (response.ok) {
          return json({ status: 'ok' });
        }
        if (response.status === 404) {
          return json({ status: 'error', error: 'base URL invalid or /v1/models unavailable' });
        }
        if (response.status >= 400 && response.status < 500) {
          return json({ status: 'error', error: `HTTP ${response.status}` });
        }
        return json({ status: 'error', error: `HTTP ${response.status}` });
      }

      clearTimeout(timeoutId);
      return json({ status: 'untested', error: `Provider '${provider}' test not supported` });
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        return json({ status: 'error', error: 'Request timed out' });
      }
      return json({ status: 'error', error: (error as Error).message || 'Connection failed' });
    }
  } catch {
    return json({ status: 'error', error: 'Network error' }, { status: 500 });
  }
}

export async function handleMcpConfigGet(): Promise<Response> {
  try {
    const content = readFileSync(MCP_CONFIG_PATH, 'utf-8');
    if (!content.trim()) {
      return json({ servers: [] });
    }
    return json(JSON.parse(content));
  } catch {
    return json({ servers: [] });
  }
}

export async function handleMcpServersPost(req: Request): Promise<Response> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const name = body.name;
    if (!name || typeof name !== 'string') {
      return json({ error: 'name is required' }, { status: 400 });
    }

    const config = readMcpConfig();
    const existingIndex = config.servers.findIndex((server) => server.name === name);
    const server: Record<string, unknown> = {
      name,
      type: body.type ?? 'stdio',
    };

    if (body.command) server.command = body.command;
    if (body.args && Array.isArray(body.args)) server.args = body.args;
    if (body.url) server.url = body.url;
    if (body.description) server.description = body.description;
    if (body.env && typeof body.env === 'object') server.env = body.env;

    if (existingIndex >= 0) {
      config.servers[existingIndex] = server;
    } else {
      config.servers.push(server);
    }

    writeMcpConfig(config);
    return json({ ok: true });
  } catch {
    return json({ error: 'Failed to save' }, { status: 500 });
  }
}

export async function handleMcpServersDelete(req: Request): Promise<Response> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const name = body.name;
    if (!name || typeof name !== 'string') {
      return json({ error: 'name is required' }, { status: 400 });
    }

    const config = readMcpConfig();
    config.servers = config.servers.filter((server) => server.name !== name);
    writeMcpConfig(config);
    return json({ ok: true });
  } catch {
    return json({ error: 'Failed to delete' }, { status: 500 });
  }
}

export async function handleMcpToolsGet(): Promise<Response> {
  try {
    const content = readFileSync(MCP_CONFIG_PATH, 'utf-8');
    if (!content.trim()) {
      return json({ servers: [], tools: [] });
    }

    const config = JSON.parse(content) as { servers?: Array<Record<string, unknown>> };
    const servers = config.servers ?? [];
    return json({
      servers: servers.map((server) => ({
        name: server.name,
        type: server.type ?? 'stdio',
        description: server.description,
        command: server.command,
        url: server.url,
      })),
      tools: [],
    });
  } catch {
    return json({ servers: [], tools: [] });
  }
}
