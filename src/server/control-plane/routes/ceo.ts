import { constants } from 'fs';
import { access, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { processCEOCommand } from '@/lib/agents/ceo-agent';
import { getCEOWorkspacePath } from '@/lib/agents/ceo-environment';
import type { DepartmentConfig } from '@/lib/types';
import { listKnownWorkspaces } from '@/lib/workspace-catalog';
import { ensureCEOEventConsumer } from '@/lib/organization/ceo-event-consumer';
import { listCEOEvents } from '@/lib/organization/ceo-event-store';
import {
  appendCEOFeedback,
  buildCEORoutineSummary,
  getCEOProfile,
  updateCEOProfile,
} from '@/lib/organization';

function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

async function loadDepartments(): Promise<Map<string, DepartmentConfig>> {
  const workspaces = listKnownWorkspaces().map((workspace) => ({
    uri: workspace.uri,
    path: workspace.path,
  }));
  const departments = new Map<string, DepartmentConfig>();

  await Promise.all(workspaces.map(async (workspace) => {
    const configPath = path.join(workspace.path, '.department', 'config.json');
    try {
      await access(configPath, constants.R_OK);
      const raw = await readFile(configPath, 'utf-8');
      departments.set(workspace.uri, JSON.parse(raw) as DepartmentConfig);
    } catch {
      departments.set(workspace.uri, {
        name: path.basename(workspace.path),
        type: 'build',
        skills: [],
        okr: null,
      });
    }
  }));

  return departments;
}

export async function handleCEOCommandPost(req: Request): Promise<Response> {
  const body = await req.json();
  const { command, model } = body;

  if (!command || typeof command !== 'string') {
    return json({ error: 'Missing or invalid command' }, { status: 400 });
  }
  if (command.trim().length > 1000) {
    return json({ error: 'Command too long (max 1000 chars)' }, { status: 400 });
  }

  const departments = await loadDepartments();
  const result = await processCEOCommand(command, departments, {
    model: typeof model === 'string' ? model : undefined,
  });
  return json(result);
}

export async function handleCEOEventsGet(req: Request): Promise<Response> {
  ensureCEOEventConsumer();
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') || 20);
  return json({ events: listCEOEvents(limit) });
}

export async function handleCEOProfileGet(): Promise<Response> {
  return json(getCEOProfile());
}

export async function handleCEOProfilePatch(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    return json(updateCEOProfile(body || {}));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function handleCEOProfileFeedbackPost(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    if (!body?.content || typeof body.content !== 'string') {
      return json({ error: 'content is required' }, { status: 400 });
    }

    const type = typeof body.type === 'string' ? body.type : 'preference';
    return json(appendCEOFeedback({
      timestamp: new Date().toISOString(),
      type,
      content: body.content,
      source: 'user',
    }));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function handleCEORoutineGet(): Promise<Response> {
  return json(buildCEORoutineSummary());
}

export async function handleCEOSetupGet(): Promise<Response> {
  try {
    const workspacePath = getCEOWorkspacePath();
    const identityPath = path.join(workspacePath, '.agents/rules/department-identity.md');
    const playbookPath = path.join(workspacePath, '.agents/workflows/ceo-playbook.md');

    const identity = await readFile(identityPath, 'utf8').catch(() => '');
    const playbook = await readFile(playbookPath, 'utf8').catch(() => '');

    return json({ identity, playbook });
  } catch (error) {
    return json({ error: String(error) }, { status: 500 });
  }
}

export async function handleCEOSetupPost(req: Request): Promise<Response> {
  try {
    const { identity, playbook } = await req.json();
    const workspacePath = getCEOWorkspacePath();

    if (typeof identity === 'string') {
      const identityPath = path.join(workspacePath, '.agents/rules/department-identity.md');
      await writeFile(identityPath, identity, 'utf8');
    }

    if (typeof playbook === 'string') {
      const playbookPath = path.join(workspacePath, '.agents/workflows/ceo-playbook.md');
      await writeFile(playbookPath, playbook, 'utf8');
    }

    return json({ success: true });
  } catch (error) {
    return json({ error: String(error) }, { status: 500 });
  }
}
