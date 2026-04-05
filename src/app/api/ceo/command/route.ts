import { NextResponse } from 'next/server';
import { processCEOCommand } from '@/lib/agents/ceo-agent';
import { getWorkspaces } from '@/lib/bridge/gateway';
import type { DepartmentConfig } from '@/lib/types';
import { readFile, access } from 'fs/promises';
import { constants } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * Load department configs for all registered workspaces (async).
 */
async function loadDepartments(): Promise<Map<string, DepartmentConfig>> {
  const workspaces = getWorkspaces() as Array<{ uri: string }>;
  const departments = new Map<string, DepartmentConfig>();

  await Promise.all(workspaces.map(async (ws) => {
    const fsPath = ws.uri.replace(/^file:\/\//, '');
    const configPath = path.join(fsPath, '.department', 'config.json');
    try {
      await access(configPath, constants.R_OK);
      const raw = await readFile(configPath, 'utf-8');
      const config = JSON.parse(raw) as DepartmentConfig;
      departments.set(ws.uri, config);
    } catch {
      // No config or invalid — use default
      departments.set(ws.uri, {
        name: path.basename(fsPath),
        type: 'build',
        skills: [],
        okr: null,
      });
    }
  }));

  return departments;
}

// POST /api/ceo/command
export async function POST(req: Request) {
  const body = await req.json();
  const { command, model } = body;

  if (!command || typeof command !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid command' }, { status: 400 });
  }

  if (command.trim().length > 1000) {
    return NextResponse.json({ error: 'Command too long (max 1000 chars)' }, { status: 400 });
  }

  const departments = await loadDepartments();
  const result = await processCEOCommand(command, departments, { model: typeof model === 'string' ? model : undefined });

  return NextResponse.json(result);
}
