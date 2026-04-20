import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import { GATEWAY_HOME } from '../agents/gateway-home';
import { createLogger } from '../logger';
import type { CEOEventRecord } from './contracts';

const log = createLogger('CEOEventStore');
const CEO_EVENTS_FILE = path.join(GATEWAY_HOME, 'ceo-events.json');

function ensureHome(): void {
  if (!existsSync(GATEWAY_HOME)) {
    mkdirSync(GATEWAY_HOME, { recursive: true });
  }
}

function readEvents(): CEOEventRecord[] {
  ensureHome();
  if (!existsSync(CEO_EVENTS_FILE)) return [];

  try {
    const payload = JSON.parse(readFileSync(CEO_EVENTS_FILE, 'utf-8')) as CEOEventRecord[];
    return Array.isArray(payload) ? payload : [];
  } catch (error) {
    log.warn({ err: error instanceof Error ? error.message : String(error) }, 'Failed to read CEO event store');
    return [];
  }
}

function writeEvents(events: CEOEventRecord[]): void {
  ensureHome();
  writeFileSync(CEO_EVENTS_FILE, JSON.stringify(events.slice(0, 200), null, 2), 'utf-8');
}

export function appendCEOEvent(input: Omit<CEOEventRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): CEOEventRecord {
  const event: CEOEventRecord = {
    id: input.id || randomUUID(),
    timestamp: input.timestamp || new Date().toISOString(),
    kind: input.kind,
    level: input.level,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.workspaceUri ? { workspaceUri: input.workspaceUri } : {}),
    ...(input.meta ? { meta: input.meta } : {}),
  };

  const events = [event, ...readEvents()];
  writeEvents(events);
  return event;
}

export function listCEOEvents(limit = 20): CEOEventRecord[] {
  return readEvents()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}
