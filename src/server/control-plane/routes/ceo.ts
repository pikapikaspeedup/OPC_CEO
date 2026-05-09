import { readFile, writeFile } from 'fs/promises';
import path from 'path';

import { getCEOWorkspacePath } from '@/lib/agents/ceo-environment';
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
