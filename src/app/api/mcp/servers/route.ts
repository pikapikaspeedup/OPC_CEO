import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { homedir } from 'os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';

export const dynamic = 'force-dynamic';

const CONFIG_PATH = path.join(homedir(), '.gemini/antigravity/mcp_config.json');

function ensureConfigDir() {
  const dir = path.dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readConfig(): { servers: Array<Record<string, unknown>> } {
  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    if (!content.trim()) return { servers: [] };
    const parsed = JSON.parse(content) as { servers?: Array<Record<string, unknown>> };
    return { servers: parsed.servers ?? [] };
  } catch {
    return { servers: [] };
  }
}

function writeConfig(config: { servers: Array<Record<string, unknown>> }) {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const name = body.name;
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const config = readConfig();
    const existingIndex = config.servers.findIndex((s) => s.name === name);

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

    writeConfig(config);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const name = body.name;
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const config = readConfig();
    config.servers = config.servers.filter((s) => s.name !== name);
    writeConfig(config);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
